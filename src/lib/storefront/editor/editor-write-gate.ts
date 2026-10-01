import { classifyAuthFailure } from "@/lib/auth/auth-failure";

/**
 * Whether the editor may send writes, after a server refused one on account
 * of who is asking.
 *
 * Two refusals, two different reaches:
 *
 * - `AUTH_REQUIRED` — nobody is signed in any more. Every write would be
 *   refused the same way, so the whole editor stops sending.
 * - `ACCESS_DENIED` — someone is signed in, but may not do this. Only writes in
 *   the same area stop; a refusal in one area says nothing about another.
 *
 * Nothing here decides what happens to the edits that could not be sent. Each
 * write path keeps its own draft, exactly as it does for a version conflict,
 * and is told the write was paused rather than that it failed.
 *
 * Kept free of React and of the server so the rules can be stated as tests.
 */

/** The areas an `ACCESS_DENIED` is confined to. */
export type EditorWriteArea = "theme";

/**
 * Where getting writes going again has got to.
 *
 * - `none`: nothing under way. With nothing paused, writes flow.
 * - `verifying`: asking the server who is signed in now.
 * - `still-signed-out`: asked; nobody is.
 * - `different-account`: asked; someone else is. This editor's unsaved work
 *   belongs to the account that opened it, so it is never sent as another.
 * - `verified`: asked; the same account is back and may edit this Theme.
 *   Writes are still held until the author says to save — verifying is not
 *   consent to send whatever piled up.
 */
export type EditorWriteRecovery =
  "none" | "verifying" | "still-signed-out" | "different-account" | "verified";

export type EditorWriteGate = Readonly<{
  /** Set once nobody is signed in; cleared only by a confirmed resume. */
  signedOut: boolean;
  /** Areas whose writes the signed-in account was refused. */
  denied: readonly EditorWriteArea[];
  recovery: EditorWriteRecovery;
  /**
   * The account whose unsaved work is held while paused. Set once, when
   * writes first pause, and only ever compared against: whoever is signed in
   * later, the held work is only sent once this account is back.
   */
  ownerUserId: string | null;
  /**
   * Bumped by each pause and each finished step of recovery, so a step begun
   * earlier — a verification, a save confirmation — can tell it is stale.
   */
  epoch: number;
}>;

export const OPEN_EDITOR_WRITE_GATE: EditorWriteGate = {
  signedOut: false,
  denied: [],
  recovery: "none",
  ownerUserId: null,
  epoch: 0,
};

/** Records whose work a paused gate holds; the first claim stands. */
export function claimEditorWriteGate(
  gate: EditorWriteGate,
  userId: string,
): EditorWriteGate {
  if (!isEditorWriteGatePaused(gate) || gate.ownerUserId) return gate;
  return { ...gate, ownerUserId: userId };
}

export function isEditorWriteGatePaused(gate: EditorWriteGate): boolean {
  return gate.signedOut || gate.denied.length > 0;
}

export function canSendEditorWrite(
  gate: EditorWriteGate,
  area: EditorWriteArea,
): boolean {
  return !gate.signedOut && !gate.denied.includes(area);
}

export type EditorWriteRefusal =
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED"
  /** Someone else is signed in than the account the editor belongs to. */
  | "ACCOUNT_CHANGED";

/**
 * The gate after a request failed with `refusal`, or the same gate when the
 * failure changes nothing.
 *
 * Returning the same object for a repeat matters: many writes in flight fail
 * together when a session ends, and only the first may raise the notice.
 *
 * A refusal during recovery undoes it: the session the verification found has
 * gone again, and a verification still in flight must not report otherwise.
 */
export function pauseEditorWrites(
  gate: EditorWriteGate,
  refusal: EditorWriteRefusal,
  area: EditorWriteArea,
): EditorWriteGate {
  if (refusal === "ACCOUNT_CHANGED") return editorWriterChanged(gate);
  if (refusal === "AUTH_REQUIRED") {
    if (!gate.signedOut) {
      return {
        ...gate,
        signedOut: true,
        recovery: "none",
        epoch: gate.epoch + 1,
      };
    }
    if (gate.recovery === "verifying" || gate.recovery === "verified") {
      return { ...gate, recovery: "still-signed-out", epoch: gate.epoch + 1 };
    }
    return gate;
  }
  if (gate.denied.includes(area)) {
    if (gate.recovery === "verifying" || gate.recovery === "verified") {
      return { ...gate, recovery: "none", epoch: gate.epoch + 1 };
    }
    return gate;
  }
  return {
    ...gate,
    denied: [...gate.denied, area],
    recovery: "none",
    epoch: gate.epoch + 1,
  };
}

/** Starts asking who is signed in; null when nothing is paused. */
export function beginEditorWriteVerification(
  gate: EditorWriteGate,
): EditorWriteGate | null {
  if (!isEditorWriteGatePaused(gate) || gate.recovery === "verifying") {
    return null;
  }
  return { ...gate, recovery: "verifying", epoch: gate.epoch + 1 };
}

/**
 * The gate once the session in this browser is found to belong to another
 * account than the one that opened the editor.
 *
 * No request is refused when that happens — the other account may well be
 * allowed to write — so it has to be looked for, and writes stop as they do
 * for a sign-out: the work here is the first account's, and is never sent as
 * someone else's.
 */
