import { findCurrency, toMajorUnits } from "@/lib/currency/catalog";
import type { GiftCardDTO } from "@/lib/gift-card/dto/gift-card.dto";
import type { StoreCreditTransactionDTO } from "@/lib/store-credit/dto/store-credit.dto";
import type { GiftCardCreateResult } from "@/lib/gift-card/service/gift-card-write.service";
import type { ServerResult } from "@/lib/db/server-result";
import {
  adjustGiftCardInputSchema,
  giftCardTransactionsQuerySchema,
  listGiftCardsQuerySchema,
  setGiftCardStatusInputSchema,
} from "@/lib/validations/gift-card";
import { z } from "zod";
import type { AdminApiAccess } from "./orders";

export type AdminGiftCardDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  list(input: ReturnType<typeof listGiftCardsQuerySchema.parse>): Promise<{
    giftCards: GiftCardDTO[];
    total: number;
  }>;
  find(id: string): Promise<GiftCardDTO | null>;
  listTransactions(input: {
    accountId: string;
    offset: number;
    limit: number;
  }): Promise<{ transactions: StoreCreditTransactionDTO[]; total: number }>;
  create(input: {
    currencyCode: string;
    amount: string;
    expiresAt?: string | null;
    note?: string | null;
    createdBy: string;
  }): Promise<GiftCardCreateResult>;
  adjust(input: {
    id: string;
    type: "credit" | "debit";
    amount: string;
    note?: string | null;
    actorId: string;
    idempotencyKey: string;
  }): Promise<ServerResult<{ giftCard: GiftCardDTO }>>;
  setStatus(input: {
    id: string;
    status: "active" | "disabled";
    actorId: string;
  }): Promise<ServerResult<{ giftCard: GiftCardDTO }>>;
  updateDetails(input: {
    id: string;
    expiresAt?: string | null;
    note?: string | null;
    actorId: string;
  }): Promise<ServerResult<{ giftCard: GiftCardDTO }>>;
};

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const money = (amount: number, currencyCode: string) =>
  toMajorUnits(amount, findCurrency(currencyCode) ?? { decimalDigits: 2 });

const toGiftCard = (giftCard: GiftCardDTO) => ({
  id: giftCard.id,
  value: money(giftCard.initialValue, giftCard.currencyCode),
  balance: money(giftCard.balance, giftCard.currencyCode),
  total_credits: money(giftCard.totalCredits, giftCard.currencyCode),
  total_debits: money(giftCard.totalDebits, giftCard.currencyCode),
  currency_code: giftCard.currencyCode,
  status: giftCard.status,
  expires_at: giftCard.expiresAt,
  note: giftCard.note,
  created_at: giftCard.createdAt.toISOString(),
  updated_at: giftCard.updatedAt.toISOString(),
});

const toTransaction = (
  transaction: StoreCreditTransactionDTO,
  currencyCode: string,
) => ({
  id: transaction.id,
  gift_card_id: transaction.accountId,
  type: transaction.type,
  amount: money(transaction.amount, currencyCode),
  reference: transaction.reference,
  reference_id: transaction.referenceId,
  note: transaction.note,
  created_by: transaction.createdBy,
  created_at: transaction.createdAt.toISOString(),
});

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const parseId = (value: string | undefined) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value ?? "",
  );

const giftCardCreationBodySchema = z
  .object({
    currency_code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{3}$/),
    value: z
      .union([z.string().trim().max(16), z.number().finite()])
      .transform(String)
      .pipe(z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/)),
    expires_at: z.iso.datetime().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .transform((input) => ({
    currencyCode: input.currency_code,
    amount: input.value,
    expiresAt: input.expires_at,
    note: input.note,
  }));

