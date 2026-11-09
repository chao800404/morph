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
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
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
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";

const [tool, ...rest] = process.argv.slice(2);
if (process.env.FAKE_PID_DIR && (tool === "vite" || tool === "playwright")) {
  writeFileSync(process.env.FAKE_PID_DIR + "/" + process.pid, tool);
}

// The .astro parser under \`wrangler dev\`: registers itself in the registry it
// was given, as the real one does, and serves until stopped.
if (tool === "wrangler" && rest[0] === "dev" && rest.includes("packages/astro-parser-worker/wrangler.jsonc")) {
  if (process.env.FAKE_PID_DIR) writeFileSync(process.env.FAKE_PID_DIR + "/" + process.pid, "astro parser");
  console.log("[fake-parser] starting");
  if (process.env.FAKE_PARSER_MODE === "exit") process.exit(3);
  if (process.env.FAKE_PARSER_FILE) {
    writeFileSync(process.env.FAKE_PARSER_FILE, JSON.stringify({ args: rest, registry: process.env.WRANGLER_REGISTRY_PATH ?? null }));
  }
  const port = Number(rest[rest.indexOf("--port") + 1]);
  http.createServer((request, response) => response.end("{}")).listen(port, "127.0.0.1", () => {
    writeFileSync(process.env.WRANGLER_REGISTRY_PATH + "/morph-astro-parser", "{}");
    console.log("[fake-parser] ready");
  });
} else if (tool === "wrangler") process.exit(0);

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
  const registry = process.env.WRANGLER_REGISTRY_PATH ?? null;
  if (process.env.FAKE_VITE_ENV_FILE) {
    writeFileSync(process.env.FAKE_VITE_ENV_FILE, JSON.stringify({ registry, stateDir: process.env.MORPH_E2E_STATE_DIR }));
  }
  http
    .createServer((request, response) => {
      if (request.url === "/_morph/e2e/astro-parser-binding-check") {
        // Core's hook: confirmed only when the parser is in this server's
        // registry, as the real binding resolves it.
        const reached = registry !== null && existsSync(registry + "/morph-astro-parser");
        const outcome = process.env.FAKE_CORE_PARSER_OUTCOME
          ? JSON.parse(process.env.FAKE_CORE_PARSER_OUTCOME)
          : reached
            ? { status: "confirmed", result: { compiler: "0.5.1" } }
            : { status: "refused", code: "binding-failed", reason: "parser-binding-failed", detail: "no session" };
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ outcome }));
        return;
      }
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
  } else if (mode && mode.startsWith("swap")) {
    // A spec asking the runner for a sidecar swap through the state directory,
    // the way the swap helper does: the request is written whole (temp file,
    // then rename), and the answer is the result file named for its request.
    const dir = process.env.MORPH_E2E_STATE_DIR;
    const out = {
      stateDir: dir,
      env: {
        swap: process.env.MORPH_E2E_SIDECAR_SWAP ?? null,
        runId: process.env.MORPH_E2E_RUN_ID ?? null,
        nonce: process.env.MORPH_E2E_SIDECAR_SWAP_NONCE ? "set" : null,
        timeoutMs: process.env.MORPH_E2E_SIDECAR_SWAP_TIMEOUT_MS ?? null,
      },
      results: [],
    };
    const save = () => {
      if (process.env.FAKE_SWAP_RESULT_FILE) writeFileSync(process.env.FAKE_SWAP_RESULT_FILE, JSON.stringify(out));
    };
    save();
    const request = async (requestId) => {
      const body = {
        action: "swap-sidecar",
        runId: process.env.MORPH_E2E_RUN_ID,
        nonce: process.env.MORPH_E2E_SIDECAR_SWAP_NONCE,
        requestId,
        ...JSON.parse(process.env.FAKE_SWAP_OVERRIDE || "{}"),
      };
      if (process.env.FAKE_SWAP_PRESEED_DONE) {
        writeFileSync(dir + "/sidecar-swap." + requestId + ".done", JSON.stringify({ runId: "an-earlier-run", requestId }));
      }
      const requestedAt = Date.now();
      writeFileSync(dir + "/sidecar-swap.request.tmp", JSON.stringify(body));
      renameSync(dir + "/sidecar-swap.request.tmp", dir + "/sidecar-swap.request");
      const deadline = Date.now() + Number(process.env.FAKE_SWAP_WAIT_MS || 45000);
      // With a planted answer, wait until the runner has taken the request,
      // so what is checked is how it treats the planted answer.
      while (process.env.FAKE_SWAP_PRESEED_DONE && existsSync(dir + "/sidecar-swap.request") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      while (Date.now() < deadline) {
        for (const kind of ["done", "failed"]) {
          const file = dir + "/sidecar-swap." + requestId + "." + kind;
          if (existsSync(file)) {
            const result = { kind, requestedAt, answeredAt: Date.now(), ...JSON.parse(readFileSync(file, "utf8")) };
            out.results.push(result);
            save();
            return result;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      out.results.push({ kind: "none" });
      save();
      return null;
    };
    if (mode === "swap-hang") {
      void request("r1");
      setInterval(() => {}, 1000);
    } else {
      if (mode !== "swap-no-request") {
        await request("r1");
        if (mode === "swap-twice") await request("r2");
      }
      await new Promise((resolve) => process.stdout.write("", resolve));
      process.exit(Number(process.env.FAKE_SWAP_EXIT || 0));
    }
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
} else if (tool !== "wrangler") {
  console.error("fake npx: unexpected " + process.argv.slice(2).join(" "));
  process.exit(2);
}
`;

const FAKE_DOCKER = `#!/bin/sh
exit 0
`;

// The sidecar the runner starts in its default transport: it says where it
// was told to lay out workspaces, writes one there, and serves until stopped.
//
// Opt-in, for the swap cases: FAKE_SIDECAR_LOG gets one line per start (pid,
// cwd, start time); FAKE_SIDECAR_LISTEN serves the origin the env file names;
// the *_IN settings apply only to a sidecar started in that directory, so the
// old one can ignore SIGTERM or leave a port holder outside its own group.
const FAKE_SIDECAR = `import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
if (process.env.FAKE_PID_DIR) {
  writeFileSync(process.env.FAKE_PID_DIR + "/" + process.pid, "sidecar");
}
if (process.env.FAKE_SIDECAR_LOG) {
  appendFileSync(process.env.FAKE_SIDECAR_LOG, JSON.stringify({ pid: process.pid, cwd: process.cwd(), root: process.env.MORPH_LOCAL_PREVIEW_WORKSPACES_ROOT ?? null, startedAt: Date.now() }) + "\\n");
  // One line of output, so the runner's sidecar log has something in it.
  console.log("fake sidecar in " + process.cwd());
}
if (process.env.FAKE_SIDECAR_IGNORE_TERM_IN === process.cwd()) {
  process.on("SIGTERM", () => {});
}
if (process.env.FAKE_SIDECAR_LISTEN === "1") {
  const port = Number(new URL(process.env.MORPH_LOCAL_THEME_PREVIEW_ORIGIN).port);
  if (process.env.FAKE_SIDECAR_ALSO_HOLD_V6_IN === process.cwd()) {
    // The same port on ::1, held outside this sidecar's group.
    const v6 = spawn(process.execPath, ["-e", "require('node:http').createServer((q, s) => s.end()).listen(" + port + ", '::1')"], { detached: true, stdio: "ignore" });
    v6.unref();
    if (process.env.FAKE_PID_DIR) writeFileSync(process.env.FAKE_PID_DIR + "/" + v6.pid, "port holder");
  }
  if (process.env.FAKE_SIDECAR_HOLD_PORT_IN === process.cwd()) {
    const holder = spawn(process.execPath, ["-e", "require('node:http').createServer((q, s) => s.end()).listen(" + port + ", '127.0.0.1')"], { detached: true, stdio: "ignore" });
    holder.unref();
    if (process.env.FAKE_PID_DIR) writeFileSync(process.env.FAKE_PID_DIR + "/" + holder.pid, "port holder");
  } else {
    http
      .createServer((request, response) => {
        response.statusCode = 404;
        response.end();
      })
      .on("error", (error) => {
        console.error("fake sidecar: " + error.code);
        process.exit(9);
      })
      .listen(port, "127.0.0.1", () => {
        // The line the real sidecar prints once it listens; held back by
        // one started in FAKE_SIDECAR_SILENT_IN, which answers without it.
        if (process.env.FAKE_SIDECAR_SILENT_IN !== process.cwd()) {
          console.log("morph local preview sidecar listening on " + process.env.MORPH_LOCAL_THEME_PREVIEW_ORIGIN);
        }
      });
  }
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

  it(
    "records run identity before teardown and its exact cleanup outcome",
    { timeout: 90_000 },
    async () => {
      const handover = path.join(scratch, "retained", "container-run.json");
      const result = await runRunner(
        {
          MORPH_E2E_HANDOVER_RECORD: handover,
          FAKE_REPORT_STATUS: "passed",
        },
        undefined,
        [FIRST_SHARD],
      );
      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-1000));
      const record = JSON.parse(await readFile(handover, "utf8"));
      assert.equal(record.schemaVersion, 1);
      assert.match(record.invocationId, /^[0-9a-f-]{36}$/);
      assert.equal(record.spec, FIRST_SHARD);
      assert.equal(record.phase, "teardown-complete");
      assert.ok(Number.isSafeInteger(record.runner.pid));
      assert.ok(Number.isSafeInteger(record.runner.pgid));
      assert.ok(record.children.some((child) => child.name === "dev server"));
      assert.ok(record.children.every((child) => child.stopped === true));
      assert.equal(record.stateDir.removed, true);
      assert.match(record.containers.prefix, /^workerd-morph-e2e-[a-f0-9]{12}-$/);
      assert.equal(record.containers.cleanupAttempted, true);
      assert.equal(record.containers.gone, true);
      assert.equal(record.machineLock.acquired, true);
      assert.equal(record.machineLock.releaseCompleted, true);
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
        const stoppedAt = result.stdout.indexOf("[e2e] stopped sidecar");
        const removedAt = result.stdout.indexOf(`[e2e] removed ${root}`);
        assert.ok(removedAt >= 0, result.stdout.slice(-2000));
        // Removed only after the sidecar had stopped.
        assert.ok(stoppedAt >= 0 && stoppedAt < removedAt, result.stdout.slice(-2000));
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

describe("the e2e runner's .astro parser", () => {
  const sidecarEnv = () => path.join(scratch, ".dev.vars.local_preview_e2e");
  before(async () => {
    await writeFile(
      sidecarEnv(),
      "MORPH_LOCAL_THEME_PREVIEW_ORIGIN=http://127.0.0.1:5199\nMORPH_LOCAL_THEME_PREVIEW_TOKEN=runner-test-token-unused\n",
    );
  });
  after(async () => {
    await rm(sidecarEnv(), { force: true });
  });

  async function parserPorts() {
    return {
      MORPH_E2E_ASTRO_PARSER_PORT: String(await freePort()),
      MORPH_E2E_ASTRO_PARSER_INSPECTOR_PORT: String(await freePort()),
    };
  }

  it("refuses the parser with the container transport, before starting services", async () => {
    const result = await runRunner({ MORPH_E2E_ASTRO_PARSER: "1" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ASTRO_PARSER_NEEDS_LOCAL_PREVIEW/);
    assert.ok(!result.stdout.includes("applying migrations"));
    assert.deepEqual(result.leftBehind, []);
  });

  it("refuses a setting it does not know, before starting services", async () => {
    const result = await runRunner({
      MORPH_E2E_TRANSPORT: "local-sidecar",
      MORPH_E2E_ASTRO_PARSER: "yes",
    });
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /MORPH_E2E_ASTRO_PARSER must be "1", "0" or unset, not "yes"/,
    );
    assert.ok(!result.stdout.includes("applying migrations"));
    assert.deepEqual(result.leftBehind, []);
  });

  it(
    "starts the parser before the dev server in a registry of the run's own, confirms Core reaches it, keeps its log and stops it",
    { timeout: 90_000 },
    async () => {
      const dir = path.join(scratch, "astro-parser-run");
      await mkdir(dir, { recursive: true });
      const report = path.join(dir, "playwright.json");
      const parserFile = path.join(dir, "parser.json");
      const viteFile = path.join(dir, "vite.json");
      const result = await runRunner({
        MORPH_E2E_TRANSPORT: "local-sidecar",
        MORPH_E2E_ASTRO_PARSER: "1",
        ...(await parserPorts()),
        MORPH_E2E_REPORT_PATH: report,
        FAKE_PARSER_FILE: parserFile,
        FAKE_VITE_ENV_FILE: viteFile,
      });
      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-2000));
      const out = result.stdout;
      const ready = out.indexOf("[e2e] .astro parser ready");
      const devServer = out.indexOf("[e2e] starting the dev server");
      const confirmed = out.indexOf(
        "[e2e] Core confirmed a parse through ASTRO_PARSER (compiler 0.5.1)",
      );
      const suite = out.indexOf("[e2e] running playwright");
      assert.ok(ready >= 0 && ready < devServer, out.slice(-2000));
      assert.ok(devServer < confirmed && confirmed < suite, out.slice(-2000));
      assert.match(out, /\[e2e\] stopped astro parser/);
      const parser = JSON.parse(await readFile(parserFile, "utf8"));
      const vite = JSON.parse(await readFile(viteFile, "utf8"));
      // One registry, the run's own, inside its state directory.
      assert.equal(parser.registry, vite.registry);
      assert.equal(parser.registry, path.join(vite.stateDir, "dev-registry"));
      assert.ok(parser.args.includes("--inspector-port"));
      assert.match(
        await readFile(`${report}.astro-parser.log`, "utf8"),
        /\[stdout\] \[fake-parser\] ready/,
      );
      assert.equal(
        JSON.parse(await readFile(`${report}.astro-parser-check.json`, "utf8"))
          .outcome.status,
        "confirmed",
      );
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "fails before the dev server when the parser exits before it is ready",
    { timeout: 90_000 },
    async () => {
      const result = await runRunner({
        MORPH_E2E_TRANSPORT: "local-sidecar",
        MORPH_E2E_ASTRO_PARSER: "1",
        ...(await parserPorts()),
        FAKE_PARSER_MODE: "exit",
      });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /ASTRO_PARSER_EXITED: .*code 3/);
      assert.ok(!result.stdout.includes("starting the dev server"));
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "fails before the suite when Core does not confirm a parse, and stops both",
    { timeout: 90_000 },
    async () => {
      const result = await runRunner({
        MORPH_E2E_TRANSPORT: "local-sidecar",
        MORPH_E2E_ASTRO_PARSER: "1",
        ...(await parserPorts()),
        FAKE_CORE_PARSER_OUTCOME: JSON.stringify({
          status: "refused",
          code: "version-mismatch",
          reason: "parser-version-mismatch",
          detail: "compiler 0.6.0",
        }),
      });
      assert.equal(result.code, 1);
      assert.match(
        result.stderr,
        /ASTRO_PARSER_UNREACHABLE: .*refused version-mismatch/,
      );
      assert.ok(!result.stdout.includes("running playwright"));
      assert.match(result.stdout, /\[e2e\] stopped astro parser/);
      assert.match(result.stdout, /\[e2e\] stopped dev server/);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "starts no parser and leaves the registry alone for a run that does not ask",
    { timeout: 90_000 },
    async () => {
      const viteFile = path.join(scratch, `vite-no-parser-${Date.now()}.json`);
      const result = await runRunner({
        MORPH_E2E_TRANSPORT: "local-sidecar",
        FAKE_VITE_ENV_FILE: viteFile,
      });
      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-2000));
      assert.doesNotMatch(result.stdout, /astro parser|ASTRO_PARSER/);
      assert.equal(JSON.parse(await readFile(viteFile, "utf8")).registry, null);
      assert.deepEqual(result.leftBehind, []);
    },
  );
});

/**
 * The sidecar swap (`MORPH_E2E_SIDECAR_SWAP_FROM`): the run starts the old
 * checkout's sidecar, and a spec asks the runner, through the state directory,
 * to replace it with this checkout's. Everything is fake here: the "old
 * checkout" is a directory beside the scratch one holding the same fake
 * sidecar, and the spec is the fake Playwright's swap modes.
 */
describe("the e2e runner's sidecar swap", () => {
  const sidecarEnv = () => path.join(scratch, ".dev.vars.local_preview_e2e");
  const oldRoot = () => path.join(scratch, "old-root");
  const MANIFEST = '{"name":"runner-swap-fixture","private":true}\n';
  const LOCKFILE = "lockfileVersion: '9.0'\n";

  /** A copy of the old checkout, changed by `adjust`. */
  async function oldCheckout(name, adjust = async () => {}) {
    const dir = path.join(scratch, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, "scripts"), { recursive: true });
    await mkdir(path.join(dir, "node_modules"));
    await writeFile(path.join(dir, "scripts", "theme-preview-sidecar.mjs"), FAKE_SIDECAR);
    await writeFile(path.join(dir, "package.json"), MANIFEST);
    await writeFile(path.join(dir, "pnpm-lock.yaml"), LOCKFILE);
    await adjust(dir);
    return dir;
  }

  before(async () => {
    await writeFile(path.join(scratch, "package.json"), MANIFEST);
    await writeFile(path.join(scratch, "pnpm-lock.yaml"), LOCKFILE);
    await oldCheckout("old-root");
    // Something in the old checkout's previews that is not any run's.
    await mkdir(path.join(oldRoot(), ".morph-previews", "someone-elses"), { recursive: true });
    await writeFile(path.join(oldRoot(), ".morph-previews", "someone-elses", "kept.json"), "{}");
  });
  after(async () => {
    await rm(path.join(scratch, "package.json"), { force: true });
    await rm(path.join(scratch, "pnpm-lock.yaml"), { force: true });
    await rm(sidecarEnv(), { force: true });
  });

  let caseNumber = 0;
  /**
   * One swap-mode run. The sidecar origin is a free port of its own, so the
   * fake sidecars really listen and the handover is a real port handover.
   */
  async function swapRun(env = {}, onStarted, extraArgs, originHost = "127.0.0.1") {
    caseNumber += 1;
    const dir = path.join(scratch, `swap-case-${caseNumber}`);
    await mkdir(dir, { recursive: true });
    const port = await freePort();
    await writeFile(
      sidecarEnv(),
      `MORPH_LOCAL_THEME_PREVIEW_ORIGIN=http://${originHost}:${port}\nMORPH_LOCAL_THEME_PREVIEW_TOKEN=runner-test-token-unused\n`,
    );
    const files = {
      sidecars: path.join(dir, "sidecars.jsonl"),
      swap: path.join(dir, "swap.json"),
      report: path.join(dir, "playwright.json"),
    };
    const result = await runRunner(
      {
        MORPH_E2E_TRANSPORT: "local-sidecar",
        MORPH_E2E_SIDECAR_SWAP_FROM: oldRoot(),
        MORPH_E2E_REPORT_PATH: files.report,
        FAKE_SIDECAR_LISTEN: "1",
        FAKE_SIDECAR_LOG: files.sidecars,
        FAKE_SWAP_RESULT_FILE: files.swap,
        FAKE_PLAYWRIGHT_MODE: "swap",
        ...env,
      },
      onStarted ? (child) => onStarted(child, files) : undefined,
      extraArgs,
    );
    const sidecars = existsSync(files.sidecars)
      ? (await readFile(files.sidecars, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    const swap = existsSync(files.swap)
      ? JSON.parse(await readFile(files.swap, "utf8"))
      : null;
    return { ...result, sidecars, swap, files, port };
  }

  const output = (result) => result.stderr + result.stdout.slice(-3000);

  /** This run's workspace roots (`e2e-run-*`) left under a checkout. */
  async function runRootsIn(checkout) {
    const names = await readdir(path.join(checkout, ".morph-previews")).catch(() => []);
    return names.filter((name) => name.startsWith("e2e-run-"));
  }

  /** The old sidecar's root is under the old checkout, the new one's under this one. */
  function assertOwnRoots(sidecars) {
    assert.equal(sidecars.length, 2, JSON.stringify(sidecars));
    const [first, second] = sidecars;
    assert.equal(path.dirname(first.root ?? ""), path.join(oldRoot(), ".morph-previews"), JSON.stringify(first));
    assert.equal(path.dirname(second.root ?? ""), path.join(scratch, ".morph-previews"), JSON.stringify(second));
    for (const sidecar of sidecars) assert.match(path.basename(sidecar.root), /^e2e-run-/);
  }

  /** Every root the run's sidecars were given is gone, and only those. */
  async function assertRootsRemoved(sidecars) {
    for (const sidecar of sidecars) {
      assert.equal(existsSync(sidecar.root), false, `${sidecar.root} is still there`);
    }
    assert.deepEqual(await runRootsIn(oldRoot()), []);
    assert.deepEqual(await runRootsIn(scratch), []);
    assert.ok(existsSync(path.join(oldRoot(), ".morph-previews", "someone-elses", "kept.json")));
  }

  it(
    "swaps once: the old sidecar has stopped and released the port before the new one starts, and the result is bound to this run",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun();
      assert.equal(result.code, 0, output(result));
      assert.equal(result.sidecars.length, 2, output(result));
      const [first, second] = result.sidecars;
      assert.equal(first.cwd, oldRoot());
      assert.equal(second.cwd, scratch);
      assert.equal(result.swap.env.swap, "1");
      assert.equal(result.swap.env.nonce, "set");
      assert.match(result.swap.env.runId ?? "", /^[0-9a-f-]{36}$/);
      assert.equal(result.swap.results.length, 1);
      const [done] = result.swap.results;
      assert.equal(done.kind, "done", JSON.stringify(done));
      assert.equal(done.runId, result.swap.env.runId);
      assert.equal(done.requestId, "r1");
      assert.equal(done.oldPid, first.pid);
      assert.equal(done.newPid, second.pid);
      assert.equal(done.oldCwd, oldRoot());
      assert.equal(done.newCwd, scratch);
      assert.equal(done.nonce, undefined, "the nonce is not echoed");
      // The old one was gone, and its port free, before the new one started.
      assert.ok(done.stoppedAt <= done.portFreeAt, JSON.stringify(done));
      assert.ok(done.portFreeAt <= second.startedAt, JSON.stringify({ done, second }));
      assert.ok(second.startedAt <= done.readyAt, JSON.stringify({ done, second }));
      assert.match(result.stdout, /\[e2e\] stopped sidecar\n/);
      assert.match(result.stdout, /\[e2e\] sidecar swap r1 done/);
      // Both sidecars' records are kept beside the report.
      for (const suffix of [
        "sidecar.log",
        "sidecar-process.json",
        "sidecar-2.log",
        "sidecar-2-process.json",
      ]) {
        assert.ok(existsSync(`${result.files.report}.${suffix}`), suffix);
      }
      assert.equal(
        JSON.parse(await readFile(`${result.files.report}.sidecar-2-process.json`, "utf8")).pid,
        second.pid,
      );
      assert.match(
        await readFile(`${result.files.report}.sidecar.log`, "utf8"),
        new RegExp(`fake sidecar in ${oldRoot()}\\n`),
      );
      assert.match(
        await readFile(`${result.files.report}.sidecar-2.log`, "utf8"),
        new RegExp(`fake sidecar in ${scratch}\\n`),
      );
      // Each sidecar lays out workspaces in a root of this run's own under
      // its own checkout, so each resolves its own toolchain; both are gone
      // after the teardown, and nothing else in either directory is touched.
      assertOwnRoots(result.sidecars);
      await assertRootsRemoved(result.sidecars);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "with swap mode off: one sidecar from this checkout, no swap settings for the suite, and a request written anyway is never acted on",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({
        MORPH_E2E_SIDECAR_SWAP_FROM: "",
        FAKE_SIDECAR_LISTEN: "",
        FAKE_SWAP_WAIT_MS: "1500",
      });
      assert.equal(result.code, 0, output(result));
      assert.equal(result.sidecars.length, 1);
      assert.equal(result.sidecars[0].cwd, scratch);
      // The one root under this checkout, as before; none in the old one.
      assert.equal(path.dirname(result.sidecars[0].root), path.join(scratch, ".morph-previews"));
      assert.match(path.basename(result.sidecars[0].root), /^e2e-run-/);
      assert.equal(existsSync(result.sidecars[0].root), false);
      assert.deepEqual(await runRootsIn(oldRoot()), []);
      assert.deepEqual(result.swap.env, {
        swap: null,
        runId: null,
        nonce: null,
        timeoutMs: null,
      });
      assert.deepEqual(result.swap.results, [{ kind: "none" }]);
      assert.doesNotMatch(result.stdout + result.stderr, /sidecar swap|SIDECAR_SWAP/);
      assert.ok(!existsSync(`${result.files.report}.sidecar-2.log`));
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "with swap mode off, swap settings left in the shell do not reach the suite",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({
        MORPH_E2E_SIDECAR_SWAP_FROM: "",
        FAKE_SIDECAR_LISTEN: "",
        FAKE_SWAP_WAIT_MS: "1500",
        // What a shell might still hold from an earlier swap run.
        MORPH_E2E_SIDECAR_SWAP: "1",
        MORPH_E2E_SIDECAR_SWAP_NONCE: "left-in-the-shell",
        MORPH_E2E_SIDECAR_SWAP_TIMEOUT_MS: "5000",
      });
      assert.equal(result.code, 0, output(result));
      assert.equal(result.sidecars.length, 1);
      assert.deepEqual(result.swap.env, {
        swap: null,
        runId: null,
        nonce: null,
        timeoutMs: null,
      });
      assert.deepEqual(result.leftBehind, []);
    },
  );

  describe("refuses before starting anything", () => {
    const cases = [
      {
        name: "the container transport",
        env: () => ({ MORPH_E2E_TRANSPORT: "cloudflare-sandbox" }),
        reason: "TRANSPORT",
      },
      { name: "a full suite", env: () => ({}), args: [], reason: "NO_SPEC" },
      { name: "a shard", env: () => ({}), args: [FIRST_SHARD], reason: "SHARD" },
      {
        name: "a spec beside a shard",
        env: () => ({}),
        args: ["fake.spec.ts", FIRST_SHARD],
        reason: "SHARD",
      },
      {
        name: "a relative path",
        env: () => ({ MORPH_E2E_SIDECAR_SWAP_FROM: "old-root" }),
        reason: "NOT_ABSOLUTE",
      },
      {
        name: "a path that does not exist",
        env: () => ({ MORPH_E2E_SIDECAR_SWAP_FROM: path.join(scratch, "no-such-checkout") }),
        reason: "NOT_A_DIRECTORY",
      },
      {
        name: "this checkout itself",
        env: () => ({ MORPH_E2E_SIDECAR_SWAP_FROM: scratch }),
        reason: "SAME_CHECKOUT",
      },
      {
        name: "a checkout without the sidecar",
        env: async () => ({
          MORPH_E2E_SIDECAR_SWAP_FROM: await oldCheckout("old-no-sidecar", (dir) =>
            rm(path.join(dir, "scripts", "theme-preview-sidecar.mjs")),
          ),
        }),
        reason: "NO_SIDECAR",
      },
      {
        name: "a checkout without node_modules",
        env: async () => ({
          MORPH_E2E_SIDECAR_SWAP_FROM: await oldCheckout("old-no-modules", (dir) =>
            rm(path.join(dir, "node_modules"), { recursive: true }),
          ),
        }),
        reason: "NODE_MODULES_MISSING",
      },
      {
        name: "a symlinked node_modules",
        env: async () => ({
          MORPH_E2E_SIDECAR_SWAP_FROM: await oldCheckout("old-symlinked-modules", async (dir) => {
            await rm(path.join(dir, "node_modules"), { recursive: true });
            await mkdir(path.join(dir, "real-modules"));
            await symlink(path.join(dir, "real-modules"), path.join(dir, "node_modules"));
          }),
        }),
        reason: "NODE_MODULES_SYMLINK",
      },
      {
        name: "a different lockfile",
        env: async () => ({
          MORPH_E2E_SIDECAR_SWAP_FROM: await oldCheckout("old-other-lock", (dir) =>
            writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'\n"),
          ),
        }),
        reason: "MANIFEST_DIFFERS",
      },
      {
        name: "a different package.json",
        env: async () => ({
          MORPH_E2E_SIDECAR_SWAP_FROM: await oldCheckout("old-other-manifest", (dir) =>
            writeFile(path.join(dir, "package.json"), '{"name":"other"}\n'),
          ),
        }),
        reason: "MANIFEST_DIFFERS",
      },
      {
        name: "a time limit that is not a positive whole number",
        env: () => ({ MORPH_E2E_SIDECAR_SWAP_TIMEOUT_MS: "soon" }),
        reason: "TIMEOUT_SETTING",
      },
    ];
    for (const refusal of cases) {
      it(`${refusal.name}: ${refusal.reason}`, { timeout: 60_000 }, async () => {
        const result = await swapRun(await refusal.env(), undefined, refusal.args);
        assert.equal(result.code, 1, output(result));
        assert.match(
          result.stderr,
          new RegExp(`SIDECAR_SWAP_REFUSED: ${refusal.reason}\\b`),
        );
        assert.ok(!result.stdout.includes("applying migrations"));
        assert.ok(!result.stdout.includes("holding the machine's E2E slot"));
        assert.deepEqual(result.sidecars, []);
        assert.equal(result.swap, null, "the suite never ran");
        assert.deepEqual(result.leftBehind, []);
      });
    }
  });

  for (const [name, override, reason] of [
    ["a request from another run", { runId: "an-earlier-run" }, "RUN_MISMATCH"],
    ["a request without this run's nonce", { nonce: "guessed" }, "RUN_MISMATCH"],
    ["a request that asks for more than the swap", { cwd: "/elsewhere" }, "OUT_OF_SCOPE"],
    ["a request for another action", { action: "restart-dev-server" }, "OUT_OF_SCOPE"],
  ]) {
    it(
      `refuses ${name} (${reason}), keeps the old sidecar and fails the run`,
      { timeout: 90_000 },
      async () => {
        const result = await swapRun({ FAKE_SWAP_OVERRIDE: JSON.stringify(override) });
        assert.equal(result.code, 1, output(result));
        assert.equal(result.sidecars.length, 1);
        assert.equal(result.sidecars[0].cwd, oldRoot());
        assert.equal(result.swap.results.length, 1);
        assert.equal(result.swap.results[0].kind, "failed");
        assert.equal(result.swap.results[0].reason, reason);
        assert.equal(result.swap.results[0].runId, result.swap.env.runId);
        assert.match(result.stderr, new RegExp(`SIDECAR_SWAP_FAILED: .*${reason}`));
        assert.doesNotMatch(result.stdout, /\[e2e\] passed/);
        assert.deepEqual(result.leftBehind, []);
      },
    );
  }

  it(
    "answers a second request with DUPLICATE and starts no third sidecar",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({ FAKE_PLAYWRIGHT_MODE: "swap-twice" });
      assert.equal(result.code, 1, output(result));
      assert.deepEqual(
        result.swap.results.map(({ kind, reason, requestId }) => [kind, reason, requestId]),
        [
          ["done", undefined, "r1"],
          ["failed", "DUPLICATE", "r2"],
        ],
      );
      assert.equal(result.sidecars.length, 2);
      assert.match(result.stderr, /SIDECAR_SWAP_FAILED: .*DUPLICATE/);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "does not take a result it did not write as this run's, and fails the run",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({ FAKE_SWAP_PRESEED_DONE: "1" });
      assert.equal(result.code, 1, output(result));
      // The planted result is all the fake spec ever saw; the runner wrote none.
      assert.equal(result.swap.results[0].runId, "an-earlier-run");
      assert.equal(result.sidecars.length, 1);
      assert.match(result.stderr, /SIDECAR_SWAP_FAILED: .*RESULT_PREEXISTS/);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "fails a swap-mode run whose suite never asked for the swap",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({ FAKE_PLAYWRIGHT_MODE: "swap-no-request" });
      assert.equal(result.code, 1, output(result));
      assert.match(result.stderr, /SIDECAR_SWAP_NOT_REQUESTED/);
      assert.equal(result.sidecars.length, 1);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "stops an old sidecar that ignores SIGTERM with SIGKILL, and only then starts the new one",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({ FAKE_SIDECAR_IGNORE_TERM_IN: oldRoot() });
      assert.equal(result.code, 0, output(result));
      assert.match(result.stdout, /\[e2e\] stopped sidecar \(SIGKILL after/);
      const [done] = result.swap.results;
      assert.equal(done.kind, "done", JSON.stringify(done));
      assert.ok(done.portFreeAt <= result.sidecars[1].startedAt);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "gives up at the time limit, starts no new sidecar and still cleans up",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({
        FAKE_SIDECAR_IGNORE_TERM_IN: oldRoot(),
        MORPH_E2E_SIDECAR_SWAP_TIMEOUT_MS: "1500",
      });
      assert.equal(result.code, 1, output(result));
      const [failed] = result.swap.results;
      assert.equal(failed.kind, "failed", JSON.stringify(failed));
      assert.equal(failed.reason, "TIMEOUT");
      assert.equal(result.swap.env.timeoutMs, "1500");
      // Well inside the 10 s the old sidecar's SIGTERM grace would take.
      assert.ok(failed.answeredAt - failed.requestedAt < 6_000, JSON.stringify(failed));
      assert.equal(result.sidecars.length, 1);
      assert.match(result.stderr, /SIDECAR_SWAP_FAILED: .*TIMEOUT/);
      // The old sidecar's own root, under its checkout, removed with the
      // one under this checkout once it had been stopped.
      assert.equal(
        path.dirname(result.sidecars[0].root ?? ""),
        path.join(oldRoot(), ".morph-previews"),
      );
      await assertRootsRemoved(result.sidecars);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "starts no new sidecar while the old port is still held",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({ FAKE_SIDECAR_HOLD_PORT_IN: oldRoot() });
      assert.equal(result.code, 1, output(result));
      const [failed] = result.swap.results;
      assert.equal(failed.kind, "failed", JSON.stringify(failed));
      assert.equal(failed.reason, "PORT_NOT_RELEASED");
      assert.equal(result.sidecars.length, 1);
      // The holder was never this run's to stop; it is what is left, and the
      // only thing left.
      assert.equal(result.leftBehind.length, 1, JSON.stringify(result.leftBehind));
      assert.match(result.leftBehind[0], /^port holder \d+$/);
    },
  );

  it(
    "checks the handover on every address the origin's host names: a localhost origin still held on ::1 is not released",
    { timeout: 90_000 },
    async () => {
      // Required, not optional: CI's runners and the local machines have ::1,
      // and without it this case would prove nothing about the handover.
      const ipv6 = await new Promise((resolve) => {
        const probe = createServer();
        probe.once("error", (error) => resolve(String(error)));
        probe.listen(0, "::1", () => probe.close(() => resolve(true)));
      });
      assert.equal(
        ipv6,
        true,
        `this case needs a ::1 loopback to hold a port on: ${ipv6}`,
      );
      // The old sidecar serves on 127.0.0.1 and leaves a holder on ::1.
      const result = await swapRun(
        { FAKE_SIDECAR_ALSO_HOLD_V6_IN: oldRoot() },
        undefined,
        undefined,
        "localhost",
      );
      assert.equal(result.code, 1, output(result));
      const [failed] = result.swap.results;
      assert.equal(failed.kind, "failed", JSON.stringify(failed));
      assert.equal(failed.reason, "PORT_NOT_RELEASED");
      assert.equal(result.sidecars.length, 1);
      assert.equal(result.leftBehind.length, 1, JSON.stringify(result.leftBehind));
      assert.match(result.leftBehind[0], /^port holder \d+$/);
    },
  );

  it(
    "takes the new sidecar as ready only once it has said itself that it listens",
    { timeout: 90_000 },
    async () => {
      // The new sidecar answers on the origin but never says it listens, as
      // something else answering in its place would.
      const result = await swapRun({
        FAKE_SIDECAR_SILENT_IN: scratch,
        MORPH_E2E_SIDECAR_SWAP_TIMEOUT_MS: "3000",
      });
      assert.equal(result.code, 1, output(result));
      const [failed] = result.swap.results;
      assert.equal(failed.kind, "failed", JSON.stringify(failed));
      assert.equal(failed.reason, "TIMEOUT");
      assert.equal(result.sidecars.length, 2);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "keeps the suite's own failure when the suite fails after a swap",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({ FAKE_SWAP_EXIT: "7" });
      assert.equal(result.code, 1, output(result));
      assert.equal(result.swap.results[0].kind, "done");
      assert.match(result.stderr, /\[e2e\] npx playwright test .* exited with 7/);
      assert.doesNotMatch(result.stdout, /\[e2e\] passed/);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "keeps the suite's own failure when both the swap and the suite fail",
    { timeout: 90_000 },
    async () => {
      const result = await swapRun({
        FAKE_SWAP_EXIT: "7",
        FAKE_SWAP_OVERRIDE: JSON.stringify({ runId: "an-earlier-run" }),
      });
      assert.equal(result.code, 1, output(result));
      assert.equal(result.swap.results[0].reason, "RUN_MISMATCH");
      // The swap's failure is reported, and the error the run ends on is the suite's.
      assert.match(result.stdout + result.stderr, /sidecar swap failed: .*RUN_MISMATCH/);
      const errors = result.stderr.split("\n").filter((line) => line.startsWith("[e2e] "));
      assert.match(errors.at(-1) ?? "", /npx playwright test .* exited with 7/);
      assert.deepEqual(result.leftBehind, []);
    },
  );

  it(
    "on SIGTERM during the swap: exits 130, starts no new sidecar and leaves nothing behind",
    { timeout: 90_000 },
    async () => {
      let stateDir = "";
      const result = await swapRun(
        { FAKE_PLAYWRIGHT_MODE: "swap-hang", FAKE_SIDECAR_IGNORE_TERM_IN: oldRoot() },
        async (child, files) => {
          const deadline = Date.now() + 45_000;
          while (Date.now() < deadline) {
            stateDir = existsSync(files.swap)
              ? JSON.parse(await readFile(files.swap, "utf8")).stateDir
              : "";
            if (stateDir && existsSync(path.join(stateDir, "sidecar-swap.request.taken-1"))) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          assert.ok(
            stateDir && existsSync(path.join(stateDir, "sidecar-swap.request.taken-1")),
            "the runner never took the request",
          );
          child.kill("SIGTERM");
        },
      );
      assert.equal(result.code, 130, output(result));
      // A sidecar started after the teardown took its list outlives the
      // runner, and can announce itself only after the runner has exited, so
      // it is looked for again a little later; any found is killed here.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const late = (await readFile(result.files.sidecars, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      for (const sidecar of late.slice(1)) {
        for (const target of [-sidecar.pid, sidecar.pid]) {
          try {
            process.kill(target, "SIGKILL");
          } catch {
            /* Already gone. */
          }
        }
      }
      assert.equal(late.length, 1, JSON.stringify(late));
      assert.equal(result.sidecars.length, 1, JSON.stringify(result.sidecars));
      assert.equal(existsSync(stateDir), false);
      // Interrupted too, both checkouts are left without this run's roots.
      assert.equal(
        path.dirname(result.sidecars[0].root ?? ""),
        path.join(oldRoot(), ".morph-previews"),
      );
      await assertRootsRemoved(result.sidecars);
      assert.deepEqual(result.leftBehind, []);
    },
  );
});
