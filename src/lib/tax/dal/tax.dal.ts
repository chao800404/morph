import { getDb } from "@/db";
import type { Metadata } from "@/db/json";
import { products, productTypes } from "@/db/product.schema";
import { shippingOptions } from "@/db/fulfillment.schema";
import {
  taxProviders,
  taxRateRules,
  taxRates,
  taxRegions,
} from "@/db/tax.schema";
import { containsPattern } from "@/lib/db/like-pattern";
import { chunk, chunkForInsert } from "@/lib/product/dal/d1-batch";
import { getCountryCatalog } from "@/lib/region/countries";
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
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type {
  TaxRateDTO,
  TaxRateRuleDTO,
  TaxRateRuleReference,
  TaxRegionDTO,
  TaxRegionSummaryDTO,
} from "../dto/tax.dto";
import type { TaxCalculationRegion } from "../providers/tax-provider";
import {
  toTaxRateDTO,
  toTaxRateRuleDTO,
  toTaxRegionDTO,
  type TaxRuleLabels,
} from "../mapper/tax.mapper";

const loadRuleLabels = async (
  rows: Array<typeof taxRateRules.$inferSelect>,
): Promise<TaxRuleLabels> => {
  const db = await getDb();
  const labels: TaxRuleLabels = new Map();
  const idsFor = (reference: TaxRateRuleReference) => [
    ...new Set(
      rows
        .filter((row) => row.reference === reference)
        .map((row) => row.referenceId),
    ),
  ];
  const productIds = idsFor("product");
  const typeIds = idsFor("product_type");
  const shippingIds = idsFor("shipping_option");
  const loadChunks = async <T>(
    ids: string[],
    query: (chunkIds: string[]) => Promise<T[]>,
  ) => {
    const result: T[] = [];
    for (const idChunk of chunk(ids, 90))
      result.push(...(await query(idChunk)));
    return result;
  };
  const [productRows, typeRows, shippingRows] = await Promise.all([
    loadChunks(productIds, (ids) =>
      db
        .select({ id: products.id, label: products.title })
        .from(products)
        .where(inArray(products.id, ids)),
    ),
    loadChunks(typeIds, (ids) =>
      db
        .select({ id: productTypes.id, label: productTypes.value })
        .from(productTypes)
        .where(inArray(productTypes.id, ids)),
    ),
    loadChunks(shippingIds, (ids) =>
      db
        .select({ id: shippingOptions.id, label: shippingOptions.name })
        .from(shippingOptions)
        .where(inArray(shippingOptions.id, ids)),
    ),
  ]);
  productRows.forEach((row) => labels.set(`product:${row.id}`, row.label));
  typeRows.forEach((row) => labels.set(`product_type:${row.id}`, row.label));
  shippingRows.forEach((row) =>
    labels.set(`shipping_option:${row.id}`, row.label),
  );
  return labels;
};

