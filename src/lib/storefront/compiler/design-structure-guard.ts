import { sourceStructureState } from "./theme-route-sections";

/**
 * The Design structure capability guard: may a Design section structure
 * write (reorder, add, detach, remove, bind, and their undo, redo and
 * resends) change these files?
 *
 * Not a proof that the rewrite is right: the server does not recompute it.
 * It checks that Design was allowed to change the structure of every source
 * file the write changes, on one snapshot of the Theme, with the same
 * analysis the editor's rewriters refuse with. The operation name selects
 * this check; it authorises nothing (handoff/2026-10-31,
 * server-structure-guard-proposal.md, user decisions).
 *
 * For every source file the write changes or deletes:
 *
 * - the file as stored is judged first. A locked file stays refused even
 *   when the same write changes or deletes what locks it (its loader's
 *   module): a Design write cannot unlock a route for itself;
 * - then the file as it would be after the write (stored files, with this
 *   write's files over them and its deletions removed). A file that does
 *   not exist yet is judged here only;
 * - a file the analysis cannot read, before or after, is refused: Design
 *   cannot tell what the write does to its sections.
 *
 * Every file is judged, not only the one the editor names; a write that
 * changes two routes has both judged.
 */

export const DESIGN_STRUCTURE_UNKNOWN_MESSAGE =
  "Design cannot tell how this change affects the page's sections. Make it in Code mode.";

export type DesignStructureRefusal = Readonly<{
  ok: false;
  error: "DESIGN_STRUCTURE_LOCKED" | "DESIGN_STRUCTURE_UNKNOWN";
  message: string;
  path: string;
}>;

type SourceFile = Readonly<{ path: string; content?: string | null }>;

/** Files whose structure the analysis reads; anything else is not judged. */
const SOURCE_FILE = /\.(tsx|jsx|ts|js|mts|mjs)$/;

export function judgeDesignStructureWrite(
  stored: readonly SourceFile[],
  writes: ReadonlyArray<Readonly<{ path: string; content: string }>>,
  deletions: readonly string[],
): Readonly<{ ok: true }> | DesignStructureRefusal {
  const removed = new Set(deletions);
  const written = new Map(writes.map((write) => [write.path, write.content]));
  const candidate: SourceFile[] = [
    ...stored.filter(
      (file) => !removed.has(file.path) && !written.has(file.path),
    ),
    ...writes.map((write) => ({ path: write.path, content: write.content })),
  ];
  const changed = [...new Set([...written.keys(), ...removed])]
    .filter((path) => SOURCE_FILE.test(path))
    .sort();

  for (const path of changed) {
    // Stored first: a write cannot unlock a file for itself. Then after.
    const states = [
      sourceStructureState(stored, path),
      removed.has(path) ? null : sourceStructureState(candidate, path),
    ];
    for (const state of states) {
      if (!state || state.kind === "open" || state.kind === "absent") continue;
      return state.kind === "locked"
        ? {
            ok: false,
            error: "DESIGN_STRUCTURE_LOCKED",
            message: state.reason,
            path,
          }
        : {
            ok: false,
            error: "DESIGN_STRUCTURE_UNKNOWN",
            message: DESIGN_STRUCTURE_UNKNOWN_MESSAGE,
            path,
          };
    }
  }
  return { ok: true };
}
