// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Validates that the M1 container lifecycle acceptance test actually ran,
 * passed, had zero retries, and had zero skips in the Playwright JSON report.
 *
 * @param {any} report
 * @param {string} [targetFile]
 */
export function verifyContainerReport(
  report,
  targetFile = "m1-container-lifecycle-acceptance.spec.ts",
) {
  assert.ok(report && typeof report === "object", "Report must be an object");
  assert.ok(Array.isArray(report.suites), "Report must contain suites array");

  /** @type {Array<{file: string, title: string, statuses: string[], project: string}>} */
  const records = [];

  /**
   * @param {any} suite
   * @param {string} currentFile
   */
  function collect(suite, currentFile = "") {
    const file = suite.file ? suite.file.replace(/\\/g, "/") : currentFile;
    if (suite.specs) {
      for (const spec of suite.specs) {
        const specFile = spec.file ? spec.file.replace(/\\/g, "/") : file;
        for (const test of spec.tests ?? []) {
          records.push({
            file: specFile,
            title: spec.title ?? "",
            statuses: (test.results ?? []).map((/** @type {any} */ r) => r.status),
            project: test.projectName ?? "",
          });
        }
      }
    }
    if (suite.suites) {
      for (const child of suite.suites) {
        collect(child, file);
      }
    }
  }

  for (const suite of report.suites) {
    collect(suite);
  }

  const editorRecords = records.filter(
    (r) => r.project === "editor" || !r.project,
  );
  const targetRecords = editorRecords.filter((r) =>
    r.file.endsWith(targetFile),
  );

  assert.ok(
    targetRecords.length > 0,
    `CONTAINER_ACCEPTANCE_SPEC_MISSING: ${targetFile} was not found in the test report. Found files: ${[...new Set(editorRecords.map((r) => r.file))].join(", ") || "none"}`,
  );

  for (const record of targetRecords) {
    const { title, statuses } = record;
    assert.ok(
      statuses.length > 0,
      `CONTAINER_ACCEPTANCE_NO_RESULT: ${title} ended without any result statuses.`,
    );
    assert.equal(
      statuses.length,
      1,
      `CONTAINER_ACCEPTANCE_RETRY_DETECTED: ${title} had ${statuses.length} attempts (${statuses.join(", ")}); zero retry is required.`,
    );
    assert.ok(
      !statuses.includes("skipped"),
      `CONTAINER_ACCEPTANCE_SKIPPED: ${title} was skipped; zero skip is required for closed-loop verification.`,
    );
    assert.ok(
      statuses.every((s) => s === "passed"),
      `CONTAINER_ACCEPTANCE_FAILED: ${title} ended with status ${statuses.join(", ")}; must pass.`,
    );
  }

  if (report.stats) {
    assert.equal(
      report.stats.unexpected ?? 0,
      0,
      `Unexpected failures detected in report stats: ${report.stats.unexpected}`,
    );
    assert.equal(
      report.stats.flaky ?? 0,
      0,
      `Flaky tests detected in report stats: ${report.stats.flaky}`,
    );
  }

  return { passedCount: targetRecords.length };
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("check-container-acceptance.mjs")
) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error(
      "Usage: node scripts/check-container-acceptance.mjs <report-path>",
    );
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const { passedCount } = verifyContainerReport(report);
  console.log(
    `M1 container lifecycle acceptance verified: ${passedCount} target test(s) passed with zero skip and zero retry.`,
  );
}
