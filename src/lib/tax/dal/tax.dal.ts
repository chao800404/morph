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
import { findCountry, getCountryCatalog } from "@/lib/region/countries";
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
import type {
  TaxRateDTO,
  TaxRateRuleDTO,
  TaxRateRuleReference,
  TaxRegionDTO,
  TaxRegionDetailDTO,
  TaxRegionSummaryDTO,
} from "../dto/tax.dto";

// ICU country discovery is intentionally lazy. Running it at module import
// would add 676 DisplayNames lookups to every worker cold start, including
// requests that never touch tax settings.
const nameOf = (code: string) =>
  findCountry(code)?.displayName ?? code.toUpperCase();
const toRegion = (row: typeof taxRegions.$inferSelect): TaxRegionDTO => ({
  id: row.id,
  countryCode: row.countryCode,
  countryName: nameOf(row.countryCode),
  provinceCode: row.provinceCode ?? null,
  parentId: row.parentId ?? null,
  providerId: row.providerId ?? null,
  metadata: row.metadata ?? {},
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});
type RuleLabels = Map<string, string>;
const toRule = (
  row: typeof taxRateRules.$inferSelect,
  labels: RuleLabels,
): TaxRateRuleDTO => ({
  id: row.id,
  taxRateId: row.taxRateId,
  reference: row.reference as TaxRateRuleReference,
  referenceId: row.referenceId,
  label: labels.get(`${row.reference}:${row.referenceId}`) ?? row.referenceId,
});
const toRate = (
  row: typeof taxRates.$inferSelect,
  rules: TaxRateRuleDTO[] = [],
): TaxRateDTO => ({
  id: row.id,
  taxRegionId: row.taxRegionId,
  rate: row.rate ?? null,
  code: row.code,
  name: row.name,
  isDefault: row.isDefault,
  isCombinable: row.isCombinable,
  metadata: row.metadata ?? {},
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
  rules,
});

