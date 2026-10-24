import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  verifyStartPlan,
  verifyStartReport,
  verifyStartWorkflow,
  verifyStartShardReports,
} from "./check-e2e-start.mjs";
import {
  START_PREVIEW_EXPECTED_SKIPS,
  START_PREVIEW_SHARDS,
  START_PREVIEW_SPECS,
  startPreviewFilesForShard,
} from "./editor-e2e-start.mjs";

const GATE = "process.env.MORPH_E2E_PREVIEW_RUNTIME";

test("the B1 binding acceptance suite is part of full Start verification", () => {
  assert.ok(START_PREVIEW_SPECS.includes("binding-acceptance.spec.ts"));
});

// The plan: every spec reading the gate is run or excluded with a reason.
const sources = {
  "a.spec.ts": `test.skip(${GATE} !== "start")`,
  "b.spec.ts": `if (${GATE} === "start") {}`,
  "c.spec.ts": "test('plain', () => {})",
};
test("a plan classifying every gated spec passes", () => {
  verifyStartPlan(sources, ["a.spec.ts"], { "b.spec.ts": "container only" });
});
test("a gated spec in neither list fails", () => {
  assert.throws(
    () => verifyStartPlan(sources, ["a.spec.ts"], {}),
    /neither run .* nor excluded.*b\.spec\.ts/,
  );
});
test("an exclusion without a reason fails", () => {
  assert.throws(
    () => verifyStartPlan(sources, ["a.spec.ts"], { "b.spec.ts": " " }),
    /without a reason/,
  );
});
test("a listed spec that is missing or not gated fails", () => {
  assert.throws(
    () =>
      verifyStartPlan(sources, ["a.spec.ts", "gone.spec.ts"], {
        "b.spec.ts": "x",
      }),
    /does not exist/,
  );
  assert.throws(
    () =>
      verifyStartPlan(sources, ["a.spec.ts", "c.spec.ts"], {
        "b.spec.ts": "x",
      }),
    /does not read/,
  );
});
test("a spec both run and excluded fails", () => {
  assert.throws(
    () => verifyStartPlan(sources, ["a.spec.ts"], { "a.spec.ts": "x" }),
    /both run and excluded/,
  );
});

// The workflow: the real ci.yml, and the edits that would quietly turn the
// job into one that runs nothing under Start.
const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
test("the CI workflow's full Start job follows the plan", () => {
  verifyStartWorkflow(workflow);
});
test("a job without the Worker's Start runtime fails", () => {
  assert.throws(
    () =>
      verifyStartWorkflow(
        workflow.replace(/^\s+MORPH_THEME_PREVIEW_RUNTIME=start\n/m, "\n"),
      ),
    /MORPH_THEME_PREVIEW_RUNTIME=start/,
  );
});
test("a job without the specs' Start variable fails", () => {
  assert.throws(
    () =>
      verifyStartWorkflow(
        workflow.replace("MORPH_E2E_PREVIEW_RUNTIME: start", "FOO: start"),
      ),
    /MORPH_E2E_PREVIEW_RUNTIME=start/,
  );
});
test("a job running other files, or not checking its report, fails", () => {
  assert.throws(
    () =>
      verifyStartWorkflow(
        workflow.replace(
          "run: node scripts/run-start-preview-shard.mjs ${{ matrix.shard }}",
          "run: pnpm test:e2e:local-preview -- e2e/loader-data-binding.spec.ts",
        ),
      ),
    /exact file plan/,
  );
  assert.throws(
    () =>
      verifyStartWorkflow(
        workflow.replace(
          "run: node scripts/check-e2e-start.mjs test-results/full-start-${{ matrix.shard }}.json ${{ matrix.shard }}",
          "run: true",
        ),
      ),
    /check its report/,
  );
});
test("Start shards allocate every file once and keep a separate aggregate gate", () => {
  assert.deepEqual(START_PREVIEW_SHARDS.flat(), START_PREVIEW_SPECS);
  assert.equal(new Set(START_PREVIEW_SPECS).size, START_PREVIEW_SPECS.length);
  assert.ok(START_PREVIEW_SHARDS.every((shard) => shard.length > 0));
  assert.deepEqual(startPreviewFilesForShard(2), START_PREVIEW_SHARDS[1]);
  assert.throws(() => startPreviewFilesForShard(3), /START_SHARD_INVALID/);
  assert.throws(
    () =>
      verifyStartWorkflow(
        workflow.replace(
          "needs: editor-e2e-full-start",
          "needs: editor-e2e-local-preview",
        ),
      ),
    /Missing Start acceptance wiring/,
  );
});
test("the Start settings in a shard job do not count for the full Start job", () => {
  const withoutJob = workflow.slice(
    0,
    workflow.indexOf("\n  editor-e2e-full-start:\n"),
  );
  assert.throws(() => verifyStartWorkflow(withoutJob), /editor-e2e-full-start/);
});

