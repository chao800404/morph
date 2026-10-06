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
  ],
  [
    "preview-frame-load.spec.ts",
    "recovery-editor-writes.spec.ts",
    "structure-editor-writes.spec.ts",
    "responsive.spec.ts",
    "public-root-url.spec.ts",
    "media-svg.spec.ts",
  ],
  [
    "lost-editor-writes.spec.ts",
    "session-editor-writes.spec.ts",
    "editor.spec.ts",
    "public-svg.spec.ts",
    "initial-code-publish.spec.ts",
    "route-capabilities.spec.ts",
  ],
];

export const EDITOR_SHARD_COUNT = EDITOR_SHARDS.length;

// Test-body seconds a shard may project before the shard check warns. Each
// shard adds about two minutes of fixed setup on top (install, browser, dev
// server, preconditions), so this keeps a shard job near ten minutes.
export const EDITOR_SHARD_BUDGET_SECONDS = 480;

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
