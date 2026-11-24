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
 * The ledger also decides who owns the workspace (user, 2026-11-24): "a
 * newer request takes over" takes effect here, under the same lock. Each
 * guarded start registers its claim (`PreviewStartClaim`: the preview
 * Durable Object's increasing `seq`, the attempt's ordinal within its
 * request, its attemptId) as the ledger's `owner`; a lower claim is refused
 * and writes nothing. The same owner record decides whether a start may lay
 * out and commit files (`op: "start"`), whether anyone may write the shared
 * dirty marker (`op: "mark"`), and whether a dev server may be launched
 * (`op: "serve"`, the gate the dev server is started through). Beside it the
 * ledger keeps `committed`: the marker the last start committed, dropped by
 * any later write, so the next start reuses a workspace only when the ledger
 * vouches for the very marker it finds (`fenceLedgerVouchesFor`). A ledger
 * that cannot be read proves no ownership: nothing claimed against it is
 * written.
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

/**
 * One start attempt's claim on the workspace (user, 2026-11-24): `seq` from
 * the preview's Durable Object (`claimPreviewStart`), `attempt` 1 for a
 * request's first attempt and 2 for its retry (same `seq`), and the
 * attempt's own id. Claims compare by `seq`, then `attempt`.
 */
export type PreviewStartClaim = Readonly<{
  seq: number;
  attempt: number;
  attemptId: string;
}>;

/**
 * What the ledger says of a claim: it is the registered owner; another
 * claim is registered (a higher one, or one that cannot be told apart from
 * it); or nothing can be proven (the ledger is unreadable, or names no
 * owner where one is needed).
 */
export type PreviewClaimStanding = "owner" | "superseded" | "unknown";

export type FencedWriteRequest =
  | Readonly<{
      /** Registers `claim` as the owner unless a higher one is registered. */
      op: "claim";
      claim: PreviewStartClaim;
    }>
  | Readonly<{
      /**
       * Writes the shared marker (a failed start's dirty marker) only if
       * `claim` is the registered owner, and drops what the ledger vouched
       * for. Otherwise writes nothing.
       */
      op: "mark";
      claim: PreviewStartClaim;
      marker: Readonly<{ path: string; content: string }>;
    }>
  | Readonly<{
      /**
       * Writes nothing: whether `claim` is the registered owner. The script
       * exits 75 when it is not, so a dev server started behind it as
       * `node <script> <request> && exec <server>` never runs
       * (`gatedServeCommand`).
       */
      op: "serve";
      claim: PreviewStartClaim;
    }>
  | Readonly<{
      op: "write";
      /** Directory the paths are relative to. */
      root: string;
      files: readonly FencedFile[];
      /**
       * The Theme source generation the sync was checked against — read
       * together with the saved files it was checked against, never later.
       * Raises the ledger's generation once the write goes through.
       */
      generation?: number | null;
      /** Written before the first changed file, as the unfenced path did. */
      marker?: Readonly<{ path: string; content: string }>;
    }>
  | Readonly<{
      /**
       * Applies a start: refused whole if any of `versions` is older than
       * what the ledger holds (`planFencedStart`); otherwise the files named
       * in `prune` are removed, the staged `files` moved into `root`, the
       * versions recorded, and — only if no other writer has marked the
       * workspace since the start read it — the manifest and then the marker
       * are committed.
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
      /** The source generation the files were read at, together. */
      generation?: number | null;
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
      /**
       * The draft content file among `files`, relative to `root`, and where
       * the running dev server's instance is kept. A staged snapshot with a
       * lower ticket than the one in place is not moved (a content sync
       * wrote the newer one after this start read its drafts), and the one
       * in place is stamped with the running instance
       * (docs/astro-theme-plan.md 6.5, 6.6).
       */
      content?: Readonly<{ path: string; instancePath: string }>;
      /**
       * This attempt's claim. Registered as the owner in the same locked
       * step that lays out the files, unless a higher claim is registered,
       * in which case nothing is written. A start without one (a provider
       * with no Durable Object guard) is refused once any claim is.
       */
      claim?: PreviewStartClaim;
    }>;

/**
 * The draft content file's own requests (docs/astro-theme-plan.md 6.5, 6.6),
 * taken under the same lock as every other workspace write.
 *
 * - `content`: a newer snapshot, by ticket, stamped with the running dev
 *   server's instance and moved into place by one rename. The same ticket
 *   with the same content hash is the same write (written again as it is);
 *   with another hash it is a conflict; a lower ticket is superseded.
 * - `stamp`: a dev server is about to start; its instance is kept beside
 *   the lock and stamped onto the content file in place.
 */
