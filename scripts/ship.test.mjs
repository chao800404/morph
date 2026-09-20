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
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decide } from "./ship.mjs";

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
