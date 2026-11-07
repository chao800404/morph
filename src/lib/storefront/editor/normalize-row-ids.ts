/**
 * Giving every repeated row the identity it should have been created with.
 *
 * A row's `id` is platform metadata, not content: the editor assigns it,
 * instance styles are addressed by it, and a Theme's only use for it is as a
 * React key. Rows created through the editor have carried one since
 * `addArrayRowAtFieldPath`, but the rows a Store starts life with did not — the
 * shell's defaults were authored before the id existed, and an existing layout
 * document is only ever seeded, never rebuilt, so those rows outlive any
 * template upgrade.
 *
 * One list holding both kinds is worse than either alone. `key={item.id ??
 * index}` then keys some rows by identity and the rest by position: reordering
 * matches the position-keyed ones by where they sit rather than what they are,
 * and the first style edit on a row changes its key from an index to an id,
 * which React reads as a delete and an insert — the row's DOM node, its caret,
 * and anything uncontrolled inside it are discarded while the author is working
 * in it.
 *
 * ## Why the ids are derived rather than drawn
 *
 * This runs twice over the same input: once in the browser when the editor
 * loads, so the author never sees a mixed list, and once on the server when the
 * first real edit is saved, against the same authoritative document. Those two
 * runs must agree to the byte. A random id would make the server's response
 * renumber every row the browser had already rendered and remount all of them —
 * the exact loss this repair exists to prevent, delivered at the moment the
 * author hits save.
 *
 * So a repaired id is a function of where the row is and what it holds:
 * template, section, field path, position, and the row's own content. Both
 * sides import this function; neither is allowed a copy of its own.
 *
 * Repaired ids live in their own `morph-mig-` namespace, kept clear of
 * `createMorphItemId`, so a repair can never be mistaken for — or collide with
 * — an id the editor minted for a row the author created.
 */

export const MIGRATED_ROW_ID_PREFIX = "morph-mig-";

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
 * carries hand-written ids and a Theme author may have written their own.
 * Re-issuing those would move instance styles off the rows they belong to.
 */
function isUsableRowId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The row's content, written the same way every time.
 *
 * Keys are sorted because object order is not guaranteed to survive a JSON
 * round trip through the database, and an id that depended on it would differ
 * between the browser's copy and the server's. `id` itself is left out, so a
 * row missing one and a row holding a blank one derive the same id.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "id")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body = entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",");
  return `{${body}}`;
}

/**
 * FNV-1a, run twice with different multipliers for a 64-bit-wide result.
 *
 * Deliberately synchronous rather than `crypto.subtle`, which is async and
 * would make this impossible to call while rendering. It does not need to
 * resist an attacker — nobody gains anything from colliding two row ids — and a
 * collision is resolved below rather than trusted away.
 */
