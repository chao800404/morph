import { z } from "zod";
import {
  addressInputSchema,
  idSchema,
  idsSchema,
  listParamsSchema,
} from "./commerce";
import { metadataInputSchema } from "./product";

export const listStockLocationsInputSchema = listParamsSchema(
  ["name", "createdAt", "updatedAt"],
  { sortBy: "createdAt" },
);

export const getStockLocationInputSchema = z.object({
  id: idSchema("stock location"),
});

/**
 * A location's address requires a street line, unlike the shared address shape.
 *
 * A warehouse with a country and nothing else cannot be shipped from, and this
 * is the one address in the system an operator types rather than a customer.
 */
export const stockLocationAddressInputSchema = addressInputSchema.extend({
  address1: z.string().trim().min(1, "Street address is required").max(300),
});

export const createStockLocationInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  address: stockLocationAddressInputSchema.nullish(),
});

export const updateStockLocationInputSchema = z.object({
  id: idSchema("stock location"),
  name: z.string().trim().min(1).max(200).optional(),
  // Explicit null clears the address; omitting it leaves the address alone.
  address: stockLocationAddressInputSchema.nullish(),
  metadata: metadataInputSchema.optional(),
});

export const deleteStockLocationsInputSchema = idsSchema("stock location");

export const setLocationSalesChannelsInputSchema = z.object({
  stockLocationId: idSchema("stock location"),
  salesChannelIds: z.array(idSchema("sales channel")).max(100),
});
