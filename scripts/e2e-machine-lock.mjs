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
 * One lock for the whole machine: a fixed path under /tmp, not `os.tmpdir()`,
 * which follows TMPDIR — two sessions with different TMPDIR values would each
 * lock a file of their own and never wait for each other.
 *
 * The lock is the kernel's (`flock`), held by a small holder process that
 * watches the runner. The runner releases it last, after its own teardown has
 * stopped everything it started. If the runner is killed outright and never
 * tears down, the holder does the part that matters to the next run: it stops
 * the process groups this runner registered (`track`) — TERM, then KILL after
 * ten seconds — waits for them to go, and only then lets the lock go. It never
 * signals anything it was not given, and an unlocked run (MORPH_E2E_LOCK=0)
 * involves none of this.
 *
 * While a run waits it says who holds the slot (pid, folder, start time,
 * arguments), from a note the holder leaves beside the lock.
 *
 * `flock` is util-linux: present on Linux and WSL, absent on macOS. Without it,
 * or with MORPH_E2E_LOCK=0, the run goes ahead unlocked and says so.
 */

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const DEFAULT_LOCK_FILE =
  process.platform === "win32"
    ? path.join(tmpdir(), "morph-editor-e2e.lock")
    : "/tmp/morph-editor-e2e.lock";

/** How often the waiting run repeats who it is waiting for. */
const REMIND_MS = 60_000;
/** How long the holder gives an orphaned group to stop before KILL. */
const ORPHAN_GRACE_SECONDS = 10;

export function holderNoteFor(lockFile) {
  return `${lockFile}.holder.json`;
}

/** The process groups one run has started, for its holder to stop. */
export function groupsFileFor(lockFile, ownerPid) {
  return `${lockFile}.groups.${ownerPid}`;
}

export function flockAvailable() {
  return spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;
}

function readHolder(lockFile) {
  try {
    const note = JSON.parse(readFileSync(holderNoteFor(lockFile), "utf8"));
    return `pid ${note.pid} in ${note.cwd}, since ${note.startedAt} (${note.args})`;
  } catch {
    return "a run that left no note";
  }
}

/** A path as one single-quoted shell word. */
function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/**
 * What the holder runs while it holds the lock: wait for the owner to go,
 * then stop what the owner registered and did not get to stop itself.
 */
function holderScript(ownerPid, groupsFile, noteFile) {
  const groups = shellQuote(groupsFile);
  const note = shellQuote(noteFile);
  return [
    "echo acquired",
    `while kill -0 ${ownerPid} 2>/dev/null; do sleep 1; done`,
    `if [ -f ${groups} ]; then`,
    `  for g in $(cat ${groups}); do kill -TERM -"$g" 2>/dev/null; done`,
    "  i=0",
    `  while [ $i -lt ${ORPHAN_GRACE_SECONDS} ]; do`,
    "    alive=0",
    `    for g in $(cat ${groups}); do kill -0 -"$g" 2>/dev/null && alive=1; done`,
    '    [ "$alive" = 0 ] && break',
    "    sleep 1; i=$((i+1))",
    "  done",
    `  for g in $(cat ${groups}); do kill -KILL -"$g" 2>/dev/null; done`,
    `  while :; do alive=0; for g in $(cat ${groups}); do kill -0 -"$g" 2>/dev/null && alive=1; done; [ "$alive" = 0 ] && break; sleep 1; done`,
    `  rm -f ${groups}`,
    "fi",
    `grep -q '"pid":${ownerPid},' ${note} 2>/dev/null && rm -f ${note}`,
  ].join("\n");
}

/**
 * The machine's E2E slot, for one run: `acquire` waits for it and holds it
 * until `release`, or until this process is gone. `track` registers a process
 * group this run started, for the holder to stop should the run die without
 * tearing down. `release` is safe to call at any point, waiting or not, and
 * more than once.
 *
 * @param {{ lockFile: string, log: (message: string) => void, args: string,
 *   ownerPid?: number }} options
 */
export function createMachineLock(options) {
  const ownerPid = options.ownerPid ?? process.pid;
  const groupsFile = groupsFileFor(options.lockFile, ownerPid);
  /** @type {import("node:child_process").ChildProcess | null} */
  let holder = null;
  let held = false;

  function stopHolder() {
    const child = holder;
    holder = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve();
    }
    // Referenced again: it was unref'd once it held the slot, and waiting on
    // an unref'd child lets the process end before it does.
    child.ref();
    const gone = new Promise((resolve) => child.once("exit", resolve));
    try {
      // Its own group: flock and the shell it runs, nothing else.
      process.kill(-(/** @type {number} */ (child.pid)), "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    return gone;
  }

  return {
    /** @returns {Promise<void>} */
    acquire() {
      rmSync(groupsFile, { force: true });
      const child = spawn(
        "flock",
        [options.lockFile, "sh", "-c", holderScript(ownerPid, groupsFile, holderNoteFor(options.lockFile))],
        { stdio: ["ignore", "pipe", "inherit"], detached: true },
      );
      holder = child;
      return new Promise((resolve, reject) => {
        let reminder = /** @type {NodeJS.Timeout | null} */ (null);
        const waiting = setTimeout(() => {
          options.log(`waiting for the machine's E2E slot, held by ${readHolder(options.lockFile)}`);
          reminder = setInterval(
            () => options.log(`still waiting for the E2E slot, held by ${readHolder(options.lockFile)}`),
            REMIND_MS,
          );
        }, 500);
        const done = () => {
          clearTimeout(waiting);
          if (reminder) clearInterval(reminder);
        };
        /** @type {import("node:stream").Readable} */ (child.stdout).on("data", (chunk) => {
          if (held || !String(chunk).includes("acquired")) return;
          held = true;
          done();
          writeFileSync(
            holderNoteFor(options.lockFile),
            JSON.stringify({
              pid: ownerPid,
              cwd: process.cwd(),
              startedAt: new Date().toISOString(),
              args: options.args,
            }),
          );
          // Held by the child from here; this process may exit without
          // waiting on it, and the child follows once it has cleaned up.
          child.unref();
          /** @type {import("node:stream").Readable} */ (child.stdout).destroy();
          resolve();
        });
        child.once("exit", (code, signal) => {
          if (held) return;
          done();
          reject(new Error(`E2E_LOCK_FAILED: flock ended (${signal ?? code}) before the slot was free.`));
        });
        child.once("error", (error) => {
          done();
          reject(error);
        });
      });
    },

    /** @param {number | undefined} pgid */
    track(pgid) {
      if (!held || !pgid) return;
      appendFileSync(groupsFile, `${pgid}\n`);
    },

    async release() {
      if (held) {
        held = false;
        // The run tore down what it started; nothing is left for the holder.
        rmSync(groupsFile, { force: true });
        try {
          const note = JSON.parse(readFileSync(holderNoteFor(options.lockFile), "utf8"));
          if (note.pid === ownerPid) rmSync(holderNoteFor(options.lockFile), { force: true });
        } catch {
          // No note, or another run's: leave it.
        }
      }
      await stopHolder();
    },
  };
}
