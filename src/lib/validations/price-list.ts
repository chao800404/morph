import { z } from "zod";
import { metadataInputSchema } from "./product";

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const uniqueGroupIds = z
  .array(z.uuid())
  .max(100)
  .refine(
    (values) => new Set(values).size === values.length,
    "Customer groups must be unique",
  );
const groupIds = uniqueGroupIds.default([]);
const uniqueRegionIds = z
  .array(z.uuid())
  .max(100)
  .refine(
    (values) => new Set(values).size === values.length,
    "Regions must be unique",
  );
const regionIds = uniqueRegionIds.default([]);

const schedule = z.object({
  startsAt: z.string().trim().optional().or(z.literal("")).default(""),
  endsAt: z.string().trim().optional().or(z.literal("")).default(""),
});

const priceListFields = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).default(""),
    status: z.enum(["draft", "active"]).default("draft"),
    type: z.enum(["sale", "override"]).default("sale"),
    startsAt: schedule.shape.startsAt,
    endsAt: schedule.shape.endsAt,
    customerGroupIds: groupIds,
    regionIds,
    metadata: metadataInputSchema.default({}),
  })
  .superRefine((data, ctx) => {
    const parseDate = (value: string) =>
      value ? new Date(value).getTime() : null;
    const startsAt = parseDate(data.startsAt);
    const endsAt = parseDate(data.endsAt);
    if (startsAt !== null && !Number.isFinite(startsAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "Invalid start date",
      });
    }
    if (endsAt !== null && !Number.isFinite(endsAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "Invalid end date",
      });
    }
    if (startsAt !== null && endsAt !== null && startsAt > endsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "End date must be after the start date",
      });
    }
  });

export const listPriceListsInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(["draft", "active"]).optional(),
  type: z.enum(["sale", "override"]).optional(),
  sortBy: z.enum(["title", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page,
  limit,
});

export const priceListIdInputSchema = z.object({ id: z.uuid() });

export const createPriceListInputSchema = priceListFields;
export const updatePriceListInputSchema = priceListFields.safeExtend({
  id: z.uuid(),
});
export const updatePriceListPatchInputSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).optional(),
    status: z.enum(["draft", "active"]).optional(),
    type: z.enum(["sale", "override"]).optional(),
    startsAt: z.string().trim().optional(),
    endsAt: z.string().trim().optional(),
    customerGroupIds: uniqueGroupIds.optional(),
    regionIds: uniqueRegionIds.optional(),
    metadata: metadataInputSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const startsAt = data.startsAt ? new Date(data.startsAt).getTime() : null;
    const endsAt = data.endsAt ? new Date(data.endsAt).getTime() : null;
    if (startsAt !== null && !Number.isFinite(startsAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "Invalid start date",
      });
    }
    if (endsAt !== null && !Number.isFinite(endsAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "Invalid end date",
      });
    }
    if (startsAt !== null && endsAt !== null && startsAt > endsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "End date must be after the start date",
      });
    }
  });

export const listPriceListPricesInputSchema = z.object({
  priceListId: z.uuid(),
  query: z.string().trim().max(200).optional(),
  sortBy: z.enum(["product", "amount", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page,
  limit,
});

export const searchPriceListVariantsInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const savePriceListPriceInputSchema = z
  .object({
    priceListId: z.uuid(),
    variantId: z.uuid(),
    currencyCode: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toLowerCase()),
    amount: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    minQuantity: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    ),
    maxQuantity: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    ),
  })
  .superRefine((value, context) => {
    if (value.maxQuantity !== undefined && value.minQuantity === undefined) {
      context.addIssue({
        code: "custom",
        path: ["minQuantity"],
        message: "Minimum quantity is required when maximum quantity is set",
      });
    }
    if (
      value.minQuantity !== undefined &&
      value.maxQuantity !== undefined &&
      value.maxQuantity < value.minQuantity
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxQuantity"],
        message:
          "Maximum quantity must be greater than or equal to minimum quantity",
      });
    }
  });

