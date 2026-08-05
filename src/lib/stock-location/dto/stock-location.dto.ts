import type { Metadata } from "@/db/json";

export interface StockLocationAddressDTO {
  id: string;
  address1: string;
  address2: string | null;
  company: string | null;
  city: string | null;
  countryCode: string;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
}

export interface StockLocationDTO {
  id: string;
  name: string;
  /** Null when the address was deleted; the location itself survives. */
  address: StockLocationAddressDTO | null;
  /** Free-form store-defined data; never trusted to hold anything private. */
  metadata: Metadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockLocationAddressInputDTO {
  address1: string;
  address2?: string | null;
  company?: string | null;
  city?: string | null;
  countryCode: string;
  province?: string | null;
  postalCode?: string | null;
  phone?: string | null;
}

export interface StockLocationInsertDTO {
  id: string;
  name: string;
  address?: StockLocationAddressInputDTO | null;
}

export interface UpdateStockLocationDTO {
  name?: string;
  address?: StockLocationAddressInputDTO | null;
  metadata?: Metadata;
}
