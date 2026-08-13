import { z } from "zod";
import { metadataInputSchema } from "./product";

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);

export const listOrdersInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  sortBy: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page,
  limit,
});

export const createOrderInputSchema = z.object({
  email: z.email().optional().or(z.literal("")),
  currencyCode: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toLowerCase()),
  status: z.enum(["draft", "pending"]).default("draft"),
  noNotification: z.coerce.boolean().default(false),
  itemTitle: z.string().trim().max(200).optional().or(z.literal("")),
  itemSku: z.string().trim().max(100).optional().or(z.literal("")),
  quantity: z.coerce.number().int().min(1).default(1),
  unitPrice: z.coerce.number().min(0).default(0),
});

export const updateOrderInputSchema = z.object({
  id: z.uuid(),
  email: z.email().optional().or(z.literal("")),
  status: z.enum([
    "pending",
    "completed",
    "draft",
    "archived",
    "canceled",
    "requires_action",
  ]),
  noNotification: z.coerce.boolean().default(false),
});

export const listPromotionsInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  sortBy: z.enum(["code", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page,
  limit,
});

export const promotionInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((value) => value.toUpperCase()),
  type: z.enum(["standard", "buyget"]).default("standard"),
  status: z.enum(["draft", "active", "inactive"]).default("draft"),
  isAutomatic: z.coerce.boolean().default(false),
  isTaxInclusive: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).optional(),
  methodType: z.enum(["fixed", "percentage"]),
  targetType: z.enum(["order", "shipping_methods", "items"]),
  allocation: z.enum(["each", "across", "once"]).default("across"),
  value: z.coerce.number().min(0),
  currencyCode: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toLowerCase())
    .optional()
    .or(z.literal("")),
  maxQuantity: z.coerce.number().int().min(1).optional(),
  applyToQuantity: z.coerce.number().int().min(1).optional(),
  buyRulesMinQuantity: z.coerce.number().int().min(1).optional(),
  rules: z
    .array(
      z.object({
        attribute: z.string().trim().min(1),
        operator: z.enum(["gte", "lte", "gt", "lt", "eq", "ne", "in"]),
        values: z.array(z.string().trim().min(1)).min(1),
      }),
    )
    .default([]),
  targetRules: z
    .array(
      z.object({
        attribute: z.string().trim().min(1),
        operator: z.enum(["gte", "lte", "gt", "lt", "eq", "ne", "in"]),
        values: z.array(z.string().trim().min(1)).min(1),
      }),
    )
    .default([]),
  buyRules: z
    .array(
      z.object({
        attribute: z.string().trim().min(1),
        operator: z.enum(["gte", "lte", "gt", "lt", "eq", "ne", "in"]),
        values: z.array(z.string().trim().min(1)).min(1),
      }),
    )
    .default([]),
  campaignId: z.uuid().optional(),
  campaign: z
    .object({
      name: z.string().trim().min(1),
      description: z.string().trim().optional(),
      identifier: z.string().trim().min(1),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
      budgetType: z.enum([
        "spend",
        "usage",
        "use_by_attribute",
        "spend_by_attribute",
      ]),
      budgetLimit: z.coerce.number().min(0).optional(),
      budgetCurrencyCode: z.string().trim().length(3).optional(),
      budgetAttribute: z.string().trim().optional(),
    })
    .optional(),
});

export const createPromotionInputSchema = promotionInputSchema;
export const updatePromotionInputSchema = promotionInputSchema.extend({
  id: z.uuid(),
});
export const getMarketingRecordInputSchema = z.object({ id: z.uuid() });
export const updateMarketingMetadataInputSchema = z.object({
  id: z.uuid(),
  metadata: metadataInputSchema,
});

export const createOrderFulfillmentInputSchema = z.object({
  orderId: z.uuid(),
  locationId: z.uuid(),
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(100),
});

export const fulfillmentTransitionInputSchema = z.object({
  fulfillmentId: z.uuid(),
});

export const orderOperationInputSchema = z.object({ orderId: z.uuid() });

export const captureOrderPaymentInputSchema = orderOperationInputSchema.extend({
  amount: z.number().int().min(1).optional(),
});

export const refundOrderPaymentInputSchema = orderOperationInputSchema.extend({
  amount: z.number().int().min(1),
  reasonId: z.uuid().optional(),
  note: z.string().trim().max(1_000).optional(),
});
