import { parseInput } from "@/lib/db/server-result";
import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { productDal } from "@/lib/product/dal/product.dal";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import type {
  ProductVariantDTO,
  ProductVariantListParams,
  ProductVariantPriceHistoryListParams,
} from "@/lib/product/dto/product-variant.dto";
import { MAX_GENERATED_VARIANTS } from "@/lib/product/variant-limits";
import {
  createVariantInputSchema,
  deleteVariantsInputSchema,
  updateVariantInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { productAdminMiddleware } from "../middleware/auth.middleware";
import { resolveVariantSku } from "./product-sku";
import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { getConfig } from "@/server/get-config";
import { z } from "zod";
import { productReadMiddleware } from "../middleware/auth.middleware";
import { DB_FANOUT_CONCURRENCY } from "@/lib/db/concurrency";
import pLimit from "p-limit";

const variantMediaLimit = () => getConfig().server.upload.maxAssetsPerRecord;
const BULK_VARIANT_LIMIT = 500;

const variantSortKeySchema = z.union([
  z.enum(["name", "createdAt", "updatedAt"]),
  z.templateLiteral(["option:", z.uuid()]),
]);

const variantListSchema = z.object({
  productId: z.uuid("Invalid product ID"),
  query: z.string().max(200).optional(),
  sortBy: variantSortKeySchema,
  sortOrder: z.enum(["asc", "desc"]),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
});

export const listProductVariants = createServerFn({ method: "GET" })
  .validator((data: unknown) => parseInput(variantListSchema, data))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    const result = await productVariantDal.listPage(
      data as ProductVariantListParams,
    );
    const totalPages = Math.max(1, Math.ceil(result.total / data.limit));
    return {
      success: true as const,
      message: "Product variants loaded",
      data: {
        variants: result.variants,
        pagination: {
          page: Math.min(data.page, totalPages),
          limit: data.limit,
          total: result.total,
          totalPages,
        },
      },
    };
  });

export const listProductVariantsForBulkEdit = createServerFn({ method: "GET" })
  .validator((data: unknown) => parseInput(z.object({ productId: z.uuid("Invalid product ID") }), data))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    const result = await productVariantDal.listPage({
      productId: data.productId,
      sortBy: "createdAt",
      sortOrder: "asc",
      page: 1,
      limit: BULK_VARIANT_LIMIT,
    });
    if (result.total > BULK_VARIANT_LIMIT) {
      return {
        success: false as const,
        message: `Bulk editing supports up to ${BULK_VARIANT_LIMIT} variants`,
        data: null,
      };
    }
    return {
      success: true as const,
      message: "Variants loaded for bulk editing",
      data: { variants: result.variants, total: result.total },
    };
  });

const priceHistoryListSchema = z.object({
  variantId: z.uuid("Invalid variant ID"),
  query: z.string().max(200).optional(),
  currencies: z.array(z.string().min(3).max(3)).max(50).optional(),
  changes: z
    .array(z.enum(["created", "increased", "decreased", "removed"]))
    .max(4)
    .optional(),
  changedBy: z.array(z.uuid()).max(50).optional(),
  changedWithin: z.enum(["24h", "7d", "30d", "90d"]).optional(),
  sortBy: z.enum(["updatedAt", "code", "name"]),
  sortOrder: z.enum(["asc", "desc"]),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
});

export const listVariantPriceHistory = createServerFn({ method: "GET" })
  .validator((data: unknown) => parseInput(priceHistoryListSchema, data))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    const result = await productVariantDal.listPriceHistoryPage(
      data as ProductVariantPriceHistoryListParams,
    );
    const totalPages = Math.max(1, Math.ceil(result.total / data.limit));
    return {
      success: true as const,
      message: "Variant price history loaded",
      data: {
        history: result.history,
        facets: result.facets,
        pagination: {
          page: Math.min(data.page, totalPages),
          limit: data.limit,
          total: result.total,
          totalPages,
        },
      },
    };
  });

const bulkPriceSchema = z.object({
  productId: z.uuid(),
  variants: z
    .array(
      z.object({
        id: z.uuid(),
        prices: z.array(
          z.object({
            currencyCode: z.string().min(3).max(3),
            amount: z.number().int().min(0),
          }),
        ),
      }),
    )
    .max(500),
});

