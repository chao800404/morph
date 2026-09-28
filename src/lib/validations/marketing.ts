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

const draftOrderQuantitySchema = z.coerce.number().int().min(1).max(100_000);
const draftOrderAmountSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(2_147_483_647);

const draftOrderItemInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("variant"),
      variantId: z.uuid(),
      quantity: draftOrderQuantitySchema,
      customPrice: z.boolean().default(false),
      unitPrice: draftOrderAmountSchema.optional(),
      compareAtUnitPrice: draftOrderAmountSchema.optional(),
    })
    .superRefine((item, context) => {
      if (item.customPrice && item.unitPrice === undefined) {
        context.addIssue({
          code: "custom",
          path: ["unitPrice"],
          message: "A custom unit price is required",
        });
      }
    }),
  z.object({
    type: z.literal("custom"),
    title: z.string().trim().min(1).max(200),
    sku: z.string().trim().max(100).optional(),
    quantity: draftOrderQuantitySchema,
    unitPrice: draftOrderAmountSchema,
    compareAtUnitPrice: draftOrderAmountSchema.optional(),
  }),
]);
export type DraftOrderItemInput = z.infer<typeof draftOrderItemInputSchema>;

const orderAddressText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .default("")
    .transform((value) => value || null);

export const draftOrderAddressInputSchema = z
  .object({
    firstName: orderAddressText(100),
    lastName: orderAddressText(100),
    company: orderAddressText(200),
    address1: orderAddressText(300),
    address2: orderAddressText(300),
    city: orderAddressText(150),
    province: orderAddressText(150),
    postalCode: orderAddressText(40),
    countryCode: z
      .string()
      .trim()
      .max(2)
      .default("")
      .transform((value) => value.toLowerCase() || null),
    phone: orderAddressText(50),
  })
  .nullable();
export type DraftOrderAddressInput = z.infer<
  typeof draftOrderAddressInputSchema
>;

export const createOrderInputSchema = z.object({
  email: z.email().optional().or(z.literal("")),
  customerId: z.uuid().optional(),
  regionId: z.uuid().optional(),
  salesChannelId: z.uuid().optional(),
  shippingAddress: draftOrderAddressInputSchema,
  billingAddress: draftOrderAddressInputSchema,
  currencyCode: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toLowerCase()),
  noNotification: z.coerce.boolean().default(false),
  metadata: metadataInputSchema.optional(),
  items: z.array(draftOrderItemInputSchema).min(1).max(40),
});

export const updateDraftOrderItemsInputSchema = z
  .object({
    id: z.uuid(),
    expectedVersion: z.number().int().min(1),
    shippingAddress: draftOrderAddressInputSchema,
    billingAddress: draftOrderAddressInputSchema,
    shippingOptionIds: z
      .array(z.uuid())
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length)
      .default([]),
    shippingCustomAmounts: z
      .array(
        z
          .object({
            shippingOptionId: z.uuid(),
            amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(20)
      .refine(
        (amounts) =>
          new Set(amounts.map((amount) => amount.shippingOptionId)).size ===
          amounts.length,
      )
      .default([]),
    promotionCodes: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(100)
          .transform((code) => code.toUpperCase()),
      )
      .max(20)
      .refine((codes) => new Set(codes).size === codes.length)
      .default([]),
    email: z.email().optional().or(z.literal("")),
    noNotification: z.coerce.boolean().default(false),
    items: z.array(draftOrderItemInputSchema).min(1).max(40),
  })
  .superRefine((input, context) => {
    const selectedIds = new Set(input.shippingOptionIds);
    input.shippingCustomAmounts.forEach(({ shippingOptionId }, index) => {
      if (!selectedIds.has(shippingOptionId))
        context.addIssue({
          code: "custom",
          path: ["shippingCustomAmounts", index, "shippingOptionId"],
          message: "A custom amount requires a selected shipping option",
        });
    });
  });

export const listDraftShippingOptionsInputSchema = z.object({
  id: z.uuid(),
  expectedVersion: z.number().int().min(1),
});

export const updateOrderInputSchema = z.object({
  id: z.uuid(),
  email: z.email().optional().or(z.literal("")),
  noNotification: z.coerce.boolean().optional(),
});

export const convertDraftOrderInputSchema = z.object({ id: z.uuid() });

export const listPromotionsInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  campaignId: z.uuid().optional(),
  unassigned: z.coerce.boolean().default(false),
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
      z
        .object({
          id: z.uuid().optional(),
          description: z.string().trim().max(500).optional(),
          attribute: z.string().trim().min(1).max(200),
          operator: z.enum(["gte", "lte", "gt", "lt", "eq", "ne", "in"]),
          values: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
        })
        .strict(),
    )
    .max(20)
    .default([]),
  targetRules: z
    .array(
      z
        .object({
          id: z.uuid().optional(),
          description: z.string().trim().max(500).optional(),
          attribute: z.string().trim().min(1).max(200),
          operator: z.enum(["gte", "lte", "gt", "lt", "eq", "ne", "in"]),
          values: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
        })
        .strict(),
    )
    .max(20)
    .default([]),
  buyRules: z
    .array(
      z
        .object({
          id: z.uuid().optional(),
          description: z.string().trim().max(500).optional(),
          attribute: z.string().trim().min(1).max(200),
          operator: z.enum(["gte", "lte", "gt", "lt", "eq", "ne", "in"]),
          values: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
        })
        .strict(),
    )
    .max(20)
    .default([]),
  campaignId: z.uuid().optional(),
  campaign: z
    .object({
      name: z.string().trim().min(1),
      description: z.string().trim().optional(),
      identifier: z.string().trim().min(1),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
      budgetType: z
        .enum(["spend", "usage", "use_by_attribute", "spend_by_attribute"])
        .optional(),
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

export const orderReturnListInputSchema = z.object({
  orderId: z.uuid(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
});

export const createOrderReturnInputSchema = z.object({
  orderId: z.uuid(),
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        quantity: z.number().int().min(1),
        reasonId: z.uuid().optional(),
        note: z.string().trim().max(1_000).optional(),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => item.itemId)).size === items.length,
      "An order item can only appear once in a return",
    ),
});

