import { getDb } from "@/db";
import { mapFirstOrNull } from "@/lib/db/single-row";
import { regionCountries, regions } from "@/db/region.schema";
import { regionPaymentProviders } from "@/db/link.schema";
import { paymentProviders } from "@/db/payment.schema";
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
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
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

  async findDetails(ids: string[]): Promise<RegionDetailDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const [regionRows, countryRows, providerRows] = await Promise.all([
      db
        .select()
        .from(regions)
        .where(and(inArray(regions.id, ids), isNull(regions.deletedAt))),
      db
        .select()
        .from(regionCountries)
        .where(
          and(
            inArray(regionCountries.regionId, ids),
            isNull(regionCountries.deletedAt),
          ),
        )
        .orderBy(asc(regionCountries.name)),
      db
        .select()
        .from(regionPaymentProviders)
        .where(inArray(regionPaymentProviders.regionId, ids)),
    ]);
    const countriesByRegion = new Map<string, RegionCountryDTO[]>();
    for (const row of countryRows) {
      if (!row.regionId) continue;
      const countries = countriesByRegion.get(row.regionId) ?? [];
      countries.push(toRegionCountryDTO(row));
      countriesByRegion.set(row.regionId, countries);
    }
    const providersByRegion = new Map<string, string[]>();
    for (const row of providerRows) {
      const providers = providersByRegion.get(row.regionId) ?? [];
      providers.push(row.paymentProviderId);
      providersByRegion.set(row.regionId, providers);
    }
    const detailsById = new Map(
      regionRows.map((row) => [
        row.id,
        {
          ...toRegionDTO(row),
          countries: countriesByRegion.get(row.id) ?? [],
          paymentProviderIds: providersByRegion.get(row.id) ?? [],
        },
      ]),
    );
    return ids.flatMap((id) => {
      const detail = detailsById.get(id);
      return detail ? [detail] : [];
    });
  },

  async listPage(options: {
    query?: string | null;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset?: number;
  }): Promise<{ regions: RegionSummaryDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(regions.deletedAt)];

    if (options.query?.trim()) {
      const term = options.query.trim();
      conditions.push(
        or(
          likeContains(regions.name, term),
          likeContains(regions.currencyCode, term),
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
        .offset(options.offset ?? (options.page - 1) * options.limit),
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

  async createWithAssociations(
    data: RegionInsertDTO & {
      countries: string[];
      paymentProviderIds: string[];
    },
  ): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const countryCodes = [...new Set(data.countries)];
    const providerIds = [...new Set(data.paymentProviderIds)];
    const statements: BatchItem<"sqlite">[] = [
      db.insert(regions).values({
        id: data.id,
        name: data.name,
        currencyCode: data.currencyCode,
        automaticTaxes: data.automaticTaxes ?? true,
        isTaxInclusive: data.isTaxInclusive ?? false,
        metadata: data.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }),
    ];

    const appendGuard = (condition: SQL) => {
      const activeRegion = db
        .select({ id: regions.id })
        .from(regions)
        .where(and(eq(regions.id, data.id), isNull(regions.deletedAt)))
        .limit(1);
      statements.push(
        db
          .update(regions)
          .set({
            name: sql`CASE WHEN EXISTS ${activeRegion} AND (${condition}) THEN ${regions.name} ELSE NULL END`,
          })
          .where(eq(regions.id, data.id)),
      );
    };

    for (let index = 0; index < countryCodes.length; index += DELETE_CHUNK) {
      const codes = countryCodes.slice(index, index + DELETE_CHUNK);
      const availableCount = db
        .select({ value: count() })
        .from(regionCountries)
        .where(
          and(
            inArray(regionCountries.iso2, codes),
            or(
              isNull(regionCountries.regionId),
              eq(regionCountries.regionId, data.id),
            ),
          ),
        );
      appendGuard(sql`(${availableCount}) = ${codes.length}`);
    }
    for (let index = 0; index < providerIds.length; index += DELETE_CHUNK) {
      const ids = providerIds.slice(index, index + DELETE_CHUNK);
      const availableCount = db
        .select({ value: count() })
        .from(paymentProviders)
        .where(
          and(
            inArray(paymentProviders.id, ids),
            eq(paymentProviders.isEnabled, true),
            isNull(paymentProviders.deletedAt),
          ),
        );
      appendGuard(sql`(${availableCount}) = ${ids.length}`);
    }
    for (let index = 0; index < countryCodes.length; index += DELETE_CHUNK) {
      const codes = countryCodes.slice(index, index + DELETE_CHUNK);
      statements.push(
        db
          .update(regionCountries)
          .set({ regionId: data.id, updatedAt: now })
          .where(
            and(
              inArray(regionCountries.iso2, codes),
              or(
                isNull(regionCountries.regionId),
                eq(regionCountries.regionId, data.id),
              ),
            ),
          ),
      );
    }
    const providerRows = providerIds.map((paymentProviderId) => ({
      regionId: data.id,
      paymentProviderId,
      createdAt: now,
      updatedAt: now,
    }));
    for (const rows of chunkForInsert(providerRows, 4)) {
      statements.push(db.insert(regionPaymentProviders).values(rows));
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },

  async updateWithAssociations(
    id: string,
    input: {
      region: UpdateRegionDTO;
      countries?: string[];
      paymentProviderIds?: string[];
    },
  ): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    const countryCodes =
      input.countries === undefined ? undefined : [...new Set(input.countries)];
    const providerIds =
      input.paymentProviderIds === undefined
        ? undefined
        : [...new Set(input.paymentProviderIds)];
    const statements: BatchItem<"sqlite">[] = [];

    const appendGuard = (condition: SQL) => {
      const activeRegion = db
        .select({ id: regions.id })
        .from(regions)
        .where(and(eq(regions.id, id), isNull(regions.deletedAt)))
        .limit(1);
      statements.push(
        db
          .update(regions)
          .set({
            name: sql`CASE WHEN EXISTS ${activeRegion} AND (${condition}) THEN ${regions.name} ELSE NULL END`,
          })
          .where(eq(regions.id, id)),
      );
    };

    const hasCountryChecks = Boolean(countryCodes?.length);
    const hasProviderChecks = Boolean(providerIds?.length);
    if (!hasCountryChecks && !hasProviderChecks) appendGuard(sql`1 = 1`);

    if (countryCodes !== undefined) {
      for (let index = 0; index < countryCodes.length; index += DELETE_CHUNK) {
        const codes = countryCodes.slice(index, index + DELETE_CHUNK);
        const availableCount = db
          .select({ value: count() })
          .from(regionCountries)
          .where(
            and(
              inArray(regionCountries.iso2, codes),
              or(
                isNull(regionCountries.regionId),
                eq(regionCountries.regionId, id),
              ),
            ),
          );
        appendGuard(sql`(${availableCount}) = ${codes.length}`);
      }
    }
    if (providerIds !== undefined) {
      for (let index = 0; index < providerIds.length; index += DELETE_CHUNK) {
        const ids = providerIds.slice(index, index + DELETE_CHUNK);
        const availableCount = db
          .select({ value: count() })
          .from(paymentProviders)
          .where(
            and(
              inArray(paymentProviders.id, ids),
              eq(paymentProviders.isEnabled, true),
              isNull(paymentProviders.deletedAt),
            ),
          );
        appendGuard(sql`(${availableCount}) = ${ids.length}`);
      }
    }

    statements.push(
      db
        .update(regions)
        .set({ ...input.region, updatedAt: now })
        .where(and(eq(regions.id, id), isNull(regions.deletedAt))),
    );

    if (countryCodes !== undefined) {
      statements.push(
        db
          .update(regionCountries)
          .set({ regionId: null, updatedAt: now })
          .where(eq(regionCountries.regionId, id)),
      );
      for (let index = 0; index < countryCodes.length; index += DELETE_CHUNK) {
        const codes = countryCodes.slice(index, index + DELETE_CHUNK);
        statements.push(
          db
            .update(regionCountries)
            .set({ regionId: id, updatedAt: now })
            .where(
              and(
                inArray(regionCountries.iso2, codes),
                or(
                  isNull(regionCountries.regionId),
                  eq(regionCountries.regionId, id),
                ),
              ),
            ),
        );
      }
    }
    if (providerIds !== undefined) {
      statements.push(
        db
          .delete(regionPaymentProviders)
          .where(eq(regionPaymentProviders.regionId, id)),
      );
      const providerRows = providerIds.map((paymentProviderId) => ({
        regionId: id,
        paymentProviderId,
        createdAt: now,
        updatedAt: now,
      }));
      for (const rows of chunkForInsert(providerRows, 4)) {
        statements.push(db.insert(regionPaymentProviders).values(rows));
      }
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
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

    const statements: BatchItem<"sqlite">[] = [];
    for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
      const chunk = ids.slice(index, index + DELETE_CHUNK);
      statements.push(
        db
          .update(regionCountries)
          .set({ regionId: null, updatedAt: now })
          .where(inArray(regionCountries.regionId, chunk)),
        db
          .update(regions)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(inArray(regions.id, chunk), isNull(regions.deletedAt))),
        db
          .delete(regionPaymentProviders)
          .where(inArray(regionPaymentProviders.regionId, chunk)),
      );
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },
};
