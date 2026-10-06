# Storefront rendering policy implementation

Status: versioned draft persistence and immutable-publication policy resolution
implemented, with optional sealed-publication build binding; native rendering
integration remains incomplete. A new authorized
draft server function uses the existing Document revision writer. No editor
control or ISR cache is enabled by this increment. Native prerender generation
is being tested for static Code routes with sealed, route-addressable content.
The Theme publish path refuses SSG/ISR/CSR policies across the exact content
revision set being sealed (selected page, layout, published sibling templates
and published Pages) until their rendering paths are implemented; it must not
succeed while still rendering an SSR document. This is an interim integration
guard, not an audit of every independent Page authoring/publishing API.

## IPv6 prerender-content correction (2026-10-06)

- PR #98 commit 2702da4 failed CI run 37421915940: the native content test
  generated WRONG_DEFAULT/WRONG_SHELL with empty serialized content slots.
  Local success did not justify merging; pnpm ship stopped. The exact listener
  address was not logged in that CI run.
- Reproduced the same native HTML failure locally by binding the preview
  fixture explicitly to IPv6 ::1. The old bridge always forwarded an IPv4
  127.0.0.1 content origin. A separate real TCP-listener test passed IPv4 and
  failed IPv6 before the correction. Red evidence:
  /tmp/morph-native-prerender-v6-red.log and
  /tmp/morph-prerender-address-red.log.
- The bridge now derives the content origin from the actual bound listener,
  uses bracketed IPv6, maps wildcard binds to the matching loopback family,
  and refuses unavailable/non-loopback listeners or invalid ports. Incoming
  Host and Theme origin headers cannot select the content destination.
- Native sealed-page/layout rendering is tested on explicitly bound IPv4 and
  IPv6 previews, not the machine's localhost DNS preference. Assertions still
  require frozen values and forbid shipping snapshot data in server artifacts.
- No policy, publication guard, authorization or rendering-mode scope changed.
  This correction does not complete production SSG serving, ISR/CSR or native
  user configuration compatibility.

## Editor preparation and sealed-build wiring (2026-10-06)

- Extended the existing initial-draft preparation endpoint with an optional
  exact draft revision identity. Without it, first-publish semantics are
  unchanged. Existing-draft preparation normalizes only the stored Document,
  accepts no client replacement content and uses the shared source/draft CAS
  writer. Publication-referenced revisions are forked, never overwritten.
- Editor Publish requests this preparation for the selected template and
  layout when their draft policies declare non-SSR rendering. It then passes
  the confirmed draft/source/release preconditions to the existing build
  endpoint, which seals content before queuing the same build. Source drift
  before freezing is refused; existing post-build publication guards remain.
- Non-SSR intent cannot reuse a build solely because source generation matches.
  Ordinary SSR builds and content-only SSR publication keep their previous
  behavior. A standalone Build Preview still follows its source-only path.
- This is wiring, not completed rendering-mode acceptance. There is no mode
  selector yet, no new browser acceptance of this orchestration, and no remote
  deployment. The non-SSR publication guard is retained until production HTML
  serving is connected. ISR and CSR rendering remain unimplemented.
- Focused checks: 149 tests passed. Full frozen-source validation passed
  `pnpm typecheck`, `pnpm typecheck:data`, `pnpm test` (563 files / 4549 tests
  passed, one opt-in workspace parity file/test skipped), and `pnpm build`,
  including client bundle, sidecar and deployment artifact secret guards.
  Tracked/untracked source fingerprints matched before/after validation.
  Logs: `/tmp/morph-content-build-editor-focused.log` and
  `/tmp/morph-content-build-preparation-{typecheck,data,tests,build}.log`.
- An earlier diagnostic typecheck caught a button passing its click event to
  the newly parameterized build callback. UI callers now explicitly call the
  callback without arguments; the final frozen-source typecheck passed.

## Foundation validation (2026-10-05)

