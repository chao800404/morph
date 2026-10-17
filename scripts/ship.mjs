/**
 * Branch to merged, in one command.
 *
 * `main` requires a pull request, so every change takes the same six steps and
 * the cost of that is not the typing — it is the steps that get skipped when
 * someone is in a hurry. This runs them in an order where the cheap refusals
 * come first: nothing is pushed until the guard that would fail the pull request
 * has already passed locally.
 *
 * What it will not do: merge while a check is failing. The branch protection on
 * `main` only requires `Architecture guards`, deliberately — a thirty-minute
 * Playwright job should not decide whether a rule holds. But "may merge" and
 * "should merge" are different questions, so this waits for every check and
 * refuses if any of them failed, or if a check ci-required-checks.mjs expects
 * never reported. There is no shortcut: every expected check must be present
 * and report SUCCESS, every time. A check counts as passed only if it says so;
 * every other conclusion, including a cancellation, means it did not.
 */
import { spawnSync } from "node:child_process";
import { EDITOR_SHARD_COUNT } from "./editor-e2e-shards.mjs";
import {
  CHECK_DEPENDENCIES,
  EXPECTED_CI_CHECKS,
  REQUIRED_CHECK,
} from "./ci-required-checks.mjs";

const log = (message) => console.log(`[ship] ${message}`);

/** Runs a command, returning its trimmed stdout, or throws with its stderr. */
function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}\n${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  const out = (result.stdout ?? "").trim();
  if (!quiet && out) console.log(out);
  return out;
}

/** Runs a command for its exit status, letting its output through. */
function runVisible(command, args) {
  return spawnSync(command, args, { stdio: "inherit" }).status ?? 1;
}

/** A check counts as passed only if it says so. */
const passed = (check) =>
  check.conclusion === "SUCCESS" ||
  check.conclusion === "SKIPPED" ||
  check.conclusion === "NEUTRAL";

