// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  OPEN_EDITOR_WRITE_GATE,
  beginEditorWriteVerification,
  canSendEditorWrite,
  claimEditorWriteGate,
  confirmEditorWriteResume,
  editorWriteRefusal,
  editorWriterChanged,
  finishEditorWriteVerification,
  isEarlierSignInRefusal,
  pauseEditorWrites,
  refusalOfError,
  refusalOfThemeBinaryWrite,
  type EditorWriteGate,
} from "./editor-write-gate";
import {
  accessDenied,
  accountChanged,
  authRequired,
} from "@/lib/auth/auth-failure";

/** Numbers verifications in order, as the tab-wide count does. */
let stampCount = 0;
const nextStamp = () => ++stampCount;

const signedOut = () =>
  pauseEditorWrites(OPEN_EDITOR_WRITE_GATE, "AUTH_REQUIRED", "theme");

function verifyTo(
  gate: EditorWriteGate,
  answer: Parameters<typeof finishEditorWriteVerification>[2],
) {
  const begun = beginEditorWriteVerification(gate, nextStamp)!;
  return finishEditorWriteVerification(begun, begun.epoch, answer);
}

describe("pausing", () => {
  it("stops every write when nobody is signed in", () => {
    const gate = signedOut();
    expect(canSendEditorWrite(gate, "theme")).toBe(false);
    expect(editorWriteRefusal(gate, "theme")).toBe("AUTH_REQUIRED");
  });

  it("returns the same gate for a repeat, so many failures raise one notice", () => {
    const once = signedOut();
    const again = pauseEditorWrites(once, "AUTH_REQUIRED", "theme");
    expect(again).toBe(once);
    const denied = pauseEditorWrites(
      OPEN_EDITOR_WRITE_GATE,
      "ACCESS_DENIED",
      "theme",
    );
    expect(pauseEditorWrites(denied, "ACCESS_DENIED", "theme")).toBe(denied);
  });

  it("confines a denial to its area and does not sign anyone out", () => {
    const gate = pauseEditorWrites(
      OPEN_EDITOR_WRITE_GATE,
      "ACCESS_DENIED",
      "theme",
    );
    expect(gate.signedOut).toBe(false);
    expect(editorWriteRefusal(gate, "theme")).toBe("ACCESS_DENIED");
  });
});

describe("reading refusals from errors", () => {
  it("takes a signed-out refusal from reads and writes alike", () => {
    expect(refusalOfError(authRequired(), "read")).toBe("AUTH_REQUIRED");
    expect(refusalOfError(authRequired(), "write")).toBe("AUTH_REQUIRED");
  });

  it("does not let a refused read pause writes", () => {
    const denied = accessDenied("Forbidden: Asset access");
    expect(refusalOfError(denied, "read")).toBeNull();
    expect(refusalOfError(denied, "write")).toBe("ACCESS_DENIED");
  });

  it("never reads a refusal from text", () => {
    expect(
      refusalOfError(new Error("Unauthorized: Please sign in"), "write"),
    ).toBeNull();
  });

  it("reads the binary endpoint only by its own status and code", () => {
    expect(
      refusalOfThemeBinaryWrite({
        ok: false,
        status: 401,
        error: "UNAUTHORIZED",
      }),
    ).toBe("AUTH_REQUIRED");
    expect(
      refusalOfThemeBinaryWrite({ ok: false, status: 403, error: "FORBIDDEN" }),
    ).toBe("ACCESS_DENIED");
    expect(
      refusalOfThemeBinaryWrite({ ok: false, status: 403, error: "OTHER" }),
    ).toBeNull();
    expect(
      refusalOfThemeBinaryWrite({ ok: false, status: 409, error: "FORBIDDEN" }),
    ).toBeNull();
    expect(refusalOfThemeBinaryWrite({ ok: true })).toBeNull();
  });
});

