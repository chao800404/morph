/**
 * Undo/redo for edits that are already persisted.
 *
 * Every editor action writes through to storage — component source or the
 * Document — so undo cannot be "restore the previous state object". The change
 * has happened; the server has a newer version of it. Undo has to be a real
 * edit in the opposite direction, replayed through the same write path so it
 * inherits the same version checks, debouncing and preview sync.
 *
 * Entries therefore carry functions, not snapshots: each one knows how to
 * re-apply the value that was there before, and how to put the new one back.
 * Storing snapshots instead would replace state the server has already moved
 * on from, and would silently drop any side effect the action had.
 *
 * Scope is one editor session. A stack shared across tabs or restored after a
 * reload would undo edits the person is no longer looking at.
 */

export type EditorHistoryAction = () => Promise<unknown> | unknown;

export type EditorHistoryEntry = Readonly<{
  /** Shown to the person, e.g. "Padding". */
  label: string;
  /**
   * What this entry's stored value describes, such as one theme file.
   *
   * An entry carries the content that was in place before the edit. Anything
   * that writes the same thing without going through the history makes that
   * content stale, and replaying it would discard the newer write — typing in
   * Code mode and then pressing undo would silently lose the typing. Naming the
   * scope lets those writes retire the entries they invalidate.
   */
  scope?: string;
  /** Re-applies the value that was in place before the edit. */
  undo: EditorHistoryAction;
  /** Re-applies the edit. */
  redo: EditorHistoryAction;
}>;

/** Scope key for edits whose stored value is the whole of one theme file. */
export function themeFileHistoryScope(filePath: string): string {
  return `file:${filePath}`;
}

/** Scope key for edits whose stored value is one section's stored props. */
export function sectionHistoryScope(sectionId: string): string {
  return `section:${sectionId}`;
}

type StoredEntry = EditorHistoryEntry & { id: number };

export type EditorHistorySnapshot = Readonly<{
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the edit `undo()` would reverse, for a tooltip. */
  undoLabel: string | null;
  /** Label of the edit `redo()` would re-apply. */
  redoLabel: string | null;
  /** True while an undo or redo is still being written. */
  busy: boolean;
}>;

export const DEFAULT_EDITOR_HISTORY_LIMIT = 100;

export type EditorHistory = Readonly<{
  /**
   * Registers an edit that has been applied.
   *
   * Returns an id so the caller can `discard` it if the write turns out not to
   * have landed — a superseded or conflicted save must not leave an entry that
   * would "undo" a change that never happened.
   */
  record(entry: EditorHistoryEntry): number;
  discard(id: number): void;
  /**
   * Retires every entry describing the given scope.
   *
   * Called when something writes that scope without going through the history,
   * because those entries now hold a value the write has moved past.
   */
  discardScope(scope: string): void;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  clear(): void;
  getSnapshot(): EditorHistorySnapshot;
  subscribe(listener: () => void): () => void;
}>;

export function createEditorHistory(
  options: { limit?: number } = {},
): EditorHistory {
  const limit = Math.max(1, options.limit ?? DEFAULT_EDITOR_HISTORY_LIMIT);
  let past: StoredEntry[] = [];
  let future: StoredEntry[] = [];
  let nextId = 1;
  let busy = false;
  let snapshot: EditorHistorySnapshot = {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    busy: false,
  };
  const listeners = new Set<() => void>();

  function publish() {
    const next: EditorHistorySnapshot = {
      canUndo: !busy && past.length > 0,
      canRedo: !busy && future.length > 0,
      undoLabel: past.at(-1)?.label ?? null,
      redoLabel: future.at(-1)?.label ?? null,
      busy,
    };
    if (
      next.canUndo === snapshot.canUndo &&
      next.canRedo === snapshot.canRedo &&
      next.undoLabel === snapshot.undoLabel &&
      next.redoLabel === snapshot.redoLabel &&
      next.busy === snapshot.busy
    ) {
      return;
    }
    // A stable object while nothing changed keeps `useSyncExternalStore` from
    // re-rendering the whole editor on every keystroke that records an edit.
    snapshot = next;
    for (const listener of listeners) listener();
  }

  /**
   * Runs one direction, serialized.
   *
   * Two quick presses must not interleave: the second would read a stack the
   * first has not finished moving, and the writes would reach storage out of
   * order.
   */
  async function step(direction: "undo" | "redo"): Promise<boolean> {
    if (busy) return false;
    const source = direction === "undo" ? past : future;
    const target = direction === "undo" ? future : past;
    const entry = source.at(-1);
    if (!entry) return false;

    busy = true;
    publish();
    try {
      await (direction === "undo" ? entry.undo() : entry.redo());
    } catch (error) {
      // The entry stays where it is. Moving it would leave the stack claiming a
      // reversal that storage rejected.
      busy = false;
      publish();
      throw error;
    }
    source.pop();
    target.push(entry);
    busy = false;
    publish();
    return true;
  }

  return {
    record(entry) {
      const stored: StoredEntry = { ...entry, id: nextId++ };
      past.push(stored);
      if (past.length > limit) past = past.slice(past.length - limit);
      // A new edit invalidates everything that was undone: those changes are no
      // longer the ones that follow this state.
      future = [];
      publish();
      return stored.id;
    },
    discard(id) {
      const before = past.length + future.length;
      past = past.filter((entry) => entry.id !== id);
      future = future.filter((entry) => entry.id !== id);
      if (past.length + future.length !== before) publish();
    },
    discardScope(scope) {
      const before = past.length + future.length;
      past = past.filter((entry) => entry.scope !== scope);
      future = future.filter((entry) => entry.scope !== scope);
      if (past.length + future.length !== before) publish();
    },
    undo: () => step("undo"),
    redo: () => step("redo"),
    clear() {
      past = [];
      future = [];
      publish();
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Minimal shape of the element an undo shortcut was aimed at. */
export type UndoShortcutTarget = Readonly<{
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}>;

/** Selector for the container Monaco renders its own textarea inside. */
export const CODE_EDITOR_CONTAINER_SELECTOR = ".monaco-editor";

/**
 * Whether the editor should leave the undo shortcut to whatever has focus.
 *
 * Only a real text editor is left alone. Inspector fields look like inputs but
 * are controlled property controls: the browser's own undo would restore the
 * input's text and React would immediately write the bound value back, so the
 * keystroke appears to do nothing. What someone means by undo while a property
 * field has focus is "reverse the change I just made", which is the editor's
 * history — this is how Figma and Webflow behave too.
 */
export function shouldDeferUndoShortcut(
  target: UndoShortcutTarget | null | undefined,
): boolean {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  return Boolean(target.closest?.(CODE_EDITOR_CONTAINER_SELECTOR));
}
