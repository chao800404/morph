// @ts-check
/**
 * Guards for the full Start preview job (see editor-e2e-start.mjs).
 *
 *   node scripts/check-e2e-start.mjs            static: plan, specs, workflow
 *   node scripts/check-e2e-start.mjs <report>   the job's Playwright JSON report
 *
 * The report check exists because Playwright exits 0 when a test skips itself.
 * Every Start-gated test skips when the Start runtime did not reach it — a
 * missing variable, a renamed one, a gate that changed — and the job would
 * then be green having proven nothing. So a skip is a failure here unless it
 * is one of the listed by-design skips.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jobBlock } from "./ci-workflow.mjs";
import {
  START_PREVIEW_EXCLUDED,
  START_PREVIEW_EXPECTED_SKIPS,
  START_PREVIEW_JOB_NAME,
  START_PREVIEW_SHARDS,
  START_PREVIEW_SHARD_COUNT,
  START_PREVIEW_SPECS,
  startPreviewFilesForShard,
} from "./editor-e2e-start.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKFLOW_FILE = path.join(ROOT, ".github", "workflows", "ci.yml");
const E2E_DIR = path.join(ROOT, "e2e");
const GATE = "MORPH_E2E_PREVIEW_RUNTIME";

/**
 * Every spec reading the Start gate is either run by the job or excluded with
 * a reason, and every listed spec exists and reads it.
 * @param {Record<string, string>} specSources file name → source, e2e/*.spec.ts
 */
export function verifyStartPlan(
  specSources,
  specs = START_PREVIEW_SPECS,
  excluded = START_PREVIEW_EXCLUDED,
) {
  assert.ok(
    START_PREVIEW_SHARDS.every((shard) => shard.length > 0),
    "Empty Start shard",
  );
  assert.ok(specs.length > 0, "The full Start job must run at least one spec");
  assert.equal(
    new Set(specs).size,
    specs.length,
    "A Start spec is listed twice",
  );
  for (const file of specs) {
    assert.ok(!(file in excluded), `${file} is both run and excluded`);
  }
  for (const [file, reason] of Object.entries(excluded)) {
    assert.ok(reason.trim().length > 0, `${file} is excluded without a reason`);
  }
  const gated = Object.keys(specSources)
    .filter((file) => specSources[file].includes(GATE))
    .sort();
  for (const file of [...specs, ...Object.keys(excluded)]) {
    assert.ok(
      file in specSources,
      `${file} is listed but does not exist in e2e/`,
    );
    assert.ok(
      gated.includes(file),
      `${file} is listed but does not read ${GATE}`,
    );
  }
  const unclassified = gated.filter(
    (file) => !specs.includes(file) && !(file in excluded),
  );
  assert.deepEqual(
    unclassified,
    [],
    `Spec(s) reading ${GATE} are neither run by "${START_PREVIEW_JOB_NAME}" nor excluded with a reason (scripts/editor-e2e-start.mjs): ${unclassified.join(", ")}`,
  );
}

/**
 * The job turns the Start runtime on in both places, runs exactly the plan's
 * specs, and checks its own report.
 * @param {string} workflow
 */
