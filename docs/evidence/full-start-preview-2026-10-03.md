# Full Start preview: bounded integration fixes, 2026-10-03

This is prototype evidence, not authorization to merge or deploy. No remote
Cloudflare resource or migration was changed. The original DOM-derived editor
tree, authorization, revision checks and publication path remain in place.

## Changes and evidence

- Both preview runtimes answer the same platform-owned health endpoint,
  `/_morph/preview-health`. GET/HEAD return 204, `no-store`, and the running
  workspace's preview identity. A successful probe requires that identity.
  The probe no longer chooses a path from a later request's runtime setting.
- Retry only Vite module GETs when the SDK returns the exact plain-text 500
  `Proxy routing error`: at most two retries, after 100 and 250 milliseconds.
  Never replay documents, API requests, server functions, writes, or SVGs.
  The error-body inspection is size/time bounded. This is recovery, not a
  claim that the underlying SDK runtime interruption has been fixed.
- A CSS payload's `vite:afterUpdate` no longer acknowledges an entire source
  revision before its subsequent component payload completes. The existing
  HTTP HMR queue acknowledges after applying the full returned batch. A
  controlled promise test fails with the old listener and passes without it.
- The new-page E2E waits for that route's actual source marker before counting
  sections; an old home-page marker is not evidence that navigation finished.
- Text promotion explicitly synchronizes the file returned by its successful
  source write, using the existing version-checked preview sync path. Saved
  database content is not proof that the running preview already holds it.
  The new planner test fails before this change. Untouched files still skip
  synchronization. No version or authorization check is bypassed.

## Dependency boundary

The prototype already had unrelated upgrades to Cloudflare Vite plugin 1.62.4
and Wrangler 4.146. Its typecheck generator refuses the mismatch with the
fixed Theme toolchain. Those package/lockfile changes were preserved.

Validation therefore uses an isolated worktree at prototype base `475373d`,
plus only these source/test fixes, with its frozen lockfile:
Sandbox 0.12.7, Cloudflare Vite plugin 1.50.0, Wrangler 4.118.0, Vite 7.3.5,
TanStack React Start 1.168.32 and React Router 1.170.18.
Do not describe fixed-toolchain results as validation of the dependency upgrade.

## Recorded runs

- Before the last text-promotion fix: typecheck, data typecheck and build pass;
  full unit suite: 4,256 passed, one skipped. Seven architecture guards pass.
- Fixed-toolchain real Sandbox / Start, five E2E specs:
  25 passed, three skipped, one failed (text promotion's new value did not
  appear). The trace shows promotion succeeded but no subsequent file sync.
  The three skips are old client-only known-gap assertions, not failed cases.
  Editor height, selection, undo, errorComponent, server functions,
  middleware, server routes, standalone cookies, navigation and HMR pass.
  PNG/SVG root paths and malicious SVG isolation in three browsers pass.
- After the text-promotion fix: planner unit tests 9/9 pass;
  real Sandbox text-promotion run 3/3 pass (includes auth and transport setup).
  The full earlier E2E suite was not relabeled as an all-green final run.
- Final client-only / sidecar control, editor, public root paths, SVG and text
  promotion: 13 passed, one skipped (the Sandbox-only malicious SVG test).
- Final source after the promotion fix: typecheck, data typecheck, build and
  seven architecture guards pass; full unit suite: 4,257 passed, one skipped.
  Client-only server values, sidecar deployment exclusion and deploy artifact
  secret checks pass. No tests were relabeled from a prior commit's results.

### Local evidence locations

- `/tmp/audit/full-start-20261003-final-sandbox.log`
- `/tmp/audit/pw-runs/full-start-fixed-final-20261003/` (including the failure)
- `/tmp/audit/full-start-20261003-promotion-fix.log`
- `/tmp/audit/pw-runs/full-start-promotion-fix-20261003/`
- `/tmp/audit/full-start-20261003-client-control.log`
- `/tmp/audit/full-start-20261003-final-typecheck.log`
- `/tmp/audit/full-start-20261003-final-typecheck-data.log`
- `/tmp/audit/full-start-20261003-final-test.log`
- `/tmp/audit/full-start-20261003-final-build.log`

The last two test containers were removed only after matching their exact IDs
to these runs' cleanup records. No pre-existing container was removed.

Logs and independent traces are under `/tmp/audit/` and are local ephemeral
evidence, not durable CI results. No test timeout was increased.

## Still not proven / not part of these fixes

- `check:theme-runtime-wiring` remains PENDING: deployment configuration lacks
  the Theme Worker binding. There was no Cloudflare deployment or cloud test.
