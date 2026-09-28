import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { cartLineItems } from "@/db/cart.schema";
import {
  inventoryItems,
  inventoryLevels,
  reservationItems,
} from "@/db/inventory.schema";
import { productVariantInventoryItems } from "@/db/link.schema";
import { orderLineItems } from "@/db/order.schema";
import { products, productVariants } from "@/db/product.schema";
import { stockLocations } from "@/db/stock-location.schema";
import { likeContains } from "@/lib/db/like-query";
import { firstOrNull } from "@/lib/db/single-row";
import type { Metadata } from "@/db/json";
import type { InventoryListItemDTO } from "../dto/inventory.dto";
import type {
  VariantInventoryKitItemDTO,
  VariantInventoryKitItemInput,
} from "../dto/inventory-kit.dto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  isNotNull,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

const active = isNull(inventoryItems.deletedAt);

const hasActiveVariantReservation = async (
  db: Awaited<ReturnType<typeof getDb>>,
  variantId: string,
): Promise<boolean> => {
  const activeCartLine = db
    .select({ id: cartLineItems.id })
    .from(cartLineItems)
    .where(
      and(
        eq(cartLineItems.id, reservationItems.lineItemId),
        eq(cartLineItems.variantId, variantId),
        isNull(cartLineItems.deletedAt),
      ),
    );
  const activeOrderLine = db
    .select({ id: orderLineItems.id })
    .from(orderLineItems)
    .where(
      and(
        eq(orderLineItems.id, reservationItems.lineItemId),
        eq(orderLineItems.variantId, variantId),
        isNull(orderLineItems.deletedAt),
      ),
    );
  const rows = await db
    .select({ id: reservationItems.id })
    .from(reservationItems)
    .where(
      and(
        isNull(reservationItems.deletedAt),
        or(
          and(isNotNull(reservationItems.cartId), exists(activeCartLine)),
          and(isNull(reservationItems.cartId), exists(activeOrderLine)),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
};

export const inventoryDal = {
  async findById(
    id: string,
    options?: { withDeletedLocationLevels?: boolean },
  ): Promise<InventoryListItemDTO | null> {
    const result = await this.listPage({
      id,
      ...(options?.withDeletedLocationLevels
        ? { withDeletedLevels: true }
        : {}),
      sortBy: "createdAt",
      sortOrder: "desc",
      page: 1,
      limit: 1,
    });
    return firstOrNull(result.items);
  },

  async listVariantKit(
    variantId: string,
  ): Promise<VariantInventoryKitItemDTO[]> {
    const db = await getDb();
    const rows = await db
      .select({
        inventoryItemId: productVariantInventoryItems.inventoryItemId,
        title: inventoryItems.title,
        sku: inventoryItems.sku,
        unitOfMeasure: inventoryItems.unitOfMeasure,
        requiredQuantity: productVariantInventoryItems.requiredQuantity,
        stockedQuantity: sql<number>`coalesce(sum(${inventoryLevels.stockedQuantity}), 0)`,
        reservedQuantity: sql<number>`coalesce(sum(${inventoryLevels.reservedQuantity}), 0)`,
        incomingQuantity: sql<number>`coalesce(sum(${inventoryLevels.incomingQuantity}), 0)`,
      })
      .from(productVariantInventoryItems)
      .innerJoin(
        inventoryItems,
        eq(inventoryItems.id, productVariantInventoryItems.inventoryItemId),
      )
      .leftJoin(
        inventoryLevels,
        and(
          eq(inventoryLevels.inventoryItemId, inventoryItems.id),
          isNull(inventoryLevels.deletedAt),
        ),
      )
      .where(
        and(
          eq(productVariantInventoryItems.variantId, variantId),
          isNull(inventoryItems.deletedAt),
        ),
      )
      .groupBy(
        productVariantInventoryItems.inventoryItemId,
        productVariantInventoryItems.requiredQuantity,
        inventoryItems.id,
      )
      .orderBy(asc(inventoryItems.title), asc(inventoryItems.id));
    return rows.map((row) => ({
      ...row,
      availableQuantity: Math.max(
        0,
        row.stockedQuantity - row.reservedQuantity,
      ),
    }));
  },

  async replaceVariantKit(input: {
    productId: string;
    variantId: string;
    expectedUpdatedAt: string;
    items: VariantInventoryKitItemInput[];
    updatedBy: string;
  }): Promise<"updated" | "not-found" | "active-reservations" | "conflict"> {
    return this.replaceVariantKits([input]);
  },

  async replaceVariantKits(
    inputs: Array<{
      productId: string;
      variantId: string;
      expectedUpdatedAt: string;
      items: VariantInventoryKitItemInput[];
      updatedBy: string;
    }>,
  ): Promise<"updated" | "not-found" | "active-reservations" | "conflict"> {
    if (inputs.length === 0) return "updated";
    if (
      new Set(inputs.map((input) => input.variantId)).size !== inputs.length
    ) {
      return "conflict";
    }
    const db = await getDb();
    const now = new Date().toISOString();
    const replacements = inputs.map((input) => ({
      ...input,
      updatedAt: now,
    }));
    const replacementsJson = JSON.stringify(replacements);
    try {
      await env.DATABASE.batch([
        env.DATABASE.prepare(
          `SELECT CASE WHEN NOT EXISTS (
             SELECT 1 FROM json_each(?1) requested
             LEFT JOIN product_variants v
               ON v.id = json_extract(requested.value, '$.variantId')
              AND v.product_id = json_extract(requested.value, '$.productId')
              AND v.deleted_at IS NULL
             LEFT JOIN products p
               ON p.id = v.product_id AND p.deleted_at IS NULL
             WHERE v.id IS NULL OR p.id IS NULL
                OR v.updated_at <> json_extract(requested.value, '$.expectedUpdatedAt')
           ) AND NOT EXISTS (
             SELECT 1 FROM json_each(?1) requestedKit,
               json_each(json_extract(requestedKit.value, '$.items')) requested
             LEFT JOIN inventory_items i
               ON i.id = json_extract(requested.value, '$.inventoryItemId')
              AND i.deleted_at IS NULL
             WHERE i.id IS NULL
           ) AND NOT EXISTS (
             SELECT 1 FROM reservation_items r
             WHERE r.deleted_at IS NULL AND (
               (r.cart_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM cart_line_items cli
                 WHERE cli.id = r.line_item_id AND cli.variant_id IN (
                   SELECT json_extract(value, '$.variantId')
                   FROM json_each(?1)
                 )
                   AND cli.deleted_at IS NULL
               )) OR (r.cart_id IS NULL AND EXISTS (
                 SELECT 1 FROM order_line_items oli
                 WHERE oli.id = r.line_item_id AND oli.variant_id IN (
                   SELECT json_extract(value, '$.variantId')
                   FROM json_each(?1)
                 )
                   AND oli.deleted_at IS NULL
               ))
             )
           ) THEN 1 ELSE json('') END;`,
        ).bind(replacementsJson),
        env.DATABASE.prepare(
          `DELETE FROM product_variant_inventory_items
           WHERE variant_id IN (
             SELECT json_extract(value, '$.variantId') FROM json_each(?1)
           )`,
        ).bind(replacementsJson),
        env.DATABASE.prepare(
          `INSERT INTO product_variant_inventory_items
             (variant_id, inventory_item_id, required_quantity, created_at, updated_at)
           SELECT json_extract(requestedKit.value, '$.variantId'),
             json_extract(requested.value, '$.inventoryItemId'),
             json_extract(requested.value, '$.requiredQuantity'),
             json_extract(requestedKit.value, '$.updatedAt'),
             json_extract(requestedKit.value, '$.updatedAt')
           FROM json_each(?1) requestedKit,
             json_each(json_extract(requestedKit.value, '$.items')) requested`,
        ).bind(replacementsJson),
        env.DATABASE.prepare(
          `UPDATE product_variants
           SET updated_at = (
                 SELECT json_extract(requested.value, '$.updatedAt')
                 FROM json_each(?1) requested
                 WHERE json_extract(requested.value, '$.variantId') = product_variants.id
               ),
               updated_by = (
                 SELECT json_extract(requested.value, '$.updatedBy')
                 FROM json_each(?1) requested
                 WHERE json_extract(requested.value, '$.variantId') = product_variants.id
               )
           WHERE id IN (
             SELECT json_extract(requested.value, '$.variantId')
             FROM json_each(?1) requested
           )
             AND EXISTS (
               SELECT 1 FROM json_each(?1) requested
               WHERE json_extract(requested.value, '$.variantId') = product_variants.id
                 AND json_extract(requested.value, '$.productId') = product_variants.product_id
                 AND json_extract(requested.value, '$.expectedUpdatedAt') = product_variants.updated_at
             )
             AND deleted_at IS NULL`,
        ).bind(replacementsJson),
      ]);
      return "updated";
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("malformed JSON")
      ) {
        throw error;
      }
      const variantRows = await db
        .select({
          id: productVariants.id,
          productId: productVariants.productId,
          updatedAt: productVariants.updatedAt,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(
          and(
            inArray(
              productVariants.id,
              inputs.map((input) => input.variantId),
            ),
            isNull(productVariants.deletedAt),
            isNull(products.deletedAt),
          ),
        );
      const variantsById = new Map(variantRows.map((row) => [row.id, row]));
      if (
        inputs.some((input) => {
          const variant = variantsById.get(input.variantId);
          return !variant || variant.productId !== input.productId;
        })
      ) {
        return "not-found";
      }
      if (
        inputs.some(
          (input) =>
            variantsById.get(input.variantId)?.updatedAt !==
            input.expectedUpdatedAt,
        )
      ) {
        return "conflict";
      }
      const requestedItemIds = [
        ...new Set(
          inputs.flatMap((input) =>
            input.items.map((item) => item.inventoryItemId),
          ),
        ),
      ];
      const activeItemIds = new Set<string>();
      for (let offset = 0; offset < requestedItemIds.length; offset += 400) {
        const rows = await db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(
            and(
              inArray(
                inventoryItems.id,
                requestedItemIds.slice(offset, offset + 400),
              ),
              isNull(inventoryItems.deletedAt),
            ),
          );
        for (const row of rows) activeItemIds.add(row.id);
      }
      if (requestedItemIds.some((id) => !activeItemIds.has(id))) {
        return "not-found";
      }
      for (const input of inputs) {
        if (await hasActiveVariantReservation(db, input.variantId)) {
          return "active-reservations";
        }
      }
      return "conflict";
    }
  },

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

  async findBySku(sku: string): Promise<{ id: string } | null> {
    const db = await getDb();
    const rows = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.sku, sku), active))
      .limit(1);
    return firstOrNull(rows);
  },

  async createItem(input: {
    id: string;
    title: string;
    sku: string | null;
    description: string | null;
    thumbnail: string | null;
    unitOfMeasure: string | null;
    requiresShipping: boolean;
    weight: number | null;
    length: number | null;
    height: number | null;
    width: number | null;
    originCountry: string | null;
    hsCode: string | null;
    midCode: string | null;
    material: string | null;
    metadata: Metadata;
    locationLevels: Array<{
      locationId: string;
      stockedQuantity: number;
      incomingQuantity: number;
    }>;
  }): Promise<"created" | "invalid-location" | "sku-conflict"> {
    const now = new Date().toISOString();
    const statements = [];
    if (input.locationLevels.length) {
      const locationIds = input.locationLevels.map((level) => level.locationId);
      statements.push(
        env.DATABASE.prepare(
          `SELECT CASE WHEN
            (SELECT count(*) FROM stock_locations
             WHERE id IN (SELECT value FROM json_each(?1)) AND deleted_at IS NULL)
              = json_array_length(?1)
            THEN 1 ELSE json('') END`,
        ).bind(JSON.stringify(locationIds)),
      );
    }
    statements.push(
      env.DATABASE.prepare(
        `INSERT INTO inventory_items
          (id, sku, title, description, thumbnail, unit_of_measure, requires_shipping, weight,
           length, height, width, origin_country, hs_code, mid_code, material,
           metadata, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)`,
      ).bind(
        input.id,
        input.sku,
        input.title,
        input.description,
        input.thumbnail,
        input.unitOfMeasure,
        Number(input.requiresShipping),
        input.weight,
        input.length,
        input.height,
        input.width,
        input.originCountry,
        input.hsCode,
        input.midCode,
        input.material,
        JSON.stringify(input.metadata),
        now,
      ),
    );
    for (const level of input.locationLevels) {
      statements.push(
        env.DATABASE.prepare(
          `INSERT INTO inventory_levels
            (id, inventory_item_id, location_id, stocked_quantity,
             reserved_quantity, incoming_quantity, metadata, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 0, ?5, '{}', ?6, ?6)`,
        ).bind(
          crypto.randomUUID(),
          input.id,
          level.locationId,
          level.stockedQuantity,
          level.incomingQuantity,
          now,
        ),
      );
    }
    try {
      await env.DATABASE.batch(statements);
      return "created";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("malformed JSON")) return "invalid-location";
      if (
        message.includes("inventory_items_active_sku_unique") ||
        message.includes("UNIQUE constraint failed: inventory_items.sku")
      ) {
        return "sku-conflict";
      }
      throw error;
    }
  },

  async updateItem(
    id: string,
    input: Partial<{
      title: string;
      sku: string | null;
      description: string | null;
      thumbnail: string | null;
      unitOfMeasure: string | null;
      requiresShipping: boolean;
      weight: number | null;
      length: number | null;
      height: number | null;
      width: number | null;
      originCountry: string | null;
      hsCode: string | null;
      midCode: string | null;
      material: string | null;
      metadata: Metadata;
    }>,
  ): Promise<"updated" | "not-found" | "sku-conflict"> {
    const db = await getDb();
    try {
      const rows = await db
        .update(inventoryItems)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(and(eq(inventoryItems.id, id), active))
        .returning({ id: inventoryItems.id });
      if (rows.length === 0) return "not-found";
      return "updated";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message.includes("inventory_items_active_sku_unique") ||
        message.includes("UNIQUE constraint failed: inventory_items.sku")
      ) {
        return "sku-conflict";
      }
      throw error;
    }
  },

  async setLocationLevels(
    inventoryItemId: string,
    levels: Array<{
      locationId: string;
      stockedQuantity: number;
      incomingQuantity?: number;
    }>,
  ): Promise<
    | "updated"
    | "not-found"
    | "invalid-location"
    | "reserved-quantity"
    | "conflict"
  > {
    const db = await getDb();
    const item = firstOrNull(
      await db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.id, inventoryItemId), active))
        .limit(1),
    );
    if (!item) return "not-found";

    const desiredByLocation = new Map(
      levels.map((level) => [level.locationId, level]),
    );
    if (desiredByLocation.size !== levels.length) return "invalid-location";
    const locationIds = levels.map((level) => level.locationId);
    const [locations, currentLevels] = await Promise.all([
      locationIds.length
        ? db
            .select({ id: stockLocations.id })
            .from(stockLocations)
            .where(
              and(
                inArray(stockLocations.id, locationIds),
                isNull(stockLocations.deletedAt),
              ),
            )
        : [],
      db
        .select()
        .from(inventoryLevels)
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, inventoryItemId),
            isNull(inventoryLevels.deletedAt),
          ),
        ),
    ]);
    if (locations.length !== locationIds.length) return "invalid-location";
    if (levels.length === 0) return "updated";

    const currentByLocation = new Map(
      currentLevels.map((level) => [level.locationId, level]),
    );
    for (const level of levels) {
      const current = currentByLocation.get(level.locationId);
      if (current && current.reservedQuantity > level.stockedQuantity) {
        return "reserved-quantity";
      }
    }

    const now = new Date().toISOString();
    const statements = [];
    for (const level of levels) {
      const current = currentByLocation.get(level.locationId);
      if (current) {
        statements.push(
          env.DATABASE.prepare(
            `SELECT CASE WHEN EXISTS (
               SELECT 1 FROM inventory_items
               WHERE id = ?1 AND deleted_at IS NULL
             ) AND EXISTS (
               SELECT 1 FROM stock_locations
               WHERE id = ?2 AND deleted_at IS NULL
             ) AND EXISTS (
               SELECT 1 FROM inventory_levels
               WHERE id = ?3 AND inventory_item_id = ?1 AND location_id = ?2
                 AND deleted_at IS NULL AND updated_at = ?4
                 AND reserved_quantity <= ?5
             ) THEN 1 ELSE json('') END`,
          ).bind(
            inventoryItemId,
            level.locationId,
            current.id,
            current.updatedAt,
            level.stockedQuantity,
          ),
        );
      } else {
        statements.push(
          env.DATABASE.prepare(
            `SELECT CASE WHEN EXISTS (
               SELECT 1 FROM inventory_items
               WHERE id = ?1 AND deleted_at IS NULL
             ) AND EXISTS (
               SELECT 1 FROM stock_locations
               WHERE id = ?2 AND deleted_at IS NULL
             ) AND NOT EXISTS (
               SELECT 1 FROM inventory_levels
               WHERE inventory_item_id = ?1 AND location_id = ?2
                 AND deleted_at IS NULL
             ) THEN 1 ELSE json('') END`,
          ).bind(inventoryItemId, level.locationId),
        );
      }
    }
    for (const level of levels) {
      const current = currentByLocation.get(level.locationId);
      statements.push(
        env.DATABASE.prepare(
          `INSERT INTO inventory_levels
            (id, inventory_item_id, location_id, stocked_quantity,
             reserved_quantity, incoming_quantity, metadata, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 0, ?5, '{}', ?6, ?6)
           ON CONFLICT(inventory_item_id, location_id) WHERE deleted_at IS NULL
           DO UPDATE SET stocked_quantity = excluded.stocked_quantity,
             incoming_quantity = excluded.incoming_quantity,
             updated_at = excluded.updated_at`,
        ).bind(
          crypto.randomUUID(),
          inventoryItemId,
          level.locationId,
          level.stockedQuantity,
          level.incomingQuantity ?? current?.incomingQuantity ?? 0,
          now,
        ),
      );
    }
    try {
      await env.DATABASE.batch(statements);
      return "updated";
    } catch (error) {
      if (error instanceof Error && error.message.includes("malformed JSON")) {
        const latest = await db
          .select({
            locationId: inventoryLevels.locationId,
            reserved: inventoryLevels.reservedQuantity,
          })
          .from(inventoryLevels)
          .where(
            and(
              eq(inventoryLevels.inventoryItemId, inventoryItemId),
              isNull(inventoryLevels.deletedAt),
            ),
          );
        const latestByLocation = new Map(
          latest.map((level) => [level.locationId, level]),
        );
        if (
          levels.some(
            (level) =>
              (latestByLocation.get(level.locationId)?.reserved ?? 0) >
              level.stockedQuantity,
          )
        ) {
          return "reserved-quantity";
        }
        return "conflict";
      }
      throw error;
    }
  },

  async createLocationLevel(input: {
    inventoryItemId: string;
    locationId: string;
    stockedQuantity: number;
    incomingQuantity: number;
  }): Promise<"created" | "not-found" | "invalid-location" | "conflict"> {
    const db = await getDb();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      await env.DATABASE.batch([
        env.DATABASE.prepare(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM inventory_items
             WHERE id = ?1 AND deleted_at IS NULL
           ) AND EXISTS (
             SELECT 1 FROM stock_locations
             WHERE id = ?2 AND deleted_at IS NULL
           ) AND NOT EXISTS (
             SELECT 1 FROM inventory_levels
             WHERE inventory_item_id = ?1 AND location_id = ?2
               AND deleted_at IS NULL
           ) THEN 1 ELSE json('') END`,
        ).bind(input.inventoryItemId, input.locationId),
        env.DATABASE.prepare(
          `INSERT INTO inventory_levels
            (id, inventory_item_id, location_id, stocked_quantity,
             reserved_quantity, incoming_quantity, metadata, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 0, ?5, '{}', ?6, ?6)`,
        ).bind(
          id,
          input.inventoryItemId,
          input.locationId,
          input.stockedQuantity,
          input.incomingQuantity,
          now,
        ),
      ]);
      return "created";
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("malformed JSON")
      ) {
        throw error;
      }
      const [item, location] = await Promise.all([
        db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.id, input.inventoryItemId), active))
          .limit(1),
        db
          .select({ id: stockLocations.id })
          .from(stockLocations)
          .where(
            and(
              eq(stockLocations.id, input.locationId),
              isNull(stockLocations.deletedAt),
            ),
          )
          .limit(1),
      ]);
      if (!item.length) return "not-found";
      if (!location.length) return "invalid-location";
      return "conflict";
    }
  },

  async updateLocationLevel(
    inventoryItemId: string,
    locationId: string,
    input: { stockedQuantity?: number; incomingQuantity?: number },
  ): Promise<
    | "updated"
    | "not-found"
    | "invalid-location"
    | "reserved-quantity"
    | "conflict"
  > {
    const db = await getDb();
    const [item, location, level] = await Promise.all([
      db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.id, inventoryItemId), active))
        .limit(1),
      db
        .select({ id: stockLocations.id })
        .from(stockLocations)
        .where(
          and(
            eq(stockLocations.id, locationId),
            isNull(stockLocations.deletedAt),
          ),
        )
        .limit(1),
      db
        .select()
        .from(inventoryLevels)
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, inventoryItemId),
            eq(inventoryLevels.locationId, locationId),
            isNull(inventoryLevels.deletedAt),
          ),
        )
        .limit(1),
    ]);
    if (!item.length) return "not-found";
    if (!location.length) return "invalid-location";
    const current = firstOrNull(level);
    if (!current) return "not-found";
    const stockedQuantity = input.stockedQuantity ?? current.stockedQuantity;
    if (current.reservedQuantity > stockedQuantity) return "reserved-quantity";

    const hasStockedQuantity = input.stockedQuantity !== undefined;
    const hasIncomingQuantity = input.incomingQuantity !== undefined;
    const now = new Date().toISOString();
    try {
      await env.DATABASE.batch([
        env.DATABASE.prepare(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM inventory_items
             WHERE id = ?1 AND deleted_at IS NULL
           ) AND EXISTS (
             SELECT 1 FROM stock_locations
             WHERE id = ?2 AND deleted_at IS NULL
           ) AND EXISTS (
             SELECT 1 FROM inventory_levels
             WHERE id = ?3 AND inventory_item_id = ?1 AND location_id = ?2
               AND deleted_at IS NULL AND updated_at = ?4
               AND (?5 = 0 OR reserved_quantity <= ?6)
           ) THEN 1 ELSE json('') END`,
        ).bind(
          inventoryItemId,
          locationId,
          current.id,
          current.updatedAt,
          hasStockedQuantity ? 1 : 0,
          input.stockedQuantity ?? 0,
        ),
        env.DATABASE.prepare(
          `UPDATE inventory_levels
           SET stocked_quantity = CASE WHEN ?2 = 1 THEN ?3 ELSE stocked_quantity END,
               incoming_quantity = CASE WHEN ?4 = 1 THEN ?5 ELSE incoming_quantity END,
               updated_at = ?6
           WHERE id = ?1 AND deleted_at IS NULL AND updated_at = ?7`,
        ).bind(
          current.id,
          hasStockedQuantity ? 1 : 0,
          input.stockedQuantity ?? 0,
          hasIncomingQuantity ? 1 : 0,
          input.incomingQuantity ?? 0,
          now,
          current.updatedAt,
        ),
      ]);
      return "updated";
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("malformed JSON")
      ) {
        throw error;
      }
      const [latestItem, latestLocation, latestLevel] = await Promise.all([
        db
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.id, inventoryItemId), active))
          .limit(1),
        db
          .select({ id: stockLocations.id })
          .from(stockLocations)
          .where(
            and(
              eq(stockLocations.id, locationId),
              isNull(stockLocations.deletedAt),
            ),
          )
          .limit(1),
        db
          .select()
          .from(inventoryLevels)
          .where(
            and(
              eq(inventoryLevels.inventoryItemId, inventoryItemId),
              eq(inventoryLevels.locationId, locationId),
              isNull(inventoryLevels.deletedAt),
            ),
          )
          .limit(1),
      ]);
      if (!latestItem.length || !latestLevel.length) return "not-found";
      if (!latestLocation.length) return "invalid-location";
      const latest = latestLevel[0];
      if (
        hasStockedQuantity &&
        latest &&
        latest.reservedQuantity > (input.stockedQuantity ?? 0)
      ) {
        return "reserved-quantity";
      }
      return "conflict";
    }
  },

  async batchLocationLevels(input: {
    inventoryItemId?: string;
    creates: Array<{
      inventoryItemId: string;
      locationId: string;
      stockedQuantity: number;
      incomingQuantity: number;
    }>;
    updates: Array<{
      id: string;
      inventoryItemId?: string;
      locationId?: string;
      stockedQuantity?: number;
      incomingQuantity?: number;
    }>;
    deleteIds: string[];
    force: boolean;
  }): Promise<
    | "updated"
    | "not-found"
    | "invalid-location"
    | "reserved-quantity"
    | "in-use"
    | "conflict"
  > {
    if (
      input.inventoryItemId &&
      input.creates.some(
        (level) => level.inventoryItemId !== input.inventoryItemId,
      )
    ) {
      return "not-found";
    }
    const updateIds = input.updates.map((level) => level.id);
    const operationIds = [...updateIds, ...input.deleteIds];
    if (
      new Set(updateIds).size !== updateIds.length ||
      new Set(input.deleteIds).size !== input.deleteIds.length ||
      new Set(operationIds).size !== operationIds.length
    ) {
      return "conflict";
    }
    const db = await getDb();
    const requestedLevels = operationIds.length
      ? await db
          .select()
          .from(inventoryLevels)
          .where(
            and(
              inArray(inventoryLevels.id, operationIds),
              isNull(inventoryLevels.deletedAt),
            ),
          )
      : [];
    if (requestedLevels.length !== operationIds.length) return "not-found";
    const currentById = new Map(
      requestedLevels.map((level) => [level.id, level]),
    );
    for (const requested of input.updates) {
      const current = currentById.get(requested.id);
      if (
        !current ||
        (input.inventoryItemId &&
          current.inventoryItemId !== input.inventoryItemId) ||
        (requested.inventoryItemId &&
          current.inventoryItemId !== requested.inventoryItemId) ||
        (requested.locationId && current.locationId !== requested.locationId)
      ) {
        return "not-found";
      }
      if (
        requested.stockedQuantity !== undefined &&
        current.reservedQuantity > requested.stockedQuantity
      ) {
        return "reserved-quantity";
      }
    }
    const deleteLevels = input.deleteIds.map((id) => currentById.get(id));
    if (
      deleteLevels.some(
        (level) =>
          !level ||
          (input.inventoryItemId &&
            level.inventoryItemId !== input.inventoryItemId),
      )
    ) {
      return "not-found";
    }

    const createKeys = input.creates.map(
      (level) => `${level.inventoryItemId}\u0000${level.locationId}`,
    );
    if (new Set(createKeys).size !== createKeys.length) return "conflict";
    const referencedItemIds = [
      ...new Set([
        ...input.creates.map((level) => level.inventoryItemId),
        ...requestedLevels.map((level) => level.inventoryItemId),
      ]),
    ];
    const referencedLocationIds = [
      ...new Set([
        ...input.creates.map((level) => level.locationId),
        ...requestedLevels.map((level) => level.locationId),
      ]),
    ];
    const [items, locations] = await Promise.all([
      referencedItemIds.length
        ? db
            .select({ id: inventoryItems.id })
            .from(inventoryItems)
            .where(
              and(
                inArray(inventoryItems.id, referencedItemIds),
                isNull(inventoryItems.deletedAt),
              ),
            )
        : [],
      referencedLocationIds.length
        ? db
            .select({ id: stockLocations.id })
            .from(stockLocations)
            .where(
              and(
                inArray(stockLocations.id, referencedLocationIds),
                isNull(stockLocations.deletedAt),
              ),
            )
        : [],
    ]);
    if (items.length !== referencedItemIds.length) return "not-found";
    if (locations.length !== referencedLocationIds.length) {
      return "invalid-location";
    }

    if (input.creates.length) {
      const [createItemIds, createLocationIds] = [
        [...new Set(input.creates.map((level) => level.inventoryItemId))],
        [...new Set(input.creates.map((level) => level.locationId))],
      ];
      const existingLevels = await db
        .select({
          inventoryItemId: inventoryLevels.inventoryItemId,
          locationId: inventoryLevels.locationId,
        })
        .from(inventoryLevels)
        .where(
          and(
            inArray(inventoryLevels.inventoryItemId, createItemIds),
            inArray(inventoryLevels.locationId, createLocationIds),
            isNull(inventoryLevels.deletedAt),
          ),
        );
      const existingKeys = new Set(
        existingLevels.map(
          (level) => `${level.inventoryItemId}\u0000${level.locationId}`,
        ),
      );
      if (createKeys.some((key) => existingKeys.has(key))) return "conflict";
    }

    if (deleteLevels.length) {
      const deleteItemIds = [
        ...new Set(
          deleteLevels.flatMap((level) =>
            level ? [level.inventoryItemId] : [],
          ),
        ),
      ];
      const deleteLocationIds = [
        ...new Set(
          deleteLevels.flatMap((level) => (level ? [level.locationId] : [])),
        ),
      ];
      const reservations = await db
        .select({
          inventoryItemId: reservationItems.inventoryItemId,
          locationId: reservationItems.locationId,
        })
        .from(reservationItems)
        .where(
          and(
            inArray(reservationItems.inventoryItemId, deleteItemIds),
            inArray(reservationItems.locationId, deleteLocationIds),
            isNull(reservationItems.deletedAt),
          ),
        );
      const reservedPairs = new Set(
        reservations.map(
          (reservation) =>
            `${reservation.inventoryItemId}\u0000${reservation.locationId}`,
        ),
      );
      if (
        deleteLevels.some(
          (level) =>
            !level ||
            level.reservedQuantity > 0 ||
            level.incomingQuantity > 0 ||
            (!input.force && level.stockedQuantity > 0) ||
            reservedPairs.has(
              `${level.inventoryItemId}\u0000${level.locationId}`,
            ),
        )
      ) {
        return "in-use";
      }
    }

    const now = new Date().toISOString();
    const payload = {
      force: input.force,
      creates: input.creates.map((level) => ({
        id: crypto.randomUUID(),
        ...level,
      })),
      updates: input.updates.map((level) => {
        const current = currentById.get(level.id)!;
        return {
          id: level.id,
          inventoryItemId: current.inventoryItemId,
          locationId: current.locationId,
          expectedUpdatedAt: current.updatedAt,
          stockedQuantity: level.stockedQuantity ?? null,
          incomingQuantity: level.incomingQuantity ?? null,
        };
      }),
      deletes: deleteLevels.flatMap((level) =>
        level
          ? [
              {
                id: level.id,
                inventoryItemId: level.inventoryItemId,
                locationId: level.locationId,
                expectedUpdatedAt: level.updatedAt,
              },
            ]
          : [],
      ),
    };
    const payloadJson = JSON.stringify(payload);
    try {
      await env.DATABASE.batch([
        env.DATABASE.prepare(
          `SELECT CASE WHEN NOT EXISTS (
             SELECT 1 FROM json_each(?1, '$.creates') requested
             LEFT JOIN inventory_items i
               ON i.id = json_extract(requested.value, '$.inventoryItemId')
              AND i.deleted_at IS NULL
             LEFT JOIN stock_locations s
               ON s.id = json_extract(requested.value, '$.locationId')
              AND s.deleted_at IS NULL
             WHERE i.id IS NULL OR s.id IS NULL OR EXISTS (
               SELECT 1 FROM inventory_levels l
               WHERE l.inventory_item_id = json_extract(requested.value, '$.inventoryItemId')
                 AND l.location_id = json_extract(requested.value, '$.locationId')
                 AND l.deleted_at IS NULL
             )
           ) AND NOT EXISTS (
             SELECT 1 FROM json_each(?1, '$.creates') requested
             GROUP BY json_extract(requested.value, '$.inventoryItemId'),
               json_extract(requested.value, '$.locationId')
             HAVING count(*) > 1
           ) AND NOT EXISTS (
             SELECT 1 FROM json_each(?1, '$.updates') requested
             LEFT JOIN inventory_levels l
               ON l.id = json_extract(requested.value, '$.id')
              AND l.inventory_item_id = json_extract(requested.value, '$.inventoryItemId')
              AND l.location_id = json_extract(requested.value, '$.locationId')
              AND l.deleted_at IS NULL
             LEFT JOIN inventory_items i
               ON i.id = l.inventory_item_id AND i.deleted_at IS NULL
             LEFT JOIN stock_locations s
               ON s.id = l.location_id AND s.deleted_at IS NULL
             WHERE l.id IS NULL OR i.id IS NULL OR s.id IS NULL
               OR l.updated_at <> json_extract(requested.value, '$.expectedUpdatedAt')
               OR l.reserved_quantity > coalesce(
                 json_extract(requested.value, '$.stockedQuantity'), l.stocked_quantity
               )
           ) AND NOT EXISTS (
             SELECT 1 FROM json_each(?1, '$.deletes') requested
             LEFT JOIN inventory_levels l
               ON l.id = json_extract(requested.value, '$.id')
              AND l.inventory_item_id = json_extract(requested.value, '$.inventoryItemId')
              AND l.location_id = json_extract(requested.value, '$.locationId')
              AND l.deleted_at IS NULL
             LEFT JOIN inventory_items i
               ON i.id = l.inventory_item_id AND i.deleted_at IS NULL
             LEFT JOIN stock_locations s
               ON s.id = l.location_id AND s.deleted_at IS NULL
             WHERE l.id IS NULL OR i.id IS NULL OR s.id IS NULL
               OR l.updated_at <> json_extract(requested.value, '$.expectedUpdatedAt')
               OR l.reserved_quantity > 0 OR l.incoming_quantity > 0
               OR (json_extract(?1, '$.force') = 0 AND l.stocked_quantity > 0)
               OR EXISTS (
                 SELECT 1 FROM reservation_items r
                 WHERE r.inventory_item_id = l.inventory_item_id
                   AND r.location_id = l.location_id AND r.deleted_at IS NULL
               )
           ) THEN 1 ELSE json('') END`,
        ).bind(payloadJson),
        env.DATABASE.prepare(
          `INSERT INTO inventory_levels
            (id, inventory_item_id, location_id, stocked_quantity,
             reserved_quantity, incoming_quantity, metadata, created_at, updated_at)
           SELECT json_extract(requested.value, '$.id'),
             json_extract(requested.value, '$.inventoryItemId'),
             json_extract(requested.value, '$.locationId'),
             json_extract(requested.value, '$.stockedQuantity'), 0,
             json_extract(requested.value, '$.incomingQuantity'), '{}', ?2, ?2
           FROM json_each(?1, '$.creates') requested`,
        ).bind(payloadJson, now),
        env.DATABASE.prepare(
          `UPDATE inventory_levels
           SET stocked_quantity = coalesce(
                 (SELECT json_extract(requested.value, '$.stockedQuantity')
                  FROM json_each(?1, '$.updates') requested
                  WHERE json_extract(requested.value, '$.id') = inventory_levels.id),
                 stocked_quantity
               ),
               incoming_quantity = coalesce(
                 (SELECT json_extract(requested.value, '$.incomingQuantity')
                  FROM json_each(?1, '$.updates') requested
                  WHERE json_extract(requested.value, '$.id') = inventory_levels.id),
                 incoming_quantity
               ),
               updated_at = ?2
           WHERE id IN (
             SELECT json_extract(requested.value, '$.id')
             FROM json_each(?1, '$.updates') requested
           ) AND deleted_at IS NULL`,
        ).bind(payloadJson, now),
        env.DATABASE.prepare(
          `UPDATE inventory_levels SET deleted_at = ?2, updated_at = ?2
           WHERE id IN (
             SELECT json_extract(requested.value, '$.id')
             FROM json_each(?1, '$.deletes') requested
           ) AND deleted_at IS NULL`,
        ).bind(payloadJson, now),
      ]);
      return "updated";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("malformed JSON")) return "conflict";
      if (
        message.includes(
          "UNIQUE constraint failed: inventory_levels.inventory_item_id",
        )
      ) {
        return "conflict";
      }
      throw error;
    }
  },

  async removeLocationLevels(
    inventoryItemId: string,
    locationIds: string[],
  ): Promise<"deleted" | "not-found" | "in-use" | "conflict"> {
    const db = await getDb();
    const item = firstOrNull(
      await db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.id, inventoryItemId), active))
        .limit(1),
    );
    if (!item) return "not-found";
    if (locationIds.length === 0) return "deleted";
    const uniqueLocationIds = [...new Set(locationIds)];
    if (uniqueLocationIds.length !== locationIds.length) return "conflict";
    const levels = await db
      .select()
      .from(inventoryLevels)
      .where(
        and(
          eq(inventoryLevels.inventoryItemId, inventoryItemId),
          inArray(inventoryLevels.locationId, uniqueLocationIds),
          isNull(inventoryLevels.deletedAt),
        ),
      );
    if (levels.length !== uniqueLocationIds.length) return "not-found";
    if (
      levels.some(
        (level) =>
          level.stockedQuantity > 0 ||
          level.reservedQuantity > 0 ||
          level.incomingQuantity > 0,
      )
    ) {
      return "in-use";
    }
    const now = new Date().toISOString();
    const statements = [];
    for (const level of levels) {
      statements.push(
        env.DATABASE.prepare(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM inventory_items WHERE id = ?1 AND deleted_at IS NULL
           ) AND EXISTS (
             SELECT 1 FROM inventory_levels
             WHERE id = ?2 AND inventory_item_id = ?1 AND location_id = ?3
               AND deleted_at IS NULL AND updated_at = ?4
               AND stocked_quantity = 0 AND reserved_quantity = 0 AND incoming_quantity = 0
           ) AND NOT EXISTS (
             SELECT 1 FROM reservation_items
             WHERE inventory_item_id = ?1 AND location_id = ?3 AND deleted_at IS NULL
           ) THEN 1 ELSE json('') END`,
        ).bind(inventoryItemId, level.id, level.locationId, level.updatedAt),
      );
    }
    for (const level of levels) {
      statements.push(
        env.DATABASE.prepare(
          `UPDATE inventory_levels SET deleted_at = ?2, updated_at = ?2
           WHERE id = ?1 AND deleted_at IS NULL AND stocked_quantity = 0
             AND reserved_quantity = 0 AND incoming_quantity = 0`,
        ).bind(level.id, now),
      );
    }
    try {
      await env.DATABASE.batch(statements);
      return "deleted";
    } catch (error) {
      if (error instanceof Error && error.message.includes("malformed JSON")) {
        return "conflict";
      }
      throw error;
    }
  },

  async archiveItem(id: string): Promise<"archived" | "not-found" | "in-use"> {
    const db = await getDb();
    const item = firstOrNull(
      await db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.id, id), active))
        .limit(1),
    );
    if (!item) return "not-found";
    const [links, reservations, nonzeroLevels] = await Promise.all([
      db
        .select({ id: productVariantInventoryItems.variantId })
        .from(productVariantInventoryItems)
        .innerJoin(
          productVariants,
          eq(productVariants.id, productVariantInventoryItems.variantId),
        )
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(
          and(
            eq(productVariantInventoryItems.inventoryItemId, id),
            isNull(productVariants.deletedAt),
            isNull(products.deletedAt),
          ),
        )
        .limit(1),
      db
        .select({ id: reservationItems.id })
        .from(reservationItems)
        .where(
          and(
            eq(reservationItems.inventoryItemId, id),
            isNull(reservationItems.deletedAt),
          ),
        )
        .limit(1),
      db
        .select({ id: inventoryLevels.id })
        .from(inventoryLevels)
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, id),
            isNull(inventoryLevels.deletedAt),
            or(
              sql`${inventoryLevels.stockedQuantity} > 0`,
              sql`${inventoryLevels.reservedQuantity} > 0`,
              sql`${inventoryLevels.incomingQuantity} > 0`,
            ) as SQL,
          ),
        )
        .limit(1),
    ]);
    if (links.length || reservations.length || nonzeroLevels.length)
      return "in-use";

    const now = new Date().toISOString();
    try {
      await env.DATABASE.batch([
        env.DATABASE.prepare(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM inventory_items i WHERE i.id = ?1 AND i.deleted_at IS NULL
           ) AND NOT EXISTS (
             SELECT 1 FROM product_variant_inventory_items link
             JOIN product_variants v ON v.id = link.variant_id
             JOIN products p ON p.id = v.product_id
             WHERE link.inventory_item_id = ?1 AND v.deleted_at IS NULL AND p.deleted_at IS NULL
           ) AND NOT EXISTS (
             SELECT 1 FROM reservation_items r WHERE r.inventory_item_id = ?1 AND r.deleted_at IS NULL
           ) AND NOT EXISTS (
             SELECT 1 FROM inventory_levels l WHERE l.inventory_item_id = ?1
               AND l.deleted_at IS NULL
               AND (l.stocked_quantity > 0 OR l.reserved_quantity > 0 OR l.incoming_quantity > 0)
           ) THEN 1 ELSE json('') END`,
        ).bind(id),
        env.DATABASE.prepare(
          `UPDATE inventory_levels SET deleted_at = ?2, updated_at = ?2
           WHERE inventory_item_id = ?1 AND deleted_at IS NULL`,
        ).bind(id, now),
        env.DATABASE.prepare(
          `UPDATE inventory_items SET deleted_at = ?2, updated_at = ?2
           WHERE id = ?1 AND deleted_at IS NULL`,
        ).bind(id, now),
      ]);
      return "archived";
    } catch (error) {
      if (error instanceof Error && error.message.includes("malformed JSON")) {
        return "in-use";
      }
      throw error;
    }
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
  ): Promise<"updated" | "not-found" | "ambiguous-kit"> {
    const db = await getDb();
    const linkedItems = await db
      .select({ inventoryItemId: productVariantInventoryItems.inventoryItemId })
      .from(productVariantInventoryItems)
      .where(eq(productVariantInventoryItems.variantId, variantId));
    if (linkedItems.length > 1) return "ambiguous-kit";
    if (linkedItems.length === 0) return "not-found";
    const levels = await db
      .select({ id: inventoryLevels.id })
      .from(inventoryLevels)
      .where(
        and(
          eq(inventoryLevels.inventoryItemId, linkedItems[0]!.inventoryItemId),
          isNull(inventoryLevels.deletedAt),
        ),
      )
      .orderBy(asc(inventoryLevels.createdAt))
      .limit(1);
    if (!levels[0]) return "not-found";
    await db
      .update(inventoryLevels)
      .set({
        stockedQuantity: Math.max(0, quantity),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(inventoryLevels.id, levels[0].id));
    return "updated";
  },

  async listPage(options: {
    id?: string;
    ids?: string[];
    query?: string | null;
    skus?: string[];
    originCountries?: string[];
    midCodes?: string[];
    hsCodes?: string[];
    materials?: string[];
    requiresShipping?: boolean;
    locationIds?: string[];
    withDeleted?: boolean;
    withDeletedLevels?: boolean;
    sortBy:
      | "name"
      | "createdAt"
      | "updatedAt"
      | "sku"
      | "originCountry"
      | "midCode"
      | "hsCode"
      | "material";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset?: number;
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
      // Standalone inventory items are valid. Items whose only links point to
      // soft-deleted variants are lifecycle residue and must not appear as a
      // second copy of the product's current stock.
      or(notExists(hasAnyVariantLink), exists(hasActiveVariantLink)) as SQL,
    ];
    if (!options.withDeleted) conditions.push(active);
    if (options.id) conditions.push(eq(inventoryItems.id, options.id));
    if (options.ids?.length) {
      conditions.push(inArray(inventoryItems.id, options.ids));
    }
    if (options.skus?.length) {
      conditions.push(inArray(inventoryItems.sku, options.skus));
    }
    if (options.originCountries?.length) {
      conditions.push(
        inArray(inventoryItems.originCountry, options.originCountries),
      );
    }
    if (options.midCodes?.length) {
      conditions.push(inArray(inventoryItems.midCode, options.midCodes));
    }
    if (options.hsCodes?.length) {
      conditions.push(inArray(inventoryItems.hsCode, options.hsCodes));
    }
    if (options.materials?.length) {
      conditions.push(inArray(inventoryItems.material, options.materials));
    }
    if (options.requiresShipping !== undefined) {
      conditions.push(
        eq(inventoryItems.requiresShipping, options.requiresShipping),
      );
    }
    if (options.locationIds?.length) {
      const matchingLevels = db
        .select({ id: inventoryLevels.id })
        .from(inventoryLevels)
        .where(
          and(
            eq(inventoryLevels.inventoryItemId, inventoryItems.id),
            inArray(inventoryLevels.locationId, options.locationIds),
            isNull(inventoryLevels.deletedAt),
          ),
        );
      conditions.push(exists(matchingLevels));
    }
    if (options.query?.trim()) {
      const term = options.query.trim();
      conditions.push(
        or(
          likeContains(inventoryItems.title, term),
          likeContains(inventoryItems.sku, term),
        ) as SQL,
      );
    }
    const condition = and(...conditions);
    const sortColumns = {
      name: inventoryItems.title,
      createdAt: inventoryItems.createdAt,
      updatedAt: inventoryItems.updatedAt,
      sku: inventoryItems.sku,
      originCountry: inventoryItems.originCountry,
      midCode: inventoryItems.midCode,
      hsCode: inventoryItems.hsCode,
      material: inventoryItems.material,
    };
    const sortColumn = sortColumns[options.sortBy];
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
        .offset(options.offset ?? (options.page - 1) * options.limit),
    ]);

    const ids = rows.map((row) => row.id);
    const [variantLinks, levelTotals, locationLevelRows] =
      ids.length === 0
        ? [[], [], []]
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
                  ...(options.withDeletedLevels
                    ? []
                    : [isNull(inventoryLevels.deletedAt)]),
                ),
              )
              .groupBy(inventoryLevels.inventoryItemId),
            db
              .select({
                level: inventoryLevels,
                locationName: stockLocations.name,
                unitOfMeasure: inventoryItems.unitOfMeasure,
              })
              .from(inventoryLevels)
              .innerJoin(
                inventoryItems,
                eq(inventoryItems.id, inventoryLevels.inventoryItemId),
              )
              .leftJoin(
                stockLocations,
                and(
                  eq(stockLocations.id, inventoryLevels.locationId),
                  isNull(stockLocations.deletedAt),
                ),
              )
              .where(
                and(
                  inArray(inventoryLevels.inventoryItemId, ids),
                  isNull(inventoryLevels.deletedAt),
                ),
              )
              .orderBy(asc(inventoryLevels.createdAt)),
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
    const locationLevelsByItem = new Map<
      string,
      InventoryListItemDTO["locationLevels"]
    >();
    for (const row of locationLevelRows) {
      const levels = locationLevelsByItem.get(row.level.inventoryItemId) ?? [];
      const stockedQuantity = row.level.stockedQuantity;
      const reservedQuantity = row.level.reservedQuantity;
      levels.push({
        id: row.level.id,
        locationId: row.level.locationId,
        locationName: row.locationName,
        unitOfMeasure: row.unitOfMeasure,
        stockedQuantity,
        reservedQuantity,
        incomingQuantity: row.level.incomingQuantity,
        availableQuantity: stockedQuantity - reservedQuantity,
        metadata: row.level.metadata ?? {},
        createdAt: new Date(row.level.createdAt),
        updatedAt: new Date(row.level.updatedAt),
        deletedAt: row.level.deletedAt ? new Date(row.level.deletedAt) : null,
      });
      locationLevelsByItem.set(row.level.inventoryItemId, levels);
    }
    return {
      items: rows.map((row) => {
        const totals = levelTotalsByItem.get(row.id);
        const links = variantLinksByItem.get(row.id) ?? [];
        const editTarget = links.length === 1 ? links[0] : null;
        const stocked = Number(totals?.stocked ?? 0);
        const reserved = Number(totals?.reserved ?? 0);
        return {
          id: row.id,
          description: row.description,
          thumbnail: row.thumbnail,
          unitOfMeasure: row.unitOfMeasure,
          requiresShipping: row.requiresShipping,
          weight: row.weight,
          length: row.length,
          height: row.height,
          width: row.width,
          originCountry: row.originCountry,
          hsCode: row.hsCode,
          midCode: row.midCode,
          material: row.material,
          metadata: row.metadata ?? {},
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
          locationLevels: locationLevelsByItem.get(row.id) ?? [],
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
          deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
        };
      }),
      total: Number(countRows[0]?.value ?? 0),
    };
  },
};