describe("recovering", () => {
  it("does not open writes on verification alone", () => {
    const verified = verifyTo(signedOut(), "verified");
    expect(verified.recovery).toBe("verified");
    expect(canSendEditorWrite(verified, "theme")).toBe(false);
    expect(editorWriteRefusal(verified, "theme")).toBe("AWAITING_CONFIRMATION");
  });

  it("opens writes only when the author confirms a current verification", () => {
    const verified = verifyTo(signedOut(), "verified");
    const opened = confirmEditorWriteResume(verified, verified.epoch);
    expect(canSendEditorWrite(opened, "theme")).toBe(true);
    expect(opened.recovery).toBe("none");
  });

  it("ignores a confirmation from before a later pause", () => {
    const verified = verifyTo(signedOut(), "verified");
    const staleEpoch = verified.epoch;
    const refusedAgain = pauseEditorWrites(verified, "AUTH_REQUIRED", "theme");
    expect(refusedAgain.recovery).toBe("still-signed-out");
    expect(confirmEditorWriteResume(refusedAgain, staleEpoch)).toBe(
      refusedAgain,
    );
  });

  it("keeps writes paused for a different account", () => {
    const other = verifyTo(signedOut(), "different-account");
    expect(other.recovery).toBe("different-account");
    expect(canSendEditorWrite(other, "theme")).toBe(false);
    expect(confirmEditorWriteResume(other, other.epoch)).toBe(other);
  });

  it("keeps writes paused when the account signs back in without permission", () => {
    const denied = verifyTo(signedOut(), "access-denied");
    expect(denied.signedOut).toBe(false);
    expect(editorWriteRefusal(denied, "theme")).toBe("ACCESS_DENIED");
    expect(canSendEditorWrite(denied, "theme")).toBe(false);
  });

  it("ignores an answer to a verification the editor has moved past", () => {
    const begun = beginEditorWriteVerification(signedOut(), nextStamp)!;
    // The session goes again while the question is in flight.
    const refused = pauseEditorWrites(begun, "AUTH_REQUIRED", "theme");
    const late = finishEditorWriteVerification(
      refused,
      begun.epoch,
      "verified",
    );
    expect(late).toBe(refused);
    expect(canSendEditorWrite(late, "theme")).toBe(false);
  });

  it("has nothing to verify when nothing is paused, and never runs two at once", () => {
    expect(
      beginEditorWriteVerification(OPEN_EDITOR_WRITE_GATE, nextStamp),
    ).toBeNull();
    const begun = beginEditorWriteVerification(signedOut(), nextStamp)!;
    expect(beginEditorWriteVerification(begun, nextStamp)).toBeNull();
  });

  it("goes back to waiting when the question itself fails", () => {
    const unanswered = verifyTo(signedOut(), "unanswered");
    expect(unanswered.recovery).toBe("none");
    expect(unanswered.signedOut).toBe(true);
  });
});

describe("another account signed in here", () => {
  it("stops writes although no request was refused", () => {
    const changed = editorWriterChanged(OPEN_EDITOR_WRITE_GATE);
    expect(changed.recovery).toBe("different-account");
    expect(canSendEditorWrite(changed, "theme")).toBe(false);
    expect(editorWriterChanged(changed)).toBe(changed);
  });

  it("stays paused until the first account is verified again", () => {
    const changed = editorWriterChanged(OPEN_EDITOR_WRITE_GATE);
    const stillOther = verifyTo(changed, "different-account");
    expect(canSendEditorWrite(stillOther, "theme")).toBe(false);
    const back = verifyTo(stillOther, "verified");
    expect(canSendEditorWrite(back, "theme")).toBe(false);
    expect(
      canSendEditorWrite(confirmEditorWriteResume(back, back.epoch), "theme"),
    ).toBe(true);
  });
});

describe("whose work a paused gate holds", () => {
  it("keeps the first claim, whoever claims later", () => {
    const held = claimEditorWriteGate(signedOut(), "user-a");
    expect(held.ownerUserId).toBe("user-a");
    expect(claimEditorWriteGate(held, "user-b")).toBe(held);
  });

  it("claims nothing while writes are open, and forgets on resume", () => {
    expect(
      claimEditorWriteGate(OPEN_EDITOR_WRITE_GATE, "user-a").ownerUserId,
    ).toBeNull();
    const held = claimEditorWriteGate(signedOut(), "user-a");
    const verified = verifyTo(held, "verified");
    const opened = confirmEditorWriteResume(verified, verified.epoch);
    expect(opened.ownerUserId).toBeNull();
  });
});