- Focused policy tests: 29 passed. `pnpm typecheck` passed.
- The first full `pnpm test` run failed one preview suite: the worktree shared
  main's `node_modules` via a symlink, so Start resolved a module outside this
  worktree's approved dependency root. No import-protection rule was relaxed.
- After an independent `pnpm install --frozen-lockfile --offline`, that preview
  suite passed all 14 cases. A full rerun passed 556 files / 4435 tests, with
  one file / one test skipped. The original failed log is retained at
  `/tmp/morph-render-policy-tests.log`; the rerun at
  `/tmp/morph-render-policy-tests-isolated.log`.
- `pnpm build` passed, including its client-bundle, sidecar and deployment
  artifact guards. Log: `/tmp/morph-render-policy-build.log`.
- No new browser or Cloudflare rendering-mode acceptance was run. There is no
  configured rendering mode to exercise in the product yet.

## Draft/publication integration validation (2026-10-05)

- Full `pnpm test`: 556 files passed / one file skipped; 4459 tests passed /
  one test skipped. Log: `/tmp/morph-render-policy-storage-tests.log`.
- Afterwards, one additional regression was added for the pending layout policy
  included by a page publish. The final focused run passed all 183 cases across
  the five affected policy/Document/runtime/route suites, including that case.
  Log: `/tmp/morph-render-policy-storage-focused.log`.
- Final `pnpm typecheck` and `pnpm build` passed. The build's client-bundle,
  preview-sidecar and deployment artifact secret guards passed. Logs:
  `/tmp/morph-render-policy-storage-typecheck.log` and
  `/tmp/morph-render-policy-storage-build.log`.
- No new browser rendering-mode acceptance, remote deployment, commit, push or
  merge. The new draft server function has no editor caller yet. No actual
  SSG/ISR/CSR mode switch was exercised or enabled by these checks.

## Whole-publication guard validation (2026-10-05)

- Exact-revision reader and Theme publication suites: 92 tests passed. Tests
  cover published sibling templates, already-published website defaults and
  independent Pages carrying SSG/ISR/CSR, with no release/publication writes.
- Selected revision lookup never substitutes a newer draft. Cross-storefront,
  cross-Theme, wrong-publication, malformed/missing and wrong-scope references
  are refused. Retained Page revisions remain readable after Page deletion.
- Full `pnpm test`: 556 files passed / one skipped; 4479 tests passed / one
  skipped. Logs: `/tmp/morph-render-policy-publication-focused.log` and
  `/tmp/morph-render-policy-publication-tests.log`.
- `pnpm typecheck`, `pnpm build` and `git diff --check` passed. Client-bundle,
  preview-sidecar and deployment artifact secret guards passed. Build retained
  the large-chunk warning. Logs: `/tmp/morph-render-policy-publication-typecheck.log`
  and `/tmp/morph-render-policy-publication-build.log`.
- This is a publication validation boundary, not SSG generation or a four-mode
  runtime acceptance result. No browser mode-switch or Cloudflare test ran.

## Sealed-publication build binding validation (2026-10-06)

- Six focused build/publication/migration suites passed all 166 cases. The
  build input schema suite passed three additional cases: legacy input,
  publication-ID-only input and invalid-ID refusal. Raw caller-supplied content
  is not accepted as build input.
- The first full run failed two existing storage-boundary tests (4504 passed,
  two failed, one skipped). Source-only service paths called the new content
  reader unnecessarily, which the bounded DAL fixture does not expose. The
  service now calls that reader only when a publication is bound, preserving
  the existing source-only boundary instead of widening the fixture.
  Original log: `/tmp/morph-render-policy-content-tests.log`.
- After the fix, the storage-boundary, queue orchestration and schema suites
  passed all 31 cases. Log: `/tmp/morph-render-policy-content-boundary-tests.log`.
- Final full `pnpm test` passed: 559 files passed / one skipped; 4509 tests
  passed / one skipped. Log: `/tmp/morph-render-policy-content-tests-rerun.log`.
