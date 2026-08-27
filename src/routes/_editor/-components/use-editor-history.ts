import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  createEditorHistory,
  shouldDeferUndoShortcut,
  type EditorHistoryEntry,
} from "@/lib/storefront/editor/editor-history";

/**
 * Session-scoped undo/redo for the editor.
 *
 * One stack per open editor, never persisted: a stack restored after a reload,
 * or shared with another tab, would offer to reverse edits the person is no
 * longer looking at.
 */
export function useEditorHistory() {
  const history = useMemo(() => createEditorHistory(), []);
  const snapshot = useSyncExternalStore(
    history.subscribe,
    history.getSnapshot,
    history.getSnapshot,
  );

  const run = useCallback(
    async (direction: "undo" | "redo") => {
      try {
        await (direction === "undo" ? history.undo() : history.redo());
      } catch (error) {
        // The entry stays on the stack, so the person can retry once whatever
        // rejected the write has cleared.
        toast.error(
          direction === "undo"
            ? `Could not undo: ${errorMessage(error)}`
            : `Could not redo: ${errorMessage(error)}`,
        );
      }
    },
    [history],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") {
        return;
      }
      // Only a real text editor keeps the shortcut. Inspector fields look like
      // inputs but are controlled property controls, where the browser's own
      // undo does nothing visible.
      if (
        event.target instanceof HTMLElement &&
        shouldDeferUndoShortcut(event.target)
      ) {
        return;
      }
      event.preventDefault();
      void run(event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run]);

  const undo = useCallback(() => void run("undo"), [run]);
  const redo = useCallback(() => void run("redo"), [run]);

  /**
   * Actions, with an identity that never changes.
   *
   * The editor's write paths depend on these. Handing them something rebuilt on
   * every recorded edit would rebuild every callback and effect that depends on
   * them in turn, tearing down and re-establishing subscriptions on each pass —
   * enough to keep the editor's own panels resetting as someone works.
   */
  const actions = useMemo(
    () => ({
      undo,
      redo,
      record: (entry: EditorHistoryEntry) => history.record(entry),
      discard: (id: number) => history.discard(id),
      discardScope: (scope: string) => history.discardScope(scope),
    }),
    [history, redo, undo],
  );

  /** Button state, which changes as edits are recorded and reversed. */
  const state = snapshot;

  return { actions, state };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unexpected error";
}
