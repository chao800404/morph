import { z } from "zod";
import { idSchema, listParamsSchema } from "./commerce";

const shippingProfileTypeSchema = z.enum(["gift_card", "custom"]);

export const listShippingProfilesInputSchema = listParamsSchema(
  ["name", "createdAt", "updatedAt"],
  { sortBy: "name", limit: 100 },
);

export const shippingProfileIdInputSchema = z.object({
  id: idSchema("shipping profile"),
});

export const createShippingProfileInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  type: shippingProfileTypeSchema,
});

export const updateShippingProfileInputSchema = z.object({
  id: idSchema("shipping profile"),
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  type: z.enum(["default", "gift_card", "custom"]).optional(),
}).refine((input) => input.name !== undefined || input.type !== undefined, {
  message: "Provide at least one field to update",
});

export const deleteShippingProfilesInputSchema = z.object({
  ids: z.array(idSchema("shipping profile")).length(1),
});
