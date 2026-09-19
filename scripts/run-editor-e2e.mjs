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
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { verifyPublishedArtifact } from "./verify-published-artifact.mjs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Exits once stdout and stderr have reached the pipe.
 *
 * `process.exit` does not drain a pipe, and in CI both streams are pipes, so a
 * line written immediately before it can be dropped. A zero-length write's
 * callback resolves only after everything queued ahead of it has been flushed.
 *
 * Measured on both streams rather than assumed symmetric: 512 KB plus a marker
 * followed by a bare exit loses the marker on stdout *and* on stderr, and the
 * barrier keeps it on both.
 *
 * Used by every exit, including the transport refusal below, where nothing is
 * queued yet and a bare exit kept its line in five runs out of five. Depending on
 * that would ask each future reader to work out whether anything is in the buffer
 * at their exit — which is the local reasoning this replaces. One `await` costs
 * nothing, and a barrier at one exit is a barrier nobody remembers at the next.
 *
 * Declared here so all four exits read top-down; hoisting would allow it either
 * way, but a call seven hundred lines above its definition reads like a mistake.
 */
async function exitAfterFlush(code) {
  await Promise.all([
    new Promise((resolve) => process.stdout.write("", () => resolve())),
    new Promise((resolve) => process.stderr.write("", () => resolve())),
  ]);
  process.exit(code);
}

/**
 * Which preview transport this run exercises.
 *
 * `local-sidecar` is the default and the one CI uses: no container, so the
 * suite runs anywhere. `cloudflare-sandbox` runs the same suite against a real
 * Docker container through `CloudflareSandboxVitePreviewServer`, which is the
 * half of the system no test otherwise touches — types, unit tests and config
 * parity cover it, and none of those start a container.
 *
 * The difference is entirely which Wrangler environment serves it.
 * `containers` and `durable_objects` are declared at the top level and are not
 * inherited, so `local_preview_e2e` cannot reach a container and the default
 * environment cannot avoid one. Everything else here follows from that, down to
 * whether a sidecar is started at all.
 *
 * Either way the transport is asserted rather than assumed: the run tells the
 * precondition spec which one to expect, and a fallback fails the run instead
 * of passing quietly under the wrong one.
 */
const TRANSPORT = process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar";
if (TRANSPORT !== "local-sidecar" && TRANSPORT !== "cloudflare-sandbox") {
  console.error(
    `[e2e] MORPH_E2E_TRANSPORT must be "local-sidecar" or "cloudflare-sandbox", not "${TRANSPORT}".`,
  );
  await exitAfterFlush(1);
}
const USES_SIDECAR = TRANSPORT === "local-sidecar";
/** Empty means Wrangler's default environment, the one that has containers. */
const WRANGLER_ENV = USES_SIDECAR ? "local_preview_e2e" : "";
const DEV_PORT = Number(process.env.MORPH_E2E_PORT ?? 3000);
const DEV_ORIGIN = `http://localhost:${DEV_PORT}`;
const SIDECAR_ENV_FILE = ".dev.vars.local_preview_e2e";
/** Where the setup project stores the signed-in browser state. */
const STORAGE_STATE = "e2e/.auth/user.json";
const READY_TIMEOUT_MS = 120_000;
/**
 * How long a stopped child gets to actually stop, per signal.
 *
 * `kill` returns as soon as the signal is delivered, so every teardown that
 * trusts it is a teardown that reports success before it has any. The budget is
 * generous because it is only spent when something is already wrong: a Vite dev
 * server that has been asked to stop stops in well under a second, and the wait
 * exists for the case where it does not. Two of these can elapse, since SIGKILL
 * gets the same grace after SIGTERM has run out.
 */
const STOP_TIMEOUT_MS = 10_000;
/**
 * How often a stopping child's group is asked whether it is empty.
 *
 * There is no event for "this process group has no members left", so the only
 * way to know is to ask, and this is the interval between asks. It is spent only
 * while something is still there to wait for: a dev server that stops when asked
 * is measured at 1-2 ms, so a normal teardown does not reach the first poll.
 */