- Migration numbering/duplicate checks, SQL timestamp guard and
  `pnpm typecheck:data` passed. Migration behavior was tested only in an
  in-memory SQLite database, not applied to development or remote databases.
- Final `pnpm typecheck` and `pnpm build` passed after the source-only boundary
  fix. Client-bundle, preview-sidecar and deployment artifact secret guards
  passed; the build retained its large-chunk warning. Logs:
  `/tmp/morph-render-policy-content-typecheck-final.log` and
  `/tmp/morph-render-policy-content-build-final.log`.
- No browser SSG/ISR/CSR acceptance, remote deployment, commit, push or merge
  is implied by these results.

## Native prerender increment (2026-10-06, incomplete)

- The shared workspace configuration selects concrete static Code routes through
  native Start `pages`/`prerender`; automatic discovery and link crawling are off.
- Real local builds generated `/landing/index.html` with loader-produced HTML,
  without generating a homepage HTML. This does not prove CMS content rendering.
- A negative build test initially exposed a native queue rejection after the
  in-process builder had returned success. The local SSG build now uses the
  pinned Vite CLI in a separate process with strict unhandled-rejection failure,
  a duration/output limit and no inherited application credentials. This is
  failure isolation, not a security sandbox for untrusted local Themes.
- Both runners additionally require an HTML artifact for each selected SSG URL;
  missing HTML cannot be treated as a successful build with just client assets.
- The two real local build cases (success and loader failure) passed. The new
  Sandbox configuration has not been exercised in an actual Sandbox this round.
- Nonempty CMS Documents are refused until frozen content injection is wired.
  First SSG publication, production static serving, CSR policy integration and
  ISR remain unimplemented; non-SSR publication is still blocked.
- Validation: `pnpm typecheck`, `pnpm typecheck:data` and `pnpm build` passed.
  Build guards passed, with the existing large-chunk warning retained.
  The first full test run had 4515 passes and one failure: a runner test expected
  the old exact environment without the newly required strict rejection option.
  That explicit expectation was updated (not loosened); the focused runner and
  artifact suites passed 19 cases. Final full run: 561 files / 4516 tests passed,
  one file / one test skipped. Logs: `/tmp/morph-render-native-tests.log`,
  `/tmp/morph-render-native-tests-final.log`, `/tmp/morph-render-native-build.log`,
  `/tmp/morph-render-native-typecheck.log`, `/tmp/morph-render-native-data.log`.
  No new browser acceptance, remote deployment or database migration was run.

## Frozen content prerender increment (2026-10-06, incomplete)

- Extends the existing `/_morph/content` endpoint and
  `x-morph-content-origin` request contract only during native prerender.
  The same public content resolver materializes slots/hidden slots from the
  sealed build input. No mutable workspace, database capability or session is
  passed into that content endpoint.
- Content is a platform-owned temporary workspace JSON file, outside the
  compiled module graph and artifact directories. The compiled Worker remains
  reusable; only selected generated HTML contains the corresponding CMS values.
- A real build test proves stored fields appear in HTML, not defaults, and
  asserts the field sentinel and snapshot file are absent from server artifacts.
  The first attempt failed: Cloudflare's Node adapter reads `rawHeaders`, so
  modifying only `headers` did not forward the content origin. Both are now set
  consistently, replacing any existing origin value rather than appending it.
- Supported scope: explicit immutable static route references, plus a layout
  carrying its versioned website policy. Nonempty legacy template Documents
  without an immutable route/layout identity are refused, not guessed from
  current template rows. This is not full template/dynamic-URL SSG support.
- First SSG publication, production static HTML dispatch, CSR/ISR and editor
  controls remain disconnected. Non-SSR publication remains blocked.
- Focused tests: three real native builds passed (plain SSG, sealed CMS fields,
  loader failure); six content boundary cases passed. Fields and hidden slots
  use the public resolver, and source-only/SSR-only builds remain unchanged.
