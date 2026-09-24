import { planFencedWrite, type FencedFile } from "./preview-write-fence";

/**
 * The write fence, run inside the preview container.
 *
 * The comparison, the write and the ledger update have to be one step on the
 * container's side: done from the Worker as separate calls, another request
 * could still land between them. So the Worker hands the container a request
 * and one small script that takes a lock, applies `planFencedWrite` — its own
 * source, verbatim — and releases it.
 *
 * The ledger and the lock live in `/tmp`: outside `/workspace`, so neither is
 * watched by Vite nor mistaken for an unplanned Theme file. A container that
 * restarts loses both along with its workspace, which the next start lays out
 * and seeds again.
 */

export const PREVIEW_FENCE_LEDGER_PATH = "/tmp/morph-preview-fences.json";
const PREVIEW_FENCE_LOCK_PATH = "/tmp/morph-preview-fences.lock";
const PREVIEW_FENCE_SCRIPT_PREFIX = "/tmp/morph-preview-fence-";

export type FencedWriteRequest =
  | Readonly<{
      op: "write";
      /** Directory the paths are relative to. */
      root: string;
      files: readonly FencedFile[];
      /** Written before the first changed file, as the unfenced path did. */
      marker?: Readonly<{ path: string; content: string }>;
    }>
  | Readonly<{
      /**
       * Raises the ledger to at least these versions — what a start has just
       * laid out. Merged, never replaced: a save that synced while the start
       * was running may already have recorded a newer version.
       */
      op: "seed";
      versions: Readonly<Record<string, number>>;
    }>;

export type FencedWriteResult = Readonly<{
  refused: string[];
  changed: string[];
  unchanged: string[];
}>;

/**
 * The script the container runs. Self-contained; Node's stdlib only. The
 * ledger and lock paths are fixed in production and only moved by tests.
 */
export function fencedWriteScriptSource(
  paths: Readonly<{ ledger: string; lock: string }> = {
    ledger: PREVIEW_FENCE_LEDGER_PATH,
    lock: PREVIEW_FENCE_LOCK_PATH,
  },
): string {
  return `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const planFencedWrite = ${planFencedWrite.toString()};
const LEDGER = ${JSON.stringify(paths.ledger)};
const LOCK = ${JSON.stringify(paths.lock)};
const requestPath = process.argv[2];
const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const deadline = Date.now() + 15000;
for (;;) {
  try { fs.mkdirSync(LOCK); break; } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      // A holder that died leaves its lock; one this old is not being held.
      if (Date.now() - fs.statSync(LOCK).mtimeMs > 30000) { fs.rmdirSync(LOCK); continue; }
    } catch {}
    if (Date.now() > deadline) { process.stderr.write("PREVIEW_FENCE_LOCK_TIMEOUT"); process.exit(3); }
    pause(20);
  }
}

let result;
try {
  let ledger = {};
  try { ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8")); } catch {}
  if (request.op === "seed") {
    for (const [file, version] of Object.entries(request.versions)) {
      if (typeof ledger[file] !== "number" || ledger[file] < version) ledger[file] = version;
    }
    fs.writeFileSync(LEDGER, JSON.stringify(ledger));
    result = { refused: [], changed: [], unchanged: [] };
  } else {
    const root = path.resolve(request.root);
    const target = (file) => {
      const resolved = path.resolve(root, file);
      if (!resolved.startsWith(root + path.sep)) throw new Error("PREVIEW_FENCE_PATH_ESCAPE: " + file);
      return resolved;
    };
    const current = {};
    for (const file of request.files) {
      try { current[file.path] = fs.readFileSync(target(file.path), "utf8"); } catch { current[file.path] = null; }
    }
    const plan = planFencedWrite(ledger, request.files, current);
    if (plan.refused.length === 0) {
      if (plan.writes.length > 0 && request.marker) fs.writeFileSync(request.marker.path, request.marker.content);
      for (const file of plan.writes) {
        const destination = target(file.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, file.content);
      }
      fs.writeFileSync(LEDGER, JSON.stringify(plan.ledger));
    }
    result = { refused: plan.refused, changed: plan.writes.map((file) => file.path), unchanged: plan.unchanged };
  }
} finally {
  fs.rmdirSync(LOCK);
  try { fs.unlinkSync(requestPath); } catch {}
  try { fs.unlinkSync(__filename); } catch {}
}
process.stdout.write(JSON.stringify(result));
`;
}

export type FenceSandbox = {
  writeFile(path: string, content: string): Promise<unknown>;
  exec(command: string): Promise<{
    success: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
};

/** Runs one fenced request in the container and reads back what it did. */
export async function runFencedWriteInSandbox(
  sandbox: FenceSandbox,
  request: FencedWriteRequest,
): Promise<FencedWriteResult> {
  // One script per request, not one shared path: a request rewriting the
  // shared file could hand a concurrent one half a script to run.
  const id = crypto.randomUUID();
  const scriptPath = `${PREVIEW_FENCE_SCRIPT_PREFIX}${id}.cjs`;
  const requestPath = `${PREVIEW_FENCE_SCRIPT_PREFIX}${id}.json`;
  await sandbox.writeFile(scriptPath, fencedWriteScriptSource());
  await sandbox.writeFile(requestPath, JSON.stringify(request));
  const run = await sandbox.exec(`node ${scriptPath} ${requestPath}`);
  if (!run.success) {
    throw new Error(
      `PREVIEW_FENCE_FAILED: ${run.stderr.trim().slice(0, 300) || `exit ${run.exitCode}`}`,
    );
  }
  const parsed = JSON.parse(run.stdout) as FencedWriteResult;
  return {
    refused: [...parsed.refused],
    changed: [...parsed.changed],
    unchanged: [...parsed.unchanged],
  };
}
