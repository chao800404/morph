import type {
  ReferenceDataItemDTO,
  ReferenceDataKind,
} from "@/lib/commerce/reference-data";
import type { ServerResult } from "@/lib/db/server-result";
import type { AdminApiAccess } from "./orders";
import { fail, ok } from "@/lib/db/server-result";
import type { AdminReferenceDataApiDependencies } from "./reference-data";
import { handleAdminReferenceDataRequest } from "./reference-data";
import { describe, expect, it, vi } from "vitest";

const itemId = "550e8400-e29b-41d4-a716-446655440000";
const parentId = "8d5b2394-10bb-4d8b-9a76-4d5bcdba6ea4";

const row: ReferenceDataItemDTO = {
  id: itemId,
  name: "Damaged",
  externalId: null,
  code: "damaged",
  description: "The item is damaged",
  parentId: null,
  parentName: null,
  usageCount: 0,
  metadata: { source: "admin" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const makeDependencies = () => {
  const dependencies = {
    authorize: vi.fn(async (_request: Request): Promise<AdminApiAccess> => ({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    })),
    list: vi.fn(
      async (_input: {
        kind: ReferenceDataKind;
        offset?: number;
        page: number;
        limit: number;
        query?: string;
        sortBy: "name" | "createdAt" | "updatedAt";
        sortOrder: "asc" | "desc";
      }) => ({ items: [row], pagination: { total: 1 } }),
    ),
    find: vi.fn(async (_kind: ReferenceDataKind, _id: string) => row),
    create: vi.fn(async (): Promise<ServerResult<{ id: string }>> =>
      ok("created", { id: itemId }),
    ),
    update: vi.fn(async () => ok("updated", { id: itemId })),
    deleteMany: vi.fn(async () => ok("deleted", { deleted: 1 })),
  } satisfies AdminReferenceDataApiDependencies;
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

describe("handleAdminReferenceDataRequest", () => {
  it("lists product types using Medusa pagination and snake_case fields", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminReferenceDataRequest(
      new Request(
        "https://morph.test/api/admin/product-types?q=Damaged&offset=4&limit=5&order=value",
      ),
      "product-types",
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.list).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "product-types",
        query: "Damaged",
        offset: 4,
        page: 1,
        limit: 5,
        sortBy: "name",
        sortOrder: "asc",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      product_types: [{ value: "Damaged", external_id: null }],
      count: 1,
      offset: 4,
      limit: 5,
    });
  });

  it("creates a return reason and maps the canonical API fields", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminReferenceDataRequest(
      jsonRequest("https://morph.test/api/admin/return-reasons", "POST", {
        value: "damaged",
        label: "Damaged",
        description: "The item is damaged",
        parent_return_reason_id: parentId,
        metadata: { source: "admin" },
      }),
      "return-reasons",
      dependencies,
    );

    expect(response.status).toBe(201);
    expect(dependencies.create).toHaveBeenCalledWith({
      kind: "return-reasons",
      name: "Damaged",
      code: "damaged",
      description: "The item is damaged",
      parentId,
      metadata: { source: "admin" },
    });
    await expect(response.json()).resolves.toMatchObject({
      return_reason: {
        value: "damaged",
        label: "Damaged",
        parent_return_reason_id: null,
      },
    });
  });

  it("updates a product tag, deletes with the Medusa object name, and maps conflicts", async () => {
    const dependencies = makeDependencies();
    const updated = await handleAdminReferenceDataRequest(
      jsonRequest(
        `https://morph.test/api/admin/product-tags/${itemId}`,
        "POST",
        { value: "outerwear", external_id: null },
      ),
      `product-tags/${itemId}`,
      dependencies,
    );
    expect(updated.status).toBe(200);
    expect(dependencies.update).toHaveBeenCalledWith({
      kind: "product-tags",
      id: itemId,
      name: "outerwear",
      externalId: null,
    });

    const deleted = await handleAdminReferenceDataRequest(
      jsonRequest(
        `https://morph.test/api/admin/product-tags/${itemId}`,
        "DELETE",
      ),
      `product-tags/${itemId}`,
      dependencies,
    );
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({
      id: itemId,
      object: "product_tag",
      deleted: true,
    });

    dependencies.create.mockResolvedValueOnce(
      fail("A record with this value already exists", {
        error: "DUPLICATE_VALUE",
      }),
    );
    const conflict = await handleAdminReferenceDataRequest(
      jsonRequest("https://morph.test/api/admin/product-types", "POST", {
        value: "outerwear",
      }),
      "product-types",
      dependencies,
    );
    expect(conflict.status).toBe(409);
  });

  it("requires admin access and rejects malformed API input", async () => {
    const dependencies = makeDependencies();
    dependencies.authorize.mockResolvedValue({
      allowed: true,
      userId: "staff-1",
      role: "user",
    });
    const forbidden = await handleAdminReferenceDataRequest(
      new Request("https://morph.test/api/admin/refund-reasons"),
      "refund-reasons",
      dependencies,
    );
    expect(forbidden.status).toBe(403);

    dependencies.authorize.mockResolvedValue({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    });
    const invalid = await handleAdminReferenceDataRequest(
      jsonRequest("https://morph.test/api/admin/refund-reasons", "POST", {
        label: "No code",
      }),
      "refund-reasons",
      dependencies,
    );
    expect(invalid.status).toBe(400);
    expect(dependencies.create).not.toHaveBeenCalled();
  });
});
