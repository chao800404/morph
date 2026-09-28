import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  inventoryItems,
  inventoryLevels,
  reservationItems,
} from "@/db/inventory.schema";
import { stockLocations } from "@/db/stock-location.schema";
import { likeContains } from "@/lib/db/like-query";
import { firstOrNull, mapFirstOrNull } from "@/lib/db/single-row";
import type { Metadata } from "@/db/json";
import type { ReservationDTO } from "../dto/reservation.dto";
import { and, asc, count, desc, eq, isNull, or, type SQL } from "drizzle-orm";

const active = isNull(reservationItems.deletedAt);

const toDTO = (row: {
  reservation: typeof reservationItems.$inferSelect;
  item: typeof inventoryItems.$inferSelect;
  location: typeof stockLocations.$inferSelect | null;
}): ReservationDTO => ({
  id: row.reservation.id,
  inventoryItemId: row.reservation.inventoryItemId,
  inventoryItemTitle: row.item.title,
  inventoryItemSku: row.item.sku,
  inventoryItemUnitOfMeasure: row.item.unitOfMeasure,
  locationId: row.reservation.locationId,
  locationName: row.location?.name ?? null,
  quantity: row.reservation.quantity,
  allowBackorder: row.reservation.allowBackorder,
  description: row.reservation.description,
  externalId: row.reservation.externalId,
  lineItemId: row.reservation.lineItemId,
  cartId: row.reservation.cartId,
  createdBy: row.reservation.createdBy,
  expiresAt: row.reservation.expiresAt
    ? new Date(row.reservation.expiresAt)
    : null,
  metadata: row.reservation.metadata ?? {},
  createdAt: new Date(row.reservation.createdAt),
  updatedAt: new Date(row.reservation.updatedAt),
  isManual:
    row.reservation.cartId === null && row.reservation.lineItemId === null,
});

const malformedGuard = (error: unknown) =>
  error instanceof Error && error.message.includes("malformed JSON");

