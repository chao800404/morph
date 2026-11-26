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
 * The same reports give the OVERHEAD block of the durations file: what a file
 * costs a worker beyond its own test time (import and transform, setup, the
 * environment, collect), and what a shard costs whatever its files. For every
 * shard of every run it takes the shard's span (the report's `startTime` to its
 * last file's `endTime`) and the files' durations, and finds the single
 * per-file overhead c that makes
 *
 *   span  ~=  perShardSeconds + makespan(duration + c over PLAN_WORKERS workers)
 *
 * fit best (least squares; `perShardSeconds` is the mean residual). Shards of
 * PLAN_WORKERS files or fewer are left out: they say nothing about per-file
 * cost. `perFileSeconds` is the only one the plan uses; `perShardSeconds` is
 * for projections and does not move a file. The Test step of a CI job is about
 * 12 to 20 s longer than the span (pnpm and Vitest start before the report
 * clock). The fit is one constant for every file on purpose: splitting it by
 * project or by jsdom/node did not beat it in leave-one-run-out checks (see the
 * header of vitest-shard-sequencer.mjs).
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
import { PLAN_WORKERS, planShards } from "./vitest-shard-sequencer.mjs";

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
 * Each shard's span and file durations in one run's latest-attempt reports.
 * @param {string} directory
 * @returns {Array<{span: number, durations: number[]}>}
 */
export function runShards(directory) {
  return latestVitestReports(walk(directory), COUNT).map((file) => {
    const report = JSON.parse(readFileSync(file, "utf8"));
    const results = report.testResults ?? [];
    const end = Math.max(0, ...results.map((result) => result.endTime));
    return {
      span: Math.max(0, end - report.startTime) / 1000,
      durations: results.map(
        (result) => (result.endTime - result.startTime) / 1000,
      ),
    };
  });
}

/**
 * When the last of PLAN_WORKERS workers finishes, files fed longest-first.
 * @param {readonly number[]} weights
 */
export function makespan(weights) {
  const workers = Array(PLAN_WORKERS).fill(0);
  for (const weight of [...weights].sort((a, b) => b - a))
    workers[workers.indexOf(Math.min(...workers))] += weight;
  return Math.max(...workers);
}

/**
 * The per-file and per-shard overhead that best explain the measured shard
 * spans (see the header). Seconds, rounded to 0.01.
 * @param {ReadonlyArray<ReadonlyArray<{span: number, durations: number[]}>>} runs
 * @returns {{perFileSeconds: number, perShardSeconds: number, rmse: number, shards: number}}
 */
export function fitOverhead(runs) {
  const shards = runs
    .flat()
    .filter((shard) => shard.durations.length > PLAN_WORKERS);
  if (shards.length === 0)
    throw new Error("no shard with enough files to fit the overhead");
  /** @param {number} perFile */
  const residuals = (perFile) => {
    const raw = shards.map(
      (shard) => shard.span - makespan(shard.durations.map((d) => d + perFile)),
    );
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    return {
      mean,
      sse: raw.reduce((a, r) => a + (r - mean) ** 2, 0),
    };
  };
  let best = { perFile: 0, ...residuals(0) };
  for (let step = 1; step <= 200; step += 1) {
    const perFile = step / 20;
    const fit = residuals(perFile);
    if (fit.sse < best.sse) best = { perFile, ...fit };
  }
  return {
    perFileSeconds: Math.round(best.perFile * 100) / 100,
    perShardSeconds: Math.max(0, Math.round(best.mean * 100) / 100),
    rmse: Math.sqrt(best.sse / shards.length),
    shards: shards.length,
  };
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
  const overhead = fitOverhead(
    directories.map((directory) => runShards(directory)),
  );
  const { shardOf, sum, finish } = planShards(
    durations,
    COUNT,
    overhead.perFileSeconds,
  );
  if (write) {
    writeFileSync(
      OUTPUT,
      `${JSON.stringify(
        {
          note: "Seconds per test file (median wall time across CI runs) plus the fitted overhead every file and shard costs beyond it; regenerate with scripts/rebalance-vitest-shards.mjs",
          runs: directories.length,
          overhead: {
            perFileSeconds: overhead.perFileSeconds,
            perShardSeconds: overhead.perShardSeconds,
          },
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
  console.log(
    `overhead: ${overhead.perFileSeconds} s per file, ${overhead.perShardSeconds} s per shard (fitted on ${overhead.shards} shards, rmse ${overhead.rmse.toFixed(0)} s)`,
  );
  sum.forEach((seconds, index) => {
    const files = [...shardOf].filter(([, shard]) => shard === index);
    console.log(
      `shard ${index + 1}/${COUNT}: ${files.length} files, ${seconds.toFixed(0)} s of file time, projected span ${(finish[index] + overhead.perShardSeconds).toFixed(0)} s (projection)`,
    );
  });
}
