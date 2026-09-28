import { ok } from "@/lib/db/server-result";
import type {
  ProductTagAdminDTO,
  ProductTypeAdminDTO,
} from "@/lib/product/dto/product-taxonomy.dto";
import type { AdminApiAccess } from "./orders";
import type { AdminProductDictionariesApiDependencies } from "./product-dictionaries";
import { handleAdminProductDictionariesRequest } from "./product-dictionaries";
import { describe, expect, it, vi } from "vitest";

const typeId = "0d5e95e4-2a93-4bb7-93a5-6bf6c1aac001";
const tagId = "0d5e95e4-2a93-4bb7-93a5-6bf6c1aac002";
const now = new Date("2026-09-28T00:00:00.000Z");

const productType: ProductTypeAdminDTO = {
  id: typeId,
  value: "Clothing",
  metadata: { department: "apparel" },
  externalId: "type-ref-1",
  createdAt: now,
  updatedAt: now,
};

const productTag: ProductTagAdminDTO = {
  id: tagId,
  value: "Waterproof",
  metadata: { season: "fall" },
  externalId: null,
  createdAt: now,
  updatedAt: now,
};

const makeDependencies = () => {
  const dependencies = {
    authorize: vi.fn(async (_request: Request): Promise<AdminApiAccess> => ({
      allowed: true,
      userId: "admin-1",
      role: "admin",
    })),
    listTypes: vi.fn(async () => ({ types: [productType], total: 1 })),
    findType: vi.fn(async (_id: string) => productType),
    createType: vi.fn(async () => ok("created", { id: typeId })),
    updateType: vi.fn(async () => ok("updated", { id: typeId })),
    deleteType: vi.fn(async () => ok("deleted", { id: typeId })),
    listTags: vi.fn(async () => ({ tags: [productTag], total: 1 })),
    findTag: vi.fn(async (_id: string) => productTag),
    createTag: vi.fn(async () => ok("created", { id: tagId })),
    updateTag: vi.fn(async () => ok("updated", { id: tagId })),
    deleteTag: vi.fn(async () => ok("deleted", { id: tagId })),
  } satisfies AdminProductDictionariesApiDependencies;
  return dependencies;
};

const jsonRequest = (url: string, method: "POST", body: unknown) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("handleAdminProductDictionariesRequest", () => {
  it("lists product types and tags with Medusa pagination fields", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminProductDictionariesRequest(
      new Request(
        "https://morph.test/api/admin/product-types?q=cloth&offset=10&limit=5&order=-updated_at",
      ),
      "product-types",
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.listTypes).toHaveBeenCalledWith({
      query: "cloth",
      sortBy: "updatedAt",
      sortOrder: "desc",
      offset: 10,
      limit: 5,
    });
    await expect(response.json()).resolves.toMatchObject({
      product_types: [
        {
          id: typeId,
          value: "Clothing",
          external_id: "type-ref-1",
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
      ],
      count: 1,
      offset: 10,
      limit: 5,
    });

    const tagsResponse = await handleAdminProductDictionariesRequest(
      new Request("https://morph.test/api/admin/product-tags"),
      "product-tags",
      dependencies,
    );
    await expect(tagsResponse.json()).resolves.toMatchObject({
      product_tags: [
        { id: tagId, value: "Waterproof", metadata: { season: "fall" } },
      ],
    });
  });

  it("creates and updates types and tags using the standard admin shapes", async () => {
    const dependencies = makeDependencies();
    const created = await handleAdminProductDictionariesRequest(
      jsonRequest("https://morph.test/api/admin/product-types", "POST", {
        value: "Clothing",
        external_id: "type-ref-1",
        metadata: { department: "apparel" },
      }),
      "product-types",
      dependencies,
    );
    expect(created.status).toBe(200);
    expect(dependencies.createType).toHaveBeenCalledWith({
      value: "Clothing",
      externalId: "type-ref-1",
      metadata: { department: "apparel" },
    });
    await expect(created.json()).resolves.toMatchObject({
      product_type: { id: typeId, value: "Clothing" },
    });

    const updated = await handleAdminProductDictionariesRequest(
      jsonRequest(
        `https://morph.test/api/admin/product-tags/${tagId}`,
        "POST",
        {
          value: "Rainproof",
        },
      ),
      `product-tags/${tagId}`,
      dependencies,
    );
    expect(updated.status).toBe(200);
    expect(dependencies.updateTag).toHaveBeenCalledWith({
      id: tagId,
      value: "Rainproof",
      metadata: undefined,
      externalId: undefined,
    });
  });

  it("uses the verified admin actor for deletion and rejects malformed requests", async () => {
    const dependencies = makeDependencies();
    const deleted = await handleAdminProductDictionariesRequest(
      new Request(`https://morph.test/api/admin/product-tags/${tagId}`, {
        method: "DELETE",
      }),
      `product-tags/${tagId}`,
      dependencies,
    );
    expect(deleted.status).toBe(200);
    expect(dependencies.deleteTag).toHaveBeenCalledWith(tagId, "admin-1");
    await expect(deleted.json()).resolves.toEqual({
      id: tagId,
      object: "product-tag",
      deleted: true,
    });

    const invalid = await handleAdminProductDictionariesRequest(
      jsonRequest("https://morph.test/api/admin/product-types", "POST", {
        value: " ",
        unsupported: true,
      }),
      "product-types",
      dependencies,
    );
    expect(invalid.status).toBe(400);
    expect(dependencies.createType).not.toHaveBeenCalled();

    dependencies.authorize.mockResolvedValueOnce({
      allowed: true,
      userId: "user-1",
      role: "user",
    });
    const forbidden = await handleAdminProductDictionariesRequest(
      new Request("https://morph.test/api/admin/product-types"),
      "product-types",
      dependencies,
    );
    expect(forbidden.status).toBe(403);
  });
});
