import { z } from "zod";
import { idSchema, idsSchema, listParamsSchema } from "./commerce";
import { metadataInputSchema } from "./product";

export const listSalesChannelsInputSchema = listParamsSchema(
  ["name", "createdAt", "updatedAt"],
  { sortBy: "createdAt" },
);

export const getSalesChannelInputSchema = z.object({
  id: idSchema("sales channel"),
});

export const createSalesChannelInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(2000).nullish(),
  isDisabled: z.boolean().optional(),
});

export const updateSalesChannelInputSchema = z.object({
  id: idSchema("sales channel"),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  isDisabled: z.boolean().optional(),
  metadata: metadataInputSchema.optional(),
});

export const deleteSalesChannelsInputSchema = idsSchema("sales channel");

/**
 * Which channels list a product.
 *
 * The whole set is sent, not a delta: the editor shows every channel with a
 * checkbox, so what it knows is the final state. A delta would also have to
 * survive the author toggling the same box twice.
 */
export const setProductSalesChannelsInputSchema = z.object({
  productId: idSchema("product"),
  salesChannelIds: z.array(idSchema("sales channel")).max(100),
});

export const updateSalesChannelProductsInputSchema = z.object({
  salesChannelId: idSchema("sales channel"),
  productIds: z.array(idSchema("product")).min(1).max(100),
});
