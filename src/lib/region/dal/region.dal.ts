import { getDb } from "@/db";
import { mapFirstOrNull } from "@/lib/db/single-row";
import { regionCountries, regions } from "@/db/region.schema";
import { regionPaymentProviders } from "@/db/link.schema";
import { paymentProviders } from "@/db/payment.schema";
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
  or,
  type SQL,
} from "drizzle-orm";
import { getCountryCatalog } from "../countries";
import type {
  RegionCountryDTO,
  RegionDTO,
  RegionDetailDTO,
  RegionInsertDTO,
  RegionSummaryDTO,
  UpdateRegionDTO,
} from "../dto/region.dto";
import {
  toRegionCountryDTO,
  toRegionDTO,
  type RegionRow,
} from "../mappers/region.mapper";

/** How many rows one soft-delete statement touches. See rules.md §4. */
const DELETE_CHUNK = 50;

const mapFirst = (rows: RegionRow[]): RegionDTO | null =>
  mapFirstOrNull(rows, toRegionDTO);

export const regionDal = {
  async findById(id: string): Promise<RegionDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(regions)
      .where(and(eq(regions.id, id), isNull(regions.deletedAt)))
      .limit(1);
    return mapFirst(rows);
  },

  async findByIds(ids: string[]): Promise<RegionDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows = await db
      .select()
      .from(regions)
      .where(and(inArray(regions.id, ids), isNull(regions.deletedAt)));
    return rows.map(toRegionDTO);
  },

  async findDetail(id: string): Promise<RegionDetailDTO | null> {
    const region = await this.findById(id);
    if (!region) return null;
    return {
      ...region,
      countries: await this.listCountries(id),
      paymentProviderIds: await this.listPaymentProviderIds(id),
    };
  },

  async listPage(options: {
    query?: string | null;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ regions: RegionSummaryDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(regions.deletedAt)];

    if (options.query?.trim()) {
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(
          like(regions.name, pattern),
          like(regions.currencyCode, pattern),
        ) as SQL,
      );
    }

    const sortColumn = {
      name: regions.name,
      createdAt: regions.createdAt,
      updatedAt: regions.updatedAt,
    }[options.sortBy];
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(regions).where(condition),
      db
        .select()
        .from(regions)
        .where(condition)
        .orderBy(
          options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
        )
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    const counts = await this.countCountries(rows.map((row) => row.id));

    return {
      regions: rows.map((row) => ({
        ...toRegionDTO(row),
        countryCount: counts.get(row.id) ?? 0,
      })),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async countCountries(regionIds: string[]): Promise<Map<string, number>> {
    if (regionIds.length === 0) return new Map();
    const db = await getDb();
    const rows = await db
      .select({ regionId: regionCountries.regionId, value: count() })
      .from(regionCountries)
      .where(inArray(regionCountries.regionId, regionIds))
      .groupBy(regionCountries.regionId);

    return new Map(
      rows.flatMap((row) =>
        row.regionId ? [[row.regionId, Number(row.value)] as const] : [],
      ),
    );
  },

  async listCountries(regionId: string): Promise<RegionCountryDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(regionCountries)
      .where(
        and(
          eq(regionCountries.regionId, regionId),
          isNull(regionCountries.deletedAt),
        ),
      )
      .orderBy(asc(regionCountries.name));
    return rows.map(toRegionCountryDTO);
  },

  /**
   * Countries a region may claim: the unassigned ones plus its own.
   *
   * A country belongs to at most one region — two regions serving the same
   * country would make "which currency does this address pay in?" ambiguous.
   * Including the region's own rows means the editor can show them checked
   * without a second query.
   */
  async listAssignableCountries(
    regionId: string | null,
  ): Promise<RegionCountryDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(regionCountries)
      .where(
        and(
          isNull(regionCountries.deletedAt),
          regionId
            ? or(
                isNull(regionCountries.regionId),
                eq(regionCountries.regionId, regionId),
              )
            : isNull(regionCountries.regionId),
        ),
      )
      .orderBy(asc(regionCountries.name));
    return rows.map(toRegionCountryDTO);
  },

  async listEnabledPaymentProviders(): Promise<Array<{ id: string }>> {
    const db = await getDb();
    return db
      .select({ id: paymentProviders.id })
      .from(paymentProviders)
      .where(
        and(
          eq(paymentProviders.isEnabled, true),
          isNull(paymentProviders.deletedAt),
        ),
      )
      .orderBy(asc(paymentProviders.id));
  },

  async listPaymentProviderIds(regionId: string): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .select({ id: regionPaymentProviders.paymentProviderId })
      .from(regionPaymentProviders)
      .where(eq(regionPaymentProviders.regionId, regionId));
    return rows.map((row) => row.id);
  },

  /**
   * Fill `region_countries` from the runtime's ICU catalogue.
   *
   * Idempotent, and safe to call on every request that needs the list: it only
   * inserts codes that are missing, and never touches `regionId`, so re-running
   * it cannot detach a country from its region.
   *
   * Seeding on demand rather than in a migration because the catalogue comes
   * from the Workers runtime's ICU data, which a SQL migration cannot reach.
   */
  async ensureCountryCatalog(): Promise<void> {
    const db = await getDb();
    // Deliberately unfiltered by `deletedAt`, unlike every read below: a
    // soft-deleted row still holds the primary key, so skipping it here would
    // make the insert collide instead of being a no-op.
    const existing = await db
      .select({ iso2: regionCountries.iso2 })
      .from(regionCountries);
    const known = new Set(existing.map((row) => row.iso2));

    const now = new Date().toISOString();
    const missing = getCountryCatalog()
      .filter((country) => !known.has(country.iso2))
      .map((country) => ({
        iso2: country.iso2,
        iso3: null,
        numCode: null,
        name: country.name,
        displayName: country.displayName,
        regionId: null,
        createdAt: now,
        updatedAt: now,
      }));

    if (missing.length === 0) return;

    // Eight columns, so 12 rows a statement under D1's 100-parameter ceiling.
    for (const chunk of chunkForInsert(missing, 8)) {
      await db.insert(regionCountries).values(chunk).onConflictDoNothing();
    }
  },

  async create(data: RegionInsertDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.insert(regions).values({
      id: data.id,
      name: data.name,
      currencyCode: data.currencyCode,
      automaticTaxes: data.automaticTaxes ?? true,
      isTaxInclusive: data.isTaxInclusive ?? false,
      createdAt: now,
      updatedAt: now,
    });
  },

  async update(id: string, data: UpdateRegionDTO): Promise<void> {
    const db = await getDb();
    await db
      .update(regions)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.currencyCode !== undefined
          ? { currencyCode: data.currencyCode }
          : {}),
        ...(data.automaticTaxes !== undefined
          ? { automaticTaxes: data.automaticTaxes }
          : {}),
        ...(data.isTaxInclusive !== undefined
          ? { isTaxInclusive: data.isTaxInclusive }
          : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(regions.id, id), isNull(regions.deletedAt)));
  },

  /**
   * Set exactly which countries this region serves.
   *
   * Two statements, in this order: release the ones it no longer claims, then
   * claim the new set. Doing it the other way round would hit the
   * `region_countries_region_iso2_unique` index for a country moving between
   * regions.
   */
  async setCountries(regionId: string, iso2Codes: string[]): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db
      .update(regionCountries)
      .set({ regionId: null, updatedAt: now })
      .where(eq(regionCountries.regionId, regionId));

    for (let index = 0; index < iso2Codes.length; index += DELETE_CHUNK) {
      const chunk = iso2Codes.slice(index, index + DELETE_CHUNK);
      await db
        .update(regionCountries)
        .set({ regionId, updatedAt: now })
        .where(inArray(regionCountries.iso2, chunk));
    }
  },

  async setPaymentProviders(
    regionId: string,
    providerIds: string[],
  ): Promise<void> {
    const db = await getDb();
    const uniqueIds = [...new Set(providerIds)];
    const now = new Date().toISOString();
    await db
      .delete(regionPaymentProviders)
      .where(eq(regionPaymentProviders.regionId, regionId));
    if (uniqueIds.length === 0) return;
    await db.insert(regionPaymentProviders).values(
      uniqueIds.map((paymentProviderId) => ({
        regionId,
        paymentProviderId,
        createdAt: now,
        updatedAt: now,
      })),
    );
  },

  /**
   * Soft delete, releasing the countries first.
   *
   * A country left pointing at a deleted region is invisible in every picker —
   * `listAssignableCountries` filters on `regionId IS NULL` — so the store
   * would silently stop being able to sell there.
   */
  async softDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();

    for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
      const chunk = ids.slice(index, index + DELETE_CHUNK);
      await db
        .update(regionCountries)
        .set({ regionId: null, updatedAt: now })
        .where(inArray(regionCountries.regionId, chunk));
      await db
        .update(regions)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(inArray(regions.id, chunk), isNull(regions.deletedAt)));
      await db
        .delete(regionPaymentProviders)
        .where(inArray(regionPaymentProviders.regionId, chunk));
    }
  },
};
