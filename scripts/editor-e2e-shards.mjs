import path from "node:path";

// Fixed, reviewable whole-file allocation, balanced longest-first by
// scripts/rebalance-e2e-shards.mjs from the per-file test durations of CI run
// 37322994193 (main 2e03703), recorded in editor-e2e-durations.json. That run
// measured 486 / 380 / 456 s of test bodies on the previous plan; this one
// projects 439 / 443 / 441 s. Projections, not a measured new run; setup is
// additional. Environment-gated files remain included.
// New tests/files must still pass check-e2e-shards' full-suite ID comparison.
// The number of shards is this array's length; the CI matrix, the job names
// and `pnpm ship`'s required checks are checked against it.
export const EDITOR_SHARDS = [
  [
    "editor-writes-auth.spec.ts",
    "accessibility.spec.ts",
    "native-compat-preview.spec.ts",
    "text-promotion.spec.ts",
    "public-text-code.spec.ts",
    "catalog.spec.ts",
    "auth-failure.spec.ts",
    "authored-content.spec.ts",
    "native-compat-published.spec.ts",
    "performance.spec.ts",
    "preview-health.spec.ts",
    "publish.spec.ts",
    // Container transport only, so skipped on every CI shard; placed with
    // publish.spec.ts, the other container-only file.
    "build-preview-isolated.spec.ts",
    // Container transport only, like the two above: skipped on every CI shard.
    "native-publish-acceptance.spec.ts",
    "native-content-dependency.spec.ts",
    // Container transport only, like the three above: skipped on every CI shard.
    "source-asset-publish.spec.ts",
    // Container transport and MORPH_ASTRO_THEMES=1 only: skipped on every CI
    // shard, like the container-only files above.
    "astro-publish-acceptance.spec.ts",
  ],
  [
    "preview-frame-load.spec.ts",
    "recovery-editor-writes.spec.ts",
    "structure-editor-writes.spec.ts",
    "responsive.spec.ts",
    "public-root-url.spec.ts",
    "media-svg.spec.ts",
    // Unmeasured until the next rebalance; placed on the shard with the
    // fewest tests.
    "content-fields-sidecar.spec.ts",
    // Unmeasured too, and on the same shard for the same reason. Its Build
    // Preview steps run only with the container transport.
    "starter-upgrade.spec.ts",
    // Unmeasured; a few server function calls and no editor, so seconds.
    "theme-path-refused.spec.ts",
    // Unmeasured; two editor opens and one right-click on a throwaway Theme.
    "code-tree-context-menu.spec.ts",
  ],
  [
    "lost-editor-writes.spec.ts",
    "session-editor-writes.spec.ts",
    "editor.spec.ts",
    "public-svg.spec.ts",
    "initial-code-publish.spec.ts",
    "route-capabilities.spec.ts",
    // Unmeasured until the next rebalance; like public-root-url.spec.ts,
    // which it follows, about 25 s.
    "source-asset.spec.ts",
    // Unmeasured until the next rebalance; placed on the shard with the
    // fewest files. Two tests, about 4 minutes locally.
    "local-code-sync.spec.ts",
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
