import type { AdminApiKeyDTO } from "@/lib/api-key/dal/api-key.dal";
import type { CreatedApiKey } from "@/lib/api-key/service/api-key-write.service";
import { fail, ok } from "@/lib/db/server-result";
import type { AdminApiKeysApiDependencies } from "./api-keys";
import { handleAdminApiKeysRequest } from "./api-keys";
import type { AdminApiAccess } from "./orders";
import { describe, expect, it, vi } from "vitest";

const keyId = "550e8400-e29b-41d4-a716-446655440000";
const salesChannelId = "8d5b2394-10bb-4d8b-9a76-4d5bcdba6ea4";
const row: AdminApiKeyDTO = {
  id: keyId,
  title: "Storefront key",
  type: "publishable",
  redacted: "pk_550e8400...abcd",
  lastUsedAt: null,
  createdBy: "admin-1",
  revokedBy: null,
  revokedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  salesChannelIds: [salesChannelId],
};

const created: CreatedApiKey = {
  ...row,
  type: "publishable",
  lastUsedAt: null,
  revokedBy: null,
  revokedAt: null,
  deletedAt: null,
  token: "pk_550e8400-e29b-41d4-a716-446655440000_0123456789abcdef",
};

const makeDependencies = () => {
  const dependencies = {
    authorize: vi.fn(async (): Promise<AdminApiAccess> => ({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    })),
    list: vi.fn(async () => ({ apiKeys: [row], total: 1 })),
    find: vi.fn(async () => row),
    create: vi.fn(async () => ok("created", created)),
    updateTitle: vi.fn(async () => ok("updated", { id: keyId })),
    manageSalesChannels: vi.fn(async () =>
      ok("updated", { id: keyId, added: 1, removed: 0 }),
    ),
    revoke: vi.fn(async () => ok("revoked", { id: keyId })),
    deleteRevoked: vi.fn(async () => ok("deleted", { id: keyId })),
  } satisfies AdminApiKeysApiDependencies;
  return dependencies;
};

const jsonRequest = (url: string, method: "POST" | "DELETE", body?: unknown) =>
  new Request(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });

describe("handleAdminApiKeysRequest", () => {
  it("lists visible key metadata in the Medusa pagination shape without tokens", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminApiKeysRequest(
      new Request(
        "https://morph.test/api/admin/api-keys?type=publishable&limit=5",
      ),
      "api-keys",
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.list).toHaveBeenCalledWith(
      expect.objectContaining({ type: "publishable", offset: 0, limit: 5 }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      count: 1,
      offset: 0,
      limit: 5,
      api_keys: [
        {
          id: keyId,
          type: "publishable",
          title: "Storefront key",
          redacted: row.redacted,
          sales_channels: [{ id: salesChannelId }],
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("returns the plaintext token only in the create response", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminApiKeysRequest(
      jsonRequest("https://morph.test/api/admin/api-keys", "POST", {
        title: "Storefront key",
        type: "publishable",
      }),
      "api-keys",
      dependencies,
    );

    expect(response.status).toBe(201);
    expect(dependencies.create).toHaveBeenCalledWith(
      { title: "Storefront key", type: "publishable" },
      "admin-1",
    );
    await expect(response.json()).resolves.toMatchObject({
      api_key: { token: created.token, redacted: created.redacted },
    });
  });

  it("updates key title and returns refreshed metadata", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminApiKeysRequest(
      jsonRequest(`https://morph.test/api/admin/api-keys/${keyId}`, "POST", {
        title: "Updated storefront",
      }),
      `api-keys/${keyId}`,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.updateTitle).toHaveBeenCalledWith({
      id: keyId,
      actorId: "admin-1",
      title: "Updated storefront",
    });
    await expect(response.json()).resolves.toMatchObject({
      api_key: { id: keyId, redacted: row.redacted },
    });
  });

  it("batches additions and removals for a publishable key", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminApiKeysRequest(
      jsonRequest(
        `https://morph.test/api/admin/api-keys/${keyId}/sales-channels`,
        "POST",
        {
          add: [salesChannelId],
          remove: ["1c3dbcc0-9d7c-4f5e-9dc1-9acdd9f3a4b1"],
        },
      ),
      `api-keys/${keyId}/sales-channels`,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.manageSalesChannels).toHaveBeenCalledWith({
      id: keyId,
      actorId: "admin-1",
      add: [salesChannelId],
      remove: ["1c3dbcc0-9d7c-4f5e-9dc1-9acdd9f3a4b1"],
    });
  });

  it("revokes a key and allows deleting only after revocation", async () => {
    const dependencies = makeDependencies();
    const revokeResponse = await handleAdminApiKeysRequest(
      jsonRequest(
        `https://morph.test/api/admin/api-keys/${keyId}/revoke`,
        "POST",
      ),
      `api-keys/${keyId}/revoke`,
      dependencies,
    );
    expect(revokeResponse.status).toBe(200);
    expect(dependencies.revoke).toHaveBeenCalledWith({
      id: keyId,
      actorId: "admin-1",
    });

    const deleteResponse = await handleAdminApiKeysRequest(
      jsonRequest(`https://morph.test/api/admin/api-keys/${keyId}`, "DELETE"),
      `api-keys/${keyId}`,
      dependencies,
    );
    expect(deleteResponse.status).toBe(200);
    expect(dependencies.deleteRevoked).toHaveBeenCalledWith({
      id: keyId,
      actorId: "admin-1",
    });
  });

  it("requires an admin and rejects malformed route bodies", async () => {
    const dependencies = makeDependencies();
    dependencies.authorize.mockResolvedValue({
      allowed: true,
      userId: "staff-1",
      role: "user",
    });
    const forbidden = await handleAdminApiKeysRequest(
      new Request("https://morph.test/api/admin/api-keys"),
      "api-keys",
      dependencies,
    );
    expect(forbidden.status).toBe(403);

    dependencies.authorize.mockResolvedValue({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    });
    const invalid = await handleAdminApiKeysRequest(
      jsonRequest("https://morph.test/api/admin/api-keys", "POST", {
        title: "",
        type: "publishable",
      }),
      "api-keys",
      dependencies,
    );
    expect(invalid.status).toBe(400);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it("maps unavailable channels and active-key deletion to client conflicts", async () => {
    const dependencies: AdminApiKeysApiDependencies = {
      ...makeDependencies(),
      manageSalesChannels: vi.fn(async () =>
        fail("Sales channel unavailable", { error: "INVALID_SALES_CHANNEL" }),
      ),
      deleteRevoked: vi.fn(async () =>
        fail("Key must be revoked first", { error: "ACTIVE_KEY" }),
      ),
    };
    const invalidChannels = await handleAdminApiKeysRequest(
      jsonRequest(
        `https://morph.test/api/admin/api-keys/${keyId}/sales-channels`,
        "POST",
        { add: [salesChannelId] },
      ),
      `api-keys/${keyId}/sales-channels`,
      dependencies,
    );
    expect(invalidChannels.status).toBe(400);

    const activeDelete = await handleAdminApiKeysRequest(
      jsonRequest(`https://morph.test/api/admin/api-keys/${keyId}`, "DELETE"),
      `api-keys/${keyId}`,
      dependencies,
    );
    expect(activeDelete.status).toBe(409);
  });
});
