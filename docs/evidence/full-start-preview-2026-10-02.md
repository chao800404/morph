# Full TanStack Start Live Preview — prototype status, 2026-10-02

PROTOTYPE branch `feat/full-start-preview`, opt-in with the Worker var `MORPH_THEME_PREVIEW_RUNTIME=start`. Not for main. This records what was measured locally on the CI transport (local sidecar) after merging main up to #83 (`0dca741`); #84 (the Retry Preview fix) landed on main afterwards and is not in these runs. Each run's results are kept under `/tmp/audit/pw-runs/fp-<runtime>-<time>/`.

## What runs

### Sandbox follow-up after `42d5e4b`

This follow-up does not establish that the prototype can replace the current preview.

- **SVG isolation is now actually tested on Start.** The test obtains the origin
  from the editor's preview iframe rather than assuming the client-only base
  path. It identifies its own container by the generated Wrangler name containing
  the actual preview ID, and refuses zero or multiple matches. It never chooses
  the first container belonging to another run. Start requests the SVG at the
  root; the client-only runtime retains its additional base-path check.
  `fp-sbx-start-20261002-132029`: **3 passed**, including the setup and transport
  checks. Chromium, Firefox and WebKit received the malicious fixture with the
  isolation headers and did not execute its script; each no-header control did
  execute. The fixture bypass exists only in the test's own container.
