/**
 * The machine's E2E slot (`e2e-machine-lock.mjs`), with real `flock` and real
 * processes, on a lock file of its own so it never touches a real run's slot.
 *
 * Skipped where `flock` does not exist (macOS); the runner then goes ahead
 * unlocked and says so.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createMachineLock, flockAvailable, holderNoteFor } from "./e2e-machine-lock.mjs";

const MODULE = fileURLToPath(new URL("./e2e-machine-lock.mjs", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the machine's E2E slot", { skip: !flockAvailable() && "no flock here" }, () => {
  let dir = "";
  let lockFile = "";
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "e2e-lock-test-"));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  let n = 0;
  const freshLock = () => path.join(dir, `slot-${n++}.lock`);

  it("lets a second run in only after the first releases, and says who it waits for", async () => {
    lockFile = freshLock();
    const first = createMachineLock({ lockFile, log: () => {}, args: "first.spec.ts" });
    await first.acquire();
    const note = JSON.parse(await readFile(holderNoteFor(lockFile), "utf8"));
    assert.equal(note.pid, process.pid);
    assert.equal(note.args, "first.spec.ts");

    const lines = [];
    const second = createMachineLock({ lockFile, log: (line) => lines.push(line), args: "second" });
    let secondHeld = false;
    const waiting = second.acquire().then(() => (secondHeld = true));
    await sleep(1500);
    assert.equal(secondHeld, false, "the second run must wait while the first holds the slot");
    assert.match(lines.join("\n"), /waiting for the machine's E2E slot, held by pid \d+ in .* \(first\.spec\.ts\)/);

    await first.release();
    await waiting;
    assert.equal(secondHeld, true);
    await second.release();
    assert.equal(existsSync(holderNoteFor(lockFile)), false, "the holder's note goes with it");
  });

  it("frees the slot by itself when its run is killed outright", async () => {
    lockFile = freshLock();
    // A separate process takes the slot and is then SIGKILLed: no release, no
    // cleanup, as when a session's runner is killed.
    const owner = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { createMachineLock } from ${JSON.stringify(MODULE)};
         const lock = createMachineLock({ lockFile: ${JSON.stringify(lockFile)}, log: () => {}, args: "doomed" });
         await lock.acquire();
         console.log("HELD");
         setInterval(() => {}, 1000);`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise((resolve) => owner.stdout.on("data", (d) => String(d).includes("HELD") && resolve()));
    owner.kill("SIGKILL");

    const next = createMachineLock({ lockFile, log: () => {}, args: "next" });
    const started = Date.now();
    await next.acquire();
    const waited = Date.now() - started;
    await next.release();
    assert.ok(waited < 5000, `the slot came free ${waited} ms after its run died`);
  });

  it("stops waiting when released before it got the slot", async () => {
    lockFile = freshLock();
    const holding = createMachineLock({ lockFile, log: () => {}, args: "holding" });
    await holding.acquire();
    const waiter = createMachineLock({ lockFile, log: () => {}, args: "waiter" });
    const outcome = waiter.acquire().then(
      () => "acquired",
      (error) => error.message,
    );
    await sleep(300);
    // An interrupted run releases while still waiting: the wait ends, and it
    // must not take the slot later behind everyone's back.
    await waiter.release();
    assert.match(await outcome, /E2E_LOCK_FAILED/);
    await holding.release();

    const after = createMachineLock({ lockFile, log: () => {}, args: "after" });
    await after.acquire();
    await after.release();
  });

  it("is one lock for the whole machine, whatever TMPDIR or folder a session has", async () => {
    const paths = await Promise.all(
      [
        { cwd: dir, TMPDIR: path.join(dir, "elsewhere") },
        { cwd: tmpdir(), TMPDIR: "/var/tmp" },
      ].map(
        ({ cwd, TMPDIR }) =>
          new Promise((resolve) => {
            const child = spawn(
              process.execPath,
              ["--input-type=module", "-e", `import { DEFAULT_LOCK_FILE } from ${JSON.stringify(MODULE)}; console.log(DEFAULT_LOCK_FILE);`],
              { cwd, env: { ...process.env, TMPDIR }, stdio: ["ignore", "pipe", "inherit"] },
            );
            let out = "";
            child.stdout.on("data", (d) => (out += d));
            child.on("close", () => resolve(out.trim()));
          }),
      ),
    );
    assert.deepEqual(paths, ["/tmp/morph-editor-e2e.lock", "/tmp/morph-editor-e2e.lock"]);
  });

  it("stops a killed run's process groups before letting the next run in", async () => {
    lockFile = freshLock();
    // The owner starts a group that ignores TERM, as a dev server mid-build
    // may, registers it, and is then SIGKILLed: no teardown at all.
    const owner = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { spawn } from "node:child_process";
         import { createMachineLock } from ${JSON.stringify(MODULE)};
         const lock = createMachineLock({ lockFile: ${JSON.stringify(lockFile)}, log: () => {}, args: "doomed" });
         await lock.acquire();
         const child = spawn("sh", ["-c", "trap '' TERM; sleep 300"], { detached: true, stdio: "ignore" });
         lock.track(child.pid);
         console.log("CHILD " + child.pid);
         setInterval(() => {}, 1000);`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const childPid = await new Promise((resolve) =>
      owner.stdout.on("data", (d) => {
        const match = /CHILD (\d+)/.exec(String(d));
        if (match) resolve(Number(match[1]));
      }),
    );
    const groupAlive = () => {
      try {
        process.kill(-childPid, 0);
        return true;
      } catch {
        return false;
      }
    };
    assert.equal(groupAlive(), true);
    owner.kill("SIGKILL");

    const next = createMachineLock({ lockFile, log: () => {}, args: "next" });
    const started = Date.now();
    await next.acquire();
    const waited = Date.now() - started;
    // Not before the orphan was gone: it ignored TERM, so this took the grace
    // period and a KILL.
    assert.equal(groupAlive(), false, "the killed run's group must be gone before the next run gets the slot");
    assert.ok(waited >= 9000, `the next run got in after ${waited} ms, before the grace period ran out`);
    await next.release();
  });

  it("is safe to release twice, or without ever acquiring", async () => {
    lockFile = freshLock();
    const lock = createMachineLock({ lockFile, log: () => {}, args: "x" });
    await lock.release();
    await lock.acquire();
    await lock.release();
    await lock.release();
  });
});
