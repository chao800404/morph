import { getDb } from "@/db";
import type { Metadata } from "@/db/json";
import {
  giftCards,
  storeCreditAccounts,
  storeCreditTransactions,
} from "@/db/schema";
import { firstOrNull } from "@/lib/db/single-row";
import { likeContains } from "@/lib/db/like-query";
import { databaseErrorMessage } from "@/lib/order/database-error";
import type { StoreCreditTransactionDTO } from "@/lib/store-credit/dto/store-credit.dto";
import type { GiftCardDTO, GiftCardStatus } from "../dto/gift-card.dto";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

const resourceTypePath = "$._morph_resource_type";

const giftCardCondition = sql`json_extract(${storeCreditAccounts.metadata}, ${resourceTypePath}) = 'gift_card'`;

const giftCardMetadata = (metadata: Metadata | null) =>
  metadata?._morph_resource_type === "gift_card" ? metadata : null;

const statusFor = (
  account: Pick<
    typeof storeCreditAccounts.$inferSelect,
    "status" | "balance" | "metadata"
  >,
  now: string,
): GiftCardStatus => {
  if (account.status === "disabled") return "disabled";
  const metadata = giftCardMetadata(account.metadata);
  const expiresAt = metadata?._morph_expires_at;
  if (typeof expiresAt === "string" && expiresAt <= now) return "expired";
  return account.balance <= 0 ? "depleted" : "active";
};

const mapGiftCard = (
  row: {
    account: typeof storeCreditAccounts.$inferSelect;
    totalCredits: number;
    totalDebits: number;
  },
  now: string,
): GiftCardDTO => {
  const metadata = giftCardMetadata(row.account.metadata);
  const initialValue = metadata?._morph_initial_value;
  const expiresAt = metadata?._morph_expires_at;
  const note = metadata?._morph_note;
  return {
    id: row.account.id,
    currencyCode: row.account.currencyCode,
    status: statusFor(row.account, now),
    initialValue: typeof initialValue === "number" ? initialValue : 0,
    balance: row.account.balance,
    totalCredits: Number(row.totalCredits),
    totalDebits: Number(row.totalDebits),
    expiresAt: typeof expiresAt === "string" ? expiresAt : null,
    note: typeof note === "string" ? note : null,
    createdAt: new Date(row.account.createdAt),
    updatedAt: new Date(row.account.updatedAt),
  };
};

const creditsTotal = sql<number>`coalesce(sum(case when ${storeCreditTransactions.type} = 'credit' then ${storeCreditTransactions.amount} else 0 end), 0)`;
const debitsTotal = sql<number>`coalesce(sum(case when ${storeCreditTransactions.type} = 'debit' then ${storeCreditTransactions.amount} else 0 end), 0)`;

