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

import {
  assertNoRemovedSwitches,
  decide,
  describeMissing,
  nextStep,
  describeUnhappy,
  latestChecks,
  preflight,
  REQUIRED_CHECK,
} from "./ship.mjs";
import { EDITOR_SHARD_COUNT } from "./editor-e2e-shards.mjs";
import { EXPECTED_CI_CHECKS } from "./ci-required-checks.mjs";

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
const verdict = (checks) => decide(checks).verdict;
// One successful check per shard, named the way the workflow names them.
const shardChecks = (count = EDITOR_SHARD_COUNT) =>
  Array.from({ length: count }, (_, index) => ({
    name: `Editor E2E shard ${index + 1}/${count}`,
    status: "COMPLETED",
    conclusion: "SUCCESS",
  }));
const ACCEPTANCE = "Editor end-to-end (local preview transport)";
const FULL_START = "Editor E2E full Start preview";
const success = (name) => ({
  name,
  status: "COMPLETED",
  conclusion: "SUCCESS",
});
// Every check a complete CI run reports, all green.
const allGreen = () => EXPECTED_CI_CHECKS.map(success);
// The non-E2E checks a run reports, green: guard, validate and full Start.
const baseGreen = () => [
  guard("SUCCESS"),
  other("SUCCESS"),
  success(FULL_START),
];
const without = (checks, name) => checks.filter((check) => check.name !== name);
const replaced = (checks, name, patch) =>
  checks.map((check) => (check.name === name ? { ...check, ...patch } : check));

describe("the expected set of checks", () => {
  it("lists every CI job, with one shard name per planned shard", () => {
    assert.deepEqual(EXPECTED_CI_CHECKS, [
      "Architecture guards",
      "Typecheck, test, build",
      FULL_START,
      ...shardChecks().map((check) => check.name),
      ACCEPTANCE,
    ]);
  });

  it("merges when every expected check is present and green", () => {
    assert.equal(verdict(allGreen()), "merge");
  });

  it("does not merge without Typecheck, test, build", () => {
    const {
      verdict: v,
      reason,
      missing,
    } = decide(without(allGreen(), "Typecheck, test, build"));
    assert.equal(v, "refuse");
    assert.equal(reason, "EXPECTED_CHECK_MISSING");
    assert.deepEqual(missing, ["Typecheck, test, build"]);
  });

  it("does not merge without the full Start job", () => {
    const { verdict: v, missing } = decide(without(allGreen(), FULL_START));
    assert.equal(v, "refuse");
    assert.deepEqual(missing, [FULL_START]);
  });

  it("does not merge when no shard check was reported at all", () => {
    const checks = [...baseGreen(), success(ACCEPTANCE)];
    const { verdict: v, missing } = decide(checks);
    assert.equal(v, "refuse");
    assert.deepEqual(
      missing,
      shardChecks().map((check) => check.name),
    );
    // Without the acceptance job either: still not a merge.
    assert.equal(verdict(baseGreen()), "refuse");
  });

  it("refuses a renamed job: the new name does not stand in for the old", () => {
    const renamed = replaced(allGreen(), "Typecheck, test, build", {
      name: "Typecheck and test",
    });
    const result = decide(renamed);
    assert.equal(result.verdict, "refuse");
    assert.equal(result.reason, "EXPECTED_CHECK_MISSING");
    assert.deepEqual(result.missing, ["Typecheck, test, build"]);
  });

  it("refuses a rollup with the old three-shard names", () => {
    const old = [...baseGreen(), ...shardChecks(3), success(ACCEPTANCE)];
    const result = decide(old);
    assert.equal(result.verdict, "refuse");
    assert.deepEqual(
      result.unhappy.map((check) => check.conclusion),
      ["SHARD_COUNT_MISMATCH", "SHARD_COUNT_MISMATCH", "SHARD_COUNT_MISMATCH"],
    );
  });

  it("waits while an expected check is still pending", () => {
    for (const name of EXPECTED_CI_CHECKS)
      assert.equal(
        verdict(
          replaced(allGreen(), name, {
            status: "IN_PROGRESS",
            conclusion: null,
          }),
        ),
        "wait",
        name,
      );
  });

  it("waits for a missing check while another is still running", () => {
    // The checks still running may be what creates it; refuse only once they end.
    const checks = replaced(
      without(allGreen(), FULL_START),
      "Typecheck, test, build",
      { status: "IN_PROGRESS", conclusion: null },
    );
    assert.equal(verdict(checks), "wait");
  });

  it("waits for the acceptance job between the last shard and its creation", () => {
    // It `needs:` the matrix, so GitHub creates it only after every shard ended.
    assert.equal(verdict(without(allGreen(), ACCEPTANCE)), "wait");
    // A shard missing too: nothing will create it, so that is a refusal.
    assert.equal(
      verdict(
        without(
          without(allGreen(), ACCEPTANCE),
          "Editor E2E shard 1/" + EDITOR_SHARD_COUNT,
        ),
      ),
      "refuse",
    );
  });

  it("says which expected check never reported", () => {
    const message = describeMissing(["Typecheck, test, build"]);
    assert.match(message, /^EXPECTED_CHECK_MISSING:/);
    assert.match(message, /Typecheck, test, build/);
    assert.match(message, /Nothing merged/);
  });
});

