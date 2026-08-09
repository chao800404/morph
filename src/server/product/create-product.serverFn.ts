import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { productDal } from "@/lib/product/dal/product.dal";
import {
  productCategoryDal,
  productTagDal,
  productTypeDal,
} from "@/lib/product/dal/product-taxonomy.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { MAX_GENERATED_VARIANTS } from "@/lib/product/variant-limits";
import type {
  ProductOptionDTO,
  ProductOptionValueDTO,
} from "@/lib/product/dto/product-option.dto";
import type { ProductVariantInsertDTO } from "@/lib/product/dto/product-variant.dto";
import {
  createProductInputSchema,
  optionSelectionValueCount,
  toHandle,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { getConfig } from "../get-config";
import { productAdminMiddleware } from "../middleware/auth.middleware";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { resolveVariantSku } from "./product-sku";
import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";

/**
 * Cartesian product of the option values, in option order.
 * Two axes of 3 and 2 values produce 6 combinations.
 */
const buildCombinations = (
  options: ProductOptionDTO[],
): ProductOptionValueDTO[][] =>
  options.reduce<ProductOptionValueDTO[][]>(
    (combinations, option) =>
      combinations.flatMap((combination) =>
        option.values.map((value) => [...combination, value]),
      ),
    [[]],
  );

export const createProduct = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    createProductInputSchema(
      getConfig().server.upload.maxAssetsPerRecord,
    ).parse(data),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const handleResult = toHandle(data.handle, data.title);
      if (!handleResult.success) {
        return {
          success: false,
          message: "Could not derive a valid handle from the title",
          data: null,
          errors: { handle: [handleResult.error.issues[0].message] },
        };
      }
      const handle = handleResult.data;

      const priceCurrencyCodes = [
        ...data.prices.map((price) => price.currencyCode),
        ...(data.variants ?? []).flatMap((variant) =>
          variant.prices.map((price) => price.currencyCode),
        ),
      ];
      if (!(await currencyDal.areSupported(priceCurrencyCodes))) {
        return {
          success: false,
          message: "A price uses a currency that is not enabled for this store",
          data: null,
          errors: {
            prices: ["Choose a currency enabled in Store settings"],
          },
        };
      }

      if (await productDal.findByHandle(handle)) {
        return {
          success: false,
          message: `A product with the handle "${handle}" already exists`,
          data: null,
          errors: { handle: ["This handle is already in use"] },
        };
      }

      const selectedChannels = await salesChannelDal.findByIds(
        data.salesChannelIds,
      );
      if (selectedChannels.length !== data.salesChannelIds.length) {
        return {
          success: false,
          message: "One or more sales channels no longer exist",
          data: null,
          errors: { salesChannelIds: ["Review the selected sales channels"] },
        };
      }

      // Only the generated matrix needs capping; an explicit list is already
      // bounded by the input schema.
      const combinationCount = data.options.reduce(
        (total, option) => total * optionSelectionValueCount(option),
        1,
      );
      if (
        !data.variants &&
        data.options.length > 0 &&
        combinationCount > MAX_GENERATED_VARIANTS
      ) {
        return {
          success: false,
          message: `These options would generate ${combinationCount} variants, above the limit of ${MAX_GENERATED_VARIANTS}`,
          data: null,
          errors: { options: ["Too many option value combinations"] },
        };
      }
      if (data.options.length === 0 && (data.variants?.length ?? 0) > 1) {
        return {
          success: false,
          message:
            "A product without options can only have one default variant",
          data: null,
          errors: { variants: ["Only one default variant is allowed"] },
        };
      }

      // Types and tags are upserted by value, so an author can name one that
      // does not exist yet without a separate round trip.
      const now = new Date().toISOString();
      const typeId = data.typeValue
        ? await productTypeDal.ensure(data.typeValue, now)
        : null;

      const productId = crypto.randomUUID();
      await productDal.create({
        id: productId,
        title: data.title,
        handle,
        subtitle: data.subtitle,
        description: data.description,
        status: data.status,
        collectionId: data.collectionId,
        typeId,
        discountable: data.discountable,
        createdBy: actorId,
        updatedBy: actorId,
      });

      await salesChannelDal.setProductChannels(
        productId,
        selectedChannels.map((channel) => channel.id),
      );

      if (data.assetIds.length > 0) {
        await productDal.setAssets(productId, data.assetIds);
      }

      if (data.tagValues.length > 0) {
        await productDal.setTags(
          productId,
          await productTagDal.ensureMany(data.tagValues, now),
        );
      }

      if (data.categoryIds.length > 0) {
        // Unknown ids are dropped rather than rejected: a category deleted
        // while the wizard was open should not fail the whole product.
        await productDal.setCategories(
          productId,
          await productCategoryDal.filterExisting(data.categoryIds),
        );
      }

      let variantCount = 0;
      if (data.options.length > 0) {
        const options = await productDal.replaceOptions(
          productId,
          data.options,
          actorId,
        );

        // Option value IDs only exist after the server creates them, so the
        // client's string values are resolved against the freshly stored rows.
        const valueIdByOptionAndValue = new Map<string, string>();
        options.forEach((option, optionIndex) => {
          option.values.forEach((value) => {
            valueIdByOptionAndValue.set(
              `${optionIndex}:${value.value}`,
              value.id,
            );
          });
        });

        const variants: ProductVariantInsertDTO[] = data.variants
          ? data.variants.map((variant, index) => ({
              id: crypto.randomUUID(),
              productId,
              title: variant.title,
              sku: variant.sku,
              rank: index,
              manageInventory: variant.manageInventory,
              allowBackorder: variant.allowBackorder,
              inventoryQuantity: variant.inventoryQuantity,
              optionValueIds: variant.optionValues
                .map((value, optionIndex) =>
                  valueIdByOptionAndValue.get(`${optionIndex}:${value}`),
                )
                .filter((id): id is string => id !== undefined),
              prices: variant.prices.length > 0 ? variant.prices : data.prices,
              createdBy: actorId,
              updatedBy: actorId,
            }))
          : buildCombinations(options).map((combination, index) => ({
              id: crypto.randomUUID(),
              productId,
              title: combination.map((value) => value.value).join(" / "),
              rank: index,
              optionValueIds: combination.map((value) => value.id),
              prices: data.prices,
              createdBy: actorId,
              updatedBy: actorId,
            }));

        const reservedSkus = new Set<string>();
        const variantsWithSkus: ProductVariantInsertDTO[] = [];
        for (const [index, variant] of variants.entries()) {
          variantsWithSkus.push({
            ...variant,
            sku: await resolveVariantSku({
              sku: variant.sku,
              productHandle: handle,
              variantTitle: variant.title,
              optionValues:
                data.variants?.[index]?.optionValues ??
                variants[index].title.split(" / "),
              index,
              reserved: reservedSkus,
            }),
          });
        }

        await productVariantDal.createMany(variantsWithSkus);
        for (const variant of variantsWithSkus) {
          if (variant.manageInventory ?? true) {
            await inventoryDal.ensureForVariant({
              variantId: variant.id,
              sku: variant.sku ?? null,
              title: `${data.title} - ${variant.title}`,
              quantity: variant.inventoryQuantity ?? 0,
            });
          }
        }
        variantCount = variants.length;
      } else {
        // A product with no options still needs one sellable variant.
        const input = data.variants?.[0];
        const defaultVariant: ProductVariantInsertDTO = {
          id: crypto.randomUUID(),
          productId,
          title: input?.title ?? "Default",
          sku: await resolveVariantSku({
            sku: input?.sku,
            productHandle: handle,
            variantTitle: input?.title ?? "Default",
            optionValues: [],
            index: 0,
          }),
          rank: 0,
          manageInventory: input?.manageInventory ?? true,
          allowBackorder: input?.allowBackorder ?? false,
          inventoryQuantity: input?.inventoryQuantity ?? 0,
          prices: input && input.prices.length > 0 ? input.prices : data.prices,
          createdBy: actorId,
          updatedBy: actorId,
        };
        await productVariantDal.createMany([defaultVariant]);
        if (defaultVariant.manageInventory ?? true) {
          await inventoryDal.ensureForVariant({
            variantId: defaultVariant.id,
            sku: defaultVariant.sku ?? null,
            title: `${data.title} - ${defaultVariant.title}`,
            quantity: defaultVariant.inventoryQuantity ?? 0,
          });
        }
        variantCount = 1;
      }

      return {
        success: true,
        message: `Product "${data.title}" created with ${variantCount} variant${variantCount === 1 ? "" : "s"}`,
        data: { id: productId, handle, variantCount },
      };
    } catch (error) {
      // D1 has no interactive transactions, so a failure here can leave the
      // product partially written. Report it rather than implying a rollback.
      console.error("Create product error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to create product",
        data: null,
        error: "CREATE_FAILED",
      };
    }
  });
