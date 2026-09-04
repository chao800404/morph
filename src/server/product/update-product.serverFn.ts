import { parseInput } from "@/lib/db/server-result";
import { productDal } from "@/lib/product/dal/product.dal";
import {
  productCategoryDal,
  productTagDal,
  productTypeDal,
} from "@/lib/product/dal/product-taxonomy.dal";
import {
  deleteProductsInputSchema,
  toHandle,
  updateProductInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { getConfig } from "../get-config";
import { productAdminMiddleware } from "../middleware/auth.middleware";

export const updateProduct = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateProductInputSchema(
      getConfig().server.upload.maxAssetsPerRecord,
    ), data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
        const clash = await productDal.findByHandle(handle);
        if (clash && clash.id !== data.id) {
          return {
            success: false,
            message: `A product with the handle "${handle}" already exists`,
            data: null,
            errors: { handle: ["This handle is already in use"] },
          };
        }
      }

      // `typeValue` is tri-state: absent leaves the type alone, `null` clears
      // it, a string upserts by value. `undefined` must not reach the DAL as a
      // column write or it would be indistinguishable from clearing.
      const now = new Date().toISOString();
      const typeId =
        data.typeValue === undefined
          ? undefined
          : data.typeValue
            ? await productTypeDal.ensure(data.typeValue, now)
            : null;

      await productDal.update(data.id, {
        title: data.title,
        handle,
        subtitle: data.subtitle,
        description: data.description,
        status: data.status,
        collectionId: data.collectionId,
        typeId,
        discountable: data.discountable,
        metadata: data.metadata,
        updatedBy: actorId,
      });

      // These replace wholesale; omitting one leaves it alone.
      if (data.assetIds) {
        await productDal.setAssets(data.id, data.assetIds);
      }

      if (data.tagValues) {
        await productDal.setTags(
          data.id,
          await productTagDal.ensureMany(data.tagValues, now),
        );
      }

      if (data.categoryIds) {
        await productDal.setCategories(
          data.id,
          await productCategoryDal.filterExisting(data.categoryIds),
        );
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
  .validator((data: unknown) => parseInput(deleteProductsInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
