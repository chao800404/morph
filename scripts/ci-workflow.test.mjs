import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CHECK_DEPENDENCIES,
  CONTAINER_STAGE3_CHECKS,
  SANDBOX_PRERENDER_SMOKE_CHECK,
  VALIDATE_CHECK,
  VALIDATION_CHECKS,
  VALIDATION_TEST_CHECK,
  VITEST_SHARD_CHECKS,
} from "./ci-required-checks.mjs";
import {
  VITEST_SHARD_COUNT,
  vitestReportAttempt,
} from "./check-vitest-shards.mjs";
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

/**
 * Stage 3's container jobs beyond editor-e2e-container (M1 1d): each runs its
 * targets in this order, one runner invocation and one network window per
 * target, as editor-e2e-container runs lifecycle and preview access.
 */
const STAGE3_JOBS = {
  "editor-e2e-container-publish": [
    {
      label: "B1 publish and rollback",
      id: "b1_publish_rollback",
      window: "b1-publish-rollback",
      spec: "b1-publish-rollback-acceptance.spec.ts",
      target: "b1-publish-rollback.mjs",
    },
    {
      label: "public navigation matrix",
      id: "navigation_matrix_public",
      window: "navigation-matrix-public",
      spec: "navigation-matrix-public.spec.ts",
      target: "navigation-matrix-public.mjs",
    },
  ],
  "editor-e2e-container-starter-publish": [
    {
      label: "Starter upgrade publish",
      id: "starter_upgrade_publish",
      window: "starter-upgrade-publish",
      spec: "starter-upgrade-publish-acceptance.spec.ts",
      target: "starter-upgrade-publish.mjs",
    },
    {
      label: "Starter 32 full Start",
      id: "starter_v32_full_start",
      window: "starter-v32-full-start",
      spec: "starter-v32-full-start-acceptance.spec.ts",
      target: "starter-v32-full-start.mjs",
    },
  ],
  "editor-e2e-container-preview": [
    {
      label: "preview socket",
      id: "preview_socket",
      window: "preview-socket",
      spec: "preview-socket-acceptance.spec.ts",
      target: "preview-socket-acceptance.mjs",
    },
    {
      label: "Start content sync",
      id: "start_content_sync",
      window: "start-container-content-sync",
      spec: "start-container-content-sync.spec.ts",
      target: "start-container-content-sync.mjs",
    },
    {
      label: "Starter upgrade case E",
      id: "starter_upgrade_case_e",
      window: "starter-upgrade-case-e",
      spec: "starter-upgrade.spec.ts",
      target: "starter-upgrade-case-e.mjs",
      grep: "E\\. a toolchain pin an earlier Starter wrote",
    },
    {
      label: "two-tab start race",
      id: "preview_start_two_tab_race",
      window: "preview-start-two-tab-race",
      spec: "preview-start-two-tab-race.spec.ts",
      target: "preview-start-two-tab-race.mjs",
    },
  ],
};

// The whole `pnpm test` command, narrowed to one shard. Reporters named on the
// command line replace Vitest's defaults, so both defaults are named again.
const SHARD_TEST_COMMAND = `pnpm test --shard=\${{ matrix.shard }}/${VITEST_SHARD_COUNT} --passWithNoTests --reporter=default --reporter=github-actions --reporter=json --outputFile.json=test-results/vitest-shard-\${{ matrix.shard }}.json`;

test("validation runs independently with the complete original commands", () => {
  const runners = [
    ["validate-typecheck", ["Validation typecheck"]],
    ["validate-test-shard", VITEST_SHARD_CHECKS],
    ["validate-build", ["Validation build"]],
  ];
  const commands = [
    [
      "pnpm typecheck",
      "pnpm check:e2e-assertions",
      "pnpm check:sql-timestamps",
    ],
    [
      "pnpm toolchain:astro",
      "node scripts/print-test-runner.mjs",
      SHARD_TEST_COMMAND,
    ],
    ["pnpm build"],
  ];
  for (const [index, [key, names]] of runners.entries()) {
    const block = withoutComments(jobBlock(workflow, key));
    assert.deepEqual(jobCheckNames(workflow, key), names);
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
  // Each shard keeps the budget the single job had; a shard is not given less.
  assert.match(
    jobBlock(workflow, "validate-test-shard"),
    /timeout-minutes: 45\n/,
  );
});

test("the Vitest shard matrix runs every planned shard once, without retries or fail-fast", () => {
  const block = withoutComments(jobBlock(workflow, "validate-test-shard"));
  const matrix = /^ {8}shard: \[([^\]]*)\]$/m.exec(block);
  assert.ok(matrix, "the shard job must declare its shard matrix");
  assert.deepEqual(
    matrix[1].split(",").map((value) => Number(value.trim())),
    Array.from({ length: VITEST_SHARD_COUNT }, (_, index) => index + 1),
  );
  // One shard's failure must not cancel the others: their results are the
  // evidence of what else is broken, and a cancelled shard is not a pass.
  assert.match(block, /^ {6}fail-fast: false$/m);
  assert.doesNotMatch(block, /retry|retries|continue-on-error|max-attempts/i);
  // `pnpm test` itself, not a second Vitest command: same script, same config.
  assert.equal(
    [...block.matchAll(/^ {8}run: pnpm test\b.*$/gm)].length,
    1,
    "exactly one test command per shard",
  );
  // Only the shard job runs Vitest with --shard, and only at this count.
  const elsewhere = withoutComments(
    workflow.replace(jobBlock(workflow, "validate-test-shard"), ""),
  );
  assert.doesNotMatch(elsewhere, /pnpm test --shard|vitest run --shard/);
  const upload = block.slice(
    block.indexOf("- name: Upload the shard's Vitest report"),
  );
  assert.match(upload, /uses: actions\/upload-artifact@v4\n/);
  assert.match(
    upload,
    /name: vitest-results-\$\{\{ matrix\.shard \}\}-attempt-\$\{\{ github\.run_attempt \}\}\n/,
  );
  assert.match(
    upload,
    /path: test-results\/vitest-shard-\$\{\{ matrix\.shard \}\}\.json\n/,
  );
  assert.match(upload, /if-no-files-found: error\n/);
  // The names the shard uploads are the names the guard reads.
  assert.deepEqual(
    vitestReportAttempt(
      "vitest-shard-artifacts/vitest-results-2-attempt-1/vitest-shard-2.json",
    ),
    { shard: 2, attempt: 1 },
  );
});

