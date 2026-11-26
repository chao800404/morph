// @ts-check
/**
 * Which test files each Vitest CI shard runs: assigned from measured per-file
 * durations, longest first, instead of Vitest's own `--shard` split.
 *
 * Vitest's default `shard()` sorts the files of each `groupOrder` group by a
 * hash of the path and cuts the sorted list into equal COUNTS. Files differ in
 * cost by two orders of magnitude here (a few ms to ~560 s), so the hash put
 * five of the six heaviest editor files into one shard (measured on main
 * runs 45688877365 to 45700554199: that shard's test step took 816 to 998 s,
 * the other two 334 to 581 s). This sequencer replaces only `shard()`; `sort()`
 * (failed and slowest first, from the restored Vitest timings cache) is
 * Vitest's own and unchanged, and every project and phase still runs as before.
 *
 * The plan is a pure function of `scripts/vitest-shard-durations.json`:
 *
 *   - A file's WEIGHT is its recorded duration plus `overhead.perFileSeconds`
 *     from the same file. A recorded duration is the file's own test time
 *     (`endTime - startTime` in the report); it leaves out what every file
 *     also costs a worker before its tests start (importing and transforming
 *     the test and its modules, setup files, the test environment, collect).
 *     That is small per file and large per shard: on the runs it was fitted
 *     from (rebalance-vitest-shards.mjs), the shard holding 650 mostly tiny
 *     files was the slowest although its summed test time was the lowest, so
 *     planning by test time alone gave one shard too many files. The constant
 *     is one number for every file: splitting it by project or by jsdom/node
 *     did not beat it in leave-one-run-out checks. `overhead.perShardSeconds`
 *     (what a shard costs whatever its files) is recorded for projections
 *     only; it is the same for every shard and moves no file.
 *   - Every file named there is placed longest-first (by weight) onto the
 *     shard that would finish earliest on PLAN_WORKERS workers (ties: lighter
 *     total, then lower shard index), over ALL files in the durations file, so
 *     the plan does not depend on which `groupOrder` group Vitest is asking
 *     about. Finish time, not summed seconds, because one 560 s file cannot be
 *     shared: the shard holding it is that long however little else it runs.
 *   - A file that is NOT named there (a new test) is placed after the planned
 *     files, in path order, each onto the then-lightest shard with a default
 *     weight (the median of the planned durations, plus the per-file
 *     overhead). It runs in exactly one shard, the same one on every runner,
 *     and costs the plan one default-weight file per new file until the next
 *     refresh.
 *   - A file named there that no longer exists only adds phantom weight until
 *     the next refresh; it cannot make a shard run it.
 *
 * Whatever this decides, `scripts/check-vitest-shards.mjs` still refuses a
 * shard that ran nothing, a file that ran in no shard or in two, and a file
 * outside the suite, so a wrong plan fails the run rather than hiding a test.
 *
 * Refresh the durations from real CI reports with
 * `scripts/rebalance-vitest-shards.mjs` (its header says how).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { BaseSequencer } from "vitest/node";

export const DURATIONS_FILE = new URL(
  "./vitest-shard-durations.json",
  import.meta.url,
);

/**
 * Seconds per repository-relative test file, from the durations file.
 * @param {string | URL} [file]
 * @returns {Record<string, number>}
 */
export function loadDurations(file = DURATIONS_FILE) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const files = parsed?.files;
  if (!files || typeof files !== "object" || Array.isArray(files))
    throw new Error(
      "VITEST_SHARD_DURATIONS_INVALID: `files` must be an object",
    );
  for (const [name, seconds] of Object.entries(files)) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
      throw new Error(`VITEST_SHARD_DURATIONS_INVALID: ${name}`);
  }
  return files;
}

/**
 * What every file costs beyond its own test time, from the durations file's
 * `overhead` block (0 when it has none, so an older file plans as before).
 * @param {string | URL} [file]
 * @returns {{perFileSeconds: number, perShardSeconds: number}}
 */
export function loadOverhead(file = DURATIONS_FILE) {
  const overhead = JSON.parse(readFileSync(file, "utf8"))?.overhead;
  if (overhead === undefined) return { perFileSeconds: 0, perShardSeconds: 0 };
  if (!overhead || typeof overhead !== "object" || Array.isArray(overhead))
    throw new Error(
      "VITEST_SHARD_DURATIONS_INVALID: `overhead` must be an object",
    );
  /** @param {string} key */
  const read = (key) => {
    const value = overhead[key] === undefined ? 0 : overhead[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new Error(`VITEST_SHARD_DURATIONS_INVALID: overhead.${key}`);
    return value;
  };
  return {
    perFileSeconds: read("perFileSeconds"),
    perShardSeconds: read("perShardSeconds"),
  };
}

/** @param {number} count */
function assertCount(count) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`VITEST_SHARD_COUNT_INVALID: ${count}`);
}

/**
 * The weight a file with no recorded duration gets: the median of the
 * recorded ones (1 s when there are none).
 * @param {Readonly<Record<string, number>>} durations
 */
