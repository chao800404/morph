import { productOptionDal } from "@/lib/product/dal/product-option.dal";
import {
  setProductOptionsInputSchema,
  createProductOptionInputSchema,
  deleteProductOptionsInputSchema,
  getProductInputSchema,
  listProductOptionsInputSchema,
  updateProductOptionInputSchema,
} from "@/lib/validations/product";
import { productDal } from "@/lib/product/dal/product.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { MAX_GENERATED_VARIANTS } from "@/lib/product/variant-limits";
import { missingCombinations } from "@/lib/product/variant-table";
import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { createServerFn } from "@tanstack/react-start";
import {
  productAdminMiddleware,
  productReadMiddleware,
} from "../middleware/auth.middleware";
import { resolveVariantSku } from "./product-sku";

export const listProductOptions = createServerFn({ method: "POST" })
  .validator((data: unknown) => listProductOptionsInputSchema.parse(data ?? {}))
  .middleware([productReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const page = await productOptionDal.listPage({
        query: data.query,
        createdWithin: data.createdWithin,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        page: data.page,
        limit: data.limit,
      });

      return {
        success: true,
        message: "Options fetched successfully",
        data: {
          options: page.options,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: page.total,
            totalPages: Math.ceil(page.total / data.limit),
          },
        },
      };
    } catch (error) {
      console.error("List product options error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch options",
        data: null,
        error: "LIST_FAILED",
      };
    }
  });

export const getProductOption = createServerFn({ method: "POST" })
  .validator((data: unknown) => getProductInputSchema.parse(data))
  .middleware([productReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const option = await productOptionDal.findById(data.id);
      if (!option) {
        return {
          success: false,
          message: "Option not found",
          data: null,
          error: "NOT_FOUND",
        };
      }
      return {
        success: true,
        message: "Option fetched successfully",
        data: option,
      };
    } catch (error) {
      console.error("Get product option error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch option",
        data: null,
        error: "GET_FAILED",
      };
    }
  });

export const createProductOption = createServerFn({ method: "POST" })
  .validator((data: unknown) => createProductOptionInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      if (await productOptionDal.findGlobalByTitle(data.title)) {
        return {
          success: false,
          message: `An option called "${data.title}" already exists`,
          data: null,
          errors: { title: ["This name is already in use"] },
        };
      }

      const id = crypto.randomUUID();
      await productOptionDal.create({
        id,
        title: data.title,
        values: data.values,
        createdBy: actorId,
        updatedBy: actorId,
      });

      return {
        success: true,
        message: `Option "${data.title}" created with ${data.values.length} value${data.values.length === 1 ? "" : "s"}`,
        data: { id },
      };
    } catch (error) {
      console.error("Create product option error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to create option",
        data: null,
        error: "CREATE_FAILED",
      };
    }
  });

export const updateProductOption = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateProductOptionInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const existing = await productOptionDal.findById(data.id);
      if (!existing) {
        return {
          success: false,
          message: "Option not found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      if (data.title && data.title !== existing.title) {
        const clash = await productOptionDal.findGlobalByTitle(data.title);
        if (clash && clash.id !== data.id) {
          return {
            success: false,
            message: `An option called "${data.title}" already exists`,
            data: null,
            errors: { title: ["This name is already in use"] },
          };
        }
      }

      // Products keep their own copy of the values they were built with, so
      // editing a template never rewrites an existing product or its variants.
      await productOptionDal.update(data.id, {
        title: data.title,
        values: data.values,
        metadata: data.metadata,
        updatedBy: actorId,
      });

      return {
        success: true,
        message: "Option updated successfully",
        data: { id: data.id },
      };
    } catch (error) {
      console.error("Update product option error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to update option",
        data: null,
        error: "UPDATE_FAILED",
      };
    }
  });

export const deleteProductOptions = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteProductOptionsInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const existing = await productOptionDal.findByIds(data.ids);
      if (existing.length === 0) {
        return {
          success: false,
          message: "No matching options were found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      await productOptionDal.softDelete(
        existing.map((option) => option.id),
        actorId,
      );

      return {
        success: true,
        message: `${existing.length} option${existing.length === 1 ? "" : "s"} deleted`,
        data: { deleted: existing.length },
      };
    } catch (error) {
      console.error("Delete product options error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to delete options",
        data: null,
        error: "DELETE_FAILED",
      };
    }
  });

/**
 * Set which option axes a product has.
 *
 * Adds the new ones and detaches the rest. Detaching is refused while a variant
 * still references the axis: removing it would leave several variants in the
 * same cell — "S / Black" and "L / Black" both become "Black" — and there is no
 * right answer for which survives.
 */
