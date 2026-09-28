import { fail, ok } from "@/lib/db/server-result";
import type { ServerResult } from "@/lib/db/server-result";
import type { ProductCategoryDetailDTO } from "@/lib/product/dto/product-taxonomy.dto";
import type { ProductCollectionDTO } from "@/lib/product/dto/product-collection.dto";
import type { AdminApiAccess } from "./orders";
import type { AdminProductTaxonomyApiDependencies } from "./product-taxonomy";
import { handleAdminProductTaxonomyRequest } from "./product-taxonomy";
import { describe, expect, it, vi } from "vitest";

const categoryId = "550e8400-e29b-41d4-a716-446655440000";
const collectionId = "8d5b2394-10bb-4d8b-9a76-4d5bcdba6ea4";
const now = new Date("2026-09-28T00:00:00.000Z");

const category: ProductCategoryDetailDTO = {
  id: categoryId,
  name: "Outerwear",
  description: "Coats and jackets",
  handle: "outerwear",
  mpath: `/${categoryId}`,
  parentCategoryId: null,
  isActive: true,
  isInternal: false,
  rank: 0,
  metadata: { season: "fall" },
  createdAt: now,
  updatedAt: now,
  ancestorNames: [],
  children: [{ id: collectionId, name: "Jackets" }],
};

const collection: ProductCollectionDTO = {
  id: collectionId,
  title: "Autumn Edit",
  handle: "autumn-edit",
  description: "Fall arrivals",
  externalId: null,
  metadata: { season: "fall" },
  createdBy: "admin-1",
  updatedBy: "admin-1",
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
    listCategories: vi.fn(async () => ({ categories: [category], total: 1 })),
    findCategory: vi.fn(async (_id: string) => category),
    createCategory: vi.fn(async () =>
      ok("created", { id: categoryId, handle: "outerwear" }),
    ),
    updateCategory: vi.fn(async () => ok("updated", { id: categoryId })),
    deleteCategories: vi.fn(async () => ok("deleted", { deleted: 2 })),
    manageCategoryProducts: vi.fn(async () =>
      ok("updated", { id: categoryId }),
    ),
    listCollections: vi.fn(async () => ({
      collections: [collection],
      total: 1,
    })),
    findCollection: vi.fn(async (_id: string) => collection),
    createCollection: vi.fn(
      async (): Promise<ServerResult<{ id: string; handle: string }>> =>
        ok("created", { id: collectionId, handle: "autumn-edit" }),
    ),
    updateCollection: vi.fn(async () => ok("updated", { id: collectionId })),
    deleteCollections: vi.fn(async () => ok("deleted", { deleted: 1 })),
    manageCollectionProducts: vi.fn(async () =>
      ok("updated", { id: collectionId }),
    ),
  } satisfies AdminProductTaxonomyApiDependencies;
  return dependencies;
};

