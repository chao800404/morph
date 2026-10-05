# TanStack Start Theme compatibility inventory

Baseline: main `d16850e`, 2026-10-03. Target is installed React Start 1.168.32
/ Router 1.170.18 on Workers, not every later API or arbitrary Node.js code.

## 2026-10-05 real local Sandbox advanced preview acceptance

- Feature branch `codex/start-sandbox-acceptance`, based on main `8001302`.
  Runtime is explicitly Start, transport is `cloudflare-sandbox`, and each run
  uses a disposable local database and a dedicated fixture user. No Cloudflare
  deployment or remote resource mutation is involved.
- First run: 6 passed, 1 failed, 19 not run. Disabled SSR hydrated, but the
  following data-only SSR document did not hydrate. The trace records SDK
  runtime interruptions and 500s for a TSX module, Start's extensionless client
  entry and its stylesheet while health probes continued to return 204.
  Log: `/tmp/morph-native-sandbox-20261005.log`; trace directory:
  `/tmp/morph-native-sandbox-20261005`.
- The existing bounded SDK routing-error recovery omitted the exact Start
  client-entry and stylesheet paths. Two new unit cases fail before the fix;
  all 31 proxy-response tests pass after it. Only GET asset reads are added;
  body matching, two retries and delays are unchanged. Server function validator
  IDs, unknown virtual IDs, API routes and POSTs remain ineligible.
- Full rerun: 23 passed, 3 skipped, 0 failed (5.2 minutes), including custom
  serialization, deferred data, custom client/server entries, selective SSR,
  raw Response, multipart upload, streaming, middleware, cookies, navigation
  and Code-save HMR. Log: `/tmp/morph-native-sandbox-20261005-fixed.log`;
  output: `/tmp/morph-native-sandbox-20261005-fixed`.
- SDK interruption diagnostics still occurred in the passing run. This is
  acceptance of the current source, not proof that platform interruptions are
  eliminated or that every interruption is recoverable: the first run also
  failed a TSX request already eligible for bounded recovery. Cloudflare
  deployment acceptance remains separate.

## 2026-10-05 advanced published storefront browser acceptance

- The existing published spec now also checks custom server-renderer markers,
  the client entry running exactly once across navigation, custom serialization
  in hydrated loader data and browser GET/POST, a deferred shell before explicit
  release, and disabled/data-only SSR before and after browser hydration.
- First run: 9 passed, 1 failed, 5 not run. The new deferred test observed its
  shell but used Node's APIRequestContext for the release request, which cannot
  resolve `native-compat.localhost`. It failed with `ENOTFOUND` before sending
  the request. This is a test implementation error, not a product streaming
  failure. The release now uses the shopper page's same-origin browser fetch.
  Original output: `/tmp/morph-native-published-advanced-20261005`.
- After correcting the browser release request, the second run still has
  9 passes, 1 failure and 5 not run. Its trace shows the Core document first
  responds after the fixture's 30-second timer expires; the release endpoint
  then returns `{ released: false }`. This remains a real acceptance failure,
  not a green result. Output:
  `/tmp/morph-native-published-advanced-20261005-fixed`.
- Diagnostic direct-Worker browser comparison with default encoding fails to
  observe the pending shell; explicit identity encoding passes that direct
  comparison. Requesting identity only in the browser still fails through
  Core. Outputs: `/tmp/morph-native-published-deferred-compare-20261005` and
  `/tmp/morph-native-published-deferred-identity-20261005`. The temporary
  comparison case and browser encoding override are removed afterwards.
- The existing local-direct transport explicitly requests identity bytes from
  its upstream Wrangler Worker. It does not consume/buffer the body, change
  the shopper request or modify production service-binding negotiation. The
  new local transport assertion fails before the change; the transport and
  proxy test files pass all 66 cases after it.
- With ordinary browser settings, the next run observes the pending shell and
  successfully releases the value. Its result assertion fails immediately
  because two result elements exist at that instant (9 passed, 1 failed,
  5 not run). The saved DOM trace identifies the second element beneath React's
  hidden `S:0` streamed segment, while the hydrated main page has a visible
  result. The test waits for hydration and requires exactly one visible result
  before inspecting text and no visible pending shell; it never selects the
  first duplicate or requires removal of React's hidden transport markup.
  Output: `/tmp/morph-native-published-advanced-20261005-stream-fix`.
- The subsequent whole-spec run passes all 15 tests (1.8 minutes), including
  first publish without a Design edit, custom entries, serialization, deferred
  streaming, browser server functions and storefront-owned assets. Output:
  `/tmp/morph-native-published-advanced-20261005-final`. The final visible-result
  assertion was edited during that run, so a frozen-source rerun is required
  rather than treating this result as final-source acceptance.
- Frozen final-source whole-spec rerun: 15 passed, 0 failed (1.8 minutes).
  Ordinary browser encoding is unchanged. Output:
  `/tmp/morph-native-published-advanced-20261005-final-source`; log has the
  same basename with `.log`. The spec performs its own R2 artifact/manifest
  verification before starting the built Worker, even though the outer runner
  reports no separate publish handoff to verify. This is a real local Sandbox
  build and local publish through Core, not Cloudflare deployment acceptance.

## 2026-10-05 repository-wide validation of this increment

