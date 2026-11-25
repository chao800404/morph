// @ts-check
/**
 * The Vitest suite runs as VITEST_SHARD_COUNT shard jobs (`pnpm test
 * --shard=N/COUNT` in ci.yml's `validate-test-shard`), and `Validation tests`
 * is the job that says the whole suite ran. A green shard is not evidence that
 * the others ran, and a shard that ran nothing would exit 0 under
 * `--passWithNoTests`, so this compares what the shards actually executed with
 * what `pnpm test` collects:
 *
 *   node scripts/check-vitest-shards.mjs <downloaded-artifacts-directory>
 *
 * Every file `vitest list --filesOnly` names (the same config and the same
 * include/exclude globs `pnpm test` uses; it globs and imports no test file)
 * must appear in exactly one shard's latest-attempt JSON report, every report
 * must say its run succeeded, and no report may name a file outside that list.
 *
 * Why `--passWithNoTests` at all: Vitest shards each `groupOrder` group on its
 * own, and the parser-worker group holds one file, so without it Vitest refuses
 * `--shard=N/3` for every shard ("--shard <count> must be a smaller than count
 * of test files"). This check is what keeps that flag from letting an empty
 * shard pass.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VITEST_SHARD_COUNT = 3;

/** @param {number} shard @param {number} [count] */
export const vitestShardCheckName = (shard, count = VITEST_SHARD_COUNT) =>
  `Validation tests shard ${shard}/${count}`;

export const VITEST_SHARD_CHECKS = Array.from(
  { length: VITEST_SHARD_COUNT },
  (_, index) => vitestShardCheckName(index + 1),
);

/**
 * `vitest-results-<shard>-attempt-<attempt>/vitest-shard-<shard>.json`, the
 * name the shard job uploads under (see ci.yml); `null` for anything else.
 * Re-running failed jobs keeps a run's earlier artifacts, so a download can
 * hold a shard's first attempt next to its re-run.
 * @param {string} file
 */
export function vitestReportAttempt(file) {
  const report = /^vitest-shard-(\d+)\.json$/.exec(path.basename(file));
  const artifact = /^vitest-results-(\d+)-attempt-(\d+)$/.exec(
    path.basename(path.dirname(file)),
  );
  if (!report || !artifact || report[1] !== artifact[1]) return null;
  return { shard: Number(report[1]), attempt: Number(artifact[2]) };
}

/**
 * Each shard's latest-attempt report file, in shard order. Every shard must
 * have one, and exactly one per attempt.
 * @param {string[]} files
 * @param {number} [count]
 */
export function latestVitestReports(files, count = VITEST_SHARD_COUNT) {
  /** @type {Map<number, {file: string, attempt: number, duplicates: number}>} */
  const latest = new Map();
  for (const file of files) {
    const parsed = vitestReportAttempt(file);
    if (!parsed) continue;
    const current = latest.get(parsed.shard);
    if (!current || parsed.attempt > current.attempt)
      latest.set(parsed.shard, {
        file,
        attempt: parsed.attempt,
        duplicates: 0,
      });
    else if (parsed.attempt === current.attempt) current.duplicates += 1;
  }
  const unplanned = [...latest.keys()].filter(
    (shard) => shard < 1 || shard > count,
  );
  assert.deepEqual(
    unplanned,
    [],
    `Reports for shards outside 1..${count}: ${unplanned.join(", ")}`,
  );
  return Array.from({ length: count }, (_, offset) => {
    const shard = offset + 1;
    const report = latest.get(shard);
    assert.ok(
      report,
      `A Vitest report for shard ${shard}/${count} is required`,
    );
    assert.equal(
      report.duplicates,
      0,
      `Exactly one Vitest report for shard ${shard} attempt ${report.attempt} is required`,
    );
    return report.file;
  });
}

/**
 * A path relative to the repository root, `/`-separated.
 * @param {string} root
 * @param {string} file
 */
function repoRelative(root, file) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  assert.ok(
    relative && !relative.startsWith("../") && !path.isAbsolute(relative),
    `${file} is outside the repository root ${root}`,
  );
  return relative;
}

/**
 * The files `pnpm test` runs, from `vitest list --filesOnly --json` output
 * (`[{file, projectName}]`). A file collected by two projects would run twice;
 * the shard reports name files only, so that is refused here rather than
 * counted once.
 * @param {ReadonlyArray<{file: string, projectName?: string}>} listed
 * @param {string} root
 */
