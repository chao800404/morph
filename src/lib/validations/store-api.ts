import { z } from "zod";

export const storeProductListParamsSchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const storeContextParamsSchema = z.object({
  regionId: z.uuid().optional(),
  countryCode: z.string().trim().length(2).optional(),
});

export const productHandleSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid product handle");