const GROUP_POLL_MS = 50;
/**
 * Fewest tests a whole run may execute before the result is treated as a
 * mistake rather than a pass.
 *
 * Every editor spec skips itself when `E2E_EDITOR_PATH` is unset, which is the
 * documented behaviour and the right one for a developer who has not set the
 * suite up. It also means one bad variable turns the job green with nothing
 * run, and "27 passed" and "0 passed" arrive through the same exit code. This
 * is the same refusal the build guard makes: a vacuum is not a pass.
 *
 * Only applied to a full run. Asking for one spec is a deliberate narrowing,
 * and a floor that failed it would make the script useless for the debugging
 * it exists to support.
 */
const MIN_TESTS_RUN = Number(process.env.MORPH_E2E_MIN_TESTS ?? 20);

/**
 * Where the publish spec leaves what the runner needs to verify it.
 *
 * A named file rather than "the newest build directory". Newest is an implicit
 * signal: a second theme, or an artifact left by the previous run, and the
 * verification silently points at the wrong thing while still passing. This file
 * says which release, which theme and which marker, so the handoff can be
 * checked rather than inferred.
 */
const HANDOFF_FILE = "publish-handoff.json";
/**
 * The port the reconstructed Theme Worker is served on.
 *
 * Taken from `MORPH_LOCAL_THEME_ORIGIN` so the two cannot drift: that is the
 * origin the Worker forwards storefront traffic to in local topology, and
 * serving the artifact anywhere else would be testing a port nothing uses.
 */
const THEME_WORKER_PORT = 8799;

/**
 * Containers that existed before this run, so the ones it adds can be told apart.
 *
 * Captured as ids rather than names or images. A developer's own `pnpm dev`
 * starts a container whose name has the same shape as the suite's
 * (`workerd-morph-Sandbox-<hash>-proxy`), so removing by name destroys their
 * sandbox session along with the leftovers — which is not hypothetical, it is how
 * this was found.
 */
let containersBefore = null;

/** Children to stop, newest first, however the run ends. */
const started = [];
/**
 * `storefront.theme.build.timings` lines, as the dev server emits them.
 *
 * Which build plane ran is not persisted anywhere — no migration defines an
 * `isolation` column — so the only place it is observable is this line, which
 * `theme-build.service.ts` emits with the runner's isolation, its duration and
 * the artifact stage measured separately. That is also the sample the container
 * build's cost has to be read from, so one capture answers both questions.
 */
const buildTimings = [];
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

function start(name, command, args, env, onLine) {
  const child = spawn(command, args, {
    // Piped only when someone is reading. A dev server's output is what a
    // developer watches when a run goes wrong, so it is echoed either way; the
    // pipe exists because one line of it is evidence this run has to assert on.
    stdio: ["ignore", onLine ? "pipe" : "inherit", onLine ? "pipe" : "inherit"],
    env: { ...process.env, ...env },
    // Its own process group, so `cleanUp` can signal the whole tree and not just
    // its root. What holds the port is never this process: the dev server runs
    // behind a shell and `npx`, and what keeps it alive is its grandchildren.
    // Signalling only the root reaches a shell that is already waiting on
    // someone else, which is how a run that passed in 3.6 minutes came to leave
    // seven orphans for the CI runner to terminate by hand.
    //
    // The cost is that this process no longer receives a Ctrl-C aimed at the
    // terminal's foreground group. That is already handled: the handler at the
    // bottom of this file catches the signal itself and stops the groups
    // explicitly, which is the same path a normal run takes.
    detached: true,
  });
  if (onLine) {
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        process.stdout.write(chunk);
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        // The last element is whatever arrived without a newline yet; holding it
        // back is what keeps a JSON line from being parsed in halves.
        pending = lines.pop() ?? "";
        for (const line of lines) onLine(line);
      });
    }
  }
  // Resolved when the process is actually gone. `kill` reports that a signal was
  // sent, not that it was obeyed, so this is the only thing that can tell
  // `cleanUp` the wait is over — and the only way "stopped" can be logged after
  // the process it names has stopped.
  //
  // `exit` rather than `close`, deliberately: `close` waits for every stdio
  // stream to end, and a stream held open by a grandchild is the very case this
  // is here to survive. Waiting on it would turn a successful stop into a
  // timeout.
  const exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      if (!child.stopping && code !== 0) {
        console.error(`[e2e] ${name} exited early (code ${code}, ${signal}).`);
      }
      resolve();
    });
  });
  started.unshift({ name, child, exited });
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