const loadRuleLabels = async (
  rows: Array<typeof taxRateRules.$inferSelect>,
): Promise<RuleLabels> => {
  const db = await getDb();
  const labels: RuleLabels = new Map();
  const idsFor = (reference: TaxRateRuleReference) =>
    rows
      .filter((row) => row.reference === reference)
      .map((row) => row.referenceId);
  const productIds = idsFor("product");
  const typeIds = idsFor("product_type");
  const shippingIds = idsFor("shipping_option");
  const [productRows, typeRows, shippingRows] = await Promise.all([
    productIds.length
      ? db
          .select({ id: products.id, label: products.title })
          .from(products)
          .where(inArray(products.id, productIds))
      : [],
    typeIds.length
      ? db
          .select({ id: productTypes.id, label: productTypes.value })
          .from(productTypes)
          .where(inArray(productTypes.id, typeIds))
      : [],
    shippingIds.length
      ? db
          .select({ id: shippingOptions.id, label: shippingOptions.name })
          .from(shippingOptions)
          .where(inArray(shippingOptions.id, shippingIds))
      : [],
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
  async findRegion(id: string): Promise<TaxRegionDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(taxRegions)
      .where(and(eq(taxRegions.id, id), isNull(taxRegions.deletedAt)))
      .limit(1);
    return rows[0] ? toRegion(rows[0]) : null;
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
        ...toRegion(row),
        provinceCount: provinces.get(row.id) ?? 0,
        taxRateCount: rates.get(row.id) ?? 0,
      })),
      total: Number(totalRows[0]?.value ?? 0),
    };
  },
  async findDetail(id: string): Promise<TaxRegionDetailDTO | null> {
    const region = await this.findRegion(id);
    if (!region) return null;
    const db = await getDb();
    const [provinceRows, rateRows] = await Promise.all([
      db
        .select()
        .from(taxRegions)
        .where(and(eq(taxRegions.parentId, id), isNull(taxRegions.deletedAt)))
        .orderBy(asc(taxRegions.provinceCode)),
      db
        .select()
        .from(taxRates)
        .where(and(eq(taxRates.taxRegionId, id), isNull(taxRates.deletedAt)))
        .orderBy(desc(taxRates.isDefault), asc(taxRates.name)),
    ]);
    const rateIds = rateRows.map((row) => row.id);
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
      rules.push(toRule(row, labels));
      rulesByRate.set(row.taxRateId, rules);
    });
    return {
      ...region,
      provinces: provinceRows.map((row) => ({
        ...toRegion(row),
        provinceCount: 0,
        taxRateCount: 0,
      })),
      taxRates: rateRows.map((row) =>
        toRate(row, rulesByRate.get(row.id) ?? []),
      ),
    };
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
    return toRate(
      rows[0],
      ruleRows.map((row) => toRule(row, labels)),
    );
  },
  async listRuleTargets() {
    const db = await getDb();
    const [productRows, typeRows, shippingRows] = await Promise.all([
      db
        .select({ id: products.id, label: products.title })
        .from(products)
        .where(isNull(products.deletedAt))
        .orderBy(asc(products.title)),
      db
        .select({ id: productTypes.id, label: productTypes.value })
        .from(productTypes)
        .where(isNull(productTypes.deletedAt))
        .orderBy(asc(productTypes.value)),
      db
        .select({ id: shippingOptions.id, label: shippingOptions.name })
        .from(shippingOptions)
        .where(isNull(shippingOptions.deletedAt))
        .orderBy(asc(shippingOptions.name)),
    ]);
    return {
      products: productRows,
      productTypes: typeRows,
      shippingOptions: shippingRows,
    };
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
    if (data.isDefault)
      await db
        .update(taxRates)
        .set({ isDefault: false, updatedAt: now })
        .where(
          and(
            eq(taxRates.taxRegionId, data.taxRegionId),
            eq(taxRates.isDefault, true),
            isNull(taxRates.deletedAt),
          ),
        );
    const { rules = [], ...rate } = data;
    await db
      .insert(taxRates)
      .values({ ...rate, createdAt: now, updatedAt: now });
    if (rules.length) {
      await db.insert(taxRateRules).values(
        rules.map((rule) => ({
          id: crypto.randomUUID(),
          taxRateId: rate.id,
          ...rule,
          createdBy: rate.createdBy,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
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
    if (data.isDefault)
      await db
        .update(taxRates)
        .set({ isDefault: false, updatedAt: now })
        .where(
          and(
            eq(taxRates.taxRegionId, taxRegionId),
            eq(taxRates.isDefault, true),
            isNull(taxRates.deletedAt),
          ),
        );
    const { rules, ...rate } = data;
    await db
      .update(taxRates)
      .set({ ...rate, updatedAt: now })
      .where(and(eq(taxRates.id, id), isNull(taxRates.deletedAt)));
    if (rules) {
      await db
        .update(taxRateRules)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(eq(taxRateRules.taxRateId, id), isNull(taxRateRules.deletedAt)),
        );
      if (rules.length) {
        await db.insert(taxRateRules).values(
          rules.map((rule) => ({
            id: crypto.randomUUID(),
            taxRateId: id,
            ...rule,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    }
  },
  async softDeleteRegions(ids: string[]) {
    if (!ids.length) return;
    const db = await getDb();
    const now = new Date().toISOString();
    const children = await db
      .select({ id: taxRegions.id })
      .from(taxRegions)
      .where(
        and(inArray(taxRegions.parentId, ids), isNull(taxRegions.deletedAt)),
      );
    const affectedIds = [
      ...new Set([...ids, ...children.map((row) => row.id)]),
    ];
    // Soft deletion does not trigger the schema's physical ON DELETE cascade,
    // so descendants and their rates must be retired explicitly.
    await db
      .update(taxRates)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(taxRates.taxRegionId, affectedIds),
          isNull(taxRates.deletedAt),
        ),
      );
    await db
      .update(taxRegions)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(inArray(taxRegions.id, affectedIds), isNull(taxRegions.deletedAt)),
      );
  },
  async softDeleteRates(ids: string[]) {
    if (!ids.length) return;
    const db = await getDb();
    const now = new Date().toISOString();
    await db
      .update(taxRates)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(taxRates.id, ids), isNull(taxRates.deletedAt)));
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
