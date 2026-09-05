import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { inventoryLevels, reservationItems } from "@/db/inventory.schema";
import {
  productVariantInventoryItems,
  salesChannelStockLocations,
} from "@/db/link.schema";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";

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
  reservation: {
    id: string;
    inventoryItemId: string;
    locationId: string;
    quantity: number;
  },
  now: string,
  requireExpiredBefore?: string,
): Promise<boolean> {
  // D1 serialises the entire batch. Both statements see the same live hold;
  // any failure rolls back both, without relying on a later compensation.
  // Read quantity from the row, never from the caller's earlier snapshot.
  const results = await env.DATABASE.batch([
    env.DATABASE.prepare(
      `
      UPDATE inventory_levels
      SET reserved_quantity = max(0, reserved_quantity - (
        SELECT quantity FROM reservation_items WHERE id = ?1
      )), updated_at = ?2
      WHERE deleted_at IS NULL AND EXISTS (
        SELECT 1 FROM reservation_items r
        WHERE r.id = ?1 AND r.deleted_at IS NULL
          AND (?3 IS NULL OR r.expires_at < ?3)
          AND r.inventory_item_id = inventory_levels.inventory_item_id
          AND r.location_id = inventory_levels.location_id
      )
    `,
    ).bind(reservation.id, now, requireExpiredBefore ?? null),
    env.DATABASE.prepare(
      `
      UPDATE reservation_items SET deleted_at = ?2, updated_at = ?2
      WHERE id = ?1 AND deleted_at IS NULL
        AND (?3 IS NULL OR expires_at < ?3)
    `,
    ).bind(reservation.id, now, requireExpiredBefore ?? null),
  ]);
  return (results[1]?.meta.changes ?? 0) > 0;
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
      await claimAndRelease(reservation, now.toISOString(), now.toISOString());
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
    const timestamp = new Date().toISOString();
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS).toISOString();
    // One aggregate write, including the read-set CAS. A renewal, release or
    // competing sync invalidates this plan before any inventory is changed.
    // JSON input keeps the guard's bind count constant for multi-location carts.
    const statements = [
      env.DATABASE.prepare(
        `
      SELECT CASE WHEN
        (SELECT count(*) FROM reservation_items WHERE line_item_id = ?1 AND deleted_at IS NULL) = json_array_length(?2)
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?2) snapshot WHERE NOT EXISTS (
            SELECT 1 FROM reservation_items r
            WHERE r.id = json_extract(snapshot.value, '$.id')
              AND r.line_item_id = ?1 AND r.cart_id = ?3 AND r.deleted_at IS NULL
              AND r.quantity = json_extract(snapshot.value, '$.quantity')
              AND r.inventory_item_id = json_extract(snapshot.value, '$.inventoryItemId')
              AND r.location_id = json_extract(snapshot.value, '$.locationId')
              AND r.updated_at IS json_extract(snapshot.value, '$.updatedAt')
              AND r.expires_at IS json_extract(snapshot.value, '$.expiresAt')
          )
        ) THEN 1 ELSE json('') END
    `,
      ).bind(input.lineItemId, JSON.stringify(existing), input.cartId),
    ];
    for (const change of [
      ...positive,
      ...negative.map((value) => ({ ...value, delta: -value.delta })),
    ]) {
      statements.push(
        env.DATABASE.prepare(
          `
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM inventory_levels
          WHERE inventory_item_id = ?1 AND location_id = ?2 AND deleted_at IS NULL
            AND reserved_quantity + ?3 >= 0
            AND (?3 <= 0 OR ?4 = 1 OR stocked_quantity - reserved_quantity >= ?3)
        ) THEN 1 ELSE json('') END
      `,
        ).bind(
          change.inventoryItemId,
          change.locationId,
          change.delta,
          Number(input.allowBackorder),
        ),
      );
      statements.push(
        env.DATABASE.prepare(
          `
        UPDATE inventory_levels SET reserved_quantity = reserved_quantity + ?3, updated_at = ?4
        WHERE inventory_item_id = ?1 AND location_id = ?2 AND deleted_at IS NULL
      `,
        ).bind(
          change.inventoryItemId,
          change.locationId,
          change.delta,
          timestamp,
        ),
      );
    }
    statements.push(
      env.DATABASE.prepare(
        `
      UPDATE reservation_items SET deleted_at = ?2, updated_at = ?2
      WHERE line_item_id = ?1 AND deleted_at IS NULL
    `,
      ).bind(input.lineItemId, timestamp),
    );
    for (const reservation of desired.values()) {
      statements.push(
        env.DATABASE.prepare(
          `
        INSERT INTO reservation_items
          (id, cart_id, line_item_id, inventory_item_id, location_id, quantity,
           allow_backorder, description, expires_at, metadata, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'Cart inventory reservation', ?8, '{}', ?9, ?9)
      `,
        ).bind(
          crypto.randomUUID(),
          input.cartId,
          input.lineItemId,
          reservation.inventoryItemId,
          reservation.locationId,
          reservation.quantity,
          Number(input.allowBackorder),
          expiresAt,
          timestamp,
        ),
      );
    }
    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      // Only our SQL precondition failure is a normal unavailable/conflict.
      // Storage failures remain failures; the whole batch has rolled back.
      if (error instanceof Error && error.message.includes("malformed JSON")) {
        return { managed: true, success: false };
      }
      throw error;
    }
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
      await claimAndRelease(reservation, now);
    }
  },
};
