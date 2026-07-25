import {
  productOptionValues,
  productOptions,
  products,
} from "@/db/product.schema";
import type {
  ProductDTO,
  ProductOptionDTO,
  ProductOptionValueDTO,
} from "../dto/product.dto";

export type ProductRow = typeof products.$inferSelect;
export type ProductOptionRow = typeof productOptions.$inferSelect;
export type ProductOptionValueRow = typeof productOptionValues.$inferSelect;

export const toProductDTO = (row: ProductRow): ProductDTO => ({
  id: row.id,
  title: row.title,
  handle: row.handle,
  subtitle: row.subtitle ?? null,
  description: row.description ?? null,
  status: row.status,
  collectionId: row.collectionId ?? null,
  thumbnailAssetId: row.thumbnailAssetId ?? null,
  metadata: row.metadata,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});

export const toProductOptionValueDTO = (
  row: ProductOptionValueRow,
): ProductOptionValueDTO => ({
  id: row.id,
  optionId: row.optionId,
  value: row.value,
  rank: row.rank,
});

/**
 * Options carry their values, so the caller gets one nested shape instead of
 * having to zip two flat lists.
 */
export const toProductOptionDTO = (
  row: ProductOptionRow,
  valueRows: ProductOptionValueRow[],
): ProductOptionDTO => ({
  id: row.id,
  productId: row.productId,
  title: row.title,
  rank: row.rank,
  values: valueRows
    .filter((value) => value.optionId === row.id)
    .sort((a, b) => a.rank - b.rank)
    .map(toProductOptionValueDTO),
});
