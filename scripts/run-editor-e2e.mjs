// @ts-check
/**
 * One editor end-to-end run against the loopback preview sidecar.
 *
 * The run needs five things standing in the right order — a disposable
 * database, its migrations, a seeded account and product, the sidecar, and a
 * dev server pointed at all of it — and every one of them was a way to get a
 * green run that meant nothing. A dev server started without
 * `CLOUDFLARE_ENV=local_preview_e2e` reads a different D1 binding and reports
 * "User not found" for an account that is certainly there. One started without
 * `MORPH_E2E_STATE_DIR` reads the developer's own store. A relative
 * `--persist-to` splits the migrations and the server across two directories.
 * Each of those cost a debugging session before it cost a test failure, so the
 * sequence lives here rather than in a paragraph someone retypes.
 *
 * Usage:
 *   node scripts/run-editor-e2e.mjs [-- <extra playwright args>]
 *
 * Reads `.env.e2e` for E2E_EMAIL, E2E_PASSWORD and E2E_EDITOR_PATH, and
 * `.dev.vars.local_preview_e2e` for the sidecar origin and token. Neither is
 * printed. The state directory is created fresh and removed on the way out,
 * whether the run passed, failed, or was interrupted.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WRANGLER_ENV = "local_preview_e2e";
const DEV_PORT = Number(process.env.MORPH_E2E_PORT ?? 3000);
const DEV_ORIGIN = `http://localhost:${DEV_PORT}`;
const SIDECAR_ENV_FILE = `.dev.vars.${WRANGLER_ENV}`;
const READY_TIMEOUT_MS = 120_000;

/** Children to stop, newest first, however the run ends. */
const started = [];
let stateDir = null;

function log(message) {
  console.log(`[e2e] ${message}`);
}

/**
 * Whether something already listens on a port.
 *
 * Checked before anything starts, because the failure it prevents is the
 * expensive one: a developer's own `pnpm dev` on 3000 would accept the run's
 * requests and answer them from their real database, and the suite would sign
 * in, edit a theme and pass. A busy port has to stop the run, not redirect it.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * `env` is a plain set of additions, matching `start` below. It was once an
 * options bag whose `env` key was merged, and calling it with the additions
 * directly put them where `spawnSync` ignored them: the run stayed green while
 * `E2E_EXPECT_PREVIEW_TRANSPORT` never reached Playwright, so the transport
 * precondition skipped itself and proved nothing. The two functions take the
 * same shape now so that cannot be got wrong in one of them.
 */
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...env },
  });
  child.on("exit", (code, signal) => {
    if (!child.stopping && code !== 0) {
      console.error(`[e2e] ${name} exited early (code ${code}, ${signal}).`);
    }
  });
  started.unshift({ name, child });
  return child;
}

async function waitForOk(url, label) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      // Any answer proves the process is serving. The sidecar has no health
      // route and replies 404, which is as good a sign of life as a 200.
      if (response.status > 0) return;
    } catch {
      /* Not listening yet. */
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} did not answer within ${READY_TIMEOUT_MS}ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function cleanUp() {
  for (const { name, child } of started) {
    child.stopping = true;
    try {
      child.kill("SIGTERM");
      log(`stopped ${name}`);
    } catch {
      /* Already gone. */
    }
  }
  started.length = 0;
  if (stateDir) {
    await rm(stateDir, { recursive: true, force: true });
    log(`removed ${stateDir}`);
    stateDir = null;
  }
}

async function main() {
  if (!existsSync(SIDECAR_ENV_FILE)) {
    throw new Error(
      `MISSING_SIDECAR_ENV: ${SIDECAR_ENV_FILE} holds MORPH_LOCAL_THEME_PREVIEW_ORIGIN and MORPH_LOCAL_THEME_PREVIEW_TOKEN, which the Worker and the sidecar must agree on.`,
    );
  }
  if (!existsSync(".env.e2e")) {
    throw new Error(
      "MISSING_E2E_ENV: .env.e2e holds E2E_EMAIL, E2E_PASSWORD and E2E_EDITOR_PATH. It is gitignored; create it before running.",
    );
  }
  // Playwright loads this file itself; the seed is a separate process that
  // needs the same two values, and it has to hash the very password the suite
  // will sign in with.
  process.loadEnvFile(".env.e2e");
  if (await portInUse(DEV_PORT)) {
    throw new Error(
      `PORT_IN_USE: something already listens on ${DEV_PORT}. Stop it first — a run that attached to a developer's own dev server would exercise their database and still pass. Set MORPH_E2E_PORT to use another port.`,
    );
  }

  stateDir = await mkdtemp(path.join(tmpdir(), "morph-e2e-"));
  log(`state directory ${stateDir}`);

  log("applying migrations");
  run("npx", [
    "wrangler", "d1", "migrations", "apply", "DATABASE",
    "--local", "--env", WRANGLER_ENV, "--persist-to", stateDir,
  ]);

  log("seeding the account and one published product");
  run("node", [
    "scripts/seed-e2e.mjs", "--persist-to", stateDir, "--env", WRANGLER_ENV,
  ]);

  log("starting the preview sidecar");
  start("sidecar", "node", [
    `--env-file-if-exists=${SIDECAR_ENV_FILE}`,
    "scripts/theme-preview-sidecar.mjs",
  ]);

  log(`starting the dev server on ${DEV_PORT}`);
  start("dev server", "npx", ["vite", "dev", "--port", String(DEV_PORT)], {
    CLOUDFLARE_ENV: WRANGLER_ENV,
    MORPH_E2E_STATE_DIR: stateDir,
  });
  await waitForOk(DEV_ORIGIN, "the dev server");
  log("dev server ready");

  const extra = process.argv.slice(2);
  log(`running playwright${extra.length ? ` (${extra.join(" ")})` : ""}`);
  run("npx", ["playwright", "test", "--project=editor", ...extra], {
    // Asserted as a precondition, so a run that silently fell back to the
    // container transport fails instead of passing for the wrong reason.
    E2E_EXPECT_PREVIEW_TRANSPORT: "local-sidecar",
    MORPH_E2E_STATE_DIR: stateDir,
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void cleanUp().then(() => process.exit(130));
  });
}

main()
  .then(async () => {
    await cleanUp();
    log("passed");
  })
  .catch(async (error) => {
    console.error(`[e2e] ${error instanceof Error ? error.message : error}`);
    await cleanUp();
    process.exit(1);
  });
