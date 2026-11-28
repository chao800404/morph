import { test } from "@playwright/test";

/**
 * DO NOT MERGE. Throwaway experiment (branch ci/evidence-timeout-experiment):
 * a test that never ends, run as the last container step of
 * editor-e2e-container-preview, to show on a hosted runner that
 *   - the step ends at its 2 minute limit and the job fails,
 *   - the always() steps and the upload still run, and
 *   - the progress file (and what of the sidecar logs the teardown copies)
 *     reaches the artifact.
 */
test("hangs on purpose", async () => {
  test.setTimeout(0);
  await new Promise(() => {});
});