- **Text promotion remains broken on the real Sandbox Start transport.** It
  failed in all three runs (`fp-sbx-start-20261002-132419`, `-133422`,
  `-134158`; 2 passed, 1 failed in the first two), each time in the step that
  selects the fixed text on the canvas ("the fixed text was not exposed on the
  canvas", or the text was not found). The cause is not known. Frame
  navigation events include same-document navigation and are not evidence of
  a document reload.
- **Hydration, corrected.** Only `-132419`'s trace has a hydration report, and
  it is React's attribute-only warning ("A tree hydrated but some attributes
  … didn't match"), not a difference in the Theme's component output. The
  differing attributes are the editor bridge's own, set on the document before
  React hydrated it: `data-storefront-style-revision` and
  `data-storefront-editor-selection-enabled` on `<html>`,
  `data-storefront-preview-root` on `<body>`. React does not re-render for an
  attribute-only mismatch, so it is unlikely to explain the failure, and the
  other two failing traces have no hydration report at all. The bridge writing
  these before hydration is a separate thing to fix.
- **Test diagnostics.** The test attaches bounded HMR sequence/type records and
  hydration reports (kind, time, the differing lines; no preview URLs or
  tokens). An earlier version asserted on uncaught "Hydration failed" errors
  only: it could not see the console warning above, and it sat after the step
  that fails, so it never ran. It was replaced; hydration reports are
  diagnostics, not a pass condition. The classifier was checked against the
  real message from `-132419`.
- **What the failure is, `-142128`** (worktree unchanged during the run;
  2 passed, 1 failed, same step). Timeline from the trace, seconds after the
  editor loaded:
  - 5.4: the frame's document is server-rendered, from the source before
    the Code save;
  - 17.9: the Code save; 18.0: back to Design;
  - 29.9: the client only now fetches the hero component module, already
    the saved version;
  - 30.6: React reports a content mismatch ("Hydration failed"; the client
    has the new `<p>`, the server HTML does not) and regenerates the tree on
    the client, after which the fixed text is on the page;
  - 31.2–31.3: the test tries to click it; none of the five sample points
    reaches the iframe (something in the editor covers the canvas);
  - 31.9: the preview lifecycle reaches `ready`;
  - 32.3: the diagnostics, taken right after, find three of the five points
    on the iframe and on the text itself.

  So the test clicks about 0.6 s before the preview is ready, and that is
  the immediate failure. Underneath it are two product findings: the frame
  takes about 25 s from its document to hydration on the Sandbox transport,
  and a save made in that window reaches the client but not the
  already-sent server HTML, so React falls back to rendering on the client.
  The end state is correct; the server render is lost for that load.

- **After the click waits for the canvas, `-144044`** (text promotion +
  `editor.spec.ts`; **9 passed, 2 failed**). `clickExposedElement` now waits
  until the iframe's computed `pointer-events` is no longer `none`: the editor
  keeps the frame `opacity-0 pointer-events-none` until the preview is ready,
  and Playwright counts `opacity: 0` as visible. Results:
  - the canvas cases that failed before (selection, style editing) passed;
  - text promotion got past selecting the fixed text and failed one step
    later: after "Make editable" the promoted text did not appear within
    30 s. Not investigated yet;
  - `editor.spec.ts:18` (create, populate and remove a page) failed on the
    section count; it also failed in `-083547`, before this change.
- **The server does not keep an outdated module.** A document requested
  inside the frame after the save, `-144044`: status 200, with the saved
  text. So this is not TanStack/router#6556; the mismatch comes from the
  document being rendered before the save and the client modules arriving
  after it.
- **Where the time to hydration goes, `-144044`.** The frame's document
  arrived at 28.4 s; its 157 module requests finished at 80.8 s. 98 of them
  are TanStack packages served file by file, not pre-bundled
  (`@tanstack/react-router` 41, `@tanstack/router-core` 35,
  `@tanstack/start-client-core` 10, others), plus 41 Theme source modules.
  Each request took about 1.3 s to first byte through the local Sandbox
  proxy (p50), and imports arrive in waves, one level of the import graph
  at a time. Start keeps its framework packages out of client pre-bundling
  on purpose (TanStack/router#5715, virtual `#tanstack-*` entries), so
  forcing them in is not a safe fix. Both the per-request cost of the
  Sandbox path and the depth of that graph are candidates; this was one run.
- **HTTP/1.1 is not what limits it (measured, corrects an earlier reading).**
  All 160 preview requests in `-144044` used HTTP/1.1 over six reused
  connections, and requests queued in the browser for one of them. That was
  read as the local number being inflated by HTTP/1.1. Measured directly in
  `-150955`: the same Start preview, opened on its own page, 8 times in
  alternating order, each in a fresh browser context, over HTTP/1.1 (the dev
  server) and over HTTP/2 (a local TLS front that only forwards; measurement
  only, not in the repo). 157 resources each time.

  | Run | Protocol | Load | Hydrated | Queued p50 | Server wait p50 |
  | --- | -------- | ---- | -------- | ---------- | --------------- |
  | 0   | HTTP/1.1 | 3.2  | 19.4     | 1.40       | 0.60            |
  | 1   | HTTP/2   | 0.8  | 7.2      | 0.005      | 0.95            |
  | 2   | HTTP/2   | 0.8  | 19.8     | 0.002      | 1.43            |
  | 3   | HTTP/1.1 | 2.7  | 31.8     | 2.33       | 1.12            |
  | 4   | HTTP/1.1 | 3.5  | 32.9     | 2.45       | 1.14            |
  | 5   | HTTP/2   | 2.6  | 31.0     | 0.004      | 4.38            |
  | 6   | HTTP/2   | 2.5  | 30.6     | 0.005      | 4.28            |
  | 7   | HTTP/1.1 | 2.5  | 17.2     | 0.66       | 0.36            |

  Seconds. Hydrated, median of four: HTTP/1.1 25.6, HTTP/2 25.2. HTTP/2
  removes the browser's queue, but the server's wait grows by about as much:
  the requests now wait behind the server instead of the browser. Both
  protocols complete about 5–9 requests per second in seven of the eight
  runs (run 1, about 20). So the limit is the
  throughput of the server path (Morph's dev Worker → the Sandbox Durable
  Object → the container → Vite), not the browser's connection limit, and
  HTTP/2 alone would not shorten a deployed preview's hydration. Large spread
  between runs (7–33 s) on both protocols; four runs each, one session.

- **Hop by hop: the path, not Vite (`-152420`).** The 102 module paths the
  frame had loaded, requested again from Node (warm: Vite had already
  transformed them), two rounds in alternating order. Measurement only, not
  in the repo; read-only GETs to this run's own container.

  | Path                                      | All at once             | One by one                    |
  | ----------------------------------------- | ----------------------- | ----------------------------- |
  | A: inside the container, straight to Vite | 0.20–0.29 s (358–509/s) | p50 1 ms                      |
  | C: dev server with the preview Host       | 4.6–5.4 s (19–22/s)     | p50 55–66 ms, 5.8–9.1 s total |

  Vite answers the whole set in under 0.3 s. Through Morph's dev Worker, the
  Sandbox Durable Object and the container's proxy, the same set takes about
  5 s, and sending it all at once is barely faster than one by one (wait p50
  4.0–4.5 s): the path handles about one request at a time, roughly 50 ms
  each. That serialisation, not Vite and not the browser's connections, is
  what limits the frame's load. Which part of the path serialises (the
  Worker's own handling, the Durable Object, or the container proxy) is not
  measured yet. The host-to-container-IP comparison (B) did not connect
  (Docker's container network is not reachable from this host) and is left
  out. In the browser the same modules took longer than here (first-time
  transforms, the import waterfall); this isolates the path's own cost.

- Two hydration-wait experiments did not fix text promotion and were restored;
  no runtime change from those experiments is retained. First experiment
  (`-133422`): **2 passed, 1 failed** (text promotion). Second experiment
  (`-134158`): height and loader-error handling each passed once, while text
  promotion failed. These passes do not validate the restored runtime or prove
  stability.
- The restored-runtime attempt to repeat height and loader-error handling three
  times (`fp-sbx-start-20261002-135840`) failed in the transport prerequisite
  after Sandbox runtime interruptions/container startup errors: **1 passed,
  1 failed, 6 did not run**. No three-repeat result is available. The run
  before it (`-134158`) also logged "interrupted while the platform was
  updating the sandbox runtime". A likely but unverified reading is that the
  local dev server reloaded its Sandbox Durable Object while the experiments
  changed and restored runtime source in the worktree; this run is not a
  product result and should be repeated with the worktree unchanged.

Run directories and traces are local evidence, not Cloudflare deployment
validation. Main and the draft PR's no-merge boundary remain unchanged.

With the Start runtime the preview workspace runs TanStack Start in workerd (Cloudflare Vite plugin + `tanstackStart()`), as the published Theme does.

`e2e/native-compat-preview.spec.ts`, Start runtime, CI transport: **14 passed, 3 skipped** (the 3 are the client-only `KNOWN GAP` cases, which do not apply). Covered:

- SSR loaders that call server functions through function middleware;
- server functions from the client: GET, POST, a thrown error;
- HttpOnly cookies on the preview's own page (`setResponseHeader`, `getCookie`/`setCookie`);
- server routes: JSON GET and POST, a redirect, `robots.txt`;
- client `Link` navigation keeping the document, and the editor channel surviving the Theme's own navigation;
- a Code-mode save applied by HMR, keeping the document;
- a preview's root paths not answered with Morph's own files.

Earlier the same suite had passed only on the Sandbox transport.

## Fixed on the branch: the editor's overlays fed back as structure

A Start Theme owns the whole document, so the bridge's structure root is `<body>`, and the editor's own selection and hover overlays live there. Every overlay update was reported as a change of the page's structure; the editor answered, the overlays updated again, and the reports never stopped. A probe counted more than 25 structure reports in 3 s after one tree click, against none on the client-only preview.

The visible effects:

- the Code tab switched to the route file, so a Code-mode save wrote `src/routes/index.tsx` instead of the component being edited;
- canvas selection lost elements mid-scan.

Fix (`d1181ea`, then `1ea09af`): the structure observer leaves out a mutation only when it is inside one of the editor's two overlays, or adds or removes nothing but them. The overlays are recognised by identity (`owns`), so a Theme cannot hide its own structure by imitating a marker; the first version used a `data-morph-editor-ui` attribute and was replaced for that reason. Unit tests with a real `MutationObserver` show a Theme node added or removed, a Theme element's attribute, class and text changes, and a Theme node added together with an overlay all still reported. After it, the same probe saw no structure reports in that window, and the canvas style edit and the `public/` root-URL Code save pass under Start. The stale-measurement editor test also read the preview channel from the frame's own address, which a Start preview drops on its first navigation; it now reads the iframe `src` and passes on both runtimes.

## Editor suites under the Start runtime

`native-compat-preview`, `editor`, `editor-writes-paused`, `auth-failure`, `preview-frame-load`, `public-root-url`, `text-promotion` and `responsive`:

- after the overlay fix: **49 passed, 3 skipped, 1 failed** (`fp-start-20261002-041800`); the failure was the test race described under gap 1;
- after the helper fix as well: **50 passed, 3 skipped, 0 failed** (`fp-start-20261002-055426`). The 3 skipped are the client-only `KNOWN GAP` cases.

## Open gaps

1. ~~A Code save can stall while a Start preview applies it~~ — **not a stall; a test race, now fixed.** The first reading of `text-promotion`'s trace marked the save as never answered, but the trace simply ended 1.8 s after the save went out. The shared helper `saveEditedSource` waited for any POST carrying the file path, and under Start the preview's own file sync (which goes out first, while the save waits on its formatter) matched it. The test then switched to Design, which correctly waited for the save, and probed the canvas while still in Code. The helper now waits for the `saveStorefrontThemeFile` call itself and requires its body to say the file was saved. After that, `text-promotion` and `public-root-url` pass on both runtimes (`fp-start-20261002-053012`, `fp-client-20261002-053531`). The same helper is on main and is corrected there separately.
2. **A Theme's default (Lax) cookie is not kept inside the editor canvas.** The preview is framed cross-site, which the preview's security boundary requires: a registrable domain of its own. Opened as its own page the same cookie round-trips. This is asserted as a `KNOWN GAP` and follows from the isolation requirement; it is not a bug to remove.
3. **Measured locally only.** Not in Cloudflare, not with the Sandbox container's real startup, network or resource limits.

## Startup, editor open to Theme rendered (local, preliminary)

Two fresh runs per runtime; "cold" is the first open of a fresh e2e run, "warm" three reloads after it. No containers were touched.

| runtime     | run | cold  | warm              |
| ----------- | --- | ----- | ----------------- |
| client-only | 1   | 6.1 s | 5.5 / 5.7 / 4.8 s |
| Start       | 1   | 5.9 s | 5.4 / 4.5 / 4.4 s |
| client-only | 2   | 8.3 s | 7.9 / 8.2 / 7.0 s |
| Start       | 2   | 5.7 s | 4.6 / 4.5 / 4.7 s |

Client run 2 was slower in everything, page load included (2.2–2.4 s against about 0.8 s otherwise), which points at machine load rather than the runtime. Locally the Start preview is not slower than the client-only one. That says nothing yet about Cloudflare.

## Before this could replace the client-only preview

- Measure in an isolated Cloudflare environment: cold and warm start, time to interactive.
- The preconditions in ROADMAP "TanStack Start 原生相容" for opening a full Start preview to users: outbound allow-list, resource budgets, cross-preview cookie isolation, control-service authorization. None of them is addressed here.
