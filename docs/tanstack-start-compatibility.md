# TanStack Start Theme compatibility inventory

Baseline: main `d16850e`, 2026-10-03. Target is installed React Start 1.168.32
/ Router 1.170.18 on Workers, not every later API or arbitrary Node.js code.

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
3. **Initial publish without a Design edit (existing template rows).** Explicit
   publication preparation materializes the existing selected and layout
   Documents through the normal revision writer and source/draft CAS. Reads
   remain non-mutating; an existing draft is never replaced or rebased by this
   preparation. Layer-specific local acceptance is recorded below. Newly
   introduced source-only routes without a template row remain outside this
   acceptance, as does Cloudflare deployment.
4. **Expanded transport coverage (layer-specific acceptance below).**
   Raw Response, multipart/FormData and streaming now have native fixtures.
   Dynamic server routes and route middleware have explicit shared fixtures
   (see the layer-specific acceptance below). Serialization
   adapters, deferred data, custom entries, aliases and rendering options need
   explicit fixtures in applicable layers. Untested does not mean unsupported.
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

## References

- [Start server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes): combined handlers/pages; classify by capability, not folder.
- [Vite public directory](https://vite.dev/guide/assets#the-public-directory): root URLs and unchanged bytes; not Morph storage/security policy.
- [Streaming server functions](https://tanstack.com/start/latest/docs/framework/react/guide/streaming-data-from-server-functions): expansion checklist, not proof about the pinned version.
- [Workers Streams API](https://developers.cloudflare.com/workers/runtime-apis/streams/): runtime streaming mechanism, not deployment acceptance evidence.

See ROADMAP for cloud security/capacity gates. No deployment is part of this work.
