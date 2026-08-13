import { getDb } from "@/db";
import { apiKeys } from "@/db/api-key.schema";
import { publishableApiKeySalesChannels } from "@/db/link.schema";
import { salesChannels } from "@/db/sales-channel.schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

export const apiKeyDal = {
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
  async createPublishable(data: {
    id: string;
    hash: string;
    salt: string;
    redacted: string;
    title: string;
    createdBy: string;
    salesChannelIds: string[];
  }) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.batch([
      db.insert(apiKeys).values({
        id: data.id,
        token: data.hash,
        salt: data.salt,
        redacted: data.redacted,
        title: data.title,
        type: "publishable",
        createdBy: data.createdBy,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(publishableApiKeySalesChannels).values(
        data.salesChannelIds.map((salesChannelId) => ({
          apiKeyId: data.id,
          salesChannelId,
          createdAt: now,
          updatedAt: now,
        })),
      ),
    ]);
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
};
