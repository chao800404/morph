import { z } from "zod";
import { idSchema } from "./commerce";

export const storefrontReleaseHistoryInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const activateStorefrontReleaseInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  releaseId: z.string().uuid(),
  expectedActiveReleaseId: z.string().uuid().nullable(),
});