describe("a request refused for another account", () => {
  it("pauses as another account, from a read or a write", () => {
    const gate = pauseEditorWrites(
      OPEN_EDITOR_WRITE_GATE,
      "ACCOUNT_CHANGED",
      "theme",
    );
    expect(gate.recovery).toBe("different-account");
    expect(editorWriteRefusal(gate, "theme")).toBe("ACCOUNT_CHANGED");
    expect(refusalOfError(accountChanged(), "read")).toBe("ACCOUNT_CHANGED");
    expect(refusalOfError(accountChanged(), "write")).toBe("ACCOUNT_CHANGED");
  });

  it("reads it from the binary endpoint's own answer", () => {
    expect(
      refusalOfThemeBinaryWrite({
        ok: false,
        status: 409,
        error: "ACCOUNT_CHANGED",
      }),
    ).toBe("ACCOUNT_CHANGED");
  });

  it("undoes a verification that was waiting to be confirmed", () => {
    const verified = verifyTo(signedOut(), "verified");
    const changed = pauseEditorWrites(verified, "ACCOUNT_CHANGED", "theme");
    expect(changed.recovery).toBe("different-account");
    expect(confirmEditorWriteResume(changed, verified.epoch)).toBe(changed);
  });
});

describe("a sign-in refusal of a request sent before the latest verification", () => {
  /** Paused, then verified: the request was sent under `sentUnder`. */
  function verifiedAfter() {
    const paused = signedOut();
    const sentUnder = paused.verificationStamp;
    const begun = beginEditorWriteVerification(paused, nextStamp)!;
    const verified = finishEditorWriteVerification(
      begun,
      begun.epoch,
      "verified",
    );
    return { sentUnder, begun, verified };
  }

  it("does not undo the verification it was sent before", () => {
    const { sentUnder, verified } = verifiedAfter();
    expect(
      pauseEditorWrites(verified, "AUTH_REQUIRED", "theme", sentUnder),
    ).toBe(verified);
    expect(isEarlierSignInRefusal(verified, "AUTH_REQUIRED", sentUnder)).toBe(
      true,
    );
  });

  it("does not undo a verification still in flight, which then finishes as verified", () => {
    const { sentUnder, begun } = verifiedAfter();
    const after = pauseEditorWrites(begun, "AUTH_REQUIRED", "theme", sentUnder);
    expect(after).toBe(begun);
    expect(
      finishEditorWriteVerification(after, after.epoch, "verified").recovery,
    ).toBe("verified");
  });

  it("does not close writes reopened since", () => {
    const { sentUnder, verified } = verifiedAfter();
    const open = confirmEditorWriteResume(verified, verified.epoch);
    expect(open.verificationStamp).toBe(verified.verificationStamp);
    expect(pauseEditorWrites(open, "AUTH_REQUIRED", "theme", sentUnder)).toBe(
      open,
    );
    expect(canSendEditorWrite(open, "theme")).toBe(true);
  });

  it("still counts when the request was sent once the verification began", () => {
    const { begun } = verifiedAfter();
    const after = pauseEditorWrites(
      begun,
      "AUTH_REQUIRED",
      "theme",
      begun.verificationStamp,
    );
    expect(after.recovery).toBe("still-signed-out");
    expect(finishEditorWriteVerification(after, begun.epoch, "verified")).toBe(
      after,
    );
  });

  it("still counts when nothing says when it was sent", () => {
    const { verified } = verifiedAfter();
    expect(pauseEditorWrites(verified, "AUTH_REQUIRED", "theme").recovery).toBe(
      "still-signed-out",
    );
  });

  it("is only the sign-in refusal: another account or no permission still count", () => {
    const { sentUnder, verified } = verifiedAfter();
    expect(
      pauseEditorWrites(verified, "ACCOUNT_CHANGED", "theme", sentUnder)
        .recovery,
    ).toBe("different-account");
    const open = confirmEditorWriteResume(verified, verified.epoch);
    expect(
      pauseEditorWrites(open, "ACCESS_DENIED", "theme", sentUnder).denied,
    ).toEqual(["theme"]);
  });
});
