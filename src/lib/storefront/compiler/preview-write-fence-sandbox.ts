import {
  planFencedStart,
  planFencedWrite,
  type FencedFile,
} from "./preview-write-fence";

/**
 * The write fence, run inside the preview container.
 *
 * The comparison, the write and the ledger update have to be one step on the
 * container's side: done from the Worker as separate calls, another request
 * could still land between them. So the Worker hands the container a request
 * and one small script that takes a lock, applies the request — its own
 * source, verbatim — and releases it.
 *
 * Every writer of the workspace goes through the same lock: a sync's files,
 * and a start's. A start is too large to send as one request, so it writes
 * its files to a staging directory first, without the lock, and then asks
 * the container to judge and apply them in one step (`op: "start"`). Held
 * that way, the lock covers only moves on the container's own disk, and a
 * start refused as stale leaves the workspace exactly as it was.
 *
 * The lock lives in the container, so it orders requests from any Worker
 * instance; a queue in one process could not.
 *
 * The ledger, the lock and the staging directories live in `/tmp`: outside
 * `/workspace`, so none is watched by Vite nor mistaken for an unplanned
 * Theme file. A container that restarts loses them along with its
 * workspace, which the next start lays out and records again.
 */

export const PREVIEW_FENCE_LEDGER_PATH = "/tmp/morph-preview-fences.json";
const PREVIEW_FENCE_LOCK_PATH = "/tmp/morph-preview-fences.lock";
const PREVIEW_FENCE_SCRIPT_PREFIX = "/tmp/morph-preview-fence-";
/** Where a start stages its files before asking for them to be applied. */
export const PREVIEW_START_STAGING_PREFIX = "/tmp/morph-preview-start-";

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
       * Applies a start: refused whole if any of `versions` is older than
       * what the ledger holds; otherwise the files named in `prune` are
       * removed, the staged `files` moved into `root`, the versions recorded,
       * and — only if no other writer has marked the workspace since the
       * start read it — the manifest and then the marker are committed.
       */
      op: "start";
      root: string;
      /** Directory holding `files` at the same relative paths; removed after. */
      staging: string | null;
      /** Staged paths, relative to both `staging` and `root`. */
      files: readonly string[];
      /** Paths relative to `root` the plan no longer has. */
      prune: readonly string[];
      /** The version each Theme file was laid out from. */
      versions: Readonly<Record<string, number>>;
      marker: Readonly<{
        path: string;
        /** Set before anything changes, so a start stopped halfway is not trusted. */
        dirty: string;
        /** What this start read; committing requires that it still stands. */
        expected: string | null;
      }>;
      /** What to commit once the files are in place; null commits nothing. */
      commit: Readonly<{
        marker: string;
        manifest: Readonly<{ path: string; content: string }>;
      }> | null;
    }>;

export type FencedWriteResult = Readonly<{
  /** Paths the ledger held a newer version of; nothing was written. */
  refused: string[];
  changed: string[];
  unchanged: string[];
  /** For a start: whether the manifest and marker were committed. */
  committed?: boolean;
}>;

/** The container's disk, as `applyFencedRequest` uses it. */
export type FenceIo = {
  readText(filePath: string): string | null;
  /** Creates the parent directory as needed. */
  writeText(filePath: string, content: string): void;
  /** Creates the parent directory as needed; replaces what is there. */
  moveFile(from: string, to: string): void;
  /** Nothing to remove is not an error. */
  removeFile(filePath: string): void;
  removeTree(dirPath: string): void;
  /** `relative` under `root`, or throws when it would leave it. */
  within(root: string, relative: string): string;
};

export type FencePlanners = Readonly<{
  planFencedWrite: typeof planFencedWrite;
  planFencedStart: typeof planFencedStart;
}>;

/**
 * One request, applied. Runs under the lock, in the container, as its own
 * source; so it names nothing outside its parameters.
 */
export function applyFencedRequest(
  io: FenceIo,
  ledgerPath: string,
  request: FencedWriteRequest,
  planners: FencePlanners,
): FencedWriteResult {
  let ledger: Record<string, number> = {};
  const stored = io.readText(ledgerPath);
  if (stored !== null) {
    try {
      ledger = JSON.parse(stored);
    } catch {
      ledger = {};
    }
  }

  if (request.op === "write") {
    const current: Record<string, string | null> = {};
    for (const file of request.files) {
      current[file.path] = io.readText(io.within(request.root, file.path));
    }
    const plan = planners.planFencedWrite(ledger, request.files, current);
    if (plan.refused.length === 0) {
      if (plan.writes.length > 0 && request.marker) {
        io.writeText(request.marker.path, request.marker.content);
      }
      for (const file of plan.writes) {
        io.writeText(io.within(request.root, file.path), file.content);
      }
      io.writeText(ledgerPath, JSON.stringify(plan.ledger));
    }
    return {
      refused: plan.refused,
      changed: plan.writes.map((file) => file.path),
      unchanged: plan.unchanged,
    };
  }

  try {
    const plan = planners.planFencedStart(ledger, request.versions);
    if (plan.stale.length > 0) {
      return {
        refused: plan.stale,
        changed: [],
        unchanged: [],
        committed: false,
      };
    }
    // Read before anything here changes it: a marker another writer set
    // since this start read its own means the disk may hold what the plan
    // does not, so the start applies its files but does not vouch for them.
    const markerNow = io.readText(request.marker.path);
    const markerStands =
      (markerNow === null ? null : markerNow.trim()) ===
      request.marker.expected;

    if (request.prune.length > 0 || request.files.length > 0) {
      io.writeText(request.marker.path, request.marker.dirty);
    }
    for (const relative of request.prune) {
      io.removeFile(io.within(request.root, relative));
    }
    for (const relative of request.files) {
      io.moveFile(
        io.within(request.staging!, relative),
        io.within(request.root, relative),
      );
    }
    io.writeText(ledgerPath, JSON.stringify(plan.ledger));

    let committed = false;
    if (request.commit && markerStands) {
      io.writeText(
        request.commit.manifest.path,
        request.commit.manifest.content,
      );
      // Last, so a failure before it never leaves a marker to trust.
      io.writeText(request.marker.path, request.commit.marker);
      committed = true;
    }
    return {
      refused: [],
      changed: [...request.files],
      unchanged: [],
      committed,
    };
  } finally {
    if (request.staging) io.removeTree(request.staging);
  }
}

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
const planFencedStart = ${planFencedStart.toString()};
const applyFencedRequest = ${applyFencedRequest.toString()};
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

const io = {
  readText(file) { try { return fs.readFileSync(file, "utf8"); } catch { return null; } },
  writeText(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); },
  moveFile(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); } catch (error) {
      if (error.code !== "EXDEV") throw error;
      fs.copyFileSync(from, to); fs.unlinkSync(from);
    }
  },
  removeFile(file) { try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; } },
  removeTree(dir) { fs.rmSync(dir, { recursive: true, force: true }); },
  within(root, relative) {
    const base = path.resolve(root);
    const resolved = path.resolve(base, relative);
    if (!resolved.startsWith(base + path.sep)) throw new Error("PREVIEW_FENCE_PATH_ESCAPE: " + relative);
    return resolved;
  },
};

let result;
try {
  result = applyFencedRequest(io, LEDGER, request, { planFencedWrite, planFencedStart });
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
    ...(typeof parsed.committed === "boolean"
      ? { committed: parsed.committed }
      : {}),
  };
}