/**
 * Container ids currently running, or null when Docker cannot be asked.
 *
 * Silent on failure: Docker is a requirement of the container transport, not of
 * this bookkeeping, and a sidecar run should not report a Docker problem.
 */
function runningContainers() {
  const result = spawnSync("docker", ["ps", "-q"], { encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  return new Set(result.stdout.split(/\s+/).filter(Boolean));
}

/**
 * Reports the containers this run added and did not release, removing them only
 * when asked.
 *
 * Every run of this suite leaves a `workerd-morph-Sandbox-<hash>-proxy` behind:
 * the runner stops the dev server, and containers workerd started through the
 * Sandbox binding outlive it. Ten accumulated in one session, after which the
 * machine's load average reached 57 and every run stalled in `openEditor` at
 * "preview frame" — so this is not housekeeping, it is the difference between a
 * suite that keeps working and one that degrades until its timings mean nothing.
 *
 * Reporting rather than removing, by default, because the difference cannot tell
 * whose container it is. A developer running their own dev server beside this one
 * — which `MORPH_E2E_PORT` exists to allow — may have started a sandbox session
 * mid-run, and it would appear in exactly the same difference. Leaving a
 * container costs disk and some load; destroying the session someone is working
 * in costs them their state. `MORPH_E2E_REAP_CONTAINERS=1` opts into removal for
 * an unattended machine, where nothing else is holding a session.
 */
async function reportLeakedContainers() {
  if (!containersBefore) return;
  const candidates = runningContainers();
  if (!candidates) return;
  const added = [...candidates].filter((id) => !containersBefore.has(id));
  if (added.length === 0) return;

  // Waited on, and re-checked. A stopping dev server releases its containers a
  // moment after it exits, so an immediate difference named two ids that were
  // gone by the next command — advice to remove containers that no longer
  // existed. Not every run leaks; the ones that do are what this is for.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const stillRunning = runningContainers();
  if (!stillRunning) return;
  const leaked = added.filter((id) => stillRunning.has(id));
  if (leaked.length === 0) {
    log("every container this run started has exited");
    return;
  }

  if (process.env.MORPH_E2E_REAP_CONTAINERS !== "1") {
    log(
      `this run left ${leaked.length} container(s) running: ${leaked.join(" ")}. Remove them with \`docker rm -f ${leaked.join(" ")}\`, or set MORPH_E2E_REAP_CONTAINERS=1 on a machine where nothing else holds a sandbox session. Do not filter by name: a developer's own dev server uses the same shape.`,
    );
    return;
  }
  const removed = spawnSync("docker", ["rm", "-f", ...leaked], {
    encoding: "utf8",
  });
  log(
    removed.status === 0
      ? `removed ${leaked.length} container(s) this run started`
      : `could not remove ${leaked.join(" ")}: ${(removed.stderr ?? "").trim().slice(0, 120)}`,
  );
}

/**
 * Signals a child's whole process group, which is the only handle on the tree.
 *
 * Negative pid addresses the group rather than the process, and it is why
 * `start` spawns detached. The direct child is a shell or `npx` that has handed
 * off to the real server, so it can be gone while the port is still held; the
 * group is what survives.
 *
 * Throwing here is not an option: this runs on the failure path too, and a
 * teardown that throws replaces the error it was called to clean up after with
 * one of its own. A group with nothing left in it is the ordinary case for the
 * sweep below, not an anomaly.
 */
function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    /* Already gone. */
  }
}

/**
 * Whether anything is left in the child's group.
 *
 * Signal 0 performs the existence and permission checks and delivers nothing, so
 * this asks the question instead of assuming the answer. `ESRCH` is the only
 * reply that means empty; anything else — including a permission error — is
 * treated as "still there", because the cost of the two mistakes is not
 * symmetric: one extra SIGKILL to a group that has nothing in it is caught and
 * ignored, and one missed process holds the port for the next run.
 */
