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
 * the required ones pass, for when the rest are known-irrelevant.
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

async function ship() {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { quiet: true });
  if (branch === "main") {
    throw new Error(
      "ON_MAIN: `main` takes pull requests, so there is nothing to ship from it. `git checkout -b <name>` first — commits already made on main come with you.",
    );
  }

  // Named rather than counted: the point is which commits are about to become
  // public, and a number does not let anyone recognise the wrong branch.
  const ahead = run("git", ["log", "--oneline", "origin/main..HEAD"], { quiet: true });
  if (!ahead) {
    throw new Error(
      `NOTHING_AHEAD: ${branch} has no commits that origin/main does not. Commit first, or you are on a branch that was already merged.`,
    );
  }
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

  const deadline = Date.now() + 20 * 60_000;
  for (;;) {
    const rollup = JSON.parse(
      run("gh", ["pr", "view", "--json", "statusCheckRollup"], { quiet: true }),
    ).statusCheckRollup;
    const checks = rollup.filter((check) => check.name);
    const failed = checks.filter((check) => check.conclusion === "FAILURE");
    const pending = checks.filter((check) => check.status !== "COMPLETED");
    const required = checks.filter((check) => check.name === "Architecture guards");

    if (failed.length > 0) {
      throw new Error(
        `CHECK_FAILED: ${failed.map((check) => check.name).join(", ")}. Nothing merged. The branch and its pull request are still there.`,
      );
    }
    const done = requiredOnly
      ? required.every((check) => check.conclusion === "SUCCESS")
      : checks.length > 0 && pending.length === 0;
    if (done) break;

    if (Date.now() > deadline) {
      throw new Error(
        `CHECKS_TIMED_OUT: still waiting on ${pending.map((check) => check.name).join(", ")}. Nothing merged.`,
      );
    }
    log(`  still running: ${pending.map((check) => check.name).join(", ") || "(none reported yet)"}`);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }

  log("merging");
  run("gh", ["pr", "merge", "--merge", "--delete-branch"]);
  run("git", ["checkout", "-q", "main"]);
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
ship().catch((error) => {
  console.error(`[ship] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
