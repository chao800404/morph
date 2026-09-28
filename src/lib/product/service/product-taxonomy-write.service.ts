import { productCollectionDal } from "@/lib/product/dal/product-collection.dal";
import {
  productCategoryDal,
  productTagDal,
  productTypeDal,
} from "@/lib/product/dal/product-taxonomy.dal";
import { productDal } from "@/lib/product/dal/product.dal";
import { fail, ok, type ServerResult } from "@/lib/db/server-result";
import type { ProductMetadata } from "@/db/product.schema";
import { toHandle } from "@/lib/validations/product";

export type ProductTaxonomyWriteDal = {
  categories: Pick<
    typeof productCategoryDal,
    "findById" | "findByHandle" | "create" | "update" | "softDelete"
  >;
  collections: Pick<
    typeof productCollectionDal,
    | "findById"
    | "findByHandle"
    | "findByIds"
    | "create"
    | "update"
    | "softDelete"
  >;
  products: Pick<
    typeof productDal,
    "findByIds" | "manageCategoryProducts" | "manageCollectionProducts"
  >;
  types: Pick<
    typeof productTypeDal,
    "findById" | "findByValue" | "create" | "update" | "softDelete"
  >;
  tags: Pick<
    typeof productTagDal,
    "findById" | "findByValue" | "create" | "update" | "softDelete"
  >;
};

const normalizeProductChanges = (addIds: string[], removeIds: string[]) => {
  const add = [...new Set(addIds)];
  const remove = [...new Set(removeIds)];
  const overlap = add.some((id) => remove.includes(id));
  if (
    add.length > 100 ||
    remove.length > 100 ||
    (add.length === 0 && remove.length === 0) ||
    overlap
  ) {
    return null;
  }
  return { add, remove };
};

const handleConflict = (label: string) =>
  fail(`A ${label} with this handle already exists`, {
    error: "DUPLICATE_HANDLE",
    errors: { handle: ["This handle is already in use"] },
  });

const valueConflict = (label: string) =>
  fail(`A product ${label} with this value already exists`, {
    error: "DUPLICATE_VALUE",
    errors: { value: ["This value is already in use"] },
  });

