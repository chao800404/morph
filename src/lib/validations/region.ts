import { z } from "zod";
import {
  countryCodeSchema,
  idSchema,
  idsSchema,
  listParamsSchema,
} from "./commerce";
import { currencyCodeSchema, metadataInputSchema } from "./product";

export const listRegionsInputSchema = listParamsSchema(
  ["name", "createdAt", "updatedAt"],
  { sortBy: "createdAt" },
);

export const getRegionInputSchema = z.object({ id: idSchema("region") });

/**
 * Countries are set at creation, not afterwards.
 *
 * A region with no countries serves nobody, so making it a second step would
 * let an author save something that cannot take an order.
 */
export const createRegionInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  currencyCode: currencyCodeSchema,
  automaticTaxes: z.boolean().optional(),
  isTaxInclusive: z.boolean().optional(),
  countries: z.array(countryCodeSchema).max(250).default([]),
  paymentProviderIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
});

export const updateRegionInputSchema = z.object({
  id: idSchema("region"),
  name: z.string().trim().min(1).max(200).optional(),
  currencyCode: currencyCodeSchema.optional(),
  automaticTaxes: z.boolean().optional(),
  isTaxInclusive: z.boolean().optional(),
  // Absent means "leave them alone"; an empty array means "serve nowhere".
  countries: z.array(countryCodeSchema).max(250).optional(),
  paymentProviderIds: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(50)
    .optional(),
  metadata: metadataInputSchema.optional(),
});

export const deleteRegionsInputSchema = idsSchema("region");

export const listAssignableCountriesInputSchema = z.object({
  /** Includes this region's own countries, so the editor can pre-check them. */
  regionId: idSchema("region").nullish(),
});