export const priceListPriceIdInputSchema = z.object({
  priceListId: z.uuid(),
  priceId: z.uuid(),
});

const priceCurrencyCode = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toLowerCase());
const priceQuantity = z.coerce
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
const createPriceQuantity = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  priceQuantity.optional(),
);
const updatePriceQuantity = z.preprocess(
  (value) => (value === "" ? null : value),
  z.union([priceQuantity, z.null()]).optional(),
);

const validatePriceQuantityRange = (
  value: { minQuantity?: number | null; maxQuantity?: number | null },
  context: z.RefinementCtx,
) => {
  if (
    typeof value.minQuantity === "number" &&
    typeof value.maxQuantity === "number" &&
    value.maxQuantity < value.minQuantity
  ) {
    context.addIssue({
      code: "custom",
      path: ["maxQuantity"],
      message:
        "Maximum quantity must be greater than or equal to minimum quantity",
    });
  }
};

export const batchPriceCreateInputSchema = z
  .object({
    variantId: z.uuid(),
    currencyCode: priceCurrencyCode,
    amount: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    minQuantity: createPriceQuantity,
    maxQuantity: createPriceQuantity,
  })
  .strict()
  .superRefine((value, context) => {
    validatePriceQuantityRange(value, context);
    if (value.maxQuantity !== undefined && value.minQuantity === undefined) {
      context.addIssue({
        code: "custom",
        path: ["minQuantity"],
        message: "Minimum quantity is required when maximum quantity is set",
      });
    }
  });

export const batchPriceUpdateInputSchema = z
  .object({
    id: z.uuid(),
    variantId: z.uuid().optional(),
    currencyCode: priceCurrencyCode.optional(),
    amount: z.coerce
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    minQuantity: updatePriceQuantity,
    maxQuantity: updatePriceQuantity,
  })
  .strict()
  .superRefine((value, context) => {
    validatePriceQuantityRange(value, context);
    if (
      value.variantId === undefined &&
      value.currencyCode === undefined &&
      value.amount === undefined &&
      value.minQuantity === undefined &&
      value.maxQuantity === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "At least one price field must be updated",
      });
    }
    if (
      typeof value.minQuantity === "number" &&
      typeof value.maxQuantity === "number" &&
      value.maxQuantity < value.minQuantity
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxQuantity"],
        message:
          "Maximum quantity must be greater than or equal to minimum quantity",
      });
    }
  });

export type BatchPriceCreateInput = z.infer<typeof batchPriceCreateInputSchema>;
export type BatchPriceUpdateInput = z.infer<typeof batchPriceUpdateInputSchema>;
export type BatchPriceListPricesInput = z.infer<
  typeof batchPriceListPricesInputSchema
>;

export const batchPriceListPricesInputSchema = z
  .object({
    create: z.array(batchPriceCreateInputSchema).max(80).default([]),
    update: z.array(batchPriceUpdateInputSchema).max(80).default([]),
    delete: z.array(z.uuid()).max(80).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const total =
      value.create.length + value.update.length + value.delete.length;
    if (total > 80) {
      context.addIssue({
        code: "custom",
        message: "A price batch can contain at most 80 operations",
      });
    }
    const updateIds = value.update.map((price) => price.id);
    if (new Set(updateIds).size !== updateIds.length) {
      context.addIssue({
        code: "custom",
        path: ["update"],
        message: "A price can only be updated once per batch",
      });
    }
    if (new Set(value.delete).size !== value.delete.length) {
      context.addIssue({
        code: "custom",
        path: ["delete"],
        message: "A price can only be deleted once per batch",
      });
    }
    if (value.delete.some((id) => updateIds.includes(id))) {
      context.addIssue({
        code: "custom",
        path: ["delete"],
        message: "A price cannot be updated and deleted in the same batch",
      });
    }
  });