export type PreviewContentRequest =
  | Readonly<{
      op: "content";
      /** The content file, absolute. */
      path: string;
      /** Where the running instance is kept, absolute. */
      instancePath: string;
      content: string;
    }>
  | Readonly<{
      op: "stamp";
      path: string;
      instancePath: string;
      instance: string;
      /** Stamped only while this claim owns the workspace (`op: "serve"`). */
      claim?: PreviewStartClaim;
    }>
  /** What the file holds and which server is stamped; writes nothing. */
  | Readonly<{
      op: "read";
      path: string;
      instancePath: string;
    }>;

export type PreviewContentResult = Readonly<{
  outcome:
    | "written"
    | "same"
    | "superseded"
    | "conflict"
    | "no-server"
    | "stamped"
    | "read"
    /** A stamp whose claim no longer owns the workspace: nothing written. */
    | "not-owner";
  /** The ticket the file holds after the request. */
  ticket: number;
  /** The running instance, or null when no server has been stamped. */
  instance: string | null;
}>;

export type FencedWriteResult = Readonly<{
  /** Paths the ledger held a newer version of; nothing was written. */
  refused: string[];
  changed: string[];
  unchanged: string[];
  /** For a start: whether the manifest and marker were committed. */
  committed?: boolean;
  /**
   * For a start: refused because the workspace was already laid out from a
   * newer source generation than the one it was read at.
   */
  staleGeneration?: Readonly<{ generation: number; laidOut: number }>;
  /** For a request that carried a claim: what the ledger says of it. */
  ownership?: PreviewClaimStanding;
  /** For `op: "mark"`: whether the marker was written. */
  marked?: boolean;
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
  // `{ files, readAt, generation }`. A ledger from before each version's
  // generation was kept has no `readAt`, and one from before generations
  // were kept at all is a flat path-to-version map: both are read as not
  // knowing when what they hold was read.
  let ledger: {
    files: Record<string, number>;
    readAt: Record<string, number>;
    generation: number;
  } = { files: {}, readAt: {}, generation: 0 };
  // Workspace ownership (user, 2026-11-24): the registered owner claim, and
  // the marker the last start committed while nothing has written since.
  type Claim = { seq: number; attempt: number; attemptId: string };
  const isClaim = (value: unknown): value is Claim => {
    const claim = value as Claim | null;
    return Boolean(
      claim &&
        typeof claim === "object" &&
        Number.isSafeInteger(claim.seq) &&
        Number.isSafeInteger(claim.attempt) &&
        typeof claim.attemptId === "string",
    );
  };
  let owner: Claim | null = null;
  let committedMarker: string | null = null;
  // Unreadable proves no ownership: a claim judged against it writes nothing.
  let ownershipReadable = true;
  const stored = io.readText(ledgerPath);
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.files &&
        typeof parsed.files === "object" &&
        typeof parsed.generation === "number"
      ) {
        ledger = {
          files: parsed.files,
          readAt:
            parsed.readAt && typeof parsed.readAt === "object"
              ? parsed.readAt
              : {},
          generation: parsed.generation,
        };
        if (parsed.owner !== undefined) {
          if (isClaim(parsed.owner)) owner = parsed.owner;
          else ownershipReadable = false;
        }
        if (typeof parsed.committed === "string") {
          committedMarker = parsed.committed;
        }
      } else if (parsed && typeof parsed === "object") {
        ledger = { files: parsed, readAt: {}, generation: 0 };
      } else {
        ownershipReadable = false;
      }
    } catch {
      // Unreadable: as if no version had been written, and no owner proven.
      ownershipReadable = false;
    }
  }
  const compareClaims = (a: Claim, b: Claim) =>
    a.seq !== b.seq ? a.seq - b.seq : a.attempt - b.attempt;
  const isOwner = (claim: Claim) =>
    owner !== null &&
    owner.seq === claim.seq &&
    owner.attempt === claim.attempt &&
    owner.attemptId === claim.attemptId;
  /** Whether `claim` is the registered owner, as `mark` and `serve` need. */
  const standing = (claim: Claim): "owner" | "superseded" | "unknown" =>
    !ownershipReadable || owner === null
      ? "unknown"
      : isOwner(claim)
        ? "owner"
        : "superseded";
  /** Whether `claim` may register: no owner yet, itself, or a lower one. */
  const mayRegister = (claim: Claim): "owner" | "superseded" | "unknown" =>
    !ownershipReadable
      ? "unknown"
      : owner === null || isOwner(claim) || compareClaims(claim, owner) > 0
        ? "owner"
        : "superseded";
  const ledgerText = (versions: {
    files: Record<string, number>;
    readAt: Record<string, number>;
    generation: number;
  }) =>
    JSON.stringify({
      files: versions.files,
      readAt: versions.readAt,
      generation: versions.generation,
      ...(owner ? { owner } : {}),
      ...(committedMarker !== null ? { committed: committedMarker } : {}),
    });

  if (request.op === "claim") {
    const ownership = mayRegister(request.claim);
    if (ownership === "owner") {
      owner = { ...request.claim };
      io.writeText(ledgerPath, ledgerText(ledger));
    }
    return { refused: [], changed: [], unchanged: [], ownership };
  }
  if (request.op === "serve") {
    return {
      refused: [],
      changed: [],
      unchanged: [],
      ownership: standing(request.claim),
    };
  }
  if (request.op === "mark") {
    const ownership = standing(request.claim);
    if (ownership !== "owner") {
      return { refused: [], changed: [], unchanged: [], ownership, marked: false };
    }
    io.writeText(request.marker.path, request.marker.content);
    committedMarker = null;
    io.writeText(ledgerPath, ledgerText(ledger));
    return { refused: [], changed: [], unchanged: [], ownership, marked: true };
  }

  if (request.op === "write") {
    const current: Record<string, string | null> = {};
    for (const file of request.files) {
      current[file.path] = io.readText(io.within(request.root, file.path));
    }
    const plan = planners.planFencedWrite(
      ledger,
      request.files,
      current,
      typeof request.generation === "number" ? request.generation : null,
    );
    if (plan.refused.length === 0) {
      if (plan.writes.length > 0 && request.marker) {
        io.writeText(request.marker.path, request.marker.content);
      }
      for (const file of plan.writes) {
        io.writeText(io.within(request.root, file.path), file.content);
      }
      // A written file is not what the last start committed.
      if (plan.writes.length > 0) committedMarker = null;
      // Last, and only for a write that went through: a refused or failed
      // one raises nothing.
      io.writeText(ledgerPath, ledgerText(plan.ledger));
    }
    return {
      refused: plan.refused,
      changed: plan.writes.map((file) => file.path),
      unchanged: plan.unchanged,
    };
  }

  try {
    // Ownership first: a start whose claim is outranked, or that cannot be
    // judged, writes nothing at all: not a file, not the marker, not the
    // ledger. Its own staging is still removed (below).
    if (request.claim) {
      const ownership = mayRegister(request.claim);
      if (ownership !== "owner") {
        return { refused: [], changed: [], unchanged: [], committed: false, ownership };
      }
      owner = { ...request.claim };
    } else if (owner !== null) {
      return {
        refused: [],
        changed: [],
        unchanged: [],
        committed: false,
        ownership: "superseded",
      };
    }
    const plan = planners.planFencedStart(ledger, {
      versions: request.versions,
      generation:
        typeof request.generation === "number" ? request.generation : null,
    });
    if (plan.stale.length > 0 || plan.staleGeneration) {
      return {
        refused: plan.stale,
        changed: [],
        unchanged: [],
        committed: false,
        ...(plan.staleGeneration
          ? {
              staleGeneration: {
                generation: request.generation as number,
                laidOut: ledger.generation,
              },
            }
          : {}),
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
      committedMarker = null;
    }
    for (const relative of request.prune) {
      io.removeFile(io.within(request.root, relative));
    }
    // A snapshot's ticket, read in here: this function names nothing
    // outside its parameters.
    const ticketOf = (text: string | null): number => {
      try {
        const ticket = text === null ? 0 : JSON.parse(text)?.contentTicket;
        return typeof ticket === "number" && Number.isSafeInteger(ticket) && ticket > 0
          ? ticket
          : 0;
      } catch {
        return 0;
      }
    };
    for (const relative of request.files) {
      if (request.content && relative === request.content.path) {
        const staged = io.within(request.staging!, relative);
        const placed = io.within(request.root, relative);
        if (ticketOf(io.readText(placed)) > ticketOf(io.readText(staged))) {
          io.removeFile(staged);
          continue;
        }
      }
      io.moveFile(
        io.within(request.staging!, relative),
        io.within(request.root, relative),
      );
    }
    if (request.content) {
      // Whatever is in place now names the server running, if one is.
      const instance = io.readText(request.content.instancePath);
      const placed = io.within(request.root, request.content.path);
      const text = io.readText(placed);
      if (instance && text !== null) {
        try {
          io.writeText(
            placed,
            JSON.stringify({ ...JSON.parse(text), previewInstance: instance.trim() }),
          );
        } catch {
          // Not a snapshot: left as it is.
        }
      }
    }
    // Vouches for the commit below before it is made: a failure between
    // the two leaves a dirty marker the ledger does not name, which proves
    // nothing, so the next start lays out again.
    if (request.commit && markerStands) committedMarker = request.commit.marker;
    io.writeText(ledgerPath, ledgerText(plan.ledger));

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
      ...(request.claim ? { ownership: "owner" as const } : {}),
    };
  } finally {
    if (request.staging) io.removeTree(request.staging);
  }
}

