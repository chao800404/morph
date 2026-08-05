import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { productDal } from "@/lib/product/dal/product.dal";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import {
  createVariantInputSchema,
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

      // Moving to another cell is validated exactly as creating one is.
      if (data.optionValueIds) {
        const product = await productDal.findDetail(existing.productId);
        if (!product) {
          return {
            success: false,
            message: "Product not found",
            data: null,
            error: "NOT_FOUND",
          };
        }
        const combination = checkCombination(
          product,
          data.optionValueIds,
          data.id,
        );
        if (!combination.ok) {
          return {
            success: false,
            message: combination.message,
            data: null,
            errors: { optionValueIds: [combination.issue] },
          };
        }
        await productVariantDal.setOptionValues(data.id, data.optionValueIds);
      }

      // `excludeId`, so re-saving a variant without touching its own SKU is not
      // reported as a clash with itself.
      const conflict = await productVariantDal.findIdentifierConflict({
        sku: data.sku,
        barcode: data.barcode,
        excludeId: data.id,
      });
      if (conflict) {
        return {
          success: false,
          message: `Another variant already uses this ${conflict === "sku" ? "SKU" : "barcode"}`,
          data: null,
          errors: { [conflict]: ["This value is already in use"] },
        };
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

/**
 * Add one variant to an existing product.
 *
 * The create wizard generates the whole matrix at once; this is how a
 * combination comes back after someone deleted it, so it validates the same
 * three things that path does — the values belong to the product's own options,
 * the combination is not already taken, and the currencies are enabled.
 */
/**
 * Is this set of option value ids a legal cell of the product's matrix, and is
 * that cell free?
 *
 * Shared by create and edit: they ask the same question, and letting edit
 * answer it differently is how a variant ends up on an axis the product does
 * not have.
 */
const checkCombination = (
  product: ProductDetailDTO,
  optionValueIds: string[],
  exceptVariantId?: string,
):
  | { ok: true }
  | { ok: false; message: string; issue: string } => {
  const chosen = new Set(optionValueIds);
  const perAxis = product.options.map((option) =>
    option.values.filter((value) => chosen.has(value.id)),
  );
  const accounted = perAxis.reduce((total, values) => total + values.length, 0);

  if (accounted !== optionValueIds.length) {
    return {
      ok: false,
      message: "A selected value does not belong to this product",
      issue: "Choose values from this product's options",
    };
  }
  if (perAxis.some((values) => values.length !== 1)) {
    return {
      ok: false,
      message: "Choose exactly one value for each option",
      issue: "Choose one value per option",
    };
  }

  const taken = product.variants.some(
    (variant) =>
      variant.id !== exceptVariantId &&
      variant.optionValueIds.length === optionValueIds.length &&
      variant.optionValueIds.every((id) => chosen.has(id)),
  );
  if (taken) {
    return {
      ok: false,
      message: "That combination already has a variant",
      issue: "This combination already exists",
    };
  }

  return { ok: true };
};

export const createVariant = createServerFn({ method: "POST" })
  .validator((data: unknown) => createVariantInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const product = await productDal.findDetail(data.productId);
      if (!product) {
        return {
          success: false,
          message: "Product not found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      const combination = checkCombination(product, data.optionValueIds);
      if (!combination.ok) {
        return {
          success: false,
          message: combination.message,
          data: null,
          errors: { optionValueIds: [combination.issue] },
        };
      }

      const currencies = data.prices.map((price) => price.currencyCode);
      if (new Set(currencies).size !== currencies.length) {
        return {
          success: false,
          message: "Each currency may only appear once",
          data: null,
          errors: { prices: ["Duplicate currency code"] },
        };
      }
      if (currencies.length > 0 && !(await currencyDal.areSupported(currencies))) {
        return {
          success: false,
          message: "A price uses a currency that is not enabled for this store",
          data: null,
          errors: { prices: ["Choose a currency enabled in Store settings"] },
        };
      }

      // Both columns carry an active-only unique index. Checked here so the
      // author gets the error on the field instead of a D1 constraint failure
      // wrapped in Drizzle's `Failed query:`.
      const conflict = await productVariantDal.findIdentifierConflict({
        sku: data.sku,
        barcode: data.barcode,
      });
      if (conflict) {
        return {
          success: false,
          message: `Another variant already uses this ${conflict === "sku" ? "SKU" : "barcode"}`,
          data: null,
          errors: { [conflict]: ["This value is already in use"] },
        };
      }

      const id = crypto.randomUUID();
      await productVariantDal.createMany([
        {
          id,
          productId: data.productId,
          title: data.title,
          sku: data.sku,
          barcode: data.barcode,
          weight: data.weight,
          length: data.length,
          width: data.width,
          height: data.height,
          // Appended, so the existing order is untouched.
          rank: product.variants.length,
          manageInventory: data.manageInventory,
          allowBackorder: data.allowBackorder,
          inventoryQuantity: data.inventoryQuantity,
          optionValueIds: data.optionValueIds,
          prices: data.prices,
          createdBy: actorId,
          updatedBy: actorId,
        },
      ]);

      return { success: true, message: "Variant created", data: { id } };
    } catch (error) {
      console.error("Create variant error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to create variant",
        data: null,
        error: "CREATE_FAILED",
      };
    }
  });
