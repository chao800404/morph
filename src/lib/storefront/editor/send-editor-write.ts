import {
  EditorWritePaused,
  editorWriteRefusal,
  refusalOfError,
  type EditorWriteArea,
  type EditorWriteRefusal,
} from "./editor-write-gate";
import {
  editorWriteGateFor,
  useEditorWriteGateStore,
} from "../store/editor-write-gate-store";
import type { WorkspaceScope } from "../store/theme-workspace-store";

/**
 * Sends one editor write, unless the editor's writes are paused.
 *
 * Every write the editor makes goes through here, wrapped around the call it
 * already made — not around a button — so a keyboard shortcut, a debounce
 * timer or a queued save meets the same check as a click.
 *
 * - Paused: nothing is sent, and `EditorWritePaused` is thrown.
 * - Refused by the server for who is asking: the gate is paused, and the same
 *   `EditorWritePaused` is thrown in place of the server's error.
 * - Anything else — success, a conflict, an ordinary failure — is the caller's
 *   exactly as before.
 *
 * `refusalOfResult` is for an endpoint that answers a refusal as a result
 * rather than throwing; it states that endpoint's own contract.
 */
export async function sendEditorWrite<T>(
  scope: WorkspaceScope,
  area: EditorWriteArea,
  send: () => Promise<T>,
  options?: { refusalOfResult?: (result: T) => EditorWriteRefusal | null },
): Promise<T> {
  const gates = useEditorWriteGateStore.getState();
  const before = editorWriteRefusal(
    editorWriteGateFor(gates.gates, scope),
    area,
  );
  if (before) throw new EditorWritePaused(before);

  let result: T;
  try {
    result = await send();
  } catch (error) {
    const refusal = refusalOfError(error, "write");
    if (!refusal) throw error;
    useEditorWriteGateStore.getState().pause(scope, refusal, area);
    throw new EditorWritePaused(refusal);
  }

  const refusal = options?.refusalOfResult?.(result) ?? null;
  if (refusal) {
    useEditorWriteGateStore.getState().pause(scope, refusal, area);
    throw new EditorWritePaused(refusal);
  }
  return result;
}

/**
 * Pauses the editor when a read finds nobody signed in.
 *
 * A read the account is merely not allowed to make pauses nothing; see
 * `refusalOfError`.
 */
export function reportEditorReadFailure(
  scope: WorkspaceScope,
  error: unknown,
): void {
  const refusal = refusalOfError(error, "read");
  if (refusal)
    useEditorWriteGateStore.getState().pause(scope, refusal, "theme");
}

/** Whether writes in `area` may be sent right now. */
export function editorWritesOpen(
  scope: WorkspaceScope,
  area: EditorWriteArea,
): boolean {
  const gate = editorWriteGateFor(
    useEditorWriteGateStore.getState().gates,
    scope,
  );
  return editorWriteRefusal(gate, area) === null;
}

/** Whether nobody is signed in, as far as this Theme's editor knows. */
export function editorSignedOut(scope: WorkspaceScope): boolean {
  return editorWriteGateFor(useEditorWriteGateStore.getState().gates, scope)
    .signedOut;
}
