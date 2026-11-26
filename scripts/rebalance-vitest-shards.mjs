// @ts-check
/**
 * Regenerates `scripts/vitest-shard-durations.json`, the per-file durations
 * the Vitest shard sequencer (scripts/vitest-shard-sequencer.mjs) plans from,
 * out of real CI reports.
 *
 *   gh run download <run-id> --repo chao800404/morph \
 *     --pattern 'vitest-results-*' --dir reports/<run-id>
 *   node scripts/rebalance-vitest-shards.mjs reports/<run-a> reports/<run-b> \
 *     reports/<run-c> [--root=<runner checkout>] [--write]
 *
 * The reports name files by absolute path on the runner; `--root` is the
 * checkout directory there (default `/home/runner/work/morph/morph`).
 *
 * Each argument is one CI run's downloaded artifacts (the
 * `vitest-results-<shard>-attempt-<k>` directories, each holding
 * `vitest-shard-<shard>.json`); only each shard's latest attempt is read, every
 * report must say its run succeeded, and every shard must be present. Use
 * green runs of the full suite on main (or a PR head close to it) and give it
 * at least three, so one noisy run does not set a weight: a file's duration is
 * the MEDIAN of its durations across the runs given.
 *
 * A duration is the file's wall time in the report (`endTime - startTime`),
 * measured while the shard's other workers were busy, not the file alone. That
 * is the cost the plan has to balance, and it is why a plan made from these
 * numbers should be refreshed from a run that used the new plan once it
 * differs a lot from the old one.
 *
 * Without `--write` it prints the plan and each shard's planned total (a
 * proposal for review); with `--write` it also records the durations. The
 * durations file is data, not a rule: a stale or hand-edited file can only
 * unbalance the shards, because `scripts/check-vitest-shards.mjs` still fails
 * a run in which any test file ran in no shard or in two.
 *
 * Re-run it when the shards drift apart again: the Test step of the slowest
 * `Validation tests shard N/3` job is well over the others, or many test files
 * have been added since the last refresh (the aggregate job prints how many
 * files the durations file does not name).
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { latestVitestReports } from "./check-vitest-shards.mjs";
import { planShards } from "./vitest-shard-sequencer.mjs";

const COUNT = 3;
const OUTPUT = fileURLToPath(
  new URL("./vitest-shard-durations.json", import.meta.url),
);

/** @param {string} directory @returns {string[]} */
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Seconds per repository-relative file in one run's latest-attempt reports.
 * @param {string} directory
 * @param {string} root
 * @returns {Map<string, number>}
 */
export function runDurations(directory, root) {
  /** @type {Map<string, number>} */
  const seconds = new Map();
  const reports = latestVitestReports(walk(directory), COUNT);
  for (const file of reports) {
    const report = JSON.parse(readFileSync(file, "utf8"));
    if (report.success !== true)
      throw new Error(`${file}: the run did not succeed; use a green run`);
    for (const result of report.testResults ?? []) {
      const name = path.relative(root, result.name).split(path.sep).join("/");
      if (name.startsWith("../"))
        throw new Error(`${result.name} is outside ${root}`);
      if (seconds.has(name)) throw new Error(`${name} is in two shards`);
      seconds.set(name, (result.endTime - result.startTime) / 1000);
    }
  }
  return seconds;
}

/**
 * The median duration per file across runs, rounded to 0.1 s, in path order.
 * A file missing from some runs uses the runs that have it.
 * @param {ReadonlyArray<Map<string, number>>} runs
 * @returns {Record<string, number>}
 */
export function medianDurations(runs) {
  /** @type {Map<string, number[]>} */
  const all = new Map();
  for (const run of runs)
    for (const [file, value] of run)
      all.set(file, [...(all.get(file) ?? []), value]);
  return Object.fromEntries(
    [...all]
      .map(([file, values]) => [file, Math.round(median(values) * 10) / 10])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const directories = args.filter((arg) => !arg.startsWith("--"));
  if (directories.length === 0)
    throw new Error(
      "usage: node scripts/rebalance-vitest-shards.mjs <run-reports-dir>... [--root=<runner checkout>] [--write]",
    );
  const root =
    args.find((arg) => arg.startsWith("--root="))?.slice(7) ??
    "/home/runner/work/morph/morph";
  const durations = medianDurations(
    directories.map((directory) => runDurations(directory, root)),
  );
  const { shardOf, sum, finish } = planShards(durations, COUNT);
  if (write) {
    writeFileSync(
      OUTPUT,
      `${JSON.stringify(
        {
          note: "Seconds per test file (median wall time across CI runs); regenerate with scripts/rebalance-vitest-shards.mjs",
          runs: directories.length,
          files: durations,
        },
        null,
        2,
      )}\n`,
    );
  }
  console.log(
    `${Object.keys(durations).length} files from ${directories.length} run(s)${write ? `, written to ${path.relative(process.cwd(), OUTPUT)}` : " (not written; pass --write)"}`,
  );
  sum.forEach((seconds, index) => {
    const files = [...shardOf].filter(([, shard]) => shard === index);
    console.log(
      `shard ${index + 1}/${COUNT}: ${files.length} files, ${seconds.toFixed(0)} s of file time, modelled finish ${finish[index].toFixed(0)} s`,
    );
  });
}
