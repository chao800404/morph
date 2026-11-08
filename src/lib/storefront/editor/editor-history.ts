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

/**
 * One run of an entry's undo or redo.
 *
 * Every run gets its own `attemptId`. A write whose answer was lost can later
 * be found to have landed; `confirm` then completes that very run, once,
 * without running anything again. A later run of the same entry (a retry, or
 * an undo/redo round trip) closes the earlier one.
 */
export type EditorHistoryAttempt = Readonly<{
  entryId: number;
  direction: "undo" | "redo";
  attemptId: number;
}>;

export type EditorHistoryAction = (
  attempt: EditorHistoryAttempt,
) => Promise<unknown> | unknown;

/** What `confirm` did; see there. */
export type EditorHistoryConfirmation = "moved" | "deferred" | "stale";

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
  /**
   * How many edits have been recorded and not yet undone.
   *
   * `canUndo` cannot answer "did the edit I just made land". It is already true
   * from the first recorded edit, so it stays true while a later write is still
   * in flight, and a caller waiting on it returns early. Depth is the count of
   * writes that really landed — `record()` is called from the save's `onSaved`,
   * and `discard()` takes back one that did not — so it is the only monotonic
   * signal that can tell "this write landed" from "an earlier one did".
   *
   * The end-to-end suite waits on it, for the exact count the test caused. It
   * is on the snapshot rather than derived by the caller because the caller
   * cannot see `past`.
   */
  depth: number;
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
  /**
   * Completes a step that already happened, without running it again: the
   * run `attemptId` threw (its answer was lost) and its write was later
   * found to have landed.
   *
   * Only `attemptId` being the entry's latest open run counts; anything else
   * (a duplicate, a run superseded by a later one, an entry cleared or
   * discarded) is "stale" and leaves no trace. For the latest open run:
   * - "moved": no step is running and the entry is on top of the stack for
   *   `direction`; it moves now, and the run is consumed;
   * - "deferred": it cannot move now (a step is running, or another entry is
   *   on top). The run is marked landed: the entry's next step in that
   *   direction moves it without running its action, provided that run is
   *   still the entry's latest open one when the step starts.
   *
   * Neither "deferred" nor "stale" says anything about the write. Neither is
   * ever a reason to send it again.
   */
  confirm(
    entryId: number,
    direction: "undo" | "redo",
    attemptId: number,
  ): EditorHistoryConfirmation;
  /**
   * Whether `entryId` is the entry the next step in `direction` would run.
   * A step's own action asks this after doing something that may record (an
   * input still pending, saved first): an entry recorded on top meanwhile
   * is the latest step now, and the action does not run over it.
   */
  isOnTop(entryId: number, direction: "undo" | "redo"): boolean;
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
  let nextAttemptId = 1;
  /**
   * Each entry's latest run that threw, until a later run or confirm closes
   * it (or the entry leaves the history). `landed`: confirmed while it could
   * not move (`confirm` answered "deferred").
   */
  const openAttempts = new Map<
    number,
    { attempt: EditorHistoryAttempt; landed: boolean }
  >();
  /** The entry whose step is running, if one is. */
  let running: StoredEntry | null = null;
  let busy = false;
  let snapshot: EditorHistorySnapshot = {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    busy: false,
    depth: 0,
  };
  const listeners = new Set<() => void>();

  function publish() {
    const next: EditorHistorySnapshot = {
      canUndo: !busy && past.length > 0,
      canRedo: !busy && future.length > 0,
      undoLabel: past.at(-1)?.label ?? null,
      redoLabel: future.at(-1)?.label ?? null,
      busy,
      depth: past.length,
    };
    if (
      next.canUndo === snapshot.canUndo &&
      next.canRedo === snapshot.canRedo &&
      next.undoLabel === snapshot.undoLabel &&
      next.redoLabel === snapshot.redoLabel &&
      next.busy === snapshot.busy &&
      // Without this the depth is on the snapshot but never republished, and a
      // subscriber waiting for it waits forever — the failure mode this field
      // exists to remove, reintroduced one layer down.
      next.depth === snapshot.depth
    ) {
      return;
    }
    // A stable object while nothing changed keeps `useSyncExternalStore` from
    // re-rendering the whole editor on every keystroke that records an edit.
    snapshot = next;
    for (const listener of listeners) listener();
  }

  /**
   * Moves exactly `entry` to the other stack: by identity, never whatever is
   * on top, since an entry may have been recorded while its step ran (the
   * step saved input still pending first). Read from the stacks as they are
   * now, for `record` and `discard` replace them.
   */
  function move(entry: StoredEntry, direction: "undo" | "redo") {
    if (direction === "undo") {
      past = past.filter((candidate) => candidate !== entry);
      future.push(entry);
    } else {
      // A redo's entry is gone from `future` when an edit was recorded while
      // it ran; it ran all the same, after that edit, and goes on top of it.
      future = future.filter((candidate) => candidate !== entry);
      past.push(entry);
    }
  }

  /** Drops the open runs of entries no longer in the history. */
  function forgetRuns(removed: readonly StoredEntry[]) {
    for (const entry of removed) openAttempts.delete(entry.id);
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
    const entry = (direction === "undo" ? past : future).at(-1);
    if (!entry) return false;

    // Its last run's write was found landed while it could not move: that
    // run is completed now, and nothing is run or written again.
    const open = openAttempts.get(entry.id);
    if (open?.landed && open.attempt.direction === direction) {
      openAttempts.delete(entry.id);
      move(entry, direction);
      publish();
      return true;
    }

    busy = true;
    running = entry;
    publish();
    const attempt: EditorHistoryAttempt = {
      entryId: entry.id,
      direction,
      attemptId: nextAttemptId++,
    };
    // This run supersedes any earlier one of the same entry, and its mark.
    const run = { attempt, landed: false };
    openAttempts.set(entry.id, run);
    try {
      await (direction === "undo" ? entry.undo(attempt) : entry.redo(attempt));
    } catch (error) {
      // The entry stays where it is. Moving it would leave the stack claiming a
      // reversal that storage rejected.
      running = null;
      busy = false;
      publish();
      throw error;
    }
    running = null;
    // Discarded or cleared while it ran: it is no longer in the history.
    if (openAttempts.get(entry.id) === run) {
      openAttempts.delete(entry.id);
      move(entry, direction);
    }
    busy = false;
    publish();
    return true;
  }

  return {
    record(entry) {
      const stored: StoredEntry = { ...entry, id: nextId++ };
      past.push(stored);
      if (past.length > limit) {
        forgetRuns(past.slice(0, past.length - limit));
        past = past.slice(past.length - limit);
      }
      // A new edit invalidates everything that was undone: those changes are no
      // longer the ones that follow this state. A redo running now keeps its
      // run: it is moved once it is answered (`move`).
      forgetRuns(future.filter((candidate) => candidate !== running));
      future = [];
      publish();
      return stored.id;
    },
    discard(id) {
      const before = past.length + future.length;
      past = past.filter((entry) => entry.id !== id);
      future = future.filter((entry) => entry.id !== id);
      openAttempts.delete(id);
      if (past.length + future.length !== before) publish();
    },
    discardScope(scope) {
      const before = past.length + future.length;
      forgetRuns([...past, ...future].filter((entry) => entry.scope === scope));
      past = past.filter((entry) => entry.scope !== scope);
      future = future.filter((entry) => entry.scope !== scope);
      if (past.length + future.length !== before) publish();
    },
    undo: () => step("undo"),
    redo: () => step("redo"),
    confirm(entryId, direction, attemptId) {
      const open = openAttempts.get(entryId);
      if (
        !open ||
        open.attempt.direction !== direction ||
        open.attempt.attemptId !== attemptId
      ) {
        return "stale";
      }
      const entry = (direction === "undo" ? past : future).at(-1);
      if (busy || !entry || entry.id !== entryId) {
        open.landed = true;
        return "deferred";
      }
      openAttempts.delete(entryId);
      move(entry, direction);
      publish();
      return "moved";
    },
    isOnTop: (entryId, direction) =>
      (direction === "undo" ? past : future).at(-1)?.id === entryId,
    clear() {
      past = [];
      future = [];
      openAttempts.clear();
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
