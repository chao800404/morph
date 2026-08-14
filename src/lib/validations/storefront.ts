import { z } from "zod";
import { idSchema } from "./commerce";

export const storefrontPreferencesSchema = z
  .object({
    accessMode: z.enum(["private", "public"]).default("private"),
    seoTitle: z
      .string()
      .trim()
      .max(70, "Use 70 characters or fewer")
      .optional(),
    seoDescription: z
      .string()
      .trim()
      .max(320, "Use 320 characters or fewer")
      .optional(),
  })
  .catchall(z.json());

export const getStorefrontInputSchema = z.object({
  id: idSchema("storefront").optional(),
});

export const updateStorefrontInputSchema = z.object({
  id: idSchema("storefront"),
  name: z.string().trim().min(1, "Website name is required").max(100),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(320).optional(),
});

export const updateStorefrontAccessInputSchema = z.object({
  id: idSchema("storefront"),
  accessMode: z.enum(["private", "public"]),
});
