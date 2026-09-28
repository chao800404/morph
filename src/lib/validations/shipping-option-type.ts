import { z } from "zod";
import { idSchema, listParamsSchema } from "./commerce";

const typeCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Code is required")
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, numbers, - or _");

const typeLabelSchema = z.string().trim().min(1, "Label is required").max(200);
const typeDescriptionSchema = z.string().trim().max(1000).nullable().optional();

export const listShippingOptionTypesInputSchema = listParamsSchema(
  ["label", "code", "createdAt", "updatedAt"],
  { sortBy: "label", limit: 100 },
);

export const shippingOptionTypeIdInputSchema = z.object({
  id: idSchema("shipping option type"),
});

export const createShippingOptionTypeInputSchema = z.object({
  label: typeLabelSchema,
  code: typeCodeSchema,
  description: typeDescriptionSchema,
});

export const updateShippingOptionTypeInputSchema = z
  .object({
    id: idSchema("shipping option type"),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    label: typeLabelSchema.optional(),
    code: typeCodeSchema.optional(),
    description: typeDescriptionSchema,
  })
  .refine(
    (input) =>
      input.label !== undefined ||
      input.code !== undefined ||
      input.description !== undefined,
    { message: "Provide at least one field to update" },
  );

export const deleteShippingOptionTypeInputSchema = z.object({
  id: idSchema("shipping option type"),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
});

export type ShippingOptionTypeListParams = z.infer<
  typeof listShippingOptionTypesInputSchema
>;
