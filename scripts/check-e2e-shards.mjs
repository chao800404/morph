import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDITOR_SHARDS,
  EDITOR_SHARD_COUNT,
  editorShardArguments,
  latestShardReportFiles,
} from "./editor-e2e-shards.mjs";
import { DURATIONS_FILE, budgetWarnings } from "./rebalance-e2e-shards.mjs";
import { EXPECTED_CI_CHECKS } from "./ci-required-checks.mjs";
import {
  jobBlock,
  withoutComments,
  workflowCheckNames,
} from "./ci-workflow.mjs";

const WORKFLOW_FILE = fileURLToPath(
  new URL("../.github/workflows/ci.yml", import.meta.url),
);
const E2E_DIRECTORY = fileURLToPath(new URL("../e2e/", import.meta.url));

/**
 * Every file the plan allocates exists under e2e/. The coverage check below
 * compares collected test IDs, and a planned file that is gone simply
 * collects nothing, so a deleted spec could stay named in the plan unnoticed.
 */
export function verifyPlannedFilesExist(
  shards = EDITOR_SHARDS,
  exists = (file) => existsSync(path.join(E2E_DIRECTORY, file)),
) {
  const missing = shards.flat().filter((file) => !exists(file));
  assert.deepEqual(
    missing,
    [],
    `The shard plan names files that do not exist in e2e/: ${missing.join(", ")}`,
  );
}

/**
 * The plan itself: at least one shard, no empty shard (the runner would turn
 * it into a run of nothing, and the acceptance job would refuse it only after
 * a whole CI run), and no file on two shards (its tests would run twice, on
 * two databases). The full-suite comparison below catches both too, but only
 * with Playwright collecting; this fails first, naming the file.
 */
export function verifyPlanShape(shards = EDITOR_SHARDS) {
  assert.ok(
    Array.isArray(shards) && shards.length > 0,
    "EDITOR_SHARDS must list at least one shard",
  );
  for (const [index, files] of shards.entries())
    assert.ok(
      Array.isArray(files) && files.length > 0,
      `Editor E2E shard ${index + 1}/${shards.length} is empty`,
    );
  const seen = new Map();
  const duplicates = [];
  for (const [index, files] of shards.entries())
    for (const file of files) {
      if (seen.has(file))
        duplicates.push(`${file} (shards ${seen.get(file)} and ${index + 1})`);
      else seen.set(file, index + 1);
    }
  assert.deepEqual(
    duplicates,
    [],
    `A file is planned on more than one shard: ${duplicates.join(", ")}`,
  );
}

/**
 * The workflow cannot import the plan, so its three shard-count spellings are
 * compared with it: the matrix, the job name `pnpm ship` waits for, and the
 * flag the runner expands. Changing the count means changing all of them in
 * one pull request; a partial change fails here instead of losing a shard.
 * A spelling left at another count anywhere in the workflow fails too, so an
 * old job or step kept next to the new one cannot pass.
 *
 * Each spelling is read from the job it belongs to (the shard job
 * `editor-e2e-local-preview`, the acceptance job `editor-e2e-acceptance`), with
 * comment lines dropped: matched against the whole file, a matrix, name, flag
 * or artifact in some other job satisfied the rule. The stale-count scan and
 * the stray-artifact scan stay whole-file, since a leftover anywhere is wrong.
 */
