import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyContainerRunHandover } from "./check-container-run-handover.mjs";

const LAUNCHER = fileURLToPath(
  new URL("./run-container-e2e-isolated.mjs", import.meta.url),
);
const fakeRunner = (body) => `
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const [identityPath, signalPath, residualPidPath] = process.argv.slice(2);
const stat = readFileSync("/proc/" + process.pid + "/stat", "utf8");
const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\\s+/);
writeFileSync(identityPath, JSON.stringify({
  pid: process.pid,
  pgid: Number(fields[2]),
  sid: Number(fields[3]),
}));
${body}
`;

async function scratch(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "isolated-container-runner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeRunner(dir, body) {
  const filename = path.join(dir, "fake-runner.mjs");
  const identity = path.join(dir, "identity.json");
  const signal = path.join(dir, "signal.txt");
  const residualPid = path.join(dir, "residual-pid.txt");
  await writeFile(filename, fakeRunner(body));
  return { filename, identity, signal, residualPid };
}

function runIsolated(runner, args = []) {
  const child = spawn(process.execPath, [LAUNCHER, runner, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, exit, output: () => ({ stdout, stderr }) };
}

async function waitForFile(filename, child) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await readFile(filename, "utf8");
    } catch {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error("isolated runner exited before writing its identity");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("isolated runner did not write its identity");
}

function handoverRecord(identity) {
  return {
    schemaVersion: 1,
    invocationId: "123e4567-e89b-42d3-a456-426614174000",
    spec: "e2e/fake-container-acceptance.spec.ts",
    phase: "teardown-complete",
    identityRecordedBeforeTeardown: true,
    runner: { ...identity, startedAtUtc: new Date().toISOString() },
    children: [],
    stateDir: {
      path: path.join(tmpdir(), `morph-e2e-${randomUUID()}`),
      removed: true,
    },
    containers: {
      prefix: "workerd-morph-e2e-abcdef123456-",
      cleanupAttempted: true,
      gone: true,
    },
    machineLock: {
      path: "/tmp/morph-editor-e2e.lock",
      acquired: true,
      releaseCompleted: true,
    },
    writtenAtUtc: new Date().toISOString(),
  };
}

function realStateAdapters() {
  return {
    stateRoot: tmpdir(),
    expectedLockFile: "/tmp/morph-editor-e2e.lock",
    processState(pid) {
      try {
        process.kill(pid, 0);
        return "alive";
      } catch (error) {
        return error.code === "ESRCH" ? "gone" : "unknown";
      }
    },
    processGroupState(pgid) {
      try {
        process.kill(-pgid, 0);
        return "alive";
      } catch (error) {
        return error.code === "ESRCH" ? "gone" : "unknown";
      }
    },
    pathState: () => "absent",
    containersForPrefix: () => [],
    lockIsFree: () => true,
  };
}

test("setsid runner has pid=pgid=sid and a normal handover passes", async (t) => {
  const dir = await scratch(t);
  const files = await writeRunner(
    dir,
    "await new Promise((resolve) => setTimeout(resolve, 150));",
  );
  const run = runIsolated(files.filename, [
    files.identity,
    files.signal,
    files.residualPid,
  ]);
  const { code } = await run.exit;
  const { stdout, stderr } = run.output();
  assert.equal(code, 0, stderr + stdout);
  assert.match(stdout, /RUNNER_PROCESS_IDENTITY/);
  assert.match(stdout, /pid,pgid,sid,comm/);
  const identity = JSON.parse(await readFile(files.identity, "utf8"));
  assert.equal(identity.pgid, identity.pid);
  assert.equal(identity.sid, identity.pid);
  const result = await verifyContainerRunHandover(
    handoverRecord(identity),
    realStateAdapters(),
  );
  assert.equal(result.passed, true);
});

