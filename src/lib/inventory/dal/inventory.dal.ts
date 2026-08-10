import { getDb } from "@/db";
import { inventoryItems, inventoryLevels } from "@/db/inventory.schema";
import { productVariantInventoryItems } from "@/db/link.schema";
import { products, productVariants } from "@/db/product.schema";
import { stockLocations } from "@/db/stock-location.schema";
import { containsPattern } from "@/lib/db/like-pattern";
import type { InventoryListItemDTO } from "../dto/inventory.dto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  like,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

const active = isNull(inventoryItems.deletedAt);

export const inventoryDal = {
  async ensureDefaultLocation(): Promise<string> {
    const db = await getDb();
    const existing = await db
      .select({ id: stockLocations.id })
      .from(stockLocations)
      .where(isNull(stockLocations.deletedAt))
      .orderBy(asc(stockLocations.createdAt))
      .limit(1);
    if (existing[0]) return existing[0].id;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(stockLocations).values({
      id,
      name: "Default Location",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },

  async ensureForVariant(input: {
    variantId: string;
    sku: string | null;
    title: string;
    quantity: number;
  }): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const linked = await db
      .select({ id: productVariantInventoryItems.inventoryItemId })
      .from(productVariantInventoryItems)
      .where(eq(productVariantInventoryItems.variantId, input.variantId))
      .limit(1);
    if (linked[0]) {
      const linkedVariants = await db
        .select({ value: count() })
        .from(productVariantInventoryItems)
        .where(eq(productVariantInventoryItems.inventoryItemId, linked[0].id));
      // A one-to-one item mirrors its variant identity. Shared inventory is a
      // deliberate aggregate and must not be renamed by one of its consumers.
      if (Number(linkedVariants[0]?.value ?? 0) === 1) {
        await db
          .update(inventoryItems)
          .set({ sku: input.sku, title: input.title, updatedAt: now })
          .where(and(eq(inventoryItems.id, linked[0].id), active));
      }
      return;
    }

    const locationId = await this.ensureDefaultLocation();
    const matchingItem = input.sku
      ? await db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.sku, input.sku), active))
          .limit(1)
      : [];
    const inventoryItemId = matchingItem[0]?.id ?? crypto.randomUUID();
    if (matchingItem.length === 0) {
      await db.insert(inventoryItems).values({
        id: inventoryItemId,
        sku: input.sku,
        title: input.title,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.insert(productVariantInventoryItems).values({
      variantId: input.variantId,
      inventoryItemId,
      requiredQuantity: 1,
      createdAt: now,
      updatedAt: now,
    });
    const existingLevel = await db
      .select({ id: inventoryLevels.id })
      .from(inventoryLevels)
      .where(
        and(
          eq(inventoryLevels.inventoryItemId, inventoryItemId),
          eq(inventoryLevels.locationId, locationId),
          isNull(inventoryLevels.deletedAt),
        ),
      )
      .limit(1);
    if (existingLevel.length === 0) {
      await db.insert(inventoryLevels).values({
        id: crypto.randomUUID(),
        inventoryItemId,
        locationId,
        stockedQuantity: Math.max(0, input.quantity),
        reservedQuantity: 0,
        incomingQuantity: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  },

  async reconcileManagedVariants(): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ variant: productVariants, productTitle: products.title })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(
        productVariantInventoryItems,
        eq(productVariantInventoryItems.variantId, productVariants.id),
      )
      .where(
        and(
          eq(productVariants.manageInventory, true),
          isNull(productVariants.deletedAt),
          isNull(products.deletedAt),
          isNull(productVariantInventoryItems.inventoryItemId),
        ),
      );
    for (const row of rows) {
      await this.ensureForVariant({
        variantId: row.variant.id,
        sku: row.variant.sku,
        title: `${row.productTitle} - ${row.variant.title}`,
        quantity: row.variant.inventoryQuantity,
      });
    }
    return rows.length;
  },

  async setPrimaryLevelQuantity(
    variantId: string,
    quantity: number,
  ): Promise<void> {
    const db = await getDb();
    const levels = await db
      .select({ id: inventoryLevels.id })
      .from(productVariantInventoryItems)
      .innerJoin(
        inventoryLevels,
        eq(
          inventoryLevels.inventoryItemId,
          productVariantInventoryItems.inventoryItemId,
        ),
      )
      .where(
        and(
          eq(productVariantInventoryItems.variantId, variantId),
          isNull(inventoryLevels.deletedAt),
        ),
      )
      .orderBy(asc(inventoryLevels.createdAt))
      .limit(1);
    if (!levels[0]) return;
    await db
      .update(inventoryLevels)
      .set({
        stockedQuantity: Math.max(0, quantity),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(inventoryLevels.id, levels[0].id));
  },

  async listPage(options: {
    query?: string | null;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ items: InventoryListItemDTO[]; total: number }> {
    const db = await getDb();
    const hasAnyVariantLink = db
      .select({ value: sql<number>`1` })
      .from(productVariantInventoryItems)
      .where(
        eq(productVariantInventoryItems.inventoryItemId, inventoryItems.id),
      );
    const hasActiveVariantLink = db
      .select({ value: sql<number>`1` })
      .from(productVariantInventoryItems)
      .innerJoin(
        productVariants,
        eq(productVariants.id, productVariantInventoryItems.variantId),
      )
      .where(
        and(
          eq(productVariantInventoryItems.inventoryItemId, inventoryItems.id),
          isNull(productVariants.deletedAt),
        ),
      );
    const conditions: SQL[] = [
      active,
      // Standalone inventory items are valid. Items whose only links point to
      // soft-deleted variants are lifecycle residue and must not appear as a
      // second copy of the product's current stock.
      or(notExists(hasAnyVariantLink), exists(hasActiveVariantLink)) as SQL,
    ];
    if (options.query?.trim()) {
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(
          like(inventoryItems.title, pattern),
          like(inventoryItems.sku, pattern),
        ) as SQL,
      );
    }
    const condition = and(...conditions);
    const sortColumn =
      options.sortBy === "name"
        ? inventoryItems.title
        : options.sortBy === "updatedAt"
          ? inventoryItems.updatedAt
          : inventoryItems.createdAt;
    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(inventoryItems).where(condition),
      db
        .select()
        .from(inventoryItems)
        .where(condition)
        .orderBy(
          options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
        )
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    const ids = rows.map((row) => row.id);
    const [variantLinks, levelTotals] =
      ids.length === 0
        ? [[], []]
        : await Promise.all([
            db
              .select({
                inventoryItemId: productVariantInventoryItems.inventoryItemId,
                variantId: productVariants.id,
                productId: productVariants.productId,
                variantTitle: productVariants.title,
                variantSku: productVariants.sku,
                productTitle: products.title,
              })
              .from(productVariantInventoryItems)
              .innerJoin(
                productVariants,
                eq(productVariants.id, productVariantInventoryItems.variantId),
              )
              .innerJoin(products, eq(products.id, productVariants.productId))
              .where(
                and(
                  inArray(productVariantInventoryItems.inventoryItemId, ids),
                  isNull(productVariants.deletedAt),
                ),
              ),
            db
              .select({
                inventoryItemId: inventoryLevels.inventoryItemId,
                stocked: sql<number>`sum(${inventoryLevels.stockedQuantity})`,
                reserved: sql<number>`sum(${inventoryLevels.reservedQuantity})`,
                incoming: sql<number>`sum(${inventoryLevels.incomingQuantity})`,
              })
              .from(inventoryLevels)
              .where(
                and(
                  inArray(inventoryLevels.inventoryItemId, ids),
                  isNull(inventoryLevels.deletedAt),
                ),
              )
              .groupBy(inventoryLevels.inventoryItemId),
          ]);
    const variantLinksByItem = new Map<
      string,
      Array<{
        variantId: string;
        productId: string;
        variantTitle: string;
        variantSku: string | null;
        productTitle: string;
      }>
    >();
    for (const link of variantLinks) {
      const links = variantLinksByItem.get(link.inventoryItemId) ?? [];
      links.push({
        variantId: link.variantId,
        productId: link.productId,
        variantTitle: link.variantTitle,
        variantSku: link.variantSku,
        productTitle: link.productTitle,
      });
      variantLinksByItem.set(link.inventoryItemId, links);
    }
    const levelTotalsByItem = new Map(
      levelTotals.map((row) => [row.inventoryItemId, row]),
    );
    return {
      items: rows.map((row) => {
        const totals = levelTotalsByItem.get(row.id);
        const links = variantLinksByItem.get(row.id) ?? [];
        const editTarget = links.length === 1 ? links[0] : null;
        const stocked = Number(totals?.stocked ?? 0);
        const reserved = Number(totals?.reserved ?? 0);
        return {
          id: row.id,
          productId: editTarget?.productId ?? null,
          variantId: editTarget?.variantId ?? null,
          title: editTarget
            ? `${editTarget.productTitle} - ${editTarget.variantTitle}`
            : row.title,
          sku: editTarget?.variantSku ?? row.sku,
          variantCount: links.length,
          stockedQuantity: stocked,
          reservedQuantity: reserved,
          incomingQuantity: Number(totals?.incoming ?? 0),
          availableQuantity: stocked - reserved,
          updatedAt: new Date(row.updatedAt),
        };
      }),
      total: Number(countRows[0]?.value ?? 0),
    };
  },
};
