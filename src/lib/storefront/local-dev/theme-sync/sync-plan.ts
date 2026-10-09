/**
 * The three-way comparison at the heart of local sync.
 *
 * Every path is judged from three copies: the local file now, the workspace
 * file now, and the base — what both sides held the last time they agreed.
 * A side "changed" when it differs from the base. One changed side is copied
 * to the other; two changed sides are a conflict unless they changed to the
 * same text. Nothing is ever resolved by overwriting: a conflict leaves both
 * copies where they are (Mutagen's `two-way-safe`; docs/local-code-sync.md).
 *
 * Local copies are compared by content hash; workspace copies by file id and
 * version, which the workspace bumps on every write. A workspace file whose
 * version moved is read and hashed before it is judged, so a change back to
 * the same text, or the same edit made on both sides, is not a conflict.
 *
 * Pure: no I/O. `sync-session.ts` gathers the inputs and applies the result.
 */

export type SyncBaseEntry = Readonly<{
  id: string;
  version: number;
  hash: string;
}>;

export type SyncLocalEntry = Readonly<{ hash: string }>;

export type SyncRemoteEntry = Readonly<{
  id: string;
  version: number;
  kind: "text" | "binary";
}>;

export type SyncRemoteRef = Readonly<{ id: string; version: number }>;

export type SyncAction =
  | Readonly<{ kind: "upload"; path: string; expect: SyncRemoteRef | null }>
  | Readonly<{ kind: "delete-remote"; path: string; remote: SyncRemoteRef }>
  | Readonly<{ kind: "download"; path: string; remote: SyncRemoteRef }>
  | Readonly<{ kind: "delete-local"; path: string }>
  | Readonly<{ kind: "adopt"; path: string; entry: SyncBaseEntry }>
  | Readonly<{ kind: "forget"; path: string }>
  | Readonly<{
      kind: "conflict";
      path: string;
      reason: "both-changed" | "local-deleted" | "remote-deleted";
      remote: SyncRemoteRef | null;
    }>
  | Readonly<{ kind: "skip-binary"; path: string }>;

export type SyncPlanInput = Readonly<{
  base: ReadonlyMap<string, SyncBaseEntry>;
  local: ReadonlyMap<string, SyncLocalEntry>;
  remote: ReadonlyMap<string, SyncRemoteEntry>;
  /** Hashes of the workspace files `remoteChangedTextPaths` named. */
  remoteHashes: ReadonlyMap<string, string>;
}>;

const sameRef = (base: SyncBaseEntry | undefined, remote: SyncRemoteEntry) =>
  Boolean(base && base.id === remote.id && base.version === remote.version);

/**
 * The workspace text files that moved since the base, and so must be read
 * before the plan can be made.
 */
export function remoteChangedTextPaths(
  base: ReadonlyMap<string, SyncBaseEntry>,
  remote: ReadonlyMap<string, SyncRemoteEntry>,
): string[] {
  const paths: string[] = [];
  for (const [path, entry] of remote) {
    if (entry.kind === "text" && !sameRef(base.get(path), entry)) {
      paths.push(path);
    }
  }
  return paths.sort();
}