/**
 * One content request, applied. Runs under the lock, in the container, as
 * its own source; so it names nothing outside its parameters.
 */
export function applyPreviewContentRequest(
  io: FenceIo & { renameInto(from: string, to: string): void },
  request: PreviewContentRequest,
): PreviewContentResult {
  const read = (text: string | null) => {
    try {
      const parsed = text === null ? null : JSON.parse(text);
      const ticket = parsed?.contentTicket;
      const hash = parsed?.contentHash;
      return {
        parsed,
        ticket:
          typeof ticket === "number" && Number.isSafeInteger(ticket) && ticket > 0
            ? ticket
            : 0,
        hash: typeof hash === "string" ? hash : null,
      };
    } catch {
      return { parsed: null, ticket: 0, hash: null };
    }
  };
  const placed = read(io.readText(request.path));
  if (request.op === "stamp") {
    io.writeText(request.instancePath, request.instance);
    if (placed.parsed) {
      const next = request.path + ".next";
      io.writeText(
        next,
        JSON.stringify({ ...placed.parsed, previewInstance: request.instance }),
      );
      io.renameInto(next, request.path);
    }
    return { outcome: "stamped", ticket: placed.ticket, instance: request.instance };
  }
  const instanceText = io.readText(request.instancePath);
  const instance = instanceText ? instanceText.trim() : null;
  if (request.op === "read") {
    return { outcome: "read", ticket: placed.ticket, instance };
  }
  const incoming = read(request.content);
  if (!incoming.parsed || incoming.ticket === 0) {
    throw new Error("PREVIEW_CONTENT_INVALID: a content sync carries a snapshot with its ticket.");
  }
  if (!instance) return { outcome: "no-server", ticket: placed.ticket, instance: null };
  if (incoming.ticket < placed.ticket) {
    return { outcome: "superseded", ticket: placed.ticket, instance };
  }
  if (incoming.ticket === placed.ticket) {
    return {
      outcome: incoming.hash !== null && incoming.hash === placed.hash ? "same" : "conflict",
      ticket: placed.ticket,
      instance,
    };
  }
  const next = request.path + ".next";
  io.writeText(next, JSON.stringify({ ...incoming.parsed, previewInstance: instance }));
  io.renameInto(next, request.path);
  return { outcome: "written", ticket: incoming.ticket, instance };
}