function groupAlive(child) {
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

/**
 * Waits for the child's group to empty, and says whether it did.
 *
 * Polled rather than awaited, because "this process group has no members left"
 * is not an event anything reports. Signal 0 is the only way to ask, and the
 * interval only elapses while something is still there to wait for.
 */
async function groupEmpties(child, ms) {
  const deadline = Date.now() + ms;
  while (groupAlive(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS));
  }
  return !groupAlive(child);
}

/**
 * Stops one child and everything it started, and does not return until the group
 * is empty.
 *
 * The wait is on the group rather than on the process, because those are
 * different claims and only the second one means the port is free. `sh` and
 * `npx` sit between this script and the dev server, and the dev server starts
 * `workerd` and `esbuild`; any of them can outlive the process this script
 * spawned. The old version logged `stopped ${name}` on the line after `kill`
 * returned, which is the line the CI log contradicts: the suite passed, the job
 * sat until its own thirty-minute timeout, and the runner then terminated
 * `sh`, two `node`s, two `esbuild`s and `workerd` by hand.
 */
async function stop({ name, child, exited }) {
  child.stopping = true;
  signalGroup(child, "SIGTERM");
  // The child's own exit is the fast path: it is event-driven, so the ordinary
  // case — a dev server that stops when asked — costs no polling at all.
  await settlesWithin(exited, STOP_TIMEOUT_MS);
  // What it does not establish is that the group is empty, which is the part
  // that matters and the part with no event to listen for.
  if (await groupEmpties(child, STOP_TIMEOUT_MS)) {
    log(`stopped ${name}`);
    return;
  }
  signalGroup(child, "SIGKILL");
  // Waited for too, and not because SIGKILL can fail — it cannot be caught or
  // ignored. Delivery is not teardown. Measured against a leaf that ignored
  // SIGTERM, the group took a further 12 ms to run down, and the listening
  // socket is released somewhere inside that. Returning at the signal would hand
  // whatever runs next a port this run had already killed.
  if (await groupEmpties(child, STOP_TIMEOUT_MS)) {
    log(`stopped ${name} (SIGKILL after ${STOP_TIMEOUT_MS} ms)`);
    return;
  }
  log(`could not stop ${name}; something may still be running`);
}

/** Resolves `true` if `promise` settles within `ms`, `false` if it does not. */
function settlesWithin(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void promise.then(() => {
      // Cleared rather than left to fire: a pending timer is a live handle, and
      // a live handle is what makes a finished run fail to end.
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function cleanUp() {
  // Signalled together and awaited together. The children are independent, so
  // stopping them in sequence would make each one wait out the others' budgets.
  await Promise.all(started.map((entry) => stop(entry)));
  started.length = 0;
  // After the children are gone, so a container a stopping dev server was about
  // to release is not counted as leaked. That ordering was only a comment
  // before: the loop above returned before the servers had stopped, so this
  // counted containers the run had in fact released.
  await reportLeakedContainers();
  if (stateDir) {
    await rm(stateDir, { recursive: true, force: true });
    log(`removed ${stateDir}`);
    stateDir = null;
  }
}

/**
 * How many tests actually executed, as distinct from how many were collected.
 *
 * Counted from Playwright's own JSON report rather than from its console
 * output, which is a rendering and changes with the reporter.
 */
async function testsRun(reportPath) {
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    throw new Error(
      `UNREADABLE_REPORT: Playwright wrote no JSON report at ${reportPath}, so the number of tests that ran cannot be checked.`,
    );
  }
  let ran = 0;
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status && result.status !== "skipped") ran += 1;
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return ran;
}

/**
 * The subset of dotenv the pre-flight needs: `KEY=value`, `export KEY=value`,
 * comments and blanks skipped, surrounding quotes dropped.
 *
 * Deliberately not `process.loadEnvFile`, which would put a credential into
 * this process to find out whether it is there.
 */
function parseEnvFile(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;
    const [, key, rawValue] = match;
    values[key] = rawValue
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .trim();
  }
  return values;
}


