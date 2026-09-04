import { getDb } from "@/db";
import { mapFirstOrNull } from "@/lib/db/single-row";
import { productSalesChannels } from "@/db/link.schema";
import { salesChannels } from "@/db/sales-channel.schema";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { containsPattern } from "@/lib/db/like-pattern";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  type SQL,
} from "drizzle-orm";
import type {
  SalesChannelDTO,
  SalesChannelInsertDTO,
  SalesChannelSummaryDTO,
  UpdateSalesChannelDTO,
} from "../dto/sales-channel.dto";
import {
  toSalesChannelDTO,
  type SalesChannelRow,
} from "../mappers/sales-channel.mapper";

/** How many rows one soft-delete statement touches. See rules.md §4. */
const DELETE_CHUNK = 50;

const mapFirst = (rows: SalesChannelRow[]): SalesChannelDTO | null =>
  mapFirstOrNull(rows, toSalesChannelDTO);

export const salesChannelDal = {
  async findById(id: string): Promise<SalesChannelDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(salesChannels)
      .where(and(eq(salesChannels.id, id), isNull(salesChannels.deletedAt)))
      .limit(1);
    return mapFirst(rows);
  },

  async findByName(name: string): Promise<SalesChannelDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(salesChannels)
      .where(and(eq(salesChannels.name, name), isNull(salesChannels.deletedAt)))
      .limit(1);
    return mapFirst(rows);
  },

  async findByIds(ids: string[]): Promise<SalesChannelDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows = await db
      .select()
      .from(salesChannels)
      .where(
        and(inArray(salesChannels.id, ids), isNull(salesChannels.deletedAt)),
      );
    return rows.map(toSalesChannelDTO);
  },

  /**
   * A page of channels, each with its product count.
   *
   * The count is a separate grouped query rather than a join: joining the link
   * table multiplies the channel rows and then needs a `distinct`, which turns
   * the paginated read into a scan of every link row.
   */
  async listPage(options: {
    query?: string | null;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ channels: SalesChannelSummaryDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(salesChannels.deletedAt)];

    if (options.query?.trim()) {
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(
          like(salesChannels.name, pattern),
          like(salesChannels.description, pattern),
        ) as SQL,
      );
    }

    const sortColumn = {
      name: salesChannels.name,
      createdAt: salesChannels.createdAt,
      updatedAt: salesChannels.updatedAt,
    }[options.sortBy];
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(salesChannels).where(condition),
      db
        .select()
        .from(salesChannels)
        .where(condition)
        .orderBy(
          options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
        )
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    const counts = await this.countProducts(rows.map((row) => row.id));

    return {
      channels: rows.map((row) => ({
        ...toSalesChannelDTO(row),
        productCount: counts.get(row.id) ?? 0,
      })),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async countProducts(channelIds: string[]): Promise<Map<string, number>> {
    if (channelIds.length === 0) return new Map();
    const db = await getDb();
    const rows = await db
      .select({
        salesChannelId: productSalesChannels.salesChannelId,
        value: count(),
      })
      .from(productSalesChannels)
      .where(inArray(productSalesChannels.salesChannelId, channelIds))
      .groupBy(productSalesChannels.salesChannelId);

    return new Map(rows.map((row) => [row.salesChannelId, Number(row.value)]));
  },

  async create(data: SalesChannelInsertDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.insert(salesChannels).values({
      id: data.id,
      name: data.name,
      type: data.type ?? "custom",
      description: data.description ?? null,
      isDisabled: data.isDisabled ?? false,
      createdAt: now,
      updatedAt: now,
    });
  },

  async update(id: string, data: UpdateSalesChannelDTO): Promise<void> {
    const db = await getDb();
    await db
      .update(salesChannels)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.isDisabled !== undefined
          ? { isDisabled: data.isDisabled }
          : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(salesChannels.id, id), isNull(salesChannels.deletedAt)));
  },

  /**
   * Soft delete, plus the links.
   *
   * The links have to go explicitly — `product_sales_channels` has no foreign
   * key, so nothing cascades. Leaving them would keep the products listed in a
   * channel that no longer exists. See `link.schema.ts`.
   */
  async softDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();

    for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
      const chunk = ids.slice(index, index + DELETE_CHUNK);
      await db
        .update(salesChannels)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            inArray(salesChannels.id, chunk),
            isNull(salesChannels.deletedAt),
          ),
        );
      await db
        .delete(productSalesChannels)
        .where(inArray(productSalesChannels.salesChannelId, chunk));
    }
  },

  async listProductIds(channelId: string): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .select({ productId: productSalesChannels.productId })
      .from(productSalesChannels)
      .where(eq(productSalesChannels.salesChannelId, channelId));
    return rows.map((row) => row.productId);
  },

  async listChannelIdsForProduct(productId: string): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .select({ salesChannelId: productSalesChannels.salesChannelId })
      .from(productSalesChannels)
      .where(eq(productSalesChannels.productId, productId));
    return rows.map((row) => row.salesChannelId);
  },

  /**
   * Replace a product's channels with exactly this set.
   *
   * Delete-then-insert rather than a diff: the set is small and bounded by how
   * many channels a store has, and computing the difference costs a read that
   * buys nothing.
   */
  async setProductChannels(
    productId: string,
    channelIds: string[],
  ): Promise<void> {
    const db = await getDb();
    await db
      .delete(productSalesChannels)
      .where(eq(productSalesChannels.productId, productId));

    if (channelIds.length === 0) return;

    const now = new Date().toISOString();
    const rows = channelIds.map((salesChannelId) => ({
      productId,
      salesChannelId,
      createdAt: now,
      updatedAt: now,
    }));

    // Four columns, so the 100-parameter ceiling allows 25 rows a statement.
    for (const chunk of chunkForInsert(rows, 4)) {
      await db.insert(productSalesChannels).values(chunk);
    }
  },

  /** Add one channel to many products, e.g. from the product list's bulk bar. */
  async addProducts(channelId: string, productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();
    const rows = productIds.map((productId) => ({
      productId,
      salesChannelId: channelId,
      createdAt: now,
      updatedAt: now,
    }));

    for (const chunk of chunkForInsert(rows, 4)) {
      // The pair is the primary key, so re-adding a product already in the
      // channel is a no-op rather than a constraint error.
      await db.insert(productSalesChannels).values(chunk).onConflictDoNothing();
    }
  },

  async removeProducts(channelId: string, productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    const db = await getDb();
    for (let index = 0; index < productIds.length; index += DELETE_CHUNK) {
      await db
        .delete(productSalesChannels)
        .where(
          and(
            eq(productSalesChannels.salesChannelId, channelId),
            inArray(
              productSalesChannels.productId,
              productIds.slice(index, index + DELETE_CHUNK),
            ),
          ),
        );
    }
  },
};
