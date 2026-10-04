// Fixed, reviewable whole-file allocation, balanced using the successful CI
// reports from run 37217174717. Historical durations project about 6.3 minutes
// of test bodies per shard; setup/teardown is additional, not a measured new run.
// Environment-gated files remain included.
// New tests/files must still pass check-e2e-shards' full-suite ID comparison.
export const EDITOR_SHARDS = [
  [
    "editor-writes-auth.spec.ts",
    "session-editor-writes.spec.ts",
    "structure-editor-writes.spec.ts",
    "responsive.spec.ts",
    "public-text-code.spec.ts",
    "auth-failure.spec.ts",
    "authored-content.spec.ts",
    "native-compat-published.spec.ts",
    "performance.spec.ts",
    "preview-health.spec.ts",
    "publish.spec.ts",
  ],
  [
    "preview-frame-load.spec.ts",
    "editor.spec.ts",
    "native-compat-preview.spec.ts",
    "media-svg.spec.ts",
    "public-root-url.spec.ts",
    "initial-code-publish.spec.ts",
    "route-capabilities.spec.ts",
  ],
  [
    "lost-editor-writes.spec.ts",
    "recovery-editor-writes.spec.ts",
    "accessibility.spec.ts",
    "text-promotion.spec.ts",
    "public-svg.spec.ts",
    "catalog.spec.ts",
  ],
];

/** Expand our existing runner's shard flag to exact whole-file filters.
 * Do not forward --shard as well: Playwright would shard the subset a second time.
 * Full and focused non-shard invocations retain their existing behavior.
 * @param {string[]} extra
 */
export function editorShardArguments(extra) {
  const flags = extra.filter((arg) => arg.startsWith("--shard"));
  if (flags.length === 0) return extra;
  const match = /^--shard=([1-3])\/3$/.exec(flags[0]);
  if (flags.length !== 1 || !match) {
    throw new Error(
      "EDITOR_SHARD_INVALID: expected exactly one --shard=N/3 (N=1,2,3)",
    );
  }
  const files = EDITOR_SHARDS[Number(match[1]) - 1];
  const patterns = files.map((file) => {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `(?:^|[\\\\/])e2e[\\\\/]${escaped}$`;
  });
  return [...extra.filter((arg) => arg !== flags[0]), ...patterns];
}
