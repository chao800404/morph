/**
 * Which row a selection inside a repeated field points at, now.
 *
 * A selection names its row by index (`items.1.title`), which is only true
 * until the rows move. A reorder, an insert above it, an undo or another tab's
 * save can each put a different row at index 1 while the Inspector is still
 * open — and writing to the path as selected would then change a row the
 * author never touched. The row's `id` is what stays with it, so the path is
 * re-read through the id before anything is shown or written:
 *
 * - the row is still at its index: the path stands;
 * - it moved: the path follows it to where it is now;
 * - it is gone: there is no row to write to, and the selection is `lost`.
 *
 * Without an id at selection time there is nothing to confirm against, and
 * the path is used as given; rows the editor creates always carry one.
 */
export type SelectedRowPath = Readonly<{
  fieldPath: string | null;
  lost: boolean;
}>;

const ROW_PATH = /^([^.]+)\.(\d+)(\..+)?$/;

export function rebaseSelectedRowPath(
  fieldPath: string | null | undefined,
  itemId: string | null | undefined,
  props: Readonly<Record<string, unknown>>,
): SelectedRowPath {
  const unchanged = { fieldPath: fieldPath ?? null, lost: false };
  if (!fieldPath || !itemId) return unchanged;
  const match = ROW_PATH.exec(fieldPath);
  if (!match) return unchanged;
  const [, key, rawIndex, rest = ""] = match;
  const rows = props[key!];
  // Rows nothing stores yet are the component's own defaults, which nothing
  // can have reordered.
  if (!Array.isArray(rows)) return unchanged;
  const idOf = (row: unknown) =>
    row && typeof row === "object" ? (row as { id?: unknown }).id : undefined;
  if (idOf(rows[Number(rawIndex)]) === itemId) return unchanged;
  const index = rows.findIndex((row) => idOf(row) === itemId);
  return index < 0
    ? { fieldPath: null, lost: true }
    : { fieldPath: `${key}.${index}${rest}`, lost: false };
}
