import {
  EditorWritePaused,
  EditorWriteRefusedEarlier,
  editorWriteRefusal,
  isEarlierSignInRefusal,
  refusalOfError,
  type EditorWriteArea,
  type EditorWriteRefusal,
} from "./editor-write-gate";
import { currentRequestStamp, requestStampOf } from "./editor-request-sequence";
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
 * - Refused as signed out, but sent before the author's latest sign-in was
 *   verified: the gate is left as the verification found it. The write still
 *   failed — held as paused while writes wait for confirmation, or
 *   `EditorWriteRefusedEarlier` once they are open again.
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

  // Stamped as it is sent, not when the author asked: a save may wait on its
  // formatter first, and what matters is who was signed in when it went.
  const sentUnder = currentRequestStamp();
  let result: T;
  try {
    result = await send();
  } catch (error) {
    const refusal = refusalOfError(error, "write");
    if (!refusal) throw error;
    throw refusedWrite(scope, area, refusal, sentUnder);
  }

  const refusal = options?.refusalOfResult?.(result) ?? null;
  if (refusal) throw refusedWrite(scope, area, refusal, sentUnder);
  return result;
}

/** The error a refused write throws, after the gate has heard of it. */
function refusedWrite(
  scope: WorkspaceScope,
  area: EditorWriteArea,
  refusal: EditorWriteRefusal,
  sentUnder: number,
): Error {
  const store = useEditorWriteGateStore.getState();
  const gate = editorWriteGateFor(store.gates, scope);
  if (isEarlierSignInRefusal(gate, refusal, sentUnder)) {
    const now = editorWriteRefusal(gate, area);
    return now ? new EditorWritePaused(now) : new EditorWriteRefusedEarlier();
  }
  store.pause(scope, refusal, area, sentUnder);
  return new EditorWritePaused(refusal);
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
    useEditorWriteGateStore
      .getState()
      .pause(scope, refusal, "theme", requestStampOf(error));
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
