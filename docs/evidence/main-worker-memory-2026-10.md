# Main Worker memory: what takes it (local workerd, 2026-10-08)

## Scope

Gate M1 (`docs/astro-theme-plan.md` §3.1) measured the main Morph Worker at
52.4 MiB just loaded, 72.8 MiB after public SSR requests and 84.5 MiB with all
server chunks evaluated, against a 128 MB per-isolate limit shared by
concurrent requests. This is research into what that memory is. No product
code changed. The experiments below post-process a copy of the build output
outside the repository and are evidence only, not proposed implementations.

Build measured: `origin/main` @ `ca41525`, unmodified `pnpm build`
(683 server files, 682 chunks under `dist/server/assets`, 21.3 Mi characters).
Everything ran locally (`wrangler dev` 4.146.0, workerd 1.20261001.1,
containers disabled, local D1/R2/KV in a throwaway persist directory). No
deployment, no Cloudflare resources, no remote migrations, no E2E suite.

## Summary

| State (after full GC) | Isolate used | Of which: module source text | Zod schema objects |
| --- | --- | --- | --- |
| Just loaded | 52.7 MiB | 34.0 MiB | 4.1 MiB |
| After public SSR requests | 73.0 MiB | 33.9 MiB | 19.1 MiB |
| After signed-in editor + Design session | 82.3 MiB | 34.2 MiB | 20.6 MiB |
| All 682 chunks evaluated (after the above) | 89.5 MiB | 34.3 MiB | 25.9 MiB |

Before GC the isolate held 130–138 MiB at the end of the editor session
(sampled peak, 8 runs): more than 128 MB (122.1 MiB), though local workerd
neither enforces the limit nor collects as production would under pressure.

The three largest causes:

1. **Every module's source text is resident from isolate start.** The legacy
   module registry compiles all 682 chunks when the isolate starts, whether or
   not they are ever imported, and V8 keeps each source string for the
   isolate's lifetime. That is 34 MiB before the first request. 22.6 MiB of it
   is stored two bytes per character because 103 chunks contain at least one
   character above U+00FF, often only in a comment (an em dash or arrow).
2. **Zod schemas.** About 6,250 Zod objects retain 19.1 MiB after SSR. 7.2 MiB
   are request-body and query schemas of the Admin and Store APIs, created on
   the first SSR request because `/api/admin/$` and `/api/store/$` import their
   whole API statically and their server handlers live in the route-tree chunk.
3. **Client-only code in the server bundle.** The Monaco type declarations
   table (`editor-code-package-declarations.generated`, 3.35 Mi characters,
   only ever imported by browser code) costs 6.4 MiB per isolate, for its
   source and a second copy of its string literals in the constant pool.
   Prettier, html2canvas and the editor UI add more source text.

