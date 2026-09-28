import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { DB_FANOUT_CONCURRENCY } from "@/lib/db/concurrency";
import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { productDal } from "@/lib/product/dal/product.dal";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import type { ProductVariantDTO } from "@/lib/product/dto/product-variant.dto";
import { MAX_GENERATED_VARIANTS } from "@/lib/product/variant-limits";
import {
  createVariantInputSchema,
  deleteVariantsInputSchema,
  updateVariantInputSchema,
  updateVariantInventoryKitInputSchema,
} from "@/lib/validations/product";
import { resolveVariantSku } from "@/server/product/product-sku";
import pLimit from "p-limit";
import type { z } from "zod";

export type CreateProductVariantInput = z.infer<
  ReturnType<typeof createVariantInputSchema>
>;
export type UpdateProductVariantInput = z.infer<
  ReturnType<typeof updateVariantInputSchema>
>;
export type UpdateProductVariantInventoryKitInput = z.infer<
  typeof updateVariantInventoryKitInputSchema
>;
export type DeleteProductVariantsInput = z.infer<
  typeof deleteVariantsInputSchema
>;
export type ProductVariantWriteResult =
  | {
      success: true;
      message: string;
      data: {
        id?: string;
        deleted?: number;
        updated?: number;
        restoredProductIds?: string[];
      };
    }
  | {
      success: false;
      message: string;
      data: null;
      error?: string;
      errors?: Record<string, string[]>;
    };

const validateVariantAssets = (
  product: ProductDetailDTO,
  assetIds: string[],
): string | null => {
  const allowed = new Set(product.assetIds);
  return assetIds.find((id) => !allowed.has(id)) ?? null;
};

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

/** Shared by dashboard server functions and the Admin REST API. */
export const productVariantWriteService = {
  async updateInventoryKit(
    input: UpdateProductVariantInventoryKitInput,
    actorId: string,
  ): Promise<ProductVariantWriteResult> {
    return this.updateInventoryKits([input], actorId);
  },

  async updateInventoryKits(
    inputs: UpdateProductVariantInventoryKitInput[],
    actorId: string,
  ): Promise<ProductVariantWriteResult> {
    try {
      if (inputs.length > 100) {
        return {
          success: false,
          message:
            "A single inventory kit batch can update at most 100 variants",
          data: null,
          error: "INVALID_REQUEST",
        };
      }
      if (
        new Set(inputs.map((input) => input.variantId)).size !== inputs.length
      ) {
        return {
          success: false,
          message:
            "Each variant can only appear once in an inventory kit batch",
          data: null,
          error: "INVALID_REQUEST",
        };
      }
      const limit = pLimit(DB_FANOUT_CONCURRENCY);
      const snapshots = await Promise.all(
        inputs.map((input) =>
          limit(async () => {
            const variant = await productVariantDal.findById(input.variantId);
            return { input, variant };
          }),
        ),
      );
      for (const { input, variant } of snapshots) {
        if (!variant || variant.productId !== input.productId) {
          return {
            success: false,
            message: "Variant not found",
            data: null,
            error: "NOT_FOUND",
          };
        }
        if (variant.updatedAt.toISOString() !== input.expectedUpdatedAt) {
          return {
            success: false,
            message:
              "This variant changed while you were editing it. Refresh and try again.",
            data: null,
            error: "CONFLICT",
          };
        }
        if (variant.manageInventory && input.items.length === 0) {
          return {
            success: false,
            message: "A managed variant must use at least one inventory item",
            data: null,
            error: "EMPTY_KIT",
            errors: { items: ["Choose at least one inventory item"] },
          };
        }
      }

      const changed: UpdateProductVariantInventoryKitInput[] = [];
      await Promise.all(
        snapshots.map(({ input }) =>
          limit(async () => {
            const currentItems = await inventoryDal.listVariantKit(
              input.variantId,
            );
            const currentById = new Map(
              currentItems.map((item) => [
                item.inventoryItemId,
                item.requiredQuantity,
              ]),
            );
            const unchanged =
              currentById.size === input.items.length &&
              input.items.every(
                (item) =>
                  currentById.get(item.inventoryItemId) ===
                  item.requiredQuantity,
              );
            if (!unchanged) changed.push(input);
          }),
        ),
      );
      if (changed.length === 0) {
        return {
          success: true,
          message: "Inventory kits are up to date",
          data: { id: inputs[0]?.variantId, updated: 0 },
        };
      }

      const result = await inventoryDal.replaceVariantKits(
        changed.map((input) => ({ ...input, updatedBy: actorId })),
      );
      const failures = {
        "not-found": {
          error: "NOT_FOUND",
          message: "Variant or one of its inventory items was not found",
        },
        "active-reservations": {
          error: "ACTIVE_RESERVATIONS",
          message:
            "This inventory kit cannot change while carts or unfulfilled orders have reserved stock",
        },
        conflict: {
          error: "CONFLICT",
          message: "Inventory or variant data changed. Refresh and try again.",
        },
      } as const;
      if (result !== "updated") {
        return {
          success: false,
          message: failures[result].message,
          data: null,
          error: failures[result].error,
        };
      }
      return {
        success: true,
        message:
          changed.length === 1
            ? "Inventory kit updated"
            : "Inventory kits updated",
        data: { id: changed[0]?.variantId, updated: changed.length },
      };
    } catch (error) {
      console.error("Update variant inventory kits error:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to update variant inventory kit",
        data: null,
        error: "UPDATE_KIT_FAILED",
      };
    }
  },

  async update(
    data: UpdateProductVariantInput,
    actorId: string,
  ): Promise<ProductVariantWriteResult> {
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
      if (
        data.inventoryQuantity !== undefined &&
        existing.inventoryKit.length > 1
      ) {
        return {
          success: false,
          message:
            "This variant uses an inventory kit. Update stock on each inventory item instead.",
          data: null,
          error: "INVENTORY_KIT_QUANTITY_AMBIGUOUS",
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
  },

  async delete(
    data: DeleteProductVariantsInput,
    actorId: string,
  ): Promise<ProductVariantWriteResult> {
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
  },

  async create(
    data: CreateProductVariantInput,
    actorId: string,
  ): Promise<ProductVariantWriteResult> {
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
  },
};
