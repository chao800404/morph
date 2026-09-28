import type { ProductCategoryDTO } from "@/lib/product/dto/product-taxonomy.dto";
import type { ProductCollectionDTO } from "@/lib/product/dto/product-collection.dto";
import type { ProductDTO } from "@/lib/product/dto/product.dto";
import type {
  ProductTagAdminDTO,
  ProductTypeAdminDTO,
} from "@/lib/product/dto/product-taxonomy.dto";
import type { ProductTaxonomyWriteDal } from "./product-taxonomy-write.service";
import { createProductTaxonomyWriteService } from "./product-taxonomy-write.service";
import { describe, expect, it, vi } from "vitest";

const categoryId = "550e8400-e29b-41d4-a716-446655440000";
const parentId = "8d5b2394-10bb-4d8b-9a76-4d5bcdba6ea4";
const collectionId = "d9428888-122b-4a28-9f65-acef5eec27ee";
const now = new Date("2026-09-28T00:00:00.000Z");

const category: ProductCategoryDTO = {
  id: categoryId,
  name: "Outerwear",
  description: "",
  handle: "outerwear",
  mpath: `/${categoryId}`,
  parentCategoryId: null,
  isActive: false,
  isInternal: false,
  rank: 0,
  metadata: {},
  createdAt: now,
  updatedAt: now,
};

const collection: ProductCollectionDTO = {
  id: collectionId,
  title: "Autumn Edit",
  handle: "autumn-edit",
  description: null,
  externalId: null,
  metadata: {},
  createdBy: "admin-1",
  updatedBy: "admin-1",
  createdAt: now,
  updatedAt: now,
};

const product = (id: string): ProductDTO => ({
  id,
  title: "Jacket",
  handle: `jacket-${id}`,
  subtitle: null,
  description: null,
  status: "draft",
  collectionId: null,
  typeId: null,
  discountable: true,
  thumbnailAssetId: null,
  weight: null,
  length: null,
  width: null,
  height: null,
  originCountry: null,
  hsCode: null,
  midCode: null,
  material: null,
  metadata: {},
  createdBy: "admin-1",
  updatedBy: "admin-1",
  createdAt: now,
  updatedAt: now,
});

const productType: ProductTypeAdminDTO = {
  id: "0d5e95e4-2a93-4bb7-93a5-6bf6c1aac001",
  value: "Clothing",
  metadata: {},
  externalId: null,
  createdAt: now,
  updatedAt: now,
};

const productTag: ProductTagAdminDTO = {
  id: "0d5e95e4-2a93-4bb7-93a5-6bf6c1aac002",
  value: "Waterproof",
  metadata: {},
  externalId: null,
  createdAt: now,
  updatedAt: now,
};

const makeDal = () => {
  const categories = {
    findById: vi.fn(async (id: string) =>
      id === parentId ? { ...category, id: parentId, name: "Clothing" } : null,
    ),
    findByHandle: vi.fn(async (handle: string) =>
      handle === "taken" ? { ...category, id: parentId, handle } : null,
    ),
    create: vi.fn(
      async (
        input: Parameters<ProductTaxonomyWriteDal["categories"]["create"]>[0],
      ) => ({
        ...category,
        ...input,
        metadata: input.metadata ?? {},
        updatedAt: now,
        createdAt: now,
      }),
    ),
    update: vi.fn(async (_id: string) => undefined),
    softDelete: vi.fn(async (ids: string[]) =>
      ids.length ? ids.length + 1 : 0,
    ),
  };
  const collections = {
    findById: vi.fn(async (id: string) =>
      id === collectionId ? collection : null,
    ),
    findByHandle: vi.fn(async (handle: string) =>
      handle === "taken" ? { ...collection, id: parentId, handle } : null,
    ),
    findByIds: vi.fn(async (ids: string[]) =>
      ids.includes(collectionId) ? [collection] : [],
    ),
    create: vi.fn(
      async (
        _input: Parameters<ProductTaxonomyWriteDal["collections"]["create"]>[0],
      ) => undefined,
    ),
    update: vi.fn(async (_id: string) => undefined),
    softDelete: vi.fn(async (_ids: string[], _actorId: string) => undefined),
  };
  const products = {
    findByIds: vi.fn(async (ids: string[]) => ids.map(product)),
    manageCategoryProducts: vi.fn(async (_input) => undefined),
    manageCollectionProducts: vi.fn(async (_input) => undefined),
  };
  const types = {
    findById: vi.fn(async (id: string) =>
      id === productType.id ? productType : null,
    ),
    findByValue: vi.fn(async (value: string) =>
      value === productType.value ? productType : null,
    ),
    create: vi.fn(
      async (
        _input: Parameters<ProductTaxonomyWriteDal["types"]["create"]>[0],
      ) => undefined,
    ),
    update: vi.fn(async (_id: string, _input) => true),
    softDelete: vi.fn(async (_id: string, _actorId: string) => true),
  };
  const tags = {
    findById: vi.fn(async (id: string) =>
      id === productTag.id ? productTag : null,
    ),
    findByValue: vi.fn(async (value: string) =>
      value === productTag.value ? productTag : null,
    ),
    create: vi.fn(
      async (
        _input: Parameters<ProductTaxonomyWriteDal["tags"]["create"]>[0],
      ) => undefined,
    ),
    update: vi.fn(async (_id: string, _input) => true),
    softDelete: vi.fn(async (_id: string, _actorId: string) => true),
  };
  return {
    categories,
    collections,
    products,
    types,
    tags,
  } satisfies ProductTaxonomyWriteDal;
};

