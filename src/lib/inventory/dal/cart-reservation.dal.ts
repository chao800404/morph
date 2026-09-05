import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { inventoryLevels, reservationItems } from "@/db/inventory.schema";
import {
  productVariantInventoryItems,
  salesChannelStockLocations,
} from "@/db/link.schema";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

const RESERVATION_TTL_MS = 15 * 60 * 1000;

const keyOf = (inventoryItemId: string, locationId: string) =>
  `${inventoryItemId}:${locationId}`;

/**
 * Releases one reservation's quantity, exactly once.
 *
 * Every path that gives stock back goes through here. Releasing is
 * claim-then-decrement, and the claim is the delete: whoever wins it owns the
 * decrement, and everyone else does nothing. Splitting that across entry points
 * is what made the same reservation releasable twice — the expiry sweep and a
 * line release could each read the row while it was still undeleted and each
 * subtract its quantity, reporting stock that is genuinely held.
 *
 * `max(0, ...)` does not help: it stops the total going negative, which is a
 * different problem from releasing the same hold twice.
 *
 * `requireExpiredBefore` is what keeps the sweep from deleting a reservation
 * that was renewed between the read and the claim — the claim has to re-assert
 * the reason it was selected, not just that the row still exists.
 */
async function claimAndRelease(
  db: Awaited<ReturnType<typeof getDb>>,
  reservation: {
    id: string;
    inventoryItemId: string;
    locationId: string;
    quantity: number;
  },
  now: string,
  requireExpiredBefore?: string,
): Promise<boolean> {
  const claim = await env.DATABASE.prepare(
    `
    UPDATE reservation_items
    SET deleted_at = ?1, updated_at = ?1
    WHERE id = ?2
      AND deleted_at IS NULL
      AND (?3 IS NULL OR expires_at < ?3)
  `,
  )
    .bind(now, reservation.id, requireExpiredBefore ?? null)
    .run();
  if ((claim.meta?.changes ?? 0) === 0) return false;

  try {
    await db
      .update(inventoryLevels)
      .set({
        reservedQuantity: sql`max(0, ${inventoryLevels.reservedQuantity} - ${reservation.quantity})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(inventoryLevels.inventoryItemId, reservation.inventoryItemId),
          eq(inventoryLevels.locationId, reservation.locationId),
          isNull(inventoryLevels.deletedAt),
        ),
      );
    return true;
  } catch (error) {
    // The claim already removed the row, so nothing would ever retry this
    // decrement. Put it back and let the next sweep or release own it.
    await env.DATABASE.prepare(
      `UPDATE reservation_items SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2`,
    )
      .bind(now, reservation.id)
      .run();
    throw error;
  }
}

export const cartReservationDal = {
  async availableForVariant(
    variantId: string,
    salesChannelId: string,
  ): Promise<number | null> {
    const db = await getDb();
    const links = await db
      .select()
      .from(productVariantInventoryItems)
      .where(eq(productVariantInventoryItems.variantId, variantId));
    if (!links.length) return null;
    const locations = await db
      .select({ id: salesChannelStockLocations.stockLocationId })
      .from(salesChannelStockLocations)
      .where(eq(salesChannelStockLocations.salesChannelId, salesChannelId));
    if (!locations.length) return 0;
    const levels = await db
      .select()
      .from(inventoryLevels)
      .where(
        and(
          inArray(
            inventoryLevels.inventoryItemId,
            links.map((link) => link.inventoryItemId),
          ),
          inArray(
            inventoryLevels.locationId,
            locations.map((location) => location.id),
          ),
          isNull(inventoryLevels.deletedAt),
        ),
      );
    return Math.max(
      0,
      Math.min(
        ...links.map((link) => {
          const available = levels
            .filter((level) => level.inventoryItemId === link.inventoryItemId)
            .reduce(
              (sum, level) =>
                sum + level.stockedQuantity - level.reservedQuantity,
              0,
            );
          return Math.floor(available / link.requiredQuantity);
        }),
      ),
    );
  },

  async renewCart(cartId: string): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db
      .update(reservationItems)
      .set({
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS).toISOString(),
        updatedAt: now,
      })
      .where(
        and(
          eq(reservationItems.cartId, cartId),
          isNull(reservationItems.deletedAt),
        ),
      );
  },

  async releaseExpired(now = new Date()): Promise<void> {
    const db = await getDb();
    const expired = await db
      .select()
      .from(reservationItems)
      .where(
        and(
          lt(reservationItems.expiresAt, now.toISOString()),
          isNull(reservationItems.deletedAt),
        ),
      );
    for (const reservation of expired) {
      // Re-asserts "still expired" as part of the claim: a renewal between the
      // read above and this write must not be swept away.
      await claimAndRelease(db, reservation, now.toISOString(), now.toISOString());
    }
  },

  async syncLine(input: {
    cartId: string;
    lineItemId: string;
    salesChannelId: string;
    variantId: string;
    quantity: number;
    allowBackorder: boolean;
  }): Promise<{ managed: boolean; success: boolean }> {
    await this.releaseExpired();
    const db = await getDb();
    const links = await db
      .select()
      .from(productVariantInventoryItems)
      .where(eq(productVariantInventoryItems.variantId, input.variantId));
    if (!links.length) return { managed: false, success: true };
    const locations = await db
      .select({ id: salesChannelStockLocations.stockLocationId })
      .from(salesChannelStockLocations)
      .where(
        eq(salesChannelStockLocations.salesChannelId, input.salesChannelId),
      );
    if (!locations.length && !input.allowBackorder)
      return { managed: true, success: false };
    const itemIds = links.map((link) => link.inventoryItemId);
    const [levels, existing] = await Promise.all([
      locations.length
        ? db
            .select()
            .from(inventoryLevels)
            .where(
              and(
                inArray(inventoryLevels.inventoryItemId, itemIds),
                inArray(
                  inventoryLevels.locationId,
                  locations.map((location) => location.id),
                ),
                isNull(inventoryLevels.deletedAt),
              ),
            )
        : [],
      db
        .select()
        .from(reservationItems)
        .where(
          and(
            eq(reservationItems.lineItemId, input.lineItemId),
            isNull(reservationItems.deletedAt),
          ),
        ),
    ]);
    const existingByKey = new Map(
      existing.map((reservation) => [
        keyOf(reservation.inventoryItemId, reservation.locationId),
        reservation.quantity,
      ]),
    );
    const desired = new Map<
      string,
      { inventoryItemId: string; locationId: string; quantity: number }
    >();
    for (const link of links) {
      let remaining = input.quantity * link.requiredQuantity;
      const itemLevels = levels.filter(
        (level) => level.inventoryItemId === link.inventoryItemId,
      );
      for (const level of itemLevels) {
        const key = keyOf(level.inventoryItemId, level.locationId);
        const own = existingByKey.get(key) ?? 0;
        const available = Math.max(
          0,
          level.stockedQuantity - level.reservedQuantity + own,
        );
        const allocated = Math.min(remaining, available);
        if (allocated > 0)
          desired.set(key, {
            inventoryItemId: level.inventoryItemId,
            locationId: level.locationId,
            quantity: allocated,
          });
        remaining -= allocated;
        if (!remaining) break;
      }
      if (remaining > 0) {
        if (!input.allowBackorder) return { managed: true, success: false };
        const fallback = itemLevels[0];
        if (!fallback) return { managed: true, success: false };
        const key = keyOf(fallback.inventoryItemId, fallback.locationId);
        const current = desired.get(key);
        desired.set(key, {
          inventoryItemId: fallback.inventoryItemId,
          locationId: fallback.locationId,
          quantity: (current?.quantity ?? 0) + remaining,
        });
      }
    }
    const keys = new Set([...existingByKey.keys(), ...desired.keys()]);
    const positive: Array<{
      inventoryItemId: string;
      locationId: string;
      delta: number;
    }> = [];
    const negative: typeof positive = [];
    for (const key of keys) {
      const target = desired.get(key);
      const [inventoryItemId, locationId] = key.split(":");
      // The key is built as `${inventoryItemId}:${locationId}`; a key without
      // both halves is a corrupted map entry, not a row to reserve against.
      if (inventoryItemId === undefined || locationId === undefined) continue;
      const delta = (target?.quantity ?? 0) - (existingByKey.get(key) ?? 0);
      if (delta > 0) positive.push({ inventoryItemId, locationId, delta });
      if (delta < 0)
        negative.push({ inventoryItemId, locationId, delta: -delta });
    }
    const applied: typeof positive = [];
    for (const change of positive) {
      const result = await db
        .update(inventoryLevels)
        .set({
          reservedQuantity: sql`${inventoryLevels.reservedQuantity} + ${change.delta}`,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, change.inventoryItemId),
            eq(inventoryLevels.locationId, change.locationId),
            isNull(inventoryLevels.deletedAt),
            input.allowBackorder
              ? sql`1 = 1`
              : sql`${inventoryLevels.stockedQuantity} - ${inventoryLevels.reservedQuantity} >= ${change.delta}`,
          ),
        );
      if (!Number(result.meta.changes ?? 0)) {
        for (const rollback of applied)
          await db
            .update(inventoryLevels)
            .set({
              reservedQuantity: sql`max(0, ${inventoryLevels.reservedQuantity} - ${rollback.delta})`,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(inventoryLevels.inventoryItemId, rollback.inventoryItemId),
                eq(inventoryLevels.locationId, rollback.locationId),
              ),
            );
        return { managed: true, success: false };
      }
      applied.push(change);
    }
    for (const change of negative)
      await db
        .update(inventoryLevels)
        .set({
          reservedQuantity: sql`max(0, ${inventoryLevels.reservedQuantity} - ${change.delta})`,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, change.inventoryItemId),
            eq(inventoryLevels.locationId, change.locationId),
          ),
        );
    if (existing.length)
      await db
        .update(reservationItems)
        .set({
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(reservationItems.lineItemId, input.lineItemId),
            isNull(reservationItems.deletedAt),
          ),
        );
    const timestamp = new Date().toISOString();
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS).toISOString();
    if (desired.size)
      await db.insert(reservationItems).values(
        [...desired.values()].map((reservation) => ({
          id: crypto.randomUUID(),
          cartId: input.cartId,
          lineItemId: input.lineItemId,
          ...reservation,
          allowBackorder: input.allowBackorder,
          description: "Cart inventory reservation",
          expiresAt,
          metadata: {},
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      );
    return { managed: true, success: true };
  },

  async releaseLine(lineItemId: string): Promise<void> {
    const db = await getDb();
    const reservations = await db
      .select()
      .from(reservationItems)
      .where(
        and(
          eq(reservationItems.lineItemId, lineItemId),
          isNull(reservationItems.deletedAt),
        ),
      );
    const now = new Date().toISOString();
    // Same claim as the expiry sweep. Decrementing here and deleting afterwards
    // let this path and the sweep each release the same reservation.
    for (const reservation of reservations) {
      await claimAndRelease(db, reservation, now);
    }
  },
};
