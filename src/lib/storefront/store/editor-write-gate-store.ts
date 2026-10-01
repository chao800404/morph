import { create } from "zustand";
import {
  OPEN_EDITOR_WRITE_GATE,
  beginEditorWriteVerification,
  claimEditorWriteGate,
  confirmEditorWriteResume,
  editorWriterChanged,
  finishEditorWriteVerification,
  pauseEditorWrites,
  type EditorWriteArea,
  type EditorWriteGate,
  type EditorWriteRefusal,
  type EditorWriteVerification,
} from "../editor/editor-write-gate";
import { toWorkspaceKey, type WorkspaceScope } from "./theme-workspace-store";

/**
 * The editor's write gate, one per storefront Theme.
 *
 * Keyed like the Theme workspace, so a refusal met while editing one Theme
 * never pauses another, and a verification begun for one Theme can only ever
 * answer for that Theme — the author moving to another mid-way leaves the new
 * one's gate untouched.
 *
 * Held in memory only. A paused gate belongs to this tab's session, and a
 * reload starts the editor over, signed in or not.
 */
export type EditorWriteGateStore = {
  gates: Record<string, EditorWriteGate>;
  /** Records a refusal; returns the gate, which is unchanged for a repeat. */
  pause: (
    scope: WorkspaceScope,
    refusal: EditorWriteRefusal,
    area: EditorWriteArea,
  ) => EditorWriteGate;
  /** The epoch to finish with, or null when there is nothing to verify. */
  beginVerification: (scope: WorkspaceScope) => number | null;
  finishVerification: (
    scope: WorkspaceScope,
    epoch: number,
    answer: EditorWriteVerification,
  ) => EditorWriteGate;
  /** Whether the author's confirmation opened the gate. */
  confirmResume: (scope: WorkspaceScope, epoch: number) => boolean;
  /** Stops writes because another account is signed in here now. */
  writerChanged: (scope: WorkspaceScope) => EditorWriteGate;
  /** Records whose unsaved work a paused gate holds. */
  claimOwner: (scope: WorkspaceScope, userId: string) => void;
};

export const useEditorWriteGateStore = create<EditorWriteGateStore>(
  (set, get) => {
    const update = (
      scope: WorkspaceScope,
      step: (gate: EditorWriteGate) => EditorWriteGate | null,
    ): EditorWriteGate | null => {
      const key = toWorkspaceKey(scope.storefrontId, scope.themeId);
      const current = get().gates[key] ?? OPEN_EDITOR_WRITE_GATE;
      const next = step(current);
      if (next && next !== current) {
        set((state) => ({ gates: { ...state.gates, [key]: next } }));
      }
      return next;
    };

    return {
      gates: {},
      pause: (scope, refusal, area) =>
        update(scope, (gate) => pauseEditorWrites(gate, refusal, area))!,
      beginVerification: (scope) =>
        update(scope, beginEditorWriteVerification)?.epoch ?? null,
      finishVerification: (scope, epoch, answer) =>
        update(scope, (gate) =>
          finishEditorWriteVerification(gate, epoch, answer),
        )!,
      writerChanged: (scope) => update(scope, editorWriterChanged)!,
      claimOwner: (scope, userId) => {
        update(scope, (gate) => claimEditorWriteGate(gate, userId));
      },
      confirmResume: (scope, epoch) => {
        let opened = false;
        update(scope, (gate) => {
          const next = confirmEditorWriteResume(gate, epoch);
          opened = next !== gate;
          return next;
        });
        return opened;
      },
    };
  },
);

export function editorWriteGateFor(
  gates: Record<string, EditorWriteGate>,
  scope: WorkspaceScope,
): EditorWriteGate {
  return (
    gates[toWorkspaceKey(scope.storefrontId, scope.themeId)] ??
    OPEN_EDITOR_WRITE_GATE
  );
}
