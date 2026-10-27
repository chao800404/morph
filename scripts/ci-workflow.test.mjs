import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CHECK_DEPENDENCIES,
  VALIDATE_CHECK,
  VALIDATION_CHECKS,
} from "./ci-required-checks.mjs";
import {
  jobBlock,
  jobCheckNames,
  jobKeys,
  withoutComments,
} from "./ci-workflow.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const jobs = ["validate-typecheck", "validate-test", "validate-build"];

test("validation runs independently with the complete original commands", () => {
  const commands = [
    [
      "pnpm typecheck",
      "pnpm check:e2e-assertions",
      "pnpm check:sql-timestamps",
    ],
    ["pnpm toolchain:astro", "pnpm test"],
    ["pnpm build"],
  ];
  for (const [index, key] of jobs.entries()) {
    const block = withoutComments(jobBlock(workflow, key));
    assert.deepEqual(jobCheckNames(workflow, key), [VALIDATION_CHECKS[index]]);
    assert.doesNotMatch(
      block,
      /^ {4}(?:needs|if):/m,
      `${key} must run independently`,
    );
    assert.doesNotMatch(block, /^\s+(?:continue-on-error|if):/m);
    const actual = [...block.matchAll(/^ {8}run: (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(actual, [
      "pnpm install --frozen-lockfile",
      ...commands[index],
    ]);
    assert.match(block, /node-version: 22\n/);
    assert.match(block, /cache: pnpm\n/);
  }
  assert.match(jobBlock(workflow, "validate-test"), /timeout-minutes: 20\n/);
});

test("the existing aggregate waits for all validation jobs and is always evaluated", () => {
  const block = withoutComments(jobBlock(workflow, "validate"));
  assert.deepEqual(jobCheckNames(workflow, "validate"), [VALIDATE_CHECK]);
  const needs = /^ {4}needs: \[([^\]]+)\]$/m.exec(block);
  assert.ok(needs, "the aggregate must name its dependencies");
  assert.deepEqual(
    needs[1].split(",").map((key) => key.trim()),
    jobs,
  );
  assert.match(block, /^ {4}if: always\(\)$/m);
  assert.match(block, /- name: Checkout\n\s+uses: actions\/checkout@v4\n/);
  assert.ok(
    block.indexOf("- name: Checkout") <
      block.indexOf("- name: Require all validation jobs to succeed"),
    "the aggregate must expose the same checkout evidence as its children",
  );
  assert.doesNotMatch(block, /continue-on-error:/);
  assert.deepEqual(CHECK_DEPENDENCIES[VALIDATE_CHECK], VALIDATION_CHECKS);
  for (const [index, result] of [
    "TYPECHECK_RESULT",
    "TEST_RESULT",
    "BUILD_RESULT",
  ].entries()) {
    assert.ok(block.includes(`${result}: \${{ needs.${jobs[index]}.result }}`));
  }
});

test("the workflow's actual shell gate rejects failures, cancellations, skips and absent results", () => {
  const block = withoutComments(jobBlock(workflow, "validate"));
  const run = /^ {8}run: \|\n((?: {10}[^\n]*\n?)+)/m.exec(block);
  assert.ok(run, "the aggregate must execute a result gate");
  const script = run[1].replace(/^ {10}/gm, "");
  const outcomes = ["success", "failure", "cancelled", "skipped", ""];
  for (const typecheck of outcomes)
    for (const tests of outcomes)
      for (const build of outcomes) {
        const results = [typecheck, tests, build];
        const result = spawnSync(
          "bash",
          ["-e", "-o", "pipefail", "-c", script],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              TYPECHECK_RESULT: typecheck,
              TEST_RESULT: tests,
              BUILD_RESULT: build,
            },
          },
        );
        assert.ifError(result.error);
        assert.equal(result.signal, null);
        assert.equal(
          result.status === 0,
          results.every((v) => v === "success"),
          JSON.stringify(results),
        );
      }
});

test("architecture CI executes these workflow gate tests", () => {
  assert.match(
    withoutComments(jobBlock(workflow, "architecture-guards")),
    /^\s+node --test scripts\/ci-workflow\.test\.mjs$/m,
  );
});

test("every job that installs Chromium first puts the primary Ubuntu archive ahead of the Azure mirror", () => {
  const installers = jobKeys(workflow).filter((key) =>
    withoutComments(jobBlock(workflow, key)).includes(
      "- name: Install Chromium for Playwright",
    ),
  );
  assert.ok(installers.length >= 2, "both E2E matrices install Chromium");
  for (const key of installers) {
    const block = withoutComments(jobBlock(workflow, key));
    const source = block.indexOf(
      "- name: Use the primary Ubuntu archive for apt",
    );
    assert.ok(source >= 0, `${key} must set the apt source`);
    assert.ok(
      source < block.indexOf("- name: Install Chromium for Playwright"),
      `${key} must set the apt source before installing`,
    );
    const step = block.slice(source, block.indexOf("\n      - name:", source));
    assert.ok(
      step.includes(
        "grep -qx 'URIs: mirror+file:/etc/apt/apt-mirrors.txt' /etc/apt/sources.list.d/ubuntu.sources || {",
      ),
      `${key} must refuse a runner whose sources skip the mirror list`,
    );
    assert.ok(
      step.includes(
        "printf '%s\\tpriority:%s\\n' https://archive.ubuntu.com/ubuntu/ 1 https://security.ubuntu.com/ubuntu/ 2",
      ),
      `${key} must list the primary archive first`,
    );
    assert.doesNotMatch(step, /azure/);
    assert.doesNotMatch(step, /continue-on-error/);
  }
});
