import { productCollectionDal } from "@/lib/product/dal/product-collection.dal";
import {
  createCollectionInputSchema,
  deleteCollectionsInputSchema,
  handleSchema,
  listCollectionsInputSchema,
  slugify,
  updateCollectionInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import {
  productAdminMiddleware,
  productReadMiddleware,
} from "../middleware/auth.middleware";

export const listCollections = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    listCollectionsInputSchema.parse(data ?? {}),
  )
  .middleware([productReadMiddleware])
  .handler(async ({ data }) => {
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

export const createCollection = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createCollectionInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const handleResult = handleSchema.safeParse(
        data.handle ?? slugify(data.title),
      );
      if (!handleResult.success) {
        return {
          success: false,
          message: "Could not derive a valid handle from the title",
          data: null,
          errors: { handle: [handleResult.error.issues[0].message] },
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
  .inputValidator((data: unknown) => updateCollectionInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
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

      if (data.handle && data.handle !== existing.handle) {
        const clash = await productCollectionDal.findByHandle(data.handle);
        if (clash && clash.id !== data.id) {
          return {
            success: false,
            message: `A collection with the handle "${data.handle}" already exists`,
            data: null,
            errors: { handle: ["This handle is already in use"] },
          };
        }
      }

      await productCollectionDal.update(data.id, {
        title: data.title,
        handle: data.handle,
        description: data.description,
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
  .inputValidator((data: unknown) => deleteCollectionsInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
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
