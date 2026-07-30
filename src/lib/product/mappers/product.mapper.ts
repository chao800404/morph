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
  typeId: row.typeId ?? null,
  discountable: row.discountable,
  thumbnailAssetId: row.thumbnailAssetId ?? null,
  weight: row.weight ?? null,
  length: row.length ?? null,
  width: row.width ?? null,
  height: row.height ?? null,
  originCountry: row.originCountry ?? null,
  hsCode: row.hsCode ?? null,
  midCode: row.midCode ?? null,
  material: row.material ?? null,
  metadata: row.metadata,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});


