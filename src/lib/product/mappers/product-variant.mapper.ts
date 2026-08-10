import {
  productVariantOptionValues,
  productVariantPrices,
  productVariants,
} from "@/db/product.schema";
import type {
  ProductVariantDTO,
  ProductVariantPriceDTO,
} from "../dto/product-variant.dto";

export type ProductVariantRow = typeof productVariants.$inferSelect;
export type ProductVariantPriceRow = typeof productVariantPrices.$inferSelect;
export type ProductVariantOptionValueRow =
  typeof productVariantOptionValues.$inferSelect;
export type ProductVariantAssetRow = {
  variantId: string;
  assetId: string;
  rank: number;
  name: string;
  url: string;
};

export const toProductVariantPriceDTO = (
  row: ProductVariantPriceRow,
): ProductVariantPriceDTO => ({
  id: row.id,
  variantId: row.variantId,
  currencyCode: row.currencyCode,
  amount: row.amount,
});

export const toProductVariantDTO = (
  row: ProductVariantRow,
  priceRows: ProductVariantPriceRow[] = [],
  optionValueRows: ProductVariantOptionValueRow[] = [],
  assetRows: ProductVariantAssetRow[] = [],
): ProductVariantDTO => ({
  id: row.id,
  productId: row.productId,
  title: row.title,
  sku: row.sku ?? null,
  barcode: row.barcode ?? null,
  rank: row.rank,
  manageInventory: row.manageInventory,
  allowBackorder: row.allowBackorder,
  inventoryQuantity: row.inventoryQuantity,
  weight: row.weight ?? null,
  length: row.length ?? null,
  width: row.width ?? null,
  height: row.height ?? null,
  thumbnailAssetId: row.thumbnailAssetId ?? null,
  assets: assetRows
    .filter((asset) => asset.variantId === row.id)
    .sort((a, b) => a.rank - b.rank)
    .map((asset) => ({ id: asset.assetId, name: asset.name, url: asset.url })),
  optionValueIds: optionValueRows
    .filter((link) => link.variantId === row.id)
    .map((link) => link.optionValueId),
  prices: priceRows
    .filter((price) => price.variantId === row.id)
    .map(toProductVariantPriceDTO),
  metadata: row.metadata ?? {},
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});
