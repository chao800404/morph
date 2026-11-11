// @ts-check
import { spawnSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LOCK_FILE } from "./e2e-machine-lock.mjs";

const CONTAINER_PREFIX = /^workerd-morph-e2e-[0-9a-f]{12}-$/;

function failed(code, message) {
  throw new Error(`${code}: ${message}`);
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function positivePid(value) {
  return Number.isSafeInteger(value) && value > 1;
}

/**
 * Verify the recorded first runner is fully gone and all exact resources it
 * owned are released. Every adapter returns an explicit unknown state on
 * inspection failure; unknown is always a refusal.
 *
 * @param {unknown} record
 * @param {{
 *   stateRoot?: string,
 *   expectedLockFile?: string,
 *   processState?: (pid: number) => "alive" | "gone" | "unknown",
 *   processGroupState?: (pgid: number) => "alive" | "gone" | "unknown",
 *   pathState?: (target: string) => "present" | "absent" | "unknown",
 *   containersForPrefix?: (prefix: string) => string[] | null,
 *   lockIsFree?: (lockFile: string) => boolean | null,
 *   expectedSpec?: string,
 * }} adapters
 */
export async function verifyContainerRunHandover(record, adapters = {}) {
  const stateRoot = path.resolve(adapters.stateRoot ?? tmpdir());
  const expectedLockFile = path.resolve(
    adapters.expectedLockFile ?? DEFAULT_LOCK_FILE,
  );
  const processState = adapters.processState ?? defaultProcessState;
  const processGroupState =
    adapters.processGroupState ?? defaultProcessGroupState;
  const pathState = adapters.pathState ?? defaultPathState;
  const containersForPrefix =
    adapters.containersForPrefix ?? defaultContainersForPrefix;
  const lockIsFree = adapters.lockIsFree ?? defaultLockIsFree;

  if (!isRecord(record)) failed("HANDOVER_BAD_MANIFEST", "manifest is not an object");
  if (record.schemaVersion !== 1) {
    failed("HANDOVER_BAD_SCHEMA", "unsupported manifest schema version");
  }
  if (
    typeof record.invocationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      record.invocationId,
    )
  ) {
    failed("HANDOVER_BAD_ID", "invocation id is missing or malformed");
  }
  if (record.phase !== "teardown-complete") {
    failed("HANDOVER_INCOMPLETE", "runner did not record complete teardown");
  }
  if (record.identityRecordedBeforeTeardown !== true) {
    failed("HANDOVER_IDENTITY_NOT_PRE_RECORDED", "runner identity was not durably recorded before cleanup");
  }
  if (typeof record.spec !== "string" || !record.spec) {
    failed("HANDOVER_BAD_SPEC", "runner spec identity is missing");
  }
  if (adapters.expectedSpec && record.spec !== adapters.expectedSpec) {
    failed("HANDOVER_WRONG_SPEC", `expected ${adapters.expectedSpec}`);
  }
  if (!isRecord(record.runner)) {
    failed("HANDOVER_BAD_RUNNER", "runner identity is missing");
  }
  if (
    !positivePid(record.runner.pid) ||
    !positivePid(record.runner.pgid) ||
    !positivePid(record.runner.sid) ||
    record.runner.pid !== record.runner.pgid ||
    record.runner.pid !== record.runner.sid ||
    typeof record.runner.startedAtUtc !== "string" ||
    !Number.isFinite(Date.parse(record.runner.startedAtUtc))
  ) {
    failed(
      "HANDOVER_BAD_RUNNER",
      "runner pid, pgid, sid, or start time is invalid for an isolated session",
    );
  }
  if (!Array.isArray(record.children)) {
    failed("HANDOVER_BAD_CHILDREN", "child process identities are missing");
  }
  const childPgids = new Set();
  for (const child of record.children) {
    if (
      !isRecord(child) ||
      typeof child.name !== "string" ||
      !child.name ||
      !positivePid(child.pid) ||
      !positivePid(child.pgid) ||
      child.stopped !== true ||
      childPgids.has(child.pgid)
    ) {
      failed("HANDOVER_BAD_CHILDREN", "a child identity or stop result is invalid");
    }
    childPgids.add(child.pgid);
  }
  if (!isRecord(record.stateDir)) {
    failed("HANDOVER_BAD_STATE_DIR", "state directory identity is missing");
  }
  const stateDir = record.stateDir.path;
  if (
    typeof stateDir !== "string" ||
    !path.isAbsolute(stateDir) ||
    path.resolve(path.dirname(stateDir)) !== stateRoot ||
    !path.basename(stateDir).startsWith("morph-e2e-") ||
    record.stateDir.removed !== true
  ) {
    failed("HANDOVER_BAD_STATE_DIR", "state directory path or cleanup result is invalid");
  }
  if (!isRecord(record.containers)) {
    failed("HANDOVER_BAD_CONTAINERS", "container identity is missing");
  }
  const prefix = record.containers.prefix;
  if (
    typeof prefix !== "string" ||
    !CONTAINER_PREFIX.test(prefix) ||
    record.containers.cleanupAttempted !== true ||
    record.containers.gone !== true
  ) {
    failed("HANDOVER_BAD_CONTAINERS", "container prefix or cleanup result is invalid");
  }
  if (!isRecord(record.machineLock)) {
    failed("HANDOVER_BAD_LOCK", "machine lock result is missing");
  }
  if (
    typeof record.machineLock.path !== "string" ||
    path.resolve(record.machineLock.path) !== expectedLockFile ||
    record.machineLock.acquired !== true ||
    record.machineLock.releaseCompleted !== true
  ) {
    failed("HANDOVER_BAD_LOCK", "runner did not acquire and release the expected machine lock");
  }

  const runnerPidState = processState(record.runner.pid);
  if (runnerPidState !== "gone") {
    failed("HANDOVER_RUNNER_ALIVE", `runner pid is ${runnerPidState}`);
  }
  const runnerGroupState = processGroupState(record.runner.pgid);
  if (runnerGroupState !== "gone") {
    failed("HANDOVER_RUNNER_GROUP_ALIVE", `runner process group is ${runnerGroupState}`);
  }
  for (const child of record.children) {
    const childPidState = processState(child.pid);
    if (childPidState !== "gone") {
      failed("HANDOVER_CHILD_ALIVE", `${child.name} pid is ${childPidState}`);
    }
    const groupState = processGroupState(child.pgid);
    if (groupState !== "gone") {
      failed("HANDOVER_CHILD_GROUP_ALIVE", `${child.name} process group is ${groupState}`);
    }
  }
  const stateDirState = pathState(stateDir);
  if (stateDirState !== "absent") {
    failed("HANDOVER_STATE_DIR_PRESENT", `state directory is ${stateDirState}`);
  }
  const containers = containersForPrefix(prefix);
  if (containers === null || containers.length !== 0) {
    failed("HANDOVER_CONTAINERS_PRESENT", "owned containers remain or Docker cannot be queried");
  }
  const lockFree = lockIsFree(expectedLockFile);
  if (lockFree !== true) {
    failed("HANDOVER_LOCK_BUSY", "expected machine lock is busy or cannot be checked");
  }
  return {
    passed: true,
    invocationId: record.invocationId,
    childCount: record.children.length,
  };
}

