import type { PriceListStatus, PriceListType } from "@/db/pricing.schema";
import type { ProductMetadata } from "@/db/product.schema";

export interface PriceListDTO {
  id: string;
  title: string;
  description: string;
  status: PriceListStatus;
  type: PriceListType;
  startsAt: string | null;
  endsAt: string | null;
  customerGroupIds: string[];
  regionIds: string[];
  metadata: ProductMetadata;
  priceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PriceListPriceDTO {
  id: string;
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  currencyCode: string;
  amount: number;
  minQuantity: number | null;
  maxQuantity: number | null;
  createdAt: string;
}

export interface PriceListListParams {
  query?: string;
  status?: PriceListStatus;
  type?: PriceListType;
  sortBy: "title" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
  /** Exact REST offset for API clients that do not use page pagination. */
  offset?: number;
}

export interface PriceListPriceListParams {
  priceListId: string;
  query?: string;
  sortBy: "product" | "amount" | "createdAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
  /** Exact REST offset for API clients that do not use page pagination. */
  offset?: number;
}
