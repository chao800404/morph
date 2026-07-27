import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import {
  deleteVariantsInputSchema,
  updateVariantInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { productAdminMiddleware } from "../middleware/auth.middleware";

export const updateVariant = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateVariantInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const existing = await productVariantDal.findById(data.id);
      if (!existing) {
        return {
          success: false,
          message: "Variant not found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      if (data.prices) {
        const currencies = data.prices.map((price) => price.currencyCode);
        if (new Set(currencies).size !== currencies.length) {
          return {
            success: false,
            message: "Each currency may only appear once",
            data: null,
            errors: { prices: ["Duplicate currency code"] },
          };
        }
        if (!(await currencyDal.areSupported(currencies))) {
          return {
            success: false,
            message:
              "A price uses a currency that is not enabled for this store",
            data: null,
            errors: {
              prices: ["Choose a currency enabled in Store settings"],
            },
          };
        }
      }

      await productVariantDal.update(data.id, {
        title: data.title,
        sku: data.sku,
        barcode: data.barcode,
        rank: data.rank,
        manageInventory: data.manageInventory,
        allowBackorder: data.allowBackorder,
        inventoryQuantity: data.inventoryQuantity,
        weight: data.weight,
        length: data.length,
        width: data.width,
        height: data.height,
        prices: data.prices,
        updatedBy: actorId,
      });

      return {
        success: true,
        message: "Variant updated successfully",
        data: { id: data.id },
      };
    } catch (error) {
      console.error("Update variant error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to update variant",
        data: null,
        error: "UPDATE_FAILED",
      };
    }
  });

export const deleteVariants = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteVariantsInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      await productVariantDal.softDelete(data.ids, actorId);

      return {
        success: true,
        message: `${data.ids.length} variant${data.ids.length === 1 ? "" : "s"} deleted`,
        data: { deleted: data.ids.length },
      };
    } catch (error) {
      console.error("Delete variants error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to delete variants",
        data: null,
        error: "DELETE_FAILED",
      };
    }
  });
