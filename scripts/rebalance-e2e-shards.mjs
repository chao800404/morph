/**
 * Proposes a whole-file editor E2E shard plan from real CI reports.
 *
 *   node scripts/rebalance-e2e-shards.mjs <reports-dir> [--shards=N] [--write]
 *
 * `<reports-dir>` holds the `shard-N.json` reports a CI run uploads as
 * `editor-e2e-results-N` (download them all into one directory). The proposal
 * is printed for review; `--write` records the measured per-file durations in
 * `editor-e2e-durations.json`, which the shard check uses for its budget
 * warning. The plan itself is pasted into `editor-e2e-shards.mjs` by hand, so
 * every move is reviewed in the pull request.
 *
 * Only test bodies are counted. Each shard also pays a fixed setup cost
 * (install, browser, dev server, preconditions) that moving files cannot
 * change; adding shards only helps while test bodies dominate.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDITOR_SHARD_BUDGET_SECONDS,
  EDITOR_SHARD_COUNT,
} from "./editor-e2e-shards.mjs";

export const DURATIONS_FILE = fileURLToPath(
  new URL("./editor-e2e-durations.json", import.meta.url),
);

/**
 * Seconds of editor test bodies per spec file, summed over every attempt.
 * Setup and transport preconditions repeat on every shard and are excluded.
 */
export function fileDurations(reports) {
  const seconds = {};
  function visit(suite, file) {
    const current = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      const name = path.basename(spec.file ?? current ?? "");
      for (const test of spec.tests ?? []) {
        if (test.projectName !== "editor" || !name) continue;
        const ms = (test.results ?? []).reduce(
          (sum, result) => sum + (result.duration ?? 0),
          0,
        );
        seconds[name] = (seconds[name] ?? 0) + ms / 1000;
      }
    }
    for (const child of suite.suites ?? []) visit(child, current);
  }
  for (const report of reports)
    for (const suite of report.suites ?? []) visit(suite, undefined);
  return Object.fromEntries(
    Object.entries(seconds)
      .map(([name, value]) => [name, Math.round(value * 10) / 10])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Longest-first onto the currently lightest shard. Deterministic: ties go to
 * the file name, then the lower shard index, so the same input always gives
 * the same plan.
 */
export function allocate(durations, count) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("EDITOR_SHARD_COUNT_INVALID");
  const plan = Array.from({ length: count }, () => []);
  const load = Array(count).fill(0);
  const files = Object.entries(durations).sort(
    ([a, x], [b, y]) => y - x || a.localeCompare(b),
  );
  for (const [file, seconds] of files) {
    let lightest = 0;
    for (let index = 1; index < count; index += 1)
      if (load[index] < load[lightest]) lightest = index;
    plan[lightest].push(file);
    load[lightest] += seconds;
  }
  return plan;
}

/** Projected test-body seconds per shard; files without a measurement are listed. */
export function project(plan, durations) {
  const unmeasured = [];
  const seconds = plan.map((files) =>
    files.reduce((sum, file) => {
      if (!(file in durations)) {
        unmeasured.push(file);
        return sum;
      }
      return sum + durations[file];
    }, 0),
  );
  return { seconds: seconds.map((value) => Math.round(value)), unmeasured };
}

/**
 * Warnings, never failures: durations come from one earlier run on a shared
 * runner. A shard over budget, or a file never measured, needs a rebalance
 * from a fresh report; it is not a broken build.
 */
export function budgetWarnings(
  plan,
  durations,
  budget = EDITOR_SHARD_BUDGET_SECONDS,
) {
  const { seconds, unmeasured } = project(plan, durations);
  const warnings = [];
  for (const [index, value] of seconds.entries()) {
    if (value > budget)
      warnings.push(
        `Editor E2E shard ${index + 1}/${plan.length} projects ${value}s of tests, over the ${budget}s budget. Rebalance from the latest CI reports (scripts/rebalance-e2e-shards.mjs).`,
      );
  }
  const total = seconds.reduce((sum, value) => sum + value, 0);
  if (total / plan.length > budget)
    warnings.push(
      `${total}s of tests cannot fit ${plan.length} shards under ${budget}s each. Add a shard (see docs/ci-e2e-sharding.md).`,
    );
  for (const file of unmeasured)
    warnings.push(
      `${file} has no measured duration yet; rebalance once a CI run has measured it.`,
    );
  return warnings;
}

function reportFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return reportFiles(target);
    return /^shard-\d+\.json$/.test(entry.name) ? [target] : [];
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const directory = args.find((arg) => !arg.startsWith("--"));
  if (!directory) {
    console.error(
      "usage: node scripts/rebalance-e2e-shards.mjs <reports-dir> [--shards=N] [--write]",
    );
    process.exit(2);
  }
  const countFlag = args.find((arg) => arg.startsWith("--shards="));
  const count = countFlag
    ? Number(countFlag.slice("--shards=".length))
    : EDITOR_SHARD_COUNT;
  const files = reportFiles(directory);
  if (files.length === 0) throw new Error(`No shard-N.json under ${directory}`);
  const durations = fileDurations(
    files.map((file) => JSON.parse(readFileSync(file, "utf8"))),
  );
  const plan = allocate(durations, count);
  const { seconds } = project(plan, durations);
  console.log(
    `Reports: ${files.length}; files measured: ${Object.keys(durations).length}`,
  );
  console.log(`Projected test seconds per shard: ${seconds.join(" / ")}`);
  console.log("Paste into EDITOR_SHARDS in scripts/editor-e2e-shards.mjs:");
  console.log(JSON.stringify(plan, null, 2));
  for (const warning of budgetWarnings(plan, durations))
    console.log(`warning: ${warning}`);
  if (args.includes("--write")) {
    const source = args.find((arg) => arg.startsWith("--source="));
    writeFileSync(
      DURATIONS_FILE,
      `${JSON.stringify(
        {
          source: source ? source.slice("--source=".length) : directory,
          seconds: durations,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Wrote ${path.relative(process.cwd(), DURATIONS_FILE)}`);
  }
}
