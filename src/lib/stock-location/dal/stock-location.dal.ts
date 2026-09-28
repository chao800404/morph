import { mapFirstOrNull } from "@/lib/db/single-row";
import { getDb } from "@/db";
import type { Metadata } from "@/db/json";
import { cartShippingMethods, carts } from "@/db/cart.schema";
import {
  fulfillmentProviders,
  fulfillmentSets,
  geoZones,
  serviceZones,
  shippingOptions,
  shippingOptionRules,
} from "@/db/fulfillment.schema";
import {
  locationFulfillmentProviders,
  locationFulfillmentSets,
  salesChannelStockLocations,
  shippingOptionPriceSets,
} from "@/db/link.schema";
import { salesChannels } from "@/db/sales-channel.schema";
import {
  stockLocationAddresses,
  stockLocations,
} from "@/db/stock-location.schema";
import { likeContains } from "@/lib/db/like-query";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type {
  StockLocationAddressInputDTO,
  StockLocationDTO,
  StockLocationFulfillmentSetDTO,
  StockLocationInsertDTO,
  UpdateStockLocationDTO,
} from "../dto/stock-location.dto";
import { toStockLocationDTO } from "../mappers/stock-location.mapper";

/** How many rows one soft-delete statement touches. See rules.md §4. */
const DELETE_CHUNK = 50;

export class StockLocationShippingInUseError extends Error {
  constructor() {
    super("Shipping options for this location are selected in active carts");
    this.name = "StockLocationShippingInUseError";
  }
}