const giftCardDetailsBodySchema = z
  .object({
    expires_at: z.iso.datetime().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine(
    (input) => input.expires_at !== undefined || input.note !== undefined,
    { message: "Update at least one gift card detail" },
  )
  .transform((input) => ({
    expiresAt: input.expires_at,
    note: input.note,
  }));

const failureStatus = (error?: string) => {
  if (error === "NOT_FOUND") return 404;
  if (
    error === "DISABLED" ||
    error === "INSUFFICIENT_BALANCE" ||
    error === "IDEMPOTENCY_CONFLICT" ||
    error === "CONFLICT"
  )
    return 409;
  if (
    error === "INVALID_CURRENCY" ||
    error === "INVALID_AMOUNT" ||
    error === "INVALID_EXPIRATION" ||
    error === "INVALID_INPUT"
  )
    return 400;
  return 500;
};

export async function handleAdminGiftCardsRequest(
  request: Request,
  path: string,
  deps: AdminGiftCardDependencies,
): Promise<Response> {
  const access = await deps.authorize(request);
  if (!access.allowed)
    return privateJson(
      { error: access.error, message: access.message },
      access.status,
    );
  const actorId = access.userId;

  if (path === "gift-cards") {
    if (request.method === "GET") {
      const parsed = listGiftCardsQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success)
        return privateJson(
          {
            error: "INVALID_REQUEST",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      const result = await deps.list(parsed.data);
      return privateJson({
        gift_cards: result.giftCards.map(toGiftCard),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    }
    if (request.method === "POST") {
      if (!actorId)
        return privateJson(
          {
            error: "UNAUTHORIZED",
            message: "An authenticated admin actor is required",
          },
          401,
        );
      const parsed = giftCardCreationBodySchema.safeParse(
        await readJson(request),
      );
      if (!parsed.success)
        return privateJson(
          {
            error: "INVALID_REQUEST",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      const result = await deps.create({ ...parsed.data, createdBy: actorId });
      if (!result.success)
        return privateJson(
          {
            error: result.error,
            message: result.message,
            details: result.errors,
          },
          failureStatus(result.error),
        );
      return privateJson(
        {
          gift_card: toGiftCard(result.data.giftCard),
          // The code is a bearer credential. It is returned once at issuance.
          code: result.data.code,
        },
        201,
      );
    }
    return privateJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const match = /^gift-cards\/([^/]+)(?:\/(transactions|status))?$/.exec(path);
  const id = match?.[1];
  if (!id || !parseId(id)) return privateJson({ error: "NOT_FOUND" }, 404);
  const transactionsRoute = match?.[2] === "transactions";
  const statusRoute = match?.[2] === "status";

  if (transactionsRoute && request.method === "GET") {
    const parsed = giftCardTransactionsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    const giftCard = await deps.find(id);
    if (!giftCard) return privateJson({ error: "NOT_FOUND" }, 404);
    const result = await deps.listTransactions({
      accountId: id,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    });
    return privateJson({
      transactions: result.transactions.map((transaction) =>
        toTransaction(transaction, giftCard.currencyCode),
      ),
      count: result.total,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    });
  }

  if (transactionsRoute && request.method === "POST") {
    if (!actorId)
      return privateJson(
        {
          error: "UNAUTHORIZED",
          message: "An authenticated admin actor is required",
        },
        401,
      );
    const parsed = adjustGiftCardInputSchema.safeParse(await readJson(request));
    if (!parsed.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200)
      return privateJson(
        {
          error: "IDEMPOTENCY_KEY_REQUIRED",
          message: "Provide an Idempotency-Key header for balance adjustments",
        },
        400,
      );
    const result = await deps.adjust({
      id,
      ...parsed.data,
      actorId,
      idempotencyKey,
    });
    if (!result.success)
      return privateJson(
        { error: result.error, message: result.message },
        failureStatus(result.error),
      );
    return privateJson({ gift_card: toGiftCard(result.data.giftCard) });
  }

  if (statusRoute && request.method === "PATCH") {
    if (!actorId)
      return privateJson(
        {
          error: "UNAUTHORIZED",
          message: "An authenticated admin actor is required",
        },
        401,
      );
    const parsed = setGiftCardStatusInputSchema
      .pick({ status: true })
      .safeParse(await readJson(request));
    if (!parsed.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    const result = await deps.setStatus({ id, ...parsed.data, actorId });
    if (!result.success)
      return privateJson(
        { error: result.error, message: result.message },
        failureStatus(result.error),
      );
    return privateJson({ gift_card: toGiftCard(result.data.giftCard) });
  }

  if (!transactionsRoute && !statusRoute && request.method === "PATCH") {
    if (!actorId)
      return privateJson(
        {
          error: "UNAUTHORIZED",
          message: "An authenticated admin actor is required",
        },
        401,
      );
    const parsed = giftCardDetailsBodySchema.safeParse(await readJson(request));
    if (!parsed.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    const result = await deps.updateDetails({
      id,
      ...parsed.data,
      actorId,
    });
    if (!result.success)
      return privateJson(
        { error: result.error, message: result.message },
        failureStatus(result.error),
      );
    return privateJson({ gift_card: toGiftCard(result.data.giftCard) });
  }

  if (!transactionsRoute && !statusRoute && request.method === "GET") {
    const giftCard = await deps.find(id);
    if (!giftCard) return privateJson({ error: "NOT_FOUND" }, 404);
    const transactions = await deps.listTransactions({
      accountId: id,
      offset: 0,
      limit: 20,
    });
    return privateJson({
      gift_card: toGiftCard(giftCard),
      transactions: transactions.transactions.map((transaction) =>
        toTransaction(transaction, giftCard.currencyCode),
      ),
    });
  }

  return privateJson({ error: "METHOD_NOT_ALLOWED" }, 405);
}