/** @param {number} pid */
function defaultProcessState(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH"
      ? "gone"
      : "unknown";
  }
}

/** @param {number} pgid */
function defaultProcessGroupState(pgid) {
  try {
    process.kill(-pgid, 0);
    return "alive";
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH"
      ? "gone"
      : "unknown";
  }
}

/** @param {string} target */
function defaultPathState(target) {
  try {
    lstatSync(target);
    return "present";
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT"
      ? "absent"
      : "unknown";
  }
}

/** @param {string} prefix */
function defaultContainersForPrefix(prefix) {
  const result = spawnSync(
    "docker",
    ["ps", "-aq", "--filter", `name=^${prefix}`],
    { encoding: "utf8", timeout: 5_000 },
  );
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return null;
  }
  return result.stdout.split(/\s+/).filter(Boolean);
}

/** @param {string} lockFile */
function defaultLockIsFree(lockFile) {
  try {
    if (!lstatSync(lockFile).isFile()) return null;
  } catch {
    return null;
  }
  const result = spawnSync("flock", ["--nonblock", lockFile, "true"], {
    encoding: "utf8",
    timeout: 2_000,
  });
  if (result.error || result.status === null) return null;
  return result.status === 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url))
) {
  const [recordPath, expectedSpec] = process.argv.slice(2);
  if (!recordPath) {
    console.error(
      "Usage: node scripts/check-container-run-handover.mjs <manifest.json> <expected-spec>",
    );
    process.exitCode = 1;
  } else {
    try {
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      const result = await verifyContainerRunHandover(record, {
        expectedSpec,
        expectedLockFile:
          process.env.MORPH_E2E_LOCK_FILE ?? DEFAULT_LOCK_FILE,
      });
      console.log(
        `Container handover ${result.invocationId} verified; ${result.childCount} child groups are gone and the lock is free.`,
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
    }
  }
}