const sqlList = (values: string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/** Fulfillment sets only cascade when no other location shares them. */
const exclusivelyOwnedSetIds = (locationIds: string[]) => {
  const values = sqlList(locationIds);
  return sql`
    SELECT owned.fulfillment_set_id
    FROM location_fulfillment_sets AS owned
    WHERE owned.stock_location_id IN (${values})
      AND NOT EXISTS (
        SELECT 1 FROM location_fulfillment_sets AS other_link
        WHERE other_link.fulfillment_set_id = owned.fulfillment_set_id
          AND other_link.stock_location_id NOT IN (${values})
      )
  `;
};

type Database = Awaited<ReturnType<typeof getDb>>;

/**
 * Locations are read with their address in one left join.
 *
 * Unlike the count queries elsewhere here, this is one row per location — the
 * address is a `hasOne`, so joining cannot multiply the result and a second
 * round trip would buy nothing.
 *
 * Takes the connection instead of opening one, and is deliberately not `async`:
 * a Drizzle query builder is thenable, so `await`ing a helper that returns one
 * executes the query and hands back rows, and the `.where()` that was supposed
 * to follow has nothing to attach to.
 */
const withAddress = (db: Database) =>
  db
    .select({ location: stockLocations, address: stockLocationAddresses })
    .from(stockLocations)
    .leftJoin(
      stockLocationAddresses,
      eq(stockLocations.addressId, stockLocationAddresses.id),
    );

export const stockLocationDal = {
  async findById(id: string): Promise<StockLocationDTO | null> {
    const db = await getDb();
    const rows = await withAddress(db)
      .where(and(eq(stockLocations.id, id), isNull(stockLocations.deletedAt)))
      .limit(1);
    return mapFirstOrNull(rows, (row) =>
      toStockLocationDTO(row.location, row.address),
    );
  },

  async findByIds(ids: string[]): Promise<StockLocationDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows = await withAddress(db).where(
      and(inArray(stockLocations.id, ids), isNull(stockLocations.deletedAt)),
    );
    return rows.map((row) => toStockLocationDTO(row.location, row.address));
  },

  async findByName(name: string): Promise<StockLocationDTO | null> {
    const db = await getDb();
    const rows = await withAddress(db)
      .where(
        and(eq(stockLocations.name, name), isNull(stockLocations.deletedAt)),
      )
      .limit(1);
    return mapFirstOrNull(rows, (row) =>
      toStockLocationDTO(row.location, row.address),
    );
  },

  async listPage(options: {
    query?: string | null;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    /** Preserve REST offsets that are not exact multiples of the page size. */
    offset?: number;
  }): Promise<{ locations: StockLocationDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(stockLocations.deletedAt)];

    if (options.query?.trim()) {
      conditions.push(likeContains(stockLocations.name, options.query.trim()));
    }

    const sortColumn = {
      name: stockLocations.name,
      createdAt: stockLocations.createdAt,
      updatedAt: stockLocations.updatedAt,
    }[options.sortBy];
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(stockLocations).where(condition),
      withAddress(db)
        .where(condition)
        .orderBy(
          options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
        )
        .limit(options.limit)
        .offset(options.offset ?? (options.page - 1) * options.limit),
    ]);

    return {
      locations: rows.map((row) =>
        toStockLocationDTO(row.location, row.address),
      ),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async findFulfillmentSetByName(name: string): Promise<{ id: string } | null> {
    const db = await getDb();
    const rows = await db
      .select({ id: fulfillmentSets.id })
      .from(fulfillmentSets)
      .where(
        and(eq(fulfillmentSets.name, name), isNull(fulfillmentSets.deletedAt)),
      )
      .limit(1);
    return mapFirstOrNull(rows, ({ id }) => ({ id }));
  },

  async listFulfillmentSets(
    locationId: string,
  ): Promise<StockLocationFulfillmentSetDTO[]> {
    const db = await getDb();
    const rows = await db
      .select({ set: fulfillmentSets })
      .from(locationFulfillmentSets)
      .innerJoin(
        fulfillmentSets,
        eq(fulfillmentSets.id, locationFulfillmentSets.fulfillmentSetId),
      )
      .where(
        and(
          eq(locationFulfillmentSets.stockLocationId, locationId),
          isNull(fulfillmentSets.deletedAt),
        ),
      )
      .orderBy(asc(fulfillmentSets.name));
    return rows.map(({ set }) => ({
      id: set.id,
      name: set.name,
      type: set.type,
      metadata: set.metadata ?? {},
      createdAt: new Date(set.createdAt),
      updatedAt: new Date(set.updatedAt),
    }));
  },

  async createFulfillmentSet(input: {
    id: string;
    locationId: string;
    name: string;
    type: "shipping" | "pickup";
    metadata?: Metadata;
  }): Promise<boolean> {
    const db = await getDb();
    const now = new Date().toISOString();
    const statements: BatchItem<"sqlite">[] = [
      db
        .select({
          ok: sql<number>`CASE WHEN EXISTS (
            SELECT 1 FROM ${stockLocations}
            WHERE ${stockLocations.id} = ${input.locationId}
              AND ${stockLocations.deletedAt} IS NULL
          ) THEN 1 ELSE json('') END`,
        })
        .from(sql.raw("(SELECT 1)")),
      db.insert(fulfillmentSets).values({
        id: input.id,
        name: input.name,
        type: input.type,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(locationFulfillmentSets).values({
        stockLocationId: input.locationId,
        fulfillmentSetId: input.id,
        createdAt: now,
        updatedAt: now,
      }),
    ];
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
      return true;
    } catch (error) {
      const [location] = await db
        .select({ id: stockLocations.id })
        .from(stockLocations)
        .where(
          and(
            eq(stockLocations.id, input.locationId),
            isNull(stockLocations.deletedAt),
          ),
        )
        .limit(1);
      if (!location) return false;
      throw error;
    }
  },

  async create(data: StockLocationInsertDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    let addressId: string | null = null;
    const statements: BatchItem<"sqlite">[] = [];
    if (data.address) {
      addressId = crypto.randomUUID();
      statements.push(
        db.insert(stockLocationAddresses).values({
          id: addressId,
          ...normalizeAddress(data.address),
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    statements.push(
      db.insert(stockLocations).values({
        id: data.id,
        name: data.name,
        addressId,
        metadata: data.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }),
    );
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },

  /**
   * Update, creating the address row if the location never had one.
   *
   * `address: null` clears it; `address: undefined` leaves it alone. The
   * distinction matters because the edit form sends only the fields it owns,
   * and a location can legitimately have no address.
   */
  async update(
    id: string,
    data: UpdateStockLocationDTO,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    const db = await getDb();

    const existingRows = await withAddress(db)
      .where(and(eq(stockLocations.id, id), isNull(stockLocations.deletedAt)))
      .limit(1);
    const existing = mapFirstOrNull(existingRows, (row) =>
      toStockLocationDTO(row.location, row.address),
    );
    if (!existing || existing.updatedAt.toISOString() !== expectedUpdatedAt) {
      return false;
    }
    const now = new Date(
      Math.max(Date.now(), existing.updatedAt.getTime() + 1),
    ).toISOString();
    const currentAddressId = existing.address?.id ?? null;

    let addressId = currentAddressId;
    const addressCondition =
      currentAddressId === null
        ? sql`${stockLocations.addressId} IS NULL`
        : sql`${stockLocations.addressId} = ${currentAddressId}`;
    const statements: BatchItem<"sqlite">[] = [
      db
        .select({
          ok: sql<number>`CASE WHEN EXISTS (
            SELECT 1 FROM ${stockLocations}
            WHERE ${stockLocations.id} = ${id}
              AND ${stockLocations.deletedAt} IS NULL
              AND ${stockLocations.updatedAt} = ${expectedUpdatedAt}
              AND ${addressCondition}
          ) THEN 1 ELSE json('') END`,
        })
        .from(sql.raw("(SELECT 1)")),
    ];

    if (data.address === null) {
      addressId = null;
    } else if (data.address) {
      if (currentAddressId) {
        const normalized = normalizeAddress(data.address);
        const { metadata: _metadata, ...addressFields } = normalized;
        const values =
          data.address.metadata === undefined ? addressFields : normalized;
        statements.push(
          db
            .update(stockLocationAddresses)
            .set({ ...values, updatedAt: now })
            .where(eq(stockLocationAddresses.id, currentAddressId)),
        );
      } else {
        addressId = crypto.randomUUID();
        statements.push(
          db.insert(stockLocationAddresses).values({
            id: addressId,
            ...normalizeAddress(data.address),
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
    }

    statements.push(
      db
        .update(stockLocations)
        .set({
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
          ...(data.address !== undefined ? { addressId } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(stockLocations.id, id),
            isNull(stockLocations.deletedAt),
            eq(stockLocations.updatedAt, expectedUpdatedAt),
          ),
        ),
    );

    if (currentAddressId && data.address === null) {
      statements.push(
        db.delete(stockLocationAddresses).where(
          and(
            eq(stockLocationAddresses.id, currentAddressId),
            sql`NOT EXISTS (
                SELECT 1 FROM ${stockLocations}
                WHERE ${stockLocations.addressId} = ${currentAddressId}
              )`,
          ),
        ),
      );
    }

    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return true;
  },

  /**
   * Soft delete, plus the sales-channel links.
   *
   * The links have no foreign key so nothing cascades; leaving them would let a
   * channel keep offering shipping from a location that no longer exists. The
   * address row is left in place — it is only reachable through the location.
   */
  async softDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();
    const uniqueIds = [...new Set(ids)];
    const statements: BatchItem<"sqlite">[] = [];
    const chunks: string[][] = [];

    const hasActiveCartShippingMethod = async (locationIds: string[]) => {
      const exclusiveSetIds = exclusivelyOwnedSetIds(locationIds);
      const rows = await db
        .select({ id: cartShippingMethods.id })
        .from(cartShippingMethods)
        .innerJoin(carts, eq(carts.id, cartShippingMethods.cartId))
        .innerJoin(
          shippingOptions,
          eq(shippingOptions.id, cartShippingMethods.shippingOptionId),
        )
        .innerJoin(
          serviceZones,
          eq(serviceZones.id, shippingOptions.serviceZoneId),
        )
        .innerJoin(
          fulfillmentSets,
          eq(fulfillmentSets.id, serviceZones.fulfillmentSetId),
        )
        .where(
          and(
            sql`${fulfillmentSets.id} IN (${exclusiveSetIds})`,
            isNull(cartShippingMethods.deletedAt),
            isNull(carts.completedAt),
            isNull(carts.deletedAt),
            isNull(shippingOptions.deletedAt),
            isNull(serviceZones.deletedAt),
            isNull(fulfillmentSets.deletedAt),
          ),
        )
        .limit(1);
      return rows.length > 0;
    };

    for (let index = 0; index < uniqueIds.length; index += DELETE_CHUNK) {
      const chunk = uniqueIds.slice(index, index + DELETE_CHUNK);
      chunks.push(chunk);
      if (await hasActiveCartShippingMethod(chunk)) {
        throw new StockLocationShippingInUseError();
      }
      const setIds = exclusivelyOwnedSetIds(chunk);
      const zoneIds = sql`
        SELECT id FROM service_zones
        WHERE fulfillment_set_id IN (${setIds})
      `;
      const optionIds = sql`
        SELECT id FROM shipping_options
        WHERE service_zone_id IN (${zoneIds})
      `;
      const activeCartGuard = sql`NOT EXISTS (
        SELECT 1
        FROM cart_shipping_methods AS method
        JOIN carts AS cart ON cart.id = method.cart_id
        JOIN shipping_options AS option ON option.id = method.shipping_option_id
        JOIN service_zones AS zone ON zone.id = option.service_zone_id
        JOIN fulfillment_sets AS fulfillment_set
          ON fulfillment_set.id = zone.fulfillment_set_id
        WHERE fulfillment_set.id IN (${setIds})
          AND method.deleted_at IS NULL
          AND cart.completed_at IS NULL
          AND cart.deleted_at IS NULL
          AND option.deleted_at IS NULL
          AND zone.deleted_at IS NULL
          AND fulfillment_set.deleted_at IS NULL
      )`;
      statements.push(
        db
          .select({
            ok: sql<number>`CASE WHEN (
              SELECT COUNT(*) FROM ${stockLocations}
              WHERE ${inArray(stockLocations.id, chunk)}
                AND ${stockLocations.deletedAt} IS NULL
            ) = ${chunk.length} AND ${activeCartGuard}
              THEN 1 ELSE json('') END`,
          })
          .from(sql.raw("(SELECT 1)")),
        db
          .update(stockLocations)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(stockLocations.id, chunk),
              isNull(stockLocations.deletedAt),
            ),
          ),
        db
          .update(fulfillmentSets)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              sql`${fulfillmentSets.id} IN (${setIds})`,
              isNull(fulfillmentSets.deletedAt),
            ),
          ),
        db
          .update(serviceZones)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              sql`${serviceZones.fulfillmentSetId} IN (${setIds})`,
              isNull(serviceZones.deletedAt),
            ),
          ),
        db
          .update(geoZones)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              sql`${geoZones.serviceZoneId} IN (${zoneIds})`,
              isNull(geoZones.deletedAt),
            ),
          ),
        db
          .update(shippingOptions)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              sql`${shippingOptions.serviceZoneId} IN (${zoneIds})`,
              isNull(shippingOptions.deletedAt),
            ),
          ),
        db
          .update(shippingOptionRules)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              sql`${shippingOptionRules.shippingOptionId} IN (${optionIds})`,
              isNull(shippingOptionRules.deletedAt),
            ),
          ),
        db
          .delete(shippingOptionPriceSets)
          .where(
            sql`${shippingOptionPriceSets.shippingOptionId} IN (${optionIds})`,
          ),
        db
          .delete(salesChannelStockLocations)
          .where(inArray(salesChannelStockLocations.stockLocationId, chunk)),
        db
          .delete(locationFulfillmentProviders)
          .where(inArray(locationFulfillmentProviders.stockLocationId, chunk)),
        db
          .delete(locationFulfillmentSets)
          .where(inArray(locationFulfillmentSets.stockLocationId, chunk)),
      );
    }
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    } catch (error) {
      for (const chunk of chunks) {
        if (await hasActiveCartShippingMethod(chunk)) {
          throw new StockLocationShippingInUseError();
        }
      }
      throw error;
    }
  },

  async listChannelIds(locationId: string): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .select({ salesChannelId: salesChannelStockLocations.salesChannelId })
      .from(salesChannelStockLocations)
      .where(eq(salesChannelStockLocations.stockLocationId, locationId));
    return rows.map((row) => row.salesChannelId);
  },

  async setChannels(locationId: string, channelIds: string[]): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const rows = channelIds.map((salesChannelId) => ({
      salesChannelId,
      stockLocationId: locationId,
      createdAt: now,
      updatedAt: now,
    }));
    const channelsAreActive = channelIds.length
      ? sql`(
          SELECT COUNT(*) FROM ${salesChannels}
          WHERE ${salesChannels.id} IN (${sql.join(
            channelIds.map((id) => sql`${id}`),
            sql`, `,
          )}) AND ${salesChannels.deletedAt} IS NULL
        ) = ${channelIds.length}`
      : sql`1 = 1`;

    // Four columns, so 25 rows a statement under D1's 100-parameter ceiling.
    const statements: BatchItem<"sqlite">[] = [
      db
        .select({
          ok: sql<number>`CASE WHEN EXISTS (
          SELECT 1 FROM ${stockLocations}
          WHERE ${stockLocations.id} = ${locationId}
            AND ${stockLocations.deletedAt} IS NULL
        ) AND ${channelsAreActive} THEN 1 ELSE json('') END
        `,
        })
        .from(sql.raw("(SELECT 1)")),
      db
        .delete(salesChannelStockLocations)
        .where(eq(salesChannelStockLocations.stockLocationId, locationId)),
      ...chunkForInsert(rows, 4).map((chunk) =>
        db.insert(salesChannelStockLocations).values(chunk),
      ),
    ];

    // A replacement is one logical write: readers see either the old set or
    // the complete new set, never a location temporarily with no channels.
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },

  /** Atomically add and remove sales-channel links, preserving untouched links. */
  async batchChannels(
    locationId: string,
    add: string[],
    remove: string[],
  ): Promise<boolean> {
    const db = await getDb();
    const [location] = await db
      .select({ id: stockLocations.id })
      .from(stockLocations)
      .where(
        and(
          eq(stockLocations.id, locationId),
          isNull(stockLocations.deletedAt),
        ),
      )
      .limit(1);
    if (!location) return false;

    if (add.length > 0) {
      const activeChannels = await db
        .select({ id: salesChannels.id })
        .from(salesChannels)
        .where(
          and(inArray(salesChannels.id, add), isNull(salesChannels.deletedAt)),
        );
      if (activeChannels.length !== add.length) return false;
    }

    const now = new Date().toISOString();
    const additions = add.map((salesChannelId) => ({
      salesChannelId,
      stockLocationId: locationId,
      createdAt: now,
      updatedAt: now,
    }));
    const channelsAreActive = add.length
      ? sql`(
          SELECT COUNT(*) FROM ${salesChannels}
          WHERE ${inArray(salesChannels.id, add)}
            AND ${salesChannels.deletedAt} IS NULL
        ) = ${add.length}`
      : sql`1 = 1`;
    const statements: BatchItem<"sqlite">[] = [
      db
        .select({
          ok: sql<number>`CASE WHEN EXISTS (
            SELECT 1 FROM ${stockLocations}
            WHERE ${stockLocations.id} = ${locationId}
              AND ${stockLocations.deletedAt} IS NULL
          ) AND ${channelsAreActive} THEN 1 ELSE json('') END`,
        })
        .from(sql.raw("(SELECT 1)")),
    ];
    if (remove.length > 0) {
      statements.push(
        db
          .delete(salesChannelStockLocations)
          .where(
            and(
              eq(salesChannelStockLocations.stockLocationId, locationId),
              inArray(salesChannelStockLocations.salesChannelId, remove),
            ),
          ),
      );
    }
    statements.push(
      ...chunkForInsert(additions, 4).map((chunk) =>
        db
          .insert(salesChannelStockLocations)
          .values(chunk)
          .onConflictDoNothing(),
      ),
    );

    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
      return true;
    } catch (error) {
      const [currentLocation] = await db
        .select({ id: stockLocations.id })
        .from(stockLocations)
        .where(
          and(
            eq(stockLocations.id, locationId),
            isNull(stockLocations.deletedAt),
          ),
        )
        .limit(1);
      if (!currentLocation) return false;
      if (add.length > 0) {
        const activeChannels = await db
          .select({ id: salesChannels.id })
          .from(salesChannels)
          .where(
            and(
              inArray(salesChannels.id, add),
              isNull(salesChannels.deletedAt),
            ),
          );
        if (activeChannels.length !== add.length) return false;
      }
      throw error;
    }
  },

  async listFulfillmentProviderIds(locationId: string): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .select({
        providerId: locationFulfillmentProviders.fulfillmentProviderId,
      })
      .from(locationFulfillmentProviders)
      .innerJoin(
        fulfillmentProviders,
        and(
          eq(
            fulfillmentProviders.id,
            locationFulfillmentProviders.fulfillmentProviderId,
          ),
          eq(fulfillmentProviders.isEnabled, true),
          isNull(fulfillmentProviders.deletedAt),
        ),
      )
      .where(eq(locationFulfillmentProviders.stockLocationId, locationId));
    return rows.map((row) => row.providerId);
  },

  /** Atomically replace a location's configured fulfillment providers. */
  async setFulfillmentProviderIds(
    locationId: string,
    providerIds: string[],
  ): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const ids = [...new Set(providerIds)];
    const providerRows = ids.map((id) => ({
      id,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));
    const linkRows = ids.map((fulfillmentProviderId) => ({
      stockLocationId: locationId,
      fulfillmentProviderId,
      createdAt: now,
      updatedAt: now,
    }));
    const providersAreActive = ids.length
      ? sql`(
          SELECT COUNT(*) FROM ${fulfillmentProviders}
          WHERE ${fulfillmentProviders.id} IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )}) AND ${fulfillmentProviders.isEnabled} = 1
            AND ${fulfillmentProviders.deletedAt} IS NULL
        ) = ${ids.length}`
      : sql`1 = 1`;

    const statements: BatchItem<"sqlite">[] = [
      ...chunkForInsert(providerRows, 5).map((rows) =>
        db
          .insert(fulfillmentProviders)
          .values(rows)
          .onConflictDoUpdate({
            target: fulfillmentProviders.id,
            set: {
              isEnabled: true,
              deletedAt: null,
              updatedAt: now,
            },
          }),
      ),
      db
        .select({
          ok: sql<number>`CASE WHEN EXISTS (
          SELECT 1 FROM ${stockLocations}
          WHERE ${stockLocations.id} = ${locationId}
            AND ${stockLocations.deletedAt} IS NULL
        ) AND ${providersAreActive} THEN 1 ELSE json('') END
        `,
        })
        .from(sql.raw("(SELECT 1)")),
      db
        .delete(locationFulfillmentProviders)
        .where(eq(locationFulfillmentProviders.stockLocationId, locationId)),
      ...chunkForInsert(linkRows, 4).map((rows) =>
        db.insert(locationFulfillmentProviders).values(rows),
      ),
    ];

    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },

  /** Atomically add and remove location/provider links without replacing peers. */
  async batchFulfillmentProviderIds(
    locationId: string,
    input: { add: string[]; remove: string[] },
  ): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const addIds = [...new Set(input.add)];
    const removeIds = [...new Set(input.remove)];
    const providerRows = addIds.map((id) => ({
      id,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));
    const linkRows = addIds.map((fulfillmentProviderId) => ({
      stockLocationId: locationId,
      fulfillmentProviderId,
      createdAt: now,
      updatedAt: now,
    }));
    const providersAreActive = addIds.length
      ? sql`(
          SELECT COUNT(*) FROM ${fulfillmentProviders}
          WHERE ${fulfillmentProviders.id} IN (${sql.join(
            addIds.map((id) => sql`${id}`),
            sql`, `,
          )}) AND ${fulfillmentProviders.isEnabled} = 1
            AND ${fulfillmentProviders.deletedAt} IS NULL
        ) = ${addIds.length}`
      : sql`1 = 1`;

    const statements: BatchItem<"sqlite">[] = [
      ...chunkForInsert(providerRows, 5).map((rows) =>
        db
          .insert(fulfillmentProviders)
          .values(rows)
          .onConflictDoUpdate({
            target: fulfillmentProviders.id,
            set: {
              isEnabled: true,
              deletedAt: null,
              updatedAt: now,
            },
          }),
      ),
      db
        .select({
          ok: sql<number>`CASE WHEN EXISTS (
          SELECT 1 FROM ${stockLocations}
          WHERE ${stockLocations.id} = ${locationId}
            AND ${stockLocations.deletedAt} IS NULL
        ) AND ${providersAreActive} THEN 1 ELSE json('') END
        `,
        })
        .from(sql.raw("(SELECT 1)")),
      ...(removeIds.length
        ? [
            db
              .delete(locationFulfillmentProviders)
              .where(
                and(
                  eq(locationFulfillmentProviders.stockLocationId, locationId),
                  inArray(
                    locationFulfillmentProviders.fulfillmentProviderId,
                    removeIds,
                  ),
                ),
              ),
          ]
        : []),
      ...chunkForInsert(linkRows, 4).map((rows) =>
        db
          .insert(locationFulfillmentProviders)
          .values(rows)
          .onConflictDoNothing(),
      ),
    ];

    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },
};

/** Undefined and null both mean "no value" in the column. */
const normalizeAddress = (address: StockLocationAddressInputDTO) => ({
  address1: address.address1,
  address2: address.address2 ?? null,
  company: address.company ?? null,
  city: address.city ?? null,
  countryCode: address.countryCode,
  province: address.province ?? null,
  postalCode: address.postalCode ?? null,
  phone: address.phone ?? null,
  metadata: address.metadata ?? {},
});
