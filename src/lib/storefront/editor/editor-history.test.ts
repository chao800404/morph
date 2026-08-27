import { describe, expect, it, vi } from "vitest";
import {
  createEditorHistory,
  sectionHistoryScope,
  shouldDeferUndoShortcut,
  themeFileHistoryScope,
} from "./editor-history";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function entry(label: string, log: string[]) {
  return {
    label,
    undo: () => {
      log.push(`undo:${label}`);
    },
    redo: () => {
      log.push(`redo:${label}`);
    },
  };
}

describe("editor history", () => {
  it("reverses edits in the order they were made", async () => {
    const log: string[] = [];
    const history = createEditorHistory();
    history.record(entry("padding", log));
    history.record(entry("heading", log));

    await history.undo();
    await history.undo();

    expect(log).toEqual(["undo:heading", "undo:padding"]);
    expect(history.getSnapshot().canUndo).toBe(false);
  });

  it("walks a file back through every state it passed through", async () => {
    // The shape the editor writes files in: each entry holds the whole file
    // before and after one write. Swapping two elements and swapping them back
    // is two writes to one file, so it has to take two presses to undo — the
    // second write must not retire the first entry.
    const history = createEditorHistory();
    let file = "<a /><b />";
    const write = (next: string) => {
      const before = file;
      file = next;
      history.record({
        label: "Reorder",
        scope: themeFileHistoryScope("src/components/Hero.tsx"),
        undo: () => {
          file = before;
        },
        redo: () => {
          file = next;
        },
      });
    };

    write("<b /><a />");
    write("<a /><b />");

    await history.undo();
    expect(file).toBe("<b /><a />");
    await history.undo();
    expect(file).toBe("<a /><b />");
    expect(history.getSnapshot().canUndo).toBe(false);

    await history.redo();
    expect(file).toBe("<b /><a />");
  });

  it("re-applies what was undone, most recent first", async () => {
    const log: string[] = [];
    const history = createEditorHistory();
    history.record(entry("padding", log));
    history.record(entry("heading", log));
    await history.undo();
    await history.undo();
    log.length = 0;

    await history.redo();
    await history.redo();

    expect(log).toEqual(["redo:padding", "redo:heading"]);
  });

  it("drops the redo stack once a new edit is made", async () => {
    // Those changes are no longer the ones that follow this state; offering to
    // re-apply them would produce a document that never existed.
    const log: string[] = [];
    const history = createEditorHistory();
    history.record(entry("padding", log));
    await history.undo();
    expect(history.getSnapshot().canRedo).toBe(true);

    history.record(entry("colour", log));

    expect(history.getSnapshot().canRedo).toBe(false);
    expect(history.getSnapshot().undoLabel).toBe("colour");
  });

  it("discards an edit whose write never landed", async () => {
    // A superseded or conflicted save leaves no change to reverse, and an entry
    // for it would undo something that never happened.
    const log: string[] = [];
    const history = createEditorHistory();
    history.record(entry("padding", log));
    const failed = history.record(entry("heading", log));

    history.discard(failed);
    await history.undo();

    expect(log).toEqual(["undo:padding"]);
  });

  it("discards an entry that has already been undone", async () => {
    const log: string[] = [];
    const history = createEditorHistory();
    const id = history.record(entry("padding", log));
    await history.undo();

    history.discard(id);

    expect(history.getSnapshot().canRedo).toBe(false);
  });

  it("serializes two quick presses instead of interleaving them", async () => {
    // The second press would otherwise read a stack the first has not finished
    // moving, and the two writes would reach storage out of order.
    const gate = deferred();
    const log: string[] = [];
    const history = createEditorHistory();
    history.record(entry("first", log));
    history.record({
      label: "second",
      undo: async () => {
        log.push("undo:second:start");
        await gate.promise;
        log.push("undo:second:end");
      },
      redo: () => {},
    });

    const slow = history.undo();
    const immediate = await history.undo();

    expect(immediate).toBe(false);
    expect(log).toEqual(["undo:second:start"]);
    gate.resolve();
    await slow;
    expect(log).toEqual(["undo:second:start", "undo:second:end"]);
    // Only after the first finishes can the next one run.
    await history.undo();
    expect(log.at(-1)).toBe("undo:first");
  });

  it("keeps the entry in place when the reversal is rejected", async () => {
    // Moving it would leave the stack claiming a reversal that storage refused.
    const history = createEditorHistory();
    history.record({
      label: "padding",
      undo: () => Promise.reject(new Error("version conflict")),
      redo: () => {},
    });

    await expect(history.undo()).rejects.toThrow("version conflict");
    expect(history.getSnapshot().canUndo).toBe(true);
    expect(history.getSnapshot().canRedo).toBe(false);
    expect(history.getSnapshot().busy).toBe(false);
  });

  it("forgets the oldest edits past its limit", () => {
    const log: string[] = [];
    const history = createEditorHistory({ limit: 2 });
    history.record(entry("a", log));
    history.record(entry("b", log));
    history.record(entry("c", log));

    expect(history.getSnapshot().undoLabel).toBe("c");
    void history.undo();
    void history.undo();
    expect(history.getSnapshot().canUndo).toBe(false);
  });

  it("notifies subscribers only when something actually changed", () => {
    const listener = vi.fn();
    const history = createEditorHistory();
    history.subscribe(listener);

    history.record(entry("a", []));
    const afterRecord = listener.mock.calls.length;
    history.discard(9999);

    expect(afterRecord).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledTimes(afterRecord);
  });

  it("returns a stable snapshot while nothing changes", () => {
    const history = createEditorHistory();
    const first = history.getSnapshot();

    history.discard(1234);

    // Referential stability keeps `useSyncExternalStore` from re-rendering the
    // editor on every recorded keystroke.
    expect(history.getSnapshot()).toBe(first);
  });

  it("does nothing when there is nothing to reverse", async () => {
    const history = createEditorHistory();

    expect(await history.undo()).toBe(false);
    expect(await history.redo()).toBe(false);
  });
});

