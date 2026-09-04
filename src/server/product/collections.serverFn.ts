import { parseInput } from "@/lib/db/server-result";
import { productCollectionDal } from "@/lib/product/dal/product-collection.dal";
import {
  createCollectionInputSchema,
  deleteCollectionsInputSchema,
  getProductInputSchema,
  listCollectionsInputSchema,
  toHandle,
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
      const handleResult = toHandle(data.handle, data.title);
      if (!handleResult.success) {
        return {
          success: false,
          message: "Could not derive a valid handle from the title",
          data: null,
          errors: { handle: [handleResult.error.issues[0]?.message ?? "Invalid input"] },
        };
      }
      const handle = handleResult.data;

      if (await productCollectionDal.findByHandle(handle)) {
        return {
          success: false,
          message: `A collection with the handle "${handle}" already exists`,
          data: null,
          errors: { handle: ["This handle is already in use"] },
        };
      }

      const id = crypto.randomUUID();
      await productCollectionDal.create({
        id,
        title: data.title,
        handle,
        description: data.description,
        createdBy: actorId,
        updatedBy: actorId,
      });

      return {
        success: true,
        message: `Collection "${data.title}" created`,
        data: { id, handle },
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
      const existing = await productCollectionDal.findById(data.id);
      if (!existing) {
        return {
          success: false,
          message: "Collection not found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      // Slugified first, so a typed "Summer Shirt" becomes `summer-shirt`
      // rather than failing validation the author cannot see.
      let handle: string | undefined;
      if (data.handle !== undefined) {
        const result = toHandle(data.handle, data.title ?? existing.title);
        if (!result.success) {
          return {
            success: false,
            message: "Could not derive a valid handle",
            data: null,
            errors: { handle: [result.error.issues[0]?.message ?? "Invalid input"] },
          };
        }
        handle = result.data;
      }

      if (handle && handle !== existing.handle) {
        const clash = await productCollectionDal.findByHandle(handle);
        if (clash && clash.id !== data.id) {
          return {
            success: false,
            message: `A collection with the handle "${handle}" already exists`,
            data: null,
            errors: { handle: ["This handle is already in use"] },
          };
        }
      }

      await productCollectionDal.update(data.id, {
        title: data.title,
        handle,
        description: data.description,
        metadata: data.metadata,
        updatedBy: actorId,
      });

      return {
        success: true,
        message: "Collection updated successfully",
        data: { id: data.id },
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
      const existing = await productCollectionDal.findByIds(data.ids);
      if (existing.length === 0) {
        return {
          success: false,
          message: "No matching collections were found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      // Products keep existing; their `collection_id` is set to null by the
      // foreign key, so deleting a collection never removes catalogue items.
      await productCollectionDal.softDelete(
        existing.map((collection) => collection.id),
        actorId,
      );

      return {
        success: true,
        message: `${existing.length} collection${existing.length === 1 ? "" : "s"} deleted`,
        data: { deleted: existing.length },
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
