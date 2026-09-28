import { assets } from "@/db/asset.schema";
import { getDb } from "@/db";
import { inventoryItems } from "@/db/inventory.schema";
import {
  productVariantInventoryItems,
  productVariantPriceSets,
} from "@/db/link.schema";
import {
  productAssets,
  productCategories,
  productCategoryLinks,
  productOptionValues,
  productOptions,
  productTagLinks,
  productTags,
  productVariantAssets,
  productVariantOptionValues,
  productVariantPrices,
  productVariants,
} from "@/db/product.schema";
import { priceSets, prices } from "@/db/pricing.schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type {
  ProductExportFilters,
  ProductExportItemDTO,
} from "../dto/product-export.dto";
import { productDal } from "./product.dal";
import type { CsvExportPage } from "@/lib/commerce-export/service/csv-export.service";

const chunkIds = (ids: string[], size = 50): string[][] => {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
};

const addToGroup = <T>(groups: Map<string, T[]>, key: string, value: T) => {
  const values = groups.get(key);
  if (values) values.push(value);
  else groups.set(key, [value]);
};

/** Batch product relations for the asynchronous product CSV export. */
export const productExportDal = {
  async listPage(
    input: ProductExportFilters & CsvExportPage,
  ): Promise<{ items: ProductExportItemDTO[]; total: number }> {
    const page = await productDal.listPage(input);
    if (page.products.length === 0) return { items: [], total: page.total };

    const db = await getDb();
    const productIds = page.products.map((product) => product.id);
    const variantRows: Array<typeof productVariants.$inferSelect> = [];
    const imageRows: Array<{
      productId: string;
      url: string;
      rank: number;
    }> = [];
    const tagRows: Array<{ productId: string; value: string }> = [];
    const categoryRows: Array<{ productId: string; name: string }> = [];

    for (const ids of chunkIds(productIds)) {
      const [variants, images, tags, categories] = await Promise.all([
        db
          .select()
          .from(productVariants)
          .where(
            and(
              inArray(productVariants.productId, ids),
              isNull(productVariants.deletedAt),
            ),
          )
          .orderBy(
            asc(productVariants.productId),
            asc(productVariants.rank),
            asc(productVariants.id),
          ),
        db
          .select({
            productId: productAssets.productId,
            url: assets.url,
            rank: productAssets.rank,
          })
          .from(productAssets)
          .innerJoin(assets, eq(assets.id, productAssets.assetId))
          .where(
            and(
              inArray(productAssets.productId, ids),
              isNull(assets.deletedAt),
            ),
          )
          .orderBy(asc(productAssets.productId), asc(productAssets.rank)),
        db
          .select({
            productId: productTagLinks.productId,
            value: productTags.value,
          })
          .from(productTagLinks)
          .innerJoin(productTags, eq(productTags.id, productTagLinks.tagId))
          .where(
            and(
              inArray(productTagLinks.productId, ids),
              isNull(productTags.deletedAt),
            ),
          ),
        db
          .select({
            productId: productCategoryLinks.productId,
            name: productCategories.name,
          })
          .from(productCategoryLinks)
          .innerJoin(
            productCategories,
            eq(productCategories.id, productCategoryLinks.categoryId),
          )
          .where(
            and(
              inArray(productCategoryLinks.productId, ids),
              isNull(productCategories.deletedAt),
            ),
          ),
      ]);
      variantRows.push(...variants);
      imageRows.push(...images);
      tagRows.push(...tags);
      categoryRows.push(...categories);
    }

    const variantIds = variantRows.map((variant) => variant.id);
    const optionValues: Array<{
      variantId: string;
      option: string;
      value: string;
    }> = [];
    const normalizedPriceRows: Array<{
      variantId: string;
      currencyCode: string;
      amount: number;
    }> = [];
    const legacyPriceRows: Array<{
      variantId: string;
      currencyCode: string;
      amount: number;
    }> = [];
    const variantImageRows: Array<{
      variantId: string;
      url: string;
      rank: number;
    }> = [];
    const kitRows: Array<{
      variantId: string;
      inventoryItemId: string;
      title: string | null;
      sku: string | null;
      unitOfMeasure: string | null;
      requiredQuantity: number;
    }> = [];

    for (const ids of chunkIds(variantIds)) {
      const [options, normalizedPrices, legacyPrices, kits, variantImages] =
        await Promise.all([
          db
            .select({
              variantId: productVariantOptionValues.variantId,
              option: productOptions.title,
              value: productOptionValues.value,
            })
            .from(productVariantOptionValues)
            .innerJoin(
              productOptionValues,
              eq(
                productOptionValues.id,
                productVariantOptionValues.optionValueId,
              ),
            )
            .innerJoin(
              productOptions,
              eq(productOptions.id, productOptionValues.optionId),
            )
            .where(
              and(
                inArray(productVariantOptionValues.variantId, ids),
                isNull(productOptionValues.deletedAt),
                isNull(productOptions.deletedAt),
              ),
            )
            .orderBy(
              asc(productVariantOptionValues.variantId),
              asc(productOptions.rank),
              asc(productOptionValues.rank),
            ),
          db
            .select({
              variantId: productVariantPriceSets.variantId,
              currencyCode: prices.currencyCode,
              amount: prices.amount,
            })
            .from(productVariantPriceSets)
            .innerJoin(
              priceSets,
              and(
                eq(priceSets.id, productVariantPriceSets.priceSetId),
                isNull(priceSets.deletedAt),
              ),
            )
            .innerJoin(
              prices,
              and(
                eq(prices.priceSetId, priceSets.id),
                isNull(prices.priceListId),
                isNull(prices.minQuantity),
                isNull(prices.maxQuantity),
                eq(prices.rulesCount, 0),
                isNull(prices.deletedAt),
              ),
            )
            .where(inArray(productVariantPriceSets.variantId, ids))
            .orderBy(
              asc(productVariantPriceSets.variantId),
              asc(prices.currencyCode),
            ),
          db
            .select({
              variantId: productVariantPrices.variantId,
              currencyCode: productVariantPrices.currencyCode,
              amount: productVariantPrices.amount,
            })
            .from(productVariantPrices)
            .where(inArray(productVariantPrices.variantId, ids))
            .orderBy(
              asc(productVariantPrices.variantId),
              asc(productVariantPrices.currencyCode),
            ),
          db
            .select({
              variantId: productVariantInventoryItems.variantId,
              inventoryItemId: productVariantInventoryItems.inventoryItemId,
              title: inventoryItems.title,
              sku: inventoryItems.sku,
              unitOfMeasure: inventoryItems.unitOfMeasure,
              requiredQuantity: productVariantInventoryItems.requiredQuantity,
            })
            .from(productVariantInventoryItems)
            .innerJoin(
              inventoryItems,
              eq(
                inventoryItems.id,
                productVariantInventoryItems.inventoryItemId,
              ),
            )
            .where(
              and(
                inArray(productVariantInventoryItems.variantId, ids),
                isNull(inventoryItems.deletedAt),
              ),
            )
            .orderBy(
              asc(productVariantInventoryItems.variantId),
              asc(productVariantInventoryItems.inventoryItemId),
            ),
          // Variant-specific images are links into the product gallery.
          db
            .select({
              variantId: productVariantAssets.variantId,
              url: assets.url,
              rank: productVariantAssets.rank,
            })
            .from(productVariantAssets)
            .innerJoin(assets, eq(assets.id, productVariantAssets.assetId))
            .where(
              and(
                inArray(productVariantAssets.variantId, ids),
                isNull(assets.deletedAt),
              ),
            )
            .orderBy(
              asc(productVariantAssets.variantId),
              asc(productVariantAssets.rank),
            ),
        ]);
      optionValues.push(...options);
      normalizedPriceRows.push(...normalizedPrices);
      legacyPriceRows.push(...legacyPrices);
      kitRows.push(...kits);
      variantImageRows.push(...variantImages);
    }

    const optionsByVariant = new Map<
      string,
      Array<{ option: string; value: string }>
    >();
    for (const row of optionValues) {
      addToGroup(optionsByVariant, row.variantId, {
        option: row.option,
        value: row.value,
      });
    }
    const imagesByVariant = new Map<string, string[]>();
    for (const row of variantImageRows) {
      addToGroup(imagesByVariant, row.variantId, row.url);
    }
    const imageUrlsByProduct = new Map<string, string[]>();
    for (const row of imageRows)
      addToGroup(imageUrlsByProduct, row.productId, row.url);
    const tagsByProduct = new Map<string, string[]>();
    for (const row of tagRows)
      addToGroup(tagsByProduct, row.productId, row.value);
    const categoriesByProduct = new Map<string, string[]>();
    for (const row of categoryRows) {
      addToGroup(categoriesByProduct, row.productId, row.name);
    }
    const pricesByVariant = new Map<
      string,
      Map<string, { currencyCode: string; amount: number }>
    >();
    for (const row of [...legacyPriceRows, ...normalizedPriceRows]) {
      let byCurrency = pricesByVariant.get(row.variantId);
      if (!byCurrency) {
        byCurrency = new Map();
        pricesByVariant.set(row.variantId, byCurrency);
      }
      // Normalized prices are processed after legacy prices and take priority.
      byCurrency.set(row.currencyCode, {
        currencyCode: row.currencyCode,
        amount: row.amount,
      });
    }
    const kitsByVariant = new Map<
      string,
      ProductExportItemDTO["variants"][number]["inventoryKit"]
    >();
    for (const row of kitRows) {
      addToGroup(kitsByVariant, row.variantId, {
        inventoryItemId: row.inventoryItemId,
        title: row.title,
        sku: row.sku,
        unitOfMeasure: row.unitOfMeasure,
        requiredQuantity: row.requiredQuantity,
      });
    }
    const variantsByProduct = new Map<
      string,
      ProductExportItemDTO["variants"]
    >();
    for (const row of variantRows) {
      const variant = {
        id: row.id,
        title: row.title,
        sku: row.sku,
        barcode: row.barcode,
        ean: row.ean,
        upc: row.upc,
        rank: row.rank,
        manageInventory: row.manageInventory,
        allowBackorder: row.allowBackorder,
        inventoryQuantity: row.inventoryQuantity,
        weight: row.weight,
        length: row.length,
        width: row.width,
        height: row.height,
        originCountry: row.originCountry,
        hsCode: row.hsCode,
        midCode: row.midCode,
        material: row.material,
        optionValues: optionsByVariant.get(row.id) ?? [],
        prices: [...(pricesByVariant.get(row.id)?.values() ?? [])],
        imageUrls: imagesByVariant.get(row.id) ?? [],
        inventoryKit: kitsByVariant.get(row.id) ?? [],
        metadata: row.metadata ?? {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      addToGroup(variantsByProduct, row.productId, variant);
    }

    return {
      total: page.total,
      items: page.products.map((product) => ({
        product,
        imageUrls: imageUrlsByProduct.get(product.id) ?? [],
        tags: tagsByProduct.get(product.id) ?? [],
        categories: categoriesByProduct.get(product.id) ?? [],
        variants: variantsByProduct.get(product.id) ?? [],
      })),
    };
  },
};
