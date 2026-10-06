import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  latestShardReports,
  verifyCoverage,
  verifyWorkflowWiring,
} from "./check-e2e-shards.mjs";
import {
  EDITOR_SHARDS,
  EDITOR_SHARD_COUNT,
  editorShardArguments,
} from "./editor-e2e-shards.mjs";
import {
  allocate,
  budgetWarnings,
  fileDurations,
  project,
} from "./rebalance-e2e-shards.mjs";

const N = EDITOR_SHARD_COUNT;

test("balanced whole-file plan contains each file once and matches exact paths", () => {
  const files = EDITOR_SHARDS.flat();
  assert.ok(files.length > 0);
  assert.equal(new Set(files).size, files.length);
  for (const [index, shard] of EDITOR_SHARDS.entries()) {
    const args = editorShardArguments([`--shard=${index + 1}/${N}`]);
    assert.equal(args.length, shard.length);
    assert.ok(!args.some((arg) => arg.startsWith("--shard")));
    for (const [i, file] of shard.entries()) {
      const pattern = new RegExp(args[i]);
      assert.ok(pattern.test(`/repo/e2e/${file}`));
      assert.ok(pattern.test(`C:\\repo\\e2e\\${file}`));
      assert.ok(!pattern.test(`/repo/e2e/${file}.backup`));
      assert.ok(!pattern.test(`/repo/not-e2e/${file}`));
    }
  }
});
test("full and focused invocations are not narrowed", () => {
  assert.deepEqual(editorShardArguments([]), []);
  assert.deepEqual(editorShardArguments(["editor.spec.ts", "--grep=save"]), [
    "editor.spec.ts",
    "--grep=save",
  ]);
});
test("invalid and duplicate shard flags fail rather than silently losing coverage", () => {
  for (const args of [
    [`--shard=0/${N}`],
    [`--shard=${N + 1}/${N}`],
    [`--shard=1/${N + 1}`],
    [`--shard=1/${N}`, `--shard=2/${N}`],
    ["--shard=1"],
  ]) {
    assert.throws(() => editorShardArguments(args), /EDITOR_SHARD_INVALID/);
  }
});

const record = (id, project = "editor", status = "passed") => ({
  id,
  project,
  results: [{ status }],
});
// Fixtures stay at three shards whatever the plan's count, passed explicitly.
const expected = Array.from({ length: 21 }, (_, i) => record(`test-${i}`));
const shards = () =>
  [0, 1, 2].map((n) => [
    record("auth", "setup"),
    record("transport", "preview-transport"),
    ...expected.slice(n * 7, n * 7 + 7),
  ]);
const verify = (wanted, reports, executed = false) =>
  verifyCoverage(wanted, reports, executed, 3);

test("complete isolated shards retain exact coverage and both preconditions", () => {
  assert.deepEqual(verify(expected, shards(), true), [7, 7, 7]);
});
test("the report count follows the plan's shard count", () => {
  assert.throws(
    () => verifyCoverage(expected, shards(), true, 4),
    /All 4 shard reports/,
  );
});
test("missing report fails", () =>
  assert.throws(() => verify(expected, shards().slice(1), true)));
test("a new collected test absent from the allocation fails", () => {
  assert.throws(
    () => verify([...expected, record("new-file-test")], shards(), true),
    /coverage differs/,
  );
});
test("a missing test fails even without a duplicate and with enough tests run", () => {
  const reports = shards();
  reports[2].pop();
  assert.throws(() => verify(expected, reports, true), /coverage differs/);
});
test("a missing test replaced by a duplicate cannot preserve acceptance", () => {
  const reports = shards();
  reports[2][2] = reports[0][2];
  assert.throws(() => verify(expected, reports, true), /Duplicate/);
});
test("missing transport precondition fails", () => {
  const reports = shards();
  reports[1].splice(1, 1);
  assert.throws(() => verify(expected, reports, true), /preview-transport/);
});
test("skipped authentication is not a passing precondition", () => {
  const reports = shards();
  reports[0][0] = record("auth", "setup", "skipped");
  assert.throws(() => verify(expected, reports, true), /actually pass/);
});
test("all-skipped shard fails", () => {
  const reports = shards();
  reports[0] = reports[0].map((r) =>
    r.project === "editor" ? record(r.id, r.project, "skipped") : r,
  );
  assert.throws(() => verify(expected, reports, true), /all-skipped/);
});
test("failed test fails even when other shards pass", () => {
  const reports = shards();
  reports[0][2] = record("test-0", "editor", "failed");
  assert.throws(() => verify(expected, reports, true), /Failed/);
});
test("empty expected suite fails", () =>
  assert.throws(() => verify([], shards()), /empty/));

