# Final goal and implementation approach

Status: direction record, owner decisions of 2026-11-26 to 2026-11-28. Plans below are not yet implemented unless a
PR is named. Delivery order and per-feature status live in [`ROADMAP.md`](../ROADMAP.md) section 1.7; this file
records the goal and the reasoning rules the roadmap follows.

## Final goal

- Code is the main body of a Theme. Code mode never restricts how the author writes in the native framework.
- Design is a helper that lets non-coders change code and content. It never defines what a Theme may contain. Design
  may edit source literals and styles when it can locate them safely.
- Morph supports every Astro and TanStack Start rendering mode in preview, publish and the editor: SSR, streaming,
  selective SSR, SPA, SSG/prerender and ISR-equivalents.
- Each framework uses its own official Cloudflare setup. Morph invents no pattern of its own.

Related: ROADMAP sections 1.2 and 1.6, [`docs/multi-runtime-theme-plan.md`](multi-runtime-theme-plan.md).

## Approach decisions

### Render configuration has one source (2026-11-28)

- Theme source code is the only source of render configuration.
- When Design switches a render mode, it changes only safely identifiable official config, and only through the
  existing source write path (OCC).
- Publish freezes a read-only `Render Plan` from the actual build result.
- New flows stop writing a second, editable CMS render setting. Historical release snapshots are kept for rollback.

### Scopes

- The `vite.config` template-hash check (warn or refuse) applies only to transitional Managed Start. Native builds run
  the author's own config under the deploy contract.
- `@morph/sdk` is the unified entry point for reading Morph CMS and commerce data. Pure source components may keep the
  framework-native style.

### Security boundary (decision A, 2026-11-28)

- The Sandbox container is the security boundary for untrusted Theme builds. In-build package checks are defence in
  depth only.
- Managed Start disables inline PostCSS and refuses a Theme PostCSS config with `THEME_POSTCSS_CONFIG_UNSUPPORTED`.
- Native Astro runs the author's config as the framework officially allows.
- Planned, not implemented: the build container runs fully offline (no allowlist), each retry gets a fresh
  container, and `--ignore-scripts` gates any future dependency install.

### Astro default slot (direction B, 2026-11-28)

- Runtime render recording replaces the static proof that the default slot actually rendered. Core's existing write
  checks still apply; static analysis stays as lint for that one proof only.
- Design: a preview SDK tags values; a recorder runs through an aliased `astro/compiler-runtime`; a completed-render
  criterion applies.
- Evidence: keep the D1 evidence row (Q3), keyed on the CAS tuple plus every dependency Document. HMAC receipt is
  evaluated after PR1. The Host Worker outside the container writes the row; the container holds no Core write
  credential and cannot submit evidence that would be trusted. The Host verifies that the record matches the correct
  route, preview instance and complete render. On save, Core still checks component identity and field eligibility,
  and in the same OCC/CAS batch checks the versions of the render's dependencies.
- Scope at first: default slot only. PR1 proves the recording in the real container.
- Source: `astro-runtime-provenance-design.md` (handoff, not in the repo) and its Codex review.

#### Q4: number, boolean and enum fields through a spread (deferred, owner decision 2026-11-28, option B)

- The owner approved Q4 = Yes earlier (v1, step B3). Codex later recommended deferring it. On 2026-11-28 the owner
  decided to defer (option B).
- Reason: `const props = { ...hero, count: 3 }; <Hero {...props} />` passes the single-spread veto when
  `hero.count` is already 3, and an absent key also needs positive binding evidence.
- The deferral covers only number, boolean and enum, and only for the Astro default slot through a spread.
- v1 first runs text (string), image, link and array to stability in the real container.
- Until the form-mode fallback is wired, the deferred types must explicitly route to jump-to-Code with a "controlled
  by code" label ("由程式碼控制"). They must never look editable (no fake editability).
- Acceptance (unverified): a number, boolean or enum field passed through a spread into the Astro default slot shows
  the label and a jump-to-Code action, has no input control, and never writes to the Document.
- `image` (media object), `link` and `array` are separate: all three are in v1 under exact binding (WeakMap plus an
  enumerable symbol tag, design section 1.4). So far this is verified only in read-only Node probes (design probes 2
  and 3); nothing is verified in the real container or browser.
- A source tag surviving a spread is only source-tracking evidence. Acceptance also requires that Design edits the
  correct field, the edit saves to the Document, and a reload reads the correct value.

### Uniform SDK (2026-11-27, plan approved 2026-11-28)

- One entry, `import { morph } from "@morph/sdk"`, for all frameworks. `@morph/sdk/start` and `@morph/sdk/astro`
  stay as compatibility aliases.
- Steps U1 to U6 as in `uniform-sdk-plan.md` (handoff): per-framework entry map, editor trust anchor, Starter
  change, docs, Astro resolution proof, and a deferred Starter rewrite.
- Order: native build, then SDK, then version ranges.

### Design fallback tiers

1. A source literal edits Source.
2. A declared CMS field edits the Document.
3. An ambiguous canvas element gets a form edit plus jump-to-code.

Partial degradation case (acceptance, unverified): on a page with a Server Island, blocks whose source can be
confirmed independently stay editable; blocks with an unclear source fall back to the declared-field form or jump to
Code.

### Cloud publish acceptance

Passes only when one fixed SHA completes publish A, publish B and rollback to A, with the storefront URL reading the
matching version at each step. Until then it is not passed.

### Evidence references

Open-source references used in briefs: Vite `plugins/worker.ts`, Onlook, Sanity visual-editing and comlink,
LavaMoat, Puck (list in handoff `oss-references.md`; shallow research, verify before relying).