export function expectedFiles(listed, root) {
  assert.ok(Array.isArray(listed), "vitest list output must be an array");
  const files = listed.map((entry) => repoRelative(root, entry.file));
  const duplicates = files.filter(
    (file, index) => files.indexOf(file) !== index,
  );
  assert.deepEqual(
    duplicates,
    [],
    `Files collected by more than one Vitest project: ${duplicates.join(", ")}`,
  );
  assert.ok(files.length > 0, "The full Vitest suite must not be empty");
  return files;
}

/**
 * The files one shard ran, from its Vitest JSON report. The report must say
 * the run succeeded, name at least one file, and every file must have passed.
 * @param {{success?: unknown, testResults?: ReadonlyArray<{name: string, status: string}>}} report
 * @param {string} root
 * @param {number} shard
 */
export function shardFiles(report, root, shard) {
  assert.equal(
    report?.success,
    true,
    `Vitest shard ${shard} did not report a successful run`,
  );
  const results = report.testResults ?? [];
  assert.ok(
    Array.isArray(results) && results.length > 0,
    `Vitest shard ${shard} ran no test files`,
  );
  const failed = results
    .filter((result) => result.status !== "passed")
    .map((result) => `${result.name} (${result.status})`);
  assert.deepEqual(
    failed,
    [],
    `Vitest shard ${shard} reports files that did not pass: ${failed.join(", ")}`,
  );
  return results.map((result) => repoRelative(root, result.name));
}

/**
 * Every expected file ran in exactly one shard, and nothing else ran. Missing
 * and duplicated files are compared by name, not by count, so one of each
 * cannot cancel out.
 * @param {readonly string[]} expected
 * @param {ReadonlyArray<readonly string[]>} shards
 * @param {number} [count]
 */
export function verifyVitestShardCoverage(
  expected,
  shards,
  count = VITEST_SHARD_COUNT,
) {
  assert.equal(
    shards.length,
    count,
    `All ${count} Vitest shard reports are required`,
  );
  /** @type {Map<string, number[]>} */
  const ranIn = new Map();
  for (const [index, files] of shards.entries()) {
    assert.ok(files.length > 0, `Vitest shard ${index + 1} ran no test files`);
    for (const file of files) {
      const seen = ranIn.get(file) ?? [];
      seen.push(index + 1);
      ranIn.set(file, seen);
    }
  }
  const duplicated = [...ranIn]
    .filter(([, seen]) => seen.length > 1)
    .map(([file, seen]) => `${file} (shards ${seen.join(", ")})`);
  assert.deepEqual(
    duplicated,
    [],
    `Test files run by more than one Vitest shard: ${duplicated.join(", ")}`,
  );
  const wanted = new Set(expected);
  const missing = expected.filter((file) => !ranIn.has(file));
  const unexpected = [...ranIn.keys()].filter((file) => !wanted.has(file));
  assert.deepEqual(
    { missing, unexpected },
    { missing: [], unexpected: [] },
    `Vitest shard coverage differs from the complete suite; not run: ${missing.join(", ") || "none"}; not in the suite: ${unexpected.join(", ") || "none"}`,
  );
  return shards.map((files) => files.length);
}

/** @param {string} directory @returns {string[]} */
function reportFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? reportFiles(target) : [target];
  });
}

/** `pnpm exec vitest list --filesOnly`: globs the suite, runs nothing. */
function listSuite() {
  const directory = mkdtempSync(path.join(tmpdir(), "vitest-list-"));
  const output = path.join(directory, "files.json");
  try {
    execFileSync(
      "pnpm",
      ["exec", "vitest", "list", "--filesOnly", `--json=${output}`],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    return JSON.parse(readFileSync(output, "utf8"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const directory = process.argv[2];
  assert.ok(
    directory,
    "usage: node scripts/check-vitest-shards.mjs <downloaded-artifacts-directory>",
  );
  const root = process.cwd();
  const expected = expectedFiles(listSuite(), root);
  const shards = latestVitestReports(reportFiles(directory)).map(
    (file, index) =>
      shardFiles(JSON.parse(readFileSync(file, "utf8")), root, index + 1),
  );
  const counts = verifyVitestShardCoverage(expected, shards);
  console.log(
    `Vitest shard coverage verified: ${counts.join(" / ")} of ${expected.length} test files`,
  );
}