/**
 * The part of publishing that the browser cannot see.
 *
 * Runs only when the publish spec left a handoff, so a filtered run that never
 * published is not failed for not having published. What it establishes, and
 * what it deliberately does not:
 *
 * - The pointer moved. Read straight from D1, not inferred from the artifact
 *   rendering — the CAS on `active_release_id` is a fact worth asserting on its
 *   own rather than as a by-product of a successful fetch.
 * - The artifact is whole. Every file the build's own manifest declares is
 *   present, the right length and hashes to the recorded digest.
 * - The artifact runs, and what it renders contains this run's marker.
 *
 * - That activation *caused* a Worker to serve it is NOT established here, and
 *   cannot be locally: activation sends nothing in this topology. The artifact is
 *   started by this harness, which is the operator's step standing in for a
 *   deployment. Only the credentialed deployer exercises that edge.
 */
async function verifyPublishedRelease() {
  const handoffPath = path.join(stateDir, HANDOFF_FILE);
  if (!existsSync(handoffPath)) {
    log("no publish handoff — skipping artifact verification");
    return;
  }

  log("verifying the published release against D1 and R2");
  const verified = await verifyPublishedArtifact({
    handoffPath,
    persistTo: stateDir,
    outDir: path.join(stateDir, "artifact"),
  });
  log(
    `release ${verified.releaseId} → build ${verified.buildId}, ${verified.fileCount} artifact files intact`,
  );

  // Which plane compiled it. Asserted from the build service's own timings line
  // because no column records it, and asserted at all because a local build
  // reported as a container one would answer the container's cost question with
  // the wrong number.
  const timing = buildTimings.at(-1);
  if (!timing) {
    throw new Error(
      "NO_BUILD_TIMINGS: the dev server never emitted a storefront.theme.build.timings line, so which plane ran and what it cost are both unknown — while a release was published from a build that must have run.",
    );
  }
  if (timing.runner?.isolation !== "sandbox-container") {
    throw new Error(
      `WRONG_BUILD_PLANE: the build ran on "${timing.runner?.isolation}". A publish slice that compiles in-process proves nothing about the container.`,
    );
  }
  log(
    `container build: runner ${timing.runner.durationMs}ms, artifact stage ${timing.artifactMs}ms, total ${timing.totalMs}ms`,
  );

  // Guarded like the dev server's port, and for the same reason. Something else
  // on 8799 would either refuse the start with a message about wrangler, or —
  // worse — answer the fetch below, and an unrelated process serving a page
  // without the marker reads as "the artifact does not render this run's edit".
  if (await portInUse(THEME_WORKER_PORT)) {
    throw new Error(
      `THEME_WORKER_PORT_IN_USE: something already listens on ${THEME_WORKER_PORT}, which is where MORPH_LOCAL_THEME_ORIGIN points. Stop it: a reply from the wrong process would be read as a failure of the published artifact.`,
    );
  }

  log(`serving the reconstructed artifact on ${THEME_WORKER_PORT}`);
  start("theme worker", "npx", [
    "wrangler", "dev",
    "--config", verified.workerConfig,
    "--port", String(THEME_WORKER_PORT),
    "--ip", "127.0.0.1",
  ]);
  const origin = `http://127.0.0.1:${THEME_WORKER_PORT}`;
  await waitForOk(origin, "the reconstructed theme worker");

  const response = await fetch(origin, { redirect: "follow" });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `ARTIFACT_DID_NOT_SERVE: ${origin} answered ${response.status}. The published artifact is intact but does not run.`,
    );
  }
  if (body.trim().length === 0) {
    throw new Error(
      `ARTIFACT_SERVED_NOTHING: ${origin} answered ${response.status} with an empty body.`,
    );
  }
  log(
    `the published artifact runs: ${response.status}, ${body.length} bytes from revision ${verified.sourceRevisionId}`,
  );
}

