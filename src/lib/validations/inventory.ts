import { z } from "zod";
import { metadataInputSchema } from "./product";

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

const inventoryLocationLevelInputSchema = z.object({
  locationId: z.uuid("Invalid stock location ID"),
  stockedQuantity: z.number().finite().min(0).max(1_000_000_000),
  incomingQuantity: z.number().finite().min(0).max(1_000_000_000).optional(),
});

export const listInventoryInputSchema = z.object({
  query: z.string().trim().max(200).nullish(),
  sortBy: z.enum(["name", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const inventoryItemFieldsInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  sku: nullableText(100).optional(),
  description: nullableText(5000).optional(),
  thumbnail: nullableText(2000).optional(),
  unitOfMeasure: nullableText(100).optional(),
  requiresShipping: z.boolean().optional(),
  weight: z.number().finite().min(0).max(1_000_000).nullish(),
  length: z.number().finite().min(0).max(1_000_000).nullish(),
  height: z.number().finite().min(0).max(1_000_000).nullish(),
  width: z.number().finite().min(0).max(1_000_000).nullish(),
  originCountry: z
    .string()
    .trim()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toLowerCase())
    .nullable()
    .optional(),
  hsCode: nullableText(100).optional(),
  midCode: nullableText(100).optional(),
  material: nullableText(200).optional(),
  metadata: metadataInputSchema.optional(),
});

export const createInventoryItemInputSchema = inventoryItemFieldsInputSchema
  .extend({
    title: z.string().trim().min(1).max(200),
    unitOfMeasure: nullableText(100).default(null),
    requiresShipping: z.boolean().default(true),
    weight: z.number().finite().min(0).max(1_000_000).nullable().default(null),
    length: z.number().finite().min(0).max(1_000_000).nullable().default(null),
    height: z.number().finite().min(0).max(1_000_000).nullable().default(null),
    width: z.number().finite().min(0).max(1_000_000).nullable().default(null),
    locationLevels: z
      .array(inventoryLocationLevelInputSchema)
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = input.locationLevels.map((level) => level.locationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["locationLevels"],
        message: "A location can only appear once",
      });
    }
  });

export const updateInventoryItemInputSchema = inventoryItemFieldsInputSchema
  .extend({ id: z.uuid("Invalid inventory item ID") })
  .strict()
  .refine(
    ({ id: _id, ...fields }) =>
      Object.values(fields).some((value) => value !== undefined),
    "Provide at least one inventory item field to update",
  );

export const setInventoryLocationLevelsInputSchema = z
  .object({
    inventoryItemId: z.uuid("Invalid inventory item ID"),
    locationLevels: z.array(inventoryLocationLevelInputSchema).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = input.locationLevels.map((level) => level.locationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["locationLevels"],
        message: "A location can only appear once",
      });
    }
  });

export const removeInventoryLocationLevelsInputSchema = z
  .object({
    inventoryItemId: z.uuid("Invalid inventory item ID"),
    locationIds: z.array(z.uuid("Invalid stock location ID")).min(1).max(100),
  })
  .strict()
  .refine(
    ({ locationIds }) => new Set(locationIds).size === locationIds.length,
    "A stock location can only appear once",
  );

export const inventoryItemIdInputSchema = z.object({
  id: z.uuid("Invalid inventory item ID"),
});

const reservationFieldsSchema = z.object({
  quantity: z.number().finite().gt(0).max(1_000_000_000),
  allowBackorder: z.boolean().optional(),
  description: nullableText(2000),
  externalId: nullableText(200),
  metadata: metadataInputSchema.optional(),
});

export const listReservationsInputSchema = z.object({
  query: z.string().trim().max(200).nullish(),
  inventoryItemId: z.uuid().nullish(),
  locationId: z.uuid().nullish(),
  manualOnly: z.boolean().default(false),
  sortBy: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const createManualReservationInputSchema = reservationFieldsSchema
  .extend({
    inventoryItemId: z.uuid("Invalid inventory item ID"),
    locationId: z.uuid("Invalid stock location ID"),
    allowBackorder: z.boolean().default(false),
  })
  .strict();

export const updateManualReservationInputSchema = reservationFieldsSchema
  .partial()
  .extend({ id: z.uuid("Invalid reservation ID") })
  .strict()
  .refine(
    ({ id: _id, ...fields }) =>
      Object.values(fields).some((value) => value !== undefined),
    "Provide at least one reservation field to update",
  );

export const reservationIdInputSchema = z.object({
  id: z.uuid("Invalid reservation ID"),
});
