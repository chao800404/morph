import { z } from "zod";
import type { ProductMetadata } from "@/db/product.schema";
import type { ProductListItemDTO } from "./product.dto";

const dateWindowSchema = z.enum(["24h", "7d", "30d", "90d"]);

export const productExportFiltersSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    status: z.enum(["draft", "published", "archived"]).optional(),
    createdWithin: dateWindowSchema.optional(),
    updatedWithin: dateWindowSchema.optional(),
    collectionId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    optionId: z.uuid().optional(),
    salesChannelId: z.uuid().optional(),
    sortBy: z.enum(["title", "createdAt", "updatedAt"]),
    sortOrder: z.enum(["asc", "desc"]),
  })
  .strict();

export type ProductExportFilters = z.infer<typeof productExportFiltersSchema>;

export interface ProductExportVariantDTO {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  ean: string | null;
  upc: string | null;
  rank: number;
  manageInventory: boolean;
  allowBackorder: boolean;
  inventoryQuantity: number;
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  originCountry: string | null;
  hsCode: string | null;
  midCode: string | null;
  material: string | null;
  optionValues: Array<{ option: string; value: string }>;
  prices: Array<{ currencyCode: string; amount: number }>;
  imageUrls: string[];
  inventoryKit: Array<{
    inventoryItemId: string;
    title: string | null;
    sku: string | null;
    unitOfMeasure: string | null;
    requiredQuantity: number;
  }>;
  metadata: ProductMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface ProductExportItemDTO {
  product: ProductListItemDTO;
  imageUrls: string[];
  tags: string[];
  categories: string[];
  variants: ProductExportVariantDTO[];
}