export function verifyStartWorkflow(workflow) {
  const job = jobBlock(workflow, "editor-e2e-full-start");
  const lines = job.split("\n").map((line) => line.trim());
  assert.ok(
    lines.includes(
      "name: Editor E2E full Start shard ${{ matrix.shard }}/" +
        START_PREVIEW_SHARD_COUNT,
    ),
    "The Start shard check names must match the required-check plan",
  );
  const matrix = /^\s+shard: \[([^\]]+)\]$/m.exec(job);
  assert.deepEqual(
    matrix?.[1].split(",").map((part) => Number(part.trim())),
    Array.from({ length: START_PREVIEW_SHARD_COUNT }, (_, index) => index + 1),
    "The Start matrix must run every planned shard exactly once",
  );
  assert.ok(
    lines.includes("MORPH_THEME_PREVIEW_RUNTIME=start"),
    "The job must write MORPH_THEME_PREVIEW_RUNTIME=start into .dev.vars.local_preview_e2e, or the Worker serves the client-only preview",
  );
  assert.ok(
    lines.includes("MORPH_E2E_PREVIEW_RUNTIME: start"),
    "The job must set MORPH_E2E_PREVIEW_RUNTIME=start for the specs, or every Start test skips",
  );
  assert.ok(
    lines.includes(
      "MORPH_E2E_REPORT_PATH: test-results/full-start-${{ matrix.shard }}.json",
    ),
    "The job must write a separate report for each Start shard",
  );
  assert.ok(
    lines.includes(
      "run: node scripts/run-start-preview-shard.mjs ${{ matrix.shard }}",
    ),
    "The job must run the exact file plan for its shard",
  );
  assert.ok(
    lines.includes(
      "run: node scripts/check-e2e-start.mjs test-results/full-start-${{ matrix.shard }}.json ${{ matrix.shard }}",
    ),
    "The job must check its report, or a skipped Start test passes",
  );
  assert.ok(
    lines.includes(
      "name: editor-e2e-full-start-${{ matrix.shard }}-attempt-${{ github.run_attempt }}",
    ),
    "Each Start shard attempt must upload its own report",
  );
  const acceptance = jobBlock(workflow, "editor-e2e-full-start-acceptance");
  for (const required of [
    `name: ${START_PREVIEW_JOB_NAME}`,
    "needs: editor-e2e-full-start",
    "if: always()",
    "SHARD_RESULT: ${{ needs.editor-e2e-full-start.result }}",
    'run: test "$SHARD_RESULT" = success',
    "pattern: editor-e2e-full-start-*-attempt-*",
    "run: node scripts/check-e2e-start.mjs start-shard-artifacts",
  ])
    assert.ok(
      acceptance.split("\n").some((line) => line.trim() === required),
      `Missing Start acceptance wiring: ${required}`,
    );
  assert.ok(
    !/--shard=/.test(job),
    "Full Start work is allocated by whole files, not Playwright test sharding",
  );
}

/**
 * Each test in a Playwright JSON report, with its file and title.
 * @param {any} report
 */