describe("product taxonomy write service", () => {
  it("validates category parents and slugifies handles for both create surfaces", async () => {
    const dal = makeDal();
    const service = createProductTaxonomyWriteService({ dal });

    const noParent = await service.createCategory({
      name: "Outerwear",
      parentCategoryId: categoryId,
    });
    expect(noParent).toMatchObject({ success: false, error: "INVALID_PARENT" });
    expect(dal.categories.create).not.toHaveBeenCalled();

    const created = await service.createCategory({
      name: "Outerwear",
      handle: "Outer Wear",
      parentCategoryId: parentId,
    });
    expect(created).toMatchObject({
      success: true,
      data: { id: categoryId, handle: "outer-wear" },
    });
    expect(dal.categories.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Outerwear",
        handle: "outer-wear",
        parentCategoryId: parentId,
      }),
      expect.any(String),
    );
  });

  it("blocks duplicate collection handles and preserves the authenticated actor", async () => {
    const dal = makeDal();
    const service = createProductTaxonomyWriteService({ dal });
    const conflict = await service.createCollection({
      title: "Autumn Edit",
      handle: "Taken",
      actorId: "admin-1",
    });
    expect(conflict).toMatchObject({
      success: false,
      error: "DUPLICATE_HANDLE",
    });
    expect(dal.collections.create).not.toHaveBeenCalled();

    const created = await service.createCollection({
      title: "Spring Edit",
      actorId: "admin-1",
      metadata: { season: "spring" },
    });
    expect(created).toMatchObject({
      success: true,
      data: { id: expect.any(String), handle: "spring-edit" },
    });
    expect(dal.collections.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Spring Edit",
        handle: "spring-edit",
        createdBy: "admin-1",
        updatedBy: "admin-1",
        metadata: { season: "spring" },
      }),
    );
  });

  it("soft-deletes category descendants and only existing collections", async () => {
    const dal = makeDal();
    const service = createProductTaxonomyWriteService({ dal });

    const deletedCategories = await service.deleteCategories([categoryId]);
    expect(deletedCategories).toMatchObject({
      success: true,
      data: { deleted: 2 },
    });
    expect(dal.categories.softDelete).toHaveBeenCalledWith(
      [categoryId],
      expect.any(String),
    );

    const deletedCollections = await service.deleteCollections(
      [collectionId, parentId],
      "admin-1",
    );
    expect(deletedCollections).toMatchObject({
      success: true,
      data: { deleted: 1 },
    });
    expect(dal.collections.softDelete).toHaveBeenCalledWith(
      [collectionId],
      "admin-1",
    );
  });

  it("adds and removes category memberships without replacing other links", async () => {
    const dal = makeDal();
    dal.categories.findById.mockResolvedValue(category);
    const service = createProductTaxonomyWriteService({ dal });
    const result = await service.manageCategoryProducts({
      categoryId,
      add: [parentId, parentId],
      remove: [collectionId],
      actorId: "admin-1",
    });

    expect(result).toMatchObject({ success: true, data: { id: categoryId } });
    expect(dal.products.manageCategoryProducts).toHaveBeenCalledWith({
      categoryId,
      addProductIds: [parentId],
      removeProductIds: [collectionId],
      actorId: "admin-1",
    });
  });

  it("rejects overlapping or missing product membership changes", async () => {
    const dal = makeDal();
    const service = createProductTaxonomyWriteService({ dal });
    const overlap = await service.manageCollectionProducts({
      collectionId,
      add: [parentId],
      remove: [parentId],
      actorId: "admin-1",
    });
    expect(overlap).toMatchObject({
      success: false,
      error: "INVALID_PRODUCT_MEMBERSHIP",
    });
    expect(dal.products.manageCollectionProducts).not.toHaveBeenCalled();

    dal.products.findByIds.mockResolvedValueOnce([]);
    const missing = await service.manageCollectionProducts({
      collectionId,
      add: [parentId],
      remove: [],
      actorId: "admin-1",
    });
    expect(missing).toMatchObject({ success: false, error: "INVALID_PRODUCT" });
  });

  it("creates, updates and deletes product types and tags through the shared service", async () => {
    const dal = makeDal();
    const service = createProductTaxonomyWriteService({ dal });

    const createdType = await service.createProductType({
      value: "  Accessories  ",
      externalId: "legacy-type",
      metadata: { department: "gear" },
    });
    expect(createdType).toMatchObject({
      success: true,
      data: { id: expect.any(String) },
    });
    expect(dal.types.create).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "Accessories",
        externalId: "legacy-type",
        metadata: { department: "gear" },
      }),
    );

    const duplicateTag = await service.createProductTag({
      value: " Waterproof ",
    });
    expect(duplicateTag).toMatchObject({
      success: false,
      error: "DUPLICATE_VALUE",
    });
    expect(dal.tags.create).not.toHaveBeenCalled();

    const updatedTag = await service.updateProductTag({
      id: productTag.id,
      value: "Rainproof",
      externalId: "tag-1",
    });
    expect(updatedTag).toMatchObject({
      success: true,
      data: { id: productTag.id },
    });
    expect(dal.tags.update).toHaveBeenCalledWith(productTag.id, {
      value: "Rainproof",
      metadata: undefined,
      externalId: "tag-1",
    });

    const deletedType = await service.deleteProductType(
      productType.id,
      "admin-1",
    );
    expect(deletedType).toMatchObject({
      success: true,
      data: { id: productType.id },
    });
    expect(dal.types.softDelete).toHaveBeenCalledWith(
      productType.id,
      "admin-1",
    );
  });
});
