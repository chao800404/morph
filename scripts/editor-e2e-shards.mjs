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
// New tests/files must still pass check-e2e-shards' full-suite ID comparison.
// The number of shards is this array's length; the CI matrix, the job names
// and `pnpm ship`'s required checks are checked against it.
export const EDITOR_SHARDS = [
  [
    "recovery-editor-writes.spec.ts",
    "preview-error-recovery.spec.ts",
    "native-compat-preview.spec.ts",
    "public-svg.spec.ts",
    "starter-shell-content.spec.ts",
    "theme-path-refused.spec.ts",
  ],
  [
    "preview-frame-load.spec.ts",
    "leave-before-save.spec.ts",
    "structure-editor-writes.spec.ts",
    "initial-code-publish.spec.ts",
    "object-position.spec.ts",
    // Added after the duration measurement above; not in its projection.
    "selection-field-frame-navigated.spec.ts",
  ],
  [
    "editor-writes-auth.spec.ts",
    "starter-upgrade.spec.ts",
    "content-module-transform.spec.ts",
    "text-promotion.spec.ts",
    "code-tree-context-menu.spec.ts",
    "route-capabilities.spec.ts",
  ],
  [
    "preview-inline-reload-defer.spec.ts",
    "local-code-sync.spec.ts",
    "content-module-restore.spec.ts",
    "public-root-url.spec.ts",
    "public-text-code.spec.ts",
    "catalog.spec.ts",
  ],
  [
    "lost-editor-writes.spec.ts",
    "editor.spec.ts",
    "accessibility.spec.ts",
    "responsive.spec.ts",
    "source-asset.spec.ts",
    "row-component-content.spec.ts",
    // The files below measured zero seconds: every test in them is gated on
    // an environment the shards do not have (the container transport,
    // MORPH_ASTRO_THEMES=1 or the full Start preview), so they skip on every
    // CI shard. They stay in the plan so coverage remains complete; the full
    // Start ones are run by the full Start job (editor-e2e-start.mjs).
    "astro-island-hmr.spec.ts",
    "astro-preview-container.spec.ts",
    "astro-publish-acceptance.spec.ts",
    "authored-content.spec.ts",
    "build-preview-isolated.spec.ts",
    "loader-data-binding.spec.ts",
    "native-compat-published.spec.ts",
    "native-content-dependency.spec.ts",
    "native-publish-acceptance.spec.ts",
    "performance.spec.ts",
    "publish-layout-edit.spec.ts",
    "publish.spec.ts",
    "source-asset-publish.spec.ts",
  ],
  [
    "session-editor-writes.spec.ts",
    "content-fields-sidecar.spec.ts",
    "preview-instance-reattach.spec.ts",
    "media-svg.spec.ts",
    "section-visibility-layout.spec.ts",
    "auth-failure.spec.ts",
  ],
];

export const EDITOR_SHARD_COUNT = EDITOR_SHARDS.length;

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
