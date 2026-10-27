// @ts-check
/**
 * The editor specs CI runs a second time, against the full TanStack Start
 * preview, in the "Editor E2E full Start preview" job (ci.yml).
 *
 * The editor shards run the default, client-only preview, where every test
 * gated on `MORPH_E2E_PREVIEW_RUNTIME=start` skips itself. Before this job
 * those tests — case B of the content binding contract, the A6b-2 live canvas
 * refresh, the native Start compatibility checks — were proven by local runs
 * only. The job turns the Start runtime on the way a local run does: the
 * Worker reads `MORPH_THEME_PREVIEW_RUNTIME=start` from the run's
 * `.dev.vars.local_preview_e2e`, and the specs read
 * `MORPH_E2E_PREVIEW_RUNTIME=start` from the runner's environment. Same local
 * sidecar transport as the shards; no container.
 *
 * Every spec that reads `MORPH_E2E_PREVIEW_RUNTIME` is listed either here or
 * in `START_PREVIEW_EXCLUDED` with its reason; check-e2e-start fails on a spec
 * that is in neither, so a new Start-gated spec cannot stay CI-skipped by
 * omission.
 */

/** The job's name, as GitHub reports the check. */
export const START_PREVIEW_JOB_NAME = "Editor E2E full Start preview";

/** Whole-file shards (3 full Start jobs). */
export const START_PREVIEW_SHARDS = [
  ["loader-data-binding.spec.ts", "native-compat-preview.spec.ts", "code-controlled-field.spec.ts"],
  ["spread-override-binding.spec.ts", "binding-acceptance-c.spec.ts", "preview-start-bridge-interruption.spec.ts"],
  ["binding-acceptance-p.spec.ts"],
];
export const START_PREVIEW_SHARD_COUNT = START_PREVIEW_SHARDS.length;

/** Spec files (relative to e2e/) the job runs under the full Start preview. */
export const START_PREVIEW_SPECS = START_PREVIEW_SHARDS.flat();

/** @param {number} shard */
export function startPreviewFilesForShard(shard) {
  if (
    !Number.isInteger(shard) ||
    shard < 1 ||
    shard > START_PREVIEW_SHARD_COUNT
  )
    throw new Error(
      `START_SHARD_INVALID: expected 1..${START_PREVIEW_SHARD_COUNT}`,
    );
  return START_PREVIEW_SHARDS[shard - 1];
}

/**
 * Specs that read `MORPH_E2E_PREVIEW_RUNTIME` but are not run by the job, and
 * why. Each still runs (or skips) on the shards as before.
 * @type {Record<string, string>}
 */
export const START_PREVIEW_EXCLUDED = {
  "m1-container-lifecycle-acceptance.spec.ts":
    "The M1 container lifecycle acceptance runs under the container transport (MORPH_E2E_TRANSPORT=cloudflare-sandbox); the full Start job runs on the local-sidecar transport.",
  "public-svg.spec.ts":
    "Reads the variable only inside a test that plants a file in a Sandbox container (MORPH_E2E_TRANSPORT=cloudflare-sandbox); the rest of the file is not Start-gated and runs on the shards.",
};

/**
 * Tests in `START_PREVIEW_SPECS` that skip themselves under the Start preview
 * by design: the client-only gaps the Start preview closes, asserted as
 * ordinary tests in the same file and as KNOWN GAPs on the shards. Any other
 * skip fails the job, and so does an entry here that no longer skips.
 */
export const START_PREVIEW_EXPECTED_SKIPS = [
  {
    file: "native-compat-preview.spec.ts",
    title: "KNOWN GAP: a loader calling a server function crashes the page",
  },
  {
    file: "native-compat-preview.spec.ts",
    title: "KNOWN GAP: a cookie helper is refused when called, saying so",
  },
  {
    file: "native-compat-preview.spec.ts",
    title: "KNOWN GAP: server routes do not exist",
  },
];