The Theme workspace is not held: after the editor session the isolate kept
about 70 KB of starter source strings. Its cost is transient, inside the
pre-GC peak. No isolate-lifetime cache of note was found (the largest is
tailwind-merge's, 0.18 MiB).

Measured savings from throwaway variants of the same build (same requests,
3 runs each, GC'd, MiB):

| Variant | Loaded | SSR | Editor | All chunks |
| --- | --- | --- | --- | --- |
| Baseline | 52.7 | 73.0 | 82.3 | 89.5 |
| Source escaped to ASCII | 41.5 (−11.2) | 61.8 (−11.2) | 71.0 (−11.3) | 78.3 (−11.2) |
| ASCII + whitespace/comments removed | 37.4 (−15.3) | 57.6 (−15.4) | 66.6 (−15.7) | 73.8 (−15.7) |
| Declarations chunk emptied | 46.4 (−6.3) | 66.7 (−6.3) | 75.9 (−6.4) | 83.2 (−6.3) |
| ASCII + declarations emptied | 35.2 (−17.5) | 55.4 (−17.6) | 64.7 (−17.6) | 71.9 (−17.6) |
| `new_module_registry` flag (snapshot totals, see §5.6) | 16.0 (−36.7) | 45.5 (−27.5) | 65.7 (−16.6) | 89.9 (+0.4) |

## 1. Method

Harness and raw data: `~/projects/astro-spike/main-worker-memory/` (outside
the repository; see its `README.md`). It reuses M1's method and memory
definition.

- **Worker under test**: `dist/server` copied byte for byte; `main` is a
  wrapper that hands everything to Morph's `index.js` and adds only
  `/__mw/import` (dynamic `import()` of named chunks, used for the all-chunks
  state). `PUBLIC_URL` points at the local port so sign-in works.
- **Each run**: a fresh copy of a pristine local state (D1 migrations plus one
  admin account written the way `scripts/seed-e2e.mjs` writes it, generated
  test password kept in the harness, never printed), a fresh `wrangler dev`,
  so a fresh isolate.
- **Memory** (same as M1): through wrangler's inspector proxy,
  `HeapProfiler.takeHeapSnapshot` (forces a full GC; workerd does not answer
  `HeapProfiler.collectGarbage`), then `Runtime.getHeapUsage`.
  **Isolate used** = `usedSize + backingStorageSize`. Morph has no Wasm memory
  of its own. **Pre-GC total** = `totalSize + backingStorageSize` read just
  before the snapshot. **Sampled peak** = the maximum pre-GC
  `usedSize/totalSize + backing` polled every 100 ms while requests ran (a
  lower bound of the true peak). `uptime` is recorded at every step.
- **States**, in order within one run (`full` sequence):
  1. *loaded*: no request yet;
  2. *ssr-warm*: M1's request set, 3 rounds: `/`, `/sign-in`,
     `/create-first-admin`, `/dashboard`, a 404, `/api/auth/get-session`, and
     the storefront `/` with `Host: shop.localtest.me` (200/307/404 as in M1,
     recorded per run);
  3. *editor*: Playwright Chromium signs in through the real form, opens
     `/dashboard/settings` (which provisions the store, storefront and Theme
     and fills the starter workspace on a fresh database), `/dashboard`,
     `/dashboard/online-store`, then the Visual Editor; a Design session
     selects four sections, opens the Content and Styles panels, edits the
     hero heading (a draft write), switches to Code, opens `Hero.tsx`, edits
     and saves it (a workspace write), returns to Design and opens `/account`.
     6–8 server-function POSTs per run, all 200 except one 500 noted below.
     Live Preview cannot start (containers disabled);
  4. *all-chunks*: `import()` of all 682 chunks (0 failures in every run).

  A `code` sequence goes from *loaded* straight to *all-chunks*.
- **Attribution** (`scripts/analyze.mjs` and friends): heap snapshots were
  saved for runs 1–2 of the baseline and run 1 of two variants. A dominator
  tree is computed and every node is owned by its nearest dominator that
  names a module: a `Script` (its source), a `SharedFunctionInfo` (its
  `script` edge), a closure, a `Context` (through its `ScopeInfo`) or a
  `SourceTextModule`. Bytes are then *source* (under the Script),
  *code* (V8 `code` nodes: bytecode, constant pools, boilerplates, scope
  infos, SFIs), *data* (everything else under a module) or *unattributed*
  (dominated only by GC roots or global handles). Data is further grouped by
  the module-scope variable that holds it, and object families (Zod, Drizzle)
  by retained size of their top-most instances.
- **Package attribution**: a throwaway `vite build --sourcemap` of the same
  commit produced identical chunk names; each generated character is assigned
  to the source of its mapping segment and grouped by npm package or `src/`
  directory (`scripts/composition.mjs`).

## 2. Raw numbers

Baseline, `full` sequence, isolate used / pre-GC total (MiB), and the 1-minute
load average at that step. The host has 12 cores and 15 GiB; other sessions
were working throughout.

| Run | Loaded | SSR | Editor | All chunks |
| --- | --- | --- | --- | --- |
| 1 | 52.70 / 63.4 (6.1) | 73.01 / 108.9 (6.6) | 82.24 / 136.1 (6.5) | 89.50 / 99.9 (6.7) |
| 2 | 52.69 / 63.7 (8.2) | 73.01 / 108.1 (8.5) | 82.28 / 137.8 (12.2) | 89.55 / 99.7 (10.3) |
| 3 | 52.70 / 63.7 (8.3) | 73.01 / 101.6 (7.8) | 82.25 / 135.7 (5.3) | 89.51 / 99.9 (5.3) |
| 4 | 52.69 / 63.2 (5.3) | 72.99 / 99.6 (5.0) | 82.23 / 130.0 (4.7) | 89.49 / 100.2 (5.9) |
| 5 | 52.70 / 63.2 (6.8) | 73.01 / 108.6 (7.0) | 82.28 / 136.5 (8.8) | 89.55 / 99.7 (8.8) |
| peak 1 | 52.70 / 64.2 (8.2) | 73.06, peak 99.5 (7.6) | 82.33, peak 137.7 (6.4) | 89.61 / 100.2 (6.1) |
| peak 2 | 52.69 / 63.9 (6.5) | 73.02, peak 100.3 (6.5) | 82.28, peak 129.7 (7.1) | 89.55 / 99.9 (6.6) |
| peak 3 | 52.69 / 63.4 (6.8) | 73.03, peak 100.5 (6.7) | 82.28, peak 132.2 (8.9) | 89.54 / 100.2 (8.9) |

`code` sequence (3 runs): loaded 52.69–52.70; all chunks without any request
first 81.67–81.69 MiB (pre-GC 112.6–114.8). Requests therefore leave about
8 MiB more than evaluation alone: lazily compiled bytecode and JIT code of the
functions that ran, and state built on first use.

Isolate-used numbers vary by less than 0.1 MiB between runs at load averages
of 4.7–12.2. Pre-GC numbers vary by up to 9 MiB because they depend on when V8
last collected. The editor's sampled peak equals its pre-GC reading: the heap
grew through the whole session without a full collection.

Compared with M1 (build `6ea0886`): loaded 52.4 → 52.7, SSR 72.8 → 73.0. M1's
84.5 MiB all-chunks state followed SSR only; this build gives 81.7 with no
requests and 89.5 after SSR and the editor session.

Variant runs (min / median / max over 3 runs; per-run rows, statuses and loads
are in the harness's `raw/summary.md`):

| Variant | Loaded | SSR | Editor | All chunks | Editor pre-GC |
| --- | --- | --- | --- | --- | --- |
| ascii | 41.5 | 61.8 | 71.0 / 71.0 / 71.1 | 78.3 | 118.3 / 118.5 / 124.3 |
| ascii-min | 37.4 | 57.6 | 66.5 / 66.6 / 66.6 | 73.8 | 111.7 / 117.3 / 117.7 |
| nodecl | 46.4 | 66.7 | 75.9 | 83.1 / 83.2 / 83.2 | 125.4 / 125.8 / 129.6 |
| ascii-nodecl | 35.2 | 55.4 / 55.4 / 55.5 | 64.7 / 64.7 / 64.8 | 71.9 / 71.9 / 72.0 | 112.0 / 112.4 / 113.0 |
| new_module_registry (`getHeapUsage`) | 12.8 | 40.1 / 40.1 / 40.2 | 57.4 / 57.5 / 57.5 | 78.3 / 78.3 / 78.4 | 111.4 / 111.5 / 117.2 |

Every variant returned the same SSR status codes as the baseline. Exceptions,
both outside the measured memory: in `new_module_registry` run 2 one
server-function POST returned 500; in `nodecl` run 3 the last UI step
(`/account`) timed out.

## 3. Attribution

### 3.1 By category (baseline run 1; run 2 within 0.05 MiB)

| State | Total | Source | Code | Data | Unattributed |
| --- | --- | --- | --- | --- | --- |
| Loaded | 52.7 | 34.0 | 4.9 | 11.1 | 2.8 |
| SSR | 73.0 | 33.9 | 6.0 | 26.4 | 6.8 |
| Editor | 82.3 | 34.2 | 8.5 | 28.6 | 10.9 |
| All chunks | 89.5 | 34.3 | 9.0 | 34.5 | 11.8 |

Unattributed is mostly strings, JIT code (`InstructionStream`, 1.9 MiB after
the editor session), property arrays and maps held from GC roots.

### 3.2 Source text: the whole bundle, from the start

At *loaded*, before any request, the snapshot holds 745 `Script`s: all 682
chunks plus runtime-internal modules. Only `index.js` and `worker-entry`
(3.2 Mi characters) are in the static import graph and evaluated; the other
chunks are compiled but not evaluated. Each module's top-level function is
compiled too, so a chunk whose top level is a large literal pays for it twice
(see §3.5).

| Chunk | Characters | Stored as | V8 bytes |
| --- | --- | --- | --- |
| `worker-entry` | 3.21 M | two-byte (2,697 chars > U+00FF) | 6.12 MiB |
| `editor-code-package-declarations.generated` | 3.35 M | one-byte | 3.20 MiB |
| `editor` (Visual Editor UI) | 1.44 M | two-byte (533) | 2.75 MiB |
| `cms.config` | 0.88 M | two-byte (10) | 1.69 MiB |
| `typescript` (Prettier's parser) | 0.60 M | two-byte (25) | 1.14 MiB |
| `preview` | 0.57 M | two-byte (24) | 1.09 MiB |
| `phone-input` | 0.53 M | two-byte (62) | 1.00 MiB |
| all 682 chunks | 21.3 M | 103 chunks two-byte | 32.6 MiB (+1.4 runtime) |

Ten characters make all of `cms.config` two-byte. Escaping only what the
compiler escapes (esbuild `charset: "ascii"`) is not enough: esbuild keeps
comments when not minifying and leaves them as they are, and 13.7 MiB of
sources stayed two-byte on comment characters alone (for example `—` in
`@cloudflare/sandbox` comments inlined into `worker-entry`).

By origin (sourcemap build; V8 bytes as stored, then if stored one-byte):

| Origin | As stored | One-byte |
| --- | --- | --- |
| `src/routes/_editor` (incl. the declarations table) | 5.68 MiB | 4.45 MiB |
| `src/lib/storefront` | 3.19 MiB | 1.75 MiB |
| `prettier` | 3.00 MiB | 1.68 MiB |
| `src/routes/_backend` | 2.18 MiB | 1.42 MiB |
| `@babel/parser` | 1.02 MiB | 0.51 MiB |
| `@cloudflare/sandbox` | 0.87 MiB | 0.43 MiB |
| `better-auth` | 0.70 MiB | 0.36 MiB |
| `html2canvas` | 0.66 MiB | 0.33 MiB |
| `tailwindcss`, `country-flag-icons`, `lucide-react`, `zod` | 0.55–0.63 MiB each | 0.28–0.60 MiB |

Most non-Latin-1 characters come from `entities` (6,167, into one chunk),
`prettier` (2,217), Morph's `src/lib/storefront` (1,475) and `@babel/parser`
(1,227).

### 3.3 Zod schemas

Retained size of top-most Zod objects (`scripts/families.mjs`):

| State | Retained | Zod objects |
| --- | --- | --- |
| Loaded | 4.1 MiB | 1,338 |
| SSR | 19.1 MiB | 6,251 |
| Editor | 20.6 MiB | 6,721 |
| All chunks | 25.9 MiB | 8,431 |

Zod 4.2's classic API gives every schema instance its own method closures.
After SSR, 137,306 anonymous closures whose code is in `worker-entry` (where
Zod is bundled) are held under module-scope variables, 3.7 MiB of closure
objects alone; they were not individually traced to Zod. Grouped by holding module-scope variable after SSR:

| Module | Module-scope variables | Of which `*Schema` variables |
| --- | --- | --- |
| `router` (route tree, incl. Admin/Store API) | 7.8 MiB | 7.2 MiB |
| `worker-entry` (Better Auth endpoints, Theme content fields) | 1.6 MiB | 0.8 MiB |
| `cms.config` (`formFieldSchema` 0.77 MiB) | 1.0 MiB | 0.8 MiB |
| `store-customer-request` | 0.5 MiB | 0.25 MiB |

The `router` chunk's largest share (0.39 Mi of its 0.69 Mi characters) is
`src/server/admin-api`, pulled in by `src/routes/_backend/api/admin/$.ts`,
which imports every Admin API handler, DAL and service at module scope;
`api/store/$.ts` does the same for the Store API. Their schemas
(`createBodySchema`, `updateStoreCartInputSchema`, …, 154 module-level
`*Schema` constants in that chunk) are built when the route tree is first
evaluated, i.e. by the first SSR request of any page.

Isolated check of the per-schema cost (Node 22's V8, not workerd; 400 copies
of one 7-field body schema, 3 runs, identical): classic `zod` 184 KiB per
schema, `zod/mini` 48 KiB (26%). The absolute numbers differ from workerd's
snapshot and are only used as a ratio.

### 3.4 Other data

- At load, `worker-entry` is evaluated (it holds the Durable Object exports
  and the shared code Rollup hoisted into the entry chunk: `@babel/parser`,
  `@cloudflare/sandbox`, Better Auth, Zod, Drizzle). Its data is 4.7 MiB, about
  2.5 MiB of it Better Auth endpoint schemas.
- The editor session adds 9.3 MiB over SSR: 2.6 MiB code (functions that ran),
  2.3 MiB data (mostly `worker-entry`, `editor` and `cms.config` state) and
  4.1 MiB unattributed (JIT code, strings).
- Theme workspace: searching the post-session snapshot for the starter Theme's
  source finds about 70 KB of strings (a small `Map` in a module context and
  copies held from GC roots). The saved Code edit's text is not present.
- Drizzle table objects: 0.45–0.52 MiB in every state.
- Largest `Map`/`Set`: tailwind-merge's cache, 0.18 MiB.

### 3.5 The declarations table

`editor-code-package-declarations.generated` is only reached through a dynamic
`import()` in `editor-code-workspace`, browser code that is in the server
bundle because the editor is server-rendered. It is never imported on the
server, yet it costs 3.20 MiB of source plus 3.14 MiB of string constants
(V8 compiled its top-level array literal into a boilerplate holding copies of
the strings). Emptying it in a variant saved 6.3 MiB in every state.

## 4. Candidate changes

Estimates are from this build and this request mix. Savings are not always
additive; the measured combination is shown where it was run.

| # | Change | Estimated saving | Evidence |
| --- | --- | --- | --- |
| 1 | Emit server chunks with no character above U+00FF, comments included (escape in strings/templates/regexes, strip or escape comments) | **11.2 MiB in every state** | Measured (`ascii`) |
| 2 | Also drop whitespace and comments from server chunks (keep identifiers) | a further **4.1–4.4 MiB** (15.3–15.7 total with #1) | Measured (`ascii-min`) |
| 3 | Keep the Monaco declarations table out of the server bundle (client-only import, or serve it as a static asset) | **6.3 MiB in every state**; 17.5 with #1 | Measured (`nodecl`, `ascii-nodecl`) |
| 4 | Keep other client-only libraries out of the server bundle: Prettier and its parsers, html2canvas | up to ~3.7 MiB of source as stored (≈2.0 MiB after #1), plus their top-level code | Estimated from source size; whether each is server-reachable must be checked first |
| 5 | Load the Admin and Store API modules only inside their handlers (`await import()`), so the route tree does not instantiate their schemas | up to **7.2–7.8 MiB** in isolates that have not served `/api/admin` or `/api/store`; nothing once they have | Estimated from the snapshot; not run |
| 6 | Construct module-level Zod schemas lazily (memoised factories) or use `zod/mini` for server-only schemas | 19.1 MiB of schemas after SSR; `zod/mini` measured at 26% per schema in Node, so up to ~14 MiB if all of them moved (a large change across 130 files) | Estimated |
| 7 | Move eager entry-chunk work (Better Auth endpoint schemas, `@babel/parser`) out of `worker-entry` | ~2.5 MiB data plus part of its 6.1 MiB source | Estimated |
| 8 | `new_module_registry` compatibility flag (lazy module compilation) | 36.7 MiB at load, 27.5 after SSR, 16.6 after the editor session, none with everything imported | Measured locally; production availability and accounting unknown, see §5.6 |

Order of cost to benefit: #1 and #3 are build-level, change no runtime
behaviour and are measured; #2 trades readable stack traces in logs (names
stay) for 4 MiB; #5 is a local refactor of two route files with a bounded
effect; #6 is the largest data item and the largest change.

## 5. Limits of local measurement

1. **Not production.** All numbers are local workerd. How production counts
   the 128 MB (used, committed, external strings), when it enforces it, and
   how GC behaves near it were not measured. Production's Workers Metrics
   were not read (no remote resources).
2. **Module loading may differ.** That the legacy registry compiles every
   module at startup is observed locally; that production does the same is an
   assumption, consistent with it being the same runtime.
3. **Pre-GC peaks** depend on GC timing, and the sampled peak is a lower
   bound. Local workerd does not apply memory pressure, so production may
   collect earlier; equally, concurrent requests in one isolate add their own
   transient memory, which was not measured (one request at a time).
4. **The editor session is one scripted flow** on a freshly provisioned store
   with the starter Theme and no Live Preview (containers disabled, so the
   preview proxy and container Durable Object paths did not run). A larger
   Theme workspace, AI authoring, builds, publish and the commerce dashboard
   pages were not exercised.
5. **Durable Objects and queue consumers** (`Sandbox`, `PreviewSandbox`,
   `BuildPreviewSandbox`, the build and export queues) were not measured.
6. **`new_module_registry`** is not in Cloudflare's public compatibility-flag
   documentation; whether it can be used in production is unknown. Under it,
   module sources are external strings, which `Runtime.getHeapUsage` does not
   count (its `getHeapUsage` figures, 12.8/40.1/57.5/78.3 MiB, are therefore
   low); the variant table uses heap-snapshot totals of run 1 instead, which
   count them. How production accounts for external strings is unknown.
7. **Heuristic attribution.** Ownership follows dominators: memory shared by
   several modules goes to the nearest common dominator or to unattributed;
   the source/code/data split follows V8's node types. The sourcemap
   composition assigns comments to the preceding mapping segment.
8. **The Zod ratio** comes from Node's V8 with one schema shape.
9. **Variants are post-processed builds** (esbuild transform per chunk, or a
   replaced chunk), checked only by these request sequences. They are not a
   tested implementation of any candidate.

## 6. Reproduction

```bash
git -C ~/projects/morph worktree add -b <branch> ~/projects/morph-wt-worker-memory origin/main
cd ~/projects/morph-wt-worker-memory && pnpm install --frozen-lockfile && pnpm build
cd ~/projects/astro-spike/main-worker-memory
node scripts/prepare.mjs && node scripts/seed.mjs   # variant, local D1, local admin
mkdir state-template && cp -r state/v3 state-template/
node scripts/measure.mjs morph full 5 --save=1,2 --tag=morph-full
node scripts/measure.mjs morph code 3 --save=1 --tag=morph-code
node scripts/make-variants.mjs && scripts/run-experiments.sh
node scripts/analyze.mjs snapshots/<snapshot> raw/analysis/<name>.json
node scripts/summarize.mjs   # raw/summary.md
```

## 7. Follow-up: candidate #3 applied (2026-10-08)

Candidate #3 (section 4) as a product change, measured on its own. The
server build no longer emits the declarations chunk: its only loader,
`preloadGeneratedThemePackageDeclarations`, returns early under the
build-time `import.meta.env.SSR`, so the SSR build drops the `import()`.
Its only caller is an effect, which never runs during SSR, so the server
never loaded the chunk and still does not.

Builds: `origin/main` @ `461a901` (baseline) and the same commit with the
change, both an unmodified `pnpm build`.

| Build output | Baseline | With the change |
| --- | --- | --- |
| Server chunks | 682 | 681 |
| Server `assets` bytes | 22,649,770 | 19,302,179 (−3,347,591) |
| Server files holding the declarations | 1 | 0 |
| Client output | — | byte-identical to the baseline (`diff -rq`, 426 files) |

Memory, the same harness as sections 1–2 (a copy of it, with
`scripts/seed.mjs` taking the variant name), a fresh state with migrations
through 0075, the `full` sequence, 3 runs each, isolate used after full GC
(MiB), load average 2.0–3.9 for all six runs:

| State | Baseline (min–max) | With the change (min–max) | Difference (medians) |
| --- | --- | --- | --- |
| Loaded | 52.72–52.72 | 46.42–46.42 | −6.30 |
| After public SSR | 73.02–73.04 | 66.65–66.68 | −6.37 |
| After the editor session | 82.24–82.28 | 75.88–75.92 | −6.34 |
| All chunks evaluated | 89.50–89.54 | 83.13–83.17 | −6.36 |

This matches the post-processed `nodecl` variant (−6.3 MiB, section 2).
Pre-GC totals moved as GC timing allows: the editor session's fell from
129.7–150.7 to 122.1–130.9 MiB, while the loaded state's rose from
62.7–63.9 to 68.3–68.5 MiB. Pre-GC figures are not used for the
comparison (section 5.3).

Every run of both builds returned the same SSR statuses, completed all
17 editor steps with every server-function POST answering 200 (one run with
the change made 7 POSTs instead of 6), and imported every chunk with no
failures. The limits in section 5 apply unchanged: local workerd, one
request flow, production accounting unknown.
