import path from "node:path";

// Fixed, reviewable whole-file allocation, balanced longest-first by
// scripts/rebalance-e2e-shards.mjs --shards=6 from the per-file test durations
// of CI run 38902225114 (main 41ef184), recorded in editor-e2e-durations.json.
// That run measured 451 / 786 / 631 s of test bodies on the previous three-shard
// plan; this one projects 311 / 308 / 317 / 314 / 308 / 310 s. Projections, not
// a measured six-shard run; setup is additional. Applied to four earlier report
// runs (10-15) the same plan sums to at most 446 s per shard, so the budget
// below holds on every run measured so far, which is no guarantee for the next.
// Environment-gated files remain included (see shard 5).
// Rebalanced for run 45588760709 (head 722e6ce) and three other green main
// runs (45597575633, 45585207449, 45574695693): the previous plan's shard 2
// projected 989 s of test bodies against 447 s for shard 6. Seven whole files
// moved; the mean per-file seconds of those four runs project 650 / 651 / 657
// / 647 / 657 / 665 s. A projection from shared runners, not a measured run.
// Rebalanced again after editor-writes-auth, binding-acceptance-p and
// binding-acceptance-c were split along their tests/cases (the heaviest files,
// 353 / 296 / 262 s): from the same four runs' per-file means, which project
// 674 / 686 / 686 / 616 / 676 / 664 s (the previous plan projected 658 / 609 /
// 686 / 616 / 769 / 664 s on the same means). Four whole files moved; the
// split halves stay beside their former file so no shard builds another
// binding-acceptance fixture. Projections, not a measured run.
// New tests/files must still pass check-e2e-shards' full-suite ID comparison.
// The number of shards is this array's length; the CI matrix, the job names
// and `pnpm ship`'s required checks are checked against it.
export const EDITOR_SHARDS = [
  [
    "recovery-editor-writes.spec.ts",
    "editor.spec.ts",
    "native-compat-preview.spec.ts",
    "starter-shell-content.spec.ts",
    "theme-path-refused.spec.ts",
    "preview-old-bridge.spec.ts",
    // Added after the duration measurement above; not in its projection.
    // Shard 1 was the shortest shard job after shard 5 in main run
    // 42387058349 (8m08s; shard 5 7m42s, the others 9m11s to 15m55s).
    "unstored-list-inspector-writes.spec.ts",
    "content-module-restore.spec.ts",
    // Client lane only (LANE_EXCLUSIVE_SPECS below): the restore refused on a
    // Starter 31 Theme. Split from content-module-restore.spec.ts, whose
    // measured seconds included it; not measured on its own.
    "content-module-restore-client.spec.ts",
  ],
  [
    "preview-frame-load.spec.ts",
    "structure-editor-writes.spec.ts",
    "initial-code-publish.spec.ts",
    "object-position.spec.ts",
    "number-link-fields.spec.ts",
    // Added after the duration measurement above; not in its projection.
    "selection-field-frame-navigated.spec.ts",
    "lost-editor-writes.spec.ts",
    // Added after the duration measurement above; not in its projection.
    "preview-document-reload.spec.ts",
    // Added after the duration measurement above; not in its projection.
    "spread-override-binding.spec.ts",
    "preview-instance-reattach.spec.ts",
  ],
  [
    "editor-writes-auth.spec.ts",
    "editor-writes-auth-other-account.spec.ts",
    "editor-writes-auth-late-response.spec.ts",
    "starter-upgrade.spec.ts",
    "content-module-transform.spec.ts",
    "text-promotion.spec.ts",
    "code-tree-context-menu.spec.ts",
    "route-capabilities.spec.ts",
    "leave-before-save.spec.ts",
  ],
  [
    "preview-inline-reload-defer.spec.ts",
    "local-code-sync.spec.ts",
    "public-root-url.spec.ts",
    "public-text-code.spec.ts",
    "catalog.spec.ts",
    // Rebalanced from run 40158324490 (moved from shard 6 to balance client-only Design acceptance).
    "binding-acceptance-c.spec.ts",
    "binding-acceptance-c-rest.spec.ts",
    "public-svg.spec.ts",
  ],
  [
    "preview-error-recovery.spec.ts",
    "code-controlled-field.spec.ts",
    "accessibility.spec.ts",
    "source-asset.spec.ts",
    "row-component-content.spec.ts",
    // Added after the duration measurement above; not in its projection.
    "unstored-list-canvas-reorder.spec.ts",
    // Added after the duration measurement above; not in its projection. Its
    // client-only preview cells run here (~1.6 min locally); its public cells
    // are navigation-matrix-public.spec.ts below. Shard 5 was the shortest
    // shard job of main run 41267736430 (11m27s).
    "navigation-matrix.spec.ts",
    "presentation-ack-refresh.spec.ts",
    // Added after the duration measurement above; not in its projection. Its
    // client-only preview case runs here; the full Start job runs it as well.
    "author-pick-supersedes-follow.spec.ts",
    // Added after the duration measurement above; not in its projection.
    "code-editor-local-monaco.spec.ts",
    // The files below measured zero seconds: every test in them is gated on
    // an environment the shards do not have (the container transport,
    // MORPH_ASTRO_THEMES=1 or the full Start preview), so they skip on every
    // CI shard. They stay in the plan so coverage remains complete; the full
    // Start ones are run by the full Start job (editor-e2e-start.mjs).
    "astro-island-hmr.spec.ts",
    // Container transport, MORPH_ASTRO_THEMES=1 and MORPH_E2E_ASTRO_PARSER=1
    // only (file gates), so it skips on every shard. Its exact tests are
    // listed in scripts/container-acceptance-targets/astro-basis-ack.mjs; no
    // CI step runs that check yet.
    "astro-basis-ack.spec.ts",
    // M2 D3, Astro Design edits published and rolled back: the same file
    // gates, so it skips on every shard. Its exact tests are listed in
    // scripts/container-acceptance-targets/astro-design-release.mjs.
    "astro-design-release-acceptance.spec.ts",
    // M2 PR 3, the first Astro Inspector write, and the M2 D3 shapes: the
    // same file gates, so it skips on every shard too. Its exact tests are
    // listed in scripts/container-acceptance-targets/astro-inspector-write.mjs.
    "astro-inspector-write.spec.ts",
    // M2 D3 batch 2, Astro layout-shared sections and canvas editing: the
    // same file gates, so it skips on every shard. Its exact tests are
    // listed in scripts/container-acceptance-targets/astro-layout-inline.mjs.
    "astro-layout-inline-acceptance.spec.ts",
    "astro-preview-container.spec.ts",
    "astro-publish-acceptance.spec.ts",
    "authored-content.spec.ts",
    // Container transport and full Start only, so it skips here. Its exact
    // tests are listed in scripts/container-acceptance-targets/; the
    // editor-e2e-container-publish job runs that check.
    "b1-publish-rollback-acceptance.spec.ts",
    // M1 1a A3/A4, the B1 route cases published and rolled back: container
    // transport and full Start only, so it skips here at file level. Its
    // exact tests are listed in
    // scripts/container-acceptance-targets/b1-route-publish-rollback.mjs;
    // no CI step runs that check yet (the formal M1 1a run does).
    "b1-route-publish-rollback-acceptance.spec.ts",
    "build-preview-isolated.spec.ts",
    "loader-data-binding.spec.ts",
    "m1-container-lifecycle-acceptance.spec.ts",
    "preview-access-container.spec.ts",
    "start-container-content-sync.spec.ts",
    "preview-socket-acceptance.spec.ts",
    // M1 acceptance 1c, the revocation timeline: container transport and the
    // full Start preview only, so it skips on every shard. Its exact tests are
    // listed in scripts/container-acceptance-targets/preview-revocation-timeline.mjs;
    // no CI step runs that check yet.
    "preview-revocation-timeline.spec.ts",
    "native-compat-published.spec.ts",
    "native-content-dependency.spec.ts",
    "native-publish-acceptance.spec.ts",
    "performance.spec.ts",
    "publish-layout-edit.spec.ts",
    "publish.spec.ts",
    "source-asset-publish.spec.ts",
    "preview-start-bridge-interruption.spec.ts",
    // Container transport and the full Start preview only, so it skips on every
    // shard. Its exact tests are listed in
    // scripts/container-acceptance-targets/preview-start-two-tab-race.mjs; the
    // editor-e2e-container-preview job runs that check.
    "preview-start-two-tab-race.spec.ts",
    "history-back-controlled-repro.spec.ts",
    // Container transport only, so it skips on every shard. Its exact tests
    // are listed in scripts/container-acceptance-targets/.
    "starter-upgrade-publish-acceptance.spec.ts",
    // Lane B, the shipped Starter 32 on the full Start runtime: container
    // transport and the full Start preview only, so it skips on every shard.
    // Its exact tests are listed in
    // scripts/container-acceptance-targets/starter-v32-full-start.mjs; the
    // editor-e2e-container-starter-publish job runs that check.
    "starter-v32-full-start-acceptance.spec.ts",
    // The navigation matrix's public storefront cells: container transport
    // only, so it skips on every shard. Its exact tests are listed in
    // scripts/container-acceptance-targets/navigation-matrix-public.mjs.
    "navigation-matrix-public.spec.ts",
    // M3 stage 1, the hidden CMS Page section refused at publish and shown
    // again: container transport only, so it skips on every shard. No CI
    // step runs it yet; it is run locally on the container transport.
    "publish-hidden-page-section.spec.ts",
  ],
  [
    "session-editor-writes.spec.ts",
    "content-fields-sidecar.spec.ts",
    "media-svg.spec.ts",
    // Client lane: its hide-and-reload test runs here, and its publish test
    // skips (publishing builds in the Sandbox container). Both run, once and
    // without skip or retry, on the container transport and the full Start
    // runtime: scripts/container-acceptance-targets/section-visibility-layout.mjs,
    // checked by the editor-e2e-container-publish job.
    "section-visibility-layout.spec.ts",
    "auth-failure.spec.ts",
    // Rebalanced from run 40158324490 (moved from shard 6 to balance client-only Design acceptance).
    "binding-acceptance-p.spec.ts",
    "binding-acceptance-p-rest.spec.ts",
    "responsive.spec.ts",
    // Added after the duration measurement above; not in its projection.
    // Beside auth-failure.spec.ts, the other cross-origin refusal.
    "admin-same-site-write.spec.ts",
  ],
];

