import { describe, expect, it } from "vitest";
import { canRevokeSession } from "./session-authorization";

describe("session authorization", () => {
  it("allows a user to revoke their own session", () => {
    expect(canRevokeSession("user-1", "user-1")).toBe(true);
  });

  it("rejects a session owned by another user", () => {
    expect(canRevokeSession("user-2", "user-1")).toBe(false);
  });
});
