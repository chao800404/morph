import { z } from "zod";
import {
  addressInputSchema,
  countryCodeSchema,
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

export const createStockLocationFulfillmentSetInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    type: z.enum(["shipping", "pickup"]),
    metadata: metadataInputSchema.optional(),
  })
  .strict();

export type CreateStockLocationFulfillmentSetInput = z.infer<
  typeof createStockLocationFulfillmentSetInputSchema
>;

/**
 * A location's address requires a street line, unlike the shared address shape.
 *
 * A warehouse with a country and nothing else cannot be shipped from, and this
 * is the one address in the system an operator types rather than a customer.
 */
export const stockLocationAddressInputSchema = addressInputSchema.extend({
  address1: z.string().trim().min(1, "Street address is required").max(300),
  metadata: metadataInputSchema.optional(),
});

export const createStockLocationInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  address: stockLocationAddressInputSchema.nullish(),
  metadata: metadataInputSchema.optional(),
});

export type CreateStockLocationInput = z.infer<
  typeof createStockLocationInputSchema
>;

export const stockLocationAddressPatchSchema = z
  .object({
    address1: z.string().trim().min(1).max(300).optional(),
    address2: z.string().trim().max(300).nullish(),
    company: z.string().trim().max(200).nullish(),
    city: z.string().trim().max(120).nullish(),
    countryCode: countryCodeSchema.optional(),
    province: z.string().trim().max(120).nullish(),
    postalCode: z.string().trim().max(40).nullish(),
    phone: z.string().trim().max(40).nullish(),
    metadata: metadataInputSchema.optional(),
  })
  .strict();

export const updateStockLocationInputSchema = z
  .object({
    id: idSchema("stock location"),
    name: z.string().trim().min(1).max(200).optional(),
    // Explicit null clears the address; an object patches supplied fields.
    address: stockLocationAddressPatchSchema.nullish(),
    metadata: metadataInputSchema.optional(),
  })
  .superRefine((input, context) => {
    if (
      input.name === undefined &&
      input.address === undefined &&
      input.metadata === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Provide at least one stock location field to update",
      });
    }
    if (input.address && Object.keys(input.address).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["address"],
        message: "Provide at least one address field to update",
      });
    }
  });

export type UpdateStockLocationInput = z.infer<
  typeof updateStockLocationInputSchema
>;

export const deleteStockLocationsInputSchema = idsSchema("stock location");

export const setLocationSalesChannelsInputSchema = z.object({
  stockLocationId: idSchema("stock location"),
  salesChannelIds: z.array(idSchema("sales channel")).max(100),
});

const salesChannelIdsSchema = z
  .array(idSchema("sales channel"))
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Choose each sales channel only once",
  });

/** Matches Medusa's AdminBatchLink contract for stock location channels. */
export const batchStockLocationSalesChannelsInputSchema = z
  .object({
    add: salesChannelIdsSchema.default([]),
    remove: salesChannelIdsSchema.default([]),
  })
  .strict()
  .superRefine(({ add, remove }, context) => {
    const removed = new Set(remove);
    if (add.some((id) => removed.has(id))) {
      context.addIssue({
        code: "custom",
        path: ["add"],
        message: "A sales channel cannot be added and removed together",
      });
    }
  });

export const getLocationFulfillmentProvidersInputSchema = z.object({
  stockLocationId: idSchema("stock location"),
});

const fulfillmentProviderIdsSchema = z
  .array(z.string().trim().min(1).max(128))
  .max(80)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Choose each fulfillment provider only once",
  });

export const setLocationFulfillmentProvidersInputSchema = z.object({
  stockLocationId: idSchema("stock location"),
  fulfillmentProviderIds: fulfillmentProviderIdsSchema,
});

/** Matches Medusa's AdminBatchLink add/remove contract for stock locations. */
export const batchLocationFulfillmentProvidersInputSchema = z
  .object({
    add: fulfillmentProviderIdsSchema.default([]),
    remove: fulfillmentProviderIdsSchema.default([]),
  })
  .strict()
  .superRefine(({ add, remove }, context) => {
    const removed = new Set(remove);
    const overlap = add.find((id) => removed.has(id));
    if (overlap) {
      context.addIssue({
        code: "custom",
        path: ["add"],
        message: "A fulfillment provider cannot be added and removed together",
      });
    }
  });
