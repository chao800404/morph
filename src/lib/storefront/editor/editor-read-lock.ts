import { classifyAuthFailure } from "@/lib/auth/auth-failure";
import { requestStampOf } from "./editor-request-sequence";
import type { EditorWriteGate } from "./editor-write-gate";

/**
 * What a failed read of the Theme's editor data says, once the editor is
 * already open on data read earlier.
 *
 * Only the first load has nothing to show; after it, a read that fails must
 * not take the editor away, because that takes the author's unsaved work with
 * it. What the failure means decides what happens instead:
 *
 * - `access-denied`: the server refused this account the Theme. The work here
 *   is kept, but nothing more may be done with it until that changes.
 * - `missing`: the Theme is not there any more. The same, for another reason.
 * - `unavailable`: no answer worth acting on — a dropped connection, a server
 *   error. The last data read stays on screen and nothing is decided from it;
 *   above all, it is never taken for a refusal.
 *
 * A read finding nobody signed in, or someone else, is not one of these: the
 * write gate hears of those from every read already (`reportEditorReadFailure`
 * in `send-editor-write.ts`), and decides from them.
 */
export type ThemeReadFailure = "access-denied" | "missing" | "unavailable";

/**
 * What the editor route shows for the state of its data query.
 *
 * `loaded` is the data last read successfully for this Theme, or null if
 * none has been. Without it, a failure is the route's own error page, as it
 * always was. With it, the editor stays, on that data, and says what the
 * failure means (`themeRead`, with the request stamp it was sent under when
 * the read threw — see `editor-request-sequence`).
 */
export function resolveEditorRouteView<TContext>(
  query: {
    isError: boolean;
    error: unknown;
    data:
      | { success: true; data: TContext }
      | { success: false; error?: string | null }
      | undefined;
  },
  loaded: TContext | null,
):
  | { kind: "failed" }
  | {
      kind: "ready";
      context: TContext;
      themeRead: ThemeReadFailure | null;
      sentUnder: number | undefined;
    } {
  if (!loaded) return { kind: "failed" };
  if (query.isError) {
    return {
      kind: "ready",
      context: loaded,
      themeRead: classifyThemeReadFailure({ error: query.error }),
      sentUnder: requestStampOf(query.error),
    };
  }
  if (query.data && !query.data.success) {
    return {
      kind: "ready",
      context: loaded,
      themeRead: classifyThemeReadFailure({ result: query.data }),
      sentUnder: undefined,
    };
  }
  return {
    kind: "ready",
    context: loaded,
    themeRead: null,
    sentUnder: undefined,
  };
}

/**
 * The read failure still in force: one whose request was sent before the
 * gate's latest check of who is signed in has been answered since — that
 * check read the Theme itself — and decides nothing.
 */
export function currentThemeReadFailure(
  gate: EditorWriteGate,
  themeRead: ThemeReadFailure | null,
  sentUnder: number | undefined,
): ThemeReadFailure | null {
  if (!themeRead) return null;
  if (sentUnder !== undefined && sentUnder < gate.verificationStamp) {
    return null;
  }
  return themeRead;
}

/** A refetch of the editor data that threw, or answered `success: false`. */
export function classifyThemeReadFailure(
  failure:
    { error: unknown } | { result: { success: false; error?: string | null } },
): ThemeReadFailure | null {
  if ("result" in failure) {
    return failure.result.error === "NOT_FOUND" ? "missing" : "unavailable";
  }
  const code = classifyAuthFailure(failure.error);
  if (code === "AUTH_REQUIRED" || code === "ACCOUNT_CHANGED") return null;
  if (code === "ACCESS_DENIED") return "access-denied";
  return "unavailable";
}

/**
 * Why the editor is closed to the author; null while it is not.
 *
 * Closed means hidden, `inert` and sending nothing. It is not isolation: the
 * unsaved work stays in this tab's memory (the DOM, state, the query cache,
 * the preview frame), where the tab's devtools can read it. That is the cost
 * of keeping it.
 *
 * - `different-account`: another account is signed in. The work here is the
 *   first account's: it is not offered to the other one as a workspace, and
 *   never sent as theirs.
 * - `theme-access-denied` / `theme-missing`: see `ThemeReadFailure`.
 *
 * Not for a sign-in that merely expired: the same author is still here, and
 * the editor stays open with writes paused (`EditorWritesPausedNotice`).
 *
 * Read from the gate alone, never from what was decided on an earlier render.
 * While a check of who is signed in is under way, `verifyingFrom` says the
 * gate was checking from another account, and the editor stays closed; a
 * check that gets no answer leaves the gate at `different-account`
 * (`finishEditorWriteVerification`).
 */
export type EditorLockReason =
  "different-account" | "theme-access-denied" | "theme-missing";

export function resolveEditorLock(
  gate: EditorWriteGate,
  themeRead: ThemeReadFailure | null,
): EditorLockReason | null {
  if (gate.recovery === "different-account") return "different-account";
  if (themeRead === "access-denied") return "theme-access-denied";
  if (themeRead === "missing") return "theme-missing";
  if (
    gate.recovery === "verifying" &&
    gate.verifyingFrom === "different-account"
  ) {
    return "different-account";
  }
  return null;
}

const LOCK_MESSAGES: Record<
  EditorLockReason,
  { title: string; detail: string }
> = {
  "different-account": {
    title: "A different account is signed in.",
    detail:
      "This editor holds another account's unsaved work, so it is closed. Sign in again as that account, then check again; nothing is sent until then.",
  },
  "theme-access-denied": {
    title: "Your account can no longer open this Theme.",
    detail:
      "The editor is closed and nothing is being saved. Your unsaved changes are kept in this tab; check again once access is restored.",
  },
  "theme-missing": {
    title: "This Theme is no longer available.",
    detail:
      "It may have been deleted. The editor is closed and nothing is being saved; your unsaved changes are kept in this tab.",
  },
};

export function editorLockMessage(reason: EditorLockReason) {
  return LOCK_MESSAGES[reason];
}
