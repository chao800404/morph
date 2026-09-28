import { describe, expect, it } from "vitest";
import {
  createSecretApiKey,
  parseSecretApiKeyId,
  verifyApiKeyToken,
} from "./publishable-key";

describe("secret API key generation", () => {
  it("creates a one-time secret whose salted hash verifies", async () => {
    const key = await createSecretApiKey();
    expect(key.token).toMatch(/^sk_[0-9a-f-]{36}_[0-9a-f]{48}$/);
    expect(parseSecretApiKeyId(key.token)).toBe(key.id);
    expect(key.redacted).toBe(`${key.token.slice(0, 11)}...${key.token.slice(-4)}`);
    expect(key.hash).not.toBe(key.token);
    await expect(
      verifyApiKeyToken(key.token, key.salt, key.hash),
    ).resolves.toBe(true);
    await expect(
      verifyApiKeyToken(`${key.token}x`, key.salt, key.hash),
    ).resolves.toBe(false);
  });
});
