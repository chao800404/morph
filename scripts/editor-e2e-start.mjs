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

/** Spec files (relative to e2e/) the job runs under the full Start preview. */
export const START_PREVIEW_SPECS = [
  // Case B and the A6b-2 live canvas refresh. Needs the runner-owned store
  // (MORPH_E2E_STATE_DIR), which the runner provides.
  "loader-data-binding.spec.ts",
  // The native Start half of the compatibility matrix. Its client-only half
  // (the KNOWN GAP tests) skips under Start and runs on the shards instead.
  "native-compat-preview.spec.ts",
  // A prop beside a section's content spread: the loader form, and the
  // `content("x")` form under the Start runtime. Needs the runner-owned store.
  "spread-override-binding.spec.ts",
];

/**
 * Specs that read `MORPH_E2E_PREVIEW_RUNTIME` but are not run by the job, and
 * why. Each still runs (or skips) on the shards as before.
 * @type {Record<string, string>}
 */
export const START_PREVIEW_EXCLUDED = {
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

/** Where the job asks the runner to write Playwright's JSON report. */
export const START_PREVIEW_REPORT_PATH = "test-results/full-start.json";

/** The runner command the job runs, spelled exactly as in ci.yml. */
export function startPreviewCommand() {
  return `pnpm test:e2e:local-preview -- ${START_PREVIEW_SPECS.map((file) => `e2e/${file}`).join(" ")}`;
}
