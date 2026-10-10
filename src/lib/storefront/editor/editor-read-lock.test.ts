import { describe, expect, it } from "vitest";
import {
  accessDenied,
  accountChanged,
  authRequired,
} from "@/lib/auth/auth-failure";
import {
  OPEN_EDITOR_WRITE_GATE,
  beginEditorWriteVerification,
  editorWriterChanged,
  finishEditorWriteVerification,
  pauseEditorWrites,
  type EditorWriteGate,
} from "./editor-write-gate";
import {
  classifyThemeReadFailure,
  currentThemeReadFailure,
  resolveEditorLock,
  resolveEditorRouteView,
  type EditorLockReason,
} from "./editor-read-lock";
import { stampRequestError } from "./editor-request-sequence";

describe("a failed read of the editor data, once the editor is open", () => {
  it("is a refusal only when the server refused this account the Theme", () => {
    expect(classifyThemeReadFailure({ error: accessDenied("no") })).toBe(
      "access-denied",
    );
  });

  it("leaves a sign-in that expired, or another account, to the write gate", () => {
    expect(classifyThemeReadFailure({ error: authRequired() })).toBeNull();
    expect(classifyThemeReadFailure({ error: accountChanged() })).toBeNull();
  });

  it("is a Theme gone only when the server says it was not found", () => {
    expect(
      classifyThemeReadFailure({
        result: { success: false, error: "NOT_FOUND" },
      }),
    ).toBe("missing");
  });

  it("is never taken for a refusal when it is a server error or a dropped connection", () => {
    expect(
      classifyThemeReadFailure({
        result: { success: false, error: "GET_FAILED" },
      }),
    ).toBe("unavailable");
    expect(classifyThemeReadFailure({ result: { success: false } })).toBe(
      "unavailable",
    );
    expect(classifyThemeReadFailure({ error: new Error("network") })).toBe(
      "unavailable",
    );
  });
});

describe("the editor route once its data has been read", () => {
  const loaded = { theme: "loaded" };
  const failedRead = (error: unknown) => ({
    isError: true,
    error,
    data: { success: true as const, data: loaded },
  });

  it("shows its own error page when the first read fails: there is nothing to keep", () => {
    expect(
      resolveEditorRouteView(
        { isError: true, error: new Error("x"), data: undefined },
        null,
      ),
    ).toEqual({ kind: "failed" });
    expect(
      resolveEditorRouteView(
        {
          isError: false,
          error: null,
          data: { success: false, error: "NOT_FOUND" },
        },
        null,
      ),
    ).toEqual({ kind: "failed" });
  });

  it("keeps the editor on the data read last, whatever a later read fails with", () => {
    for (const error of [
      authRequired(),
      accountChanged(),
      accessDenied("no"),
      new Error("x"),
    ]) {
      expect(resolveEditorRouteView(failedRead(error), loaded)).toMatchObject({
        kind: "ready",
        context: loaded,
      });
    }
    expect(
      resolveEditorRouteView(
        {
          isError: false,
          error: null,
          data: { success: false, error: "NOT_FOUND" },
        },
        loaded,
      ),
    ).toMatchObject({ kind: "ready", context: loaded, themeRead: "missing" });
  });

  it("carries the stamp the failed read was sent under", () => {
    const error = accessDenied("no");
    stampRequestError(error, 3);
    expect(resolveEditorRouteView(failedRead(error), loaded)).toMatchObject({
      themeRead: "access-denied",
      sentUnder: 3,
    });
  });
});

describe("a refusal of the Theme read before a later check of who is signed in", () => {
  const checked = { ...OPEN_EDITOR_WRITE_GATE, verificationStamp: 4 };

  it("decides nothing once that check has read the Theme since", () => {
    expect(currentThemeReadFailure(checked, "access-denied", 3)).toBeNull();
  });

  it("still holds when it was sent after the check began, or carries no stamp", () => {
    expect(currentThemeReadFailure(checked, "access-denied", 4)).toBe(
      "access-denied",
    );
    expect(currentThemeReadFailure(checked, "missing", undefined)).toBe(
      "missing",
    );
  });
});

describe("closing the editor while its unsaved work is kept", () => {
  const signedOut = pauseEditorWrites(
    OPEN_EDITOR_WRITE_GATE,
    "AUTH_REQUIRED",
    "theme",
  );
  const otherAccount = editorWriterChanged(OPEN_EDITOR_WRITE_GATE);
  const verifying = (gate: EditorWriteGate) =>
    beginEditorWriteVerification(gate, () => 1)!;

  it("stays open when the sign-in merely expired: the same author is here", () => {
    expect(resolveEditorLock(signedOut, null, null)).toBeNull();
  });

  it("closes when another account is signed in, however that was found", () => {
    // A refused save (ACCOUNT_CHANGED), a read, and the focus check all
    // arrive at the same gate state.
    expect(resolveEditorLock(otherAccount, null, null)).toBe(
      "different-account",
    );
    expect(
      resolveEditorLock(
        pauseEditorWrites(OPEN_EDITOR_WRITE_GATE, "ACCOUNT_CHANGED", "theme"),
        null,
        null,
      ),
    ).toBe("different-account");
  });

  it("stays closed while it checks who is signed in, and when the check gets no answer", () => {
    const checking = verifying(otherAccount);
    expect(resolveEditorLock(checking, null, "different-account")).toBe(
      "different-account",
    );
    const unanswered = finishEditorWriteVerification(
      checking,
      checking.epoch,
      "unanswered",
    );
    // Still paused, and still closed: no answer is no evidence.
    expect(unanswered.signedOut).toBe(true);
    expect(resolveEditorLock(unanswered, null, "different-account")).toBe(
      "different-account",
    );
  });

  it("opens again once the first account is back and verified, with writes still held", () => {
    const checking = verifying(otherAccount);
    const verified = finishEditorWriteVerification(
      checking,
      checking.epoch,
      "verified",
    );
    expect(resolveEditorLock(verified, null, "different-account")).toBeNull();
    expect(verified.signedOut).toBe(true);
    expect(verified.recovery).toBe("verified");
  });

  it("closes while the Theme is refused or gone, whatever the gate says", () => {
    const cases: [Parameters<typeof resolveEditorLock>[1], EditorLockReason][] =
      [
        ["access-denied", "theme-access-denied"],
        ["missing", "theme-missing"],
      ];
    for (const [read, reason] of cases) {
      expect(resolveEditorLock(OPEN_EDITOR_WRITE_GATE, read, null)).toBe(
        reason,
      );
      expect(resolveEditorLock(verifying(signedOut), read, null)).toBe(reason);
    }
  });

  it("does not close for a read that merely failed", () => {
    expect(
      resolveEditorLock(OPEN_EDITOR_WRITE_GATE, "unavailable", null),
    ).toBeNull();
  });
});
