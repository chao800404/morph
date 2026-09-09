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
export type ThemeRollbackFile = Readonly<{ path: string; content: string }>;

export type ThemeRollbackPlan = Readonly<{
  /** In the revision, absent now: rollback brings these back. */
  restored: readonly string[];
  /** In both, with different content: rollback rewrites these. */
  rewritten: readonly string[];
  /** Here now, absent from the revision: rollback deletes these. */
  removed: readonly string[];
  /** In both and identical: rollback leaves these alone. */
  unchanged: readonly string[];
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
    args.current.map((file) => [file.path, file.content] as const),
  );
  const targetByPath = new Map(
    args.target.map((file) => [file.path, file.content] as const),
  );

  const restored: string[] = [];
  const rewritten: string[] = [];
  const unchanged: string[] = [];
  for (const [path, content] of targetByPath) {
    if (!currentByPath.has(path)) {
      restored.push(path);
      continue;
    }
    (currentByPath.get(path) === content ? unchanged : rewritten).push(path);
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