export function planSync(input: SyncPlanInput): SyncAction[] {
  const paths = new Set([
    ...input.base.keys(),
    ...input.local.keys(),
    ...input.remote.keys(),
  ]);
  const actions: SyncAction[] = [];
  for (const path of [...paths].sort()) {
    const base = input.base.get(path);
    const local = input.local.get(path);
    const remote = input.remote.get(path);

    if (remote?.kind === "binary") {
      actions.push({ kind: "skip-binary", path });
      continue;
    }

    const localChanged = local?.hash !== base?.hash;
    const remoteChanged = remote ? !sameRef(base, remote) : Boolean(base);
    const remoteRef = remote ? { id: remote.id, version: remote.version } : null;

    if (!localChanged && !remoteChanged) continue;

    if (localChanged && !remoteChanged) {
      if (local) actions.push({ kind: "upload", path, expect: remoteRef });
      else if (remoteRef) {
        actions.push({ kind: "delete-remote", path, remote: remoteRef });
      } else actions.push({ kind: "forget", path });
      continue;
    }

    const remoteHash = remote ? input.remoteHashes.get(path) : undefined;
    if (remote && remoteHash === undefined) {
      throw new Error(`SYNC_PLAN_UNREAD_REMOTE: ${path} was not read.`);
    }

    if (!localChanged && remoteChanged) {
      if (remote && remoteRef && remoteHash !== undefined) {
        // Moved back to the text both sides already hold: nothing to copy.
        if (remoteHash === local?.hash) {
          actions.push({
            kind: "adopt",
            path,
            entry: { ...remoteRef, hash: remoteHash },
          });
        } else actions.push({ kind: "download", path, remote: remoteRef });
      } else if (local) actions.push({ kind: "delete-local", path });
      else actions.push({ kind: "forget", path });
      continue;
    }

    // Both sides changed.
    if (!local && !remote) {
      actions.push({ kind: "forget", path });
    } else if (local && remote && remoteRef && remoteHash === local.hash) {
      actions.push({
        kind: "adopt",
        path,
        entry: { ...remoteRef, hash: remoteHash },
      });
    } else {
      actions.push({
        kind: "conflict",
        path,
        reason: !local
          ? "local-deleted"
          : !remote
            ? "remote-deleted"
            : "both-changed",
        remote: remoteRef,
      });
    }
  }
  return actions;
}

/** Deletions already applied in each direction within the guard's window. */
export type RecentDeletions = Readonly<{ toWorkspace: number; toLocal: number }>;

export const MASS_DELETION_THRESHOLD = Object.freeze({
  /** This many deletions in one direction always need a yes. */
  count: 20,
  /** So does this share of the files, once there are at least `minimum`. */
  share: 0.25,
  minimum: 5,
  /** How long applied deletions keep counting towards the next plan. */
  windowMs: 15 * 60_000,
});

/**
 * Whether a plan looks like a folder or workspace vanishing, or a branch
 * switch, rather than a person deleting files — after Mutagen's safety
 * checks: one side emptied while the base still holds files, or more
 * deletions than a person makes by hand. Such a plan is not applied without
 * the developer saying so.
 *
 * Counted with the deletions already applied in the last fifteen minutes, so
 * a folder removed a few files at a time — a slow `rm -r`, a checkout that
 * lands across two cycles, or one person deleting batch after batch — trips
 * it as surely as one large plan does.
 */
export function massDeletionWarning(input: {
  actions: readonly SyncAction[];
  baseCount: number;
  localCount: number;
  remoteTextCount: number;
  recent?: RecentDeletions;
  threshold?: { count: number; share: number; minimum: number };
}): string | null {
  if (input.baseCount === 0) return null;
  if (input.localCount === 0) {
    return "The local folder holds no files that sync, but it did before.";
  }
  if (input.remoteTextCount === 0) {
    return "The workspace holds no files that sync, but it did before.";
  }
  const { count, share, minimum } = input.threshold ?? MASS_DELETION_THRESHOLD;
  const recent = input.recent ?? { toWorkspace: 0, toLocal: 0 };
  for (const kind of ["delete-remote", "delete-local"] as const) {
    const planned = input.actions.filter((a) => a.kind === kind).length;
    if (planned === 0) continue;
    const earlier = kind === "delete-remote" ? recent.toWorkspace : recent.toLocal;
    const deletions = planned + earlier;
    // Out of the files there were before the earlier deletions.
    const before = input.baseCount + earlier;
    if (
      deletions >= count ||
      (deletions >= minimum && deletions / before >= share)
    ) {
      const where = kind === "delete-remote" ? "from the workspace" : "locally";
      return earlier > 0
        ? `This would delete ${planned} more files ${where}, ${deletions} in the last 15 minutes.`
        : `This would delete ${planned} files ${where}.`;
    }
  }
  return null;
}