export type FenceAppliers = Readonly<{
  applyFencedRequest: typeof applyFencedRequest;
  applyPreviewContentRequest: typeof applyPreviewContentRequest;
}>;

/**
 * Every request the fence script takes, dispatched as the script does,
 * under its one lock. A stamp that carries a claim is made only while that
 * claim owns the workspace, judged in the same locked step.
 *
 * Runs in the container as its own source, so it names nothing outside its
 * parameters: a bundler may rename the module's functions, while the
 * script defines them under these names. The script always passes
 * `appliers`; the default is for callers in this process (tests).
 */
export function applyPreviewFenceRequest(
  io: FenceIo & { renameInto(from: string, to: string): void },
  ledgerPath: string,
  request: FencedWriteRequest | PreviewContentRequest,
  planners: FencePlanners,
  appliers: FenceAppliers = { applyFencedRequest, applyPreviewContentRequest },
): FencedWriteResult | PreviewContentResult {
  if (request.op === "content" || request.op === "read") {
    return appliers.applyPreviewContentRequest(io, request);
  }
  if (request.op === "stamp") {
    if (request.claim) {
      const standing = appliers.applyFencedRequest(
        io,
        ledgerPath,
        { op: "serve", claim: request.claim },
        planners,
      );
      if (standing.ownership !== "owner") {
        return { outcome: "not-owner", ticket: 0, instance: null };
      }
    }
    return appliers.applyPreviewContentRequest(io, request);
  }
  return appliers.applyFencedRequest(io, ledgerPath, request, planners);
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
const applyPreviewContentRequest = ${applyPreviewContentRequest.toString()};
const applyPreviewFenceRequest = ${applyPreviewFenceRequest.toString()};
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
  writeText(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (file !== LEDGER) { fs.writeFileSync(file, content); return; }
    // The ledger by one rename: a write cut short never leaves it unreadable,
    // and an unreadable ledger proves no ownership.
    const next = file + "." + process.pid + ".next";
    fs.writeFileSync(next, content);
    fs.renameSync(next, file);
  },
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
  // One rename on the same disk: a reader sees the old file or the new one.
  renameInto(from, to) { fs.renameSync(from, to); },
};

