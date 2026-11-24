import { describe, expect, it } from "vitest";
import {
  type CloseBeforeBInput,
  decideCloseBeforeB,
  triggerRequestAnsweredOk,
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
  triggerAnsweredOk: triggerRequestAnsweredOk("sign-out", { status: 200 }),
  close: { t: b - 1, status: 4401 },
};

/**
 * The round-2 formal revoke-other-session frame socket (22874e7, attempt 1):
 * a = 1795457933379, b = a + 208, closed 4401 at b - 3, success: true.
 */
const ra = 1_795_457_933_379;
const rb = ra + 208;
const revokeOtherDuringRequest: CloseBeforeBInput = {
  trigger: "revoke-other-session",
  surface: "frame",
  a: ra,
  b: rb,
  liveBeforeA: true,
  triggerAnsweredOk: triggerRequestAnsweredOk("revoke-other-session", {
    success: true,
  }),
  close: { t: rb - 3, status: 4401 },
};

const harnessError = (input: CloseBeforeBInput) => {
  const decision = decideCloseBeforeB(input);
  expect(decision.outcome).toBe("harness-error");
  return decision.outcome === "harness-error" ? decision.error : "";
};

describe("triggerRequestAnsweredOk", () => {
  it.each([200, 204, 299])("sign-out: HTTP %i is ok", (status) => {
    expect(triggerRequestAnsweredOk("sign-out", { status })).toBe(true);
  });

  it.each([199, 300, 302, 401, 403, 500, null, undefined, "200"])(
    "sign-out: HTTP %s is not ok",
    (status) => {
      expect(triggerRequestAnsweredOk("sign-out", { status })).toBe(false);
    },
  );

  it("sign-out: a success flag is not an HTTP answer", () => {
    expect(triggerRequestAnsweredOk("sign-out", { success: true })).toBe(false);
  });

  it("revoke-other-session: only success === true is ok", () => {
    expect(
      triggerRequestAnsweredOk("revoke-other-session", { success: true }),
    ).toBe(true);
    for (const success of [false, null, undefined, "true", 1]) {
      expect(
        triggerRequestAnsweredOk("revoke-other-session", { success }),
      ).toBe(false);
    }
  });

  it("revoke-other-session: an HTTP 2xx alone is not ok", () => {
    expect(
      triggerRequestAnsweredOk("revoke-other-session", { status: 200 }),
    ).toBe(false);
  });

  it.each([
    ["ban", { rowsChanged: 1 }],
    ["role-downgrade", { rowsChanged: 1 }],
    ["remove-user", { rowsChanged: 1 }],
    ["notice-lost", { grantsRevokedInD1Only: 2 }],
    ["grant-expiry", { grantsExpired: 2 }],
    ["ban", { status: 200, success: true }],
  ] as const)(
    "%s: a harness D1 write has no request answer (never ok)",
    (trigger, answer) => {
      expect(triggerRequestAnsweredOk(trigger, answer)).toBe(false);
    },
  );
});

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
      triggerAnsweredOk: triggerRequestAnsweredOk("sign-out", { status: 204 }),
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
    (status) => {
      expect(
        harnessError({
          ...signOutDuringRequest,
          triggerAnsweredOk: triggerRequestAnsweredOk("sign-out", { status }),
        }),
      ).toContain("frame: the socket closed before b (b-1 ms, code 4401)");
    },
  );

  it("sign-out: a socket that was not live before a and closed before b is a harness error", () => {
    expect(
      harnessError({ ...signOutDuringRequest, liveBeforeA: false }),
    ).toContain("frame: the socket closed before b (b-1 ms, code 4401)");
  });

  it("revoke-other-session: a 4401 close of a live socket during a successful request is recorded, not an error", () => {
    expect(decideCloseBeforeB(revokeOtherDuringRequest)).toEqual({
      outcome: "closed-during-request",
      closedDuringRequest: {
        trigger: "revoke-other-session",
        closedAt: rb - 3,
        closeCode: 4401,
        a: ra,
        b: rb,
        closeSinceAMs: 205,
        closeBeforeBMs: 3,
        windowMs: 208,
      },
    });
  });

  it("revoke-other-session: the window includes a itself", () => {
    expect(
      decideCloseBeforeB({
        ...revokeOtherDuringRequest,
        surface: "tab",
        close: { t: ra, status: 4401 },
      }),
    ).toMatchObject({
      outcome: "closed-during-request",
      closedDuringRequest: {
        trigger: "revoke-other-session",
        closedAt: ra,
        closeSinceAMs: 0,
        closeBeforeBMs: 208,
      },
    });
  });

  it.each([false, null, undefined])(
    "revoke-other-session: a close before b when success is %s is a harness error",
    (success) => {
      const error = harnessError({
        ...revokeOtherDuringRequest,
        triggerAnsweredOk: triggerRequestAnsweredOk("revoke-other-session", {
          success,
        }),
      });
      expect(error).toContain("frame: the socket closed before b (b-3 ms, code 4401)");
      expect(error).toContain("revoke-other-session");
    },
  );

  it.each([1006, 1000, 4403, 1011])(
    "revoke-other-session: a close with code %i before b is a harness error",
    (status) => {
      expect(
        harnessError({ ...revokeOtherDuringRequest, close: { t: rb - 3, status } }),
      ).toContain(`frame: the socket closed before b (b-3 ms, code ${status})`);
    },
  );

  it("revoke-other-session: a close before a is a harness error", () => {
    expect(
      harnessError({
        ...revokeOtherDuringRequest,
        close: { t: ra - 1, status: 4401 },
      }),
    ).toContain("frame: the socket closed before b (b-209 ms, code 4401)");
  });

  it("revoke-other-session: a socket that was not live before a and closed before b is a harness error", () => {
    expect(
      harnessError({ ...revokeOtherDuringRequest, liveBeforeA: false }),
    ).toContain("frame: the socket closed before b (b-3 ms, code 4401)");
  });

  it.each([
    "ban",
    "role-downgrade",
    "remove-user",
    "notice-lost",
    "notice-lost-after-renewal",
    "notice-lost-after-renewal-idle",
    "grant-expiry",
  ])("%s: any close before b stays a harness error, even with an ok answer", (trigger) => {
    expect(harnessError({ ...signOutDuringRequest, trigger })).toContain(
      "frame: the socket closed before b (b-1 ms, code 4401)",
    );
    expect(harnessError({ ...revokeOtherDuringRequest, trigger })).toContain(
      "frame: the socket closed before b (b-3 ms, code 4401)",
    );
  });
});
