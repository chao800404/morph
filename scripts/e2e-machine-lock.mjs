// @ts-check
/**
 * One editor E2E run per machine at a time.
 *
 * Runs on one machine share its ports, its containers and its CPU. Two at once
 * mostly fail before a test starts (sign-in or the transport precondition
 * timing out under load), which costs a full run and reads like a broken
 * test. Every session used to check "is anything running?" by hand and start
 * when the answer was no, so two that checked together started together.
 *
 * So the runner takes a machine-wide lock before it touches anything shared,
 * and waits for it. This is mutual exclusion only: of several runs waiting,
 * which goes next is not defined (flock does not queue in order).
 *
 * One lock for the whole machine (one WSL distribution): a fixed path under
 * /tmp, not `os.tmpdir()`, which follows TMPDIR — two sessions with different
 * TMPDIR values would each lock a file of their own.
 *
 * Who holds it. The lock is the kernel's (`flock`) and belongs to an open file
 * description, not to a process: it lasts until every descriptor for it is
 * closed. The runner opens the lock file and keeps that descriptor for its
 * whole life; `flock` takes the lock on it and exits. A guardian process
 * shares the same description. So the lock is released only when both the
 * runner and the guardian are gone:
 *
 * - Killing the guardian, or anything else, while the runner runs does not
 *   release it — the runner's own descriptor still holds it.
 * - Killing the runner outright leaves the guardian holding it. The guardian
 *   stops the process groups the runner registered (`track`) — TERM, then
 *   KILL after ten seconds — and waits until they are gone; then removes the
 *   containers named with the runner's registered prefix (`trackContainers`)
 *   until Docker reports none. Only then does it exit and let the lock go. It
 *   never signals or removes anything it was not given, and while Docker
 *   cannot be asked it keeps the lock and asks again.
 * - A normal or interrupted run stops its children itself, then `release`
 *   ends the guardian and closes the descriptor. A run that could not confirm
 *   its own containers are gone releases with `handOver`: the guardian keeps
 *   the lock and finishes that cleanup once the run has exited.
 *
 * While a run waits it says who holds the slot (pid, folder, start time,
 * arguments), from a note beside the lock.
 *
 * `flock` is util-linux: present on Linux and WSL, absent on macOS. Without it,
 * or with MORPH_E2E_LOCK=0, the run goes ahead unlocked and says so.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const DEFAULT_LOCK_FILE =
  process.platform === "win32"
    ? path.join(tmpdir(), "morph-editor-e2e.lock")
    : "/tmp/morph-editor-e2e.lock";

/** How often the waiting run repeats who it is waiting for. */
const REMIND_MS = 60_000;
/** How long the guardian gives an orphaned group to stop before KILL. */
const ORPHAN_GRACE_SECONDS = 10;

export function holderNoteFor(lockFile) {
  return `${lockFile}.holder.json`;
}

/** The process groups one run has started, for its guardian to stop. */
export function groupsFileFor(lockFile, ownerPid) {
  return `${lockFile}.groups.${ownerPid}`;
}

/** The container name prefix one run's containers carry, for its guardian. */
export function containersFileFor(lockFile, ownerPid) {
  return `${lockFile}.containers.${ownerPid}`;
}

/**
 * What the slot's holder is doing while it cleans up, for a waiting run to
 * show: stopping processes, removing containers, or Docker not answering.
 */
export function statusFileFor(lockFile) {
  return `${lockFile}.status`;
}

/**
 * Exactly the prefix a run's worker name gives its containers, and nothing
 * looser: a fixed-length id ends at the `-`, so one run's prefix can never be
 * the start of another's, and there is nothing in it a shell or a regex reads.
 */
const CONTAINER_PREFIX = /^workerd-morph-e2e-[0-9a-f]{12}-$/;

export function flockAvailable() {
  return spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;
}

function readHolder(lockFile) {
  let holder = "a run that left no note";
  try {
    const note = JSON.parse(readFileSync(holderNoteFor(lockFile), "utf8"));
    holder = `pid ${note.pid} in ${note.cwd}, since ${note.startedAt} (${note.args})`;
  } catch {
    // No note: say so.
  }
  try {
    const status = readFileSync(statusFileFor(lockFile), "utf8").trim();
    if (status) return `${holder}; ${status}`;
  } catch {
    // No status: the holder is running, not cleaning up.
  }
  return holder;
}

