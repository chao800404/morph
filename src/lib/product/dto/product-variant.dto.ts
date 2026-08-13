import type { ProductMetadata } from "@/db/product.schema";

export interface ProductVariantPriceDTO {
  id: string;
  variantId: string;
  currencyCode: string;
  /** Integer in the currency's minor unit. */
  amount: number;
}

export interface ProductVariantPriceHistoryDTO {
  id: string;
  variantId: string;
  currencyCode: string;
  oldAmount: number | null;
  newAmount: number | null;
  changedBy: string;
  changedByName: string | null;
  changedAt: Date;
}

export type ProductVariantSortKey =
  | "name"
  | "createdAt"
  | "updatedAt"
  | `option:${string}`;

export interface ProductVariantListParams {
  productId: string;
  query?: string;
  sortBy: ProductVariantSortKey;
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

export type ProductVariantPriceChange =
  | "created"
  | "increased"
  | "decreased"
  | "removed";

export interface ProductVariantPriceHistoryListParams {
  variantId: string;
  query?: string;
  currencies?: string[];
  changes?: ProductVariantPriceChange[];
  changedBy?: string[];
  changedWithin?: "24h" | "7d" | "30d" | "90d";
  sortBy: "updatedAt" | "code" | "name";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

export interface ProductVariantPriceHistoryFacets {
  currencies: string[];
  changedBy: Array<{ id: string; name: string }>;
}

export interface CreateProductVariantPriceDTO {
  currencyCode: string;
  amount: number;
}

export interface ProductVariantDTO {
  id: string;
  productId: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  rank: number;
  manageInventory: boolean;
  allowBackorder: boolean;
  inventoryQuantity: number;
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  thumbnailAssetId: string | null;
  /** Variant-specific images, restricted to the product gallery, in rank order. */
  assets: Array<{ id: string; name: string; url: string }>;
  /** Option values this variant is defined by, one per option axis. */
  optionValueIds: string[];
  prices: ProductVariantPriceDTO[];
  metadata: ProductMetadata;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Lightweight projection returned by the global Product Variant search. */
export interface ProductVariantSearchResultDTO {
  id: string;
  productId: string;
  productTitle: string;
  title: string;
  sku: string | null;
  optionValues: string | null;
}

export interface CreateProductVariantDTO {
  title: string;
  sku?: string | null;
  barcode?: string | null;
  rank?: number;
  manageInventory?: boolean;
  allowBackorder?: boolean;
  inventoryQuantity?: number;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  optionValueIds?: string[];
  prices?: CreateProductVariantPriceDTO[];
  assetIds?: string[];
  metadata?: ProductMetadata;
  createdBy: string;
  updatedBy: string;
}

export interface ProductVariantInsertDTO extends CreateProductVariantDTO {
  id: string;
  productId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateProductVariantDTO {
  title?: string;
  sku?: string | null;
  barcode?: string | null;
  rank?: number;
  manageInventory?: boolean;
  allowBackorder?: boolean;
  inventoryQuantity?: number;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  /** When present, replaces the variant's full price list. */
  prices?: CreateProductVariantPriceDTO[];
  metadata?: ProductMetadata;
  updatedBy: string;
}