export const setProductOptions = createServerFn({ method: "POST" })
  .validator((data: unknown) => setProductOptionsInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const product = await productDal.findById(data.productId);
      if (!product) {
        return {
          success: false,
          message: "Product not found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      const existing = await productDal.findOptions(data.productId);
      const wanted = new Set(
        data.options.flatMap((selection) =>
          "optionId" in selection ? [selection.optionId] : [],
        ),
      );
      const removing = existing.filter((option) => !wanted.has(option.id));

      if (removing.length > 0) {
        const inUse = await productDal.variantsByOption(data.productId);
        const blocked = removing.filter((option) => inUse.has(option.id));

        if (blocked.length > 0 && data.removeVariantsInUse) {
          // The matrix collapses without this axis, and there is no right
          // answer for which of the merged variants keeps its price and stock,
          // so they go. The caller has already confirmed the count.
          const detail = await productDal.findDetail(data.productId);
          const owned = new Set(
            (detail?.options ?? [])
              .filter((option) => blocked.some((row) => row.id === option.id))
              .flatMap((option) => option.values.map((value) => value.id)),
          );
          const doomed = (detail?.variants ?? [])
            .filter((variant) =>
              variant.optionValueIds.some((id) => owned.has(id)),
            )
            .map((variant) => variant.id);

          await productVariantDal.softDelete(doomed, actorId);
        } else if (blocked.length > 0) {
          // Named, so the author can go and look rather than take it on trust.
          const detail = blocked
            .map((option) => {
              const users = inUse.get(option.id) ?? [];
              const shown = users.slice(0, 3).join(", ");
              const rest =
                users.length > 3 ? ` and ${users.length - 3} more` : "";
              return `${option.title} (${shown}${rest})`;
            })
            .join("; ");

          return {
            success: false,
            message: `Delete these variants first — ${detail}`,
            data: null,
            errors: { optionIds: ["In use by a variant"] },
          };
        }

        await productDal.removeOptions(
          data.productId,
          removing.map((option) => option.id),
          actorId,
        );
      }

      const options = await productDal.addOptions(
        data.productId,
        data.options,
        actorId,
      );

      /**
       * Fill the matrix the options describe.
       *
       * Variants follow options: defining an axis is the decision, and making
       * the author press a second button to act on it asks the same question
       * twice. Only cells with no variant are created, so prices and stock on
       * the ones that already exist are untouched.
       *
       * A variant that predates an axis holds no value on it, so it occupies no
       * cell and is left alone — the Variants table shows a dash and its editor
       * is where that is fixed.
       */
      const detail = await productDal.findDetail(data.productId);
      let missing = detail
        ? missingCombinations(detail.options, detail.variants)
        : [];
      const valueById = new Map(
        (detail?.options ?? []).flatMap((option) =>
          option.values.map((value) => [value.id, value.value] as const),
        ),
      );
      const defaultVariant =
        existing.length === 0 &&
        detail?.variants.length === 1 &&
        detail.variants[0].optionValueIds.length === 0
          ? detail.variants[0]
          : null;
      const firstCombination = defaultVariant ? missing[0] : undefined;

      if (defaultVariant && firstCombination) {
        const sku = await resolveVariantSku({
          productHandle: product.handle,
          variantTitle: firstCombination.title,
          optionValues: firstCombination.valueIds.map(
            (id) => valueById.get(id) ?? "",
          ),
          index: 0,
        });
        await productVariantDal.update(defaultVariant.id, {
          title: firstCombination.title,
          sku,
          updatedBy: actorId,
        });
        await productVariantDal.setOptionValues(
          defaultVariant.id,
          firstCombination.valueIds,
        );
        await inventoryDal.ensureForVariant({
          variantId: defaultVariant.id,
          sku,
          title: `${product.title} - ${firstCombination.title}`,
          quantity: defaultVariant.inventoryQuantity,
        });
        missing = missing.slice(1);
      }

      const room = MAX_GENERATED_VARIANTS - (detail?.variants.length ?? 0);

      if (missing.length > 0 && missing.length <= room) {
        const reservedSkus = new Set<string>();
        const generated = [];
        for (const [index, combination] of missing.entries()) {
          const sku = await resolveVariantSku({
            productHandle: product.handle,
            variantTitle: combination.title,
            optionValues: combination.valueIds.map(
              (id) => valueById.get(id) ?? "",
            ),
            index: (detail?.variants.length ?? 0) + index,
            reserved: reservedSkus,
          });
          generated.push({
            id: crypto.randomUUID(),
            productId: data.productId,
            title: combination.title,
            sku,
            rank: (detail?.variants.length ?? 0) + index,
            manageInventory: true,
            allowBackorder: false,
            inventoryQuantity: 0,
            optionValueIds: combination.valueIds,
            prices: [],
            createdBy: actorId,
            updatedBy: actorId,
          });
        }
        await productVariantDal.createMany(generated);
        for (const variant of generated) {
          await inventoryDal.ensureForVariant({
            variantId: variant.id,
            sku: variant.sku,
            title: `${product.title} - ${variant.title}`,
            quantity: 0,
          });
        }
      }

      let restoredDefault = false;
      if (options.length === 0 && (detail?.variants.length ?? 0) === 0) {
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
            productId: data.productId,
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
        restoredDefault = true;
      }

      const created =
        missing.length > 0 && missing.length <= room ? missing.length : 0;
      const converted = Boolean(defaultVariant && firstCombination);

      return {
        success: true,
        message: restoredDefault
          ? "Options updated — Default variant restored"
          : created
            ? `Options updated — ${created} variant${created === 1 ? "" : "s"} created${converted ? " and Default converted" : ""}`
            : converted
              ? "Options updated — Default converted"
              : "Options updated",
        data: {
          count: options.length,
          created,
          converted,
          restoredDefault,
        },
      };
    } catch (error) {
      console.error("Set product options error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to update options",
        data: null,
        error: "UPDATE_FAILED",
      };
    }
  });
