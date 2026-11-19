import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Asks the e2e runner to replace the preview sidecar it started from another
 * checkout with this checkout's (`MORPH_E2E_SIDECAR_SWAP_FROM` in
 * `scripts/run-editor-e2e.mjs`). The runner stops, tracks and starts the
 * sidecars; this only writes the request into the run's state directory and
 * reads the answer back. It never touches a process.
 *
 * The request carries the run id and nonce the runner gave only to this run,
 * and a request id of its own; the answer is taken only if it names this run
 * and this request. Anything else is an error, never a swap.
 */

/** Whether this run was started in swap mode. CI never starts one. */
export function isSidecarSwapRun(): boolean {
  return process.env.MORPH_E2E_SIDECAR_SWAP === "1";
}

export type SidecarSwapDone = {
  runId: string;
  requestId: string;
  oldPid: number;
  newPid: number;
  oldCwd: string;
  newCwd: string;
  stoppedAt: number;
  portFreeAt: number;
  readyAt: number;
};

function swapSettings() {
  const stateDir = process.env.MORPH_E2E_STATE_DIR ?? "";
  const runId = process.env.MORPH_E2E_RUN_ID ?? "";
  const nonce = process.env.MORPH_E2E_SIDECAR_SWAP_NONCE ?? "";
  const timeoutMs = Number(process.env.MORPH_E2E_SIDECAR_SWAP_TIMEOUT_MS ?? "");
  if (!isSidecarSwapRun() || !stateDir || !runId || !nonce || !(timeoutMs > 0)) {
    throw new Error(
      "SIDECAR_SWAP_UNAVAILABLE: this run was not started in swap mode by the e2e runner.",
    );
  }
  return { stateDir, runId, nonce, timeoutMs };
}

/**
 * Requests the swap and waits for its answer, a little past the runner's own
 * time limit, which the runner answers itself.
 */
export async function requestSidecarSwap(): Promise<SidecarSwapDone> {
  const { stateDir, runId, nonce, timeoutMs } = swapSettings();
  const requestId = randomUUID();
  const done = path.join(stateDir, `sidecar-swap.${requestId}.done`);
  const failed = path.join(stateDir, `sidecar-swap.${requestId}.failed`);
  if (existsSync(done) || existsSync(failed)) {
    throw new Error(`SIDECAR_SWAP_ANSWER_PRESENT: an answer for ${requestId} exists before the request.`);
  }
  const request = path.join(stateDir, "sidecar-swap.request");
  const temporary = `${request}.${requestId}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({ action: "swap-sidecar", runId, nonce, requestId }),
  );
  await rename(temporary, request);

  const deadline = Date.now() + timeoutMs + 15_000;
  while (Date.now() < deadline) {
    for (const [kind, file] of [
      ["done", done],
      ["failed", failed],
    ] as const) {
      if (!existsSync(file)) continue;
      const answer = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      if (answer.runId !== runId || answer.requestId !== requestId) {
        throw new Error(
          `SIDECAR_SWAP_FOREIGN_ANSWER: ${file} names run ${String(answer.runId)} and request ${String(answer.requestId)}.`,
        );
      }
      if (kind === "failed") {
        throw new Error(
          `SIDECAR_SWAP_FAILED: ${String(answer.reason)} ${String(answer.detail ?? "")}`,
        );
      }
      return answer as unknown as SidecarSwapDone;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`SIDECAR_SWAP_NO_ANSWER: no answer for ${requestId} within ${timeoutMs + 15_000} ms.`);
}