- Embedded cross-site preview still cannot promise default Lax-cookie parity;
  standalone preview is the cookie compatibility acceptance surface.
- Cloud resource budgets, network enforcement, control-service authorization,
  cross-preview cookie isolation and scoped preview APIs remain separate gates.
- Public text-format support and Design labeling of server-only endpoints are
  separate roadmap work; these fixes do not mean all native Start features
  are supported without platform restrictions.

## Updated-toolchain acceptance (2026-10-03, separate from earlier runs)

This section supersedes no historical failure. Current local prototype uses
Wrangler 4.146.0 and Cloudflare Vite plugin 1.62.4, with Sandbox 0.12.7 and
Vite 7.3.5 unchanged. The fixed toolchain contract and generated dependency
files were updated through the existing generator, not hand-edited.

### Props received before hydration

SSR content and sidebar structure can be visible before the Start Router and
editor bridge are installed. A diagnostic showed a valid, authenticated
update-section-props message arriving while the Router was still undefined.
The existing content snapshot now receives these early messages through the
existing validated channel; it does not mutate the DOM before hydration.
After bridge installation, the early listener is removed and the Router is
invalidated if early content changed. Subsequent props refreshes coalesce
through the existing Router, preserving selection and structure reporting.

A controlled generated-client VM test covers the pre-hydration ordering and
invalid senders. A separate bridge test covers coalescing and awaiting Router
invalidation. An earlier diagnostic run included a source edit during its
execution and was stopped; it is not an acceptance pass.

### Fixed-source checks

- `pnpm typecheck`, `pnpm typecheck:data`, and `pnpm build`: passed.
- `pnpm test`: 548 files passed, one skipped; 4,259 tests passed, one skipped.
- Ten architecture guards passed. `check:theme-runtime-wiring` remains
  PENDING due to the missing production Theme Worker binding.
- Real Sandbox Start compatibility: 14 passed, three skipped. Those skips
  are the client-only known-gap assertions, with positive Start coverage.
- Compatibility source fingerprint was identical before and after the run:
  `e96ac61a614a353a4ac21811c1813e173447d96e4b5083bfa8c9ae646087421a`.

Logs: `/tmp/audit/start-final-{typecheck,typecheck-data,unit,build}-20261003.log`,
guard results: `/tmp/audit/start-final-guards-20261003/results.json`,
compatibility evidence: `/tmp/audit/start-final-preview-20261003/compat.json`.
Real Sandbox Start Design/assets acceptance: 14 passed (editor, public root
paths, normal SVG, malicious SVG isolation, and text promotion). Source
fingerprints before and after were identical to the compatibility run above.
Evidence: `/tmp/audit/start-final-preview-20261003/design-assets.json`.
Both runs removed only their newly created, identity-matched proxy containers.
Final client-only / sidecar regression acceptance: 13 passed, one skipped
(the malicious-SVG test explicitly requires Sandbox transport).
Log: `/tmp/audit/start-final-client-control-20261003.log`; independent traces:
`/tmp/audit/start-final-client-control-20261003-traces/`.
The temporary default Start environment flag was removed before this control
run. The runner stopped its own sidecar/dev server and removed its temporary
state directory. No product source changed during this run.

### Published acceptance remains blocked (not a Start build failure)

`/tmp/audit/start-final-published-20261003/` contains one failed test, two
passed setup tests, and nine tests not run. The edited props visibly updated
and both Theme builds succeeded, but no publish server-function call occurred.
The existing UI waits 30 one-second build polls and returns before these
roughly 36–39 second builds finish. A later Publish click creates another
build rather than using a completed build that the UI never adopted.

The source fingerprint was unchanged throughout this run. Do not claim the
remaining storefront assertions passed: they were not executed. Fixture
preparation now uses the existing authenticated Code API from the dashboard
without unnecessarily starting an editor preview. This test change does not
fix product preview startup concurrency.

Publishing wait/continuation is separate follow-up work. No publish code,
authorization, OCC guard, or wait limit was changed to make this suite green.
No Cloudflare deployment, commit, push, or merge is part of this acceptance.

### Subsequent independently scoped publish-wait correction

After explicit authorization to fix the publish wait, the existing waiter
was changed to follow the same build until settled or cancelled. Final-source
Sandbox published acceptance passed all 12 tests, with one build and one
publish call roughly 37 seconds apart. The earlier failed run above remains
historical evidence, not a current unresolved wait defect.
See `publish-build-wait-2026-10-03.md` for exact scope, fixed-source validation,
fingerprint and independent traces. No E2E assertion or timeout was loosened.
