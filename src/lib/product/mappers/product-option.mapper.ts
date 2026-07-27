import { productOptionValues, productOptions } from "@/db/product.schema";
import type {
  ProductOptionDTO,
  ProductOptionValueDTO,
} from "../dto/product-option.dto";

export type ProductOptionRow = typeof productOptions.$inferSelect;
export type ProductOptionValueRow = typeof productOptionValues.$inferSelect;

export const toProductOptionValueDTO = (
  row: ProductOptionValueRow,
): ProductOptionValueDTO => ({
  id: row.id,
  optionId: row.optionId,
  value: row.value,
  rank: row.rank,
  metadata: row.metadata ?? null,
});

export const toProductOptionDTO = (
  row: ProductOptionRow,
  valueRows: ProductOptionValueRow[] = [],
): ProductOptionDTO => ({
  id: row.id,
  title: row.title,
  isExclusive: row.isExclusive,
  rank: row.rank,
  metadata: row.metadata ?? null,
  values: valueRows
    .filter((value) => value.optionId === row.id && value.deletedAt === null)
    .sort((a, b) => a.rank - b.rank)
    .map(toProductOptionValueDTO),
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});