export function defaultWeight(durations) {
  const values = Object.values(durations).sort((a, b) => a - b);
  if (values.length === 0) return 1;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

/**
 * What a shard costs is how long its files take on the runner's workers, not
 * the sum of their durations: one file that takes 560 s cannot be shared, so a
 * shard holding it is that long however little else it runs. A shard is
 * modelled as PLAN_WORKERS workers fed longest-first (what Vitest does with the
 * cached timings), and its cost is when the last worker finishes. A 4-vCPU
 * GitHub runner gets `min(4, cores - 1)` = 3 workers (vitest.config.ts).
 */
export const PLAN_WORKERS = 3;

/** @param {number} count */
function emptyShards(count) {
  assertCount(count);
  return Array.from({ length: count }, () => ({
    workers: Array(PLAN_WORKERS).fill(0),
    sum: 0,
    files: 0,
  }));
}

/**
 * Puts one file on the shard where the modelled finish time grows least
 * (ties: the lighter sum, then the lower index) and returns that shard.
 * @param {Array<{workers: number[], sum: number, files: number}>} shards
 * @param {number} weight seconds on a worker: duration plus per-file overhead
 * @param {number} [seconds] the file's own duration, for the shard's `sum`
 */
function place(shards, weight, seconds = weight) {
  let best = 0;
  let bestEnd = Infinity;
  for (const [index, shard] of shards.entries()) {
    const end = Math.max(
      Math.max(...shard.workers),
      Math.min(...shard.workers) + weight,
    );
    if (end < bestEnd || (end === bestEnd && shard.sum < shards[best].sum)) {
      best = index;
      bestEnd = end;
    }
  }
  const target = shards[best];
  target.workers[target.workers.indexOf(Math.min(...target.workers))] += weight;
  target.sum += seconds;
  target.files += 1;
  return best;
}

/**
 * Longest-first (by duration plus overhead) onto the shard that finishes earliest, over every file in
 * `durations`.
 * @param {Readonly<Record<string, number>>} durations
 * @param {number} count
 * @param {number} [perFile] seconds every file costs beyond its duration
 * @returns {{shardOf: Map<string, number>, sum: number[], finish: number[], files: number[]}}
 *   `shardOf` is 0-based; `sum` is each shard's total file seconds (without
 *   the overhead), `finish` its modelled finish time on PLAN_WORKERS workers
 *   with the overhead, `files` its file count
 */
export function planShards(durations, count, perFile = 0) {
  const shards = emptyShards(count);
  const shardOf = new Map();
  const files = Object.entries(durations).sort(
    ([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const [file, seconds] of files)
    shardOf.set(file, place(shards, seconds + perFile, seconds));
  return {
    shardOf,
    sum: shards.map((shard) => shard.sum),
    finish: shards.map((shard) => Math.max(...shard.workers)),
    files: shards.map((shard) => shard.files),
  };
}

/**
 * The shard (1-based) each file runs in. Files absent from `durations` are
 * placed after the planned ones, in path order, at the default weight. The
 * answer for one file depends only on `durations` and on the set of files
 * given, never on their order, so every shard computes the same assignment.
 * @param {readonly string[]} files repository-relative, `/`-separated
 * @param {Readonly<Record<string, number>>} durations
 * @param {number} count
 * @param {number} [perFile] seconds every file costs beyond its duration
 * @returns {Map<string, number>}
 */
export function assignShards(files, durations, count, perFile = 0) {
  const shards = emptyShards(count);
  const shardOf = new Map();
  for (const [file, seconds] of Object.entries(durations).sort(
    ([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0),
  ))
    shardOf.set(file, place(shards, seconds + perFile, seconds));
  const weight = defaultWeight(durations);
  /** @type {Map<string, number>} */
  const assigned = new Map();
  const unplanned = [];
  for (const file of new Set(files)) {
    const planned = shardOf.get(file);
    if (planned === undefined) unplanned.push(file);
    else assigned.set(file, planned + 1);
  }
  unplanned.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const file of unplanned)
    assigned.set(file, place(shards, weight + perFile, weight) + 1);
  return assigned;
}

/**
 * The files shard `index` of `count` runs, in the order given.
 * @template {string} T
 * @param {readonly T[]} files
 * @param {Readonly<Record<string, number>>} durations
 * @param {number} index 1-based
 * @param {number} count
 * @param {(file: T) => string} [nameOf]
 * @param {number} [perFile] seconds every file costs beyond its duration
 */
export function selectShardFiles(
  files,
  durations,
  index,
  count,
  nameOf,
  perFile = 0,
) {
  if (!Number.isInteger(index) || index < 1 || index > count)
    throw new Error(`VITEST_SHARD_INDEX_INVALID: ${index}/${count}`);
  const name = nameOf ?? ((file) => file);
  const assigned = assignShards(files.map(name), durations, count, perFile);
  return files.filter((file) => assigned.get(name(file)) === index);
}

/** Vitest's own sequencer with `shard()` replaced; `sort()` is inherited. */
export default class DurationShardSequencer extends BaseSequencer {
  /** @param {import("vitest/node").TestSpecification[]} files */
  async shard(files) {
    const { config } = this.ctx;
    const { index, count } = config.shard;
    const root = config.root.split(path.sep).join("/");
    return selectShardFiles(
      files,
      loadDurations(),
      index,
      count,
      (spec) =>
        path.posix.relative(root, spec.moduleId.split(path.sep).join("/")),
      loadOverhead().perFileSeconds,
    );
  }
}
