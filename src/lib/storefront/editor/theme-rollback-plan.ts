/**
 * What rolling the workspace back to a revision would change.
 *
 * Rollback replaces the whole workspace rather than merging file by file, so
 * the only honest way to offer it is to say beforehand exactly which files it
 * creates, rewrites and deletes. A file restored here is one that was deleted
 * after the revision was taken — the reason someone reaches for rollback at
 * all — and a file deleted here is work done since it, which is the part worth
 * seeing before agreeing to it.
 */
export type ThemeRollbackFile =
  | Readonly<{ path: string; content: string }>
  /** A binary file, by the digest of its bytes, as a revision records it. */
  | Readonly<{ path: string; digest: string }>;

/**
 * A workspace entry or a revision file, as the plan compares it. Both mark a
 * binary file the same way and name its bytes by `blobDigest`.
 */
export function rollbackFileOf(
  entry:
    | Readonly<{ path: string; encoding: "binary"; blobDigest: string }>
    | Readonly<{ path: string; encoding?: "utf8"; content: string }>,
): ThemeRollbackFile {
  return entry.encoding === "binary"
    ? { path: entry.path, digest: entry.blobDigest }
    : { path: entry.path, content: entry.content };
}

/**
 * Whether rollback would leave the file as it is: source by its text, a
 * binary file by its digest. A path that changed kind is rewritten.
 */
function sameFile(left: ThemeRollbackFile, right: ThemeRollbackFile): boolean {
  if ("digest" in left)
    return "digest" in right && left.digest === right.digest;
  return "content" in right && left.content === right.content;
}

export type ThemeRollbackPlan = Readonly<{
  /** In the revision, absent now: rollback brings these back. */
  restored: readonly string[];
  /** In both, with different content: rollback rewrites these. */
  rewritten: readonly string[];
  /** Here now, absent from the revision: rollback deletes these. */
  removed: readonly string[];
  /** In both and identical: rollback leaves these alone. */
  unchanged: readonly string[];
  /**
   * Page content documents that follow their routes back to where the
   * revision had them. Filled in by the server, which alone knows the moves.
   */
  routeDocumentMoves?: ReadonlyArray<{
    fromRoutePath: string;
    toRoutePath: string;
  }>;
  /** Why the documents cannot follow, in which case rollback is refused. */
  routeDocumentConflict?: string | null;
}>;

/** Whether a plan would change anything at all. */
export function isThemeRollbackNoop(plan: ThemeRollbackPlan): boolean {
  return (
    plan.restored.length === 0 &&
    plan.rewritten.length === 0 &&
    plan.removed.length === 0
  );
}

export function resolveThemeRollbackPlan(args: {
  /** The workspace as it stands. */
  current: readonly ThemeRollbackFile[];
  /** The revision's files, as the snapshot records them. */
  target: readonly ThemeRollbackFile[];
}): ThemeRollbackPlan {
  const currentByPath = new Map(
    args.current.map((file) => [file.path, file] as const),
  );
  const targetByPath = new Map(
    args.target.map((file) => [file.path, file] as const),
  );

  const restored: string[] = [];
  const rewritten: string[] = [];
  const unchanged: string[] = [];
  for (const [path, file] of targetByPath) {
    const current = currentByPath.get(path);
    if (!current) {
      restored.push(path);
      continue;
    }
    (sameFile(current, file) ? unchanged : rewritten).push(path);
  }

  const removed: string[] = [];
  for (const path of currentByPath.keys()) {
    if (!targetByPath.has(path)) removed.push(path);
  }

  // Sorted so the same rollback always reads the same way, and so a long list
  // groups by directory the way the explorer does.
  const byPath = (left: string, right: string) => left.localeCompare(right);
  return {
    restored: restored.sort(byPath),
    rewritten: rewritten.sort(byPath),
    removed: removed.sort(byPath),
    unchanged: unchanged.sort(byPath),
  };
}
