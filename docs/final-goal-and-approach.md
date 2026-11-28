# Final goal and implementation approach

Status: direction record, owner decisions of 2026-11-26 to 2026-11-28. Plans below are not yet implemented unless a
PR is named. Delivery order and per-feature status live in [`ROADMAP.md`](../ROADMAP.md) section 1.7; this file
records the goal and the reasoning rules the roadmap follows.

## Final goal

- Code is the main body of a Theme. Code mode never restricts how the author writes in the native framework.
- Design is a helper that lets non-coders change code and content. It never defines what a Theme may contain.
- Morph supports every Astro and TanStack Start rendering mode in preview, publish and the editor: SSR, streaming,
  selective SSR, SPA, SSG/prerender and ISR-equivalents.
- Each framework uses its own official Cloudflare setup. Morph invents no pattern of its own. Editor toggles only
  write the same official config through the existing source-write path (OCC).

Related: ROADMAP sections 1.2 and 1.6, [`docs/multi-runtime-theme-plan.md`](multi-runtime-theme-plan.md).

## Approach decisions

### Security boundary (decision A, 2026-11-28)

- The Sandbox container is the security boundary for untrusted Theme builds. In-build package checks are defence in
  depth only.
- Managed Start disables inline PostCSS and refuses a Theme PostCSS config with `THEME_POSTCSS_CONFIG_UNSUPPORTED`.
- Native Astro runs the author's config as the framework officially allows.
- Planned, not implemented: the build container runs fully offline (no allowlist), each retry gets a fresh
  container, and `--ignore-scripts` gates any future dependency install.

### Astro default slot (direction B, 2026-11-28)

- Runtime render recording replaces static proof. Static analysis stays as lint only.
- Design: a preview SDK tags values; a recorder runs through an aliased `astro/compiler-runtime`; a completed-render
  criterion applies; a server-side evidence row is keyed on the CAS tuple plus every dependency Document.
  Whether the receipt is an HMAC or a D1 row is decided after PR1.
- Scope at first: default slot only. PR1 proves the recording in the real container.
- Source: `astro-runtime-provenance-design.md` (handoff, not in the repo) and its Codex review. Open: the Codex
  review recommends deferring non-string fields passed by spread (Q4), which differs from the earlier owner
  recommendation; this is not yet re-decided.

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

### Evidence references

Open-source references used in briefs: Vite `plugins/worker.ts`, Onlook, Sanity visual-editing and comlink,
LavaMoat, Puck (list in handoff `oss-references.md`; shallow research, verify before relying).
