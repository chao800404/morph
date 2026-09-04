import { mapFirstOrNull } from "@/lib/db/single-row";
import { getDb } from "@/db";
import { salesChannelStockLocations } from "@/db/link.schema";
import {
  stockLocationAddresses,
  stockLocations,
} from "@/db/stock-location.schema";
import { containsPattern } from "@/lib/db/like-pattern";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  type SQL,
} from "drizzle-orm";
import type {
  StockLocationAddressInputDTO,
  StockLocationDTO,
  StockLocationInsertDTO,
  UpdateStockLocationDTO,
} from "../dto/stock-location.dto";
import { toStockLocationDTO } from "../mappers/stock-location.mapper";

/** How many rows one soft-delete statement touches. See rules.md §4. */
const DELETE_CHUNK = 50;

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
  }): Promise<{ locations: StockLocationDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(stockLocations.deletedAt)];

    if (options.query?.trim()) {
      conditions.push(
        like(stockLocations.name, containsPattern(options.query.trim())),
      );
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
        .offset((options.page - 1) * options.limit),
    ]);

    return {
      locations: rows.map((row) =>
        toStockLocationDTO(row.location, row.address),
      ),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async create(data: StockLocationInsertDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    let addressId: string | null = null;
    if (data.address) {
      addressId = crypto.randomUUID();
      await db
        .insert(stockLocationAddresses)
        .values({ id: addressId, ...normalizeAddress(data.address), createdAt: now, updatedAt: now });
    }

    await db.insert(stockLocations).values({
      id: data.id,
      name: data.name,
      addressId,
      createdAt: now,
      updatedAt: now,
    });
  },

  /**
   * Update, creating the address row if the location never had one.
   *
   * `address: null` clears it; `address: undefined` leaves it alone. The
   * distinction matters because the edit form sends only the fields it owns,
   * and a location can legitimately have no address.
   */
  async update(id: string, data: UpdateStockLocationDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    const existing = await db
      .select({ addressId: stockLocations.addressId })
      .from(stockLocations)
      .where(eq(stockLocations.id, id))
      .limit(1);
    const currentAddressId = existing[0]?.addressId ?? null;

    let addressId = currentAddressId;
    if (data.address === null) {
      addressId = null;
    } else if (data.address) {
      const values = normalizeAddress(data.address);
      if (currentAddressId) {
        await db
          .update(stockLocationAddresses)
          .set({ ...values, updatedAt: now })
          .where(eq(stockLocationAddresses.id, currentAddressId));
      } else {
        addressId = crypto.randomUUID();
        await db
          .insert(stockLocationAddresses)
          .values({ id: addressId, ...values, createdAt: now, updatedAt: now });
      }
    }

    await db
      .update(stockLocations)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        ...(data.address !== undefined ? { addressId } : {}),
        updatedAt: now,
      })
      .where(and(eq(stockLocations.id, id), isNull(stockLocations.deletedAt)));
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

    for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
      const chunk = ids.slice(index, index + DELETE_CHUNK);
      await db
        .update(stockLocations)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            inArray(stockLocations.id, chunk),
            isNull(stockLocations.deletedAt),
          ),
        );
      await db
        .delete(salesChannelStockLocations)
        .where(inArray(salesChannelStockLocations.stockLocationId, chunk));
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
    await db
      .delete(salesChannelStockLocations)
      .where(eq(salesChannelStockLocations.stockLocationId, locationId));

    if (channelIds.length === 0) return;

    const now = new Date().toISOString();
    const rows = channelIds.map((salesChannelId) => ({
      salesChannelId,
      stockLocationId: locationId,
      createdAt: now,
      updatedAt: now,
    }));

    // Four columns, so 25 rows a statement under D1's 100-parameter ceiling.
    for (const chunk of chunkForInsert(rows, 4)) {
      await db.insert(salesChannelStockLocations).values(chunk);
    }
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
});