export const createOrderReplacementClaimInputSchema = z
  .object({
    orderId: z.uuid(),
    locationId: z.uuid(),
    sendNotification: z.boolean().default(false),
    returnShipping: z
      .object({
        name: z.string().trim().min(1).max(200),
        amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      })
      .optional(),
    outboundShipping: z
      .object({
        name: z.string().trim().min(1).max(200),
        amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      })
      .optional(),
    items: z
      .array(
        z.object({
          itemId: z.uuid(),
          quantity: z.number().int().min(1),
          reason: z.enum(["production_failure", "other"]),
          note: z.string().trim().max(1_000).optional(),
        }),
      )
      .max(50)
      .default([])
      .refine(
        (items) =>
          new Set(items.map((item) => item.itemId)).size === items.length,
        "An order item can only appear once in a claim",
      ),
    outboundItems: z
      .array(
        z.object({
          variantId: z.uuid(),
          quantity: z.number().int().min(1),
          note: z.string().trim().max(1_000).optional(),
        }),
      )
      .min(1)
      .max(25),
  })
  .superRefine((input, context) => {
    if (input.returnShipping && input.items.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["returnShipping"],
        message: "Return shipping requires at least one inbound item",
      });
    }
  });

export const createOrderRefundClaimInputSchema = z.object({
  orderId: z.uuid(),
  locationId: z.uuid().optional(),
  returnItems: z.boolean().default(true),
  sendNotification: z.boolean().default(false),
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        quantity: z.number().int().min(1),
        reason: z.enum([
          "missing_item",
          "wrong_item",
          "production_failure",
          "other",
        ]),
        note: z.string().trim().max(1_000).optional(),
      }),
    )
    .min(1)
    .max(50)
    .refine(
      (items) =>
        new Set(items.map((item) => item.itemId)).size === items.length,
      "An order item can only appear once in a claim",
    ),
});

export const createOrderExchangeInputSchema = z.object({
  orderId: z.uuid(),
  locationId: z.uuid(),
  allowBackorder: z.boolean().default(false),
  carryOverPromotions: z.boolean().default(false),
  sendNotification: z.boolean().default(false),
  returnShipping: z
    .object({
      name: z.string().trim().min(1).max(200),
      amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .optional(),
  outboundShipping: z
    .object({
      name: z.string().trim().min(1).max(200),
      amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .optional(),
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        variantId: z.uuid(),
        quantity: z.number().int().min(1),
        note: z.string().trim().max(1_000).optional(),
      }),
    )
    .min(1)
    .max(25)
    .refine(
      (items) =>
        new Set(items.map((item) => item.itemId)).size === items.length,
      "An order item can only appear once in an exchange",
    ),
});

export const orderExchangeOperationInputSchema = z.object({
  exchangeId: z.uuid(),
});

export const searchOrderExchangeVariantsInputSchema = z.object({
  orderId: z.uuid(),
  query: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchDraftOrderVariantsInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  currencyCode: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toLowerCase()),
  quantity: draftOrderQuantitySchema.default(1),
  customerId: z.uuid().optional(),
  regionId: z.uuid().optional(),
  salesChannelId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const receiveOrderReturnInputSchema = z.object({
  returnId: z.uuid(),
  locationId: z.uuid(),
  items: z
    .array(
      z.object({
        returnItemId: z.uuid(),
        quantity: z.number().int().min(1),
        damagedQuantity: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => item.returnItemId)).size === items.length,
      "A return item can only be received once per operation",
    )
    .refine(
      (items) => items.every((item) => item.damagedQuantity <= item.quantity),
      "Damaged quantity cannot exceed received quantity",
    ),
});

export const orderReturnOperationInputSchema = z.object({ returnId: z.uuid() });
