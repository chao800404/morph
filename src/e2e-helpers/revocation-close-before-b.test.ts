import { describe, expect, it } from "vitest";
import {
  type CloseBeforeBInput,
  decideCloseBeforeB,
} from "../../e2e/helpers/revocation-close-before-b";

const a = 1_795_419_580_515;
const b = a + 547;

/** The attempt-1 sign-out frame socket: closed 4401 at b - 1, answer 200. */
const signOutDuringRequest: CloseBeforeBInput = {
  trigger: "sign-out",
  surface: "frame",
  a,
  b,
  liveBeforeA: true,
  triggerStatus: 200,
  close: { t: b - 1, status: 4401 },
};

const harnessError = (input: CloseBeforeBInput) => {
  const decision = decideCloseBeforeB(input);
  expect(decision.outcome).toBe("harness-error");
  return decision.outcome === "harness-error" ? decision.error : "";
};

describe("decideCloseBeforeB", () => {
  it("a socket still open at b, or closed at or after b, is open at b", () => {
    for (const close of [null, { t: b, status: 4401 }, { t: b + 5, status: 1006 }]) {
      expect(decideCloseBeforeB({ ...signOutDuringRequest, close })).toEqual({
        outcome: "open-at-b",
      });
    }
  });

  it("sign-out: a 4401 close of a live socket during an ok request is recorded, not an error", () => {
    expect(decideCloseBeforeB(signOutDuringRequest)).toEqual({
      outcome: "closed-during-request",
      closedDuringRequest: {
        trigger: "sign-out",
        closedAt: b - 1,
        closeCode: 4401,
        a,
        b,
        closeSinceAMs: 546,
        closeBeforeBMs: 1,
        windowMs: 547,
      },
    });
  });

  it("sign-out: the window includes a itself and any 2xx answer", () => {
    const atA = decideCloseBeforeB({
      ...signOutDuringRequest,
      triggerStatus: 204,
      close: { t: a, status: 4401 },
    });
    expect(atA).toMatchObject({
      outcome: "closed-during-request",
      closedDuringRequest: { closedAt: a, closeSinceAMs: 0, closeBeforeBMs: 547 },
    });
  });

  it("sign-out: a close before a is a harness error", () => {
    expect(
      harnessError({ ...signOutDuringRequest, close: { t: a - 1, status: 4401 } }),
    ).toContain("frame: the socket closed before b (b-548 ms, code 4401)");
  });

  it.each([1006, 1000, 4403, 1011])(
    "sign-out: a close with code %i before b is a harness error",
    (status) => {
      expect(
        harnessError({ ...signOutDuringRequest, close: { t: b - 1, status } }),
      ).toContain(`frame: the socket closed before b (b-1 ms, code ${status})`);
    },
  );

  it.each([401, 403, 500, 302, null])(
    "sign-out: a close before b when the sign-out answered %s is a harness error",
    (triggerStatus) => {
      expect(harnessError({ ...signOutDuringRequest, triggerStatus })).toContain(
        "frame: the socket closed before b (b-1 ms, code 4401)",
      );
    },
  );

  it("sign-out: a socket that was not live before a and closed before b is a harness error", () => {
    expect(
      harnessError({ ...signOutDuringRequest, liveBeforeA: false }),
    ).toContain("frame: the socket closed before b (b-1 ms, code 4401)");
  });

  it.each([
    "revoke-other-session",
    "ban",
    "role-downgrade",
    "remove-user",
    "notice-lost",
    "grant-expiry",
  ])("%s: any close before b stays a harness error", (trigger) => {
    expect(harnessError({ ...signOutDuringRequest, trigger })).toContain(
      "frame: the socket closed before b (b-1 ms, code 4401)",
    );
  });
});
