import { getDb } from "@/db";
import type { Metadata } from "@/db/json";
import { firstOrNull } from "@/lib/db/single-row";
import { customers } from "@/db/customer.schema";
import {
  storeCreditAccounts,
  storeCreditTransactions,
} from "@/db/store-credit.schema";
import { databaseErrorMessage } from "@/lib/order/database-error";
import { and, asc, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { likeContains } from "@/lib/db/like-query";
import type {
  StoreCreditAccountDTO,
  StoreCreditTransactionDTO,
} from "../dto/store-credit.dto";

const toTransactionDTO = (
  row: typeof storeCreditTransactions.$inferSelect,
): StoreCreditTransactionDTO => ({
  id: row.id,
  accountId: row.accountId,
  type: row.type,
  amount: row.amount,
  reference: row.reference,
  referenceId: row.referenceId,
  note: row.note,
  createdBy: row.createdBy,
  createdAt: new Date(row.createdAt),
});

const mapAccount = (row: {
  account: typeof storeCreditAccounts.$inferSelect;
  customer: typeof customers.$inferSelect | null;
  totalCredits: number;
  totalDebits: number;
}): StoreCreditAccountDTO => ({
  id: row.account.id,
  customerId: row.account.customerId,
  customerEmail: row.customer?.email ?? null,
  customerName:
    [row.customer?.firstName, row.customer?.lastName]
      .filter(Boolean)
      .join(" ") || null,
  currencyCode: row.account.currencyCode,
  status: row.account.status,
  balance: row.account.balance,
  totalCredits: Number(row.totalCredits),
  totalDebits: Number(row.totalDebits),
  createdAt: new Date(row.account.createdAt),
  updatedAt: new Date(row.account.updatedAt),
});

type AccountPageInput = {
  query?: string;
  customerId?: string;
  currencyCode?: string;
  status?: "active" | "disabled";
  sortBy: "createdAt" | "balance";
  sortOrder: "asc" | "desc";
  offset: number;
  limit: number;
};

const transactionTotals = sql<number>`
  coalesce(sum(case when ${storeCreditTransactions.type} = 'credit' then ${storeCreditTransactions.amount} else 0 end), 0)
`;
const transactionDebits = sql<number>`
  coalesce(sum(case when ${storeCreditTransactions.type} = 'debit' then ${storeCreditTransactions.amount} else 0 end), 0)
`;
const notGiftCardCondition = sql`coalesce(json_extract(${storeCreditAccounts.metadata}, '$._morph_resource_type'), '') <> 'gift_card'`;

const balanceCheckFailure = (error: unknown) => {
  const message = databaseErrorMessage(error);
  return message.includes("store_credit_accounts_balance_nonnegative");
};

export const storeCreditDal = {
  async listPage(input: AccountPageInput): Promise<{
    accounts: StoreCreditAccountDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions = [
      isNull(storeCreditAccounts.deletedAt),
      notGiftCardCondition,
    ];
    if (input.customerId)
      conditions.push(eq(storeCreditAccounts.customerId, input.customerId));
    if (input.currencyCode)
      conditions.push(eq(storeCreditAccounts.currencyCode, input.currencyCode));
    if (input.status)
      conditions.push(eq(storeCreditAccounts.status, input.status));
    if (input.query?.trim()) {
      const query = input.query.trim();
      conditions.push(
        or(
          likeContains(storeCreditAccounts.id, query),
          likeContains(customers.email, query),
          likeContains(customers.firstName, query),
          likeContains(customers.lastName, query),
        )!,
      );
    }
    const where = and(...conditions);
    const sortColumn =
      input.sortBy === "balance"
        ? storeCreditAccounts.balance
        : storeCreditAccounts.createdAt;
    const [countRows, rows] = await Promise.all([
      db
        .select({ value: count() })
        .from(storeCreditAccounts)
        .leftJoin(
          customers,
          and(
            eq(customers.id, storeCreditAccounts.customerId),
            isNull(customers.deletedAt),
          ),
        )
        .where(where),
      db
        .select({
          account: storeCreditAccounts,
          customer: customers,
          totalCredits: transactionTotals,
          totalDebits: transactionDebits,
        })
        .from(storeCreditAccounts)
        .leftJoin(
          customers,
          and(
            eq(customers.id, storeCreditAccounts.customerId),
            isNull(customers.deletedAt),
          ),
        )
        .leftJoin(
          storeCreditTransactions,
          eq(storeCreditTransactions.accountId, storeCreditAccounts.id),
        )
        .where(where)
        .groupBy(storeCreditAccounts.id)
        .orderBy(input.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn))
        .limit(input.limit)
        .offset(input.offset),
    ]);
    return {
      accounts: rows.map(mapAccount),
      total: Number(firstOrNull(countRows)?.value ?? 0),
    };
  },

  async findById(id: string): Promise<StoreCreditAccountDTO | null> {
    const db = await getDb();
    const [row] = await db
      .select({
        account: storeCreditAccounts,
        customer: customers,
        totalCredits: transactionTotals,
        totalDebits: transactionDebits,
      })
      .from(storeCreditAccounts)
      .leftJoin(
        customers,
        and(
          eq(customers.id, storeCreditAccounts.customerId),
          isNull(customers.deletedAt),
        ),
      )
      .leftJoin(
        storeCreditTransactions,
        eq(storeCreditTransactions.accountId, storeCreditAccounts.id),
      )
      .where(
        and(
          eq(storeCreditAccounts.id, id),
          isNull(storeCreditAccounts.deletedAt),
          notGiftCardCondition,
        ),
      )
      .groupBy(storeCreditAccounts.id)
      .limit(1);
    return row ? mapAccount(row) : null;
  },

  async setStatus(input: {
    id: string;
    status: "active" | "disabled";
    updatedBy: string;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const rows = await db
      .update(storeCreditAccounts)
      .set({
        status: input.status,
        updatedBy: input.updatedBy,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(storeCreditAccounts.id, input.id),
          isNull(storeCreditAccounts.deletedAt),
          notGiftCardCondition,
        ),
      )
      .returning({ id: storeCreditAccounts.id });
    return firstOrNull(rows) !== null;
  },

  async listForCustomer(customerId: string): Promise<StoreCreditAccountDTO[]> {
    const result = await storeCreditDal.listPage({
      customerId,
      status: "active",
      sortBy: "createdAt",
      sortOrder: "desc",
      offset: 0,
      limit: 100,
    });
    return result.accounts;
  },

  async listTransactions(input: {
    accountId: string;
    offset: number;
    limit: number;
  }): Promise<{ transactions: StoreCreditTransactionDTO[]; total: number }> {
    const db = await getDb();
    const [countRows, rows] = await Promise.all([
      db
        .select({ value: count() })
        .from(storeCreditTransactions)
        .where(eq(storeCreditTransactions.accountId, input.accountId)),
      db
        .select()
        .from(storeCreditTransactions)
        .where(eq(storeCreditTransactions.accountId, input.accountId))
        .orderBy(
          desc(storeCreditTransactions.createdAt),
          desc(storeCreditTransactions.id),
        )
        .limit(input.limit)
        .offset(input.offset),
    ]);
    return {
      transactions: rows.map(toTransactionDTO),
      total: Number(firstOrNull(countRows)?.value ?? 0),
    };
  },

  async createAccount(input: {
    id: string;
    customerId: string | null;
    codeHash: string;
    currencyCode: string;
    metadata?: Metadata;
    createdBy: string;
    now: string;
  }): Promise<"created" | "duplicate-code"> {
    const db = await getDb();
    try {
      await db.insert(storeCreditAccounts).values({
        id: input.id,
        customerId: input.customerId,
        codeHash: input.codeHash,
        currencyCode: input.currencyCode,
        status: "active",
        balance: 0,
        metadata: Object.fromEntries(
          Object.entries(input.metadata ?? {}).filter(
            ([key]) => key !== "_morph_resource_type",
          ),
        ),
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      });
      return "created";
    } catch (error) {
      const message = databaseErrorMessage(error);
      // SQLite names the columns, not the index, for a column index.
      if (
        message.includes("store_credit_accounts_code_hash_unique") ||
        message.includes("store_credit_accounts.code_hash")
      )
        return "duplicate-code";
      throw error;
    }
  },

  async claimAccount(input: {
    codeHash: string;
    customerId: string;
    now: string;
  }): Promise<
    | { status: "claimed" | "already-claimed"; accountId: string }
    | "invalid-code"
    | "claimed-by-another"
  > {
    const db = await getDb();
    const existingRows = await db
      .select({
        id: storeCreditAccounts.id,
        customerId: storeCreditAccounts.customerId,
      })
      .from(storeCreditAccounts)
      .where(
        and(
          eq(storeCreditAccounts.codeHash, input.codeHash),
          eq(storeCreditAccounts.status, "active"),
          isNull(storeCreditAccounts.deletedAt),
          notGiftCardCondition,
        ),
      )
      .limit(1);
    const existing = firstOrNull(existingRows);
    if (!existing) return "invalid-code";
    if (existing.customerId === input.customerId)
      return { status: "already-claimed", accountId: existing.id };
    if (existing.customerId) return "claimed-by-another";
    const changed = await db
      .update(storeCreditAccounts)
      .set({ customerId: input.customerId, updatedAt: input.now })
      .where(
        and(
          eq(storeCreditAccounts.id, existing.id),
          isNull(storeCreditAccounts.customerId),
          eq(storeCreditAccounts.status, "active"),
          isNull(storeCreditAccounts.deletedAt),
          notGiftCardCondition,
        ),
      )
      .returning({ id: storeCreditAccounts.id });
    if (firstOrNull(changed))
      return { status: "claimed", accountId: existing.id };
    const latest = firstOrNull(
      await db
        .select({ customerId: storeCreditAccounts.customerId })
        .from(storeCreditAccounts)
        .where(eq(storeCreditAccounts.id, existing.id))
        .limit(1),
    );
    return latest?.customerId === input.customerId
      ? { status: "already-claimed", accountId: existing.id }
      : "claimed-by-another";
  },

  async adjustBalance(input: {
    id: string;
    transactionId: string;
    idempotencyKey: string;
    type: "credit" | "debit";
    amount: number;
    note: string | null;
    reference: string;
    referenceId: string;
    createdBy: string | null;
    now: string;
  }): Promise<
    "updated" | "not-found" | "insufficient" | "disabled" | "conflict"
  > {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
      return "insufficient";
    const account = await storeCreditDal.findById(input.id);
    if (!account) return "not-found";
    if (account.status !== "active") return "disabled";
    const db = await getDb();
    const nextBalance =
      input.type === "credit"
        ? sql`case when ${storeCreditAccounts.status} = 'active' and ${storeCreditAccounts.deletedAt} is null then ${storeCreditAccounts.balance} + ${input.amount} else -1 end`
        : sql`case when ${storeCreditAccounts.status} = 'active' and ${storeCreditAccounts.deletedAt} is null and ${storeCreditAccounts.balance} >= ${input.amount} then ${storeCreditAccounts.balance} - ${input.amount} else -1 end`;
    try {
      await db.batch([
        db
          .update(storeCreditAccounts)
          .set({
            balance: nextBalance,
            updatedBy: input.createdBy,
            updatedAt: input.now,
          })
          .where(
            and(eq(storeCreditAccounts.id, input.id), notGiftCardCondition),
          ),
        db.insert(storeCreditTransactions).values({
          id: input.transactionId,
          accountId: input.id,
          type: input.type,
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          reference: input.reference,
          referenceId: input.referenceId,
          note: input.note,
          metadata: {},
          createdBy: input.createdBy,
          createdAt: input.now,
        }),
      ]);
      return "updated";
    } catch (error) {
      const message = databaseErrorMessage(error);
      if (balanceCheckFailure(error)) return "insufficient";
      if (
        message.includes(
          "store_credit_transactions_account_idempotency_unique",
        ) ||
        message.includes("store_credit_transactions.idempotency_key")
      )
        return "conflict";
      throw error;
    }
  },
};
