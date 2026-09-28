import { getDb } from "@/db";
import { apiKeys } from "@/db/api-key.schema";
import { users } from "@/db/auth.schema";
import { publishableApiKeySalesChannels } from "@/db/link.schema";
import { salesChannels } from "@/db/sales-channel.schema";
import { likeContains } from "@/lib/db/like-query";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  or,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

export type AdminApiKeyDTO = {
  id: string;
  title: string;
  type: "secret" | "publishable";
  redacted: string;
  lastUsedAt: string | null;
  createdBy: string;
  revokedBy: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  salesChannelIds: string[];
};

type AdminApiKeyListInput = {
  type?: "secret" | "publishable";
  createdBy: string;
  query?: string;
  sortBy: "title" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  offset: number;
  limit: number;
};

const toAdminApiKey = (
  row: Omit<AdminApiKeyDTO, "salesChannelIds">,
  salesChannelIds: string[] = [],
): AdminApiKeyDTO => ({ ...row, salesChannelIds });

export const apiKeyDal = {
  async listAdminPage(input: AdminApiKeyListInput) {
    const db = await getDb();
    const visibleType = input.type
      ? input.type === "publishable"
        ? eq(apiKeys.type, "publishable")
        : and(
            eq(apiKeys.type, "secret"),
            eq(apiKeys.createdBy, input.createdBy),
          )
      : or(
          eq(apiKeys.type, "publishable"),
          and(
            eq(apiKeys.type, "secret"),
            eq(apiKeys.createdBy, input.createdBy),
          ),
        );
    const filters: SQL[] = [isNull(apiKeys.deletedAt)];
    if (visibleType) filters.push(visibleType);
    if (input.query) {
      filters.push(
        or(
          likeContains(apiKeys.title, input.query),
          likeContains(apiKeys.redacted, input.query),
        )!,
      );
    }
    const where = and(...filters);
    const [rows, totals] = await Promise.all([
      db
        .select({
          id: apiKeys.id,
          title: apiKeys.title,
          type: apiKeys.type,
          redacted: apiKeys.redacted,
          lastUsedAt: apiKeys.lastUsedAt,
          createdBy: apiKeys.createdBy,
          revokedBy: apiKeys.revokedBy,
          revokedAt: apiKeys.revokedAt,
          createdAt: apiKeys.createdAt,
          updatedAt: apiKeys.updatedAt,
          deletedAt: apiKeys.deletedAt,
        })
        .from(apiKeys)
        .where(where)
        .orderBy(
          input.sortBy === "title"
            ? input.sortOrder === "asc"
              ? asc(apiKeys.title)
              : desc(apiKeys.title)
            : input.sortBy === "updatedAt"
              ? input.sortOrder === "asc"
                ? asc(apiKeys.updatedAt)
                : desc(apiKeys.updatedAt)
              : input.sortOrder === "asc"
                ? asc(apiKeys.createdAt)
                : desc(apiKeys.createdAt),
        )
        .limit(input.limit)
        .offset(input.offset),
      db.select({ total: count() }).from(apiKeys).where(where),
    ]);
    const ids = rows
      .filter((row) => row.type === "publishable")
      .map((row) => row.id);
    const links = ids.length
      ? await db
          .select({
            apiKeyId: publishableApiKeySalesChannels.apiKeyId,
            salesChannelId: publishableApiKeySalesChannels.salesChannelId,
          })
          .from(publishableApiKeySalesChannels)
          .where(inArray(publishableApiKeySalesChannels.apiKeyId, ids))
      : [];
    const channelsByKey = new Map<string, string[]>();
    for (const link of links) {
      const current = channelsByKey.get(link.apiKeyId) ?? [];
      current.push(link.salesChannelId);
      channelsByKey.set(link.apiKeyId, current);
    }
    return {
      apiKeys: rows.map((row) =>
        toAdminApiKey(row, channelsByKey.get(row.id) ?? []),
      ),
      total: Number(totals[0]?.total ?? 0),
    };
  },
  async findAdminById(
    id: string,
    actorId: string,
  ): Promise<AdminApiKeyDTO | null> {
    const db = await getDb();
    const row = await db
      .select({
        id: apiKeys.id,
        title: apiKeys.title,
        type: apiKeys.type,
        redacted: apiKeys.redacted,
        lastUsedAt: apiKeys.lastUsedAt,
        createdBy: apiKeys.createdBy,
        revokedBy: apiKeys.revokedBy,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
        updatedAt: apiKeys.updatedAt,
        deletedAt: apiKeys.deletedAt,
      })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.id, id),
          isNull(apiKeys.deletedAt),
          or(
            eq(apiKeys.type, "publishable"),
            and(eq(apiKeys.type, "secret"), eq(apiKeys.createdBy, actorId)),
          ),
        ),
      )
      .get();
    if (!row) return null;
    const links =
      row.type === "publishable"
        ? await db
            .select({
              salesChannelId: publishableApiKeySalesChannels.salesChannelId,
            })
            .from(publishableApiKeySalesChannels)
            .where(eq(publishableApiKeySalesChannels.apiKeyId, row.id))
        : [];
    return toAdminApiKey(
      row,
      links.map((link) => link.salesChannelId),
    );
  },
  async listPublishable() {
    const db = await getDb();
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.type, "publishable"), isNull(apiKeys.deletedAt)))
      .orderBy(desc(apiKeys.createdAt));
    const ids = rows.map((row) => row.id);
    const links = ids.length
      ? await db
          .select()
          .from(publishableApiKeySalesChannels)
          .where(inArray(publishableApiKeySalesChannels.apiKeyId, ids))
      : [];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      redacted: row.redacted,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      salesChannelIds: links
        .filter((link) => link.apiKeyId === row.id)
        .map((link) => link.salesChannelId),
    }));
  },
  async activeSalesChannelIds(ids: string[]) {
    if (!ids.length) return [];
    const db = await getDb();
    const rows = await db
      .select({ id: salesChannels.id })
      .from(salesChannels)
      .where(
        and(
          inArray(salesChannels.id, ids),
          eq(salesChannels.isDisabled, false),
          isNull(salesChannels.deletedAt),
        ),
      );
    return rows.map((row) => row.id);
  },
  async listSecret(createdBy: string) {
    const db = await getDb();
    return db
      .select({
        id: apiKeys.id,
        title: apiKeys.title,
        redacted: apiKeys.redacted,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
        updatedAt: apiKeys.updatedAt,
      })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.type, "secret"),
          eq(apiKeys.createdBy, createdBy),
          isNull(apiKeys.deletedAt),
        ),
      )
      .orderBy(desc(apiKeys.createdAt));
  },
  async findActiveSecretById(id: string) {
    const db = await getDb();
    return (
      (await db
        .select({
          id: apiKeys.id,
          hash: apiKeys.token,
          salt: apiKeys.salt,
          createdBy: apiKeys.createdBy,
        })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.id, id),
            eq(apiKeys.type, "secret"),
            isNull(apiKeys.revokedAt),
            isNull(apiKeys.deletedAt),
          ),
        )
        .get()) ?? null
    );
  },
  async findSecretOwner(userId: string) {
    const db = await getDb();
    return (
      (await db
        .select({ id: users.id, role: users.role, banned: users.banned })
        .from(users)
        .where(eq(users.id, userId))
        .get()) ?? null
    );
  },
  async recordSecretUse(id: string) {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db
      .update(apiKeys)
      .set({ lastUsedAt: now, updatedAt: now })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.type, "secret"),
          isNull(apiKeys.revokedAt),
          isNull(apiKeys.deletedAt),
        ),
      );
    return Number(result.meta.changes ?? 0) > 0;
  },
  async createPublishable(data: {
    id: string;
    hash: string;
    salt: string;
    redacted: string;
    title: string;
    createdBy: string;
    salesChannelIds: string[];
    now?: string;
  }) {
    const db = await getDb();
    const now = data.now ?? new Date().toISOString();
    const insertKey = db.insert(apiKeys).values({
      id: data.id,
      token: data.hash,
      salt: data.salt,
      redacted: data.redacted,
      title: data.title,
      type: "publishable",
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    if (data.salesChannelIds.length) {
      await db.batch([
        insertKey,
        db.insert(publishableApiKeySalesChannels).values(
          data.salesChannelIds.map((salesChannelId) => ({
            apiKeyId: data.id,
            salesChannelId,
            createdAt: now,
            updatedAt: now,
          })),
        ),
      ]);
    } else {
      await db.batch([insertKey]);
    }
    return now;
  },
  async createSecret(data: {
    id: string;
    hash: string;
    salt: string;
    redacted: string;
    title: string;
    createdBy: string;
    now?: string;
  }) {
    const db = await getDb();
    const now = data.now ?? new Date().toISOString();
    await db.insert(apiKeys).values({
      id: data.id,
      token: data.hash,
      salt: data.salt,
      redacted: data.redacted,
      title: data.title,
      type: "secret",
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return now;
  },
  async updateSecretTitle(id: string, createdBy: string, title: string) {
    const db = await getDb();
    const result = await db
      .update(apiKeys)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.type, "secret"),
          eq(apiKeys.createdBy, createdBy),
          isNull(apiKeys.deletedAt),
        ),
      );
    return Number(result.meta.changes ?? 0) > 0;
  },
  async updatePublishableTitle(id: string, title: string) {
    const db = await getDb();
    const result = await db
      .update(apiKeys)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.type, "publishable"),
          isNull(apiKeys.deletedAt),
        ),
      );
    return Number(result.meta.changes ?? 0) > 0;
  },
  async managePublishableSalesChannels(input: {
    id: string;
    add: string[];
    remove: string[];
  }) {
    const db = await getDb();
    const now = new Date().toISOString();
    const statements: BatchItem<"sqlite">[] = [];
    if (input.remove.length) {
      statements.push(
        db
          .delete(publishableApiKeySalesChannels)
          .where(
            and(
              eq(publishableApiKeySalesChannels.apiKeyId, input.id),
              inArray(
                publishableApiKeySalesChannels.salesChannelId,
                input.remove,
              ),
            ),
          ),
      );
    }
    if (input.add.length) {
      statements.push(
        db
          .insert(publishableApiKeySalesChannels)
          .values(
            input.add.map((salesChannelId) => ({
              apiKeyId: input.id,
              salesChannelId,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .onConflictDoNothing(),
      );
    }
    const [first, ...rest] = statements;
    if (first) await db.batch([first, ...rest]);
    return true;
  },
  async revokeSecret(id: string, actorId: string) {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db
      .update(apiKeys)
      .set({ revokedAt: now, revokedBy: actorId, updatedAt: now })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.type, "secret"),
          eq(apiKeys.createdBy, actorId),
          isNull(apiKeys.revokedAt),
          isNull(apiKeys.deletedAt),
        ),
      );
    return Number(result.meta.changes ?? 0) > 0;
  },
  async deleteRevokedSecret(id: string, actorId: string) {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db
      .update(apiKeys)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.type, "secret"),
          eq(apiKeys.createdBy, actorId),
          isNotNull(apiKeys.revokedAt),
          isNull(apiKeys.deletedAt),
        ),
      );
    return Number(result.meta.changes ?? 0) > 0;
  },
  async revoke(id: string, actorId: string) {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db
      .update(apiKeys)
      .set({ revokedAt: now, revokedBy: actorId, updatedAt: now })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.type, "publishable"),
          isNull(apiKeys.revokedAt),
          isNull(apiKeys.deletedAt),
        ),
      );
    return Number(result.meta.changes ?? 0) > 0;
  },
  async deleteRevokedPublishable(id: string) {
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db
      .update(apiKeys)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.type, "publishable"),
          isNotNull(apiKeys.revokedAt),
          isNull(apiKeys.deletedAt),
        ),
      );
    return Number(result.meta.changes ?? 0) > 0;
  },
};