/** A path as one single-quoted shell word. */
function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/**
 * What the guardian runs, holding the lock's description on fd 3: wait for
 * the owner to go, then stop what the owner registered and did not get to
 * stop itself — its process groups first (so nothing starts another
 * container), then the containers named with its prefix. Its own children
 * run with fd 3 closed, so nothing but the guardian itself keeps the lock.
 *
 * Containers: removed until `docker ps` reports none with the prefix. If
 * Docker cannot be asked, the guardian keeps the lock and asks again: an
 * unconfirmed cleanup is not a finished one.
 */
function guardianScript(ownerPid, groupsFile, containersFile, noteFile, statusFile) {
  const groups = shellQuote(groupsFile);
  const containers = shellQuote(containersFile);
  const note = shellQuote(noteFile);
  const status = shellQuote(statusFile);
  const nap = "sleep 1 3>&-";
  const say = (text) => `echo "cleaning up after pid ${ownerPid}, which has gone: ${text}" > ${status}`;
  return [
    `while kill -0 ${ownerPid} 2>/dev/null; do ${nap}; done`,
    `if [ -f ${groups} ]; then`,
    `  ${say("stopping its processes")}`,
    `  for g in $(cat ${groups}); do kill -TERM -"$g" 2>/dev/null; done`,
    "  i=0",
    `  while [ $i -lt ${ORPHAN_GRACE_SECONDS} ]; do`,
    "    alive=0",
    `    for g in $(cat ${groups}); do kill -0 -"$g" 2>/dev/null && alive=1; done`,
    '    [ "$alive" = 0 ] && break',
    `    ${nap}; i=$((i+1))`,
    "  done",
    `  for g in $(cat ${groups}); do kill -KILL -"$g" 2>/dev/null; done`,
    `  while :; do alive=0; for g in $(cat ${groups}); do kill -0 -"$g" 2>/dev/null && alive=1; done; [ "$alive" = 0 ] && break; ${nap}; done`,
    `  rm -f ${groups}`,
    "fi",
    `if [ -f ${containers} ]; then`,
    `  p=$(cat ${containers})`,
    `  ${say("removing its containers ($p*)")}`,
    "  while :; do",
    `    ids=$(docker ps -aq --filter "name=^$p" 3>&-) || { grep -q "Docker cannot" ${status} 2>/dev/null || ${say("Docker cannot be reached since $(date +%H:%M:%S); its containers ($p*) are unconfirmed, asking again")}; sleep 5 3>&-; continue; }`,
    `    ${say("removing its containers ($p*)")}`,
    '    [ -z "$ids" ] && break',
    "    docker rm -f $ids >/dev/null 2>&1 3>&-",
    `    ${nap}`,
    "  done",
    `  rm -f ${containers}`,
    "fi",
    `rm -f ${status}`,
    `grep -q '"pid":${ownerPid},' ${note} 2>/dev/null && rm -f ${note}`,
  ].join("\n");
}

/**
 * The machine's E2E slot, for one run: `acquire` waits for it and holds it
 * until `release`, or until this process is gone and its registered groups
 * have been stopped. `track` registers a process group this run started.
 * `release` is safe to call at any point, waiting or not, and more than once.
 *
 * @param {{ lockFile: string, log: (message: string) => void, args: string,
 *   ownerPid?: number, remindMs?: number }} options
 */
