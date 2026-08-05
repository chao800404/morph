import {
  stockLocationAddresses,
  stockLocations,
} from "@/db/stock-location.schema";
import type {
  StockLocationAddressDTO,
  StockLocationDTO,
} from "../dto/stock-location.dto";

export type StockLocationRow = typeof stockLocations.$inferSelect;
export type StockLocationAddressRow =
  typeof stockLocationAddresses.$inferSelect;

export const toStockLocationAddressDTO = (
  row: StockLocationAddressRow,
): StockLocationAddressDTO => ({
  id: row.id,
  address1: row.address1,
  address2: row.address2 ?? null,
  company: row.company ?? null,
  city: row.city ?? null,
  countryCode: row.countryCode,
  province: row.province ?? null,
  postalCode: row.postalCode ?? null,
  phone: row.phone ?? null,
});

export const toStockLocationDTO = (
  row: StockLocationRow,
  address: StockLocationAddressRow | null,
): StockLocationDTO => ({
  id: row.id,
  name: row.name,
  address: address ? toStockLocationAddressDTO(address) : null,
  metadata: row.metadata ?? {},
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});