// The workflow's three spellings of the shard count must follow the plan.
const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
test("the CI workflow is wired for the plan's shard count", () => {
  verifyWorkflowWiring(workflow);
});
test("a matrix, job name or runner flag left at another count fails", () => {
  const ones = Array.from({ length: N }, (_, i) => i + 1).join(", ");
  const grown = Array.from({ length: N + 1 }, (_, i) => i + 1).join(", ");
  assert.throws(
    () =>
      verifyWorkflowWiring(
        workflow.replace(`shard: [${ones}]`, `shard: [${grown}]`),
      ),
    /matrix must list/,
  );
  assert.throws(
    () =>
      verifyWorkflowWiring(
        workflow.replace(
          `name: Editor E2E shard \${{ matrix.shard }}/${N}`,
          `name: Editor E2E shard \${{ matrix.shard }}/${N + 1}`,
        ),
      ),
    /job name/,
  );
  assert.throws(
    () =>
      verifyWorkflowWiring(
        workflow.replace(
          `--shard=\${{ matrix.shard }}/${N}`,
          `--shard=\${{ matrix.shard }}/${N + 1}`,
        ),
      ),
    /--shard=N/,
  );
});
test("shard artifacts left with one name per shard fail", () => {
  assert.throws(
    () =>
      verifyWorkflowWiring(
        workflow.replace(
          "name: editor-e2e-results-${{ matrix.shard }}-attempt-${{ github.run_attempt }}",
          "name: editor-e2e-results-${{ matrix.shard }}",
        ),
      ),
    /per run attempt/,
  );
});

// What download-artifact lays out for a run whose shard 1 failed and was
// re-run: shards 2 and 3 only have their first attempt.
const downloaded = (...dirs) =>
  dirs.map(([shard, attempt]) =>
    path.join(
      "shard-artifacts",
      `editor-e2e-results-${shard}-attempt-${attempt}`,
      `shard-${shard}.json`,
    ),
  );
test("a re-run shard's latest attempt is the one read", () => {
  const files = downloaded([1, 1], [1, 2], [2, 1], [3, 1]);
  assert.deepEqual(
    latestShardReports(files, 3),
    [files[1], files[2], files[3]],
  );
});
test("the order artifacts arrive in does not change which attempt is read", () => {
  const files = downloaded([1, 2], [1, 1], [2, 1], [3, 1]);
  assert.equal(latestShardReports(files, 3)[0], files[0]);
});
test("a shard with no report fails", () =>
  assert.throws(
    () => latestShardReports(downloaded([1, 1], [3, 1]), 3),
    /shard 2 is required/,
  ));
test("a report outside an attempt-named artifact is not read", () =>
  assert.throws(
    () =>
      latestShardReports(
        [path.join("shard-artifacts", "editor-e2e-results-1", "shard-1.json")],
        1,
      ),
    /shard 1 is required/,
  ));
test("a report filed under another shard's artifact is not read", () =>
  assert.throws(
    () =>
      latestShardReports(
        [
          path.join(
            "shard-artifacts",
            "editor-e2e-results-2-attempt-1",
            "shard-1.json",
          ),
        ],
        1,
      ),
    /shard 1 is required/,
  ));

const report = (file, durations, project = "editor") => ({
  suites: [
    {
      file,
      specs: [
        {
          file,
          tests: durations.map((duration) => ({
            projectName: project,
            results: [{ duration, status: "passed" }],
          })),
        },
      ],
      suites: [],
    },
  ],
});
test("durations sum editor test bodies per file, across reports and retries", () => {
  assert.deepEqual(
    fileDurations([
      report("a.spec.ts", [1000, 2500]),
      report("b.spec.ts", [400]),
      report("a.spec.ts", [500]),
      report("auth.setup.ts", [9000], "setup"),
    ]),
    { "a.spec.ts": 4, "b.spec.ts": 0.4 },
  );
});
test("allocation is longest-first onto the lightest shard, and deterministic", () => {
  const durations = { a: 7, b: 5, c: 4, d: 3, e: 3, f: 2 };
  const plan = allocate(durations, 3);
  assert.deepEqual(plan, [
    ["a", "f"],
    ["b", "e"],
    ["c", "d"],
  ]);
  assert.deepEqual(project(plan, durations).seconds, [9, 8, 7]);
  assert.deepEqual(allocate({ ...durations }, 3), plan);
  assert.equal(allocate(durations, 1)[0].length, 6);
  assert.throws(() => allocate(durations, 0), /COUNT_INVALID/);
});
test("budget warnings name the shard over budget, an unmeasured file and a too-small count", () => {
  const warnings = budgetWarnings(
    [["a", "new"], ["b"]],
    { a: 500, b: 100 },
    480,
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /shard 1\/2 projects 500s/);
  assert.match(warnings[1], /new has no measured duration/);
  assert.match(
    budgetWarnings([["a"], ["b"]], { a: 500, b: 500 }, 480).at(-1),
    /cannot fit 2 shards/,
  );
  assert.deepEqual(budgetWarnings([["a"], ["b"]], { a: 400, b: 400 }, 480), []);
});
// Recorded durations are advisory input, not a gate: a new spec has none until
// a CI run measures it. Only the file's shape is checked here.
test("recorded durations name their source run and hold seconds per file", () => {
  const recorded = JSON.parse(
    readFileSync(
      new URL("./editor-e2e-durations.json", import.meta.url),
      "utf8",
    ),
  );
  assert.match(recorded.source, /CI run \d+/);
  for (const [file, value] of Object.entries(recorded.seconds)) {
    assert.match(file, /\.spec\.ts$/);
    assert.ok(Number.isFinite(value) && value >= 0);
  }
});
