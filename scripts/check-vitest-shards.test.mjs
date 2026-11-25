// @ts-check
/**
 * Run by `node --test`, beside the script, for the reason `ship.test.mjs`
 * gives: vitest collects `src/**`, and this guard decides whether a Vitest run
 * counts.
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  VITEST_SHARD_CHECKS,
  VITEST_SHARD_COUNT,
  expectedFiles,
  latestVitestReports,
  shardFiles,
  verifyVitestShardCoverage,
  vitestReportAttempt,
} from "./check-vitest-shards.mjs";

const ROOT = "/work/morph";
const at = (file) => path.join(ROOT, file);
const SUITE = [
  "src/a.test.ts",
  "src/b.test.tsx",
  "src/c.test.ts",
  "packages/x/src/d.test.ts",
];
const report = (files, overrides = {}) => ({
  success: true,
  testResults: files.map((file) => ({ name: at(file), status: "passed" })),
  ...overrides,
});
const artifact = (shard, attempt) =>
  `artifacts/vitest-results-${shard}-attempt-${attempt}/vitest-shard-${shard}.json`;

test("three shards named as pnpm ship waits for them", () => {
  assert.equal(VITEST_SHARD_COUNT, 3);
  assert.deepEqual(VITEST_SHARD_CHECKS, [
    "Validation tests shard 1/3",
    "Validation tests shard 2/3",
    "Validation tests shard 3/3",
  ]);
});

test("a complete, disjoint split passes and reports per-shard counts", () => {
  assert.deepEqual(
    verifyVitestShardCoverage(SUITE, [
      ["src/a.test.ts"],
      ["src/b.test.tsx", "packages/x/src/d.test.ts"],
      ["src/c.test.ts"],
    ]),
    [1, 2, 1],
  );
});

test("a file run by no shard fails, naming it", () => {
  assert.throws(
    () =>
      verifyVitestShardCoverage(SUITE, [
        ["src/a.test.ts"],
        ["src/b.test.tsx"],
        ["src/c.test.ts"],
      ]),
    /not run: packages\/x\/src\/d\.test\.ts/,
  );
});

test("a file run by two shards fails, even when the totals still match", () => {
  assert.throws(
    () =>
      verifyVitestShardCoverage(SUITE, [
        ["src/a.test.ts", "src/b.test.tsx"],
        ["src/b.test.tsx", "packages/x/src/d.test.ts"],
        ["src/c.test.ts"],
      ]),
    /more than one Vitest shard: src\/b\.test\.tsx \(shards 1, 2\)/,
  );
});

test("a file outside the collected suite fails", () => {
  assert.throws(
    () =>
      verifyVitestShardCoverage(SUITE, [
        ["src/a.test.ts", "src/stray.test.ts"],
        ["src/b.test.tsx", "packages/x/src/d.test.ts"],
        ["src/c.test.ts"],
      ]),
    /not in the suite: src\/stray\.test\.ts/,
  );
});

test("an empty shard or a missing shard fails", () => {
  assert.throws(
    () => verifyVitestShardCoverage(SUITE, [SUITE, [], []]),
    /shard 2 ran no test files/,
  );
  assert.throws(
    () => verifyVitestShardCoverage(SUITE, [SUITE.slice(0, 2), SUITE.slice(2)]),
    /All 3 Vitest shard reports/,
  );
});

test("a shard report must say it succeeded, ran files, and every file passed", () => {
  assert.deepEqual(shardFiles(report(["src/a.test.ts"]), ROOT, 1), [
    "src/a.test.ts",
  ]);
  assert.throws(
    () => shardFiles(report(["src/a.test.ts"], { success: false }), ROOT, 1),
    /did not report a successful run/,
  );
  assert.throws(
    () => shardFiles(report([]), ROOT, 2),
    /shard 2 ran no test files/,
  );
  const failed = report(["src/a.test.ts", "src/b.test.tsx"]);
  failed.testResults[1].status = "failed";
  assert.throws(
    () => shardFiles(failed, ROOT, 3),
    /did not pass: .*b\.test\.tsx \(failed\)/,
  );
  assert.throws(
    () => shardFiles(/** @type {any} */ (null), ROOT, 1),
    /did not report a successful run/,
  );
});

test("the expected list is repository-relative and refuses files collected twice or outside the root", () => {
  assert.deepEqual(
    expectedFiles(
      [
        { file: at("src/a.test.ts"), projectName: "unit" },
        { file: at("packages/x/src/d.test.ts"), projectName: "parser-worker" },
      ],
      ROOT,
    ),
    ["src/a.test.ts", "packages/x/src/d.test.ts"],
  );
  assert.throws(
    () =>
      expectedFiles(
        [
          { file: at("src/a.test.ts"), projectName: "unit" },
          { file: at("src/a.test.ts"), projectName: "theme-build" },
        ],
        ROOT,
      ),
    /more than one Vitest project: src\/a\.test\.ts/,
  );
  assert.throws(() => expectedFiles([], ROOT), /must not be empty/);
  assert.throws(
    () => expectedFiles([{ file: "/elsewhere/src/a.test.ts" }], ROOT),
    /outside the repository root/,
  );
});

test("report files are read from their per-attempt artifact names only", () => {
  assert.deepEqual(vitestReportAttempt(artifact(2, 3)), {
    shard: 2,
    attempt: 3,
  });
  for (const file of [
    "artifacts/vitest-results-2-attempt-3/vitest-shard-1.json",
    "artifacts/vitest-results-2/vitest-shard-2.json",
    "artifacts/vitest-shard-2.json",
    "artifacts/editor-e2e-results-2-attempt-1/shard-2.json",
  ])
    assert.equal(vitestReportAttempt(file), null, file);
});

test("each shard's latest attempt wins, so a passing re-run replaces a failed first attempt", () => {
  assert.deepEqual(
    latestVitestReports([
      artifact(1, 1),
      artifact(2, 1),
      artifact(2, 2),
      artifact(3, 1),
      "artifacts/unrelated.txt",
    ]),
    [artifact(1, 1), artifact(2, 2), artifact(3, 1)],
  );
});

test("a missing shard, a duplicate report or a shard outside the plan fails", () => {
  assert.throws(
    () => latestVitestReports([artifact(1, 1), artifact(3, 1)]),
    /report for shard 2\/3 is required/,
  );
  assert.throws(
    () =>
      latestVitestReports([
        artifact(1, 1),
        artifact(2, 1),
        `other/vitest-results-2-attempt-1/vitest-shard-2.json`,
        artifact(3, 1),
      ]),
    /Exactly one Vitest report for shard 2 attempt 1/,
  );
  assert.throws(
    () =>
      latestVitestReports([
        artifact(1, 1),
        artifact(2, 1),
        artifact(3, 1),
        artifact(4, 1),
      ]),
    /outside 1\.\.3: 4/,
  );
});
