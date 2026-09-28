import { parseInput } from "@/lib/db/server-result";
import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { productDal } from "@/lib/product/dal/product.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import type {
  ProductVariantListParams,
  ProductVariantPriceHistoryListParams,
} from "@/lib/product/dto/product-variant.dto";
import {
  createVariantInputSchema,
  deleteVariantsInputSchema,
  updateVariantInputSchema,
  updateVariantInventoryKitInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { productVariantWriteService } from "@/lib/product/service/product-variant-write.service";
import { productAdminMiddleware } from "../middleware/auth.middleware";
import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { getConfig } from "@/server/get-config";
import { z } from "zod";
import { productReadMiddleware } from "../middleware/auth.middleware";

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
  .validator((data: unknown) =>
    parseInput(z.object({ productId: z.uuid("Invalid product ID") }), data),
  )
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
      const kitVariant = data.variants.find(
        (variant) => byId.get(variant.id)!.inventoryKit.length > 1,
      );
      if (kitVariant) {
        return {
          success: false as const,
          message:
            "Bulk quantity editing only supports single-item variants. Update kit stock on each inventory item.",
          data: null,
          error: "INVENTORY_KIT_QUANTITY_AMBIGUOUS",
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
  .validator((data: unknown) =>
    parseInput(z.object({ id: z.uuid("Invalid variant ID") }), data),
  )
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

export const getVariantInventoryKit = createServerFn({ method: "GET" })
  .validator((data: unknown) =>
    parseInput(z.object({ id: z.uuid("Invalid variant ID") }), data),
  )
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const variant = await productVariantDal.findById(input.data.id);
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
      message: "Variant inventory kit loaded",
      data: { items: await inventoryDal.listVariantKit(input.data.id) },
    };
  });

export const updateVariant = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateVariantInputSchema(variantMediaLimit()), data),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    return productVariantWriteService.update(input.data, context.user.id);
  });

export const updateVariantInventoryKit = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateVariantInventoryKitInputSchema, data),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    return productVariantWriteService.updateInventoryKit(
      input.data,
      context.user.id,
    );
  });

export const deleteVariants = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteVariantsInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    return productVariantWriteService.delete(input.data, context.user.id);
  });

/**
 * Add one variant to an existing product.
 *
 * The create wizard generates the whole matrix at once; this is how a
 * combination comes back after someone deleted it, so it validates the same
 * three things that path does — the values belong to the product's own options,
 * the combination is not already taken, and the currencies are enabled.
 */
export const createVariant = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createVariantInputSchema(variantMediaLimit()), data),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    return productVariantWriteService.create(input.data, context.user.id);
  });
