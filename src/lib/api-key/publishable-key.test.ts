import { describe, expect, it } from "vitest";
import {
  createPublishableKey,
  parsePublishableKeyId,
  verifyPublishableKey,
} from "./publishable-key";

describe("publishable keys", () => {
  it("creates a one-time token whose id can be used for indexed lookup", async () => {
    const key = await createPublishableKey();
    expect(parsePublishableKeyId(key.token)).toBe(key.id);
    expect(key.hash).not.toContain(key.token);
    expect(key.redacted).not.toBe(key.token);
    expect(await verifyPublishableKey(key.token, key.salt, key.hash)).toBe(
      true,
    );
  });

  it("rejects malformed and modified tokens", async () => {
    const key = await createPublishableKey();
    expect(parsePublishableKeyId("pk_invalid")).toBeNull();
    expect(
      await verifyPublishableKey(`${key.token}0`, key.salt, key.hash),
    ).toBe(false);
  });
});