/** The workflow run a check belongs to, from its details URL; 0 if unknown. */
const runId = (check) =>
  Number(/\/actions\/runs\/(\d+)\//.exec(check.detailsUrl ?? "")?.[1] ?? 0);

/**
 * Each check as the newest workflow run reported it.
 *
 * The rollup lists every run on the head commit. A pull request closed and
 * reopened — or otherwise given a fresh run — still carries the old run's
 * checks next to the new ones, and the old failure refused a commit whose
 * latest run was green. Run ids only grow, so the highest one wins; a newer
 * run's check that is still pending counts as the current result, which
 * waits rather than refusing on the stale one.
 */
export function latestChecks(checks) {
  const latest = new Map();
  for (const check of checks) {
    const kept = latest.get(check.name);
    if (!kept || runId(check) > runId(kept)) latest.set(check.name, check);
  }
  return [...latest.values()];
}

/**
 * Whether to merge, wait, or refuse — as a pure function of the check rollup.
 *
 * Lifted out of the polling loop so it can be driven without opening a pull
 * request. The bug that put it here was invisible in the loop and obvious in a
 * table: `required.every(...)` is true for an empty list, and a rollup *is* empty
 * for the first seconds after a pull request opens, so a mode that waited for
 * the required check alone (since removed) said "merge" on the ordinary path.
 * An empty rollup still waits here.
 *
 * Refusal is a whitelist. `FAILURE` alone was too narrow: `CANCELLED`,
 * `TIMED_OUT`, `STARTUP_FAILURE` and `ACTION_REQUIRED` all mean a check did not
 * report success, and the first of those is not hypothetical here — the e2e job
 * was once cancelled by its own thirty-minute timeout, which is precisely a run
 * that should not merge. Anything GitHub adds later is refused rather than
 * silently accepted.
 */
export function decide(checks, expected = EXPECTED_CI_CHECKS) {
  const settled = checks.filter((check) => check.status === "COMPLETED");
  const unhappy = settled.filter((check) => !passed(check));
  const pending = checks.filter((check) => check.status !== "COMPLETED");
  const present = (name) => checks.some((check) => check.name === name);
  const green = (name) =>
    checks.some(
      (check) =>
        check.name === name &&
        check.status === "COMPLETED" &&
        check.conclusion === "SUCCESS",
    );

  // A shard named for another count than the plan is refused, whatever it
  // reported: a workflow left at the old count would otherwise look complete.
  // check-e2e-shards keeps the workflow's job names in step with the plan.
  const shardName = /^Editor E2E shard \d+\/(\d+)$/;
  for (const check of checks) {
    const match = shardName.exec(check.name);
    if (
      match &&
      Number(match[1]) !== EDITOR_SHARD_COUNT &&
      !unhappy.includes(check)
    )
      unhappy.push({ ...check, conclusion: "SHARD_COUNT_MISMATCH" });
  }
  // Every expected check must report SUCCESS itself: SKIPPED or NEUTRAL means
  // the job did not run its work. Checks outside the list keep `passed`.
  for (const check of settled)
    if (
      expected.includes(check.name) &&
      check.conclusion !== "SUCCESS" &&
      !unhappy.includes(check)
    )
      unhappy.push(check);
  if (unhappy.length > 0)
    return { verdict: "refuse", unhappy, pending, missing: [] };

  // Every expected check must be in the rollup, not just the ones that are.
  // Dependent jobs may not appear until their dependencies finish, so a green
  // partial rollup is not proof that CI has completed.
  const missing = expected.filter((name) => !present(name));
  const queued = (name) => ({ name, status: "QUEUED", conclusion: null });

  // Not created yet, rather than gone: everything it needs is present and green.
  const notYetCreated = missing.filter((name) => {
    const needs = CHECK_DEPENDENCIES[name] ?? [];
    return needs.length > 0 && needs.every(green);
  });
  const waiting = [...pending, ...notYetCreated.map(queued)];

  // Still running somewhere: a missing check may yet be created by it.
  if (checks.length === 0 || waiting.length > 0)
    return { verdict: "wait", unhappy, pending: waiting, missing };
  // Everything present has finished and an expected check never arrived: it
  // was renamed, removed or not created. Waiting would only end at the deadline.
  if (missing.length > 0)
    return {
      verdict: "refuse",
      reason: "EXPECTED_CHECK_MISSING",
      unhappy,
      pending,
      missing,
    };
  return { verdict: "merge", unhappy, pending, missing };
}

/**
 * The one check `main` requires, spelled the way GitHub reports it; defined in
 * ci-required-checks.mjs with every other check ship expects. See the note
 * above `name: Architecture guards` in `ci.yml` for the branch protection copy.
 */
export { REQUIRED_CHECK };

/**
 * Why this run may not proceed, or `null`.
 *
 * A pure function over facts the caller gathered, for the same reason `decide`
 * is one: these are the branches a successful run never reaches, so they are the
 * branches nothing exercises. Reading them is not testing them — this file
 * claimed they were "easy to drive" for a round before anything drove them.
 */
export function preflight({ branch, ahead }) {
  if (branch === "main") {
    return "ON_MAIN: `main` takes pull requests, so there is nothing to ship from it. `git checkout -b <name>` first — commits already made on main come with you.";
  }
  if (!ahead) {
    return `NOTHING_AHEAD: ${branch} has no commits that origin/main does not. Commit first, or you are on a branch that was already merged.`;
  }
  return null;
}

/** Names what was not green, with the conclusion each reported. */
export function describeUnhappy(unhappy) {
  return `CHECK_NOT_GREEN: ${unhappy.map((check) => `${check.name} (${check.conclusion})`).join(", ")}. Nothing merged. The branch and its pull request are still there.`;
}

/** Names the expected checks that never reported. */
export function describeMissing(missing) {
  return `EXPECTED_CHECK_MISSING: every reported check has finished, but ${missing.join(", ")} never reported (renamed, removed or not created; see scripts/ci-required-checks.mjs). Nothing merged. The branch and its pull request are still there.`;
}

/**
 * Why the deadline passed with nothing merged: the checks still running and
 * the expected checks that never reported, each named.
 */
export function describeTimeout(pending, missing) {
  const running = pending
    .map((check) => check.name)
    .filter((name) => !missing.includes(name));
  return `CHECKS_TIMED_OUT: still waiting on ${running.join(", ") || "nothing reported as running"}; expected checks never reported: ${missing.join(", ") || "none"}. Nothing merged. The branch and its pull request are still there.`;
}

/**
 * What the polling loop does with one decision, as a pure function of it and
 * the clock, so the deadline path is driven without waiting or calling `gh`.
 *
 * `fail` is thrown by the loop, which exits non-zero with the message. A
 * merge is only ever the decision's own `merge` with nothing missing: an
 * expected check that never reported cannot become a merge here, and at the
 * deadline it is named in the failure.
 */
export function nextStep(result, now, deadline) {
  const { verdict, unhappy, pending, missing = [] } = result;
  if (verdict === "refuse")
    return {
      action: "fail",
      message:
        unhappy.length > 0
          ? describeUnhappy(unhappy)
          : describeMissing(missing),
    };
  if (verdict === "merge" && missing.length === 0) return { action: "merge" };
  if (now > deadline)
    return { action: "fail", message: describeTimeout(pending, missing) };
  return { action: "wait" };
}

/**
 * Refuses environment switches that no longer exist, before anything runs.
 *
 * `MORPH_SHIP_REQUIRED_ONLY` merged once the required check passed, while
 * the others could still be pending. It was removed; ship always waits for
 * every expected check. Set to any value — "1", "0" or empty — it stops here
 * rather than being silently ignored by someone who still relies on it.
 */
export function assertNoRemovedSwitches(env) {
  if (Object.hasOwn(env, "MORPH_SHIP_REQUIRED_ONLY")) {
    throw new Error(
      "SWITCH_REMOVED: MORPH_SHIP_REQUIRED_ONLY was removed. Unset it (`unset MORPH_SHIP_REQUIRED_ONLY`) and run again; pnpm ship always waits for every expected check and requires SUCCESS from each. Nothing was pushed or merged.",
    );
  }
}

async function ship() {
  // First, before any command runs: nothing is pushed, opened or merged.
  assertNoRemovedSwitches(process.env);
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    quiet: true,
  });
  // Named rather than counted: the point is which commits are about to become
  // public, and a number does not let anyone recognise the wrong branch.
  const ahead =
    branch === "main"
      ? ""
      : run("git", ["log", "--oneline", "origin/main..HEAD"], { quiet: true });
  const refusal = preflight({ branch, ahead });
  if (refusal) throw new Error(refusal);
  log(`shipping ${ahead.split("\n").length} commit(s) from ${branch}:`);
  console.log(
    ahead
      .split("\n")
      .map((line) => `         ${line}`)
      .join("\n"),
  );

  // Warned about, not blocked. A dirty tree is normal here — work in progress that
  // is deliberately not ready is the reason `git add -- <paths>` exists — but it is
  // worth seeing what is staying behind before it becomes a surprise later.
  const dirty = run("git", ["status", "--short"], { quiet: true });
  if (dirty) {
    log("these are NOT going (uncommitted):");
    console.log(
      dirty
        .split("\n")
        .map((line) => `         ${line}`)
        .join("\n"),
    );
  }

  // Before the push, because a guard that fails here fails the pull request too,
  // and finding that out locally costs seconds instead of a round trip.
  log("checking the architecture guards locally");
  if (runVisible("pnpm", ["check:like-tokens"]) !== 0) {
    throw new Error(
      "GUARD_FAILED: fix this before pushing — the same check gates the merge, so pushing now only moves the same failure to CI.",
    );
  }

  log(`pushing ${branch}`);
  run("git", ["push", "-q", "-u", "origin", "HEAD"]);

  const existing = run(
    "gh",
    [
      "pr",
      "list",
      "--head",
      branch,
      "--json",
      "number",
      "-q",
      ".[0].number // empty",
    ],
    { quiet: true },
  );
  if (existing) {
    log(`pull request #${existing} already open for this branch`);
  } else {
    log("opening a pull request");
    run("gh", ["pr", "create", "--base", "main", "--fill"]);
  }

  log("waiting for every check");

  // The 30-minute matrix is followed by a 10-minute aggregate acceptance job.
  // Allow both phases rather than abandoning an otherwise valid running CI.
  const deadline = Date.now() + 45 * 60_000;
  for (;;) {
    const rollup =
      JSON.parse(
        run("gh", ["pr", "view", "--json", "statusCheckRollup"], {
          quiet: true,
        }),
      ).statusCheckRollup ?? [];
    const checks = latestChecks(rollup.filter((check) => check.name));
    // A whitelist, so a conclusion GitHub adds later is refused rather than
    // silently accepted. `FAILURE` alone was too narrow: `CANCELLED`,
    // `TIMED_OUT`, `STARTUP_FAILURE` and `ACTION_REQUIRED` all mean the check did
    // not tell us it passed, and one of them is not hypothetical here — the e2e
    // job was cancelled by its own timeout once, which is exactly a run that
    // should not merge.
    const result = decide(checks);
    const step = nextStep(result, Date.now(), deadline);

    if (step.action === "fail") throw new Error(step.message);
    if (step.action === "merge") break;

    log(
      `  still running: ${result.pending.map((check) => check.name).join(", ") || "(none reported yet)"}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }

  log("merging");
  // `--delete-branch` removes the local branch too, which it can only do from
  // somewhere else — so it has already returned to the default branch. An explicit
  // `git checkout main` after it was redundant on a clean tree and, on a dirty
  // one, failed *after* the merge had happened: the loudest failure at the point
  // where nothing is left to undo.
  run("gh", ["pr", "merge", "--merge", "--delete-branch"]);
  run("git", ["pull", "-q"]);
  log(
    `done — main is now ${run("git", ["rev-parse", "HEAD"], { quiet: true }).slice(0, 7)}`,
  );
}

/**
 * A refusal is a message, not a stack trace.
 *
 * Every throw in here is a sentence addressed to whoever ran the command, and
 * Node's default handler buries it under a file path and a caret. The exit code
 * is what a script would read; the sentence is what a person reads.
 */
// Imported by the test, which must not ship anything on import.
if (process.argv[1]?.endsWith("ship.mjs")) {
  ship().catch((error) => {
    console.error(`[ship] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
