import type { productCategories } from "@/db/product.schema";
import type { ProductCategoryDTO } from "../dto/product-taxonomy.dto";

export const toProductCategoryDTO = (
  row: Pick<
    typeof productCategories.$inferSelect,
    | "id"
    | "name"
    | "description"
    | "handle"
    | "mpath"
    | "parentCategoryId"
    | "isActive"
    | "isInternal"
    | "rank"
    | "metadata"
    | "createdAt"
    | "updatedAt"
  >,
): ProductCategoryDTO => ({
  id: row.id,
  name: row.name,
  description: row.description,
  handle: row.handle,
  mpath: row.mpath,
  parentCategoryId: row.parentCategoryId ?? null,
  isActive: row.isActive,
  isInternal: row.isInternal,
  rank: row.rank,
  metadata: row.metadata ?? {},
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});