- An intermediate full run failed one empty product-document case because
  executable code was edited after Vitest had imported it while the test file
  was updated afterwards. That mixed-version run is not acceptance evidence.
  Source and tests were then frozen: the full rerun passed 562 files / 4523
  tests, with one file / one test skipped. Tracked-diff and untracked-file
  fingerprints were identical before and after that final test/build run.
- Frozen `pnpm typecheck` and `pnpm build` passed; `pnpm typecheck:data` passed.
  Client bundle, sidecar and deployment artifact guards passed. The existing
  large-chunk warning remains. Logs: `/tmp/morph-ssg-content-tests-frozen.log`,
  `/tmp/morph-ssg-content-typecheck-frozen.log`,
  `/tmp/morph-ssg-content-build-frozen.log`,
  `/tmp/morph-ssg-content-data-final.log`. Earlier failures are retained in
  `/tmp/morph-ssg-content-native.log` and `/tmp/morph-ssg-content-tests.log`.
- No real Sandbox transport, new browser rendering-mode acceptance, remote
  deployment, migration, commit or merge was performed for this increment.

## Frozen template identity increment (2026-10-06, incomplete)

- New publications capture `metadata.templateType` together with any route path.
  DTO reads preserve and validate that role. No existing publication is backfilled
  from mutable template rows, and no schema migration is needed for this JSON field.
- New runtime template lookup uses the frozen role and frozen route ownership;
  the previous mutable type/path fallback is restricted to legacy snapshots.
  New generic-template snapshots cannot also answer a newly assigned mutable
  route. A SQLite regression failed against the preceding route lookup and
  passed after the fallback restriction; log:
  `/tmp/morph-frozen-role-route-negative.log`.
- Build content resolution recognizes layout without an explicit website policy,
  index as `/`, and Pages by their frozen handles. Conflicting Page path evidence
  is refused. Concrete dynamic-URL enumeration remains a separate gate.
- The real native build case now asserts both page fields and frozen layout
  fields in HTML, with neither sentinel shipped in the server bundle.
- The first focused run had two outdated expectations: the matching bound-build
  fixture lacked the newly frozen index role, and the route metadata assertion
  expected only its path. Fixtures/expectations now include the role explicitly;
  the content mismatch rejection is unchanged. Log:
  `/tmp/morph-frozen-role-focused.log`.
- An initial validation pipeline was deliberately stopped before modifying the
  newly found route fallback. Final frozen validation passed: 111 focused cases,
  `pnpm typecheck`, `pnpm typecheck:data`, full `pnpm test` (563 files / 4529 tests
  passed, one file / one test skipped), and `pnpm build` including artifact guards.
  Tracked-diff and untracked-file fingerprints matched before and after that run.
  Logs: `/tmp/morph-frozen-role-focused-frozen.log`,
  `/tmp/morph-frozen-role-typecheck-frozen.log`,
  `/tmp/morph-frozen-role-data-frozen.log`,
  `/tmp/morph-frozen-role-tests-frozen.log`,
  `/tmp/morph-frozen-role-build-frozen.log`.
- First SSG publication still lacks freeze-before-build orchestration. Production
  static HTML dispatch, CSR/ISR and editor controls remain disconnected. Non-SSR
  publication stays blocked. No commit, merge, migration or remote deployment ran.

## Build-input sealing increment (2026-10-06, incomplete)

- The existing `createPreviewBuild` endpoint accepts optional `publicationDraft`
  preconditions instead of raw content. It retains commerce-admin middleware and
  derives the audit actor from the session. This option cannot be combined with
  an existing `contentPublicationId`. The endpoint seals a publication first,
  then passes its ID to the existing build service/queue and snapshot reader.
- `sealForThemeBuild` extends the existing publication resolver/insert statements.
  Its batch checks storefront/Theme ownership, source revision and source
  generation, selected draft ID/generation, release generation and any pending
  layout draft ID/generation. It neither activates a release nor changes published
  pointers. Initial/unnormalized drafts must use the existing explicit Document
  writer first; sealing refuses a draft the publish step would still normalize.
