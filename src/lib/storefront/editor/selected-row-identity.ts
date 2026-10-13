/**
 * Which row a selection inside a repeated field points at, now — or why no
 * row can be confirmed.
 *
 * A selection names its row by index (`items.1.title`), which is only true
 * until the rows move. A reorder, an insert above it, an undo or another tab's
 * save can each put a different row at index 1 while the Inspector is still
 * open — and writing to the path as selected would then change a row the
 * author never touched. The row's `id` is what stays with it, so the path is
 * re-read through the id before anything is shown or written.
 *
 * The id has to be there and has to be unique. A row with none, or one whose
 * id another row shares, cannot be told apart from its neighbours, and the
 * write is refused rather than sent to whichever row the index names. Stored
 * rows always carry distinct ids (`normalizeDocumentRowIds` repairs them when
 * the editor loads and again when the server saves), so a refusal here means
 * something moved underneath the selection, not ordinary data.
 *
 * This is the editor's half. The server still accepts or refuses the whole
 * write on its own terms — the capability it resolves and the Document's
 * generation (OCC) — whatever the editor concluded here.
 */
export type SelectedRowRefusal =
  "row-lost" | "row-id-missing" | "row-id-duplicate";

export type SelectedRowPath = Readonly<{
  fieldPath: string | null;
  /** Why the selected row cannot be confirmed; `null` when it can. */
  refused: SelectedRowRefusal | null;
}>;

const ROW_PATH = /^([^.]+)\.(\d+)(\..+)?$/;

/** Whether a path addresses a row of a repeated field (`items.2…`). */
export function isRowFieldPath(fieldPath: string | null | undefined): boolean {
  return Boolean(fieldPath && ROW_PATH.test(fieldPath));
}

export function rebaseSelectedRowPath(
  fieldPath: string | null | undefined,
  itemId: string | null | undefined,
  props: Readonly<Record<string, unknown>>,
): SelectedRowPath {
  const match = fieldPath ? ROW_PATH.exec(fieldPath) : null;
  // Not a row: a top-level field has no index to go stale.
  if (!match) return { fieldPath: fieldPath ?? null, refused: null };
  if (!itemId) return { fieldPath: null, refused: "row-id-missing" };
  const [, key, , rest = ""] = match;
  const rows = props[key!];
  // Rows nothing stores yet are the component's own defaults: nothing can
  // have reordered them, and the preview reported this id as unique among
  // them when it was selected.
  if (!Array.isArray(rows)) return { fieldPath: fieldPath!, refused: null };
  const idOf = (row: unknown) =>
    row && typeof row === "object" ? (row as { id?: unknown }).id : undefined;
  const matches = rows.flatMap((row, index) =>
    idOf(row) === itemId ? [index] : [],
  );
  if (matches.length === 0) return { fieldPath: null, refused: "row-lost" };
  if (matches.length > 1) {
    return { fieldPath: null, refused: "row-id-duplicate" };
  }
  return { fieldPath: `${key}.${matches[0]}${rest}`, refused: null };
}
