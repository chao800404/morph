/**
 * What the code editor's own buffers must become after a rollback.
 *
 * A rollback replaces the whole workspace on the server. The editor keeps its
 * own copy of every file it has touched — a draft per path and a Monaco model
 * per opened file — and a remote reload only refreshes the active file. So
 * after a rollback those copies still hold the workspace from before it: a
 * later save, move or preview sync would read the old text and write it back
 * over the version the author just restored.
 *
 * Every copy the editor holds is reset to the restored content, and a copy of
 * a file the revision does not have is dropped. Nothing is dirty afterwards,
 * which is also what a rollback requires going in: it refuses to run over
 * unsaved edits.
 */
export function planRollbackBufferReset(args: {
  restoredFiles: ReadonlyArray<{ path: string; content: string }>;
  /** Paths the editor holds a draft or an open model for. */
  heldPaths: Iterable<string>;
}): {
  reset: Array<{ path: string; content: string }>;
  drop: string[];
} {
  const restored = new Map(
    args.restoredFiles.map((file) => [file.path, file.content] as const),
  );
  const reset: Array<{ path: string; content: string }> = [];
  const drop: string[] = [];
  for (const path of new Set(args.heldPaths)) {
    const content = restored.get(path);
    if (content === undefined) drop.push(path);
    else reset.push({ path, content });
  }
  return { reset, drop };
}