test("handover rejects a live process left in the isolated runner group", async (t) => {
  const dir = await scratch(t);
  const files = await writeRunner(
    dir,
    `const residual = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(residualPidPath, String(residual.pid));
await new Promise((resolve) => setTimeout(resolve, 150));
process.exit(0);`,
  );
  const run = runIsolated(files.filename, [
    files.identity,
    files.signal,
    files.residualPid,
  ]);
  const { code } = await run.exit;
  const { stderr, stdout } = run.output();
  assert.equal(code, 0, stderr + stdout);
  const identity = JSON.parse(await readFile(files.identity, "utf8"));
  try {
    await assert.rejects(
      verifyContainerRunHandover(handoverRecord(identity), realStateAdapters()),
      /HANDOVER_RUNNER_GROUP_ALIVE/,
    );
  } finally {
    try {
      process.kill(-identity.pgid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
});

test("setsid --wait preserves a failing runner exit code", async (t) => {
  const dir = await scratch(t);
  const files = await writeRunner(dir, "process.exit(17);");
  const run = runIsolated(files.filename, [
    files.identity,
    files.signal,
    files.residualPid,
  ]);
  const { code } = await run.exit;
  assert.equal(code, 17);
});

test("cancellation is forwarded into the runner session", async (t) => {
  const dir = await scratch(t);
  const files = await writeRunner(
    dir,
    `process.on("SIGINT", () => {
  writeFileSync(signalPath, "SIGINT");
  process.exit(130);
});
setInterval(() => {}, 1000);`,
  );
  const run = runIsolated(files.filename, [
    files.identity,
    files.signal,
    files.residualPid,
  ]);
  await waitForFile(files.identity, run.child);
  run.child.kill("SIGINT");
  const result = await run.exit;
  assert.equal(
    result.code,
    130,
    JSON.stringify({ ...result, ...run.output() }),
  );
  assert.equal(await readFile(files.signal, "utf8"), "SIGINT");
});

test("SIGTERM is forwarded into the runner session", async (t) => {
  const dir = await scratch(t);
  const files = await writeRunner(
    dir,
    `process.on("SIGTERM", () => {
  writeFileSync(signalPath, "SIGTERM");
  process.exit(143);
});
setInterval(() => {}, 1000);`,
  );
  const run = runIsolated(files.filename, [
    files.identity,
    files.signal,
    files.residualPid,
  ]);
  await waitForFile(files.identity, run.child);
  run.child.kill("SIGTERM");
  const result = await run.exit;
  assert.equal(
    result.code,
    143,
    JSON.stringify({ ...result, ...run.output() }),
  );
  assert.equal(await readFile(files.signal, "utf8"), "SIGTERM");
  assert.doesNotMatch(run.output().stderr, /killing runner group/);
});

test("a runner group that ignores SIGTERM is killed, the whole group, and the step fails", async (t) => {
  const dir = await scratch(t);
  // The runner and a child of its own both ignore SIGTERM, so only the
  // launcher's escalation to SIGKILL on the group can end them.
  const files = await writeRunner(
    dir,
    `process.on("SIGTERM", () => writeFileSync(signalPath, "SIGTERM ignored"));
const residual = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(residualPidPath, String(residual.pid));
setInterval(() => {}, 1000);`,
  );
  const run = runIsolated(files.filename, [
    files.identity,
    files.signal,
    files.residualPid,
  ]);
  const identity = JSON.parse(await waitForFile(files.identity, run.child));
  await waitForFile(files.residualPid, run.child);
  t.after(() => {
    try {
      process.kill(-identity.pgid, "SIGKILL");
    } catch {
      // Already gone, which is what the test expects.
    }
  });
  const sent = Date.now();
  run.child.kill("SIGTERM");
  const result = await run.exit;
  const elapsed = Date.now() - sent;
  const { stderr } = run.output();
  assert.notEqual(result.code, 0, JSON.stringify({ ...result, stderr }));
  assert.equal(result.signal, null, "the launcher itself exits, it is not killed");
  assert.match(stderr, /forwarded SIGTERM/);
  assert.match(stderr, /runner did not exit after SIGTERM; killing runner group/);
  assert.equal(await readFile(files.signal, "utf8"), "SIGTERM ignored");
  assert.ok(elapsed >= 1_500, `escalated after ${elapsed} ms`);
  let groupState = "alive";
  for (let attempt = 0; attempt < 100 && groupState === "alive"; attempt += 1) {
    try {
      process.kill(-identity.pgid, 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } catch (error) {
      groupState = error.code === "ESRCH" ? "gone" : String(error.code);
    }
  }
  assert.equal(groupState, "gone", "nothing of the runner group may survive");
});