async function main() {
  if (USES_SIDECAR && !existsSync(SIDECAR_ENV_FILE)) {
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
  // Inherited, this would quietly send a container run to a named environment
  // that has no containers — and the transport precondition would then fail
  // for a reason that looks nothing like its cause.
  if (!USES_SIDECAR && process.env.CLOUDFLARE_ENV) {
    throw new Error(
      `CLOUDFLARE_ENV_SET: the container transport needs Wrangler's default environment, but CLOUDFLARE_ENV is "${process.env.CLOUDFLARE_ENV}" in this shell. Unset it and run again.`,
    );
  }
  // Refused on the condition the deployer actually tests, not on a flag.
  //
  // `createServerThemeWorkerDeployer` picks the operator-managed deployer — the
  // one that uploads nothing — only when `MORPH_LOCAL_THEME_ORIGIN` is set AND
  // both Cloudflare credentials are absent AND the environment is not
  // production. Let a token reach the Worker's env and it falls through to
  // `SandboxWranglerThemeWorkerDeployer`, which runs wrangler and deploys for
  // real. Publishing is atomic here — `publishTemplate` moves
  // `active_release_id` before anything is sent to the Worker — so there is no
  // half-step to stop at once that has happened.
  //
  // So the credentials are what gates this run, and they are checked where they
  // would arrive from: the shell, and the `.dev.vars` files Wrangler loads into
  // the Worker's bindings. `E2E_ALLOW_PUBLISH` gated the old spec and could not
  // have caught this: the flag is read in the test process, and the deployer
  // choice is made in the Worker from values the flag knows nothing about.
  const credentialSources = [
    ["the shell", { ...process.env }],
    ...(await Promise.all(
      [".dev.vars", ".dev.vars.local", `.dev.vars.${WRANGLER_ENV}`]
        .filter((file) => file !== ".dev.vars." && existsSync(file))
        .map(async (file) => [file, parseEnvFile(await readFile(file, "utf8"))]),
    )),
  ];
  const credentialsFound = credentialSources.flatMap(([source, values]) =>
    ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
      .filter((key) => (values[key] ?? "").trim() !== "")
      .map((key) => `${key} in ${source}`),
  );
  if (credentialsFound.length > 0) {
    throw new Error(
      `CLOUDFLARE_CREDENTIALS_PRESENT: ${credentialsFound.join(", ")}. This run publishes, and publishing is atomic — the pointer moves and the release is deployed by whichever deployer the Worker composes. With a credential in scope that is the real one, which uploads to Cloudflare. Remove it from the environment this run loads, or run the suite without the publish slice.`,
    );
  }

  if (await portInUse(DEV_PORT)) {
    throw new Error(
      `PORT_IN_USE: something already listens on ${DEV_PORT}. Stop it first, or set MORPH_E2E_PORT to run beside it — a run that attached to a developer's own dev server would exercise their database and still pass.`,
    );
  }

  stateDir = await mkdtemp(path.join(tmpdir(), "morph-e2e-"));
  log(`state directory ${stateDir}`);
  log(`transport ${TRANSPORT}`);

  // A stored session is worth nothing to this run and can cost it the suite.
  // The setup project reuses one to avoid the sign-in rate limit, which is the
  // right trade against a database that has been there a while — but this
  // database is minutes old and so is its rate limiter, so there is nothing to
  // conserve. Worse, Better Auth caches a session in the cookie itself for five
  // minutes (`cookieCache`), so a cookie from a run that just finished
  // authenticates without a database lookup even though the new database holds
  // no session at all. The check passes, the suite starts, and the cache
  // expires partway through — which is the failure that first looked like the
  // editor losing its session at test five.
  await rm(STORAGE_STATE, { force: true });

  log("applying migrations");
  run("npx", [
    "wrangler", "d1", "migrations", "apply", "DATABASE",
    "--local", ...(WRANGLER_ENV ? ["--env", WRANGLER_ENV] : []),
    "--persist-to", stateDir,
  ]);

  log("seeding the account and one published product");
  run("node", [
    "scripts/seed-e2e.mjs", "--persist-to", stateDir, "--env", WRANGLER_ENV,
  ]);
  // `--env ""` is deliberate above: the seed reads an empty value as "the
  // default environment" and drops the flag, which is not something `--env`
  // can express to Wrangler directly.

  if (USES_SIDECAR) {
    log("starting the preview sidecar");
    start("sidecar", "node", [
      `--env-file-if-exists=${SIDECAR_ENV_FILE}`,
      "scripts/theme-preview-sidecar.mjs",
    ]);
  } else {
    // Nothing to start: the Worker reaches a container through its own binding,
    // and Docker has to be running for that binding to resolve.
    log("no sidecar — the preview comes from a container");
  }

  // Snapshotted before anything can start a container, so the difference is this
  // run's and nothing earlier is ever a candidate for removal.
  containersBefore = runningContainers();
  if (containersBefore) log(`${containersBefore.size} container(s) already running`);

  log(`starting the dev server on ${DEV_PORT}`);
  start("dev server", "npx", ["vite", "dev", "--port", String(DEV_PORT)], {
    // Unset, not empty: an empty `CLOUDFLARE_ENV` is still a named environment
    // as far as the plugin is concerned.
    ...(WRANGLER_ENV ? { CLOUDFLARE_ENV: WRANGLER_ENV } : {}),
    MORPH_E2E_STATE_DIR: stateDir,
  }, (line) => {
    if (!line.includes("storefront.theme.build.timings")) return;
    // The line is JSON inside whatever the dev server wraps around it, so the
    // object is taken from the first brace rather than by parsing the line.
    const start = line.indexOf("{");
    if (start < 0) return;
    try {
      buildTimings.push(JSON.parse(line.slice(start)));
    } catch {
      /* A line split across chunks by something other than a newline. */
    }
  });
  await waitForOk(DEV_ORIGIN, "the dev server");
  log("dev server ready");

  // A leading `--` is dropped rather than forwarded. The usage above offers it,
  // and Playwright reads it as end-of-options — so `-- e2e/editor.spec.ts -g x`
  // silently ran the whole suite instead of one test, with the filter accepted
  // and ignored. Both spellings work now.
  const passed = process.argv.slice(2);
  const extra = passed[0] === "--" ? passed.slice(1) : passed;
  const report = path.join(stateDir, "playwright-report.json");
  const reporting = extra.some((argument) => argument.startsWith("--reporter"))
    ? []
    : ["--reporter=line,json"];
  log(`running playwright${extra.length ? ` (${extra.join(" ")})` : ""}`);
  run("npx", ["playwright", "test", "--project=editor", ...reporting, ...extra], {
    // Asserted as a precondition, so a run that silently fell back to the
    // container transport fails instead of passing for the wrong reason.
    E2E_EXPECT_PREVIEW_TRANSPORT: TRANSPORT,
    MORPH_E2E_STATE_DIR: stateDir,
    PLAYWRIGHT_JSON_OUTPUT_NAME: report,
    MORPH_E2E_HANDOFF: path.join(stateDir, HANDOFF_FILE),
    // Without this the port guard's own escape hatch does not work: the script
    // would move the dev server to `MORPH_E2E_PORT` and leave the suite calling
    // the default origin, which is whatever is already listening on 3000 — the
    // developer's own server, which is the thing the guard exists to avoid.
    E2E_BASE_URL: DEV_ORIGIN,
  });

  await verifyPublishedRelease();

  if (extra.length === 0 && reporting.length > 0) {
    const ran = await testsRun(report);
    if (ran < MIN_TESTS_RUN) {
      throw new Error(
        `TOO_FEW_TESTS_RAN: ${ran} test(s) executed, expected at least ${MIN_TESTS_RUN}. Playwright reported success, but a suite that skipped itself passes the same way one that ran does. Check that .env.e2e still carries E2E_EDITOR_PATH, E2E_EMAIL and E2E_PASSWORD.`,
      );
    }
    log(`${ran} tests executed`);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void cleanUp().then(() => exitAfterFlush(130));
  });
}

main()
  .then(async () => {
    await cleanUp();
    log("passed");
    // Success used to fall off the end of the event loop and wait for the last
    // handle to close. That is how a green run became a thirty-minute job: the
    // suite passed in 3.6 minutes, the last handle was an orphaned dev server,
    // and nothing ended the process until the job's own `timeout-minutes` did.
    // Failure already exits explicitly, one branch below; success does now too.
    //
    // Through the barrier, for the line above.
    await exitAfterFlush(0);
  })
  .catch(async (error) => {
    console.error(`[e2e] ${error instanceof Error ? error.message : error}`);
    await cleanUp();
    // The same barrier, and the exit where a dropped line costs most: this is the
    // only one that says what went wrong. `await cleanUp()` above gave it time to
    // drain by accident rather than by design — a normal teardown returns in 1 ms.
    await exitAfterFlush(1);
  });