- `pnpm typecheck`, `pnpm typecheck:data`, `pnpm test`, `pnpm build`,
  `pnpm check:e2e-assertions`, `pnpm check:bundle` and
  `pnpm check:deploy-artifact` completed successfully in one chained run
  (exit 0). The console output was truncated; no exact full-suite test count
  is inferred from the captured output.
- `git diff --check` passes. Generated files are unchanged, and the main
  checkout remained clean at validation time. Validation ran in the feature
  worktree before submission; it did not deploy or mutate remote resources.
- Local acceptance does not enable Start by default, grant arbitrary package
  or binding access, implement scoped preview store APIs, or validate remote
  Cloudflare deployment. Those product and deployment gates remain separate.

## Existing acceptance

| Capability                                      | Start Live Preview       | Built Worker / local published storefront |
| ----------------------------------------------- | ------------------------ | ----------------------------------------- |
| SSR loader calling a GET server function        | Recorded pass            | Recorded pass                             |
| Client GET/POST server functions, thrown errors | Recorded pass            | Recorded pass                             |
| Function and global request middleware          | Recorded pass            | Recorded pass                             |
| JSON/text/redirect server routes                | Recorded pass            | Recorded pass                             |
| HttpOnly cookie helpers                         | Standalone recorded pass | Recorded pass                             |
| Link navigation / Code-save HMR                 | Recorded pass            | Navigation recorded pass                  |
| Public raster/SVG root URLs                     | Recorded pass            | Recorded pass                             |
| DOM-derived Design selection / props            | Recorded pass            | Not a production editing capability       |

Recorded passes refer to the committed October 3 evidence and native-compat
fixtures, not fresh tests run for this inventory. Cloud deployment remains
unverified. Start is opt-in; default client-only preview retains server gaps.
Cross-site editor iframe Lax cookies remain different from standalone preview.

## Remaining local work

1. **Public data text (implemented by this change).** Validated
   TXT/XML/JSON/webmanifest uploads and Monaco creation/editing use the existing
   bytes endpoint and saveThemeBinaryFile. Bytes remain immutable revision
   references, not raw public text rows. The editor reads one file on demand,
   keeps its scoped draft, and sends the existing file ID/version and source
   generation on updates. Public drafts do not enter the source-only preview
   synchronization path; only validated, saved bytes reach the preview.
   Local browser create/edit/save/reopen acceptance passed on 2026-10-04.
   Cloudflare acceptance remains separate from local authoring acceptance.
2. **Server-only routes in Design (implemented by this change).**
   The existing registry marks positively identified handler-only routes.
   Design lists them as Code-only endpoints, without page preview/deletion;
   opening their source does not navigate the canvas or select a template.
   Combined component/handler routes and lazy/component companions remain pages.
   Spreads, computed options and unresolved option objects conservatively retain
   existing page behaviour; this does not execute Theme code to resolve them.
   No second registry or new write/delete path is introduced.
3. **Initial publish without a Design edit (existing and new static routes).** Explicit
   publication preparation materializes the existing selected and layout
   Documents through the normal revision writer and source/draft CAS. Reads
   remain non-mutating; an existing draft is never replaced or rebased by this
   preparation. Newly introduced static source routes use the existing
   ensureRouteTemplate path before preparation, rather than publishing the
   temporarily borrowed home template. Full local Sandbox build/publish/Core
   storefront acceptance is recorded below. Cloudflare deployment remains
   outside this acceptance.
4. **Expanded transport coverage (layer-specific acceptance below).**
   Raw Response, multipart/FormData and streaming now have native fixtures.
   Dynamic server routes and route middleware have explicit shared fixtures
   (see the layer-specific acceptance below). Serialization
   adapters, deferred data and tsconfig aliases have shared native fixtures
   (see advanced acceptance below). Conventional custom server entry wiring
   is corrected on this branch (local acceptance recorded below);
   route-level selective SSR passes HTTP acceptance. Browser client-entry and
   selective-SSR acceptance are recorded separately below. Untested options
   do not automatically mean unsupported.
5. **Package/config capability.** Packages are approved/fixed; build settings
   platform-owned. Arbitrary npm installs, custom Vite config or Cloudflare
   bindings are not a current native project-import promise.
6. **Preview data / external APIs.** HTTP/HTTPS egress is denied. Scoped APIs,
   allowlists and diagnostics remain work; do not remove this security policy.
7. **Default switch.** Keep runtime opt-in until roadmap opening gates pass.
8. **Local `.server` imports in native handlers.** Start Live Preview, formal
   builds and Code diagnostics permit static imports used exclusively inside genuine Start
   server boundaries. Permanent tests reject client rendering, side effects,
   dynamic imports (including mixed static/dynamic imports), re-exports, fake
   factories and server files used as client roots. The paired server graph
   still checks the helper's own dependencies. A real local Start/workerd test
   executes the helper via a generated server-function URL and verifies its
   implementation is absent from the transformed client route.
   Direct browser HTTP requests for `.server` modules, raw source and source
   maps are refused before Vite serves them. This also prevents inline maps
   from exposing the original helper through `sourcesContent`; internal SSR
   module-runner transforms remain available to execute server functions.
   Formal builds now run the native Start client compiler for the static
   preview artifact as well as the runtime client. Neither browser artifact
   contains the helper's private sentinel, which remains in the server bundle;
   the built Worker executes the helper through its generated function URL.
   The generated Sandbox config is separately exercised through the real Vite
   CLI. Uncompiled legacy Live Preview remains strict and cannot execute server
   functions; runtime selection remains opt-in. Dynamic `.server` imports are
   still deliberately refused by Morph's conservative usage analysis. These
   tests are local evidence, not Cloudflare deployment acceptance.