export function verifyWorkflowWiring(workflow, count = EDITOR_SHARD_COUNT) {
  const shardJob = withoutComments(
    jobBlock(workflow, "editor-e2e-local-preview"),
  );
  const acceptanceJob = withoutComments(
    jobBlock(workflow, "editor-e2e-acceptance"),
  );
  const matrixPattern = /^\s+shard:\s*\[([^\]]*)\]/gm;
  const otherMatrices =
    [...workflow.matchAll(matrixPattern)].length -
    [...jobBlock(workflow, "editor-e2e-full-start").matchAll(matrixPattern)]
      .length;
  assert.equal(
    otherMatrices,
    1,
    "The workflow must declare exactly one editor E2E shard matrix outside the full Start job",
  );
  const matrices = [...shardJob.matchAll(matrixPattern)];
  assert.equal(
    matrices.length,
    1,
    "The editor E2E shard matrix must be declared in the editor-e2e-local-preview job",
  );
  assert.deepEqual(
    matrices[0][1].split(",").map((value) => Number(value.trim())),
    Array.from({ length: count }, (_, index) => index + 1),
    `The shard matrix must list 1..${count} once each, as EDITOR_SHARDS has ${count} shards`,
  );
  assert.ok(
    shardJob.includes(
      `\n    name: Editor E2E shard \${{ matrix.shard }}/${count}\n`,
    ),
    `The shard job name must end in /${count}; pnpm ship waits for these names`,
  );
  assert.ok(
    shardJob.includes(`--shard=\${{ matrix.shard }}/${count}\n`),
    `The shard job must pass --shard=N/${count} to the runner`,
  );
  const stale = [
    ...workflow.matchAll(/Editor E2E shard [^\n/]*\/(\d+)/g),
    ...workflow.matchAll(/--shard=[^\n/]*\/(\d+)/g),
  ]
    .filter((match) => Number(match[1]) !== count)
    .map((match) => match[0]);
  assert.deepEqual(
    stale,
    [],
    `Shard names or flags for another count remain in the workflow: ${stale.join(", ")}`,
  );
  assert.ok(
    shardJob.includes(
      "name: editor-e2e-results-${{ matrix.shard }}-attempt-${{ github.run_attempt }}\n",
    ),
    "Shard artifacts must be named per run attempt, or a re-run's report is read from the failed attempt",
  );
  // Uploaded and downloaded names only; a comment may mention the pattern.
  const artifacts = [
    ...workflow.matchAll(
      /^\s*(?:name|pattern):\s*(editor-e2e-results-[^\n]*?)\s*$/gm,
    ),
  ]
    .map((match) => match[1])
    .filter(
      (name) =>
        name !==
          "editor-e2e-results-${{ matrix.shard }}-attempt-${{ github.run_attempt }}" &&
        name !== "editor-e2e-results-*",
    );
  assert.deepEqual(
    artifacts,
    [],
    `Shard artifacts must use the per-attempt name only: ${artifacts.join(", ")}`,
  );
  // The acceptance job is the check that says every shard ran: it must wait
  // for the whole matrix, refuse anything but success, and read every report.
  for (const [wiring, reason] of [
    ["needs: editor-e2e-local-preview\n", "wait for the shard matrix"],
    [
      "SHARD_RESULT: ${{ needs.editor-e2e-local-preview.result }}\n",
      "read the matrix result",
    ],
    [
      'run: test "$SHARD_RESULT" = success\n',
      "refuse a matrix that did not succeed",
    ],
    ["pattern: editor-e2e-results-*\n", "download every shard's report"],
    [
      "node scripts/check-e2e-shards.mjs shard-artifacts\n",
      "check the downloaded reports",
    ],
  ])
    assert.ok(
      acceptanceJob.includes(wiring),
      `The acceptance job must ${reason} (${wiring.trim()})`,
    );
}

/**
 * ci.yml's jobs report exactly the checks `pnpm ship` waits for
 * (EXPECTED_CI_CHECKS). A job renamed or removed would otherwise leave ship
 * waiting for, or refusing on, a name that never arrives; a job added without
 * the list would never be waited for.
 */
export function verifyCheckNameContract(
  workflow,
  expected = EXPECTED_CI_CHECKS,
) {
  const reported = workflowCheckNames(workflow);
  const duplicates = reported.filter(
    (name, index) => reported.indexOf(name) !== index,
  );
  assert.deepEqual(
    duplicates,
    [],
    `Two ci.yml jobs report the same check name: ${duplicates.join(", ")}`,
  );
  const missing = expected.filter((name) => !reported.includes(name));
  const unlisted = reported.filter((name) => !expected.includes(name));
  assert.deepEqual(
    { missing, unlisted },
    { missing: [], unlisted: [] },
    `CHECK_NAME_CONTRACT: ci.yml's job names and EXPECTED_CI_CHECKS (scripts/ci-required-checks.mjs) differ; missing from ci.yml: ${missing.join(", ") || "none"}; not in the list: ${unlisted.join(", ") || "none"}`,
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
  verifyPlanShape();
  const workflow = readFileSync(WORKFLOW_FILE, "utf8");
  verifyWorkflowWiring(workflow);
  verifyCheckNameContract(workflow);
  verifyPlannedFilesExist();
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
