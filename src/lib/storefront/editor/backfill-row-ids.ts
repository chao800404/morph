/**
 * Giving every repeated row the identity it should have been created with.
 *
 * A row's `id` is platform metadata, not content: the editor assigns it, a
 * Theme's only use for it is as a React key, and instance styles are addressed
 * by it. Rows created through the editor have carried one since
 * `addArrayRowAtFieldPath`, but the rows a Store starts life with did not — the
 * shell's defaults were authored before the id existed, and an existing layout
 * document is never rebuilt, so those rows outlive any template upgrade.
 *
 * That leaves one list holding both kinds, which is worse than either on its
 * own. `key={item.id ?? index}` then keys some rows by identity and the rest by
 * position: reordering matches the position-keyed ones by where they sit rather
 * than what they are, and the first style edit on a row changes its key from an
 * index to an id, which React reads as a delete and an insert — the row's DOM
 * node, its caret, and anything uncontrolled inside it are discarded while the
 * author is working in it.
 *
 * This is the one-time repair. It is deliberately structural rather than driven
 * by declared content fields: the documents needing it are old enough that the
 * declarations they were written against may no longer describe them, and a row
 * React is about to key is a row whether or not a definition still says so.
 */

/** A row array: non-empty, and every element a plain object. */
function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    )
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An id already worth keeping.
 *
 * Any non-empty string, not just one this codebase minted: the starter shell
 * carries hand-written ids, and a Theme author may have written their own.
 * Re-issuing those would move instance styles off the rows they belong to.
 */
function isUsableRowId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export type BackfillRowIdsResult<T> = {
  /** False when every row already had a distinct id — nothing to write. */
  changed: boolean;
  value: T;
  /** How many rows were given an id they did not have. */
  assigned: number;
  /** How many rows were re-issued because their id was already taken. */
  deduplicated: number;
};

/**
 * Walks a props tree and gives every row a distinct id, leaving all else alone.
 *
 * Idempotent by construction: it only writes where an id is missing or repeated
 * within its own array, so a second run over its own output reports no change.
 * Order and content are preserved — this adds a key and changes nothing a
 * visitor to the Store would see.
 */
export function backfillRowIds<T>(
  value: T,
  createId: () => string,
): BackfillRowIdsResult<T> {
  let assigned = 0;
  let deduplicated = 0;

  function visit(node: unknown): unknown {
    if (isRowArray(node)) {
      // Scoped to this array. Two different lists may legitimately reuse an id,
      // and only a collision within one array can confuse React's matching.
      const seen = new Set<string>();
      return node.map((row) => {
        const visited = visit(row) as Record<string, unknown>;
        const current = visited.id;
        if (isUsableRowId(current) && !seen.has(current)) {
          seen.add(current);
          return visited;
        }
        if (isUsableRowId(current)) deduplicated += 1;
        else assigned += 1;
        let id = createId();
        while (seen.has(id)) id = createId();
        seen.add(id);
        // Spread first so an existing `id` is replaced in place rather than
        // moved to the end: a row's key order is visible in the source the
        // author reads back.
        return { ...visited, id };
      });
    }
    if (Array.isArray(node)) return node.map(visit);
    if (isPlainObject(node)) {
      const next: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node)) next[key] = visit(item);
      return next;
    }
    return node;
  }

  const next = visit(value) as T;
  const changed = assigned > 0 || deduplicated > 0;
  // Unchanged documents keep their original reference so a caller can skip the
  // write without comparing.
  return { changed, value: changed ? next : value, assigned, deduplicated };
}