export const bulkUpdateVariantPrices = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(bulkPriceSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const product = await productDal.findById(data.productId);
      if (!product)
        return {
          success: false as const,
          message: "Product not found",
          data: null,
        };
      const variantPage = await productVariantDal.listPage({
        productId: data.productId,
        sortBy: "createdAt",
        sortOrder: "asc",
        page: 1,
        limit: BULK_VARIANT_LIMIT,
      });
      if (variantPage.total > BULK_VARIANT_LIMIT) {
        return {
          success: false as const,
          message: `Bulk editing supports up to ${BULK_VARIANT_LIMIT} variants`,
          data: null,
        };
      }
      const allowed = new Set(
        variantPage.variants.map((variant) => variant.id),
      );
      if (data.variants.some((variant) => !allowed.has(variant.id))) {
        return {
          success: false as const,
          message: "A variant does not belong to this product",
          data: null,
        };
      }
      const currencies = [
        ...new Set(
          data.variants.flatMap((variant) =>
            variant.prices.map((price) => price.currencyCode),
          ),
        ),
      ];
      if (!(await currencyDal.areSupported(currencies))) {
        return {
          success: false as const,
          message: "A price uses a currency that is not enabled for this store",
          data: null,
        };
      }
      for (const variant of data.variants) {
        if (
          new Set(variant.prices.map((price) => price.currencyCode)).size !==
          variant.prices.length
        ) {
          return {
            success: false as const,
            message: "Each currency may only appear once per variant",
            data: null,
          };
        }
      }
      const previousById = new Map(
        variantPage.variants.map((variant) => [variant.id, variant.prices]),
      );
      const updated: string[] = [];
      try {
        for (const variant of data.variants) {
          // Track the current row before updating it: price replacement uses
          // multiple D1 statements and can fail after its first mutation.
          updated.push(variant.id);
          await productVariantDal.update(variant.id, {
            prices: variant.prices,
            updatedBy: context.user.id,
          });
        }
      } catch (error) {
        // D1 has no interactive transaction. Restore every completed row so a
        // failed matrix never remains partially applied.
        await Promise.allSettled(
          updated.map((id) =>
            productVariantDal.update(id, {
              prices: previousById.get(id) ?? [],
              updatedBy: context.user.id,
            }),
          ),
        );
        throw error;
      }
      return {
        success: true as const,
        message: "Variant prices updated successfully",
        data: { count: data.variants.length },
      };
    } catch (error) {
      console.error("Bulk update variant prices error:", error);
      return {
        success: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Failed to update variant prices",
        data: null,
      };
    }
  });

const bulkInventorySchema = z.object({
  productId: z.uuid(),
  variants: z
    .array(
      z.object({
        id: z.uuid(),
        quantity: z.number().int().min(0).max(1_000_000),
      }),
    )
    .max(500),
});

export const bulkUpdateVariantInventory = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(bulkInventorySchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const product = await productDal.findById(data.productId);
      if (!product)
        return {
          success: false as const,
          message: "Product not found",
          data: null,
        };
      const variantPage = await productVariantDal.listPage({
        productId: data.productId,
        sortBy: "createdAt",
        sortOrder: "asc",
        page: 1,
        limit: BULK_VARIANT_LIMIT,
      });
      if (variantPage.total > BULK_VARIANT_LIMIT) {
        return {
          success: false as const,
          message: `Bulk editing supports up to ${BULK_VARIANT_LIMIT} variants`,
          data: null,
        };
      }
      const byId = new Map(
        variantPage.variants.map((variant) => [variant.id, variant]),
      );
      if (data.variants.some((variant) => !byId.has(variant.id))) {
        return {
          success: false as const,
          message: "A variant does not belong to this product",
          data: null,
        };
      }
      const updated: string[] = [];
      try {
        for (const input of data.variants) {
          const variant = byId.get(input.id)!;
          await inventoryDal.ensureForVariant({
            variantId: input.id,
            sku: variant.sku,
            title: `${product.title} - ${variant.title}`,
            quantity: variant.inventoryQuantity,
          });
          // Include the current row in compensation even if one of the two
          // quantity writes fails midway through.
          updated.push(input.id);
          await productVariantDal.update(input.id, {
            inventoryQuantity: input.quantity,
            updatedBy: context.user.id,
          });
          await inventoryDal.setPrimaryLevelQuantity(input.id, input.quantity);
        }
      } catch (error) {
        await Promise.allSettled(
          updated.map(async (id) => {
            const previous = byId.get(id)!;
            await productVariantDal.update(id, {
              inventoryQuantity: previous.inventoryQuantity,
              updatedBy: context.user.id,
            });
            await inventoryDal.setPrimaryLevelQuantity(
              id,
              previous.inventoryQuantity,
            );
          }),
        );
        throw error;
      }
      return {
        success: true as const,
        message: "Variant inventory updated successfully",
        data: { count: data.variants.length },
      };
    } catch (error) {
      console.error("Bulk update variant inventory error:", error);
      return {
        success: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Failed to update variant inventory",
        data: null,
      };
    }
  });