describe("waiting for every check", () => {
  it("waits when a dependent acceptance job has not appeared yet", () => {
    const shards = shardChecks();
    assert.equal(verdict([...baseGreen(), ...shards]), "wait");
    // The other shards' absence once all present checks ended is a refusal,
    // not an endless wait.
    assert.equal(verdict([...baseGreen(), shards[0]]), "refuse");
    for (const conclusion of ["SKIPPED", "NEUTRAL"]) {
      assert.equal(
        verdict([
          guard("SUCCESS"),
          ...shards,
          {
            name: "Editor end-to-end (local preview transport)",
            status: "COMPLETED",
            conclusion,
          },
        ]),
        "refuse",
      );
      assert.equal(
        verdict([guard("SUCCESS"), { ...shards[0], conclusion }]),
        "refuse",
      );
    }
  });
  it("waits for every shard and the aggregate acceptance check", () => {
    const shards = shardChecks();
    const acceptance = {
      name: "Editor end-to-end (local preview transport)",
      status: "IN_PROGRESS",
      conclusion: null,
    };
    assert.equal(verdict([...baseGreen(), ...shards, acceptance]), "wait");
    assert.equal(
      verdict([
        ...baseGreen(),
        ...shards,
        { ...acceptance, status: "COMPLETED", conclusion: "SUCCESS" },
      ]),
      "merge",
    );
    assert.equal(
      verdict([
        ...baseGreen(),
        ...shards,
        { ...acceptance, status: "COMPLETED", conclusion: "FAILURE" },
      ]),
      "refuse",
    );
    assert.equal(
      verdict([
        guard("SUCCESS"),
        ...shards.slice(0, 2),
        { ...shards[2], conclusion: "CANCELLED" },
        acceptance,
      ]),
      "refuse",
    );
  });

  it("refuses shards named for another count than the plan", () => {
    const acceptance = {
      name: "Editor end-to-end (local preview transport)",
      status: "COMPLETED",
      conclusion: "SUCCESS",
    };
    assert.equal(
      verdict([...baseGreen(), ...shardChecks(), acceptance]),
      "merge",
    );
    // A workflow left at another count would otherwise look complete.
    assert.equal(
      verdict([
        ...baseGreen(),
        ...shardChecks(),
        ...shardChecks(EDITOR_SHARD_COUNT + 1),
        acceptance,
      ]),
      "refuse",
    );
  });

  it("merges when they have all reported success", () => {
    assert.equal(verdict(allGreen()), "merge");
    // Two green checks are not a complete run.
    assert.equal(verdict([guard("SUCCESS"), other("SUCCESS")]), "refuse");
  });

  it("waits while one is still running", () => {
    assert.equal(
      verdict([guard("SUCCESS"), other(null, "IN_PROGRESS")]),
      "wait",
    );
  });

  it("waits on an empty rollup rather than treating it as agreement", () => {
    assert.equal(verdict([]), "wait");
  });

  it("counts a skipped job outside the expected list as passed, because it reported", () => {
    assert.equal(
      verdict([
        ...allGreen(),
        {
          name: "Some optional job",
          status: "COMPLETED",
          conclusion: "SKIPPED",
        },
      ]),
      "merge",
    );
  });
});

describe("an expected check passes only on SUCCESS", () => {
  it("refuses a SKIPPED Typecheck, test, build", () => {
    const result = decide(
      replaced(allGreen(), "Typecheck, test, build", { conclusion: "SKIPPED" }),
    );
    assert.equal(result.verdict, "refuse");
    assert.deepEqual(
      result.unhappy.map((check) => `${check.name}:${check.conclusion}`),
      ["Typecheck, test, build:SKIPPED"],
    );
  });

  it("refuses a NEUTRAL full Start job", () => {
    assert.equal(
      verdict(replaced(allGreen(), FULL_START, { conclusion: "NEUTRAL" })),
      "refuse",
    );
  });

  it("refuses every non-SUCCESS conclusion on every expected check", () => {
    for (const name of EXPECTED_CI_CHECKS)
      for (const conclusion of [
        "SKIPPED",
        "NEUTRAL",
        "CANCELLED",
        "FAILURE",
        "STALE",
        "SOMETHING_NEW",
      ])
        assert.equal(
          verdict(replaced(allGreen(), name, { conclusion })),
          "refuse",
          `${name} ${conclusion}`,
        );
  });
});

