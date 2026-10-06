import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDITOR_SHARDS,
  EDITOR_SHARD_COUNT,
  editorShardArguments,
  latestShardReportFiles,
} from "./editor-e2e-shards.mjs";
import { DURATIONS_FILE, budgetWarnings } from "./rebalance-e2e-shards.mjs";

const WORKFLOW_FILE = fileURLToPath(
  new URL("../.github/workflows/ci.yml", import.meta.url),
);

/**
 * The workflow cannot import the plan, so its three shard-count spellings are
 * compared with it: the matrix, the job name `pnpm ship` waits for, and the
 * flag the runner expands. Changing the count means changing all of them in
 * one pull request; a partial change fails here instead of losing a shard.
 */
export function verifyWorkflowWiring(workflow, count = EDITOR_SHARD_COUNT) {
  const matrix = /^\s+shard:\s*\[([^\]]*)\]/m.exec(workflow);
  assert.ok(matrix, "The editor E2E job must declare a shard matrix");
  assert.deepEqual(
    matrix[1].split(",").map((value) => Number(value.trim())),
    Array.from({ length: count }, (_, index) => index + 1),
    `The shard matrix must list 1..${count}, as EDITOR_SHARDS has ${count} shards`,
  );
  assert.ok(
    workflow.includes(`name: Editor E2E shard \${{ matrix.shard }}/${count}\n`),
    `The shard job name must end in /${count}; pnpm ship waits for these names`,
  );
  assert.ok(
    workflow.includes(`--shard=\${{ matrix.shard }}/${count}\n`),
    `The shard job must pass --shard=N/${count} to the runner`,
  );
  assert.ok(
    workflow.includes(
      "name: editor-e2e-results-${{ matrix.shard }}-attempt-${{ github.run_attempt }}\n",
    ),
    "Shard artifacts must be named per run attempt, or a re-run's report is read from the failed attempt",
  );
}

/**
 * The report each shard last produced, in shard order.
 *
 * Re-running failed jobs keeps the run's earlier artifacts: the shards that
 * passed are not re-run, and the one that failed uploads again. With one name
 * per shard both uploads landed in the same download directory and either
 * could win, so a shard that passed on re-run was still read as failed. Each
 * attempt now uploads under its own name and only a shard's latest attempt
 * counts.
 */
export function latestShardReports(files, count = EDITOR_SHARD_COUNT) {
  const latest = latestShardReportFiles(files);
  return Array.from({ length: count }, (_, offset) => {
    const shard = offset + 1;
    const report = latest.find((entry) => entry.shard === shard);
    assert.ok(report, `A report for shard ${shard} is required`);
    assert.equal(
      report.duplicates,
      0,
      `Exactly one report for shard ${shard} attempt ${report.attempt} is required`,
    );
    return report.file;
  });
}

export function records(report) {
  const found = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        found.push({
          id: spec.id,
          project: test.projectName,
          results: test.results ?? [],
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites ?? []) visit(suite);
  return found;
}

// Dependency projects intentionally repeat; editor tests must appear exactly
// once across all shards. Count IDs, not just totals: missing + duplicate tests
// can otherwise cancel each other out.
export function verifyCoverage(
  expected,
  shards,
  executed = false,
  count = EDITOR_SHARD_COUNT,
) {
  assert.equal(shards.length, count, `All ${count} shard reports are required`);
  const wanted = expected
    .filter((r) => r.project === "editor")
    .map((r) => r.id);
  assert.ok(wanted.length > 0, "The full suite must not be empty");
  const actual = [];
  let ran = 0;
  for (const shard of shards) {
    const editor = shard.filter((r) => r.project === "editor");
    assert.ok(editor.length > 0, "Every shard must contain editor tests");
    for (const project of ["setup", "preview-transport"]) {
      const dependencies = shard.filter((r) => r.project === project);
      assert.ok(dependencies.length > 0, `Missing ${project} precondition`);
      if (executed) {
        assert.ok(
          dependencies.every(
            (r) =>
              r.results.length > 0 &&
              r.results.every((v) => v.status === "passed"),
          ),
          `${project} must actually pass`,
        );
      }
    }
    actual.push(...editor.map((r) => r.id));
    if (executed) {
      const passed = editor.filter((r) =>
        r.results.some((v) => v.status === "passed"),
      );
      assert.ok(passed.length > 0, "An all-skipped shard is not acceptance");
      assert.ok(
        editor.every(
          (r) =>
            r.results.length > 0 &&
            r.results.every((v) => ["passed", "skipped"].includes(v.status)),
        ),
        "Failed or unfinished editor test",
      );
      ran += passed.length;
    }
  }
  assert.equal(
    new Set(actual).size,
    actual.length,
    "Duplicate editor test across shards",
  );
  assert.deepEqual(
    actual.sort(),
    wanted.sort(),
    "Shard coverage differs from the complete suite",
  );
  if (executed)
    assert.ok(
      ran >= 20,
      "The original suite execution minimum remains required",
    );
  return shards.map((s) => s.filter((r) => r.project === "editor").length);
}

function list(extra = []) {
  return records(
    JSON.parse(
      execFileSync(
        "npx",
        [
          "playwright",
          "test",
          "--project=editor",
          "--list",
          "--reporter=json",
          ...editorShardArguments(extra),
        ],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      ),
    ),
  );
}

function reportFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? reportFiles(target) : [target];
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  verifyWorkflowWiring(readFileSync(WORKFLOW_FILE, "utf8"));
  const indexes = Array.from(
    { length: EDITOR_SHARD_COUNT },
    (_, index) => index + 1,
  );
  const expected = list();
  const directory = process.argv[2];
  const shards = directory
    ? latestShardReports(reportFiles(directory)).map((file) =>
        records(JSON.parse(readFileSync(file, "utf8"))),
      )
    : indexes.map((index) => list([`--shard=${index}/${EDITOR_SHARD_COUNT}`]));
  console.log(
    `E2E shard coverage verified: ${verifyCoverage(expected, shards, Boolean(directory)).join(" / ")} editor tests`,
  );
  // Advisory only (see budgetWarnings); shown as annotations on the run.
  if (!directory) {
    const { seconds } = JSON.parse(readFileSync(DURATIONS_FILE, "utf8"));
    for (const warning of budgetWarnings(EDITOR_SHARDS, seconds)) {
      console.log(
        process.env.GITHUB_ACTIONS
          ? `::warning::${warning}`
          : `warning: ${warning}`,
      );
    }
  }
}