export const EDITOR_SHARD_COUNT = EDITOR_SHARDS.length;

/**
 * Spec files that run on one lane only, each assigned there as a whole file:
 * `client` files are on exactly one editor shard above and in no full Start
 * shard (scripts/editor-e2e-start.mjs), `start` files the other way round. A
 * file is lane-exclusive by where it is planned, never by a skip of its own,
 * so no case of it can be reported as run where it was only skipped.
 *
 * `titles` are every test title the file holds, exactly. check-e2e-shards
 * holds each entry to the collected suite (a stale, missing or unlisted title
 * fails), takes only these `start` tests out of the tests the editor shards
 * must cover, and requires each `client` test to pass in the shard reports;
 * check-e2e-start requires each `start` test to appear once and pass in the
 * full Start reports.
 *
 * From Starter 32 the current Starter's content module needs the full Start
 * preview, and the client lane's Themes are the pinned Starter 31 workspace
 * recording no runtime: what applies the current Starter runs on Start only,
 * and the client lane checks its refusal.
 */
export const LANE_EXCLUSIVE_SPECS = Object.freeze([
  Object.freeze({
    file: "content-module-restore-start.spec.ts",
    lane: "start",
    titles: Object.freeze([
      "deleted in Code mode, it is restored by the command, saved, and the Live Preview renders",
    ]),
  }),
  Object.freeze({
    file: "starter-upgrade-start.spec.ts",
    lane: "start",
    titles: Object.freeze([
      "D. the workspace marked older: opening writes nothing; applying the empty review records the version",
      "B. the untouched pre-pages module on an older Starter: reviewed, then only content.ts is replaced, once",
      "Q. a Theme of unknown origin, upgraded in part: still pending, and the next review offers only what is left",
      "R. a Theme created without the Starter's new pages: offered unselected; the Header waits for them",
      "explains Full Start before Apply; the switch changes no file, version or content; Apply then records 32 and renders it",
    ]),
  }),
  Object.freeze({
    file: "content-module-restore-client.spec.ts",
    lane: "client",
    titles: Object.freeze([
      "on a client-lane Theme the restore is refused, saying why, and nothing is written",
    ]),
  }),
]);