const jsonRequest = (url: string, method: "POST", body: unknown) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("handleAdminProductTaxonomyRequest", () => {
  it("lists categories with Medusa pagination and snake_case taxonomy fields", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminProductTaxonomyRequest(
      new Request(
        "https://morph.test/api/admin/product-categories?q=outer&offset=10&limit=5&order=-created_at",
      ),
      "product-categories",
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.listCategories).toHaveBeenCalledWith({
      query: "outer",
      sortBy: "createdAt",
      sortOrder: "desc",
      page: 3,
      limit: 5,
      offset: 10,
    });
    await expect(response.json()).resolves.toMatchObject({
      product_categories: [
        {
          id: categoryId,
          name: "Outerwear",
          parent_category_id: null,
          category_children: [{ id: collectionId, name: "Jackets" }],
          is_active: true,
        },
      ],
      count: 1,
      offset: 10,
      limit: 5,
    });
  });

  it("creates categories from Medusa snake_case input and keeps validation errors", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminProductTaxonomyRequest(
      jsonRequest("https://morph.test/api/admin/product-categories", "POST", {
        name: "Outerwear",
        handle: "Outer Wear",
        parent_category_id: categoryId,
        is_active: true,
        is_internal: false,
        metadata: { season: "fall" },
      }),
      "product-categories",
      dependencies,
    );

    expect(response.status).toBe(201);
    expect(dependencies.createCategory).toHaveBeenCalledWith({
      name: "Outerwear",
      handle: "Outer Wear",
      description: undefined,
      parentCategoryId: categoryId,
      isActive: true,
      isInternal: false,
      metadata: { season: "fall" },
    });
    await expect(response.json()).resolves.toMatchObject({
      product_category: { id: categoryId, handle: "outerwear" },
    });

    const invalid = await handleAdminProductTaxonomyRequest(
      jsonRequest("https://morph.test/api/admin/product-categories", "POST", {
        name: "",
        unexpected: true,
      }),
      "product-categories",
      dependencies,
    );
    expect(invalid.status).toBe(400);
    expect(dependencies.createCategory).toHaveBeenCalledTimes(1);
  });

  it("updates a collection through the shared write service and deletes a category subtree", async () => {
    const dependencies = makeDependencies();
    const update = await handleAdminProductTaxonomyRequest(
      jsonRequest(
        `https://morph.test/api/admin/collections/${collectionId}`,
        "POST",
        { title: "Autumn Edit", metadata: { season: "winter" } },
      ),
      `collections/${collectionId}`,
      dependencies,
    );
    expect(update.status).toBe(200);
    expect(dependencies.updateCollection).toHaveBeenCalledWith({
      id: collectionId,
      title: "Autumn Edit",
      handle: undefined,
      description: undefined,
      metadata: { season: "winter" },
      actorId: "admin-1",
    });

    const deleted = await handleAdminProductTaxonomyRequest(
      new Request(
        `https://morph.test/api/admin/product-categories/${categoryId}`,
        {
          method: "DELETE",
        },
      ),
      `product-categories/${categoryId}`,
      dependencies,
    );
    expect(deleted.status).toBe(200);
    expect(dependencies.deleteCategories).toHaveBeenCalledWith([categoryId]);
    await expect(deleted.json()).resolves.toEqual({
      id: categoryId,
      object: "product-category",
      deleted: true,
    });
  });

  it("requires a real admin actor and returns conflicts from the domain service", async () => {
    const dependencies = makeDependencies();
    dependencies.authorize.mockResolvedValueOnce({
      allowed: true,
      role: "user",
      userId: "user-1",
    });
    const forbidden = await handleAdminProductTaxonomyRequest(
      new Request("https://morph.test/api/admin/collections"),
      "collections",
      dependencies,
    );
    expect(forbidden.status).toBe(403);

    dependencies.createCollection.mockResolvedValueOnce(
      fail("A collection with this handle already exists", {
        error: "DUPLICATE_HANDLE",
        errors: { handle: ["This handle is already in use"] },
      }),
    );
    const conflict = await handleAdminProductTaxonomyRequest(
      jsonRequest("https://morph.test/api/admin/collections", "POST", {
        title: "Autumn Edit",
      }),
      "collections",
      dependencies,
    );
    expect(conflict.status).toBe(409);
  });

  it("updates category and collection product memberships using Medusa routes", async () => {
    const dependencies = makeDependencies();
    const categoryResponse = await handleAdminProductTaxonomyRequest(
      jsonRequest(
        `https://morph.test/api/admin/product-categories/${categoryId}/products`,
        "POST",
        { add: [collectionId], remove: [categoryId] },
      ),
      `product-categories/${categoryId}/products`,
      dependencies,
    );
    expect(categoryResponse.status).toBe(200);
    expect(dependencies.manageCategoryProducts).toHaveBeenCalledWith({
      categoryId,
      add: [collectionId],
      remove: [categoryId],
      actorId: "admin-1",
    });
    await expect(categoryResponse.json()).resolves.toMatchObject({
      product_category: { id: categoryId },
    });

    const collectionResponse = await handleAdminProductTaxonomyRequest(
      jsonRequest(
        `https://morph.test/api/admin/collections/${collectionId}/products`,
        "POST",
        { add: [categoryId] },
      ),
      `collections/${collectionId}/products`,
      dependencies,
    );
    expect(collectionResponse.status).toBe(200);
    expect(dependencies.manageCollectionProducts).toHaveBeenCalledWith({
      collectionId,
      add: [categoryId],
      remove: [],
      actorId: "admin-1",
    });

    const invalid = await handleAdminProductTaxonomyRequest(
      jsonRequest(
        `https://morph.test/api/admin/collections/${collectionId}/products`,
        "POST",
        { add: ["not-a-uuid"] },
      ),
      `collections/${collectionId}/products`,
      dependencies,
    );
    expect(invalid.status).toBe(400);
    expect(dependencies.manageCollectionProducts).toHaveBeenCalledTimes(1);
  });
});
