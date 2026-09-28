import { z } from "zod";

export const createGiftCardInputSchema = z
  .object({
    currencyCode: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{3}$/),
    amount: z
      .string()
      .trim()
      .max(16)
      .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/),
    expiresAt: z.iso.datetime().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const adjustGiftCardInputSchema = z
  .object({
    type: z.enum(["credit", "debit"]),
    amount: z
      .string()
      .trim()
      .max(16)
      .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const setGiftCardStatusInputSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(["active", "disabled"]),
  })
  .strict();

export const giftCardIdInputSchema = z.object({ id: z.uuid() }).strict();

export const updateGiftCardDetailsInputSchema = giftCardIdInputSchema
  .extend({
    expiresAt: z.iso.datetime().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine(
    (input) => input.expiresAt !== undefined || input.note !== undefined,
    { message: "Update at least one gift card detail" },
  );

export const listGiftCardsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    currency_code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{3}$/)
      .optional(),
    status: z.enum(["active", "disabled"]).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum(["created_at", "-created_at", "balance", "-balance"])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q,
    currencyCode: input.currency_code,
    status: input.status,
    offset: input.offset,
    limit: input.limit,
    sortBy: input.order.includes("balance")
      ? ("balance" as const)
      : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

export const giftCardTransactionsQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const applyGiftCardToCartInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(20)
      .max(80)
      .regex(/^GIFT-(?:[23456789A-HJ-NP-Z]{4}-){4}[23456789A-HJ-NP-Z]{4}$/i),
  })
  .strict();