function hash(input: string): string {
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export type RowIdScope = {
  /** The template the document belongs to. */
  templateId: string;
  /** The section placement these props belong to. */
  sectionId: string;
};

export type NormalizeRowIdsResult<T> = {
  /** False when every row already had a distinct id — nothing to write. */
  changed: boolean;
  value: T;
  /** How many rows were given an id they did not have. */
  assigned: number;
  /** How many rows were re-issued because their id was already taken. */
  deduplicated: number;
};

/** Separator that cannot occur in the parts: JSON escapes a NUL in a string. */
const FIELD_SEPARATOR = "\u0000";

/**
 * Walks one section's props and gives every row a distinct id, leaving all else
 * alone.
 *
 * Idempotent by construction: it only writes where an id is missing or repeated
 * within its own array, so a second run over its own output reports no change.
 * Order and content are preserved — this adds a key and changes nothing a
 * visitor to the Store would see.
 */
export function normalizeRowIds<T>(
  value: T,
  scope: RowIdScope,
): NormalizeRowIdsResult<T> {
  let assigned = 0;
  let deduplicated = 0;

  function visit(node: unknown, path: string): unknown {
    if (isRowArray(node)) {
      // Scoped to this array. Two different lists may legitimately reuse an id,
      // and only a collision within one array can confuse React's matching.
      // Every existing id is reserved up front, so the repair for row 1 cannot
      // land on the id row 3 already holds.
      const taken = new Set(
        node.map((row) => row.id).filter(isUsableRowId) as string[],
      );
      const used = new Set<string>();
      return node.map((row, index) => {
        const visited = visit(row, `${path}.${index}`) as Record<
          string,
          unknown
        >;
        const current = visited.id;
        if (isUsableRowId(current) && !used.has(current)) {
          used.add(current);
          return visited;
        }
        if (isUsableRowId(current)) deduplicated += 1;
        else assigned += 1;
        const base =
          MIGRATED_ROW_ID_PREFIX +
          hash(
            [
              scope.templateId,
              scope.sectionId,
              path,
              String(index),
              canonicalize(visited),
            ].join(FIELD_SEPARATOR),
          );
        // Suffixed rather than re-derived, so the repair for a genuine
        // collision is still reproducible from the same input.
        let id = base;
        let suffix = 1;
        while (taken.has(id) || used.has(id)) {
          suffix += 1;
          id = `${base}-${suffix}`;
        }
        used.add(id);
        taken.add(id);
        // Spread first so an existing `id` is replaced in place rather than
        // moved to the end: a row's key order is visible in the source the
        // author reads back.
        return { ...visited, id };
      });
    }
    if (Array.isArray(node)) {
      return node.map((item, index) => visit(item, `${path}.${index}`));
    }
    if (isPlainObject(node)) {
      const next: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node)) {
        next[key] = visit(item, path ? `${path}.${key}` : key);
      }
      return next;
    }
    return node;
  }

  const next = visit(value, "") as T;
  const changed = assigned > 0 || deduplicated > 0;
  // Unchanged documents keep their original reference so a caller can skip the
  // write without comparing.
  return { changed, value: changed ? next : value, assigned, deduplicated };
}

/**
 * The rows of one list the Document does not store yet, with the ids its first
 * edit will store.
 *
 * The Inspector shows such a list from the component's own defaults, which
 * carry no ids. It keys each row card by this result from the first render and
 * hands the same result to the first edit as the list to store, so the card a
 * row is drawn in keeps its key through that edit — and the input inside it,
 * its focus and its caret with it.
 *
 * Exactly what `normalizeDocumentRowIds` gives the same rows under the same
 * section: the derivation reads only template, section, the list's own field
 * path, each row's position and each row's content, so the other props of the
 * section are irrelevant to it. Call it only on rows as the component declares
 * them, never on a list an edit has touched: a derived id depends on the row's
 * content.
 */
export function identifyUnstoredListRows(
  fieldKey: string,
  rows: unknown,
  scope: RowIdScope,
): unknown {
  return normalizeRowIds({ [fieldKey]: rows }, scope).value[fieldKey];
}

/** The shape this needs of a page document, so it can be used from either side. */
type RowIdDocument = {
  sections: Array<{ id: string; props: Record<string, unknown> }>;
};

/**
 * One whole document normalized, section by section.
 *
 * The function both sides call. The browser runs it on what it loads so the
 * author never works against a mixed list, and the server runs it on the
 * authoritative document before applying an edit, so the ids that get written
 * are the same ones already on screen.
 *
 * Applied to the document as it was read, never to one an edit has already
 * touched: a repaired id is derived partly from the row's content, so
 * normalizing after an edit would derive a different id for the row the author
 * just typed in — and renumbering a row is how it loses the DOM node, and the
 * caret, that this exists to protect.
 */
export function normalizeDocumentRowIds<D extends RowIdDocument>(
  document: D,
  templateId: string,
): NormalizeRowIdsResult<D> {
  let assigned = 0;
  let deduplicated = 0;
  const sections = document.sections.map((section) => {
    const result = normalizeRowIds(section.props, {
      templateId,
      sectionId: section.id,
    });
    if (!result.changed) return section;
    assigned += result.assigned;
    deduplicated += result.deduplicated;
    return { ...section, props: result.value };
  });

  const changed = assigned > 0 || deduplicated > 0;
  return {
    changed,
    value: changed ? { ...document, sections } : document,
    assigned,
    deduplicated,
  };
}