let result;
try {
  result = applyPreviewFenceRequest(
    io,
    LEDGER,
    request,
    { planFencedWrite, planFencedStart },
    { applyFencedRequest, applyPreviewContentRequest },
  );
} finally {
  fs.rmdirSync(LOCK);
  try { fs.unlinkSync(requestPath); } catch {}
  try { fs.unlinkSync(__filename); } catch {}
}
process.stdout.write(JSON.stringify(result));
// The serve gate: a dev server chained after it with && runs only for the owner.
if (request.op === "serve" && result.ownership !== "owner") {
  process.stderr.write("PREVIEW_SERVE_NOT_OWNER");
  process.exitCode = 75;
}
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

/** Runs one content request in the container, under the fence's lock. */
export async function runPreviewContentRequestInSandbox(
  sandbox: FenceSandbox,
  request: PreviewContentRequest,
): Promise<PreviewContentResult> {
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
  const parsed = JSON.parse(run.stdout) as PreviewContentResult;
  return {
    outcome: parsed.outcome,
    ticket: parsed.ticket,
    instance: parsed.instance ?? null,
  };
}

/** Where a preview container keeps its running dev server's instance. */
export const PREVIEW_INSTANCE_PATH = "/tmp/morph-preview-instance";

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
    ...(parsed.staleGeneration
      ? { staleGeneration: { ...parsed.staleGeneration } }
      : {}),
    ...(parsed.ownership ? { ownership: parsed.ownership } : {}),
    ...(typeof parsed.marked === "boolean" ? { marked: parsed.marked } : {}),
  };
}

/**
 * Writes the serve gate for `claim` (its own script and request, in /tmp)
 * and returns the command that runs it. Chained before a dev server by
 * `gatedServeCommand`, the ownership check and the launch are one step in
 * the container: the server is exec'd by the same shell only if the
 * ledger, read under the lock, still names this claim as the owner.
 */
export async function writePreviewServeGate(
  sandbox: FenceSandbox,
  claim: PreviewStartClaim,
): Promise<string> {
  const id = crypto.randomUUID();
  const scriptPath = `${PREVIEW_FENCE_SCRIPT_PREFIX}${id}.cjs`;
  const requestPath = `${PREVIEW_FENCE_SCRIPT_PREFIX}${id}.json`;
  await sandbox.writeFile(scriptPath, fencedWriteScriptSource());
  await sandbox.writeFile(
    requestPath,
    JSON.stringify({ op: "serve", claim } satisfies FencedWriteRequest),
  );
  return `node ${scriptPath} ${requestPath}`;
}

/**
 * `command` started behind `gate`: one shell, which runs the gate and, only
 * if it passed, replaces itself with the dev server (`exec`), so the
 * process the sandbox reports is the dev server itself.
 */
export function gatedServeCommand(gate: string, command: string): string {
  if (gate.includes("'") || command.includes("'")) {
    throw new Error(
      "PREVIEW_SERVE_GATE_QUOTE: a gated command cannot hold a single quote.",
    );
  }
  return `sh -c '${gate} && exec ${command}'`;
}

/**
 * Whether the fence ledger's text vouches for `marker` as the commit the
 * last start made, with nothing written since. The next start reuses the
 * workspace, or diffs it against its manifest, only then (user,
 * 2026-11-24); otherwise it lays the workspace out again.
 */
export function fenceLedgerVouchesFor(
  ledgerText: string | null,
  marker: string | null,
): boolean {
  if (ledgerText === null || marker === null) return false;
  try {
    const parsed = JSON.parse(ledgerText) as { committed?: unknown } | null;
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof parsed.committed === "string" &&
      parsed.committed === marker
    );
  } catch {
    return false;
  }
}
