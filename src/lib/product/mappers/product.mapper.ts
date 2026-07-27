import { products } from "@/db/product.schema";
import type { ProductDTO } from "../dto/product.dto";

export type ProductRow = typeof products.$inferSelect;

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


