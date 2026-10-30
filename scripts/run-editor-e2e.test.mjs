/**
 * The e2e runner against a dev server that talks a lot while the suite runs.
 *
 * `node --test`, beside the script, for the reason `ship.test.mjs` gives: vitest
 * collects `src/` only, and a guard that never runs is not a guard.
 *
 * What it guards: the runner used to start Playwright with `spawnSync` while the
 * dev server's output was piped into it. The pipe's reader is an event callback,
 * `spawnSync` holds the event loop, and a dev server that wrote more than the
 * pipe holds stopped inside its own `console.log` — Vite, the Worker and the
 * preview proxy with it. Nothing about that needs a container to reproduce, so
 * this runs the real runner with `npx` replaced by a fake on PATH:
 *
 * - `npx vite dev` is a small HTTP server that writes ~200 KB to stdout for every
 *   `/log` request, before answering it. It first spawns a child that inherits
 *   its stdio, as the real one does for the container build; that is what makes
 *   its stdout blocking (see the fake), and without it Node would queue the
 *   writes in memory and the server would keep answering;
 * - `npx playwright test` requests `/log` ten times and exits 0, 1, or waits for a
 *   signal, as the case asks.
 *
 * Against the old runner the first case fails the way the real run did: the
 * dev server stops answering after the pipe fills, and the fake suite's request
 * times out. The signal case fails too, because `spawnSync` cannot act on a
 * signal until the suite exits by itself.
 *
 * `npx wrangler` succeeds without doing anything, `docker` reports no
 * containers, and `scripts/seed-e2e.mjs` is a no-op in the scratch directory the
 * runner is started in, so nothing here touches a database, a container or a
 * port other than the one it picks.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EDITOR_SHARD_COUNT,
  editorShardArguments,
} from "./editor-e2e-shards.mjs";

// Follows the plan's count, so a change of count cannot leave these tests
// exercising a flag the runner now refuses.
const FIRST_SHARD = `--shard=1/${EDITOR_SHARD_COUNT}`;

const RUNNER = fileURLToPath(new URL("./run-editor-e2e.mjs", import.meta.url));

const FAKE_NPX = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import http from "node:http";

const [tool, ...rest] = process.argv.slice(2);
if (process.env.FAKE_PID_DIR && (tool === "vite" || tool === "playwright")) {
  writeFileSync(process.env.FAKE_PID_DIR + "/" + process.pid, tool);
}

if (tool === "wrangler") process.exit(0);

if (tool === "vite") {
  // What the real dev server does when it builds the Sandbox image: a child
  // that inherits stdio. libuv clears O_NONBLOCK on a child's fds 0-2, the flag
  // belongs to the open file description the two processes share, and from
  // then on this process's writes to a full pipe block instead of queueing.
  // Written to first, as the real one has been by then: \`process.stdout\` is
  // created on first use, and creating it sets O_NONBLOCK again.
  console.log("[fake-dev] starting");
  console.log("[vite] Re-optimizing dependencies because vite config has changed");
  spawnSync("true", { stdio: "inherit" });
  const port = Number(rest[rest.indexOf("--port") + 1]);
  const line = "x".repeat(200);
  let emittedLateOptimize = false;
  http
    .createServer((request, response) => {
      if (request.url === "/log") {
        if (process.env.FAKE_VITE_REOPTIMIZE && !emittedLateOptimize) {
          emittedLateOptimize = true;
          console.log("[vite] (client) ✨ new dependencies optimized: buffer, @vendor/dep");
          console.log("[vite] (ssr) ✨ optimized dependencies changed. reloading");
          console.log("[vite] ✨ new dependencies optimized: untagged-dep");
          console.log("[vite] unrelated development message");
        }
        // One write per line, as a logging dev server does. ~200 KB a request,
        // which is about what the pipe holds, so the old runner stalls within a
        // few requests rather than on the first.
        for (let i = 0; i < 1000; i += 1) console.log("[fake-dev] " + i + " " + line);
      } else if (request.url === "/done") {
        console.log("FAKE_DEV_DONE_MARKER");
      }
      response.end("ok");
    })
    .listen(port);
} else if (tool === "playwright") {
  if (process.env.FAKE_ARGS_FILE) writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(rest));
  if (process.env.FAKE_ENV_FILE) {
    writeFileSync(process.env.FAKE_ENV_FILE, JSON.stringify({
      workerDefault: process.env.MORPH_E2E_WORKER_PREVIEW_RUNTIME ?? null,
    }));
  }
  const mode = process.env.FAKE_PLAYWRIGHT_MODE;
  if (mode === "hang") {
    writeFileSync(process.env.FAKE_PLAYWRIGHT_PID_FILE, String(process.pid));
    setInterval(() => {}, 1000);
  } else {
    // Before each exit, the way the runner's exitAfterFlush does it. This
    // process writes to the runner's own stdout, which the runner is filling
    // with the dev server's output; when that pipe is full a line is queued,
    // and a bare process.exit drops it.
    const flushed = () => new Promise((resolve) => process.stdout.write("", resolve));
    const base = process.env.E2E_BASE_URL;
    const rounds = mode === "fail" ? 1 : 10;
    let answered = 0;
    try {
      for (let i = 0; i < rounds; i += 1) {
        await fetch(base + "/log", { signal: AbortSignal.timeout(10_000) }).then((r) => r.text());
        answered += 1;
      }
      await fetch(base + "/done", { signal: AbortSignal.timeout(10_000) }).then((r) => r.text());
    } catch (error) {
      console.log("FAKE_PLAYWRIGHT_REQUEST_FAILED after " + answered + ": " + error.message);
      await flushed();
      process.exit(1);
    }
    console.log("FAKE_PLAYWRIGHT_ANSWERED " + answered);
    if (process.env.FAKE_REPORT_STATUS) {
      writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify({
        suites: [{ specs: Array.from({ length: 7 }, () => ({
          tests: [{ results: [{ status: process.env.FAKE_REPORT_STATUS }] }]
        })) }]
      }));
    }
    await flushed();
    process.exit(mode === "fail" ? 1 : 0);
  }
} else {
  console.error("fake npx: unexpected " + process.argv.slice(2).join(" "));
  process.exit(2);
}
`;

const FAKE_DOCKER = `#!/bin/sh
exit 0
`;

// The sidecar the runner starts in its default transport: it says where it
// was told to lay out workspaces, writes one there, and serves until stopped.
const FAKE_SIDECAR = `import { mkdirSync, writeFileSync } from "node:fs";
if (process.env.FAKE_PID_DIR) {
  writeFileSync(process.env.FAKE_PID_DIR + "/" + process.pid, "sidecar");
}
const root = process.env.MORPH_LOCAL_PREVIEW_WORKSPACES_ROOT ?? "";
if (root) {
  mkdirSync(root + "/a-preview", { recursive: true });
  writeFileSync(root + "/a-preview/.morph-preview-content.json", "{}");
}
if (process.env.FAKE_SIDECAR_ROOT_FILE) {
  writeFileSync(process.env.FAKE_SIDECAR_ROOT_FILE, root);
}
setInterval(() => {}, 1000);
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (
        server.address()
      );
      server.close(() => resolve(port));
    });
  });
}

let scratch = "";

/**
 * How long the runner under test may take before it is killed. The cases take
 * about a second each; this is the bound that turns a runner that hangs — which
 * is what the old one did in the signal case — into a failure instead of a test
 * that never ends.
 */