export const getVariantDetail = createServerFn({ method: "GET" })
  .validator((data: unknown) => parseInput(z.object({ id: z.uuid("Invalid variant ID") }), data))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    const variant = await productVariantDal.findById(data.id);
    if (!variant) {
      return {
        success: false as const,
        message: "Variant not found",
        data: null,
        error: "NOT_FOUND",
      };
    }
    return {
      success: true as const,
      message: "Variant loaded",
      data: { variant },
    };
  });

const validateVariantAssets = (
  product: ProductDetailDTO,
  assetIds: string[],
): string | null => {
  const allowed = new Set(product.assetIds);
  return assetIds.find((id) => !allowed.has(id)) ?? null;
};

export const updateVariant = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateVariantInputSchema(variantMediaLimit()), data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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

      let productDetail: ProductDetailDTO | null = null;
      if (data.assetIds !== undefined || data.optionValueIds) {
        productDetail = await productDal.findDetail(existing.productId);
        if (!productDetail) {
          return {
            success: false,
            message: "Product not found",
            data: null,
            error: "NOT_FOUND",
          };
        }
      }
      if (data.assetIds !== undefined) {
        const invalidAsset = validateVariantAssets(
          productDetail!,
          data.assetIds,
        );
        if (invalidAsset) {
          return {
            success: false,
            message: "Variant images must come from this product's media",
            data: null,
            errors: { assetIds: ["Choose images from Product Media"] },
          };
        }
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
        const product = productDetail;
        if (!product) {
          return {
            success: false,
            message: "Product not found",
            data: null,
            error: "NOT_FOUND",
          };
        }
        const variantPage = await productVariantDal.listPage({
          productId: existing.productId,
          sortBy: "createdAt",
          sortOrder: "asc",
          page: 1,
          limit: MAX_GENERATED_VARIANTS,
        });
        if (variantPage.total > MAX_GENERATED_VARIANTS) {
          return {
            success: false,
            message: `A product may have at most ${MAX_GENERATED_VARIANTS} variants`,
            data: null,
            errors: { optionValueIds: ["Variant limit exceeded"] },
          };
        }
        const combination = checkCombination(
          product,
          variantPage.variants,
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
        metadata: data.metadata,
        updatedBy: actorId,
      });
      if (data.assetIds !== undefined) {
        await productVariantDal.setAssets(data.id, data.assetIds);
      }

      if (data.manageInventory ?? existing.manageInventory) {
        const product = await productDal.findById(existing.productId);
        if (product) {
          await inventoryDal.ensureForVariant({
            variantId: data.id,
            sku: data.sku ?? existing.sku,
            title: `${product.title} - ${data.title ?? existing.title}`,
            quantity: data.inventoryQuantity ?? existing.inventoryQuantity,
          });
          if (data.inventoryQuantity !== undefined) {
            await inventoryDal.setPrimaryLevelQuantity(
              data.id,
              data.inventoryQuantity,
            );
          }
        }
      }

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
  .validator((data: unknown) => parseInput(deleteVariantsInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    const actorId = context.user.id;

    try {
      const lookup = pLimit(DB_FANOUT_CONCURRENCY);
      const targeted = (
        await Promise.all(
          data.ids.map((id) => lookup(() => productVariantDal.findById(id))),
        )
      ).filter((variant) => variant !== null);
      const affectedProductIds = [
        ...new Set(targeted.map((variant) => variant.productId)),
      ];

      await productVariantDal.softDelete(data.ids, actorId);

      const restoredProductIds: string[] = [];
      for (const productId of affectedProductIds) {
        if (await productVariantDal.existsForProduct(productId)) {
          continue;
        }

        const product = await productDal.findById(productId);
        if (!product) continue;

        const id = crypto.randomUUID();
        const sku = await resolveVariantSku({
          productHandle: product.handle,
          variantTitle: "Default",
          optionValues: [],
          index: 0,
        });
        await productVariantDal.createMany([
          {
            id,
            productId,
            title: "Default",
            sku,
            rank: 0,
            manageInventory: true,
            allowBackorder: false,
            inventoryQuantity: 0,
            optionValueIds: [],
            prices: [],
            createdBy: actorId,
            updatedBy: actorId,
          },
        ]);
        await inventoryDal.ensureForVariant({
          variantId: id,
          sku,
          title: `${product.title} - Default`,
          quantity: 0,
        });
        restoredProductIds.push(productId);
      }

      return {
        success: true,
        message: `${targeted.length} variant${targeted.length === 1 ? "" : "s"} deleted${restoredProductIds.length > 0 ? ` — Default restored for ${restoredProductIds.length} product${restoredProductIds.length === 1 ? "" : "s"}` : ""}`,
        data: {
          deleted: targeted.length,
          restoredProductIds,
        },
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
  variants: ProductVariantDTO[],
  optionValueIds: string[],
  exceptVariantId?: string,
): { ok: true } | { ok: false; message: string; issue: string } => {
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

  const taken = variants.some(
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
  .validator((data: unknown) => parseInput(createVariantInputSchema(variantMediaLimit()), data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
      if (validateVariantAssets(product, data.assetIds)) {
        return {
          success: false,
          message: "Variant images must come from this product's media",
          data: null,
          errors: { assetIds: ["Choose images from Product Media"] },
        };
      }

      const variantPage = await productVariantDal.listPage({
        productId: data.productId,
        sortBy: "createdAt",
        sortOrder: "asc",
        page: 1,
        limit: MAX_GENERATED_VARIANTS,
      });
      if (variantPage.total >= MAX_GENERATED_VARIANTS) {
        return {
          success: false,
          message: `A product may have at most ${MAX_GENERATED_VARIANTS} variants`,
          data: null,
          errors: { optionValueIds: ["Variant limit reached"] },
        };
      }
      const combination = checkCombination(
        product,
        variantPage.variants,
        data.optionValueIds,
      );
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
      if (
        currencies.length > 0 &&
        !(await currencyDal.areSupported(currencies))
      ) {
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
      const sku = await resolveVariantSku({
        sku: data.sku,
        productHandle: product.handle,
        variantTitle: data.title,
        optionValues: product.options.flatMap((option) =>
          option.values
            .filter((value) => data.optionValueIds.includes(value.id))
            .map((value) => value.value),
        ),
        index: variantPage.total,
      });
      await productVariantDal.createMany([
        {
          id,
          productId: data.productId,
          title: data.title,
          sku,
          barcode: data.barcode,
          weight: data.weight,
          length: data.length,
          width: data.width,
          height: data.height,
          // Appended, so the existing order is untouched.
          rank: variantPage.total,
          manageInventory: data.manageInventory,
          allowBackorder: data.allowBackorder,
          inventoryQuantity: data.inventoryQuantity,
          optionValueIds: data.optionValueIds,
          prices: data.prices,
          assetIds: data.assetIds,
          metadata: data.metadata,
          createdBy: actorId,
          updatedBy: actorId,
        },
      ]);
      if (data.manageInventory) {
        await inventoryDal.ensureForVariant({
          variantId: id,
          sku,
          title: `${product.title} - ${data.title}`,
          quantity: data.inventoryQuantity,
        });
      }

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