test("Validation tests waits for every shard, refuses any other result, and checks executed coverage", () => {
  const block = withoutComments(jobBlock(workflow, "validate-test"));
  assert.deepEqual(jobCheckNames(workflow, "validate-test"), [
    VALIDATION_TEST_CHECK,
  ]);
  assert.ok(VALIDATION_CHECKS.includes(VALIDATION_TEST_CHECK));
  assert.match(block, /^ {4}needs: validate-test-shard$/m);
  assert.match(block, /^ {4}if: always\(\)$/m);
  assert.doesNotMatch(block, /continue-on-error|retry/i);
  assert.ok(
    block.includes(
      "VITEST_SHARD_RESULT: ${{ needs.validate-test-shard.result }}\n",
    ),
  );
  // The result gate is the first step, so nothing runs on a failed matrix.
  const first = /^ {6}- name: (.+)$/m.exec(block);
  assert.equal(first?.[1], "Require every shard to succeed");
  const gate = /^ {8}run: (test "\$VITEST_SHARD_RESULT" = success)$/m.exec(
    block,
  );
  assert.ok(gate, "the aggregate must execute a result gate");
  for (const outcome of ["success", "failure", "cancelled", "skipped", ""]) {
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", gate[1]], {
      encoding: "utf8",
      env: { ...process.env, VITEST_SHARD_RESULT: outcome },
    });
    assert.ifError(result.error);
    assert.equal(result.status === 0, outcome === "success", outcome);
  }
  const download = block.slice(
    block.indexOf("- name: Download all shard reports"),
  );
  assert.match(download, /uses: actions\/download-artifact@v4\n/);
  assert.match(download, /pattern: vitest-results-\*\n/);
  assert.match(download, /path: vitest-shard-artifacts\n/);
  assert.ok(
    block.includes(
      "node --test scripts/check-vitest-shards.test.mjs scripts/vitest-shard-sequencer.test.mjs\n          node scripts/check-vitest-shards.mjs vitest-shard-artifacts\n",
    ),
    "the aggregate must test the guard and then run it on the downloaded reports",
  );
  assert.ok(
    block.indexOf("- name: Require every shard to succeed") <
      block.indexOf("- name: Check every test file ran in exactly one shard"),
  );
  // ship waits for the aggregate while the shards are green but it is absent.
  assert.deepEqual(
    CHECK_DEPENDENCIES[VALIDATION_TEST_CHECK],
    VITEST_SHARD_CHECKS,
  );
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

