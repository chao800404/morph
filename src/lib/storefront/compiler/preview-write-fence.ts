/**
 * Ordering writes into a shared preview by the version each was made from.
 *
 * Every tab an author has open writes into the same preview, and the check
 * that a tab's copy is current reads the database before the write reaches
 * the preview. A request checked just before a newer save could therefore
 * land after that save's own sync and rewind the preview — reproduced in
 * `preview-file-sync.test.ts`. Reading the database again later only narrows
 * that window; it cannot close it, because the database and the preview's
 * files are not changed together.
 *
 * So the preview itself keeps a ledger: for each file, the highest version
 * any write to it was made from. A write carries its own version (its
 * `fence`), and is refused when the ledger already holds a higher one. The
 * comparison, the write and the ledger update happen as one step on the
 * preview's side — under a lock in the container, or a mutex in the sidecar —
 * so no other write can come between them. Equal versions are allowed: two
 * tabs editing the same saved version still behave as they always have, the
 * later write winning.
 *
 * A version only orders writes of one file, though, and a path can name more
 * than one: a file deleted and made again under the same name starts over at
 * version 1. So the ledger also keeps the source generation each version was
 * read at — every save and every deletion advances it — and a write read at
 * a newer generation than the version recorded for its path is not compared
 * by version at all: it was checked against the database after that version
 * was, so it is the newer of the two, whatever its number. Without this,
 * once version 2 of a file was laid out, the same file made again as version
 * 1 was refused by every later start and sync until the preview restarted.
 * Read at an older generation than what is recorded, a write must be of
 * exactly the recorded version: an equal one is the same saved version, and
 * a higher one can only be of a file since deleted. Where either side's
 * generation is unknown, versions alone order them, as they always have.
 *
 * `planFencedWrite` is the whole rule. It is plain and self-contained on
 * purpose: the container runs its source as-is (see
 * `fencedWriteScriptSource`), so it must not reach for anything outside
 * its own body.
 */

export type FencedFile = Readonly<{
  path: string;
  content: string;
  /** The saved version this content is, or was edited from. */
  fence: number;
}>;

/** The version last written to each path. */
export type FenceLedger = Readonly<Record<string, number>>;

/**
 * Everything a preview's writes are ordered by: the version last written to
 * each path and the source generation it was read at, and the Theme's source
 * generation — the highest any write was read at.
 */
export type FenceLedgerState = Readonly<{
  files: FenceLedger;
  /**
   * The generation each path's version was read at. Absent for a version
   * written with no generation, or recorded before these were kept: nothing
   * says when it was read, so only its version orders it.
   */
  readAt?: Readonly<Record<string, number>>;
  generation: number;
}>;

export type FenceLedgerRecord = {
  files: Record<string, number>;
  readAt: Record<string, number>;
  generation: number;
};

export type FencedWritePlan = Readonly<{
  /** Paths the ledger has already seen a newer version of; nothing written. */
  refused: string[];
  /** Files whose content differs from what is there, to be written. */
  writes: FencedFile[];
  unchanged: string[];
  ledger: FenceLedgerRecord;
}>;

/**
 * `generation` is the source generation the files were checked against,
 * read together with them; null orders them by version alone.
 */
export function planFencedWrite(
  ledger: FenceLedgerState,
  files: readonly FencedFile[],
  current: Readonly<Record<string, string | null>>,
  generation: number | null,
): FencedWritePlan {
  const readAt = ledger.readAt ?? {};
  // The rule for one path, as in `planFencedStart`: repeated there rather
  // than shared, because each planner runs in the container as its own source.
  const refuses = (path: string, version: number) => {
    const recorded = ledger.files[path];
    if (typeof recorded !== "number") return false;
    const recordedAt = readAt[path];
    if (typeof generation === "number" && typeof recordedAt === "number") {
      if (generation > recordedAt) return false;
      if (generation < recordedAt) return recorded !== version;
    }
    return recorded > version;
  };

  const refused: string[] = [];
  for (const file of files) {
    if (refuses(file.path, file.fence)) refused.push(file.path);
  }
  const next = {
    files: { ...ledger.files },
    readAt: { ...readAt },
    generation: ledger.generation,
  };
  // All or nothing, as the check before it is.
  if (refused.length > 0) {
    return { refused, writes: [], unchanged: [], ledger: next };
  }

  const writes: FencedFile[] = [];
  const unchanged: string[] = [];
  for (const file of files) {
    if (current[file.path] === file.content) unchanged.push(file.path);
    else writes.push(file);
    // Not refused, so this version is the one to order the path by now.
    next.files[file.path] = file.fence;
    const recordedAt = next.readAt[file.path];
    if (typeof generation !== "number") delete next.readAt[file.path];
    else if (typeof recordedAt !== "number" || recordedAt < generation) {
      next.readAt[file.path] = generation;
    }
  }
  if (typeof generation === "number" && generation > next.generation) {
    next.generation = generation;
  }
  return { refused: [], writes, unchanged, ledger: next };
}

