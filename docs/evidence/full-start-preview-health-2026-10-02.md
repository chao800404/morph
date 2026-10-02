# Start preview health and Sandbox loading follow-up

Prototype only, for draft PR #86. This is not approval to replace the client preview or deploy production.

## Changes

- Start's platform-owned Worker responds to `GET`/`HEAD /__morph_preview_health` with 204, `Cache-Control: no-store`, and the workspace preview id. Other methods return 405. It does not invoke a Theme loader.
- Address probing requires the matching id for Start. SDK `INVALID_TOKEN` and `STALE_PREVIEW_URL` still classify as stale; a missing or mismatched id is unknown, not serving. This identifies the preview container, not a unique Vite boot generation, and is not an authorization boundary or evidence of hydration readiness.
- Start process readiness uses the same endpoint. Client preview retains its existing base path.
- The prototype's dev request-restoration module uses the existing `keepImport` helper. Request state and credentials are not cached.
- Sandbox E2E runs seed a fresh actor id. Since preview identity includes the actor, fixed store/theme fixture ids no longer reuse another run's preview DO.
- The bridge source generator also synchronized the existing overlay-ownership source change into its generated workspace copy. The generated file was not edited manually.

## Evidence and limitations

An initial attempt was contaminated by running repository tests alongside the dev server: temporary build files triggered Vite reloads. It is not a usable comparison.

The subsequent isolated run with health fixed but the prototype's bare dev import unchanged failed Design selection. Health probes returned 204/serving. The trace showed modules continuing to complete; the requests with status -1 had only recently begun before test teardown. Direct container requests to sampled modules returned 200 in milliseconds. This does not establish a Vite deadlock.

After retaining the dev restoration module, the same isolated Sandbox command passed 4/4 tests (auth setup, transport precondition, plain-container selection, and health), with unchanged timeouts. In the selection trace, sampled bridge dependency requests completed in roughly 0.16–0.43 seconds, versus roughly 1.3–2.1 seconds in the earlier run. This is one local comparison, not a latency benchmark or proof that every Sandbox failure is resolved.

Health is tested independently of Design bridge readiness. The test waits for the real iframe address rather than accepting the initial about:blank body.

No production deployment, remote migration, main change, or removal of pre-existing containers was performed. Newly created test proxy containers were identified by this run's DO records before removal.

Cloudflare verification and the full Start Sandbox acceptance suite remain separate gates. Native framework dependency exclusions, authentication, source/version guards and the preview egress policy were not relaxed.

## Validation

- `pnpm typecheck`: passed on the final implementation.
- `pnpm build`: passed, including client/server boundary and deploy artifact secret guards.
- `pnpm test`: 548 files passed, 1 skipped; 4235 tests passed, 1 skipped.
- Focused health/readiness tests: 87 passed.
- `node --test scripts/run-editor-e2e.test.mjs`: 3 passed.
- Real Sandbox targeted E2E: 4 passed, 0 failed. The first isolated comparison had 2 passed and 2 failed (selection readiness plus the test's initial about:blank evaluation race).

These results do not replace the remaining full-suite and Cloudflare acceptance gates.
