import { productDal } from "@/lib/product/dal/product.dal";
import {
  deleteProductsInputSchema,
  updateProductInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { productAdminMiddleware } from "../middleware/auth.middleware";

export const updateProduct = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateProductInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const existing = await productDal.findById(data.id);
      if (!existing) {
        return {
          success: false,
          message: "Product not found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      if (data.handle && data.handle !== existing.handle) {
        const clash = await productDal.findByHandle(data.handle);
        if (clash && clash.id !== data.id) {
          return {
            success: false,
            message: `A product with the handle "${data.handle}" already exists`,
            data: null,
            errors: { handle: ["This handle is already in use"] },
          };
        }
      }

      await productDal.update(data.id, {
        title: data.title,
        handle: data.handle,
        subtitle: data.subtitle,
        description: data.description,
        status: data.status,
        collectionId: data.collectionId,
        thumbnailAssetId: data.thumbnailAssetId,
        updatedBy: actorId,
      });

      // `assetIds` replaces the gallery wholesale; omitting it leaves it alone.
      if (data.assetIds) {
        await productDal.setAssets(data.id, data.assetIds);
      }

      return {
        success: true,
        message: "Product updated successfully",
        data: { id: data.id },
      };
    } catch (error) {
      console.error("Update product error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to update product",
        data: null,
        error: "UPDATE_FAILED",
      };
    }
  });

export const deleteProducts = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => deleteProductsInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const existing = await productDal.findByIds(data.ids);
      if (existing.length === 0) {
        return {
          success: false,
          message: "No matching products were found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      await productDal.softDelete(
        existing.map((product) => product.id),
        actorId,
      );

      return {
        success: true,
        message: `${existing.length} product${existing.length === 1 ? "" : "s"} deleted`,
        data: { deleted: existing.length },
      };
    } catch (error) {
      console.error("Delete products error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to delete products",
        data: null,
        error: "DELETE_FAILED",
      };
    }
  });
