import { describe, expect, it, vi } from "vitest";
import {
  authenticateAdminSecretApiKey,
  parseSecretApiKeyAuthorization,
  type SecretApiKeyAuthDependencies,
} from "./secret-api-key-auth";

const token = `sk_123e4567-e89b-12d3-a456-426614174000_${"a".repeat(48)}`;
const keyId = "123e4567-e89b-12d3-a456-426614174000";

const dependencies = (
  overrides: Partial<SecretApiKeyAuthDependencies> = {},
): SecretApiKeyAuthDependencies => ({
  findActiveSecretById: vi.fn(async () => ({
    id: keyId,
    hash: "stored-hash",
    salt: "stored-salt",
    createdBy: "admin-user",
  })),
  findSecretOwner: vi.fn(async () => ({
    id: "admin-user",
    role: "admin",
    banned: false,
  })),
  verifyToken: vi.fn(async () => true),
  recordSecretUse: vi.fn(async () => true),
  ...overrides,
});

describe("Medusa-shaped secret API key authorization", () => {
  it("accepts a direct Basic secret token and resolves its key id", () => {
    expect(parseSecretApiKeyAuthorization(`Basic ${token}`)).toEqual({
      token,
      id: keyId,
    });
  });

  it("accepts the legacy base64 Basic key form", () => {
    expect(
      parseSecretApiKeyAuthorization(`Basic ${btoa(`${token}:`)}`),
    ).toEqual({ token, id: keyId });
  });

  it("does not accept Bearer credentials or malformed tokens", () => {
    expect(parseSecretApiKeyAuthorization(`Bearer ${token}`)).toBeNull();
    expect(parseSecretApiKeyAuthorization("Basic not-a-key")).toBeNull();
  });

  it("authenticates an active key as its current admin owner and records use", async () => {
    const deps = dependencies();
    await expect(
      authenticateAdminSecretApiKey(`Basic ${token}`, deps),
    ).resolves.toEqual({ userId: "admin-user", role: "admin" });
    expect(deps.findActiveSecretById).toHaveBeenCalledWith(keyId);
    expect(deps.verifyToken).toHaveBeenCalledWith(
      token,
      "stored-salt",
      "stored-hash",
    );
    expect(deps.recordSecretUse).toHaveBeenCalledWith(keyId);
  });

  it("accepts an admin role included with other assigned roles", async () => {
    const deps = dependencies({
      findSecretOwner: vi.fn(async () => ({
        id: "admin-user",
        role: "user, admin",
        banned: false,
      })),
    });
    await expect(
      authenticateAdminSecretApiKey(`Basic ${token}`, deps),
    ).resolves.toEqual({ userId: "admin-user", role: "admin" });
  });

  it("rejects invalid tokens, revoked keys, non-admin owners, and banned owners", async () => {
    const invalidToken = dependencies({
      verifyToken: vi.fn(async () => false),
    });
    await expect(
      authenticateAdminSecretApiKey(`Basic ${token}`, invalidToken),
    ).resolves.toBeNull();
    expect(invalidToken.findSecretOwner).not.toHaveBeenCalled();

    const revoked = dependencies({
      findActiveSecretById: vi.fn(async () => null),
    });
    await expect(
      authenticateAdminSecretApiKey(`Basic ${token}`, revoked),
    ).resolves.toBeNull();

    const ordinaryUser = dependencies({
      findSecretOwner: vi.fn(async () => ({
        id: "admin-user",
        role: "user",
        banned: false,
      })),
    });
    await expect(
      authenticateAdminSecretApiKey(`Basic ${token}`, ordinaryUser),
    ).resolves.toBeNull();
    expect(ordinaryUser.recordSecretUse).not.toHaveBeenCalled();

    const banned = dependencies({
      findSecretOwner: vi.fn(async () => ({
        id: "admin-user",
        role: "admin",
        banned: true,
      })),
    });
    await expect(
      authenticateAdminSecretApiKey(`Basic ${token}`, banned),
    ).resolves.toBeNull();
  });

  it("rejects a key revoked between lookup and last-used update", async () => {
    const deps = dependencies({ recordSecretUse: vi.fn(async () => false) });
    await expect(
      authenticateAdminSecretApiKey(`Basic ${token}`, deps),
    ).resolves.toBeNull();
  });
});