describe("the polling loop's next step", () => {
  const DEADLINE = 1_000;
  const before = DEADLINE - 1;
  const after = DEADLINE + 1;
  const step = (checks, now) => nextStep(decide(checks), now, DEADLINE);

  it("merges a complete green rollup", () => {
    assert.deepEqual(step(allGreen(), before), { action: "merge" });
    assert.deepEqual(step(allGreen(), after), { action: "merge" });
  });

  it("never merges while any expected check is missing, at any time", () => {
    for (const name of EXPECTED_CI_CHECKS)
      for (const now of [before, after])
        assert.notEqual(
          step(without(allGreen(), name), now).action,
          "merge",
          `${name} missing`,
        );
  });

  it("waits for the acceptance job before the deadline", () => {
    assert.deepEqual(step(without(allGreen(), ACCEPTANCE), before), {
      action: "wait",
    });
  });

  it("fails at the deadline, naming the expected check still missing", () => {
    const result = step(without(allGreen(), ACCEPTANCE), after);
    assert.equal(result.action, "fail");
    assert.match(result.message, /^CHECKS_TIMED_OUT:/);
    assert.match(
      result.message,
      /expected checks never reported: Editor end-to-end \(local preview transport\)/,
    );
    assert.match(result.message, /Nothing merged/);
  });

  it("names both the running and the missing checks at the deadline", () => {
    const checks = replaced(
      without(allGreen(), FULL_START),
      "Typecheck, test, build",
      { status: "IN_PROGRESS", conclusion: null },
    );
    assert.deepEqual(step(checks, before), { action: "wait" });
    const result = step(checks, after);
    assert.equal(result.action, "fail");
    assert.match(result.message, /still waiting on Typecheck, test, build;/);
    assert.match(
      result.message,
      /expected checks never reported: Editor E2E full Start preview\./,
    );
  });

  it("fails on a refusal with the refusal's own message", () => {
    const failed = step(
      replaced(allGreen(), "Typecheck, test, build", { conclusion: "FAILURE" }),
      before,
    );
    assert.equal(failed.action, "fail");
    assert.match(failed.message, /^CHECK_NOT_GREEN:/);
    const missing = step(without(allGreen(), FULL_START), before);
    assert.equal(missing.action, "fail");
    assert.match(missing.message, /^EXPECTED_CHECK_MISSING:/);
  });

  it("does not merge a merge verdict that still lists a missing check", () => {
    const result = nextStep(
      { verdict: "merge", unhappy: [], pending: [], missing: [FULL_START] },
      after,
      DEADLINE,
    );
    assert.equal(result.action, "fail");
    assert.match(result.message, /Editor E2E full Start preview/);
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
    assert.equal(
      verdict([guard("SUCCESS"), other("ACTION_REQUIRED")]),
      "refuse",
    );
  });

  it("names what was not green, with its conclusion", () => {
    const { unhappy } = decide([guard("SUCCESS"), other("TIMED_OUT")]);
    assert.deepEqual(
      unhappy.map((check) => `${check.name}:${check.conclusion}`),
      ["Typecheck, test, build:TIMED_OUT"],
    );
  });
});

describe("checks outside the expected list", () => {
  it("refuses one that reports FAILURE, with every expected check green", () => {
    const result = decide([
      ...allGreen(),
      { name: "Some other job", status: "COMPLETED", conclusion: "FAILURE" },
    ]);
    assert.equal(result.verdict, "refuse");
    assert.deepEqual(
      result.unhappy.map((check) => `${check.name}:${check.conclusion}`),
      ["Some other job:FAILURE"],
    );
  });

  it("waits for one still running", () => {
    assert.equal(
      verdict([
        ...allGreen(),
        { name: "Some other job", status: "IN_PROGRESS", conclusion: null },
      ]),
      "wait",
    );
  });
});

