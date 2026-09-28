import { z } from "zod";

const metadataSchema = z.object({}).catchall(z.json()).default({});

export const createStoreCreditAccountInputSchema = z
  .object({
    customerId: z.uuid().nullable().optional(),
    currencyCode: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{3}$/),
    metadata: metadataSchema,
  })
  .strict();

export const adjustStoreCreditInputSchema = z
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

export const setStoreCreditAccountStatusInputSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(["active", "disabled"]),
  })
  .strict();

export const claimStoreCreditAccountInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

export const applyStoreCartCreditInputSchema = z
  .object({ accountId: z.uuid() })
  .strict();

export const listStoreCreditAccountsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    customer_id: z.uuid().optional(),
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
    customerId: input.customer_id,
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

export const storeCreditTransactionsQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
