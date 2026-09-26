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

/** Highest version written to each path. */
export type FenceLedger = Readonly<Record<string, number>>;

export type FencedWritePlan = Readonly<{
  /** Paths the ledger has already seen a newer version of; nothing written. */
  refused: string[];
  /** Files whose content differs from what is there, to be written. */
  writes: FencedFile[];
  unchanged: string[];
  ledger: Record<string, number>;
}>;

export function planFencedWrite(
  ledger: FenceLedger,
  files: readonly FencedFile[],
  current: Readonly<Record<string, string | null>>,
): FencedWritePlan {
  const refused: string[] = [];
  for (const file of files) {
    const recorded = ledger[file.path];
    if (typeof recorded === "number" && recorded > file.fence) {
      refused.push(file.path);
    }
  }
  // All or nothing, as the check before it is.
  if (refused.length > 0) {
    return { refused, writes: [], unchanged: [], ledger: { ...ledger } };
  }

  const next: Record<string, number> = { ...ledger };
  const writes: FencedFile[] = [];
  const unchanged: string[] = [];
  for (const file of files) {
    if (current[file.path] === file.content) unchanged.push(file.path);
    else writes.push(file);
    const recorded = next[file.path];
    next[file.path] =
      typeof recorded === "number" && recorded > file.fence
        ? recorded
        : file.fence;
  }
  return { refused: [], writes, unchanged, ledger: next };
}

/**
 * Everything a preview's writes are ordered by: the newest version written
 * to each path, and the Theme's source generation — the highest any write
 * was read at.
 */
export type FenceLedgerState = Readonly<{
  files: FenceLedger;
  generation: number;
}>;

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
  ledger: { files: Record<string, number>; generation: number };
}>;

/**
 * The same rule for a start, which lays out every file at once.
 *
 * A start is judged against what has been written, the way a sync is: if
 * any file already holds a newer version, or the workspace was already laid
 * out from a newer generation, the start was read before it and must not
 * lay the older files back, so it is refused whole and the ledger is left
 * as it was. Otherwise its versions and generation are recorded, raised and
 * never lowered. Equal versions and an equal generation pass, as they do
 * for a sync. A start that names no generation is not ordered by one.
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
  const stale: string[] = [];
  for (const [file, version] of Object.entries(start.versions)) {
    const recorded = ledger.files[file];
    if (typeof recorded === "number" && recorded > version) stale.push(file);
  }
  const staleGeneration =
    typeof start.generation === "number" &&
    start.generation < ledger.generation;
  if (stale.length > 0 || staleGeneration) {
    return {
      stale,
      staleGeneration,
      ledger: { files: { ...ledger.files }, generation: ledger.generation },
    };
  }

  const files: Record<string, number> = { ...ledger.files };
  for (const [file, version] of Object.entries(start.versions)) {
    const recorded = files[file];
    if (typeof recorded !== "number" || recorded < version) {
      files[file] = version;
    }
  }
  return {
    stale: [],
    staleGeneration: false,
    ledger: {
      files,
      generation:
        typeof start.generation === "number" &&
        start.generation > ledger.generation
          ? start.generation
          : ledger.generation,
    },
  };
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
