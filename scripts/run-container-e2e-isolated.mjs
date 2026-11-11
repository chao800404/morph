// @ts-check
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  processGroupIdFromStat,
  processSessionIdFromStat,
} from "./container-run-handover.mjs";

const [runnerScript, ...runnerArgs] = process.argv.slice(2);
if (!runnerScript) {
  console.error(
    "Usage: node scripts/run-container-e2e-isolated.mjs <runner-script> [...runner-args]",
  );
  process.exitCode = 2;
} else {
  const child = spawn(
    "setsid",
    ["--wait", process.execPath, runnerScript, ...runnerArgs],
    { stdio: "inherit", env: process.env },
  );
  let settled = false;
  let identityValid = false;
  let terminateTimer;

  const childExit = new Promise((resolve) => {
    child.once("error", (error) => {
      settled = true;
      console.error(
        `[container-runner] could not start setsid: ${error instanceof Error ? error.message : error}`,
      );
      resolve({ code: 127, signal: null });
    });
    child.once("exit", (code, signal) => {
      settled = true;
      if (terminateTimer) clearTimeout(terminateTimer);
      resolve({ code, signal });
    });
  });

  function forwardSignal(signal) {
    if (!child.pid || settled) return;
    let forwarded = false;
    try {
      process.kill(-child.pid, signal);
      forwarded = true;
    } catch {
      // Cancellation can arrive between fork and setsid. In that short window
      // signal the exact child; after isolation the negative pid targets only
      // the runner's new process group.
      try {
        process.kill(child.pid, signal);
        forwarded = true;
      } catch {
        // The child may have exited while the signal was being delivered.
      }
    }
    if (forwarded) {
      console.error(
        `[container-runner] forwarded ${signal} to runner pid ${child.pid}`,
      );
    }
    if (signal === "SIGTERM" && !terminateTimer) {
      terminateTimer = setTimeout(() => {
        if (settled || !child.pid) return;
        console.error(
          `[container-runner] runner did not exit after SIGTERM; killing runner group ${child.pid}`,
        );
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            process.kill(child.pid, "SIGKILL");
          } catch {
            // The process group may have completed during escalation.
          }
        }
      }, 1_800);
      terminateTimer.unref();
    }
  }

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  async function recordRunnerIdentity() {
    if (!child.pid) return false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !settled) {
      try {
        const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8");
        const pgid = processGroupIdFromStat(stat);
        const sid = processSessionIdFromStat(stat);
        const command = readFileSync(`/proc/${child.pid}/comm`, "utf8").trim();
        if (
          command === path.basename(process.execPath) &&
          pgid === child.pid &&
          sid === child.pid
        ) {
          const ps = spawnSync(
            "ps",
            ["-o", "pid,pgid,sid,comm", "-p", String(child.pid)],
            { encoding: "utf8", timeout: 2_000 },
          );
          if (ps.error || ps.status !== 0 || !ps.stdout) return false;
          console.log("RUNNER_PROCESS_IDENTITY");
          console.log(`ps -o pid,pgid,sid,comm -p ${child.pid}`);
          process.stdout.write(ps.stdout);
          identityValid = true;
          return true;
        }
      } catch {
        // The setsid process may not have exec'd node yet. Keep polling its pid.
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  }

  const identityRecorded = await recordRunnerIdentity();
  if (!identityRecorded && !settled) {
    console.error(
      "[container-runner] runner did not enter a session with pid=pgid=sid",
    );
    forwardSignal("SIGTERM");
  }

  const { code, signal } = await childExit;
  if (!identityRecorded || !identityValid) {
    process.exitCode = code === 0 ? 1 : (code ?? 1);
  } else if (code !== null) {
    process.exitCode = code;
  } else {
    process.exitCode =
      signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
  }
}
