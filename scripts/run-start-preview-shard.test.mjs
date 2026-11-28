import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { jobBlock, withoutComments } from "./ci-workflow.mjs";

const SCRIPTS = new URL(".", import.meta.url).pathname;
const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

/** The `run:` command of one step of one job, as the workflow spells it. */
function stepCommand(job, name) {
  const block = withoutComments(jobBlock(workflow, job));
  const start = block.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `step ${name} must exist`);
  const next = block.indexOf("\n      - name: ", start + 1);
  const step = next < 0 ? block.slice(start) : block.slice(start, next);
  const command = /^ {8}run: (.+)$/m.exec(step)?.[1];
  assert.ok(command, `step ${name} has a one-line run`);
  return command;
}

/**
 * A repository stand-in: the launcher and what it imports, copied, and a stub
 * where the E2E runner is. The stub records its pid and arguments, says when
 * it is ready, records the signal it receives and then exits 130 like the
 * runner does.
 */
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "step-entry-"));
  mkdirSync(path.join(dir, "scripts"));
  for (const file of [
    "run-start-preview-shard.mjs",
    "editor-e2e-start.mjs",
    "editor-e2e-shards.mjs",
  ]) {
    copyFileSync(path.join(SCRIPTS, file), path.join(dir, "scripts", file));
  }
  writeFileSync(
    path.join(dir, "scripts", "run-editor-e2e.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(path.join(dir, "pid"))}, String(process.pid));
if (process.env.STUB_EXIT) process.exit(Number(process.env.STUB_EXIT));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    writeFileSync(${JSON.stringify(path.join(dir, "got"))}, signal);
    setTimeout(() => process.exit(130), 50);
  });
}
writeFileSync(${JSON.stringify(path.join(dir, "ready"))}, process.argv.slice(2).join(" "));
setInterval(() => {}, 1000);
`,
  );
  return dir;
}

/** Leftovers of a test that failed before it could clean up after itself. */
const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const DEADLINE_MS = 15_000;
const deadline = (promise, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), DEADLINE_MS).unref()),
  ]);

/** Runs a command as the workflow's shell does (bash -c) and waits for the stub runner. */
async function startStep(command) {
  const dir = fixture();
  const child = spawn("bash", ["-c", command], { cwd: dir, stdio: "ignore" });
  cleanups.push(() => {
    child.kill("SIGKILL");
    try {
      process.kill(Number(readFileSync(path.join(dir, "pid"), "utf8")), "SIGKILL");
    } catch {
      // No stub, or it is gone.
    }
  });
  const exited = new Promise((resolve) =>
    child.on("close", (code, signal) => resolve({ code, signal })),
  );
  for (let i = 0; i < 200 && !existsSync(path.join(dir, "ready")); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(existsSync(path.join(dir, "ready")), "the stub runner started: " + command);
  return {
    dir,
    child,
    exited,
    pid: Number(readFileSync(path.join(dir, "pid"), "utf8")),
    args: readFileSync(path.join(dir, "ready"), "utf8"),
  };
}

for (const [job, name] of [
  ["editor-e2e-full-start", "Editor end-to-end, full Start preview"],
  ["editor-e2e-local-preview", "Editor end-to-end"],
  ["editor-e2e-container-presentation-ack", "Run presentation-ack container acceptance"],
]) {
  test(`cancel signals reach the runner through the "${name}" step's own command`, async () => {
    const command = stepCommand(job, name).replaceAll("${{ matrix.shard }}", "1");
    assert.match(command, /^exec node scripts\//, "the step execs node: no shell or pnpm in between");
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const { dir, child, exited, pid } = await startStep(command);
      child.kill(signal);
      // The runner's own exit code is the step's, and nothing is left behind.
      // A forward that never arrives fails here at the deadline, not by hanging.
      assert.deepEqual(
        await deadline(exited, `${name} ${signal} reached the runner`),
        { code: 130, signal: null },
        `${name} ${signal}`,
      );
      assert.equal(readFileSync(path.join(dir, "got"), "utf8"), signal, `${name}: the runner got ${signal}`);
      assert.equal(alive(pid), false, `${name} ${signal}: no orphan runner`);
    }
  });
}

test("the full Start launcher starts the Node runner with the shard's files only", async () => {
  const { child, exited, args } = await startStep("exec node scripts/run-start-preview-shard.mjs 2");
  assert.match(args, /^e2e\/\S+\.spec\.ts( e2e\/\S+\.spec\.ts)*$/);
  child.kill("SIGTERM");
  await deadline(exited, "the full Start launcher ended after SIGTERM");
});

test("an ordinary exit of the runner is the step's exit, for the launcher and the direct steps", async () => {
  for (const code of [0, 3]) {
    for (const command of [
      "exec node scripts/run-start-preview-shard.mjs 1",
      "exec node scripts/run-editor-e2e.mjs --shard=1/6",
    ]) {
      const dir = fixture();
      const child = spawn("bash", ["-c", command], {
        cwd: dir,
        stdio: "ignore",
        env: { ...process.env, STUB_EXIT: String(code) },
      });
      cleanups.push(() => child.kill("SIGKILL"));
      const result = await deadline(
        new Promise((resolve) => child.on("close", (c, s) => resolve({ code: c, signal: s }))),
        `${command} exit ${code}`,
      );
      assert.deepEqual(result, { code, signal: null }, `${command} exits ${code}`);
    }
  }
});