test("container acceptance targets are exactly wired or explicitly deferred", async () => {
  const container = withoutComments(jobBlock(workflow, "editor-e2e-container"));
  const targetNames = readdirSync(
    new URL("./container-acceptance-targets/", import.meta.url),
  )
    .filter((name) => name.endsWith(".mjs"))
    .sort();
  const targetsIn = (block) =>
    [
      ...block.matchAll(
        /scripts\/container-acceptance-targets\/([a-z0-9-]+\.mjs)/g,
      ),
    ].map((match) => match[1]);
  const wired = targetsIn(container);
  // Targets another job already checks in target mode. Each is pinned to its
  // own job, so moving or dropping one fails here rather than passing as
  // "covered".
  const wiredElsewhere = {
    "editor-e2e-container-presentation-ack": ["presentation-ack-refresh.mjs"],
    ...Object.fromEntries(
      Object.entries(STAGE3_JOBS).map(([job, targets]) => [
        job,
        targets.map((t) => t.target),
      ]),
    ),
  };
  for (const [job, names] of Object.entries(wiredElsewhere)) {
    assert.deepEqual(targetsIn(withoutComments(jobBlock(workflow, job))), names);
  }
  const wiredOutsideContainer = Object.values(wiredElsewhere).flat();
  assert.deepEqual(
    targetsIn(withoutComments(workflow)).sort(),
    [...wired, ...wiredOutsideContainer].sort(),
    "every target the workflow checks must belong to a pinned job",
  );
  // A target module added without a CI step must be listed here, with the
  // change that will wire it. All six deferred by #396 are wired (M1 1d).
  // astro-basis-ack.mjs: Astro container E2E is local only for M2 (owner
  // decision D4, 2026-11-26); a later CI job wires it. The same holds for
  // astro-inspector-write.mjs (M2 PR 3, extended for M2 D3) and
  // astro-design-release.mjs (M2 D3, Design edits published and rolled back)
  // and astro-layout-inline.mjs (M2 D3 batch 2, layout and canvas editing).
  /** @type {string[]} */
  const deferred = [
    "astro-basis-ack.mjs",
    "astro-design-release.mjs",
    "astro-inspector-write.mjs",
    "astro-layout-inline.mjs",
    "b1-route-publish-rollback.mjs",
    "preview-revocation-timeline.mjs",
    // M3 stage 1, the newsletter acceptance (#477): run locally on the
    // container transport; its CI step comes in a later change.
    "publish-hidden-page-section.mjs",
  ];

  assert.deepEqual(wired, ["preview-access-container.mjs"]);
  assert.deepEqual([...deferred].sort(), deferred);
  assert.equal(new Set(wired).size, wired.length, "wired targets must be unique");
  assert.equal(
    new Set(deferred).size,
    deferred.length,
    "deferred targets must be unique",
  );
  assert.equal(
    [...wired, ...wiredOutsideContainer].filter((name) => deferred.includes(name))
      .length,
    0,
    "wired and deferred targets must be disjoint",
  );
  assert.deepEqual(
    [...wired, ...wiredOutsideContainer, ...deferred].sort(),
    targetNames,
  );

  const requiredOrder = [
    "- name: Run M1 container lifecycle acceptance",
    "- name: Preserve lifecycle acceptance report",
    "- name: Require lifecycle container acceptance",
    "- name: Require lifecycle runner handover",
    "- name: Run preview access container acceptance",
    "- name: Preserve preview access acceptance report",
    "- name: Require exact preview access target",
    "- name: Require preview access runner handover",
    "- name: Record Stage 3 runner identities and handover results",
  ].map((name) => container.indexOf(name));
  assert.ok(requiredOrder.every((index) => index >= 0), "all sequential gates must exist");
  assert.ok(
    requiredOrder.every((index, position) =>
      position === 0 || requiredOrder[position - 1] < index,
    ),
    "preview access must start only after the lifecycle report and handover gates",
  );
  assert.match(
    container,
    /MORPH_E2E_HANDOVER_RECORD: \$\{\{ runner\.temp \}\}\/stage3\/lifecycle-handover\.json/,
  );
  assert.match(
    container,
    /MORPH_E2E_HANDOVER_RECORD: \$\{\{ runner\.temp \}\}\/stage3\/preview-access-handover\.json/,
  );
  // Task 38 item 2: the whole lifecycle test-results is kept, not only the
  // report (its sidecar logs and traces go when the next run starts).
  assert.match(
    container,
    /cp -R test-results\/\. "\$RUNNER_TEMP\/stage3\/lifecycle\/"/,
  );
  assert.match(container, /\$\{\{ runner\.temp \}\}\/stage3\//);

  const wiredFiles = [];
  for (const name of wired) {
    const { TARGET } = await import(
      new URL(`./container-acceptance-targets/${name}`, import.meta.url).href
    );
    wiredFiles.push(TARGET.file);
  }
  const invokedSpecs = [
    ...container.matchAll(
      /exec node scripts\/run-container-e2e-isolated\.mjs scripts\/run-editor-e2e\.mjs e2e\/([^\s]+)/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(
    invokedSpecs.sort(),
    [
      "m1-container-lifecycle-acceptance.spec.ts",
      "preview-access-container.spec.ts",
    ].sort(),
    "both Stage 3 targets must use the same isolated runner launcher",
  );
  assert.match(container, /Require preview access runner handover/);
  assert.match(container, /Record Stage 3 runner identities and handover results/);
  assert.match(container, /LIFECYCLE_HANDOVER_OUTCOME/);
  assert.match(container, /PREVIEW_ACCESS_HANDOVER_OUTCOME/);
  assert.match(container, /sid=\$\{runner\.sid\}/);
  assert.match(container, /stage3\/preview-access\/preview-access-container\.json/);
  for (const file of wiredFiles) {
    assert.equal(
      invokedSpecs.filter((spec) => spec === file).length,
      1,
      `${file} must be run exactly once by the container job`,
    );
  }
});

/**
 * One step of a job block: from its `- name:` line to the next step's.
 * @param {string} job
 * @param {string} name
 */
function stepBlock(job, name) {
  const start = job.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `step ${name} must exist`);
  const next = job.indexOf("\n      - name: ", start + 1);
  return next < 0 ? job.slice(start) : job.slice(start, next + 1);
}

test("Stage 3 checks a handover only after its run, against the run's lock, and keeps both runs' evidence", () => {
  const container = withoutComments(jobBlock(workflow, "editor-e2e-container"));
  const lockFile = (/** @type {string} */ block) =>
    /^ {10}MORPH_E2E_LOCK_FILE: (.+)$/m.exec(block)?.[1];

  for (const [runName, id, checkName] of [
    ["Run M1 container lifecycle acceptance", "lifecycle_run", "Require lifecycle runner handover"],
    ["Run preview access container acceptance", "preview_access_run", "Require preview access runner handover"],
  ]) {
    const run = stepBlock(container, runName);
    const check = stepBlock(container, checkName);
    assert.match(run, new RegExp(`^ {8}id: ${id}$`, "m"), runName);
    // A skipped run has no record; checking it only adds an ENOENT failure.
    assert.match(
      check,
      new RegExp(`^ {8}if: always\\(\\) && steps\\.${id}\\.outcome != 'skipped'$`, "m"),
      checkName,
    );
    assert.ok(lockFile(run), `${runName} must name its lock file`);
    assert.equal(lockFile(check), lockFile(run), `${checkName} must check the run's lock`);
  }

  const preserve = stepBlock(container, "Preserve lifecycle acceptance report");
  assert.match(preserve, /^ {8}if: always\(\)$/m);
  assert.match(preserve, /cp -R test-results\/\. "\$RUNNER_TEMP\/stage3\/lifecycle\/"/);

  // An unset step outcome is "", which `??` would print as is.
  const record = stepBlock(container, "Record Stage 3 runner identities and handover results");
  assert.doesNotMatch(record, /\?\? "not-run"/);
  assert.equal((record.match(/outcome \|\| "not-run"/g) ?? []).length, 2);

  // test-results stays the artifact's root, as on main; Stage 3 goes inside it.
  const keep = stepBlock(container, "Keep Stage 3 records with the results");
  assert.match(keep, /^ {8}if: always\(\)$/m);
  assert.match(keep, /cp -R "\$RUNNER_TEMP\/stage3\/\." test-results\/stage3\//);
  const upload = stepBlock(container, "Upload results and failure traces");
  assert.match(upload, /^ {10}path: test-results\/$/m);
  assert.doesNotMatch(upload, /runner\.temp/);
  assert.ok(container.indexOf(keep) < container.indexOf(upload));
  assert.ok(
    container.indexOf(
      stepBlock(
        container,
        "Require the run's container veths to have had no IPv6 link-local address",
      ),
    ) < container.indexOf(keep),
    "Stage 3 records are copied after the last step that writes test-results",
  );
});

test("Stage 3 probes the clock at each window marker and checks every window's veths after the monitor stops", () => {
  const container = withoutComments(jobBlock(workflow, "editor-e2e-container"));
  for (const [stepName, marker, always] of [
    ["Mark lifecycle container window start", "lifecycle-start", false],
    ["Mark lifecycle container window end", "lifecycle-end", true],
    ["Mark preview access container window start", "preview-access-start", false],
    ["Mark preview access container window end", "preview-access-end", true],
  ]) {
    const step = stepBlock(container, stepName);
    const mark = step.indexOf(`printf '{"name":"${marker}","utc":"%s"}\\n'`);
    const probe = step.indexOf(
      `node scripts/check-container-network-windows.mjs probe ${marker} "$RUNNER_TEMP/container-network"`,
    );
    assert.ok(mark >= 0, `${stepName} must write its marker`);
    assert.ok(probe > mark, `${stepName} must probe the clock right after its marker`);
    assert.equal(/^ {8}if: always\(\)$/m.test(step), always, stepName);
    assert.doesNotMatch(step, /continue-on-error|\|\| true/, stepName);
  }

  const name = "Require each container window's veths to have come and gone inside it";
  const check = stepBlock(container, name);
  assert.match(check, /^ {8}if: always\(\)$/m);
  assert.match(
    check,
    /^ {8}run: node scripts\/check-container-network-windows\.mjs check "\$RUNNER_TEMP\/container-network"$/m,
  );
  assert.doesNotMatch(check, /continue-on-error/);
  const at = (/** @type {string} */ step) => container.indexOf(`      - name: ${step}\n`);
  // After the link-local step has stopped the monitor, so the record is whole.
  assert.ok(
    at("Require the run's container veths to have had no IPv6 link-local address") < at(name) &&
      at(name) < at("Upload results and failure traces"),
  );
});

test("each Stage 3 job reports its own check, on the container runner, within the container jobs' timeout", () => {
  assert.deepEqual(
    Object.keys(STAGE3_JOBS).flatMap((key) => jobCheckNames(workflow, key)),
    CONTAINER_STAGE3_CHECKS,
  );
  for (const key of Object.keys(STAGE3_JOBS)) {
    const block = withoutComments(jobBlock(workflow, key));
    assert.match(block, /^ {4}runs-on: ubuntu-24\.04$/m, key);
    assert.match(block, /^ {4}timeout-minutes: 30$/m, key);
    assert.doesNotMatch(block, /^ {4}(?:needs|if|strategy):/m, `${key} runs on its own`);
    assert.doesNotMatch(block, /continue-on-error/, key);
    // The same setup as the other container jobs: the steps up to the first
    // container window are presentation-ack's, word for word.
    const ack = withoutComments(
      jobBlock(workflow, "editor-e2e-container-presentation-ack"),
    );
    const setup = (/** @type {string} */ job, /** @type {string} */ until) =>
      job.slice(job.indexOf("    steps:\n"), job.indexOf(until));
    assert.equal(
      setup(block, "      - name: Mark "),
      setup(ack, "      - name: Run presentation-ack container acceptance"),
      `${key} sets up as the presentation-ack job does`,
    );
  }
});

test("each Stage 3 job runs each target once, isolated, then checks its exact titles and its handover before the next", async () => {
  for (const [key, targets] of Object.entries(STAGE3_JOBS)) {
    const job = withoutComments(jobBlock(workflow, key));
    const at = (/** @type {string} */ name) => job.indexOf(`      - name: ${name}\n`);
    const order = [];
    for (const t of targets) {
      const { TARGET } = await import(
        new URL(`./container-acceptance-targets/${t.target}`, import.meta.url).href
      );
      assert.equal(TARGET.file, t.spec, `${t.target} names its spec`);
      const report = `test-results/${t.window}.json`;
      const kept = `"$RUNNER_TEMP/stage3/${t.window}/${t.window}.json"`;
      const handover = `\${{ runner.temp }}/stage3/${t.window}-handover.json`;

      const run = stepBlock(job, `Run ${t.label} container acceptance`);
      assert.match(run, new RegExp(`^ {8}id: ${t.id}_run$`, "m"));
      assert.doesNotMatch(run, /^ {8}if:/m, `${key}: ${t.label} runs only after everything before it passed`);
      for (const line of [
        "MORPH_E2E_TRANSPORT: cloudflare-sandbox",
        "MORPH_E2E_PREVIEW_RUNTIME: start",
        "MORPH_THEME_PREVIEW_RUNTIME: start",
        `MORPH_E2E_REPORT_PATH: ${report}`,
        `MORPH_E2E_HANDOVER_RECORD: ${handover}`,
        'MORPH_E2E_LOCK: "1"',
        "MORPH_E2E_LOCK_FILE: /tmp/morph-editor-e2e.lock",
      ]) {
        assert.ok(run.includes(`\n          ${line}\n`), `${key}: ${t.label} sets ${line}`);
      }
      const command = /^ {8}run: (.+)$/m.exec(run)?.[1];
      assert.equal(
        command,
        `exec node scripts/run-container-e2e-isolated.mjs scripts/run-editor-e2e.mjs e2e/${t.spec}${
          t.grep ? ` --grep "${t.grep}"` : ""
        }`,
        `${key}: ${t.label} runs its spec alone, under the isolated launcher`,
      );

      const preserve = stepBlock(job, `Preserve ${t.label} acceptance report`);
      assert.match(preserve, /^ {8}if: always\(\)$/m);
      assert.ok(preserve.includes(`cp -R test-results/. "$RUNNER_TEMP/stage3/${t.window}/"`));

      // Target mode: each listed title once, passed, zero skip, zero retry,
      // and no unlisted test of the file.
      const check = stepBlock(job, `Require exact ${t.label} target`);
      assert.doesNotMatch(check, /^ {8}if:/m);
      assert.equal(
        /^ {8}run: (.+)$/m.exec(check)?.[1],
        `node scripts/check-container-acceptance.mjs ${kept} scripts/container-acceptance-targets/${t.target}`,
      );

      const gate = stepBlock(job, `Require ${t.label} runner handover`);
      assert.match(gate, new RegExp(`^ {8}id: ${t.id}_handover$`, "m"));
      assert.match(
        gate,
        new RegExp(`^ {8}if: always\\(\\) && steps\\.${t.id}_run\\.outcome != 'skipped'$`, "m"),
      );
      assert.match(gate, /^ {10}MORPH_E2E_LOCK_FILE: \/tmp\/morph-editor-e2e\.lock$/m);
      assert.equal(
        /^ {8}run: (.+)$/m.exec(gate)?.[1],
        `node scripts/check-container-run-handover.mjs "$RUNNER_TEMP/stage3/${t.window}-handover.json" e2e/${t.spec}`,
      );

      for (const [edge, always] of [
        ["start", false],
        ["end", true],
      ]) {
        const name = `Mark ${t.label} container window ${edge}`;
        const step = stepBlock(job, name);
        const mark = step.indexOf(`printf '{"name":"${t.window}-${edge}","utc":"%s"}\\n'`);
        const probe = step.indexOf(
          `node scripts/check-container-network-windows.mjs probe ${t.window}-${edge} "$RUNNER_TEMP/container-network"`,
        );
        assert.ok(mark >= 0 && probe > mark, `${key}: ${name} marks, then probes the clock`);
        assert.equal(/^ {8}if: always\(\)$/m.test(step), always, name);
      }

      order.push(
        `Mark ${t.label} container window start`,
        `Run ${t.label} container acceptance`,
        `Mark ${t.label} container window end`,
        `Preserve ${t.label} acceptance report`,
        `Require exact ${t.label} target`,
        `Require ${t.label} runner handover`,
      );
    }
    order.push(
      "Record Stage 3 runner identities and handover results",
      "Stop container diagnostics",
      "Require the run's container veths to have had no IPv6 link-local address",
      "Require each container window's veths to have come and gone inside it",
      "Keep Stage 3 records with the results",
      "Upload results and failure traces",
    );
    const positions = order.map(at);
    assert.ok(positions.every((p) => p >= 0), `${key}: every step exists`);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${key}: steps in order`);

    // Each spec once, and nothing else run under the launcher.
    const invoked = [
      ...job.matchAll(
        /exec node scripts\/run-container-e2e-isolated\.mjs scripts\/run-editor-e2e\.mjs e2e\/([^\s]+)/g,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(invoked, targets.map((t) => t.spec), key);
    assert.doesNotMatch(job, /node scripts\/run-editor-e2e\.mjs/, `${key}: never outside the launcher`);

    const windows = stepBlock(job, "Require each container window's veths to have come and gone inside it");
    assert.match(windows, /^ {8}if: always\(\)$/m);
    assert.equal(
      /^ {8}run: (.+)$/m.exec(windows)?.[1],
      `node scripts/check-container-network-windows.mjs check "$RUNNER_TEMP/container-network" ${targets.map((t) => t.window).join(" ")}`,
    );
    const record = stepBlock(job, "Record Stage 3 runner identities and handover results");
    assert.match(record, /^ {8}if: always\(\)$/m);
    for (const t of targets) {
      assert.ok(
        record.includes(`${t.id.toUpperCase()}_HANDOVER_OUTCOME: \${{ steps.${t.id}_handover.outcome }}`),
        `${key}: records ${t.label}'s handover outcome`,
      );
    }
    assert.doesNotMatch(record, /\?\? "not-run"/);
    const keep = stepBlock(job, "Keep Stage 3 records with the results");
    assert.match(keep, /cp -R "\$RUNNER_TEMP\/stage3\/\." test-results\/stage3\//);
    const upload = stepBlock(job, "Upload results and failure traces");
    assert.match(upload, /^ {10}path: test-results\/$/m);
    assert.match(upload, new RegExp(`^ {10}name: ${key}-attempt-\\$\\{\\{ github\\.run_attempt \\}\\}$`, "m"));
    assert.match(upload, /^ {10}if-no-files-found: error$/m);
  }
});

test("every Stage 3 window is one the network check knows, and each job names its own in run order", async () => {
  const { KNOWN_WINDOWS } = await import("./check-container-network-windows.mjs");
  const named = Object.values(STAGE3_JOBS).flatMap((targets) => targets.map((t) => t.window));
  assert.deepEqual(
    [...named, "lifecycle", "preview-access"].sort(),
    [...KNOWN_WINDOWS].sort(),
    "every known window belongs to exactly one job's step",
  );
  assert.equal(new Set(named).size, named.length);
});

test("case E's step selects exactly case E of its spec", async () => {
  const { TARGET } = await import("./container-acceptance-targets/starter-upgrade-case-e.mjs");
  const [caseE] = STAGE3_JOBS["editor-e2e-container-preview"].filter((t) => t.grep);
  const source = readFileSync(new URL(`../e2e/${caseE.spec}`, import.meta.url), "utf8");
  const titles = [...source.matchAll(/^\s+test\(\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(titles.length > 1, "the spec has more tests than case E");
  const grep = new RegExp(caseE.grep);
  const selected = titles.filter((title) => grep.test(title));
  assert.deepEqual(
    selected.map((title) => `Starter upgrade, reviewed by the author › ${title}`),
    TARGET.titles,
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

test("every job that installs Chromium caches only its download, keyed by the exact Playwright version", () => {
  const installers = jobKeys(workflow).filter((key) =>
    withoutComments(jobBlock(workflow, key)).includes(
      "- name: Install Chromium for Playwright",
    ),
  );
  assert.ok(installers.length >= 2, "both E2E matrices install Chromium");
  for (const key of installers) {
    const block = withoutComments(jobBlock(workflow, key));
    const resolve = block.indexOf("- name: Resolve the Playwright browser cache key");
    const restore = block.indexOf("- name: Restore the Playwright browser download");
    const install = block.indexOf("- name: Install Chromium for Playwright");
    assert.ok(resolve >= 0 && resolve < restore, `${key} must resolve the key before restoring`);
    assert.ok(restore < install, `${key} must restore before installing`);
    assert.ok(
      block.indexOf("- name: Install dependencies") < resolve,
      `${key} must read the version after pnpm install`,
    );
    const keyStep = block.slice(resolve, restore);
    assert.ok(
      keyStep.includes("pnpm exec playwright --version"),
      `${key} must take the version from the installed Playwright`,
    );
    assert.ok(
      keyStep.includes("${RUNNER_OS}") && keyStep.includes("${version}"),
      `${key}'s key must carry the runner OS and the version`,
    );
    const restoreStep = block.slice(restore, block.indexOf("\n      - name:", restore));
    assert.ok(restoreStep.includes("uses: actions/cache@v4"));
    assert.ok(restoreStep.includes("path: ~/.cache/ms-playwright"));
    assert.ok(
      restoreStep.includes("key: ${{ steps.playwright.outputs.key }}"),
      `${key} must key the cache by the resolved key`,
    );
    // A different version must miss; a fallback key could restore an old browser.
    assert.doesNotMatch(restoreStep, /restore-keys/);
    assert.doesNotMatch(restoreStep, /continue-on-error/);
    // The install itself is untouched: still `--with-deps`, so a hit still gets its apt packages.
    const installStep = block.slice(install, block.indexOf("\n      - name:", install));
    assert.ok(installStep.includes("playwright install --with-deps chromium"));
    assert.doesNotMatch(installStep, /cache-hit/);
  }
});

test("the test job keeps Vitest's file timings without making them a condition of the run", () => {
  const block = withoutComments(jobBlock(workflow, "validate-test-shard"));
  const step = block.slice(
    block.indexOf("- name: Restore Vitest's file timings"),
    block.indexOf("- name: Record the runner"),
  );
  assert.match(step, /uses: actions\/cache@v4\n/);
  // Vitest's cache directory for the root config (VitestCache.resolveCacheDir).
  assert.match(step, /path: node_modules\/\.vite\/vitest\n/);
  // A new key per shard and attempt, so each successful shard saves its own
  // timings without racing the others, and prefixes to restore from: this
  // shard's latest first, then any earlier timings (they only order files).
  assert.match(
    step,
    /key: vitest-file-timings-\$\{\{ runner\.os \}\}-shard-\$\{\{ matrix\.shard \}\}-of-3-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\n/,
  );
  assert.match(
    step,
    /restore-keys: \|\n {12}vitest-file-timings-\$\{\{ runner\.os \}\}-shard-\$\{\{ matrix\.shard \}\}-of-3-\n {12}vitest-file-timings-\$\{\{ runner\.os \}\}-\n/,
  );
  // Restored before the run reads it.
  assert.ok(
    block.indexOf("- name: Restore Vitest's file timings") <
      block.indexOf("- name: Test"),
  );
  assert.doesNotMatch(step, /fail-on-cache-miss|lookup-only/);
});

const LINK_LOCAL_STEP =
  "- name: Give new container interfaces no IPv6 link-local address";
const LINK_LOCAL_CHECK =
  "- name: Require the run's container veths to have had no IPv6 link-local address";

/** The `run: |` script of the step named `name` in `block`. */
function stepScript(block, name) {
  const start = block.indexOf(name);
  assert.ok(start >= 0, `missing step ${name}`);
  const end = block.indexOf("\n      - name:", start);
  const step = block.slice(start, end < 0 ? undefined : end);
  const run = /^ {8}run: \|\n((?: {10}[^\n]*\n?)+)/m.exec(step);
  assert.ok(run, `${name} must run a script`);
  return { step, script: run[1].replace(/^ {10}/gm, "") };
}

const CONTAINER_JOBS = [
  {
    key: "editor-e2e-container",
    runStepName: "- name: Run M1 container lifecycle acceptance",
  },
  {
    key: "editor-e2e-container-presentation-ack",
    runStepName: "- name: Run presentation-ack container acceptance",
  },
  ...Object.entries(STAGE3_JOBS).map(([key, targets]) => ({
    key,
    runStepName: `- name: Run ${targets[0].label} container acceptance`,
  })),
];

test("the Stage 3 jobs' link-local steps are editor-e2e-container's, word for word", () => {
  // The behaviour tests below exercise editor-e2e-container's scripts; the
  // other Stage 3 jobs are held to the very same scripts.
  const container = withoutComments(jobBlock(workflow, "editor-e2e-container"));
  for (const key of Object.keys(STAGE3_JOBS)) {
    const block = withoutComments(jobBlock(workflow, key));
    for (const name of [LINK_LOCAL_STEP, LINK_LOCAL_CHECK]) {
      assert.equal(stepScript(block, name).script, stepScript(container, name).script, `${key}: ${name}`);
    }
  }
});

test("only the native-Docker container jobs give new interfaces no IPv6 link-local address, before any container exists", () => {
  const containerKeys = new Set(CONTAINER_JOBS.map((job) => job.key));
  for (const key of jobKeys(workflow)) {
    const block = withoutComments(jobBlock(workflow, key));
    if (containerKeys.has(key)) continue;
    assert.doesNotMatch(block, /addr_gen_mode|disable_ipv6/, key);
  }
  for (const { key, runStepName } of CONTAINER_JOBS) {
    const block = withoutComments(jobBlock(workflow, key));
    const { step, script } = stepScript(block, LINK_LOCAL_STEP);
    // New interfaces only: never `all`, which would change eth0, lo and docker0.
    assert.match(
      script,
      /^sudo sysctl -w net\.ipv6\.conf\.default\.addr_gen_mode=1$/m,
    );
    assert.doesNotMatch(step, /conf\.all\.|disable_ipv6/);
    // A setting that did not take stops the job.
    assert.match(
      script,
      /sysctl -n net\.ipv6\.conf\.default\.addr_gen_mode\)" != 1/,
    );
    assert.match(script, /exit 1/);
    assert.doesNotMatch(step, /continue-on-error|\|\| true/);
    const at = (name) => block.indexOf(name);
    assert.ok(
      at(LINK_LOCAL_STEP) < at("- name: Record container diagnostics") &&
        at(LINK_LOCAL_STEP) < at(runStepName),
      `${key}: set before the run creates any container`,
    );
    const check = stepScript(block, LINK_LOCAL_CHECK);
    assert.match(check.step, /^ {8}if: always\(\)$/m);
    assert.ok(
      at(runStepName) < at(LINK_LOCAL_CHECK) &&
        at(LINK_LOCAL_CHECK) < at("- name: Upload results and failure traces"),
      `${key}: checked after the run, and kept in the uploaded results`,
    );
  }
});

/**
 * Runs a step's script in a scratch directory, under `bash -e` (GitHub's
 * default) and `bash -e -o pipefail` (`shell: bash`), with stand-ins: `sudo`
 * runs its command; `ip monitor` stays alive and writes nothing; deleting a
 * probe link is reported into the monitor log only while the monitor is
 * `reporting`; `sysctl -n` answers `sysctlValue`. `monitor` is the recorded
 * monitor process: running, already exited, or never started.
 */
function runStep(
  script,
  {
    log = "",
    monitor = "running",
    reporting = true,
    sysctlValue = "1",
    uploadBlocked = false,
  } = {},
) {
  const results = [];
  for (const flags of [["-e"], ["-e", "-o", "pipefail"]]) {
    const dir = mkdtempSync(join(tmpdir(), "link-local-step-"));
    const network = join(dir, "container-network");
    mkdirSync(network, { recursive: true });
    writeFileSync(join(network, "ip-monitor.log"), log);
    mkdirSync(join(dir, "bin"));
    const stub = (name, body) => {
      writeFileSync(join(dir, "bin", name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(dir, "bin", name), 0o755);
    };
    stub("sudo", 'exec "$@"');
    stub(
      "ip",
      [
        'case "$*" in',
        "  *monitor*) exec sleep 60 ;;",
        `  "link del morphprobe"*) [ -f "${dir}/reporting" ] && echo "[2026-11-04T00:00:00.000000] Deleted 9: $3@NONE: <BROADCAST,MULTICAST> mtu 1500" >> "$RUNNER_TEMP/container-network/ip-monitor.log" ;;`,
        "esac",
        "exit 0",
      ].join("\n"),
    );
    stub("sysctl", `[ "$1" = -n ] && echo ${sysctlValue}\nexit 0`);
    if (reporting) writeFileSync(join(dir, "reporting"), "");
    // A file where the upload directory should go: the copy cannot be made.
    if (uploadBlocked) writeFileSync(join(dir, "test-results"), "");
    let running = null;
    if (monitor === "running") {
      running = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
      writeFileSync(join(dir, "ip-monitor.pid"), String(running.pid));
    } else if (monitor === "exited") {
      writeFileSync(join(dir, "ip-monitor.pid"), String(spawnSync("true").pid));
    }
    const result = spawnSync("bash", [...flags, "-c", script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        RUNNER_TEMP: dir,
      },
    });
    for (const pid of [
      running?.pid,
      Number(
        readFileSync(join(dir, "ip-monitor.pid"), {
          flag: "a+",
          encoding: "utf8",
        }),
      ),
    ]) {
      try {
        if (pid) process.kill(pid);
      } catch {}
    }
    assert.ifError(result.error);
    const uploaded = join(dir, "test-results/container-network/ip-monitor.log");
    results.push({
      shell: `bash ${flags.join(" ")}`,
      ...result,
      recorded: readFileSync(join(network, "ip-monitor.log"), "utf8"),
      uploaded:
        !uploadBlocked && existsSync(uploaded)
          ? readFileSync(uploaded, "utf8")
          : null,
    });
  }
  return results;
}

function assertOutcome(results, name, passes, reason) {
  for (const result of results) {
    const said = `${name} (${result.shell}): ${result.stdout}${result.stderr}`;
    assert.equal(result.status === 0, passes, said);
    // A failure comes from the step's own check, never from a pipeline.
    if (!passes) assert.match(result.stdout, reason ?? /::error::/, said);
  }
}

// Lines as `ip -ts -o monitor link address` printed them for a Docker-named
// veth (handoff/2026-11-04/pr363-netchange-experiment/monitor-mode*.log).
const VETH_UP =
  "[2026-11-04T11:32:07.732267] 3: veth3f9a2c1@eth0x: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default \    link/ether 4e:0c:26:f5:74:57 brd ff:ff:ff:ff:ff:ff\n";
const VETH_LINK_LOCAL =
  "[2026-11-04T11:32:09.390780] 3: veth3f9a2c1    inet6 fe80::4c0c:26ff:fef5:7457/64 scope link \       valid_lft forever preferred_lft forever\n" +
  "[2026-11-04T11:32:10.735627] Deleted 3: veth3f9a2c1    inet6 fe80::4c0c:26ff:fef5:7457/64 scope link \       valid_lft forever preferred_lft forever\n";
const HOST_LINK_LOCAL =
  "[2026-11-04T11:32:09.358850] 2: eth0    inet6 fe80::5008:3cff:fe8b:cb81/64 scope link \       valid_lft forever preferred_lft forever\n";
const INCOMPLETE = /::error::Container interface evidence is incomplete/;

test("no container is made before the interface monitor is shown to be receiving", () => {
  const block = withoutComments(jobBlock(workflow, "editor-e2e-container"));
  const { script } = stepScript(block, LINK_LOCAL_STEP);
  assertOutcome(
    runStep(script, { monitor: "none" }),
    "a monitor reporting the probe",
    true,
  );
  assertOutcome(
    runStep(script, { monitor: "none", reporting: false }),
    "a monitor that never reports the probe",
    false,
    /::error::The interface monitor did not report a probe link/,
  );
  assertOutcome(
    runStep(script, { monitor: "none", sysctlValue: "0" }),
    "a setting that did not take",
    false,
    /::error::net\.ipv6\.conf\.default\.addr_gen_mode did not take/,
  );
});

test("the link-local check fails a veth that got an address, a run that saw no veth, and an incomplete record", () => {
  const block = withoutComments(jobBlock(workflow, "editor-e2e-container"));
  const { script } = stepScript(block, LINK_LOCAL_CHECK);
  const cases = [
    ["a veth with no address", { log: VETH_UP }, true],
    [
      "a veth with no address beside a host interface's",
      { log: VETH_UP + HOST_LINK_LOCAL },
      true,
    ],
    [
      "a veth that got a link-local address",
      { log: VETH_UP + VETH_LINK_LOCAL },
      false,
    ],
    ["no veth at all", { log: HOST_LINK_LOCAL }, false],
    // The veth was recorded, then the monitor died: what came after is unknown.
    [
      "a monitor that exited after recording a veth",
      { log: VETH_UP, monitor: "exited" },
      false,
      INCOMPLETE,
    ],
    [
      "a monitor still running but no longer reporting",
      { log: VETH_UP, reporting: false },
      false,
      INCOMPLETE,
    ],
    [
      "a monitor that hit a receive error",
      {
        log:
          VETH_UP + "netlink receive error No buffer space available (105)\n",
      },
      false,
      INCOMPLETE,
    ],
    [
      "a monitor that was never started",
      { log: VETH_UP, monitor: "none" },
      false,
      INCOMPLETE,
    ],
  ];
  for (const [name, setup, passes, reason] of cases) {
    const results = runStep(script, setup);
    assertOutcome(results, name, passes, reason);
    for (const result of results) {
      // The monitor stopped before the copy: byte for byte what it wrote.
      assert.equal(
        result.uploaded,
        result.recorded,
        `${name} (${result.shell}): the record must be copied for the upload`,
      );
    }
  }
});

test("a record that cannot be kept fails a passing check, and leaves a failing check's error as it was", () => {
  const block = withoutComments(jobBlock(workflow, "editor-e2e-container"));
  const { script } = stepScript(block, LINK_LOCAL_CHECK);
  const NOT_KEPT = /::error::The container interface record could not be kept/;
  for (const result of runStep(script, { log: VETH_UP, uploadBlocked: true })) {
    const said = `${result.shell}: ${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, said);
    assert.match(result.stdout, NOT_KEPT, said);
  }
  for (const result of runStep(script, {
    log: VETH_UP + VETH_LINK_LOCAL,
    uploadBlocked: true,
  })) {
    const said = `${result.shell}: ${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, said);
    assert.match(
      result.stdout,
      /::error::A container veth got an IPv6 link-local address/,
      said,
    );
    assert.match(result.stdout, NOT_KEPT, said);
  }
});

test("the interface record lives outside test-results/, which Playwright empties when the run starts", () => {
  const block = withoutComments(jobBlock(workflow, "editor-e2e-container"));
  for (const name of [LINK_LOCAL_STEP, LINK_LOCAL_CHECK]) {
    const { script } = stepScript(block, name);
    assert.match(script, /^dir="\$RUNNER_TEMP\/container-network"$/m, name);
    assert.doesNotMatch(script, /^dir=test-results/m, name);
  }
});

test("the six client shards must be the client lane, and the acceptance job checks every shard's client lane verdict", () => {
  const shards = withoutComments(jobBlock(workflow, "editor-e2e-local-preview"));
  const run = /- name: Editor end-to-end\n {8}env:\n((?: {10}.*\n)+) {8}run: (.*)\n/.exec(shards);
  assert.ok(run, "the shard job runs the editor end-to-end step");
  assert.match(run[1], /^ {10}MORPH_E2E_REQUIRE_CLIENT_LANE: "1"$/m);
  assert.doesNotMatch(run[1], /MORPH_E2E_PREVIEW_RUNTIME|MORPH_E2E_RECORD_PREVIEW_RUNTIME|MORPH_E2E_TRANSPORT/);
  assert.match(run[1], /^ {10}MORPH_E2E_REPORT_PATH: test-results\/shard-\$\{\{ matrix\.shard \}\}\.json$/m);
  assert.equal(run[2], "pnpm test:e2e:local-preview -- --shard=${{ matrix.shard }}/6");
  assert.doesNotMatch(shards, /MORPH_E2E_PREVIEW_RUNTIME/);

  const acceptance = withoutComments(jobBlock(workflow, "editor-e2e-acceptance"));
  const download = acceptance.indexOf("pattern: editor-e2e-results-*\n");
  const check = acceptance.indexOf(
    "- name: Check every shard ran the client lane on Starter 31\n        run: node scripts/e2e-client-lane-guard.mjs client-lane-verdicts shard-artifacts\n",
  );
  assert.ok(download >= 0, "the acceptance job downloads every shard's results");
  assert.ok(check > download, "the acceptance job checks the client lane verdicts after downloading them");
});

test("the Sandbox prerender smoke is its own job: the repository's launcher, a 15 minute timeout, and none of the container E2E setup", () => {
  assert.deepEqual(jobCheckNames(workflow, "sandbox-prerender-smoke"), [
    SANDBOX_PRERENDER_SMOKE_CHECK,
  ]);
  const block = withoutComments(jobBlock(workflow, "sandbox-prerender-smoke"));
  assert.match(block, /^ {4}runs-on: ubuntu-24\.04$/m);
  assert.match(block, /^ {4}timeout-minutes: 15$/m);
  const steps = [...block.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(steps, [
    "Checkout",
    "Setup pnpm",
    "Setup Node.js",
    "Install dependencies",
    "Run the Sandbox prerender smoke",
  ]);
  const start = block.indexOf("- name: Run the Sandbox prerender smoke");
  const step = block.slice(start);
  assert.match(step, /^ {8}run: pnpm test:sandbox-prerender$/m);
  // Its two inner timeouts leave room for checkout, install and the image's
  // first build inside the job's 15 minutes.
  const seconds = (name) =>
    Number(new RegExp(name + ": \"([0-9]+)\"").exec(step)?.[1]);
  assert.ok(seconds("MORPH_SANDBOX_SMOKE_BUILD_S") + seconds("MORPH_SANDBOX_SMOKE_TEST_S") <= 13 * 60);
  // Nothing of the container E2E jobs' setup, no continue-on-error, and the
  // launcher is the very script the package runs.
  assert.doesNotMatch(block, /playwright|continue-on-error|run-container-e2e|addr_gen_mode/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["test:sandbox-prerender"], "node scripts/sandbox-prerender-smoke.mjs");
});

test("every Chromium install reads only the runner's signed Ubuntu sources, security included, and only for that step", () => {
  const installers = jobKeys(workflow).filter((key) =>
    withoutComments(jobBlock(workflow, key)).includes(
      "- name: Install Chromium for Playwright",
    ),
  );
  assert.equal(installers.length, 7, "every job that installs Chromium");
  const steps = installers.map((key) => {
    const block = withoutComments(jobBlock(workflow, key));
    const install = block.indexOf("- name: Install Chromium for Playwright");
    return { key, step: block.slice(install, block.indexOf("\n      - name:", install)) };
  });
  for (const { key, step } of steps) {
    const scope = step.indexOf("sudo tee /etc/apt/apt.conf.d/81-ci-ubuntu-sources-only");
    const install = step.indexOf("playwright install --with-deps chromium");
    assert.ok(scope > 0 && scope < install, `${key} must scope apt before installing`);
    // The scope: no main list, and a parts directory holding only ubuntu.sources.
    assert.ok(step.includes(`'Dir::Etc::SourceList "/dev/null";' 'Dir::Etc::SourceParts "/etc/apt/ci-ubuntu-sources.d";'`), key);
    assert.ok(step.includes('sudo install -m 0644 "$ubuntu_sources" /etc/apt/ci-ubuntu-sources.d/ubuntu.sources'), key);
    assert.ok(step.includes("ubuntu_sources=/etc/apt/sources.list.d/ubuntu.sources"), key);
    // Refused, not narrowed, unless every stanza is signed by the Ubuntu
    // archive keyring and a security suite is among them.
    assert.ok(step.includes("grep -cx 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg'"), key);
    assert.ok(step.includes("grep -Eq '^Suites:.* [a-z]+-security( |$)'"), key);
    // Removed again on the way out, whatever the install did.
    assert.ok(step.indexOf("trap 'sudo rm -f /etc/apt/apt.conf.d/81-ci-ubuntu-sources-only' EXIT") < scope, key);
    // The retry rule, the timeouts and the install itself are unchanged.
    assert.ok(step.includes("setsid timeout --kill-after=15s 240 pnpm exec playwright install --with-deps chromium"), key);
    assert.ok(step.includes(`printf '%s\\n' 'Acquire::Retries "3";'`), key);
    assert.match(step, /timeout-minutes: 15\n/);
  }
  // One installation, the same in every job.
  assert.equal(new Set(steps.map(({ step }) => step)).size, 1);
});