describe("entries invalidated by writes that bypass the history", () => {
  it("retires entries for a file written outside the history", async () => {
    // An entry holds the file as it was before the edit. Typing in Code mode
    // moves the file past that, and replaying the entry would write the older
    // content back — silently discarding what was typed.
    const log: string[] = [];
    const history = createEditorHistory();
    history.record({
      ...entry("padding", log),
      scope: themeFileHistoryScope("src/components/Hero.tsx"),
    });
    history.record({
      ...entry("heading", log),
      scope: themeFileHistoryScope("src/components/Promo.tsx"),
    });

    history.discardScope(themeFileHistoryScope("src/components/Hero.tsx"));
    await history.undo();
    await history.undo();

    // Only the untouched file's edit remains reversible.
    expect(log).toEqual(["undo:heading"]);
  });

  it("retires entries that were already undone", async () => {
    const log: string[] = [];
    const history = createEditorHistory();
    history.record({
      ...entry("padding", log),
      scope: themeFileHistoryScope("src/components/Hero.tsx"),
    });
    await history.undo();

    history.discardScope(themeFileHistoryScope("src/components/Hero.tsx"));

    expect(history.getSnapshot().canRedo).toBe(false);
  });

  it("leaves entries with a different scope alone", () => {
    const log: string[] = [];
    const history = createEditorHistory();
    history.record({ ...entry("a", log), scope: sectionHistoryScope("hero") });

    history.discardScope(sectionHistoryScope("promo"));

    expect(history.getSnapshot().canUndo).toBe(true);
  });

  it("keeps scopes for files and sections apart", () => {
    expect(themeFileHistoryScope("hero")).not.toBe(sectionHistoryScope("hero"));
  });
});

describe("who owns the undo shortcut", () => {
  const target = (
    overrides: Partial<{
      tagName: string;
      isContentEditable: boolean;
      inCodeEditor: boolean;
    }> = {},
  ) => ({
    tagName: overrides.tagName ?? "DIV",
    isContentEditable: overrides.isContentEditable ?? false,
    closest: (selector: string) =>
      overrides.inCodeEditor && selector === ".monaco-editor" ? {} : null,
  });

  it("keeps the shortcut for Inspector property fields", () => {
    // These look like inputs but are controlled property controls: the
    // browser's own undo restores the input's text and React writes the bound
    // value straight back, so the keystroke appears to do nothing. This was a
    // real regression — changing a font size and pressing undo did nothing,
    // because focus was still in the size field.
    expect(shouldDeferUndoShortcut(target({ tagName: "INPUT" }))).toBe(false);
    expect(shouldDeferUndoShortcut(target({ tagName: "TEXTAREA" }))).toBe(false);
  });

  it("leaves the shortcut to the code editor", () => {
    expect(shouldDeferUndoShortcut(target({ inCodeEditor: true }))).toBe(true);
  });

  it("leaves the shortcut to contenteditable regions", () => {
    expect(shouldDeferUndoShortcut(target({ isContentEditable: true }))).toBe(
      true,
    );
  });

  it("handles a missing target", () => {
    expect(shouldDeferUndoShortcut(null)).toBe(false);
    expect(shouldDeferUndoShortcut(undefined)).toBe(false);
    expect(shouldDeferUndoShortcut({})).toBe(false);
  });
});