export const giftCardDal = {
  async listPage(input: {
    query?: string;
    currencyCode?: string;
    status?: "active" | "disabled";
    sortBy: "createdAt" | "balance";
    sortOrder: "asc" | "desc";
    offset: number;
    limit: number;
  }): Promise<{ giftCards: GiftCardDTO[]; total: number }> {
    const db = await getDb();
    const conditions = [
      isNull(storeCreditAccounts.deletedAt),
      giftCardCondition,
    ];
    if (input.currencyCode)
      conditions.push(eq(storeCreditAccounts.currencyCode, input.currencyCode));
    if (input.status === "disabled")
      conditions.push(eq(storeCreditAccounts.status, input.status));
    else if (input.status === "active") {
      const now = new Date().toISOString();
      conditions.push(
        eq(storeCreditAccounts.status, "active"),
        sql`${storeCreditAccounts.balance} > 0`,
        sql`(
          json_extract(${storeCreditAccounts.metadata}, '$._morph_expires_at') is null
          or json_extract(${storeCreditAccounts.metadata}, '$._morph_expires_at') > ${now}
        )`,
      );
    }
    if (input.query?.trim()) {
      conditions.push(
        likeContains(storeCreditAccounts.id, input.query.trim())!,
      );
    }
    const where = and(...conditions);
    const sortColumn =
      input.sortBy === "balance"
        ? storeCreditAccounts.balance
        : storeCreditAccounts.createdAt;
    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(storeCreditAccounts).where(where),
      db
        .select({
          account: storeCreditAccounts,
          totalCredits: creditsTotal,
          totalDebits: debitsTotal,
        })
        .from(storeCreditAccounts)
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
    const now = new Date().toISOString();
    return {
      giftCards: rows.map((row) => mapGiftCard(row, now)),
      total: Number(firstOrNull(countRows)?.value ?? 0),
    };
  },

  async findById(id: string): Promise<GiftCardDTO | null> {
    const db = await getDb();
    const row = firstOrNull(
      await db
        .select({
          account: storeCreditAccounts,
          totalCredits: creditsTotal,
          totalDebits: debitsTotal,
        })
        .from(storeCreditAccounts)
        .leftJoin(
          storeCreditTransactions,
          eq(storeCreditTransactions.accountId, storeCreditAccounts.id),
        )
        .where(
          and(
            eq(storeCreditAccounts.id, id),
            isNull(storeCreditAccounts.deletedAt),
            giftCardCondition,
          ),
        )
        .groupBy(storeCreditAccounts.id)
        .limit(1),
    );
    return row ? mapGiftCard(row, new Date().toISOString()) : null;
  },

  async findForRedemption(codeHash: string): Promise<{
    id: string;
    currencyCode: string;
    status: "active" | "disabled";
    balance: number;
    expiresAt: string | null;
  } | null> {
    const db = await getDb();
    const row = firstOrNull(
      await db
        .select({
          id: storeCreditAccounts.id,
          currencyCode: storeCreditAccounts.currencyCode,
          status: storeCreditAccounts.status,
          balance: storeCreditAccounts.balance,
          metadata: storeCreditAccounts.metadata,
        })
        .from(storeCreditAccounts)
        .where(
          and(
            eq(storeCreditAccounts.codeHash, codeHash),
            isNull(storeCreditAccounts.deletedAt),
            giftCardCondition,
          ),
        )
        .limit(1),
    );
    if (!row) return null;
    const metadata = giftCardMetadata(row.metadata);
    const expiresAt = metadata?._morph_expires_at;
    return {
      id: row.id,
      currencyCode: row.currencyCode,
      status: row.status,
      balance: row.balance,
      expiresAt: typeof expiresAt === "string" ? expiresAt : null,
    };
  },

  async create(input: {
    id: string;
    code: string;
    codeHash: string;
    currencyCode: string;
    amount: number;
    expiresAt: string | null;
    note: string | null;
    createdBy: string;
    now: string;
  }): Promise<"created" | "duplicate-code"> {
    const db = await getDb();
    const metadata: Metadata = {
      _morph_resource_type: "gift_card",
      _morph_initial_value: input.amount,
      _morph_expires_at: input.expiresAt,
      _morph_note: input.note,
    };
    try {
      await db.batch([
        db.insert(storeCreditAccounts).values({
          id: input.id,
          customerId: null,
          codeHash: input.codeHash,
          currencyCode: input.currencyCode,
          status: "active",
          balance: input.amount,
          metadata,
          createdBy: input.createdBy,
          updatedBy: input.createdBy,
          createdAt: input.now,
          updatedAt: input.now,
          deletedAt: null,
        }),
        db.insert(giftCards).values({
          id: input.id,
          storeCreditAccountId: input.id,
          code: input.code,
          codeHash: input.codeHash,
          value: input.amount,
          currencyCode: input.currencyCode,
          status: "active",
          expiresAt: input.expiresAt,
          reference: null,
          referenceId: null,
          lineItemId: null,
          note: input.note,
          createdBy: input.createdBy,
          updatedBy: input.createdBy,
          createdAt: input.now,
          updatedAt: input.now,
          deletedAt: null,
        }),
        db.insert(storeCreditTransactions).values({
          id: crypto.randomUUID(),
          accountId: input.id,
          type: "credit",
          amount: input.amount,
          idempotencyKey: `gift-card:issue:${input.id}`,
          reference: "gift_card_issue",
          referenceId: input.id,
          note: input.note,
          metadata: {},
          createdBy: input.createdBy,
          createdAt: input.now,
        }),
      ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
      return "created";
    } catch (error) {
      const message = databaseErrorMessage(error);
      if (
        message.includes("store_credit_accounts_code_hash_unique") ||
        message.includes("gift_cards_code_hash_unique") ||
        message.includes("gift_cards_code_unique") ||
        // D1/SQLite reports the conflicting column, rather than its index.
        message.includes(
          "UNIQUE constraint failed: store_credit_accounts.code_hash",
        ) ||
        message.includes("UNIQUE constraint failed: gift_cards.code_hash") ||
        message.includes("UNIQUE constraint failed: gift_cards.code")
      )
        return "duplicate-code";
      throw error;
    }
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
      transactions: rows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        type: row.type,
        amount: row.amount,
        reference: row.reference,
        referenceId: row.referenceId,
        note: row.note,
        createdBy: row.createdBy,
        createdAt: new Date(row.createdAt),
      })),
      total: Number(firstOrNull(countRows)?.value ?? 0),
    };
  },

  async setStatus(input: {
    id: string;
    status: "active" | "disabled";
    updatedBy: string;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const [rows] = await db.batch([
      db
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
            giftCardCondition,
          ),
        )
        .returning({ id: storeCreditAccounts.id }),
      db
        .update(giftCards)
        .set({
          status: input.status,
          updatedBy: input.updatedBy,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(giftCards.storeCreditAccountId, input.id),
            isNull(giftCards.deletedAt),
            sql`exists (
              select 1 from store_credit_accounts
              where store_credit_accounts.id = ${input.id}
                and store_credit_accounts.updated_at = ${input.now}
            )`,
          ),
        ),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    if (!firstOrNull(rows)) return false;
    return true;
  },

  async updateDetails(input: {
    id: string;
    expiresAt?: string | null;
    note?: string | null;
    updatedBy: string;
    now: string;
  }): Promise<"updated" | "not-found" | "conflict"> {
    const db = await getDb();
    const current = firstOrNull(
      await db
        .select({
          metadata: storeCreditAccounts.metadata,
          updatedAt: storeCreditAccounts.updatedAt,
        })
        .from(storeCreditAccounts)
        .where(
          and(
            eq(storeCreditAccounts.id, input.id),
            isNull(storeCreditAccounts.deletedAt),
            giftCardCondition,
          ),
        )
        .limit(1),
    );
    if (!current) return "not-found";
    const metadata = current.metadata ?? {};
    const nextMetadata: Metadata = {
      ...metadata,
      ...(input.expiresAt !== undefined
        ? { _morph_expires_at: input.expiresAt }
        : {}),
      ...(input.note !== undefined ? { _morph_note: input.note } : {}),
    };
    const updatedAt = new Date(
      Math.max(Date.parse(input.now), Date.parse(current.updatedAt) + 1),
    ).toISOString();
    const [rows] = await db.batch([
      db
        .update(storeCreditAccounts)
        .set({
          metadata: nextMetadata,
          updatedBy: input.updatedBy,
          updatedAt,
        })
        .where(
          and(
            eq(storeCreditAccounts.id, input.id),
            eq(storeCreditAccounts.updatedAt, current.updatedAt),
            isNull(storeCreditAccounts.deletedAt),
            giftCardCondition,
          ),
        )
        .returning({ id: storeCreditAccounts.id }),
      db
        .update(giftCards)
        .set({
          ...(input.expiresAt !== undefined
            ? { expiresAt: input.expiresAt }
            : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          updatedBy: input.updatedBy,
          updatedAt,
        })
        .where(
          and(
            eq(giftCards.storeCreditAccountId, input.id),
            isNull(giftCards.deletedAt),
            // Gated on the account write above having landed, not on this
            // row's own updatedAt: redemptions move the account's timestamp
            // without touching this row, so comparing the two silently
            // skipped the update and left the delivered expiry stale.
            sql`exists (
              select 1 from store_credit_accounts
              where store_credit_accounts.id = ${input.id}
                and store_credit_accounts.updated_at = ${updatedAt}
            )`,
          ),
        ),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    if (!firstOrNull(rows)) return "conflict";
    return "updated";
  },

  /** Codes issued from a completed order for the customer confirmation email. */
  async listForOrder(orderId: string): Promise<
    Array<{
      code: string;
      value: number;
      currencyCode: string;
      expiresAt: string | null;
    }>
  > {
    const db = await getDb();
    return db
      .select({
        code: giftCards.code,
        value: giftCards.value,
        currencyCode: giftCards.currencyCode,
        expiresAt: giftCards.expiresAt,
      })
      .from(giftCards)
      .where(
        and(
          eq(giftCards.reference, "order"),
          eq(giftCards.referenceId, orderId),
          isNull(giftCards.deletedAt),
        ),
      )
      .orderBy(asc(giftCards.createdAt), asc(giftCards.id));
  },
};