/** Shared taxonomy validation and writes for Dashboard and Admin REST routes. */
export const createProductTaxonomyWriteService = (
  overrides: Partial<{ dal: ProductTaxonomyWriteDal }> = {},
) => {
  const dal: ProductTaxonomyWriteDal = overrides.dal ?? {
    categories: productCategoryDal,
    collections: productCollectionDal,
    products: productDal,
    types: productTypeDal,
    tags: productTagDal,
  };

  return {
    async createCategory(input: {
      name: string;
      handle?: string;
      description?: string;
      parentCategoryId?: string | null;
      isActive?: boolean;
      isInternal?: boolean;
      metadata?: ProductMetadata;
    }): Promise<ServerResult<{ id: string; handle: string }>> {
      const handleResult = toHandle(input.handle, input.name);
      if (!handleResult.success)
        return fail("Could not derive a valid handle from the name", {
          error: "INVALID_HANDLE",
          errors: {
            handle: [handleResult.error.issues[0]?.message ?? "Invalid handle"],
          },
        });
      const handle = handleResult.data;
      if (await dal.categories.findByHandle(handle))
        return handleConflict("category");
      if (input.parentCategoryId) {
        const parent = await dal.categories.findById(input.parentCategoryId);
        if (!parent)
          return fail("The selected parent category no longer exists", {
            error: "INVALID_PARENT",
            errors: { parentCategoryId: ["Parent category not found"] },
          });
      }

      try {
        const category = await dal.categories.create(
          { ...input, handle },
          new Date().toISOString(),
        );
        return ok(`Category "${category.name}" created`, {
          id: category.id,
          handle,
        });
      } catch (error) {
        if (await dal.categories.findByHandle(handle))
          return handleConflict("category");
        throw error;
      }
    },

    async updateCategory(input: {
      id: string;
      name?: string;
      handle?: string;
      description?: string;
      isActive?: boolean;
      isInternal?: boolean;
      metadata?: ProductMetadata;
    }): Promise<ServerResult<{ id: string }>> {
      const existing = await dal.categories.findById(input.id);
      if (!existing) return fail("Category not found", { error: "NOT_FOUND" });

      let handle: string | undefined;
      if (input.handle !== undefined) {
        const handleResult = toHandle(
          input.handle,
          input.name ?? existing.name,
        );
        if (!handleResult.success)
          return fail("Could not derive a valid handle", {
            error: "INVALID_HANDLE",
            errors: {
              handle: [
                handleResult.error.issues[0]?.message ?? "Invalid handle",
              ],
            },
          });
        handle = handleResult.data;
      }
      if (handle && handle !== existing.handle) {
        const duplicate = await dal.categories.findByHandle(handle);
        if (duplicate && duplicate.id !== input.id)
          return handleConflict("category");
      }

      try {
        await dal.categories.update(
          input.id,
          {
            name: input.name,
            handle,
            description: input.description,
            isActive: input.isActive,
            isInternal: input.isInternal,
            metadata: input.metadata,
          },
          new Date().toISOString(),
        );
      } catch (error) {
        if (handle && handle !== existing.handle) {
          const duplicate = await dal.categories.findByHandle(handle);
          if (duplicate && duplicate.id !== input.id)
            return handleConflict("category");
        }
        throw error;
      }
      return ok("Category updated successfully", { id: input.id });
    },

    async deleteCategories(
      ids: string[],
    ): Promise<ServerResult<{ deleted: number }>> {
      const deleted = await dal.categories.softDelete(
        ids,
        new Date().toISOString(),
      );
      if (deleted === 0)
        return fail("No matching categories were found", {
          error: "NOT_FOUND",
        });
      return ok(`${deleted} categor${deleted === 1 ? "y" : "ies"} deleted`, {
        deleted,
      });
    },

    async manageCategoryProducts(input: {
      categoryId: string;
      add: string[];
      remove: string[];
      actorId: string;
    }): Promise<ServerResult<{ id: string }>> {
      const category = await dal.categories.findById(input.categoryId);
      if (!category)
        return fail("Product category not found", { error: "NOT_FOUND" });

      const changes = normalizeProductChanges(input.add, input.remove);
      if (!changes)
        return fail(
          "Add and remove must contain up to 100 distinct, non-overlapping product ids",
          {
            error: "INVALID_PRODUCT_MEMBERSHIP",
          },
        );
      const productIds = [...changes.add, ...changes.remove];
      const foundProducts = await dal.products.findByIds(productIds);
      if (foundProducts.length !== productIds.length)
        return fail("One or more products were not found", {
          error: "INVALID_PRODUCT",
        });

      await dal.products.manageCategoryProducts({
        categoryId: input.categoryId,
        addProductIds: changes.add,
        removeProductIds: changes.remove,
        actorId: input.actorId,
      });
      return ok("Product category products updated", { id: input.categoryId });
    },

    async createProductType(input: {
      value: string;
      metadata?: ProductMetadata;
      externalId?: string | null;
    }): Promise<ServerResult<{ id: string }>> {
      const value = input.value.trim();
      if (!value)
        return fail("Product type value is required", {
          error: "INVALID_VALUE",
        });
      if (await dal.types.findByValue(value)) return valueConflict("type");

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      try {
        await dal.types.create({
          id,
          value,
          metadata: input.metadata,
          externalId: input.externalId,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        if (await dal.types.findByValue(value)) return valueConflict("type");
        throw error;
      }
      return ok("Product type created", { id });
    },

    async updateProductType(input: {
      id: string;
      value?: string;
      metadata?: ProductMetadata;
      externalId?: string | null;
    }): Promise<ServerResult<{ id: string }>> {
      const existing = await dal.types.findById(input.id);
      if (!existing)
        return fail("Product type not found", { error: "NOT_FOUND" });
      const value = input.value?.trim();
      if (input.value !== undefined && !value)
        return fail("Product type value is required", {
          error: "INVALID_VALUE",
        });
      if (value && value !== existing.value) {
        const duplicate = await dal.types.findByValue(value);
        if (duplicate && duplicate.id !== input.id)
          return valueConflict("type");
      }

      try {
        const updated = await dal.types.update(input.id, {
          value,
          metadata: input.metadata,
          externalId: input.externalId,
        });
        if (!updated)
          return fail("Product type not found", { error: "NOT_FOUND" });
      } catch (error) {
        if (value && value !== existing.value) {
          const duplicate = await dal.types.findByValue(value);
          if (duplicate && duplicate.id !== input.id)
            return valueConflict("type");
        }
        throw error;
      }
      return ok("Product type updated", { id: input.id });
    },

    async deleteProductType(
      id: string,
      actorId: string,
    ): Promise<ServerResult<{ id: string }>> {
      if (!(await dal.types.findById(id)))
        return fail("Product type not found", { error: "NOT_FOUND" });
      await dal.types.softDelete(id, actorId);
      return ok("Product type deleted", { id });
    },

    async createCollection(input: {
      title: string;
      handle?: string;
      description?: string | null;
      metadata?: ProductMetadata;
      actorId: string;
    }): Promise<ServerResult<{ id: string; handle: string }>> {
      const handleResult = toHandle(input.handle, input.title);
      if (!handleResult.success)
        return fail("Could not derive a valid handle from the title", {
          error: "INVALID_HANDLE",
          errors: {
            handle: [handleResult.error.issues[0]?.message ?? "Invalid handle"],
          },
        });
      const handle = handleResult.data;
      if (await dal.collections.findByHandle(handle))
        return handleConflict("collection");

      const id = crypto.randomUUID();
      try {
        await dal.collections.create({
          id,
          title: input.title,
          handle,
          description: input.description,
          metadata: input.metadata,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        });
      } catch (error) {
        if (await dal.collections.findByHandle(handle))
          return handleConflict("collection");
        throw error;
      }
      return ok(`Collection "${input.title}" created`, { id, handle });
    },

    async updateCollection(input: {
      id: string;
      title?: string;
      handle?: string;
      description?: string | null;
      metadata?: ProductMetadata;
      actorId: string;
    }): Promise<ServerResult<{ id: string }>> {
      const existing = await dal.collections.findById(input.id);
      if (!existing)
        return fail("Collection not found", { error: "NOT_FOUND" });

      let handle: string | undefined;
      if (input.handle !== undefined) {
        const handleResult = toHandle(
          input.handle,
          input.title ?? existing.title,
        );
        if (!handleResult.success)
          return fail("Could not derive a valid handle", {
            error: "INVALID_HANDLE",
            errors: {
              handle: [
                handleResult.error.issues[0]?.message ?? "Invalid handle",
              ],
            },
          });
        handle = handleResult.data;
      }
      if (handle && handle !== existing.handle) {
        const duplicate = await dal.collections.findByHandle(handle);
        if (duplicate && duplicate.id !== input.id)
          return handleConflict("collection");
      }

      try {
        await dal.collections.update(input.id, {
          title: input.title,
          handle,
          description: input.description,
          metadata: input.metadata,
          updatedBy: input.actorId,
        });
      } catch (error) {
        if (handle && handle !== existing.handle) {
          const duplicate = await dal.collections.findByHandle(handle);
          if (duplicate && duplicate.id !== input.id)
            return handleConflict("collection");
        }
        throw error;
      }
      return ok("Collection updated successfully", { id: input.id });
    },

    async deleteCollections(
      ids: string[],
      actorId: string,
    ): Promise<ServerResult<{ deleted: number }>> {
      const existing = await dal.collections.findByIds(ids);
      if (existing.length === 0)
        return fail("No matching collections were found", {
          error: "NOT_FOUND",
        });
      await dal.collections.softDelete(
        existing.map((collection) => collection.id),
        actorId,
      );
      return ok(
        `${existing.length} collection${existing.length === 1 ? "" : "s"} deleted`,
        {
          deleted: existing.length,
        },
      );
    },

    async manageCollectionProducts(input: {
      collectionId: string;
      add: string[];
      remove: string[];
      actorId: string;
    }): Promise<ServerResult<{ id: string }>> {
      const collection = await dal.collections.findById(input.collectionId);
      if (!collection)
        return fail("Collection not found", { error: "NOT_FOUND" });

      const changes = normalizeProductChanges(input.add, input.remove);
      if (!changes)
        return fail(
          "Add and remove must contain up to 100 distinct, non-overlapping product ids",
          {
            error: "INVALID_PRODUCT_MEMBERSHIP",
          },
        );
      const productIds = [...changes.add, ...changes.remove];
      const foundProducts = await dal.products.findByIds(productIds);
      if (foundProducts.length !== productIds.length)
        return fail("One or more products were not found", {
          error: "INVALID_PRODUCT",
        });

      await dal.products.manageCollectionProducts({
        collectionId: input.collectionId,
        addProductIds: changes.add,
        removeProductIds: changes.remove,
        actorId: input.actorId,
      });
      return ok("Collection products updated", { id: input.collectionId });
    },

    async createProductTag(input: {
      value: string;
      metadata?: ProductMetadata;
      externalId?: string | null;
    }): Promise<ServerResult<{ id: string }>> {
      const value = input.value.trim();
      if (!value)
        return fail("Product tag value is required", {
          error: "INVALID_VALUE",
        });
      if (await dal.tags.findByValue(value)) return valueConflict("tag");

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      try {
        await dal.tags.create({
          id,
          value,
          metadata: input.metadata,
          externalId: input.externalId,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        if (await dal.tags.findByValue(value)) return valueConflict("tag");
        throw error;
      }
      return ok("Product tag created", { id });
    },

    async updateProductTag(input: {
      id: string;
      value?: string;
      metadata?: ProductMetadata;
      externalId?: string | null;
    }): Promise<ServerResult<{ id: string }>> {
      const existing = await dal.tags.findById(input.id);
      if (!existing)
        return fail("Product tag not found", { error: "NOT_FOUND" });
      const value = input.value?.trim();
      if (input.value !== undefined && !value)
        return fail("Product tag value is required", {
          error: "INVALID_VALUE",
        });
      if (value && value !== existing.value) {
        const duplicate = await dal.tags.findByValue(value);
        if (duplicate && duplicate.id !== input.id) return valueConflict("tag");
      }

      try {
        const updated = await dal.tags.update(input.id, {
          value,
          metadata: input.metadata,
          externalId: input.externalId,
        });
        if (!updated)
          return fail("Product tag not found", { error: "NOT_FOUND" });
      } catch (error) {
        if (value && value !== existing.value) {
          const duplicate = await dal.tags.findByValue(value);
          if (duplicate && duplicate.id !== input.id)
            return valueConflict("tag");
        }
        throw error;
      }
      return ok("Product tag updated", { id: input.id });
    },

    async deleteProductTag(
      id: string,
      actorId: string,
    ): Promise<ServerResult<{ id: string }>> {
      if (!(await dal.tags.findById(id)))
        return fail("Product tag not found", { error: "NOT_FOUND" });
      await dal.tags.softDelete(id, actorId);
      return ok("Product tag deleted", { id });
    },
  };
};

export const productTaxonomyWriteService = createProductTaxonomyWriteService();
