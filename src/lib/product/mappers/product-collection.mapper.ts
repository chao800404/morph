import { productCollections } from "@/db/product.schema";
import type { ProductCollectionDTO } from "../dto/product-collection.dto";

export type ProductCollectionRow = typeof productCollections.$inferSelect;

export const toProductCollectionDTO = (
  row: ProductCollectionRow,
): ProductCollectionDTO => ({
  id: row.id,
  title: row.title,
  handle: row.handle,
  description: row.description ?? null,
  externalId: row.externalId ?? null,
  metadata: row.metadata ?? {},
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});