export const reservationDal = {
  async findById(id: string): Promise<ReservationDTO | null> {
    const db = await getDb();
    const rows = await db
      .select({
        reservation: reservationItems,
        item: inventoryItems,
        location: stockLocations,
      })
      .from(reservationItems)
      .innerJoin(
        inventoryItems,
        eq(inventoryItems.id, reservationItems.inventoryItemId),
      )
      .leftJoin(
        stockLocations,
        and(
          eq(stockLocations.id, reservationItems.locationId),
          isNull(stockLocations.deletedAt),
        ),
      )
      .where(
        and(
          eq(reservationItems.id, id),
          active,
          isNull(inventoryItems.deletedAt),
        ),
      )
      .limit(1);
    return mapFirstOrNull(rows, toDTO);
  },

  async listPage(options: {
    query?: string | null;
    inventoryItemId?: string;
    locationId?: string;
    manualOnly?: boolean;
    sortBy: "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset?: number;
  }): Promise<{ reservations: ReservationDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [active, isNull(inventoryItems.deletedAt)];
    if (options.inventoryItemId) {
      conditions.push(
        eq(reservationItems.inventoryItemId, options.inventoryItemId),
      );
    }
    if (options.locationId) {
      conditions.push(eq(reservationItems.locationId, options.locationId));
    }
    if (options.manualOnly) {
      conditions.push(
        isNull(reservationItems.cartId),
        isNull(reservationItems.lineItemId),
      );
    }
    if (options.query?.trim()) {
      const query = options.query.trim();
      conditions.push(
        or(
          likeContains(inventoryItems.title, query),
          likeContains(inventoryItems.sku, query),
          likeContains(reservationItems.description, query),
          likeContains(reservationItems.externalId, query),
        ) as SQL,
      );
    }
    const where = and(...conditions);
    const sortColumn =
      options.sortBy === "updatedAt"
        ? reservationItems.updatedAt
        : reservationItems.createdAt;
    const [countRows, rows] = await Promise.all([
      db
        .select({ value: count() })
        .from(reservationItems)
        .innerJoin(
          inventoryItems,
          eq(inventoryItems.id, reservationItems.inventoryItemId),
        )
        .where(where),
      db
        .select({
          reservation: reservationItems,
          item: inventoryItems,
          location: stockLocations,
        })
        .from(reservationItems)
        .innerJoin(
          inventoryItems,
          eq(inventoryItems.id, reservationItems.inventoryItemId),
        )
        .leftJoin(
          stockLocations,
          and(
            eq(stockLocations.id, reservationItems.locationId),
            isNull(stockLocations.deletedAt),
          ),
        )
        .where(where)
        .orderBy(
          options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
        )
        .limit(options.limit)
        .offset(options.offset ?? (options.page - 1) * options.limit),
    ]);
    return {
      reservations: rows.map(toDTO),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async createManual(input: {
    id: string;
    inventoryItemId: string;
    locationId: string;
    quantity: number;
    allowBackorder: boolean;
    description: string | null;
    externalId: string | null;
    metadata: Metadata;
    createdBy: string;
  }): Promise<"created" | "no-level" | "insufficient-stock" | "conflict"> {
    const db = await getDb();
    const level = firstOrNull(
      await db
        .select()
        .from(inventoryLevels)
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, input.inventoryItemId),
            eq(inventoryLevels.locationId, input.locationId),
            isNull(inventoryLevels.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!level) return "no-level";
    if (
      !input.allowBackorder &&
      level.stockedQuantity - level.reservedQuantity < input.quantity
    ) {
      return "insufficient-stock";
    }
    const now = new Date().toISOString();
    try {
      await env.DATABASE.batch([
        env.DATABASE.prepare(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM inventory_items WHERE id = ?1 AND deleted_at IS NULL
           ) AND EXISTS (
             SELECT 1 FROM stock_locations WHERE id = ?2 AND deleted_at IS NULL
           ) AND EXISTS (
             SELECT 1 FROM inventory_levels
             WHERE id = ?3 AND inventory_item_id = ?1 AND location_id = ?2
               AND deleted_at IS NULL AND updated_at = ?4
               AND (?5 = 1 OR stocked_quantity - reserved_quantity >= ?6)
           ) THEN 1 ELSE json('') END`,
        ).bind(
          input.inventoryItemId,
          input.locationId,
          level.id,
          level.updatedAt,
          Number(input.allowBackorder),
          input.quantity,
        ),
        env.DATABASE.prepare(
          `UPDATE inventory_levels SET reserved_quantity = reserved_quantity + ?2, updated_at = ?3
           WHERE id = ?1 AND deleted_at IS NULL AND updated_at = ?4`,
        ).bind(level.id, input.quantity, now, level.updatedAt),
        env.DATABASE.prepare(
          `INSERT INTO reservation_items
             (id, inventory_item_id, location_id, quantity, allow_backorder,
              description, external_id, created_by, metadata, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
        ).bind(
          input.id,
          input.inventoryItemId,
          input.locationId,
          input.quantity,
          Number(input.allowBackorder),
          input.description,
          input.externalId,
          input.createdBy,
          JSON.stringify(input.metadata),
          now,
        ),
      ]);
      return "created";
    } catch (error) {
      if (!malformedGuard(error)) throw error;
      const latest = firstOrNull(
        await db
          .select()
          .from(inventoryLevels)
          .where(
            and(
              eq(inventoryLevels.inventoryItemId, input.inventoryItemId),
              eq(inventoryLevels.locationId, input.locationId),
              isNull(inventoryLevels.deletedAt),
            ),
          )
          .limit(1),
      );
      if (!latest) return "no-level";
      if (
        !input.allowBackorder &&
        latest.stockedQuantity - latest.reservedQuantity < input.quantity
      ) {
        return "insufficient-stock";
      }
      return "conflict";
    }
  },

  async updateManual(input: {
    id: string;
    quantity: number;
    allowBackorder: boolean;
    description: string | null;
    externalId: string | null;
    metadata: Metadata;
  }): Promise<
    | "updated"
    | "not-found"
    | "not-manual"
    | "no-level"
    | "insufficient-stock"
    | "conflict"
  > {
    const db = await getDb();
    const reservation = await db
      .select()
      .from(reservationItems)
      .where(and(eq(reservationItems.id, input.id), active))
      .limit(1);
    const current = firstOrNull(reservation);
    if (!current) return "not-found";
    if (current.cartId !== null || current.lineItemId !== null)
      return "not-manual";
    const level = firstOrNull(
      await db
        .select()
        .from(inventoryLevels)
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, current.inventoryItemId),
            eq(inventoryLevels.locationId, current.locationId),
            isNull(inventoryLevels.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!level) return "no-level";
    const delta = input.quantity - current.quantity;
    if (
      delta > 0 &&
      !input.allowBackorder &&
      level.stockedQuantity - level.reservedQuantity < delta
    ) {
      return "insufficient-stock";
    }
    const now = new Date().toISOString();
    try {
      await env.DATABASE.batch([
        env.DATABASE.prepare(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM reservation_items
             WHERE id = ?1 AND deleted_at IS NULL AND cart_id IS NULL AND line_item_id IS NULL
               AND updated_at = ?2 AND quantity = ?3
           ) AND EXISTS (
             SELECT 1 FROM inventory_levels
             WHERE id = ?4 AND inventory_item_id = ?5 AND location_id = ?6
               AND deleted_at IS NULL AND updated_at = ?7
               AND reserved_quantity >= ?3
               AND (?8 <= 0 OR ?9 = 1 OR stocked_quantity - reserved_quantity >= ?8)
           ) THEN 1 ELSE json('') END`,
        ).bind(
          input.id,
          current.updatedAt,
          current.quantity,
          level.id,
          current.inventoryItemId,
          current.locationId,
          level.updatedAt,
          delta,
          Number(input.allowBackorder),
        ),
        env.DATABASE.prepare(
          `UPDATE inventory_levels SET reserved_quantity = reserved_quantity + ?2, updated_at = ?3
           WHERE id = ?1 AND deleted_at IS NULL AND updated_at = ?4`,
        ).bind(level.id, delta, now, level.updatedAt),
        env.DATABASE.prepare(
          `UPDATE reservation_items SET quantity = ?2, allow_backorder = ?3,
             description = ?4, external_id = ?5, metadata = ?6, updated_at = ?7
           WHERE id = ?1 AND deleted_at IS NULL AND cart_id IS NULL AND line_item_id IS NULL
             AND updated_at = ?8`,
        ).bind(
          input.id,
          input.quantity,
          Number(input.allowBackorder),
          input.description,
          input.externalId,
          JSON.stringify(input.metadata),
          now,
          current.updatedAt,
        ),
      ]);
      return "updated";
    } catch (error) {
      if (!malformedGuard(error)) throw error;
      const latest = firstOrNull(
        await db
          .select()
          .from(reservationItems)
          .where(and(eq(reservationItems.id, input.id), active))
          .limit(1),
      );
      if (!latest) return "not-found";
      if (latest.cartId !== null || latest.lineItemId !== null)
        return "not-manual";
      const latestLevel = firstOrNull(
        await db
          .select()
          .from(inventoryLevels)
          .where(
            and(
              eq(inventoryLevels.inventoryItemId, latest.inventoryItemId),
              eq(inventoryLevels.locationId, latest.locationId),
              isNull(inventoryLevels.deletedAt),
            ),
          )
          .limit(1),
      );
      if (!latestLevel) return "no-level";
      const latestDelta = input.quantity - latest.quantity;
      if (
        latestDelta > 0 &&
        !input.allowBackorder &&
        latestLevel.stockedQuantity - latestLevel.reservedQuantity < latestDelta
      ) {
        return "insufficient-stock";
      }
      return "conflict";
    }
  },

  async deleteManual(
    id: string,
  ): Promise<"deleted" | "not-found" | "not-manual" | "no-level" | "conflict"> {
    const db = await getDb();
    const current = firstOrNull(
      await db
        .select()
        .from(reservationItems)
        .where(and(eq(reservationItems.id, id), active))
        .limit(1),
    );
    if (!current) return "not-found";
    if (current.cartId !== null || current.lineItemId !== null)
      return "not-manual";
    const level = firstOrNull(
      await db
        .select()
        .from(inventoryLevels)
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, current.inventoryItemId),
            eq(inventoryLevels.locationId, current.locationId),
            isNull(inventoryLevels.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!level) return "no-level";
    const now = new Date().toISOString();
    try {
      await env.DATABASE.batch([
        env.DATABASE.prepare(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM reservation_items
             WHERE id = ?1 AND deleted_at IS NULL AND cart_id IS NULL AND line_item_id IS NULL
               AND quantity = ?2 AND updated_at = ?3
           ) AND EXISTS (
             SELECT 1 FROM inventory_levels
             WHERE id = ?4 AND inventory_item_id = ?5 AND location_id = ?6
               AND deleted_at IS NULL AND updated_at = ?7 AND reserved_quantity >= ?2
           ) THEN 1 ELSE json('') END`,
        ).bind(
          id,
          current.quantity,
          current.updatedAt,
          level.id,
          current.inventoryItemId,
          current.locationId,
          level.updatedAt,
        ),
        env.DATABASE.prepare(
          `UPDATE inventory_levels SET reserved_quantity = reserved_quantity - ?2, updated_at = ?3
           WHERE id = ?1 AND deleted_at IS NULL AND updated_at = ?4 AND reserved_quantity >= ?2`,
        ).bind(level.id, current.quantity, now, level.updatedAt),
        env.DATABASE.prepare(
          `UPDATE reservation_items SET deleted_at = ?2, updated_at = ?2
           WHERE id = ?1 AND deleted_at IS NULL AND cart_id IS NULL AND line_item_id IS NULL
             AND updated_at = ?3`,
        ).bind(id, now, current.updatedAt),
      ]);
      return "deleted";
    } catch (error) {
      if (!malformedGuard(error)) throw error;
      const latest = firstOrNull(
        await db
          .select()
          .from(reservationItems)
          .where(and(eq(reservationItems.id, id), active))
          .limit(1),
      );
      if (!latest) return "not-found";
      if (latest.cartId !== null || latest.lineItemId !== null)
        return "not-manual";
      if (!(await this.findById(id))) return "no-level";
      return "conflict";
    }
  },
};