const RUNNER_DEADLINE_MS = 60_000;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH";
  }
}

/**
 * The fake dev servers and suites still running after a case, killed on the way
 * out so a failing case leaves nothing behind. Each fake is a group leader: the
 * runner spawns both detached.
 */
async function reapFakes(pidDir) {
  const names = await readdir(pidDir).catch(() => []);
  const survivors = [];
  for (const name of names) {
    const pid = Number(name);
    if (!alive(pid)) continue;
    survivors.push(`${await readFile(path.join(pidDir, name), "utf8")} ${pid}`);
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* Already gone. */
      }
    }
  }
  return survivors;
}

before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "morph-runner-test-"));
  await mkdir(path.join(scratch, "bin"));
  await mkdir(path.join(scratch, "scripts"));
  await writeFile(path.join(scratch, "bin", "npx"), FAKE_NPX);
  await writeFile(path.join(scratch, "bin", "docker"), FAKE_DOCKER);
  await chmod(path.join(scratch, "bin", "npx"), 0o755);
  await chmod(path.join(scratch, "bin", "docker"), 0o755);
  await writeFile(path.join(scratch, "scripts", "seed-e2e.mjs"), "");
  await writeFile(
    path.join(scratch, "scripts", "theme-preview-sidecar.mjs"),
    FAKE_SIDECAR,
  );
  await writeFile(
    path.join(scratch, ".env.e2e"),
    "E2E_EMAIL=runner-test@morph.invalid\nE2E_PASSWORD=unused\nE2E_EDITOR_PATH=/unused\n",
  );
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/**
 * Starts the real runner in the scratch directory. `onStarted` gets the child
 * for cases that have to act on it mid-run.
 */
