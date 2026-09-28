import { findCurrency, toMajorUnits } from "@/lib/currency/catalog";
import type {
  StoreCreditAccountDTO,
  StoreCreditTransactionDTO,
} from "@/lib/store-credit/dto/store-credit.dto";
import type { StoreCreditCreateResult } from "@/lib/store-credit/service/store-credit-write.service";
import type { ServerResult } from "@/lib/db/server-result";
import type { Metadata } from "@/db/json";
import { z } from "zod";
import {
  adjustStoreCreditInputSchema,
  listStoreCreditAccountsQuerySchema,
  storeCreditTransactionsQuerySchema,
} from "@/lib/validations/store-credit";
import type { AdminApiAccess } from "./orders";

export type AdminStoreCreditDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listAccounts(
    input: ReturnType<typeof listStoreCreditAccountsQuerySchema.parse>,
  ): Promise<{
    accounts: StoreCreditAccountDTO[];
    total: number;
  }>;
  findAccount(id: string): Promise<StoreCreditAccountDTO | null>;
  listTransactions(input: {
    accountId: string;
    offset: number;
    limit: number;
  }): Promise<{ transactions: StoreCreditTransactionDTO[]; total: number }>;
  createAccount(input: {
    customerId?: string | null;
    currencyCode: string;
    metadata?: Metadata;
    createdBy: string;
  }): Promise<StoreCreditCreateResult>;
  adjust(input: {
    id: string;
    type: "credit" | "debit";
    amount: string;
    note?: string | null;
    actorId: string;
    idempotencyKey: string;
  }): Promise<ServerResult<{ account: StoreCreditAccountDTO }>>;
  setStatus(input: {
    id: string;
    status: "active" | "disabled";
    actorId: string;
  }): Promise<ServerResult<{ account: StoreCreditAccountDTO }>>;
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

const toAccount = (account: StoreCreditAccountDTO) => {
  const currency = findCurrency(account.currencyCode);
  const amount = (value: number) =>
    toMajorUnits(value, currency ?? { decimalDigits: 2 });
  return {
    id: account.id,
    customer_id: account.customerId,
    customer_email: account.customerEmail,
    customer_name: account.customerName,
    currency_code: account.currencyCode,
    status: account.status,
    balance: amount(account.balance),
    total_credits: amount(account.totalCredits),
    total_debits: amount(account.totalDebits),
    created_at: account.createdAt.toISOString(),
    updated_at: account.updatedAt.toISOString(),
  };
};

const toTransaction = (
  transaction: StoreCreditTransactionDTO,
  currencyCode: string,
) => ({
  id: transaction.id,
  account_id: transaction.accountId,
  type: transaction.type,
  amount: toMajorUnits(
    transaction.amount,
    findCurrency(currencyCode) ?? { decimalDigits: 2 },
  ),
  reference: transaction.reference,
  reference_id: transaction.referenceId,
  note: transaction.note,
  created_by: transaction.createdBy,
  created_at: transaction.createdAt.toISOString(),
});

const failureStatus = (error?: string) => {
  if (error === "NOT_FOUND" || error === "CUSTOMER_NOT_FOUND") return 404;
  if (
    error === "DISABLED" ||
    error === "INSUFFICIENT_BALANCE" ||
    error === "IDEMPOTENCY_CONFLICT"
  )
    return 409;
  if (
    error === "INVALID_CURRENCY" ||
    error === "INVALID_AMOUNT" ||
    error === "INVALID_INPUT"
  )
    return 400;
  return 500;
};

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const createStoreCreditAccountBodySchema = z
  .object({
    customer_id: z.uuid().nullable().optional(),
    currency_code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{3}$/),
    metadata: z.object({}).catchall(z.json()).optional(),
  })
  .strict()
  .transform((input) => ({
    customerId: input.customer_id,
    currencyCode: input.currency_code,
    metadata: input.metadata ?? {},
  }));

const setStoreCreditAccountStatusBodySchema = z
  .object({ status: z.enum(["active", "disabled"]) })
  .strict();

const parseId = (value: string | undefined) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value ?? "",
  );

export async function handleAdminStoreCreditAccountsRequest(
  request: Request,
  path: string,
  deps: AdminStoreCreditDependencies,
): Promise<Response> {
  const access = await deps.authorize(request);
  if (!access.allowed)
    return privateJson(
      { error: access.error, message: access.message },
      access.status,
    );
  const actorId = access.userId;

  if (path === "store-credit-accounts") {
    if (request.method === "GET") {
      const parsed = listStoreCreditAccountsQuerySchema.safeParse(
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
      const result = await deps.listAccounts(parsed.data);
      return privateJson({
        store_credit_accounts: result.accounts.map(toAccount),
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
      const parsed = createStoreCreditAccountBodySchema.safeParse(
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
      const result = await deps.createAccount({
        ...parsed.data,
        createdBy: actorId,
      });
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
          store_credit_account: toAccount(result.data.account),
          // The code is a claim credential. It is returned once and never stored
          // or included in account/transaction read responses.
          claim_code: result.data.claimCode,
        },
        201,
      );
    }
    return privateJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const match = /^store-credit-accounts\/([^/]+)(?:\/(transactions))?$/.exec(
    path,
  );
  const id = match?.[1];
  if (!id || !parseId(id)) return privateJson({ error: "NOT_FOUND" }, 404);
  const transactionsRoute = match?.[2] === "transactions";

  if (transactionsRoute && request.method === "GET") {
    const parsed = storeCreditTransactionsQuerySchema.safeParse(
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
    const account = await deps.findAccount(id);
    if (!account) return privateJson({ error: "NOT_FOUND" }, 404);
    const result = await deps.listTransactions({
      accountId: id,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    });
    return privateJson({
      transactions: result.transactions.map((transaction) =>
        toTransaction(transaction, account.currencyCode),
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
    const parsed = adjustStoreCreditInputSchema.safeParse(
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
    return privateJson({
      store_credit_account: toAccount(result.data.account),
    });
  }

  if (!transactionsRoute && request.method === "PATCH") {
    if (!actorId)
      return privateJson(
        {
          error: "UNAUTHORIZED",
          message: "An authenticated admin actor is required",
        },
        401,
      );
    const parsed = setStoreCreditAccountStatusBodySchema.safeParse(
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
    const result = await deps.setStatus({
      id,
      ...parsed.data,
      actorId,
    });
    if (!result.success)
      return privateJson(
        { error: result.error, message: result.message },
        failureStatus(result.error),
      );
    return privateJson({
      store_credit_account: toAccount(result.data.account),
    });
  }

  if (!transactionsRoute && request.method === "GET") {
    const account = await deps.findAccount(id);
    if (!account) return privateJson({ error: "NOT_FOUND" }, 404);
    const transactions = await deps.listTransactions({
      accountId: id,
      offset: 0,
      limit: 20,
    });
    return privateJson({
      store_credit_account: toAccount(account),
      transactions: transactions.transactions.map((transaction) =>
        toTransaction(transaction, account.currencyCode),
      ),
    });
  }

  return privateJson({ error: "METHOD_NOT_ALLOWED" }, 405);
}