- A real SQLite test initially proved that a referenced unpublished revision
  could still be overwritten. The shared Document writer now forks a new draft
  when any retained publication references it. In-place writes additionally
  check lack of references inside the transaction, so a seal racing a prepared
  write refuses that write rather than modifying build input.
- Tests cover later edits preserving the frozen values, the prepared-write/seal
  race, stale source/draft/release inputs, ownership, pending-layout changes,
  unnormalized content and no activation. Focused suites passed 120 cases.
  First typecheck stopped on a test missing its required audit actor; that test
  argument was added before restarting validation, not during the final run.
- Final frozen `pnpm typecheck`, `pnpm typecheck:data`, full `pnpm test` (563 files
  / 4538 tests passed; one file / one test skipped) and `pnpm build` passed.
  Artifact guards passed, with the existing large-chunk warning. Tracked-diff
  and untracked-file fingerprints matched before and after final validation.
  Logs: `/tmp/morph-content-seal-focused3.log`,
  `/tmp/morph-content-seal-typecheck-final.log`,
  `/tmp/morph-content-seal-data-final.log`,
  `/tmp/morph-content-seal-tests-final.log`,
  `/tmp/morph-content-seal-build-final.log`.
- This is build-input preparation, not completed first SSG publication. The
  editor does not yet request this option, initial/layout draft normalization
  orchestration is not wired, and production static dispatch is missing.
  Non-SSR publication is still refused; deployment lease/CAS/deploy/rollback
  order remains unchanged. No browser sealing acceptance, remote deployment,
  migration, commit or merge ran for this increment.

## Confirmed product contract (unchanged)

- Website default is SSR. A page defaults to `inherit`, not a copied SSR value.
- Explicit page overrides win. ISR carries an explicit positive interval, with
  an initial seven-day maximum; other choices cannot carry an ignored interval.
- The label is "渲染方式" with an accessible information tooltip explaining that
  it controls direct document loads, not ordinary client Router navigation.
- A page's CSR choice is route-level selective SSR, not whole-site SPA mode.
- Settings edits are drafts. Only a successful explicit Publish changes the
  production policy. Invalid/incompatible choices are errors, not silent SSR.
- Personalized output cannot be static or shared-cache HTML. Eligibility must
  come from trusted route capabilities, not client input or URL-name guessing.

## Implementation gates

1. **Owner selected and draft persistence implemented:** `websiteRenderPolicy`
   lives in the versioned layout Document; `renderPolicy` lives in the existing
   route/page Document. Missing fields remain legacy SSR/inherit. The draft
   server function validates input, requires commerce-admin middleware, derives
   its actor from the session, checks storefront/Theme ownership and requires
   both source and draft generations. It delegates to `writeTemplateDocument`.
   Route-owned section rebuilds preserve document metadata. Renaming/reordering
   tests preserve policy; publication tests prove a new draft does not modify a
   retained published snapshot. `resolvePublishedStorefrontRenderPolicy` shares
   the existing published route lookup with content and never reads preferences
   or drafts. It is not yet called by production dispatch. Non-SSR publication
   guards include a layout draft sealed by a page publish. No controls are
   exposed yet; the draft function is an integration seam, not a complete UI.
