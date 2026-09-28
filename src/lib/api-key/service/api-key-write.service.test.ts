import type { AdminApiKeyDTO } from "@/lib/api-key/dal/api-key.dal";
import type { ApiKeyWriteDal } from "./api-key-write.service";
import { createApiKeyWriteService } from "./api-key-write.service";
import { describe, expect, it, vi } from "vitest";

const id = "550e8400-e29b-41d4-a716-446655440000";
const channelId = "8d5b2394-10bb-4d8b-9a76-4d5bcdba6ea4";
const key: AdminApiKeyDTO = {
  id,
  title: "Credential",
  type: "secret",
  redacted: "sk_550e8400...abcd",
  lastUsedAt: null,
  createdBy: "owner-1",
  revokedBy: null,
  revokedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  salesChannelIds: [],
};

const generated = {
  id,
  token: "sk_550e8400-e29b-41d4-a716-446655440000_0123456789abcdef",
  hash: "salted-hash",
  salt: "random-salt",
  redacted: key.redacted,
};

const makeDal = (overrides: Partial<ApiKeyWriteDal> = {}) =>
  ({
    activeSalesChannelIds: vi.fn(async (ids: string[]) => ids),
    createPublishable: vi.fn(async () => "2026-01-01T00:00:00.000Z"),
    createSecret: vi.fn(async () => "2026-01-01T00:00:00.000Z"),
    findAdminById: vi.fn(async () => key),
    updateSecretTitle: vi.fn(async () => true),
    updatePublishableTitle: vi.fn(async () => true),
    managePublishableSalesChannels: vi.fn(async () => true),
    revokeSecret: vi.fn(async () => true),
    revoke: vi.fn(async () => true),
    deleteRevokedSecret: vi.fn(async () => true),
    deleteRevokedPublishable: vi.fn(async () => true),
    ...overrides,
  }) satisfies ApiKeyWriteDal;

describe("apiKeyWriteService", () => {
  it("stores a secret key hash and returns its plaintext only at creation", async () => {
    const keys = makeDal();
    const service = createApiKeyWriteService({
      keys,
      createSecretApiKey: vi.fn(async () => generated),
      now: () => "2026-01-02T00:00:00.000Z",
    });

    const result = await service.create({
      type: "secret",
      title: "Integration",
      createdBy: "owner-1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.token).toBe(generated.token);
    expect(result.data.createdBy).toBe("owner-1");
    expect(keys.createSecret).toHaveBeenCalledWith({
      id,
      hash: generated.hash,
      salt: generated.salt,
      redacted: generated.redacted,
      title: "Integration",
      createdBy: "owner-1",
      now: "2026-01-02T00:00:00.000Z",
    });
    expect(keys.activeSalesChannelIds).not.toHaveBeenCalled();
  });

  it("refuses disabled or missing channels before creating a publishable key", async () => {
    const keys = makeDal({
      activeSalesChannelIds: vi.fn(async () => []),
    });
    const service = createApiKeyWriteService({ keys });

    const result = await service.create({
      type: "publishable",
      title: "Storefront",
      createdBy: "owner-1",
      salesChannelIds: [channelId],
    });

    expect(result).toMatchObject({
      success: false,
      error: "INVALID_SALES_CHANNEL",
    });
    expect(keys.createPublishable).not.toHaveBeenCalled();
  });

  it("scopes secret title changes to the authenticated key owner", async () => {
    const keys = makeDal({
      findAdminById: vi.fn(async (_id: string, actorId: string) =>
        actorId === key.createdBy ? key : null,
      ),
    });
    const service = createApiKeyWriteService({ keys });

    const denied = await service.updateTitle({
      id,
      actorId: "other-admin",
      expectedType: "secret",
      title: "Changed",
    });
    expect(denied).toMatchObject({ success: false, error: "NOT_FOUND" });
    expect(keys.updateSecretTitle).not.toHaveBeenCalled();

    const updated = await service.updateTitle({
      id,
      actorId: "owner-1",
      expectedType: "secret",
      title: "Changed",
    });
    expect(updated.success).toBe(true);
    expect(keys.updateSecretTitle).toHaveBeenCalledWith(
      id,
      "owner-1",
      "Changed",
    );
  });

  it("checks added sales channels before changing a publishable key scope", async () => {
    const publishable = { ...key, type: "publishable" as const };
    const keys = makeDal({
      findAdminById: vi.fn(async () => publishable),
      activeSalesChannelIds: vi.fn(async () => []),
    });
    const service = createApiKeyWriteService({ keys });

    const result = await service.manageSalesChannels({
      id,
      actorId: "owner-1",
      add: [channelId],
      remove: [],
    });

    expect(result).toMatchObject({
      success: false,
      error: "INVALID_SALES_CHANNEL",
    });
    expect(keys.managePublishableSalesChannels).not.toHaveBeenCalled();
  });
});