## Advanced Start acceptance (2026-10-05, local)

- Ordinary Theme files register a `createSerializationAdapter` in `src/start.ts`,
  define a class with a prototype method, and import both values and server
  functions through a Theme-owned `tsconfig.json` alias. The same fixtures run
  in the actual Start dev server and the built Worker, not a mock runner.
- SSR checks the custom type's method, its hydration adapter invocation and
  the Start-generated GET function's serialized reply. Browser acceptance
  additionally checks loader hydration, a GET returning the revived class,
  and a POST sending that class back to the server, where `instanceof` and its
  method must still work. Merely rendering the SSR text is not sufficient.
- A loader returns an unresolved promise rendered by `Await`. HTTP acceptance
  must read the shell/fallback before explicitly releasing the promise through
  a fixture-only endpoint. Browser acceptance must see the fallback without
  the result, then see the result and the hydrated component after release.
  Timeout fails rather than automatically completing the promise.
- HTTP streaming acceptance uses a browser User-Agent and identity encoding.
  The first attempt used Node's User-Agent; the pinned Start renderer treats
  that request as a bot and waits for `allReady`. Its timeout was a harness
  mismatch, not evidence of broken deferred data. Compressed delivery and
  crawler rendering are not claimed by these assertions.
- A mutation removing only adapter registration initially exposed a weak
  SSR-text assertion: rendered text survived while dehydration failed. The
  assertion was strengthened to check hydration and function transport; the
  same mutation then failed both the dev-server and built-Worker tests.
  Registration has been restored.
- Browser/local-sidecar acceptance passed four tests (authentication,
  transport precondition, custom serialization and deferred hydration).
  The final-source rerun also passed all four tests (1.9 minutes).
  Output: `/tmp/morph-start-advanced-browser-final`. This is not Cloudflare,
  real-Sandbox or published-storefront browser acceptance of these new cases.
- Final focused dev-server/built-Worker acceptance passed all 28 tests.
  Typecheck, data-layer typecheck, E2E assertion guard and build passed. Full-suite
  validation did not pass: 4,378 tests passed, three failed, one skipped. The
  three export-status tests have a fixed expiration timestamp that is now past;
  the same three failures reproduce on untouched main (10 other tests passed
  in that baseline run). Those files are unchanged by this increment.
  The user requested a separate test-clock fix on `codex/export-test-clock`,
  not mixed into this compatibility branch. Its focused 16 tests, typecheck,
  build, and full suite (4,380 passed, one skipped) pass. Expiry-boundary assertions
  remain enforced. This does not replace full-suite validation of a future
  combined revision after that independent fix is integrated.
  Logs: `/tmp/morph-start-advanced-{focused-final,full-test}.log` and
  `/tmp/morph-start-advanced-main-export-baseline.log`.
- The production runtime-wiring scanner's 15 tests pass, but the actual check
  still exits 1/PENDING: production `wrangler.jsonc` has no Theme Worker service
  binding. This is not a passed deployment gate.
- Platform runtime selection, external API restrictions, bindings and
  credential policy are unchanged. Custom server/client entrypoints and
  additional rendering options remain separate work; the follow-up below
  supersedes the earlier untested status for conventional entries/selective SSR.

## Entry and rendering follow-up (2026-10-05, local; initial red gate)

- Theme-owned `src/server.ts` uses the documented `createServerEntry` and
  `createStartHandler` with a custom callback delegating to `defaultStreamHandler`.
  It adds independent server-entry and renderer headers; SSR text alone cannot
  establish that the custom handler ran. HTTP acceptance requires those markers
  on the page, and the server-entry marker on an API route.
- The first focused run has two failures and two passes (28 other cases were
  deliberately excluded). Both entry assertions fail because the response lacks
  the Theme header. Both selective-SSR assertions pass. Log:
  `/tmp/morph-entry-red.log`. The platform-generated Wrangler main points to
  `@tanstack/react-start/server-entry` for builds, and the preview wrapper imports
  the same default handler. This does not execute the conventional Theme handler.
  The full focused rerun is 30 passed and two failed, both entry assertions;
  The final-source rerun has the same 30 passes/two entry failures;
  log: `/tmp/morph-start-entry-focused-final.log`. Typecheck and the E2E assertion
  guard pass. These failures remain visible rather than converted to green gaps.
- `ssr: false` must not run the loader during SSR or render its component;
  `ssr: 'data-only'` must run and serialize the loader but not render its component.
  The disabled fixture accesses `window` inside the page component. The
  data-only fixture emits a distinct server-render marker if wrongly rendered
  there. HTTP assertions distinguish loader execution headers, pending markup,
  serialized values and that forbidden component marker.
  Mutation controls switching SSR on fail in both execution layers. An earlier
  data-only control unexpectedly passed because throwing on `window` could
  leave a successful pending shell; the non-throwing marker strengthens that
  assertion. The same control then fails both tests. Logs:
  `/tmp/morph-start-selective-control.log`,
  `/tmp/morph-start-data-only-control.log`,
  `/tmp/morph-start-data-only-control-fixed.log`. Both original options are restored.
