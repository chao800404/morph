import { parseInput } from "@/lib/db/server-result";
import { productCollectionDal } from "@/lib/product/dal/product-collection.dal";
import { productTaxonomyWriteService } from "@/lib/product/service/product-taxonomy-write.service";
import {
  createCollectionInputSchema,
  deleteCollectionsInputSchema,
  getProductInputSchema,
  listCollectionsInputSchema,
  updateCollectionInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import {
  productAdminMiddleware,
  productReadMiddleware,
} from "../middleware/auth.middleware";

export const listCollections = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listCollectionsInputSchema, data ?? {}))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await productCollectionDal.listPage({
        query: data.query,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        page: data.page,
        limit: data.limit,
      });

      return {
        success: true,
        message: "Collections fetched successfully",
        data: {
          collections: page.collections,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: page.total,
            totalPages: Math.ceil(page.total / data.limit),
          },
        },
      };
    } catch (error) {
      console.error("List collections error:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch collections",
        data: null,
        error: "LIST_FAILED",
      };
    }
  });

export const getCollection = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getProductInputSchema, data))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const collection = await productCollectionDal.findById(data.id);
      if (!collection) {
        return {
          success: false,
          message: "Collection not found",
          data: null,
          error: "NOT_FOUND",
        };
      }
      return {
        success: true,
        message: "Collection fetched successfully",
        data: collection,
      };
    } catch (error) {
      console.error("Get collection error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch collection",
        data: null,
        error: "GET_FAILED",
      };
    }
  });

export const createCollection = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createCollectionInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    const actorId = context.user.id;

    try {
      const result = await productTaxonomyWriteService.createCollection({
        ...data,
        actorId,
      });
      if (!result.success) return result;

      return {
        success: true,
        message: result.message,
        data: result.data,
      };
    } catch (error) {
      console.error("Create collection error:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to create collection",
        data: null,
        error: "CREATE_FAILED",
      };
    }
  });

export const updateCollection = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateCollectionInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    const actorId = context.user.id;

    try {
      const result = await productTaxonomyWriteService.updateCollection({
        ...data,
        actorId,
      });
      if (!result.success) return result;

      return {
        success: true,
        message: result.message,
        data: result.data,
      };
    } catch (error) {
      console.error("Update collection error:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to update collection",
        data: null,
        error: "UPDATE_FAILED",
      };
    }
  });

export const deleteCollections = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteCollectionsInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    const actorId = context.user.id;

    try {
      const result = await productTaxonomyWriteService.deleteCollections(
        data.ids,
        actorId,
      );
      if (!result.success) return result;

      return {
        success: true,
        message: result.message,
        data: result.data,
      };
    } catch (error) {
      console.error("Delete collections error:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to delete collections",
        data: null,
        error: "DELETE_FAILED",
      };
    }
  });