// The report: Playwright's JSON shape, reduced to what is read.
const spec = (file, title, statuses, project = "editor") => ({
  file,
  specs: [
    {
      file,
      title,
      tests: [
        {
          projectName: project,
          results: statuses.map((status) => ({ status })),
        },
      ],
    },
  ],
});
const passingReport = () => ({
  suites: [
    spec("auth.setup.ts", "authenticate", ["passed"], "setup"),
    spec(
      "preview-transport.spec.ts",
      "transport",
      ["passed"],
      "preview-transport",
    ),
    ...START_PREVIEW_SPECS.map((file) =>
      spec(file, `${file} runs`, ["passed"]),
    ),
    ...START_PREVIEW_EXPECTED_SKIPS.map(({ file, title }) =>
      spec(file, title, ["skipped"]),
    ),
  ],
});
test("a report with every Start test passed and only the listed skips passes", () => {
  assert.deepEqual(verifyStartReport(passingReport()), {
    passed: START_PREVIEW_SPECS.length,
    skipped: START_PREVIEW_EXPECTED_SKIPS.length,
  });
});
test("a Start test skipped instead of run fails the job", () => {
  const report = passingReport();
  report.suites[2] = spec(START_PREVIEW_SPECS[0], "gated", ["skipped"]);
  report.suites.push(spec(START_PREVIEW_SPECS[0], "another", ["passed"]));
  assert.throws(() => verifyStartReport(report), /START_TEST_SKIPPED/);
});
test("a run where the Start runtime reached nothing fails", () => {
  const report = passingReport();
  report.suites = report.suites.map((suite) =>
    suite.specs[0].tests[0].projectName === "editor"
      ? spec(suite.file, suite.specs[0].title, ["skipped"])
      : suite,
  );
  assert.throws(() => verifyStartReport(report), /START_TEST_SKIPPED/);
});
test("a failed or result-less Start test fails", () => {
  const failed = passingReport();
  failed.suites[2] = spec(START_PREVIEW_SPECS[0], "x", ["failed"]);
  failed.suites.push(spec(START_PREVIEW_SPECS[0], "y", ["passed"]));
  assert.throws(() => verifyStartReport(failed), /START_TEST_NOT_PASSED/);
  const empty = passingReport();
  empty.suites[2] = spec(START_PREVIEW_SPECS[0], "x", []);
  empty.suites.push(spec(START_PREVIEW_SPECS[0], "y", ["passed"]));
  assert.throws(() => verifyStartReport(empty), /START_TEST_NOT_PASSED/);
});
test("a listed skip that ran, or no longer exists, fails", () => {
  const ran = passingReport();
  const { file, title } = START_PREVIEW_EXPECTED_SKIPS[0];
  ran.suites = ran.suites.map((suite) =>
    suite.specs[0].title === title ? spec(file, title, ["passed"]) : suite,
  );
  assert.throws(() => verifyStartReport(ran), /START_SKIP_RAN/);
  const gone = passingReport();
  gone.suites = gone.suites.filter((suite) => suite.specs[0].title !== title);
  assert.throws(() => verifyStartReport(gone), /stale entry/);
});
test("a plan spec absent from the report fails", () => {
  const report = passingReport();
  report.suites = report.suites.filter(
    (suite) => suite.file !== START_PREVIEW_SPECS[0],
  );
  assert.throws(() => verifyStartReport(report), /START_SPEC_MISSING/);
});
test("a test from outside the plan fails", () => {
  const report = passingReport();
  report.suites.push(spec("editor.spec.ts", "other", ["passed"]));
  assert.throws(() => verifyStartReport(report), /outside the full Start plan/);
});
test("a skipped or missing precondition fails", () => {
  const skipped = passingReport();
  skipped.suites[1] = spec(
    "preview-transport.spec.ts",
    "transport",
    ["skipped"],
    "preview-transport",
  );
  assert.throws(() => verifyStartReport(skipped), /actually pass/);
  const missing = passingReport();
  missing.suites.shift();
  assert.throws(() => verifyStartReport(missing), /setup precondition/);
});

test("aggregate reads every Start shard's latest attempt and rejects missing or failed coverage", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "morph-start-shards-"));
  const reportFor = (shard) => ({
    suites: [
      spec("auth.setup.ts", "authenticate", ["passed"], "setup"),
      spec(
        "preview-transport.spec.ts",
        "transport",
        ["passed"],
        "preview-transport",
      ),
      ...startPreviewFilesForShard(shard).map((file) =>
        spec(file, `${file} runs`, ["passed"]),
      ),
      ...START_PREVIEW_EXPECTED_SKIPS.filter((skip) =>
        startPreviewFilesForShard(shard).includes(skip.file),
      ).map(({ file, title }) => spec(file, title, ["skipped"])),
    ],
  });
  const put = (shard, attempt, report) => {
    const folder = path.join(
      directory,
      `editor-e2e-full-start-${shard}-attempt-${attempt}`,
    );
    mkdirSync(folder);
    writeFileSync(
      path.join(folder, `full-start-${shard}.json`),
      JSON.stringify(report),
    );
  };
  try {
    put(1, 1, reportFor(1));
    assert.throws(
      () => verifyStartShardReports(directory),
      /Missing report for Start shard 2/,
    );
    put(2, 1, reportFor(2));
    assert.deepEqual(
      verifyStartShardReports(directory).map((result) => result.passed),
      [2, 2],
    );
    const bad = reportFor(2);
    bad.suites[2] = spec(startPreviewFilesForShard(2)[0], "failed", ["failed"]);
    put(2, 2, bad);
    assert.throws(
      () => verifyStartShardReports(directory),
      /START_TEST_NOT_PASSED/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
