import { describe, expect, it } from "vitest";
import { createInviteToken, hashInviteToken } from "./token";

describe("invite tokens", () => {
  it("creates opaque 256-bit tokens", () => {
    const first = createInviteToken();
    const second = createInviteToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });

  it("stores a one-way SHA-256 digest", async () => {
    const token = "a".repeat(64);
    const digest = await hashInviteToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(token);
    expect(await hashInviteToken(token)).toBe(digest);
  });
});