export const taxDal = {
  async ensureSystemProvider() {
    const db = await getDb();
    const now = new Date().toISOString();
    await db
      .insert(taxProviders)
      .values({
        id: "tp_system",
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  },
  async listProviders() {
    const db = await getDb();
    return db
      .select({ id: taxProviders.id })
      .from(taxProviders)
      .where(
        and(eq(taxProviders.isEnabled, true), isNull(taxProviders.deletedAt)),
      )
      .orderBy(asc(taxProviders.id));
  },
  async isProviderEnabled(id: string) {
    const db = await getDb();
    const rows = await db
      .select({ id: taxProviders.id })
      .from(taxProviders)
      .where(
        and(
          eq(taxProviders.id, id),
          eq(taxProviders.isEnabled, true),
          isNull(taxProviders.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(rows[0]);
  },
  async findRegion(id: string): Promise<TaxRegionDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(taxRegions)
      .where(and(eq(taxRegions.id, id), isNull(taxRegions.deletedAt)))
      .limit(1);
    return rows[0] ? toTaxRegionDTO(rows[0]) : null;
  },
  async findCalculationRegion(
    countryCode: string,
    provinceCode?: string | null,
  ): Promise<TaxCalculationRegion | null> {
    const db = await getDb();
    const normalizedCountry = countryCode.trim().toLowerCase();
    const normalizedProvince = provinceCode?.trim().toUpperCase() || null;
    const countryRows = await db
      .select()
      .from(taxRegions)
      .where(
        and(
          eq(taxRegions.countryCode, normalizedCountry),
          isNull(taxRegions.parentId),
          isNull(taxRegions.provinceCode),
          isNull(taxRegions.deletedAt),
        ),
      )
      .limit(1);
    const country = countryRows[0];
    if (!country) return null;
    const provinceRows = normalizedProvince
      ? await db
          .select()
          .from(taxRegions)
          .where(
            and(
              eq(taxRegions.parentId, country.id),
              eq(taxRegions.provinceCode, normalizedProvince),
              isNull(taxRegions.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const countryRegion = toTaxRegionDTO(country);
    const provinceRegion = provinceRows[0]
      ? toTaxRegionDTO(provinceRows[0])
      : null;
    const rates = await this.listRatesForRegionIds(
      [countryRegion.id, provinceRegion?.id].filter((id): id is string =>
        Boolean(id),
      ),
    );
    return {
      countryRegion,
      provinceRegion,
      rates,
    };
  },
  async listPage(options: {
    query?: string | null;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ taxRegions: TaxRegionSummaryDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [
      isNull(taxRegions.deletedAt),
      isNull(taxRegions.parentId),
    ];
    if (options.query?.trim()) {
      const search = options.query.trim();
      const pattern = containsPattern(search);
      const matchingCountryCodes = getCountryCatalog()
        .filter((country) =>
          country.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .map((country) => country.iso2);
      conditions.push(
        or(
          like(taxRegions.countryCode, pattern),
          like(taxRegions.providerId, pattern),
          ...(matchingCountryCodes.length
            ? [inArray(taxRegions.countryCode, matchingCountryCodes)]
            : []),
        ) as SQL,
      );
    }
    const sortColumn =
      options.sortBy === "updatedAt"
        ? taxRegions.updatedAt
        : options.sortBy === "createdAt"
          ? taxRegions.createdAt
          : taxRegions.countryCode;
    const condition = and(...conditions);
    const [totalRows, rows] = await Promise.all([
      db.select({ value: count() }).from(taxRegions).where(condition),
      db
        .select()
        .from(taxRegions)
        .where(condition)
        .orderBy(
          options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
        )
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    const ids = rows.map((row) => row.id);
    const [provinceRows, rateRows] = ids.length
      ? await Promise.all([
          db
            .select({ id: taxRegions.parentId, value: count() })
            .from(taxRegions)
            .where(
              and(
                inArray(taxRegions.parentId, ids),
                isNull(taxRegions.deletedAt),
              ),
            )
            .groupBy(taxRegions.parentId),
          db
            .select({ id: taxRates.taxRegionId, value: count() })
            .from(taxRates)
            .where(
              and(
                inArray(taxRates.taxRegionId, ids),
                isNull(taxRates.deletedAt),
              ),
            )
            .groupBy(taxRates.taxRegionId),
        ])
      : [[], []];
    const provinces = new Map(
      provinceRows.flatMap((row) =>
        row.id ? [[row.id, Number(row.value)] as const] : [],
      ),
    );
    const rates = new Map(rateRows.map((row) => [row.id, Number(row.value)]));
    return {
      taxRegions: rows.map((row) => ({
        ...toTaxRegionDTO(row),
        provinceCount: provinces.get(row.id) ?? 0,
        taxRateCount: rates.get(row.id) ?? 0,
      })),
      total: Number(totalRows[0]?.value ?? 0),
    };
  },
  async listProvincePage(options: {
    parentId: string;
    query?: string | null;
    hasRates?: "yes" | "no";
    sortBy: "code" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ taxRegions: TaxRegionSummaryDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [
      eq(taxRegions.parentId, options.parentId),
      isNull(taxRegions.deletedAt),
    ];
    if (options.query?.trim()) {
      conditions.push(
        like(taxRegions.provinceCode, containsPattern(options.query.trim())),
      );
    }
    const hasActiveRates = db
      .select({ value: taxRates.id })
      .from(taxRates)
      .where(
        and(
          eq(taxRates.taxRegionId, taxRegions.id),
          isNull(taxRates.deletedAt),
        ),
      );
    if (options.hasRates === "yes") conditions.push(exists(hasActiveRates));
    if (options.hasRates === "no") conditions.push(notExists(hasActiveRates));
    const sortColumn =
      options.sortBy === "updatedAt"
        ? taxRegions.updatedAt
        : options.sortBy === "createdAt"
          ? taxRegions.createdAt
          : taxRegions.provinceCode;
    const condition = and(...conditions);
    const [totalRows, rows] = await Promise.all([
      db.select({ value: count() }).from(taxRegions).where(condition),
      db
        .select()
        .from(taxRegions)
        .where(condition)
        .orderBy(
          options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
        )
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    const ids = rows.map((row) => row.id);
    const rateRows = ids.length
      ? await db
          .select({ id: taxRates.taxRegionId, value: count() })
          .from(taxRates)
          .where(
            and(inArray(taxRates.taxRegionId, ids), isNull(taxRates.deletedAt)),
          )
          .groupBy(taxRates.taxRegionId)
      : [];
    const rates = new Map(rateRows.map((row) => [row.id, Number(row.value)]));
    return {
      taxRegions: rows.map((row) => ({
        ...toTaxRegionDTO(row),
        provinceCount: 0,
        taxRateCount: rates.get(row.id) ?? 0,
      })),
      total: Number(totalRows[0]?.value ?? 0),
    };
  },
  async findDetail(id: string): Promise<TaxRegionDTO | null> {
    return this.findRegion(id);
  },
  async provinceCodeExists(
    parentId: string,
    provinceCode: string,
  ): Promise<boolean> {
    const db = await getDb();
    const [row] = await db
      .select({ id: taxRegions.id })
      .from(taxRegions)
      .where(
        and(
          eq(taxRegions.parentId, parentId),
          eq(taxRegions.provinceCode, provinceCode),
          isNull(taxRegions.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  },
  async findRate(id: string): Promise<TaxRateDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(taxRates)
      .where(and(eq(taxRates.id, id), isNull(taxRates.deletedAt)))
      .limit(1);
    if (!rows[0]) return null;
    const ruleRows = await db
      .select()
      .from(taxRateRules)
      .where(
        and(eq(taxRateRules.taxRateId, id), isNull(taxRateRules.deletedAt)),
      );
    const labels = await loadRuleLabels(ruleRows);
    return toTaxRateDTO(
      rows[0],
      ruleRows.map((row) => toTaxRateRuleDTO(row, labels)),
    );
  },
  async listRatesForRegionIds(regionIds: string[]): Promise<TaxRateDTO[]> {
    if (!regionIds.length) return [];
    const db = await getDb();
    const rateRows = await db
      .select()
      .from(taxRates)
      .where(
        and(
          inArray(taxRates.taxRegionId, regionIds),
          isNull(taxRates.deletedAt),
        ),
      );
    const rateIds = rateRows.map((row) => row.id);
    const ruleRows: Array<typeof taxRateRules.$inferSelect> = [];
    for (const rateIdChunk of chunk(rateIds, 90)) {
      ruleRows.push(
        ...(await db
          .select()
          .from(taxRateRules)
          .where(
            and(
              inArray(taxRateRules.taxRateId, rateIdChunk),
              isNull(taxRateRules.deletedAt),
            ),
          )),
      );
    }
    const labels = await loadRuleLabels(ruleRows);
    const rulesByRate = new Map<string, TaxRateRuleDTO[]>();
    ruleRows.forEach((row) => {
      const rules = rulesByRate.get(row.taxRateId) ?? [];
      rules.push(toTaxRateRuleDTO(row, labels));
      rulesByRate.set(row.taxRateId, rules);
    });
    return rateRows.map((row) =>
      toTaxRateDTO(row, rulesByRate.get(row.id) ?? []),
    );
  },
  async listRatePage(options: {
    taxRegionId: string;
    kind: "default" | "override";
    query?: string | null;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ taxRates: TaxRateDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [
      eq(taxRates.taxRegionId, options.taxRegionId),
      eq(taxRates.isDefault, options.kind === "default"),
      isNull(taxRates.deletedAt),
    ];
    if (options.query?.trim()) {
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(like(taxRates.name, pattern), like(taxRates.code, pattern)) as SQL,
      );
    }
    const sortColumn =
      options.sortBy === "updatedAt"
        ? taxRates.updatedAt
        : options.sortBy === "createdAt"
          ? taxRates.createdAt
          : taxRates.name;
    const condition = and(...conditions);
    const [counts, rows] = await Promise.all([
      db.select({ value: count() }).from(taxRates).where(condition),
      db
        .select()
        .from(taxRates)
        .where(condition)
        .orderBy(
          options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
        )
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    const rateIds = rows.map((row) => row.id);
    const ruleRows = rateIds.length
      ? await db
          .select()
          .from(taxRateRules)
          .where(
            and(
              inArray(taxRateRules.taxRateId, rateIds),
              isNull(taxRateRules.deletedAt),
            ),
          )
      : [];
    const labels = await loadRuleLabels(ruleRows);
    const rulesByRate = new Map<string, TaxRateRuleDTO[]>();
    ruleRows.forEach((row) => {
      const rules = rulesByRate.get(row.taxRateId) ?? [];
      rules.push(toTaxRateRuleDTO(row, labels));
      rulesByRate.set(row.taxRateId, rules);
    });
    return {
      taxRates: rows.map((row) =>
        toTaxRateDTO(row, rulesByRate.get(row.id) ?? []),
      ),
      total: Number(counts[0]?.value ?? 0),
    };
  },
  async listRuleTargetPage(options: {
    reference: TaxRateRuleReference;
    query?: string | null;
    page: number;
    limit: number;
  }): Promise<{ items: Array<{ id: string; label: string }>; total: number }> {
    const db = await getDb();
    const offset = (options.page - 1) * options.limit;
    if (options.reference === "product") {
      const condition = and(
        isNull(products.deletedAt),
        options.query?.trim()
          ? like(products.title, containsPattern(options.query.trim()))
          : undefined,
      );
      const [counts, rows] = await Promise.all([
        db.select({ value: count() }).from(products).where(condition),
        db
          .select({ id: products.id, label: products.title })
          .from(products)
          .where(condition)
          .orderBy(asc(products.title))
          .limit(options.limit)
          .offset(offset),
      ]);
      return { items: rows, total: Number(counts[0]?.value ?? 0) };
    }
    if (options.reference === "product_type") {
      const condition = and(
        isNull(productTypes.deletedAt),
        options.query?.trim()
          ? like(productTypes.value, containsPattern(options.query.trim()))
          : undefined,
      );
      const [counts, rows] = await Promise.all([
        db.select({ value: count() }).from(productTypes).where(condition),
        db
          .select({ id: productTypes.id, label: productTypes.value })
          .from(productTypes)
          .where(condition)
          .orderBy(asc(productTypes.value))
          .limit(options.limit)
          .offset(offset),
      ]);
      return { items: rows, total: Number(counts[0]?.value ?? 0) };
    }
    const condition = and(
      isNull(shippingOptions.deletedAt),
      options.query?.trim()
        ? like(shippingOptions.name, containsPattern(options.query.trim()))
        : undefined,
    );
    const [counts, rows] = await Promise.all([
      db.select({ value: count() }).from(shippingOptions).where(condition),
      db
        .select({ id: shippingOptions.id, label: shippingOptions.name })
        .from(shippingOptions)
        .where(condition)
        .orderBy(asc(shippingOptions.name))
        .limit(options.limit)
        .offset(offset),
    ]);
    return { items: rows, total: Number(counts[0]?.value ?? 0) };
  },
  async ruleTargetsExist(
    rules: Array<{ reference: TaxRateRuleReference; referenceId: string }>,
  ): Promise<boolean> {
    if (!rules.length) return true;
    const db = await getDb();
    const idsFor = (reference: TaxRateRuleReference) => [
      ...new Set(
        rules
          .filter((rule) => rule.reference === reference)
          .map((rule) => rule.referenceId),
      ),
    ];
    const verify = async (
      ids: string[],
      query: (ids: string[]) => Promise<Array<{ id: string }>>,
    ) => {
      let found = 0;
      for (const idChunk of chunk(ids, 90))
        found += (await query(idChunk)).length;
      return found === ids.length;
    };
    const [productsExist, typesExist, shippingExist] = await Promise.all([
      verify(idsFor("product"), (ids) =>
        db
          .select({ id: products.id })
          .from(products)
          .where(and(inArray(products.id, ids), isNull(products.deletedAt))),
      ),
      verify(idsFor("product_type"), (ids) =>
        db
          .select({ id: productTypes.id })
          .from(productTypes)
          .where(
            and(inArray(productTypes.id, ids), isNull(productTypes.deletedAt)),
          ),
      ),
      verify(idsFor("shipping_option"), (ids) =>
        db
          .select({ id: shippingOptions.id })
          .from(shippingOptions)
          .where(
            and(
              inArray(shippingOptions.id, ids),
              isNull(shippingOptions.deletedAt),
            ),
          ),
      ),
    ]);
    return productsExist && typesExist && shippingExist;
  },
  async createRegion(data: {
    id: string;
    countryCode: string;
    provinceCode?: string | null;
    parentId?: string | null;
    providerId?: string | null;
    createdBy?: string | null;
    defaultTaxRate?: {
      name: string;
      code: string;
      rate: number | null;
      isCombinable: boolean;
    };
  }) {
    const db = await getDb();
    const now = new Date().toISOString();
    const { defaultTaxRate, ...region } = data;
    const regionStatement = db
      .insert(taxRegions)
      .values({ ...region, createdAt: now, updatedAt: now });
    if (!defaultTaxRate) {
      await regionStatement;
      return;
    }
    await db.batch([
      regionStatement,
      db.insert(taxRates).values({
        id: crypto.randomUUID(),
        taxRegionId: region.id,
        ...defaultTaxRate,
        isDefault: true,
        createdBy: region.createdBy,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  },
  async updateRegion(
    id: string,
    data: { providerId?: string | null; metadata?: Metadata },
  ) {
    const db = await getDb();
    await db
      .update(taxRegions)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(taxRegions.id, id), isNull(taxRegions.deletedAt)));
  },
  async createRate(data: {
    id: string;
    taxRegionId: string;
    name: string;
    code: string;
    rate: number | null;
    isDefault: boolean;
    isCombinable: boolean;
    createdBy?: string | null;
    rules?: Array<{ reference: TaxRateRuleReference; referenceId: string }>;
  }) {
    const db = await getDb();
    const now = new Date().toISOString();
    const { rules = [], ...rate } = data;
    const statements: BatchItem<"sqlite">[] = [];
    if (data.isDefault) {
      statements.push(
        db
          .update(taxRates)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(taxRates.taxRegionId, data.taxRegionId),
              eq(taxRates.isDefault, true),
              isNull(taxRates.deletedAt),
            ),
          ),
      );
    }
    statements.push(
      db.insert(taxRates).values({ ...rate, createdAt: now, updatedAt: now }),
    );
    const ruleRows = rules.map((rule) => ({
      id: crypto.randomUUID(),
      taxRateId: rate.id,
      ...rule,
      createdBy: rate.createdBy,
      createdAt: now,
      updatedAt: now,
    }));
    for (const rows of chunkForInsert(ruleRows, 7)) {
      statements.push(db.insert(taxRateRules).values(rows));
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },
  async updateRate(
    id: string,
    taxRegionId: string,
    data: {
      name?: string;
      code?: string;
      rate?: number | null;
      isDefault?: boolean;
      isCombinable?: boolean;
      metadata?: Metadata;
      rules?: Array<{ reference: TaxRateRuleReference; referenceId: string }>;
    },
  ) {
    const db = await getDb();
    const now = new Date().toISOString();
    const { rules, ...rate } = data;
    const statements: BatchItem<"sqlite">[] = [];
    if (data.isDefault) {
      statements.push(
        db
          .update(taxRates)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(taxRates.taxRegionId, taxRegionId),
              eq(taxRates.isDefault, true),
              isNull(taxRates.deletedAt),
            ),
          ),
      );
    }
    statements.push(
      db
        .update(taxRates)
        .set({ ...rate, updatedAt: now })
        .where(
          and(
            eq(taxRates.id, id),
            eq(taxRates.taxRegionId, taxRegionId),
            isNull(taxRates.deletedAt),
          ),
        ),
    );
    if (rules) {
      statements.push(
        db
          .update(taxRateRules)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(eq(taxRateRules.taxRateId, id), isNull(taxRateRules.deletedAt)),
          ),
      );
      const ruleRows = rules.map((rule) => ({
        id: crypto.randomUUID(),
        taxRateId: id,
        ...rule,
        createdAt: now,
        updatedAt: now,
      }));
      for (const rows of chunkForInsert(ruleRows, 6)) {
        statements.push(db.insert(taxRateRules).values(rows));
      }
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },
  async softDeleteRegions(ids: string[]) {
    if (!ids.length) return;
    const db = await getDb();
    const now = new Date().toISOString();
    const children: Array<{ id: string }> = [];
    for (const idChunk of chunk(ids, 90)) {
      children.push(
        ...(await db
          .select({ id: taxRegions.id })
          .from(taxRegions)
          .where(
            and(
              inArray(taxRegions.parentId, idChunk),
              isNull(taxRegions.deletedAt),
            ),
          )),
      );
    }
    const affectedIds = [
      ...new Set([...ids, ...children.map((row) => row.id)]),
    ];
    const rateIds: string[] = [];
    for (const affectedIdChunk of chunk(affectedIds, 90)) {
      rateIds.push(
        ...(
          await db
            .select({ id: taxRates.id })
            .from(taxRates)
            .where(
              and(
                inArray(taxRates.taxRegionId, affectedIdChunk),
                isNull(taxRates.deletedAt),
              ),
            )
        ).map((row) => row.id),
      );
    }
    // Soft deletion does not trigger the schema's physical ON DELETE cascade,
    // so descendants, rates, and rules are retired in one D1 batch.
    const statements: BatchItem<"sqlite">[] = [];
    for (const rateIdChunk of chunk(rateIds, 90)) {
      statements.push(
        db
          .update(taxRateRules)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(taxRateRules.taxRateId, rateIdChunk),
              isNull(taxRateRules.deletedAt),
            ),
          ),
      );
    }
    for (const affectedIdChunk of chunk(affectedIds, 90)) {
      statements.push(
        db
          .update(taxRates)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(taxRates.taxRegionId, affectedIdChunk),
              isNull(taxRates.deletedAt),
            ),
          ),
        db
          .update(taxRegions)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(taxRegions.id, affectedIdChunk),
              isNull(taxRegions.deletedAt),
            ),
          ),
      );
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },
  async softDeleteRates(ids: string[]) {
    if (!ids.length) return;
    const db = await getDb();
    const now = new Date().toISOString();
    const statements: BatchItem<"sqlite">[] = [];
    for (const idChunk of chunk(ids, 90)) {
      statements.push(
        db
          .update(taxRateRules)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(taxRateRules.taxRateId, idChunk),
              isNull(taxRateRules.deletedAt),
            ),
          ),
        db
          .update(taxRates)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(inArray(taxRates.id, idChunk), isNull(taxRates.deletedAt)),
          ),
      );
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },
  listAvailableCountries: async () => {
    const db = await getDb();
    const used = new Set(
      (
        await db
          .select({ code: taxRegions.countryCode })
          .from(taxRegions)
          .where(and(isNull(taxRegions.parentId), isNull(taxRegions.deletedAt)))
      ).map((row) => row.code),
    );
    return getCountryCatalog()
      .filter((country) => !used.has(country.iso2))
      .map((country) => ({ code: country.iso2, name: country.displayName }));
  },
};
