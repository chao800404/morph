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
 * refuses if any of them failed. `MORPH_SHIP_REQUIRED_ONLY=1` merges as soon as
 * the required ones pass, for when the rest are known-irrelevant. A check counts
 * as passed only if it says so; every other conclusion, including a cancellation,
 * means it did not.
 */
import { spawnSync } from "node:child_process";

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

/**
 * Whether to merge, wait, or refuse — as a pure function of the check rollup.
 *
 * Lifted out of the polling loop so it can be driven without opening a pull
 * request. The bug that put it here was invisible in the loop and obvious in a
 * table: `required.every(...)` is true for an empty list, and a rollup *is* empty
 * for the first seconds after a pull request opens, so `MORPH_SHIP_REQUIRED_ONLY=1`
 * said "merge" on the ordinary path. The other branch had guarded against exactly
 * that with `checks.length > 0`; the asymmetry between them was the tell.
 *
 * Refusal is a whitelist. `FAILURE` alone was too narrow: `CANCELLED`,
 * `TIMED_OUT`, `STARTUP_FAILURE` and `ACTION_REQUIRED` all mean a check did not
 * report success, and the first of those is not hypothetical here — the e2e job
 * was once cancelled by its own thirty-minute timeout, which is precisely a run
 * that should not merge. Anything GitHub adds later is refused rather than
 * silently accepted.
 */
export function decide(checks, requiredOnly) {
  const settled = checks.filter((check) => check.status === "COMPLETED");
  const unhappy = settled.filter((check) => !passed(check));
  const pending = checks.filter((check) => check.status !== "COMPLETED");
  const required = checks.filter((check) => check.name === REQUIRED_CHECK);

  if (unhappy.length > 0) return { verdict: "refuse", unhappy, pending };
  const merge = requiredOnly
    ? required.length > 0 && required.every(passed)
    : checks.length > 0 && pending.length === 0;
  return { verdict: merge ? "merge" : "wait", unhappy, pending };
}

/**
 * The one check `main` requires, spelled the way GitHub reports it.
 *
 * A third copy of this string — the others are `ci.yml`'s job name and the branch
 * protection rule — so renaming the job means renaming it in three places. See
 * the note above `name: Architecture guards` in `ci.yml`.
 */
export const REQUIRED_CHECK = "Architecture guards";

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

async function ship() {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { quiet: true });
  // Named rather than counted: the point is which commits are about to become
  // public, and a number does not let anyone recognise the wrong branch.
  const ahead = branch === "main"
    ? ""
    : run("git", ["log", "--oneline", "origin/main..HEAD"], { quiet: true });
  const refusal = preflight({ branch, ahead });
  if (refusal) throw new Error(refusal);
  log(`shipping ${ahead.split("\n").length} commit(s) from ${branch}:`);
  console.log(ahead.split("\n").map((line) => `         ${line}`).join("\n"));

  // Warned about, not blocked. A dirty tree is normal here — work in progress that
  // is deliberately not ready is the reason `git add -- <paths>` exists — but it is
  // worth seeing what is staying behind before it becomes a surprise later.
  const dirty = run("git", ["status", "--short"], { quiet: true });
  if (dirty) {
    log("these are NOT going (uncommitted):");
    console.log(dirty.split("\n").map((line) => `         ${line}`).join("\n"));
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

  const existing = run("gh", ["pr", "list", "--head", branch, "--json", "number", "-q", ".[0].number // empty"], { quiet: true });
  if (existing) {
    log(`pull request #${existing} already open for this branch`);
  } else {
    log("opening a pull request");
    run("gh", ["pr", "create", "--base", "main", "--fill"]);
  }

  const requiredOnly = process.env.MORPH_SHIP_REQUIRED_ONLY === "1";
  log(requiredOnly ? "waiting for the required check" : "waiting for every check");

  // Longer than the slowest job it waits for. `editor-e2e-local-preview` is
  // `timeout-minutes: 30`, so a 20-minute deadline here reported CI as timed out
  // when the script had simply given up first — a message about the wrong system.
  const deadline = Date.now() + 35 * 60_000;
  for (;;) {
    const rollup =
      JSON.parse(
        run("gh", ["pr", "view", "--json", "statusCheckRollup"], { quiet: true }),
      ).statusCheckRollup ?? [];
    const checks = rollup.filter((check) => check.name);
    // A whitelist, so a conclusion GitHub adds later is refused rather than
    // silently accepted. `FAILURE` alone was too narrow: `CANCELLED`,
    // `TIMED_OUT`, `STARTUP_FAILURE` and `ACTION_REQUIRED` all mean the check did
    // not tell us it passed, and one of them is not hypothetical here — the e2e
    // job was cancelled by its own timeout once, which is exactly a run that
    // should not merge.
    const { verdict, unhappy, pending } = decide(checks, requiredOnly);

    if (verdict === "refuse") {
      throw new Error(describeUnhappy(unhappy));
    }
    if (verdict === "merge") break;

    if (Date.now() > deadline) {
      throw new Error(
        `CHECKS_TIMED_OUT: still waiting on ${pending.map((check) => check.name).join(", ")}. Nothing merged.`,
      );
    }
    log(`  still running: ${pending.map((check) => check.name).join(", ") || "(none reported yet)"}`);
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
  log(`done — main is now ${run("git", ["rev-parse", "HEAD"], { quiet: true }).slice(0, 7)}`);
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
