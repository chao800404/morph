// @vitest-environment node
/**
 * A row keeps its id through everything the editor does to a list, so a
 * selection made before any of it still confirms the same row afterwards.
 *
 * Runs the editor's own helpers in the order an author meets them: the
 * Document is read and repaired (`normalizeDocumentRowIds`, as
 * `findEditorContext` does), saved, read again, reordered, extended, undone
 * and read again. At each step the selection taken at the start — the second
 * row's title — must resolve to that row and no other.
 */
import { describe, expect, it } from "vitest";
import { normalizeDocumentRowIds } from "./normalize-row-ids";
import {
  addArrayRowAtFieldPath,
  swapArrayItemsAtFieldPaths,
} from "./reorder-array-items";
import { rebaseSelectedRowPath } from "./selected-row-identity";

type Row = { id?: string; title: string };
type Props = { items: Row[] };
const document = (items: Row[]) => ({
  version: 1 as const,
  sections: [{ id: "list", type: "list", enabled: true, props: { items } }],
});
const propsOf = (doc: ReturnType<typeof document>) =>
  doc.sections[0]!.props as Props;
/** A JSON round trip, as the database does. */
const persisted = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("a row's id across the editor's operations", () => {
  it("still names the same row after save, reload, reorder, insert and undo", () => {
    // Stored before row identity existed: no ids at all.
    const stored = document([{ title: "A" }, { title: "B" }, { title: "C" }]);

    // Read: the repair gives each row an id, deterministically.
    const read = normalizeDocumentRowIds(stored, "template").value;
    const idOfB = propsOf(read).items[1]!.id!;
    expect(idOfB).toBeTruthy();
    // The same read twice derives the same ids, so the canvas and the panel
    // agree on them before anything is saved.
    expect(normalizeDocumentRowIds(stored, "template").value).toEqual(read);

    // The author selects B's title.
    const selection = { fieldPath: "items.1.title", itemId: idOfB };
    const resolve = (props: Props) =>
      rebaseSelectedRowPath(selection.fieldPath, selection.itemId, props);

    // Save: the edit is built on the repaired document, so the ids are what
    // gets written. Reading it back changes nothing: existing ids are kept.
    const saved = persisted(read);
    const reloaded = normalizeDocumentRowIds(saved, "template");
    expect(reloaded.changed).toBe(false);
    expect(propsOf(reloaded.value).items[1]!.id).toBe(idOfB);

    // An edit to B's text after it has been saved does not touch its id.
    const edited = persisted(saved);
    propsOf(edited).items[1]!.title = "B edited";
    expect(
      propsOf(normalizeDocumentRowIds(edited, "template").value).items[1]!.id,
    ).toBe(idOfB);

    // Reorder: B moves to the front, carrying its id.
    const swapped = swapArrayItemsAtFieldPaths(
      propsOf(edited),
      "items.1",
      "items.0",
    );
    expect(swapped.editable).toBe(true);
    const afterSwap = swapped.value as Props;
    expect(afterSwap.items[0]!.id).toBe(idOfB);
    expect(resolve(afterSwap)).toEqual({
      fieldPath: "items.0.title",
      refused: null,
    });

    // Insert a row at the front: B moves down one, and the new row takes a
    // fresh id that is not B's.
    const inserted = addArrayRowAtFieldPath(
      afterSwap,
      "items",
      { type: "array", fields: { title: { type: "text" } } },
      { afterIndex: -1 },
    );
    expect(inserted.editable).toBe(true);
    const afterInsert = inserted.value as Props;
    if (inserted.editable) expect(inserted.itemId).not.toBe(idOfB);
    expect(resolve(afterInsert).refused).toBeNull();
    expect(
      afterInsert.items[Number(resolve(afterInsert).fieldPath!.split(".")[1])]!
        .id,
    ).toBe(idOfB);

    // Undo restores an earlier snapshot of the props, ids and all.
    const undone = persisted(afterSwap);
    expect(resolve(undone)).toEqual({
      fieldPath: "items.0.title",
      refused: null,
    });

    // And a reload of what is stored keeps every id as it is.
    const final = normalizeDocumentRowIds(
      { ...saved, sections: [{ ...saved.sections[0]!, props: undone }] },
      "template",
    );
    expect(final.changed).toBe(false);
  });

  it("invalidates a selection whose derived id changed before the first save", () => {
    // Until ids are stored, each read derives them again, from content and
    // order. If what is stored changes in between — another writer's save
    // that did not go through the editor's repair, a migration — the same
    // row can come back with a different id. The selection taken against the
    // first read must then be refused, not resolved by its old index.
    const first = normalizeDocumentRowIds(
      document([{ title: "A" }, { title: "B" }]),
      "template",
    ).value;
    const selection = {
      fieldPath: "items.1.title",
      itemId: propsOf(first).items[1]!.id!,
    };

    const reordered = normalizeDocumentRowIds(
      document([{ title: "B" }, { title: "A" }]),
      "template",
    ).value;
    expect(
      rebaseSelectedRowPath(
        selection.fieldPath,
        selection.itemId,
        propsOf(reordered),
      ),
    ).toEqual({ fieldPath: null, refused: "row-lost" });

    const retitled = normalizeDocumentRowIds(
      document([{ title: "A" }, { title: "B changed" }]),
      "template",
    ).value;
    expect(
      rebaseSelectedRowPath(
        selection.fieldPath,
        selection.itemId,
        propsOf(retitled),
      ),
    ).toEqual({ fieldPath: null, refused: "row-lost" });
  });

  it("refuses rather than resolving an id taken from another list", () => {
    // Ids are scoped to their own list. A selection in `items` must not find
    // a row of `links` that happens to hold the same id.
    expect(
      rebaseSelectedRowPath("items.0.title", "shared", {
        items: [{ id: "other", title: "A" }],
        links: [{ id: "shared", title: "L" }],
      }),
    ).toEqual({ fieldPath: null, refused: "row-lost" });
  });
});