describe("the removed MORPH_SHIP_REQUIRED_ONLY switch", () => {
  it("stops ship when it is set to any value", () => {
    for (const value of ["1", "0", "", "true"])
      assert.throws(
        () => assertNoRemovedSwitches({ MORPH_SHIP_REQUIRED_ONLY: value }),
        (error) =>
          /^SWITCH_REMOVED: MORPH_SHIP_REQUIRED_ONLY was removed/.test(
            error.message,
          ) &&
          /Unset it/.test(error.message) &&
          /always waits for every expected check/.test(error.message),
        JSON.stringify(value),
      );
  });

  it("lets ship run when it is not set", () => {
    assert.doesNotThrow(() => assertNoRemovedSwitches({}));
    assert.doesNotThrow(() =>
      assertNoRemovedSwitches({ PATH: "/usr/bin", MORPH_OTHER: "1" }),
    );
  });

  // Structural, not behavioural: ship() is not run here, since it pushes and
  // calls gh. Every command ship runs goes through run() or runVisible(), the
  // spawnSync wrappers, so the check must be called in ship()'s body before
  // the first of them — and before any await, so nothing is scheduled first.
  it("is the first thing ship() does, before any command runs", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "ship.mjs"),
      "utf8",
    );
    const start = source.indexOf("\nasync function ship() {\n");
    assert.ok(start >= 0, "ship.mjs must define async function ship()");
    const body = source.slice(start);
    const check = body.indexOf("assertNoRemovedSwitches(process.env);");
    assert.ok(check >= 0, "ship() must call assertNoRemovedSwitches");
    const firstEffect = Math.min(
      ...[
        /\brun\(/,
        /\brunVisible\(/,
        /\bspawnSync\(/,
        /\bawait\b/,
        /\blog\(/,
      ].map((pattern) => pattern.exec(body)?.index ?? Infinity),
    );
    assert.ok(
      check < firstEffect,
      "assertNoRemovedSwitches must come before ship()'s first command",
    );
    // The process.env read in ship() goes through the check only.
    assert.deepEqual(
      [...body.matchAll(/MORPH_SHIP_REQUIRED_ONLY/g)].length,
      0,
      "ship() must not read the removed switch itself",
    );
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
    assert.equal(
      preflight({ branch: "fix/thing", ahead: "abc1234 a commit" }),
      null,
    );
  });
});

describe("what a refused merge says", () => {
  it("names every check that was not green, with its conclusion", () => {
    const message = describeUnhappy([
      { name: "Typecheck, test, build", conclusion: "FAILURE" },
      {
        name: "Editor end-to-end (local preview transport)",
        conclusion: "CANCELLED",
      },
    ]);
    assert.match(message, /^CHECK_NOT_GREEN:/);
    assert.match(message, /Typecheck, test, build \(FAILURE\)/);
    assert.match(
      message,
      /end-to-end \(local preview transport\) \(CANCELLED\)/,
    );
  });

  it("says nothing was merged and the work is still there", () => {
    // The sentence a person reads at the point they most expect to have lost
    // something. `CANCELLED` reaching here at all is the fix this file guards.
    const message = describeUnhappy([
      { name: "Architecture guards", conclusion: "CANCELLED" },
    ]);
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
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        ".github",
        "workflows",
        "ci.yml",
      ),
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

describe("a commit with more than one workflow run", () => {
  // What PR #103's rollup held after it was reopened: every check twice, the
  // first run's acceptance job failed and the second run's passed.
  const inRun = (run, check) => ({
    ...check,
    detailsUrl: `https://github.com/chao800404/morph/actions/runs/${run}/job/1`,
  });
  const acceptance = (conclusion, status = "COMPLETED") => ({
    name: "Editor end-to-end (local preview transport)",
    status,
    conclusion,
  });
  const run = (id, acceptanceCheck) => [
    inRun(id, guard("SUCCESS")),
    inRun(id, other("SUCCESS")),
    inRun(id, success(FULL_START)),
    ...shardChecks().map((check) => inRun(id, check)),
    inRun(id, acceptanceCheck),
  ];

  it("merges on the newest run when an older run failed", () => {
    assert.equal(
      verdict(
        latestChecks([
          ...run(37475243403, acceptance("FAILURE")),
          ...run(37478782101, acceptance("SUCCESS")),
        ]),
      ),
      "merge",
    );
  });
  it("refuses when the newest run failed, whatever an older run said", () => {
    assert.equal(
      verdict(
        latestChecks([
          ...run(37478782101, acceptance("FAILURE")),
          ...run(37475243403, acceptance("SUCCESS")),
        ]),
      ),
      "refuse",
    );
  });
  it("waits for a newer run still in progress instead of refusing on the old one", () => {
    assert.equal(
      verdict(
        latestChecks([
          ...run(37475243403, acceptance("FAILURE")),
          ...run(37478782101, acceptance(null, "IN_PROGRESS")),
        ]),
      ),
      "wait",
    );
  });
  it("keeps every check when there is one run", () => {
    const single = run(37478782101, acceptance("SUCCESS"));
    assert.equal(latestChecks(single).length, single.length);
  });
});