export function editorWriterChanged(gate: EditorWriteGate): EditorWriteGate {
  if (gate.signedOut && gate.recovery === "different-account") return gate;
  return {
    ...gate,
    signedOut: true,
    recovery: "different-account",
    epoch: gate.epoch + 1,
  };
}

export type EditorWriteVerification =
  | "signed-out"
  | "different-account"
  | "access-denied"
  | "verified"
  /** The question itself failed — a network error, not an answer. */
  | "unanswered";

/**
 * The gate once a verification begun at `epoch` has an answer, or the same
 * gate when the answer is stale: the editor paused again, or recovery moved
 * on, since it was asked.
 */
export function finishEditorWriteVerification(
  gate: EditorWriteGate,
  epoch: number,
  answer: EditorWriteVerification,
): EditorWriteGate {
  if (gate.epoch !== epoch || gate.recovery !== "verifying") return gate;
  const next = { ...gate, epoch: gate.epoch + 1 };
  switch (answer) {
    case "signed-out":
      return { ...next, signedOut: true, recovery: "still-signed-out" };
    case "different-account":
      return { ...next, recovery: "different-account" };
    case "access-denied":
      return {
        ...next,
        signedOut: false,
        denied: gate.denied.includes("theme")
          ? gate.denied
          : [...gate.denied, "theme"],
        recovery: "none",
      };
    case "verified":
      // Still paused: the author confirms before anything is sent.
      return { ...next, recovery: "verified" };
    case "unanswered":
      return { ...next, recovery: "none" };
  }
}

/**
 * Opens the gate, when the author confirms after a verification that is
 * still current; otherwise the same gate.
 */
export function confirmEditorWriteResume(
  gate: EditorWriteGate,
  epoch: number,
): EditorWriteGate {
  if (gate.epoch !== epoch || gate.recovery !== "verified") return gate;
  return { ...OPEN_EDITOR_WRITE_GATE, epoch: gate.epoch + 1 };
}

/**
 * Thrown in place of sending, or of a server refusal, while writes are paused.
 *
 * A distinct error so a write path can tell "not sent, keep the draft" from
 * "sent and failed". Its message is what an author reads when an action they
 * pressed could not run.
 */
export type EditorWritePauseReason =
  | EditorWriteRefusal
  /** Verified, but the author has not yet said to save. */
  | "AWAITING_CONFIRMATION";

const PAUSE_MESSAGES: Record<EditorWritePauseReason, string> = {
  AUTH_REQUIRED:
    "Your sign-in has expired. Nothing was saved; your unsaved changes are kept in this tab.",
  ACCESS_DENIED:
    "Your account is not allowed to make this change. Nothing was saved; your unsaved changes are kept in this tab.",
  ACCOUNT_CHANGED:
    "A different account is signed in. Nothing was saved; your unsaved changes are kept in this tab.",
  AWAITING_CONFIRMATION:
    "Saving is paused until you choose Save my changes. Your unsaved changes are kept in this tab.",
};

export class EditorWritePaused extends Error {
  readonly reason: EditorWritePauseReason;

  constructor(reason: EditorWritePauseReason) {
    super(PAUSE_MESSAGES[reason]);
    this.name = "EditorWritePaused";
    this.reason = reason;
  }
}

export function isEditorWritePaused(
  error: unknown,
): error is EditorWritePaused {
  return error instanceof EditorWritePaused;
}

/** Why a write in `area` may not be sent now, or null when it may. */
export function editorWriteRefusal(
  gate: EditorWriteGate,
  area: EditorWriteArea,
): EditorWritePauseReason | null {
  if (gate.recovery === "verified") return "AWAITING_CONFIRMATION";
  if (gate.recovery === "different-account") return "ACCOUNT_CHANGED";
  if (gate.signedOut) return "AUTH_REQUIRED";
  if (gate.denied.includes(area)) return "ACCESS_DENIED";
  return null;
}

/**
 * The refusal a server function's error carries, read only from its code.
 *
 * `ACCESS_DENIED` from a read is not a refusal of writes: a media lookup the
 * account may not make says nothing about whether it may save the Theme.
 */
export function refusalOfError(
  error: unknown,
  kind: "read" | "write",
): EditorWriteRefusal | null {
  const code = classifyAuthFailure(error);
  if (code === "AUTH_REQUIRED") return "AUTH_REQUIRED";
  // From a read as much as a write: either way, another account is here.
  if (code === "ACCOUNT_CHANGED") return "ACCOUNT_CHANGED";
  if (code === "ACCESS_DENIED" && kind === "write") return "ACCESS_DENIED";
  return null;
}

/**
 * The refusal in the Theme binary endpoint's answer.
 *
 * That endpoint is an HTTP route, not a server function, and states its own
 * contract: 401 with `UNAUTHORIZED`, 403 with `FORBIDDEN`. Read only for it —
 * a 403 elsewhere means whatever that endpoint says it means.
 */
export function refusalOfThemeBinaryWrite(result: {
  ok: boolean;
  status?: number;
  error?: string;
}): EditorWriteRefusal | null {
  if (result.ok) return null;
  if (result.status === 401 && result.error === "UNAUTHORIZED") {
    return "AUTH_REQUIRED";
  }
  if (result.status === 403 && result.error === "FORBIDDEN") {
    return "ACCESS_DENIED";
  }
  if (result.status === 409 && result.error === "ACCOUNT_CHANGED") {
    return "ACCOUNT_CHANGED";
  }
  return null;
}
