/**
 * What `pnpm ship` does with a check rollup.
 *
 * `node --test`, like the LIKE scanner's tests and for the same reason: vitest
 * collects `src/**\/*.test.{ts,tsx}`, so a test beside this script would never
 * run, and a guard that never runs is what this repo keeps removing.
 *
 * Every case here was a wrong answer before the fix — the empty rollup, the
 * cancellation, the timeout, the job awaiting action. Written down because the
 * bug was invisible in the polling loop and obvious in a table, and the next edit
 * to the gate deserves the table rather than the loop.
 *
 * The old gate and the new one disagree on **4 of the 12 verdict cases below**.
 * The commit that introduced them says "four of the nine", which was true of the
 * throwaway probe it was written against and is not true of this file — and
 * a commit message cannot be corrected, so the count lives here, beside the
 * fixtures it counts. A number without its frame is the thing this repo keeps
 * finding: the same two counts of the same property were both right.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { decide, describeUnhappy, preflight, REQUIRED_CHECK } from "./ship.mjs";

const guard = (conclusion, status = "COMPLETED") => ({
  name: "Architecture guards",
  status,
  conclusion,
});
const other = (conclusion, status = "COMPLETED") => ({
  name: "Typecheck, test, build",
  status,
  conclusion,
});
const verdict = (checks, requiredOnly = false) => decide(checks, requiredOnly).verdict;

describe("waiting for every check", () => {
  it("merges when they have all reported success", () => {
    assert.equal(verdict([guard("SUCCESS"), other("SUCCESS")]), "merge");
  });

  it("waits while one is still running", () => {
    assert.equal(verdict([guard("SUCCESS"), other(null, "IN_PROGRESS")]), "wait");
  });

  it("waits on an empty rollup rather than treating it as agreement", () => {
    assert.equal(verdict([]), "wait");
  });

  it("counts a skipped job as passed, because it reported", () => {
    assert.equal(verdict([guard("SUCCESS"), other("SKIPPED")]), "merge");
  });
});

describe("refusing anything that did not report success", () => {
  it("refuses an outright failure", () => {
    assert.equal(verdict([guard("SUCCESS"), other("FAILURE")]), "refuse");
  });

  it("refuses a cancellation", () => {
    // Not hypothetical: the e2e job was once cancelled by its own thirty-minute
    // timeout, which is exactly a run that should not merge.
    assert.equal(verdict([guard("CANCELLED")]), "refuse");
  });

  it("refuses a job that timed out", () => {
    assert.equal(verdict([guard("SUCCESS"), other("TIMED_OUT")]), "refuse");
  });

  it("refuses a job waiting on a person", () => {
    assert.equal(verdict([guard("SUCCESS"), other("ACTION_REQUIRED")]), "refuse");
  });

  it("names what was not green, with its conclusion", () => {
    const { unhappy } = decide([guard("SUCCESS"), other("TIMED_OUT")], false);
    assert.deepEqual(
      unhappy.map((check) => `${check.name}:${check.conclusion}`),
      ["Typecheck, test, build:TIMED_OUT"],
    );
  });
});

describe("MORPH_SHIP_REQUIRED_ONLY", () => {
  it("merges once the required check passes, ignoring the rest", () => {
    assert.equal(verdict([guard("SUCCESS"), other(null, "IN_PROGRESS")], true), "merge");
  });

  it("does not merge before the required check exists", () => {
    // `[].every(...)` is true, and a rollup is empty for the first seconds after
    // a pull request opens — so this was the ordinary path, not an edge case.
    assert.equal(verdict([], true), "wait");
  });

  it("does not merge while the required check is still running", () => {
    assert.equal(verdict([guard(null, "IN_PROGRESS")], true), "wait");
  });

  it("still refuses a failure elsewhere", () => {
    assert.equal(verdict([guard("SUCCESS"), other("FAILURE")], true), "refuse");
  });
});

describe("refusing before anything reaches the remote", () => {
  // The branches a successful run never reaches, which is why nothing exercised
  // them until now. Order matters as much as the conditions: the cheap refusals
  // come before the push, so a refused run has published nothing.
  it("refuses on main, where there is nothing to ship from", () => {
    assert.match(preflight({ branch: "main", ahead: "" }), /^ON_MAIN:/);
  });

  it("refuses on main even when commits exist there", () => {
    // Committing to main by mistake is ordinary; the commits are not lost, they
    // come along to a branch. The refusal has to say so rather than just stop.
    const refusal = preflight({ branch: "main", ahead: "abc1234 a commit" });
    assert.match(refusal, /^ON_MAIN:/);
    assert.match(refusal, /checkout -b/);
  });

  it("refuses a branch with nothing ahead of origin/main", () => {
    const refusal = preflight({ branch: "fix/already-merged", ahead: "" });
    assert.match(refusal, /^NOTHING_AHEAD:/);
    // Names the branch, because the usual cause is standing on the wrong one.
    assert.match(refusal, /fix\/already-merged/);
  });

  it("allows a branch with commits ahead", () => {
    assert.equal(preflight({ branch: "fix/thing", ahead: "abc1234 a commit" }), null);
  });
});

describe("what a refused merge says", () => {
  it("names every check that was not green, with its conclusion", () => {
    const message = describeUnhappy([
      { name: "Typecheck, test, build", conclusion: "FAILURE" },
      { name: "Editor end-to-end (local preview transport)", conclusion: "CANCELLED" },
    ]);
    assert.match(message, /^CHECK_NOT_GREEN:/);
    assert.match(message, /Typecheck, test, build \(FAILURE\)/);
    assert.match(message, /end-to-end \(local preview transport\) \(CANCELLED\)/);
  });

  it("says nothing was merged and the work is still there", () => {
    // The sentence a person reads at the point they most expect to have lost
    // something. `CANCELLED` reaching here at all is the fix this file guards.
    const message = describeUnhappy([{ name: "Architecture guards", conclusion: "CANCELLED" }]);
    assert.match(message, /Nothing merged/);
    assert.match(message, /still there/);
  });
});

describe("the name of the required check", () => {
  it("matches the job name in ci.yml", () => {
    // Two of the three copies of this string, compared. The third is the branch
    // protection rule on `main`, which needs an API call and a token with
    // `administration` — see the note above `name: Architecture guards` in
    // `ci.yml` for what a rename breaks there. Checking two beats checking none:
    // a rename now fails here instead of failing as "every pull request waits
    // forever", which is the symptom that names nothing.
    const workflow = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const names = [...workflow.matchAll(/^\s{4}name:\s*(.+)$/gm)].map((match) =>
      match[1].trim(),
    );
    assert.ok(
      names.includes(REQUIRED_CHECK),
      `ci.yml has no job named ${REQUIRED_CHECK}; it has ${names.join(", ")}`,
    );
  });
});