2. Extend the existing source/content/build binding. Current builds bind source
   revisions; source-only content publishes can still reuse those builds. An SSG page
   must bind the HTML to the exact published content snapshot too. Content-only
   publishes cannot reuse stale prerendered HTML. Do not reorder the existing
   deployment lease/CAS/deploy/rollback sequence under the guise of atomicity.
   Preserve the existing architecture rule that ordinary SSR content changes
   do not rebuild the Theme. Do not bake every Document into the Theme bundle.
   Only SSG HTML requires regeneration for its content identity; reusable
   source artifacts and publication-bound HTML must remain distinguishable in
   the existing artifact/release pipeline.
   `readDocumentsForDraft` now materializes the selected revision references
   with storefront/Theme ownership and policy-scope checks. It never substitutes
   current draft pointers. This is not yet a frozen build input: unpublished
   revisions may still be edited in place until the existing publish CAS seals
   them. Passing its result straight to a background build would not solve
   the concurrency requirement.
   The optional `contentPublicationId` build binding now accepts an existing
   sealed publication only. Build creation checks ownership and retained
   references; a queue consumer reads that same publication again, not current
   drafts. The publication identity, revision references, route metadata,
   policy and document values participate in the build input hash. Missing or
   invalid content fails before the runner. Publication checks reject a bound
   build whose document/revision set differs from the set about to be sealed.
   Incidental publication/item row IDs do not prevent comparing equivalent
   sets. Source-only builds keep their previous hash and do not read content.
   Migration `0071_theme_build_content_publication` adds the nullable binding
   and foreign key; it has not been applied to any development/remote database.
   Both runners now derive selected native prerender paths from this snapshot.
   A real local build produces selected static-route HTML with sealed CMS
   content through the existing public content resolver. Nonempty legacy
   Documents without immutable route/layout identity are explicitly refused.
   No editor caller requests this binding.
   Preparing and sealing the first SSG draft snapshot before its build remains
   unimplemented, as does distinguishing generated HTML in release artifacts.
3. Map SSG policies to the installed native Start plugin's `prerender` and
   `pages` options. Static routes and concrete dynamic URLs need separate
   coverage; do not interpret a route pattern as a concrete prerender URL.
   Both build runners must consume the same frozen options, without granting
   arbitrary Vite plugins, bindings or production credentials.
4. Integrate CSR through native selective SSR while detecting conflicts with
   authored route options. Do not overwrite computed Theme options by regex or
   silently replace the Theme's router/loader. SSR remains the baseline.
   Native parent SSR restrictions cannot be loosened by a child. A website
   default of CSR must not be implemented by turning the root's SSR off and
   then pretending an explicit child SSR setting can override that root.
   Conflicting authored parent policies need explicit validation/diagnostics.
5. Evaluate current Cloudflare Workers Cache separately from `caches.default`.
   They are different APIs. Verify the installed Wrangler/runtime supports the
   chosen configuration before implementation. Core authentication/ownership
   dispatch must run before a Theme cache hit. Include release/content identity
   in the key; do not enable cross-version reuse. Never share personalized,
   Cookie/Authorization-dependent or Set-Cookie HTML. Static assets must not
   shadow SSR/ISR routes after a mode switch.
6. Only expose working modes in the editor after the authoring-to-release chain
   is connected. Use shared Select and tooltip primitives, existing authorized
   writes and OCC, and explicit publish status. Include pending/failure states.

## Acceptance, not merely UI presence

- Missing settings => SSR; inherited defaults track changes; overrides persist.
- Draft changes leave the current release unchanged. Failed builds/deployments
  leave the old release serving, with existing drift handling preserved.
- Direct browser loads and refreshes demonstrate the selected HTML mode.
  Link navigation remains client-side; loaders/server functions are tested too.
- SSG publishes contain actual generated HTML and correct content identity.
- ISR tests observe a fresh hit, expired revalidation, failed refresh, content
  publish, mode switch and rollback without serving another release's HTML.
- Preserve API routes, server functions, public assets and existing SVG safety.
- Local acceptance is not Cloudflare deployment acceptance. No remote mutation
  is authorized by this task.

## Official references checked on 2026-10-05

- https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr
- https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering
- https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode
- https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
- https://developers.cloudflare.com/workers/cache/
- https://developers.cloudflare.com/workers/cache/configuration/

The older Cache API does not implement SWR automatically; the newer Workers
Cache has its own opt-in behaviour. Do not generalize one API's limitations to
the other. Native Start's SPA plugin mode and SSR followed by client navigation
are likewise different features.
