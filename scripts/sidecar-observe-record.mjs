/**
 * What an e2e run keeps of its preview sidecar: the sidecar's own output, and
 * when its process started, began listening and ended.
 *
 * Kept beside the run's report, which CI uploads whether the run passed or
 * not, because the job log alone did not answer the question one failure
 * asked: a Worker request to the sidecar was lost ("Network connection lost")
 * and nothing recorded whether the process was still there or what it saw.
 *
 * Observation only. Nothing here touches the sidecar, its requests or the
 * run's result; a file that cannot be written is reported and skipped.
 *
 * What is removed before a line is kept: the sidecar token and any other
 * secret the caller names, cookie header values, and auth cookie values. The
 * sidecar's own `[sidecar-observe]` lines carry no header, body or token to
 * begin with (`local-preview-sidecar-observe.ts`). Everything else is the same
 * text the job log already shows.
 */
import { appendFileSync, writeFileSync } from "node:fs";

const REDACTED = "[REDACTED]";

/** A line with the named secrets, cookie headers and auth cookies removed. */
export function redactSidecarLine(line, secrets = []) {
  let out = line;
  for (const secret of secrets) {
    // Too short to be a secret, and too short to replace without mangling
    // the line around it.
    if (typeof secret !== "string" || secret.length < 8) continue;
    out = out.split(secret).join(REDACTED);
  }
  return out
    .replace(/(\b(?:set-)?cookie["']?\s*[:=]\s*)[^\r\n]*/gi, `$1${REDACTED}`)
    .replace(/(\bbetter-auth\.[\w.-]+=)[^;\s"']+/gi, `$1${REDACTED}`);
}

/**
 * Writes the sidecar's lines to `logFile` and its process record to
 * `processFile` as they happen, synchronously, so a run that dies keeps what
 * it had.
 */
export function createSidecarRecorder({
  logFile,
  processFile,
  secrets = [],
  now = () => new Date(),
  warn = (message) => console.error(message),
}) {
  const record = {
    pid: null,
    startedAt: null,
    listeningAt: null,
    exitedAt: null,
    code: null,
    signal: null,
    stoppedByRunner: null,
  };
  let logBroken = false;
  let recordBroken = false;

  const save = () => {
    if (recordBroken) return;
    try {
      writeFileSync(processFile, `${JSON.stringify(record, null, 2)}\n`);
    } catch (error) {
      recordBroken = true;
      warn(`[e2e] could not write ${processFile}: ${error.message}`);
    }
  };

  return {
    record,
    started(pid) {
      record.pid = pid ?? null;
      record.startedAt = now().toISOString();
      save();
    },
    line(text, stream) {
      if (
        record.listeningAt === null &&
        text.includes("morph local preview sidecar listening on")
      ) {
        record.listeningAt = now().toISOString();
        save();
      }
      if (logBroken) return;
      try {
        appendFileSync(
          logFile,
          `${now().toISOString()} ${stream} ${redactSidecarLine(text, secrets)}\n`,
        );
      } catch (error) {
        logBroken = true;
        warn(`[e2e] could not write ${logFile}: ${error.message}`);
      }
    },
    exited(code, signal, stoppedByRunner) {
      record.exitedAt = now().toISOString();
      record.code = code ?? null;
      record.signal = signal ?? null;
      record.stoppedByRunner = Boolean(stoppedByRunner);
      save();
    },
  };
}