// Test-body seconds a shard may project before the shard check warns. Each
// shard adds about two minutes of fixed setup on top (install, browser, dev
// server, preconditions), so this keeps a shard job near ten minutes.
export const EDITOR_SHARD_BUDGET_SECONDS = 480;

/**
 * The shard and run attempt a downloaded report belongs to, from the artifact
 * directory CI uploads it in (`editor-e2e-results-<shard>-attempt-<attempt>`,
 * see ci.yml); `null` for anything else.
 *
 * Re-running failed jobs keeps a run's earlier artifacts, so one download can
 * hold a failed shard's first attempt next to its re-run. Readers keep each
 * shard's latest attempt only.
 * @param {string} file
 */
export function shardReportAttempt(file) {
  const report = /^shard-(\d+)\.json$/.exec(path.basename(file));
  const artifact = /^editor-e2e-results-(\d+)-attempt-(\d+)$/.exec(
    path.basename(path.dirname(file)),
  );
  if (!report || !artifact || report[1] !== artifact[1]) return null;
  return { shard: Number(report[1]), attempt: Number(artifact[2]) };
}

/**
 * Each shard's latest-attempt report among `files`, in shard order.
 * @param {string[]} files
 */
export function latestShardReportFiles(files) {
  const latest = new Map();
  for (const file of files) {
    const parsed = shardReportAttempt(file);
    if (!parsed) continue;
    const current = latest.get(parsed.shard);
    if (!current || parsed.attempt > current.attempt)
      latest.set(parsed.shard, { ...parsed, file, duplicates: 0 });
    else if (parsed.attempt === current.attempt) current.duplicates += 1;
  }
  return [...latest.values()].sort((a, b) => a.shard - b.shard);
}

/** Expand our existing runner's shard flag to exact whole-file filters.
 * Do not forward --shard as well: Playwright would shard the subset a second time.
 * Full and focused non-shard invocations retain their existing behavior.
 * @param {string[]} extra
 */
export function editorShardArguments(extra) {
  const flags = extra.filter((arg) => arg.startsWith("--shard"));
  if (flags.length === 0) return extra;
  const match = /^--shard=([1-9]\d*)\/([1-9]\d*)$/.exec(flags[0]);
  const index = match ? Number(match[1]) : 0;
  if (
    flags.length !== 1 ||
    !match ||
    Number(match[2]) !== EDITOR_SHARD_COUNT ||
    index > EDITOR_SHARD_COUNT
  ) {
    throw new Error(
      `EDITOR_SHARD_INVALID: expected exactly one --shard=N/${EDITOR_SHARD_COUNT} (N=1..${EDITOR_SHARD_COUNT})`,
    );
  }
  const files = EDITOR_SHARDS[index - 1];
  const patterns = files.map((file) => {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `(?:^|[\\\\/])e2e[\\\\/]${escaped}$`;
  });
  return [...extra.filter((arg) => arg !== flags[0]), ...patterns];
}
