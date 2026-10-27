// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { verifyContainerReport } from "./check-container-acceptance.mjs";

test("check-container-acceptance", async (t) => {
  await t.test(
    "passes on a valid report where the target spec passed with zero skip and zero retry",
    () => {
      const report = {
        suites: [
          {
            file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
            specs: [
              {
                file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
                title: "M1 lifecycle",
                tests: [
                  {
                    projectName: "editor",
                    status: "expected",
                    results: [{ status: "passed" }],
                  },
                ],
              },
            ],
          },
        ],
        stats: {
          expected: 1,
          unexpected: 0,
          flaky: 0,
          skipped: 0,
        },
      };

      const result = verifyContainerReport(report);
      assert.equal(result.passedCount, 1);
    },
  );

  await t.test(
    "fails if the report only contains setup or other specs but not the target spec",
    () => {
      const report = {
        suites: [
          {
            file: "e2e/auth.setup.ts",
            specs: [
              {
                file: "e2e/auth.setup.ts",
                title: "setup",
                tests: [
                  {
                    projectName: "editor",
                    status: "expected",
                    results: [{ status: "passed" }],
                  },
                ],
              },
            ],
          },
        ],
        stats: {
          expected: 1,
          unexpected: 0,
          flaky: 0,
          skipped: 0,
        },
      };

      assert.throws(
        () => verifyContainerReport(report),
        /CONTAINER_ACCEPTANCE_SPEC_MISSING/,
      );
    },
  );

  await t.test(
    "fails if the target spec skipped (e.g. environment skip)",
    () => {
      const report = {
        suites: [
          {
            file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
            specs: [
              {
                file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
                title: "M1 lifecycle",
                tests: [
                  {
                    projectName: "editor",
                    status: "skipped",
                    results: [{ status: "skipped" }],
                  },
                ],
              },
            ],
          },
        ],
        stats: {
          expected: 0,
          unexpected: 0,
          flaky: 0,
          skipped: 1,
        },
      };

      assert.throws(
        () => verifyContainerReport(report),
        /CONTAINER_ACCEPTANCE_SKIPPED/,
      );
    },
  );

  await t.test(
    "fails if the target spec had retries",
    () => {
      const report = {
        suites: [
          {
            file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
            specs: [
              {
                file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
                title: "M1 lifecycle",
                tests: [
                  {
                    projectName: "editor",
                    status: "flaky",
                    results: [{ status: "failed" }, { status: "passed" }],
                  },
                ],
              },
            ],
          },
        ],
        stats: {
          expected: 0,
          unexpected: 0,
          flaky: 1,
          skipped: 0,
        },
      };

      assert.throws(
        () => verifyContainerReport(report),
        /CONTAINER_ACCEPTANCE_RETRY_DETECTED/,
      );
    },
  );

  await t.test(
    "fails if the target spec failed",
    () => {
      const report = {
        suites: [
          {
            file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
            specs: [
              {
                file: "e2e/m1-container-lifecycle-acceptance.spec.ts",
                title: "M1 lifecycle",
                tests: [
                  {
                    projectName: "editor",
                    status: "unexpected",
                    results: [{ status: "failed" }],
                  },
                ],
              },
            ],
          },
        ],
        stats: {
          expected: 0,
          unexpected: 1,
          flaky: 0,
          skipped: 0,
        },
      };

      assert.throws(
        () => verifyContainerReport(report),
        /CONTAINER_ACCEPTANCE_FAILED/,
      );
    },
  );
});