- `src/client.tsx` uses `StartClient` and `hydrateRoot`, marking readiness only
  after hydration. Browser tests check that the entry runs exactly once and
  client navigation preserves the document, and that both selective-SSR routes
  eventually show their loader data in the browser.
  The final browser/local-sidecar run passes four tests (two setup/precondition,
  two feature scenarios): `/tmp/morph-start-entry-browser-3`.
  Earlier results are retained: the first attempt stalled before an iframe
  appeared and did not run the feature scenarios; the second uncovered a
  test mistake expecting boolean `true` for the existing numeric document
  marker `1`, after client readiness/navigation had succeeded. That assertion
  is corrected; the initial iframe stall remains unexplained.
  After strengthening and restoring the data-only fixture, the final-source
  combined browser run passes all six tests (two setup/precondition, four
  feature scenarios): custom serialization, deferred data, client entry and
  selective SSR. Output: `/tmp/morph-start-entry-browser-final`.
- This increment is acceptance work, not a runtime fix. Production entry
  selection, security wrappers, egress and bindings are unchanged. No remote
  deployment or merge has taken place. Custom Vite configuration, alternate
  filename/configured entries, prerender/SPA mode and arbitrary render options
  are not claimed by these conventional-entry cases.
  No new full-suite/build pass is claimed for this follow-up: its focused
  entry gate is demonstrably red and requires a runtime fix before delivery.