async function runRunner(extraEnv, onStarted, extraArgs = ["fake.spec.ts"]) {
  const pidDir = await mkdtemp(path.join(scratch, "pids-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("CLOUDFLARE_") ||
      key.startsWith("MORPH_") ||
      key.startsWith("E2E_")
    ) {
      delete env[key];
    }
  }
  const child = spawn(process.execPath, [RUNNER, "--", ...extraArgs], {
    cwd: scratch,
    env: {
      ...env,
      PATH: `${path.join(scratch, "bin")}${path.delimiter}${process.env.PATH}`,
      MORPH_E2E_TRANSPORT: "cloudflare-sandbox",
      MORPH_E2E_PORT: String(await freePort()),
      // Its own lock: these fake runs must neither wait for nor block a real
      // run on this machine. Beside pidDir, not in it: every name in pidDir
      // is read as a pid.
      MORPH_E2E_LOCK_FILE: `${pidDir}.lock`,
      FAKE_PID_DIR: pidDir,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const deadline = setTimeout(() => child.kill("SIGKILL"), RUNNER_DEADLINE_MS);
  // Whatever the case does mid-run, the runner is bounded and its fakes are
  // reaped before anything is asserted.
  const acted = await Promise.resolve(onStarted?.(child)).then(
    () => null,
    (error) => error,
  );
  const { code, signal } = await exited;
  clearTimeout(deadline);
  const leftBehind = await reapFakes(pidDir);
  if (acted) throw acted;
  return { code, signal, stdout, stderr, leftBehind };
}

describe("the e2e runner while the dev server writes more than a pipe holds", () => {
  it(
    "a shard still rejects an all-skipped suite",
    { timeout: 90_000 },
    async () => {
      const result = await runRunner(
        { FAKE_REPORT_STATUS: "skipped" },
        undefined,
        [FIRST_SHARD],
      );
      assert.equal(result.code, 1);
      assert.match(result.stderr + result.stdout, /TOO_FEW_TESTS_RAN/);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "a shard validates execution and retains its report outside disposable state",
    { timeout: 90_000 },
    async () => {
      const report = path.join(scratch, "retained", "shard-1.json");
      const argsFile = path.join(scratch, "retained", "arguments.json");
      const result = await runRunner(
        {
          FAKE_REPORT_STATUS: "passed",
          MORPH_E2E_REPORT_PATH: report,
          FAKE_ARGS_FILE: argsFile,
        },
        undefined,
        [FIRST_SHARD],
      );
      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-1000));
      assert.match(result.stdout, /7 tests executed/);
      assert.deepEqual(JSON.parse(await readFile(argsFile, "utf8")), [
        "test",
        "--project=editor",
        "--reporter=line,json",
        ...editorShardArguments([FIRST_SHARD]),
      ]);
      assert.equal(
        JSON.parse(await readFile(report, "utf8")).suites[0].specs.length,
        7,
      );
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it("rejects an unsupported shard before starting services", async () => {
    const result = await runRunner({}, undefined, [
      `--shard=1/${EDITOR_SHARD_COUNT + 1}`,
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /EDITOR_SHARD_INVALID/);
    assert.ok(!result.stdout.includes("starting the dev server"));
    assert.deepEqual(result.leftBehind, []);
  });

  // The scratch directory has no .dev.vars, so the Worker would serve the
  // client-only preview; specs told to expect Start must not run against it.
  // The guard's own cases are in e2e-preview-runtime-guard.test.mjs.
  it("refuses specs expecting a runtime the Worker will not serve, before starting services", async () => {
    const result = await runRunner({ MORPH_E2E_PREVIEW_RUNTIME: "start" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /PREVIEW_RUNTIME_MISMATCH/);
    assert.ok(!result.stdout.includes("applying migrations"));
    assert.ok(!result.stdout.includes("starting the dev server"));
    assert.deepEqual(result.leftBehind, []);
  });

  // Record mode alone is not a way past the guard: a spec that does not record
  // its Themes would be previewed as the Worker's client-only default.
  it("refuses record mode for a spec outside the record-mode list, before starting services", async () => {
    const result = await runRunner({
      MORPH_E2E_PREVIEW_RUNTIME: "start",
      MORPH_E2E_RECORD_PREVIEW_RUNTIME: "start",
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /RECORD_MODE_SELECTION: .*"fake\.spec\.ts"/);
    assert.ok(!result.stdout.includes("applying migrations"));
    assert.ok(!result.stdout.includes("starting the dev server"));
    assert.deepEqual(result.leftBehind, []);
  });

  it(
    "accepts a declared record over the Worker's default for a record-mode spec, and hands the Worker's default to the suite",
    { timeout: 90_000 },
    async () => {
      const envFile = path.join(scratch, "record-mode", "env.json");
      await mkdir(path.dirname(envFile), { recursive: true });
      const result = await runRunner(
        {
          MORPH_E2E_PREVIEW_RUNTIME: "start",
          MORPH_E2E_RECORD_PREVIEW_RUNTIME: "start",
          FAKE_ENV_FILE: envFile,
        },
        undefined,
        ["e2e/native-compat-preview.spec.ts"],
      );
      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-1000));
      assert.match(
        result.stdout,
        /record mode: Themes record "start" and specs expect "start", accepted over the Worker's client default only because MORPH_E2E_RECORD_PREVIEW_RUNTIME is declared/,
      );
      // No .dev.vars in the scratch directory: the Worker has no value.
      assert.deepEqual(JSON.parse(await readFile(envFile, "utf8")), { workerDefault: "" });
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "keeps reading the dev server, so the suite's requests are all answered",
    { timeout: 90_000 },
    async () => {
      const result = await runRunner({});
      assert.match(
        result.stdout,
        /FAKE_PLAYWRIGHT_ANSWERED 10/,
        result.stdout.slice(-2000),
      );
      // Echoed, not only drained: the dev server's output is what a developer
      // reads when a run goes wrong.
      assert.match(result.stdout, /FAKE_DEV_DONE_MARKER/);
      assert.match(result.stdout, /\[e2e\] stopped dev server/);
      assert.match(result.stdout, /\[e2e\] passed/);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "records late dependency re-optimization without guessing the active spec and keeps a passing run green",
    async () => {
      const report = path.join(scratch, "late-events", "playwright.json");
      const eventReport = `${report}.late-dependency-reoptimizations.json`;
      const result = await runRunner(
        {
          FAKE_VITE_REOPTIMIZE: "1",
          FAKE_REPORT_STATUS: "passed",
          MORPH_E2E_REPORT_PATH: report,
        },
        undefined,
        ["fake.spec.ts"],
      );

      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-1000));
      assert.match(result.stdout, /FAKE_PLAYWRIGHT_ANSWERED 10/);
      const reportJson = JSON.parse(await readFile(report, "utf8"));
      assert.equal(
        reportJson.suites[0].specs[0].tests[0].results[0].status,
        "passed",
      );
      const { lateDependencyReoptimizations: events } = JSON.parse(
        await readFile(eventReport, "utf8"),
      );
      assert.equal(events.length, 3);
      assert.deepEqual(events[0], {
        timestamp: events[0].timestamp,
        environment: "client",
        dependencies: ["buffer", "@vendor/dep"],
        kind: "dependencies-optimized",
        spec: "unknown",
      });
      assert.match(events[0].timestamp, /^\d{4}-\d\d-\d\dT.*Z$/);
      assert.deepEqual(events[1], {
        timestamp: events[1].timestamp,
        environment: "ssr",
        dependencies: null,
        kind: "optimized-dependencies-reloading",
        spec: "unknown",
      });
      assert.deepEqual(events[2], {
        timestamp: events[2].timestamp,
        environment: null,
        dependencies: ["untagged-dep"],
        kind: "dependencies-optimized",
        spec: "unknown",
      });
      assert.match(result.stdout, /\[e2e\] late-reoptimize /);
      assert.doesNotMatch(
        result.stdout,
        /late-reoptimize.*Re-optimizing dependencies because vite config has changed/,
      );
      assert.doesNotMatch(result.stdout, /late-reoptimize.*unrelated development message/);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "records unknown spec for a shard and does not change a failing suite's exit status",
    async () => {
      const report = path.join(scratch, "late-unknown", "playwright.json");
      const eventReport = `${report}.late-dependency-reoptimizations.json`;
      const result = await runRunner(
        {
          FAKE_VITE_REOPTIMIZE: "1",
          FAKE_REPORT_STATUS: "passed",
          MORPH_E2E_REPORT_PATH: report,
        },
        undefined,
        [FIRST_SHARD],
      );

      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-1000));
      const events = JSON.parse(await readFile(eventReport, "utf8"))
        .lateDependencyReoptimizations;
      assert.equal(events.length, 3);
      assert.equal(events[0].spec, "unknown");

      const failReport = path.join(scratch, "late-fail", "playwright.json");
      const failing = await runRunner({
        FAKE_VITE_REOPTIMIZE: "1",
        FAKE_PLAYWRIGHT_MODE: "fail",
        MORPH_E2E_REPORT_PATH: failReport,
      });
      assert.equal(failing.code, 1);
      assert.match(
        failing.stderr,
        /npx playwright test --project=editor --reporter=line,json fake\.spec\.ts exited with 1/,
      );
      assert.equal(
        JSON.parse(
          await readFile(
            `${failReport}.late-dependency-reoptimizations.json`,
            "utf8",
          ),
        ).lateDependencyReoptimizations.length,
        3,
      );
      assert.deepEqual(failing.leftBehind, []);
    },
  );

  it(
    "reports a failing suite with the same error and exit code as before",
    { timeout: 90_000 },
    async () => {
      const result = await runRunner({ FAKE_PLAYWRIGHT_MODE: "fail" });
      assert.match(
        result.stderr,
        /\[e2e\] npx playwright test --project=editor --reporter=line,json fake\.spec\.ts exited with 1/,
      );
      assert.match(result.stdout, /\[e2e\] stopped dev server/);
      assert.doesNotMatch(result.stdout, /\[e2e\] passed/);
      assert.equal(result.code, 1);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "stops the suite and the dev server when the runner is signalled mid-run",
    { timeout: 90_000 },
    async () => {
      const pidFile = path.join(scratch, `playwright-${Date.now()}.pid`);
      let playwrightPid = 0;
      const result = await runRunner(
        { FAKE_PLAYWRIGHT_MODE: "hang", FAKE_PLAYWRIGHT_PID_FILE: pidFile },
        async (child) => {
          const deadline = Date.now() + 60_000;
          while (Date.now() < deadline) {
            playwrightPid = Number(
              await readFile(pidFile, "utf8").catch(() => "0"),
            );
            if (playwrightPid > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          assert.ok(playwrightPid > 0, "the fake suite never started");
          child.kill("SIGTERM");
        },
      );
      assert.equal(result.code, 130, result.stdout.slice(-2000));
      assert.match(result.stdout, /\[e2e\] stopped playwright/);
      assert.match(result.stdout, /\[e2e\] stopped dev server/);
      assert.deepEqual(result.leftBehind, []);
      assert.equal(alive(playwrightPid), false);
    },
  );
});

describe("the e2e runner's sidecar workspaces", () => {
  it(
    "gives the sidecar a workspace directory of this run's own, and removes only that",
    { timeout: 90_000 },
    async () => {
      const previews = path.join(scratch, ".morph-previews");
      // What an earlier run, or a developer's own preview, left behind.
      const earlier = path.join(previews, "d71a98ea08efb7c153cfb496c699d0dd");
      const earlierSnapshot = path.join(earlier, ".morph-preview-content.json");
      await mkdir(earlier, { recursive: true });
      await writeFile(earlierSnapshot, '{"contentTicket":20}');
      const sidecarEnv = path.join(scratch, ".dev.vars.local_preview_e2e");
      await writeFile(
        sidecarEnv,
        "MORPH_LOCAL_THEME_PREVIEW_ORIGIN=http://127.0.0.1:5199\nMORPH_LOCAL_THEME_PREVIEW_TOKEN=runner-test-token-unused\n",
      );
      const rootFile = path.join(scratch, `sidecar-root-${Date.now()}.txt`);
      try {
        const result = await runRunner({
          MORPH_E2E_TRANSPORT: "local-sidecar",
          FAKE_SIDECAR_ROOT_FILE: rootFile,
        });
        assert.equal(result.code, 0, result.stderr + result.stdout.slice(-2000));
        const root = await readFile(rootFile, "utf8");
        assert.equal(path.dirname(root), previews);
        assert.match(path.basename(root), /^e2e-run-/);
        assert.match(result.stdout, /\[e2e\] stopped sidecar/);
        assert.ok(
          result.stdout.includes(`[e2e] removed ${root}`),
          result.stdout.slice(-2000),
        );
        // This run's directory and what the sidecar wrote in it are gone.
        assert.deepEqual(await readdir(previews), [path.basename(earlier)]);
        // What was there before is as it was.
        assert.equal(
          await readFile(earlierSnapshot, "utf8"),
          '{"contentTicket":20}',
        );
        assert.deepEqual(result.leftBehind, []);
      } finally {
        await rm(sidecarEnv, { force: true });
      }
    },
  );
});
