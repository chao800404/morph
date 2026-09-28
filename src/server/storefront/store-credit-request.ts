import { findCurrency, toMajorUnits } from "@/lib/currency/catalog";
import type {
  StoreCreditAccountDTO,
  StoreCreditTransactionDTO,
} from "@/lib/store-credit/dto/store-credit.dto";
import {
  claimStoreCreditAccountInputSchema,
  storeCreditTransactionsQuerySchema,
} from "@/lib/validations/store-credit";

export interface StoreCreditCustomer {
  id: string;
}

export type StoreCreditRequestDependencies = {
  resolveCustomer(request: Request): Promise<StoreCreditCustomer | null>;
  listForCustomer(customerId: string): Promise<StoreCreditAccountDTO[]>;
  listTransactions(input: {
    accountId: string;
    offset: number;
    limit: number;
  }): Promise<{ transactions: StoreCreditTransactionDTO[]; total: number }>;
  claim(input: { code: string; customerId: string }): Promise<{
    success: boolean;
    message: string;
    error?: string;
    data: { account: StoreCreditAccountDTO } | null;
  }>;
};

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "access-control-allow-headers":
        "content-type, x-publishable-api-key, x-storefront-host",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-origin": "*",
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      vary: "x-publishable-api-key, x-storefront-host",
    },
  });

const publicAccount = (account: StoreCreditAccountDTO) => {
  const currency = findCurrency(account.currencyCode) ?? { decimalDigits: 2 };
  return {
    id: account.id,
    currency_code: account.currencyCode,
    balance: toMajorUnits(account.balance, currency),
    total_credits: toMajorUnits(account.totalCredits, currency),
    total_debits: toMajorUnits(account.totalDebits, currency),
    created_at: account.createdAt.toISOString(),
    updated_at: account.updatedAt.toISOString(),
  };
};

const publicTransaction = (
  transaction: StoreCreditTransactionDTO,
  currencyCode: string,
) => ({
  id: transaction.id,
  type: transaction.type,
  amount: toMajorUnits(
    transaction.amount,
    findCurrency(currencyCode) ?? { decimalDigits: 2 },
  ),
  reference: transaction.reference,
  reference_id: transaction.referenceId,
  note: transaction.note,
  created_at: transaction.createdAt.toISOString(),
});

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const resultStatus = (error?: string) => {
  if (error === "INVALID_CODE") return 404;
  if (error === "ALREADY_CLAIMED") return 409;
  if (error === "INVALID_INPUT") return 400;
  return 500;
};

export async function handleStoreCreditRequest(
  method: "GET" | "POST",
  path: string,
  request: Request,
  deps: StoreCreditRequestDependencies,
): Promise<Response | null> {
  const listPath = "customers/me/store-credit-accounts";
  const claimPath = "store-credit-accounts/claim";
  const transactionMatch =
    /^customers\/me\/store-credit-accounts\/([^/]+)\/transactions$/.exec(path);
  if (
    !transactionMatch &&
    !(method === "GET" && path === listPath) &&
    !(method === "POST" && path === claimPath)
  )
    return null;

  const customer = await deps.resolveCustomer(request);
  if (!customer)
    return privateJson(
      {
        error: "UNAUTHORIZED",
        message: "A verified customer account is required",
      },
      401,
    );

  if (method === "GET" && path === listPath) {
    const accounts = await deps.listForCustomer(customer.id);
    return privateJson({ store_credit_accounts: accounts.map(publicAccount) });
  }

  if (method === "GET" && transactionMatch) {
    const accountId = transactionMatch[1];
    if (!accountId || !/^[0-9a-f-]{36}$/i.test(accountId))
      return privateJson({ error: "NOT_FOUND" }, 404);
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
    const account = (await deps.listForCustomer(customer.id)).find(
      (candidate) => candidate.id === accountId,
    );
    if (!account) return privateJson({ error: "NOT_FOUND" }, 404);
    const result = await deps.listTransactions({
      accountId,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    });
    return privateJson({
      transactions: result.transactions.map((transaction) =>
        publicTransaction(transaction, account.currencyCode),
      ),
      count: result.total,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    });
  }

  if (method === "POST" && path === claimPath) {
    const parsed = claimStoreCreditAccountInputSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid store credit claim code",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    const result = await deps.claim({
      code: parsed.data.code,
      customerId: customer.id,
    });
    if (!result.success || !result.data)
      return privateJson(
        { error: result.error, message: result.message },
        resultStatus(result.error),
      );
    return privateJson({
      store_credit_account: publicAccount(result.data.account),
    });
  }

  return privateJson({ error: "METHOD_NOT_ALLOWED" }, 405);
}