export function startRecords(report) {
  /** @type {{file: string, title: string, project: string, statuses: string[]}[]} */
  const found = [];
  /** @param {any} suite */
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        found.push({
          file: path.basename(spec.file ?? suite.file ?? ""),
          title: spec.title,
          project: test.projectName,
          statuses: (test.results ?? []).map(
            (/** @type {any} */ r) => r.status,
          ),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites ?? []) visit(suite);
  return found;
}

/**
 * The job's report shows every Start test as run and passed, except the
 * by-design skips, which must still skip.
 * @param {any} report
 */
export function verifyStartReport(
  report,
  specs = START_PREVIEW_SPECS,
  expectedSkips = START_PREVIEW_EXPECTED_SKIPS,
) {
  const records = startRecords(report);
  for (const project of ["setup", "preview-transport"]) {
    const found = records.filter((r) => r.project === project);
    assert.ok(found.length > 0, `Missing ${project} precondition`);
    assert.ok(
      found.every(
        (r) => r.statuses.length > 0 && r.statuses.every((s) => s === "passed"),
      ),
      `${project} must actually pass`,
    );
  }
  const editor = records.filter((r) => r.project === "editor");
  const name = (/** @type {{file: string, title: string}} */ r) =>
    `${r.file} › ${r.title}`;
  const isExpectedSkip = (/** @type {{file: string, title: string}} */ r) =>
    expectedSkips.some((s) => s.file === r.file && s.title === r.title);
  const outside = editor.filter((r) => !specs.includes(r.file));
  assert.deepEqual(
    outside.map(name),
    [],
    "The report holds tests outside the full Start plan",
  );
  for (const file of specs) {
    assert.ok(
      editor.some((r) => r.file === file),
      `START_SPEC_MISSING: ${file} is in the plan but not in the report`,
    );
  }
  for (const skip of expectedSkips) {
    const found = editor.filter(
      (r) => r.file === skip.file && r.title === skip.title,
    );
    assert.equal(
      found.length,
      1,
      `Expected Start skip not found exactly once (stale entry?): ${name(skip)}`,
    );
  }
  const problems = [];
  let passed = 0;
  for (const record of editor) {
    const { statuses } = record;
    if (isExpectedSkip(record)) {
      if (statuses.length === 0 || !statuses.every((s) => s === "skipped"))
        problems.push(
          `START_SKIP_RAN: ${name(record)} is listed as skipping under Start but ended ${statuses.join(",") || "without a result"}; update the list or the spec`,
        );
    } else if (statuses.length > 0 && statuses.every((s) => s === "skipped")) {
      problems.push(
        `START_TEST_SKIPPED: ${name(record)} was skipped instead of run; the Start runtime did not reach it`,
      );
    } else if (
      statuses.length === 0 ||
      !statuses.every((s) => s === "passed")
    ) {
      problems.push(
        `START_TEST_NOT_PASSED: ${name(record)} ended ${statuses.join(",") || "without a result"}`,
      );
    } else {
      passed += 1;
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  assert.ok(passed > 0, "An all-skipped full Start run is not acceptance");
  return { passed, skipped: expectedSkips.length };
}

/** Latest attempt for each whole-file Start shard. Refuse missing or duplicate reports. */
export function latestStartReports(
  directory,
  count = START_PREVIEW_SHARD_COUNT,
) {
  const latest = new Map();
  for (const artifact of readdirSync(directory)) {
    const match = /^editor-e2e-full-start-(\d+)-attempt-(\d+)$/.exec(artifact);
    if (!match) continue;
    const shard = Number(match[1]);
    const attempt = Number(match[2]);
    assert.ok(shard >= 1 && shard <= count, `Unexpected Start shard ${shard}`);
    const report = path.join(directory, artifact, `full-start-${shard}.json`);
    assert.ok(
      statSync(path.join(directory, artifact)).isDirectory(),
      `${artifact} is not a directory`,
    );
    const previous = latest.get(shard);
    if (!previous || attempt > previous.attempt)
      latest.set(shard, { attempt, report });
  }
  return Array.from({ length: count }, (_, index) => {
    const report = latest.get(index + 1)?.report;
    assert.ok(report, `Missing report for Start shard ${index + 1}`);
    return report;
  });
}

export function verifyStartShardReports(directory) {
  const reports = latestStartReports(directory);
  return reports.map((file, index) =>
    verifyStartReport(
      JSON.parse(readFileSync(file, "utf8")),
      startPreviewFilesForShard(index + 1),
      START_PREVIEW_EXPECTED_SKIPS.filter((skip) =>
        startPreviewFilesForShard(index + 1).includes(skip.file),
      ),
    ),
  );
}

function e2eSpecSources() {
  /** @type {Record<string, string>} */
  const sources = {};
  for (const file of readdirSync(E2E_DIR)) {
    if (file.endsWith(".spec.ts"))
      sources[file] = readFileSync(path.join(E2E_DIR, file), "utf8");
  }
  return sources;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const reportPath = process.argv[2];
  if (reportPath) {
    if (statSync(reportPath).isDirectory()) {
      const summaries = verifyStartShardReports(reportPath);
      console.log(
        `Full Start shards verified: ${summaries.map((summary) => `${summary.passed} passed/${summary.skipped} design skips`).join(", ")}`,
      );
      process.exit(0);
    }
    const shard = Number(process.argv[3]);
    const files = startPreviewFilesForShard(shard);
    const { passed, skipped } = verifyStartReport(
      JSON.parse(readFileSync(reportPath, "utf8")),
      files,
      START_PREVIEW_EXPECTED_SKIPS.filter((skip) => files.includes(skip.file)),
    );
    console.log(
      `Full Start report verified: ${passed} passed, ${skipped} skipped by design, none skipped otherwise`,
    );
  } else {
    verifyStartPlan(e2eSpecSources());
    verifyStartWorkflow(readFileSync(WORKFLOW_FILE, "utf8"));
    console.log(
      `Full Start plan verified: ${START_PREVIEW_SPECS.length} spec(s) run, ${Object.keys(START_PREVIEW_EXCLUDED).length} excluded with a reason`,
    );
  }
}
