import { productDal } from "@/lib/product/dal/product.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import type {
  ProductOptionDTO,
  ProductOptionValueDTO,
} from "@/lib/product/dto/product.dto";
import type { ProductVariantInsertDTO } from "@/lib/product/dto/product-variant.dto";
import {
  createProductInputSchema,
  handleSchema,
  slugify,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { productAdminMiddleware } from "../middleware/auth.middleware";

/** Cap the generated matrix so a careless option set cannot blow up D1. */
const MAX_GENERATED_VARIANTS = 200;

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
  .inputValidator((data: unknown) => createProductInputSchema.parse(data))
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

      if (await productDal.findByHandle(handle)) {
        return {
          success: false,
          message: `A product with the handle "${handle}" already exists`,
          data: null,
          errors: { handle: ["This handle is already in use"] },
        };
      }

      // Only the generated matrix needs capping; an explicit list is already
      // bounded by the input schema.
      const combinationCount = data.options.reduce(
        (total, option) => total * option.values.length,
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

      const productId = crypto.randomUUID();
      await productDal.create({
        id: productId,
        title: data.title,
        handle,
        subtitle: data.subtitle,
        description: data.description,
        status: data.status,
        collectionId: data.collectionId,
        thumbnailAssetId: data.thumbnailAssetId,
        createdBy: actorId,
        updatedBy: actorId,
      });

      if (data.assetIds.length > 0) {
        await productDal.setAssets(productId, data.assetIds);
      }

      let variantCount = 0;
      if (data.options.length > 0) {
        const options = await productDal.replaceOptions(productId, data.options);

        // Option value IDs only exist after the server creates them, so the
        // client's string values are resolved against the freshly stored rows.
        const valueIdByOptionAndValue = new Map<string, string>();
        options.forEach((option, optionIndex) => {
          option.values.forEach((value) => {
            valueIdByOptionAndValue.set(`${optionIndex}:${value.value}`, value.id);
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

        await productVariantDal.createMany(variants);
        variantCount = variants.length;
      } else {
        // A product with no options still needs one sellable variant.
        await productVariantDal.createMany([
          {
            id: crypto.randomUUID(),
            productId,
            title: "Default",
            rank: 0,
            prices: data.prices,
            createdBy: actorId,
            updatedBy: actorId,
          },
        ]);
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
