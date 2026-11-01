import { describe, expect, it, vi } from "vitest";
import {
  revokePreviewAccessAndClose,
  userUpdateEndsPreviewAccess,
} from "./preview-access-revocation";

const quiet = { error: vi.fn() };

describe("revoking Live Preview access with a close push (#214 P2d)", () => {
  it("marks the grants revoked first, then pushes one close per preview", async () => {
    const order: string[] = [];
    const revokeGrants = vi.fn(async () => {
      order.push("revoke");
      return [
        { id: "g1", previewId: "p1", sessionId: "s" },
        { id: "g2", previewId: "p2", sessionId: "s" },
        { id: "g3", previewId: "p1", sessionId: "s" },
      ];
    });
    const push = vi.fn(async (previewId: string) => {
      order.push(`push ${previewId}`);
    });
    const result = await revokePreviewAccessAndClose({
      by: { sessionId: "s" },
      dal: { revokeGrants },
      push,
      now: new Date("2026-11-01T00:00:00Z"),
      log: quiet,
    });
    expect(revokeGrants).toHaveBeenCalledWith({
      sessionId: "s",
      now: "2026-11-01T00:00:00.000Z",
    });
    expect(order[0]).toBe("revoke");
    expect(push).toHaveBeenCalledWith("p1", ["g1", "g3"]);
    expect(push).toHaveBeenCalledWith("p2", ["g2"]);
    expect(result).toEqual({
      revoked: 3,
      pushedPreviews: 2,
      failedPreviews: 0,
      revokeFailed: false,
    });
  });

  it("a failed push neither throws nor undoes the revocation", async () => {
    const dal = {
      revokeGrants: vi.fn(async () => [
        { id: "g1", previewId: "p1", sessionId: "s" },
        { id: "g2", previewId: "p2", sessionId: "s" },
      ]),
    };
    const log = { error: vi.fn() };
    const result = await revokePreviewAccessAndClose({
      by: { userId: "u" },
      dal,
      push: async (previewId) => {
        if (previewId === "p1") throw new Error("RPC down");
      },
      log,
    });
    expect(result).toMatchObject({
      revoked: 2,
      pushedPreviews: 1,
      failedPreviews: 1,
    });
    // Only ids are logged.
    expect(log.error).toHaveBeenCalledWith(
      "[preview-access] close push failed",
      {
        previewId: "p1",
        grantIds: ["g1"],
      },
    );
    // Revoked once; nothing reverses it.
    expect(dal.revokeGrants).toHaveBeenCalledTimes(1);
  });

  it("a failed revocation write pushes nothing and does not throw", async () => {
    const push = vi.fn();
    const result = await revokePreviewAccessAndClose({
      by: { sessionId: "s" },
      dal: {
        revokeGrants: vi.fn(async () => {
          throw new Error("D1");
        }),
      },
      push,
      log: quiet,
    });
    expect(result.revokeFailed).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it("nothing to revoke: no push", async () => {
    const push = vi.fn();
    await revokePreviewAccessAndClose({
      by: { sessionId: "s" },
      dal: { revokeGrants: vi.fn(async () => []) },
      push,
      log: quiet,
    });
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    [{ role: "admin", banned: false }, false],
    [{ role: "admin,user", banned: false }, false],
    [{ role: "admin", banned: true }, true],
    [{ role: "user", banned: false }, true],
    [{ role: null, banned: null }, true],
  ])("a user updated to %j loses preview access: %s", (user, ends) => {
    expect(userUpdateEndsPreviewAccess(user)).toBe(ends);
  });
});