Official conventions:
[Server entry](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point),
[Client entry](https://tanstack.com/start/latest/docs/framework/react/guide/client-entry-point),
[Selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr).

### Server entry wiring fix (2026-10-05, local; not deployed)

- The sandbox workspace and local build runner now select the conventional
  Theme server entry in Start resolver order, falling back to the package entry
  only when none exists. The preview still enters the platform-owned wrapper;
  that wrapper delegates to the selected handler. Health, HTML bridge injection,
  content snapshot and outbound refusal remain in the same wrapper.
- The entry list is shared with server import-protection roots. `.mts` is now
  traversed by that guard, rather than creating an executable unchecked entry.
  Tests cover each conventional extension refusing a `.client` dependency;
  alternate extensions have selection/guard coverage, not separate runtime
  acceptance. The real runtime fixture uses `src/server.ts`.
- The first implementation run exposed a second hard-coded default entry in
  the local build runner and a fixture mistake: `defaultStreamHandler` can return
  an SSR cleanup wrapper, not a plain Response. The fixture now sets the callback's
  `responseHeaders` before delegating, preserving the stream cleanup contract.
  No assertion was relaxed. First run: 108 passed/12 failed, retained in
  `/tmp/morph-server-entry-fix-focused.log`.
- After those corrections, focused tests pass: 121 tests across six files,
  including both actual custom-entry/renderer HTTP assertions, all existing
  native runtime cases and wrapper health for default/custom entries.
  Log: `/tmp/morph-server-entry-fix-focused-2.log`. One additional workspace
  wiring assertion was added after this run and will be covered by final checks.
- Browser/local-sidecar full native compatibility spec: 23 passed, 3 skipped,
  no failures, including actual Theme server-entry/renderer response headers,
  custom client entry, navigation, editor heartbeat and Code-save HMR keeping
  the document. Output: `/tmp/morph-server-entry-fix-browser`; log:
  `/tmp/morph-server-entry-fix-browser.log`. The setup took about 43 seconds
  to obtain its preview frame; this is retained as an observation, not a fixed
  performance issue. Runner stopped its sidecar/dev server and removed its
  temporary D1 state. No publish handoff occurred in this spec.
- Final typecheck, data-layer typecheck, E2E assertion guard and diff whitespace
  check pass. Full `pnpm test`: 4391 passed, 3 failed, 1 skipped. All six focused
  files pass in this full run (122 tests, including the final workspace assertion).
  The three failures remain the previously reproduced expired inventory/order/
  product export fixtures; their clock correction is isolated in a different
  worktree, not mixed into this change. Log: `/tmp/morph-server-entry-final-test.log`.
  This is not a full-suite green result.
- Delivery follow-up: the separate clock correction was committed as
  `cdb71f2` and merged by PR #95 (`27dd260`) after all six CI checks succeeded.
  With that correction as the base, `pnpm test` passes: 4397 passed, 1 skipped
  across 555 passing files and one skipped file. Log:
  `/tmp/morph-start-merge-green-test.log`. The earlier red results above remain
  historical evidence, not the final delivery status.
  After updating to that merged base, typecheck, data-layer typecheck, the E2E
  assertion guard and build were also rerun successfully. Logs:
  `/tmp/morph-start-merge-{typecheck,data,assertions,build}.log`.
- `pnpm build` passes, including client-bundle, sidecar-exclusion and deploy
  artifact secret guards. Log: `/tmp/morph-server-entry-final-build.log`.
  Runtime wiring was rerun: the 15 scanner tests pass, but the actual gate
  still exits 1/PENDING because production has no Theme Worker service binding.
  Log: `/tmp/morph-server-entry-final-wiring.log`. This is not a live runtime.
  No cloud deployment, commit or merge is claimed here. Scoped external APIs, arbitrary
  configured entry locations and Cloudflare bindings remain outside this fix.

## Code-only full publish acceptance (2026-10-05, local Sandbox)

- The missing-row regression was reproduced before the fix: Publish handed
  off a build but created no document for the selected new static Code route.
  An earlier test attempt waited for a sortable Design row absent from this
  source-only page; that readiness failure is not product evidence.
- Publish now ensures that route's own document through the existing
  authenticated route-template writer, then prepares it and the layout through
  the existing initial-revision path. The borrowed home document is not
  prepared in its place. Source/draft/release CAS and immutable build checks
  remain in force; no alternate storage, build or publication API is added.
- Publish intent is bound to store, Theme and the selected route. Replacing
  a borrowed template id with that route's real id does not abandon the
  attempt; switching between different source-only routes does. Three unit
  regressions cover these identities. DAL acceptance additionally verifies
  an untouched source-derived Hero document, actor attribution and release
  publication without a Design content write. The initial assertion expecting
  zero sections was corrected because that fixture declares a Hero.
- Local-sidecar first-publish preparation: four tests passed, including the
  existing-template and missing-route-row scenarios plus runner setup. Builds
  are deliberately aborted in that layer; it is not full publication proof.
- Full local Sandbox acceptance uses the ordinary Code save/upload APIs and
  clicks Publish directly, with neither a Design edit nor a manual build.
  The first complete run passed all 12 tests (including runner setup), with
  exactly one build and one publish request. The build took about 49 seconds,
  so the UI demonstrably waited beyond the former 30-second boundary.
- The suite reads the published artifact back from the run's local R2,
  verifies its manifest, starts the built Theme Worker and serves it through
  Morph Core on a local storefront hostname. It checks SSR, browser GET/POST
  server functions, middleware, HttpOnly cookies, errors, navigation, public
  bytes and platform/static-file separation. This is a real container build
  and local publication, not a deployment to Cloudflare.
- Final Sandbox rerun also passed all 12 tests (zero failures/skips), including
  a window sentinel proving that shopper Link navigation does not reload the
  document. Final output: `/tmp/codex-start-publish-sandbox-final-results`;
  log: `/tmp/codex-start-publish-sandbox-final.log`. The spec itself runs the
  artifact verifier; the runner's separate handoff verifier is not invoked.
- Logs and test outputs are separate `/tmp/codex-start-publish-*` paths.
  Full repository validation passed: typecheck, data-layer typecheck,
  E2E assertion guard, 4,377 tests (one existing
  skip), and production build including client-secret, sidecar-exclusion and
  deployment-artifact guards. The initial typecheck found two test-only
  literal browser-import paths; these now use the existing variable-path
  import pattern, and the whole validation chain was rerun successfully.
  Preview runtime remains opt-in. Production wiring, cloud isolation/capacity,
  external API policy and APIs not exercised by this fixture remain separate
  gates; this evidence does not claim all native Start functionality.

## Code-only initial-publish acceptance (2026-10-04, local)

CI integration correction: the initial-publish browser case now creates a
unique Theme in the runner-owned throwaway database. Starter source and
Documents are provisioned by the existing editor path, not copied/reset from
the suite's shared Theme. The old case's null-revision precondition was wrong
after preceding Design tests had created revisions. Both its standalone run
(3 passed) and a run after the landed Design-content-write case (4 passed)
passed locally; logs: `/tmp/codex-pr91-isolated-{e2e,order}.log`.

- DAL acceptance preserves the untouched Document and its nested values,
  records the authenticated actor, and publishes through the existing
  release/publication path. Seven regressions include stale source/draft
  generations, wrong-store ownership, an already prepared draft, and source
  or draft changes between the context read and atomic write. Rejected writes
  create no content revision. Focused DAL suite: 60 passed.
- Browser/local-sidecar acceptance uses only the normal Code save API, then
  Publish. Both selected and layout Documents acquire initial revisions;
  their contents are unchanged. The build request is intercepted before the
  server receives it, and no publish request or active release is created.
  This proves initial preparation and build handoff, not a completed build,
  deployment, or full browser publication. Run: 3 passed including setup and
  transport; `/tmp/codex-initial-publish-e2e-3.log`.
- Two earlier runs failed before confirmation: React's update-depth limit
  was reached in Radix FocusScope/ref composition. A hydration-timing guess
  was withdrawn after the second trace. Popover was updated from 1.1.15 to
  1.1.23 with its required dependencies; React/Start/Cloudflare versions are
  unchanged. The real Publish confirmation then passed. A permanent shared
  Popover test checks stable refs through 20 open-content updates and Escape.
  An old-version-only control fails that ref assertion (40 detach/attach
  calls); the new version passes. This unit control detects ref churn, not
  the entire browser crash by itself. The new version was restored afterward.
  Upstream cause/fix: [Radix #3967](https://github.com/radix-ui/primitives/pull/3967).
- Lost preparation responses stop this attempt and invalidate editor context;
  they are not automatically replayed, and no unconfirmed revision is used
  for publication. Existing publish requirements and post-build checks remain.
- Repository-wide tests: 554 files passed, 1 skipped; 4,373 tests passed,
  1 skipped. Production build passed, including client-secret,
  sidecar-exclusion and deploy-artifact secret guards. Data-layer typecheck,
  E2E assertion guard and `git diff --check` passed. Logs:
  `/tmp/codex-initial-publish-{full-test,build,data,assertions}.log`.
  Final `pnpm typecheck` was rerun after all test additions and passed:
  `/tmp/codex-initial-publish-final-typecheck.log`.

## Native dynamic-route acceptance (2026-10-04, local)

- Ordinary Start fixture files define a named `$id` parameter and a `$` splat,
  route-wide request middleware, GET-only handler middleware, and POST JSON.
  The same files run through the actual Start dev server and built Worker.
- Assertions check global/route/handler middleware composition and context,
  an early 403 that never reaches the handler, HEAD's GET fallback without a
  response body, and an explicit `ANY` handler returning 405. The installed
  Start version falls through to page rendering for an undefined method;
  automatic 405 is not a platform compatibility promise.
- Browser acceptance is a separate test using the Code save API and preview
  iframe; the local-sidecar run passed (three tests including authentication
  and transport setup). This section does not assert parent-route middleware inheritance,
  breakout routes, Cloudflare deployment, or arbitrary future Start APIs.
- Full repository tests passed: 4,362 tests, one existing skip; both native
  compatibility suites are included (14 built-Worker tests and 10 Start dev
  server tests). Typecheck and data-layer typecheck also passed.

## Native server-helper acceptance (2026-10-04, local)

- The five original boundary cases are permanent tests: genuine static
  handler use is accepted only with native compilation; client rendering,
  side-effect imports, dynamic imports and server files used as client roots
  remain rejected. Mixed static/dynamic use and the paired server dependency
  graph have additional regressions.
- Both built browser artifacts exclude the helper sentinel; the built Worker
  executes the helper. Removing the static artifact's Start compiler makes
  the sentinel assertion fail (the mutation was restored).
- A direct `.server` HTTP request exposed the original helper through inline
  source-map `sourcesContent`. Platform Vite middleware now refuses module,
  raw and map URLs before serving them. The real Start preview still executes
  the helper, and its direct-source regression passes.
- Full local tests: 553 files passed, 1 skipped; 4360 tests passed, 1 skipped.
  Typecheck, data-layer typecheck and E2E assertion guard passed.
  Production build and client-secret/sidecar/deployment-artifact guards passed.
- A browser rerun under simultaneous validation load exceeded the transport
  precondition's 60-second budget before the helper scenario ran. Its trace
  remains in `/tmp/codex-start-helper-e2e-guard-results`; this is not counted
  as browser acceptance for the HTTP-boundary change.
- A subsequent standalone browser/local-sidecar run passed 3 tests (setup,
  transport precondition and the hydrated-client helper scenario), recorded in
  `/tmp/codex-start-helper-e2e-guard-idle-results`. The client button receives
  the helper's public result through Start. Test services stopped and the
  temporary runtime switch was restored. No real Sandbox or Cloud deployment
  acceptance was performed for this increment; runtime remains opt-in.

## Public data-text policy for this change

- TXT: valid UTF-8, no null bytes; empty files allowed.
- JSON: valid JSON; webmanifest additionally requires an object.
- XML: strict data XML, UTF-8 declaration; no DOCTYPE or processing instructions,
  SVG/XHTML/XSLT namespaces, or executable document elements; max depth 128.
  .xml cannot be another spelling of executable SVG/XHTML.
- Existing 5 MB/file, 50 MB/directory, 200 files, auth/OCC and static-route URL
  collision checks remain. No rewriting; server owns MIME. Publish rereads
  data-text blobs and checks digest, declared size and current format rules.
- Image/font signatures and validateSvg remain. Raw public/ text rows are still
  refused by saveFilesBatch and build materialization. Storage remains bytes
  with immutable references; this does not add a second storage or publish path.

## Design route-capability acceptance (2026-10-04, local)

Based on main `c927c57`, implemented in `codex/start-public-text`.

- Existing registry AST analysis identifies handler-only routes without path
  prefix heuristics. A component property (including methods/inline functions),
  lazy/component companion, or unresolved/spread/computed options preserves
  page behaviour. This is UI classification, not an authorization boundary.
- Pages search/count/list and the canvas path navigator exclude proven endpoints.
  Endpoints have a separate Code-only list, without page-delete controls.
  Their Code action skips page/template navigation; Code source editing and
  its existing permission/OCC/write paths are unchanged.
- `pnpm typecheck`, `pnpm test`, `pnpm build`: passed. Full suite: 552 files
  passed, 1 skipped; 4325 tests passed, 1 skipped. Build client-secret,
  sidecar-exclusion and deployment-artifact guards passed.
- Browser/local-sidecar: 4 passed (setup, transport assertion, public-text
  authoring/reopen scenario, endpoint/mixed-route scenario). Endpoint scenario
  verifies the two lists, absence of page deletion, canvas path-menu filtering,
  Monaco source opening and unchanged canvas route URL.
- No real Sandbox or Cloud deployment acceptance was run for this increment.
  Runtime remains opt-in and the production Theme Worker wiring remains a
  separate pending requirement. Main/user dev server was not changed.

## Validation of this increment (2026-10-03, local)

- `pnpm typecheck`, `pnpm typecheck:data`, `pnpm build`: passed.
- Final `pnpm test`: 548 files passed, 1 skipped; 4286 tests passed, 1 skipped.
  Includes real local Start preview (5 tests), built Worker (9 tests), and
  SQLite/R2-memory storage and frozen-revision checks.
- The first full suite failed one new MIME assertion: Vite serves XML as
  `text/xml`, whereas artifacts use `application/xml`. The preview assertion
  now accepts precisely those two XML types; exact bytes are still required.
  The full suite was rerun, not only that assertion.
- Build secret/artifact/sidecar guards passed. The XML validator's distinctive
  nesting error occurs in 0 client JS files and 1 server JS file.
- Local sidecar, E2E assertion, SQL timestamp, LIKE, generated-write, ship,
  migration and E2E-runner guards passed. Runtime wiring remains PENDING:
  production Theme Worker service binding is absent, as in the baseline.
- No browser upload E2E, real Sandbox acceptance or Cloud deployment was run
  for this increment. Do not infer their results from the local transport tests.

## Code public-text authoring acceptance (2026-10-04, local)

Based on main `c927c57`, implemented in `codex/start-public-text`.

- Final `pnpm test`: 552 files passed, 1 skipped; 4321 tests passed, 1 skipped.
- Final `pnpm typecheck`, `pnpm build`, `pnpm typecheck:data`: passed.
- New editor projection and HTTP-write tests cover UTF-8/CRLF/BOM preservation,
  lazy reads, workspace preservation, create scaffolds, auth refusal, OCC, and
  ambiguous failures. The XML validator's nesting error is in 0 client JS
  files and 1 server JS file in the final build.
- Real browser/local-sidecar run: 3 passed (setup, transport assertion, and one
  complete authoring scenario). The scenario creates public JSON through Code,
  edits Chinese content in Monaco, saves via the existing binary HTTP endpoint,
  verifies the digest and exact server bytes, then reopens the editor and reads
  the saved content in Monaco. It is not three separate feature scenarios.
- Initial browser failures exposed an adapter error: the shared text
  precondition carries `expectMissing: false`, while the bytes helper checks
  field presence. The adapter now sends only file ID/version for updates;
  its test asserts `expectMissing` is absent. OCC itself was not weakened.
- The reopen test initially clicked Code before the editor had attached its
  handlers. It now uses the existing `openEditor` readiness check and positively
  requires the Code explorer before opening the saved file.
- E2E assertion, SQL timestamp, LIKE, generated-write, migration, ship and
  E2E-runner guards passed. Runtime wiring remains PENDING because the production
  Theme Worker service binding is absent; PENDING is not a pass.
- Logs are separate `/tmp/codex-public-text-*.log` files. The failed reopen trace
  is retained under `/tmp/codex-public-text-evidence/run-5/`; the final run's
  output is `/tmp/codex-public-text-e2e-6.log`.
- No new real-Sandbox authoring acceptance or Cloudflare deployment ran in this
  increment. Preview external APIs, server-only Design classification, broader
  Start API coverage, initial publish and the default runtime switch remain
  separate work, not implied passes.

## Native transport acceptance (2026-10-04, local)

Based on main `c927c57`, implemented in `codex/start-public-text`.
Installed Start 1.168.32, Router 1.170.18, Vite 7.3.5, Wrangler 4.146.0.

- One ordinary Theme fixture extends the existing native-compat files. No
  alternate server-function runner, custom serialization protocol or storage
  path is introduced. Tests use Start-generated function URLs, not guessed IDs.
- Raw Response: status 206, MIME, a custom header and all four binary bytes are
  preserved. Multipart POST: Chinese text, repeated fields, filename, MIME,
  size and exact binary bytes are verified. Both pass in the local Start server,
  built Worker over HTTP, and browser calls inside the editor's Start iframe.
- Byte streaming: the first data is asserted before a fixture release endpoint
  can produce the remainder. Preview and built Worker HTTP tests pass, as does
  the browser. Browser typed ReadableStream transport also passes in preview;
  built/published browser typed-stream acceptance has not run.
- The built Worker HTTP streaming assertion explicitly requests identity
  encoding. With Node fetch's default compression negotiation, headers arrived
  but the tiny first chunk did not arrive before the test's 10-second deadline;
  changing only negotiation to identity made it pass. This is not proof of
  compressed streaming on Cloudflare, and no product compression setting was
  changed. Do not list the earlier timeout as a Theme handler failure.
- Fixture corrections: Node FormData is encoded to actual multipart bytes to
  avoid cross-realm objects in Wrangler's dispatch helper. The controlled
  stream has pending timer I/O so workerd does not treat an in-memory-only
  wait as a permanently hung request. Its timeout fails, never releases data.
- Server-handler fixture logic is absent from nonempty runtime/client JS and
  present in runtime/server JS. This assertion concerns the native runtime
  artifact, not the legacy client-only preview artifact.
- A proposed local `.server` guard relaxation was withdrawn after review:
  the legacy preview does not perform Start's server-code elimination. The
  product guard is unchanged; two known-gap tests record handler-only local
  imports still being refused. Negative tests retain component, side-effect,
  fake factory and re-export refusals. The transport fixture uses an ordinary
  helper module containing only fixture state, no private values.
- Focused runtime/guard tests: 38 passed. Browser/local-sidecar: 5 passed
  (setup, transport assertion, raw Response + multipart scenario, byte-stream
  scenario, typed-stream scenario). The final raw/multipart scenario also
  requires actual GET/POST replies at Start-generated URLs and the server's
  request-middleware header; browser-only execution cannot satisfy it.
  Independent output directory: `/tmp/codex-transport-browser-2/`;
  log `/tmp/codex-transport-browser-2.log`. The first passing run is retained
  separately under the `browser-1` paths. Passing runs retain `.last-run.json`,
  not a Playwright trace; no trace is claimed for these successful scenarios.
- Real Sandbox, the published storefront through Core, compressed production
  streaming and Cloudflare deployment were not exercised for this increment.
  The temporary preview runtime switch was restored; main and the user dev
  server were not changed. Final repository-wide results are recorded below.

- Final `pnpm test`: 552 files passed, 1 skipped; 4337 tests passed, 1 skipped.
  Final `pnpm build` passed, including client-secret, sidecar-exclusion and
  deployment-artifact guards. Full checks used the restored original product
  import guard, not the withdrawn relaxation.
- Final `pnpm typecheck`, `pnpm typecheck:data`, `check:e2e-assertions` and
  `git diff --check` passed after the browser network assertions were added.
  Repository logs are `/tmp/codex-transport-final-{test,build}.log` and
  `/tmp/codex-transport-verified-{typecheck,data,assertions}.log`.
- `check:theme-runtime-wiring` was rerun: its 15 scanner tests pass, but the
  actual production wiring check exits 1/PENDING because the Theme Worker
  service binding is absent. This is not a passed opening gate.

### PR #96 CI slow-frame test correction (2026-10-05)

- Run `37287644059`, head `dfe5644`, failed only the slow-frame progress
  scenario in shard 2. The retained trace shows two preview documents:
  09:10:39.863 and 09:11:10.946 UTC. Workspace tsconfig regeneration caused
  an app reload. The test released its bridge using the obsolete first frame's
  timestamp, then asserted Loading at 09:12:01.116 after the current frame had
  reached `ready` at 09:12:00.389 (zero automatic recoveries). This is a test
  timing defect, not evidence that the watchdog reloaded a progressing frame.
- The scenario now settles the workspace first, explicitly refreshes one frame,
  and holds the bridge behind a promise until the past-45-second assertions
  finish. It still requires exactly one measured document and no error alert.
  Releasing the gate also removes the artificial resource throttle; rendering
  and actual editor readiness are both checked afterwards. Product code and
  timeout policy are unchanged; this does not fix the startup config reload.
- The first local correction passed the deadline assertions but left the
  artificial throttle running during readiness verification. That failed run
  is retained at `/tmp/morph-pr96-frame-gate`. With the throttle released along
  with the bridge, both slow/progress and stalled/manual-retry scenarios pass:
  four tests including setup/transport, `/tmp/morph-pr96-frame-gate-v2` and its
  sibling `.log`. These runs used the actual Start runtime: the local Wrangler
  file still selected Start even though the test-process flag said client.
  The watchdog cases are shared, but this is not client-mode acceptance.
- Negative control: keeping `lastProgressAt` at zero reproduces the old fixed
  deadline. The corrected scenario fails its one-document assertion, observing
  a second document 45.664 seconds later. Two setup/transport cases pass and
  the feature case fails as intended; trace/log are retained at
  `/tmp/morph-pr96-frame-negative`. The watchdog file was restored and verified
  byte-for-byte against HEAD before normal testing resumed.
- Final local typecheck, full unit suite (4397 passed, one skipped), build and
  E2E assertion guard pass. Logs: `/tmp/morph-pr96-ci-fix-{typecheck,test,build,assertions}.log`.
  Full shard 2 and remote CI remain separate gates; their results are not
  assumed from the focused run.
- The first full shard rerun (`/tmp/morph-pr96-shard2-fixed`) had mismatched
  settings: test assertions selected client while Wrangler selected Start.
  It reports 21 passed, one failed, four skipped and 16 not run. The failure
  expected the legacy `getRequest` refusal while the screenshot shows a
  successful server-function result. The runner does not map the test-process
  flag to Wrangler's runtime setting. The agent corrected the local-only
  configuration for a separate aligned client run; no product change or
  assertion relaxation was made. The original setting is restored afterwards.
- Aligned client-mode full shard 2 passes: 25 passed, 17 skipped, zero failures
  in 8.7 minutes. Output `/tmp/morph-pr96-shard2-client-aligned`, sibling `.log`.
  Both the existing legacy refusal and corrected watchdog scenarios pass in
  the same run. The runner stopped its owned processes and removed temporary
  D1 state; the original local Start setting was restored. Skipped Start-only
  scenarios are not counted as client acceptance.

## References

- [Start server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes): combined handlers/pages; classify by capability, not folder.
- [Vite public directory](https://vite.dev/guide/assets#the-public-directory): root URLs and unchanged bytes; not Morph storage/security policy.
- [Streaming server functions](https://tanstack.com/start/latest/docs/framework/react/guide/streaming-data-from-server-functions): expansion checklist, not proof about the pinned version.
- [Workers Streams API](https://developers.cloudflare.com/workers/runtime-apis/streams/): runtime streaming mechanism, not deployment acceptance evidence.

See ROADMAP for cloud security/capacity gates. No deployment is part of this work.