export type FencedStartPlan = Readonly<{
  /** Paths the ledger has already seen a newer version of. */
  stale: string[];
  /**
   * The start was read at a generation older than one already laid out.
   * Per-path versions cannot see this: a file a newer save created is not in
   * the older start's plan at all, so nothing names it — and the start would
   * go on to delete it as a file the plan dropped.
   */
  staleGeneration: boolean;
  ledger: FenceLedgerRecord;
}>;

/**
 * The same rule for a start, which lays out every file at once.
 *
 * A start is judged against what has been written, the way a sync is: if
 * any file already holds a newer version, or the workspace was already laid
 * out from a newer generation, the start was read before it and must not
 * lay the older files back, so it is refused whole and the ledger is left
 * as it was. Otherwise its versions are recorded with the generation it was
 * read at, and that generation raises the ledger's, never lowering it. Equal
 * versions and an equal generation pass, as they do for a sync, and a file
 * whose version was read at an older generation is the start's to replace,
 * as it is a sync's. A start that names no generation is not ordered by one.
 *
 * Self-contained for the same reason as `planFencedWrite`.
 */
export function planFencedStart(
  ledger: FenceLedgerState,
  start: Readonly<{
    versions: Readonly<Record<string, number>>;
    generation: number | null;
  }>,
): FencedStartPlan {
  const generation = start.generation;
  const readAt = ledger.readAt ?? {};
  // The rule for one path, as in `planFencedWrite`.
  const refuses = (path: string, version: number) => {
    const recorded = ledger.files[path];
    if (typeof recorded !== "number") return false;
    const recordedAt = readAt[path];
    if (typeof generation === "number" && typeof recordedAt === "number") {
      if (generation > recordedAt) return false;
      if (generation < recordedAt) return recorded !== version;
    }
    return recorded > version;
  };

  const stale: string[] = [];
  for (const [file, version] of Object.entries(start.versions)) {
    if (refuses(file, version)) stale.push(file);
  }
  const staleGeneration =
    typeof generation === "number" && generation < ledger.generation;
  const next = {
    files: { ...ledger.files },
    readAt: { ...readAt },
    generation: ledger.generation,
  };
  if (stale.length > 0 || staleGeneration) {
    return { stale, staleGeneration, ledger: next };
  }

  for (const [file, version] of Object.entries(start.versions)) {
    next.files[file] = version;
    const recordedAt = next.readAt[file];
    if (typeof generation !== "number") delete next.readAt[file];
    else if (typeof recordedAt !== "number" || recordedAt < generation) {
      next.readAt[file] = generation;
    }
  }
  if (typeof generation === "number" && generation > next.generation) {
    next.generation = generation;
  }
  return { stale: [], staleGeneration: false, ledger: next };
}

/**
 * The version a file is written as.
 *
 * Content identical to what is saved is that saved version, whatever the tab
 * edited it from — putting back a failed edit, or taking the version another
 * tab won with. Anything else is an edit of the version the tab holds; a file
 * that was never saved counts from zero.
 */
export function fenceFor(
  file: Readonly<{ content: string; baseVersion: number | null }>,
  saved: Readonly<{ version: number; content: string }> | undefined,
): number {
  if (saved && saved.content === file.content) return saved.version;
  return file.baseVersion ?? 0;
}