export function createMachineLock(options) {
  const ownerPid = options.ownerPid ?? process.pid;
  const groupsFile = groupsFileFor(options.lockFile, ownerPid);
  const containersFile = containersFileFor(options.lockFile, ownerPid);
  /** The lock's open file description, held for the run's whole life. */
  let fd = /** @type {number | null} */ (null);
  /** @type {import("node:child_process").ChildProcess | null} */
  let waiter = null;
  /** @type {import("node:child_process").ChildProcess | null} */
  let guardian = null;
  let held = false;

  /** Closes the lock's descriptor once, whichever path gets here first. */
  function closeFd() {
    const open = fd;
    fd = null;
    if (open !== null) closeSync(open);
  }

  /** @param {import("node:child_process").ChildProcess | null} child */
  function stopGroup(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve();
    }
    // Referenced again: an unref'd child lets the process end before it does.
    child.ref();
    const gone = new Promise((resolve) => child.once("exit", resolve));
    try {
      process.kill(-(/** @type {number} */ (child.pid)), "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    return gone;
  }

  return {
    /** @returns {Promise<void>} */
    async acquire() {
      rmSync(groupsFile, { force: true });
      rmSync(containersFile, { force: true });
      fd = openSync(options.lockFile, "a");
      // `flock 3` locks the description on its fd 3 — ours — and exits once
      // it has it; the lock then stays with the description.
      const child = spawn("flock", ["3"], {
        stdio: ["ignore", "ignore", "inherit", fd],
        detached: true,
      });
      waiter = child;
      await new Promise((resolve, reject) => {
        let reminder = /** @type {NodeJS.Timeout | null} */ (null);
        const waiting = setTimeout(() => {
          options.log(`waiting for the machine's E2E slot, held by ${readHolder(options.lockFile)}`);
          reminder = setInterval(
            () => options.log(`still waiting for the E2E slot, held by ${readHolder(options.lockFile)}`),
            options.remindMs ?? REMIND_MS,
          );
        }, 500);
        child.once("exit", (code, signal) => {
          clearTimeout(waiting);
          if (reminder) clearInterval(reminder);
          waiter = null;
          if (code === 0) resolve(undefined);
          else reject(new Error(`E2E_LOCK_FAILED: flock ended (${signal ?? code}) before the slot was free.`));
        });
        child.once("error", (error) => {
          clearTimeout(waiting);
          if (reminder) clearInterval(reminder);
          reject(error);
        });
      }).catch((error) => {
        closeFd();
        throw error;
      });
      held = true;
      // A guardian killed mid-cleanup can leave its status; it is not ours.
      rmSync(statusFileFor(options.lockFile), { force: true });
      writeFileSync(
        holderNoteFor(options.lockFile),
        JSON.stringify({
          pid: ownerPid,
          cwd: process.cwd(),
          startedAt: new Date().toISOString(),
          args: options.args,
        }),
      );
      guardian = spawn(
        "sh",
        [
          "-c",
          guardianScript(
            ownerPid,
            groupsFile,
            containersFile,
            holderNoteFor(options.lockFile),
            statusFileFor(options.lockFile),
          ),
        ],
        { stdio: ["ignore", "ignore", "inherit", fd], detached: true },
      );
      // It outlives this process by design; nothing here waits on it.
      guardian.unref();
    },

    /** @param {number | undefined} pgid */
    track(pgid) {
      if (!held || !pgid) return;
      appendFileSync(groupsFile, `${pgid}\n`);
    },

    /**
     * Registers the name prefix this run's containers carry. The run chose
     * it, so a container with it is this run's and no one else's.
     * @param {string} prefix
     */
    trackContainers(prefix) {
      if (!CONTAINER_PREFIX.test(prefix)) {
        throw new Error(`E2E_LOCK_BAD_CONTAINER_PREFIX: ${prefix}`);
      }
      if (held) writeFileSync(containersFile, prefix);
    },

    /**
     * Gives the slot up. With `handOver`, the run could not confirm its own
     * cleanup (its containers did not go): the guardian keeps the slot and
     * finishes the job once this process has exited, rather than this run
     * letting the next one in beside what it left.
     * @param {{ handOver?: boolean }} [how]
     */
    async release(how = {}) {
      // A wait still in progress: stop it, so it never takes the slot later.
      await stopGroup(waiter);
      waiter = null;
      if (held && how.handOver && guardian) {
        held = false;
        guardian = null;
        closeFd();
        return;
      }
      rmSync(containersFile, { force: true });
      if (held) {
        held = false;
        // The run tore down what it started; nothing is left for the guardian.
        rmSync(groupsFile, { force: true });
        try {
          const note = JSON.parse(readFileSync(holderNoteFor(options.lockFile), "utf8"));
          if (note.pid === ownerPid) rmSync(holderNoteFor(options.lockFile), { force: true });
        } catch {
          // No note, or another run's: leave it.
        }
      }
      await stopGroup(guardian);
      guardian = null;
      closeFd();
    },
  };
}
