import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    ["pnpm toolchain:astro", "node scripts/print-test-runner.mjs", "pnpm test"],
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
  assert.match(jobBlock(workflow, "validate-test"), /timeout-minutes: 30\n/);
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

test("the test job keeps Vitest's file timings without making them a condition of the run", () => {
  const block = withoutComments(jobBlock(workflow, "validate-test"));
  const step = block.slice(
    block.indexOf("- name: Restore Vitest's file timings"),
    block.indexOf("- name: Record the runner"),
  );
  assert.match(step, /uses: actions\/cache@v4\n/);
  // Vitest's cache directory for the root config (VitestCache.resolveCacheDir).
  assert.match(step, /path: node_modules\/\.vite\/vitest\n/);
  // A new key per attempt, so each successful run saves its own timings, and
  // a prefix to restore the latest one from.
  assert.match(
    step,
    /key: vitest-file-timings-\$\{\{ runner\.os \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\n/,
  );
  assert.match(
    step,
    /restore-keys: vitest-file-timings-\$\{\{ runner\.os \}\}-\n/,
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

test("only the native-Docker container job gives new interfaces no IPv6 link-local address, before any container exists", () => {
  for (const key of jobKeys(workflow)) {
    const block = withoutComments(jobBlock(workflow, key));
    if (key === "editor-e2e-container") continue;
    assert.doesNotMatch(block, /addr_gen_mode|disable_ipv6/, key);
  }
  const block = withoutComments(jobBlock(workflow, "editor-e2e-container"));
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
      at(LINK_LOCAL_STEP) < at("- name: Run M1 container lifecycle acceptance"),
    "set before the run creates any container",
  );
  const check = stepScript(block, LINK_LOCAL_CHECK);
  assert.match(check.step, /^ {8}if: always\(\)$/m);
  assert.ok(
    at("- name: Run M1 container lifecycle acceptance") <
      at(LINK_LOCAL_CHECK) &&
      at(LINK_LOCAL_CHECK) < at("- name: Upload results and failure traces"),
    "checked after the run, and kept in the uploaded results",
  );
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
  { log = "", monitor = "running", reporting = true, sysctlValue = "1" } = {},
) {
  const results = [];
  for (const flags of [["-e"], ["-e", "-o", "pipefail"]]) {
    const dir = mkdtempSync(join(tmpdir(), "link-local-step-"));
    const network = join(dir, "test-results/container-network");
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
        `  "link del morphprobe"*) [ -f "${dir}/reporting" ] && echo "[2026-11-04T00:00:00.000000] Deleted 9: $3@NONE: <BROADCAST,MULTICAST> mtu 1500" >> test-results/container-network/ip-monitor.log ;;`,
        "esac",
        "exit 0",
      ].join("\n"),
    );
    stub("sysctl", `[ "$1" = -n ] && echo ${sysctlValue}\nexit 0`);
    if (reporting) writeFileSync(join(dir, "reporting"), "");
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
    results.push({ shell: `bash ${flags.join(" ")}`, ...result });
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
    assertOutcome(runStep(script, setup), name, passes, reason);
  }
});
