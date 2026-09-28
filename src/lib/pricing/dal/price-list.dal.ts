import { getDb } from "@/db";
import { customerGroups } from "@/db/customer.schema";
import { productVariantPriceSets } from "@/db/link.schema";
import {
  priceListRules,
  priceLists,
  priceSets,
  prices,
} from "@/db/pricing.schema";
import { products, productVariants } from "@/db/product.schema";
import { priceSetDal } from "./price-set.dal";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { likeContains } from "@/lib/db/like-query";
import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQL } from "drizzle-orm";
import type {
  PriceListDTO,
  PriceListListParams,
  PriceListPriceDTO,
  PriceListPriceListParams,
} from "../dto/price-list.dto";
import type {
  BatchPriceCreateInput,
  BatchPriceUpdateInput,
} from "@/lib/validations/price-list";

const RULE_COLUMNS = 7;
const PRICE_COLUMNS = 12;

const priceListRuleRows = (input: {
  priceListId: string;
  customerGroupIds: string[];
  regionIds: string[];
  now: string;
}) => {
  const rows = [
    ["customerGroupId", input.customerGroupIds],
    ["regionId", input.regionIds],
  ] as const;
  return rows.flatMap(([attribute, values]) =>
    values.length
      ? [
          {
            id: crypto.randomUUID(),
            priceListId: input.priceListId,
            attribute,
            value: values,
            createdAt: input.now,
            updatedAt: input.now,
            deletedAt: null,
          },
        ]
      : [],
  );
};

const mapPriceList = (
  row: typeof priceLists.$inferSelect,
  customerGroupIds: string[],
  regionIds: string[],
  priceCount: number,
): PriceListDTO => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status,
  type: row.type,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  customerGroupIds,
  regionIds,
  metadata: row.metadata ?? {},
  priceCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const getRuleIdsByList = async (ids: string[]) => {
  if (!ids.length)
    return new Map<string, { customerGroupIds: string[]; regionIds: string[] }>();
  const db = await getDb();
  const rows = await db
    .select({
      priceListId: priceListRules.priceListId,
      attribute: priceListRules.attribute,
      value: priceListRules.value,
    })
    .from(priceListRules)
    .where(
      and(
        inArray(priceListRules.priceListId, ids),
        inArray(priceListRules.attribute, ["customerGroupId", "regionId"]),
        isNull(priceListRules.deletedAt),
      ),
    );
  const rules = new Map<
    string,
    { customerGroupIds: string[]; regionIds: string[] }
  >();
  for (const row of rows) {
    const values = Array.isArray(row.value) ? row.value.map(String) : [];
    const current = rules.get(row.priceListId) ?? {
      customerGroupIds: [],
      regionIds: [],
    };
    if (row.attribute === "customerGroupId")
      current.customerGroupIds.push(...values);
    if (row.attribute === "regionId") current.regionIds.push(...values);
    rules.set(row.priceListId, current);
  }
  return rules;
};

const countByList = async (ids: string[]) => {
  if (!ids.length) return new Map<string, number>();
  const db = await getDb();
  const rows = await db
    .select({ priceListId: prices.priceListId, value: count() })
    .from(prices)
    .where(and(inArray(prices.priceListId, ids), isNull(prices.deletedAt)))
    .groupBy(prices.priceListId);
  return new Map(rows.map((row) => [row.priceListId!, Number(row.value)]));
};

export const priceListDal = {
  async listPage(
    params: PriceListListParams,
  ): Promise<{ priceLists: PriceListDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(priceLists.deletedAt)];
    if (params.query?.trim()) {
      const term = params.query.trim();
      conditions.push(
        or(
          likeContains(priceLists.title, term),
          likeContains(priceLists.description, term),
        )!,
      );
    }
    if (params.status) conditions.push(eq(priceLists.status, params.status));
    if (params.type) conditions.push(eq(priceLists.type, params.type));
    const where = and(...conditions);
    const sortColumn =
      params.sortBy === "title"
        ? priceLists.title
        : params.sortBy === "updatedAt"
          ? priceLists.updatedAt
          : priceLists.createdAt;
    const direction = params.sortOrder === "asc" ? asc : desc;
    const offset = params.offset ?? (params.page - 1) * params.limit;
    const [totalRows, rows] = await Promise.all([
      db.select({ total: count() }).from(priceLists).where(where),
      db
        .select()
        .from(priceLists)
        .where(where)
        .orderBy(direction(sortColumn), asc(priceLists.id))
        .limit(params.limit)
        .offset(offset),
    ]);
    const ids = rows.map((row) => row.id);
    const [rules, counts] = await Promise.all([
      getRuleIdsByList(ids),
      countByList(ids),
    ]);
    return {
      priceLists: rows.map((row) =>
        mapPriceList(
          row,
          rules.get(row.id)?.customerGroupIds ?? [],
          rules.get(row.id)?.regionIds ?? [],
          counts.get(row.id) ?? 0,
        ),
      ),
      total: Number(totalRows[0]?.total ?? 0),
    };
  },

  async findById(id: string): Promise<PriceListDTO | null> {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(priceLists)
      .where(and(eq(priceLists.id, id), isNull(priceLists.deletedAt)))
      .limit(1);
    if (!row) return null;
    const [rules, counts] = await Promise.all([
      getRuleIdsByList([id]),
      countByList([id]),
    ]);
    const listRules = rules.get(id);
    return mapPriceList(
      row,
      listRules?.customerGroupIds ?? [],
      listRules?.regionIds ?? [],
      counts.get(id) ?? 0,
    );
  },

  async listPricesPage(
    params: PriceListPriceListParams,
  ): Promise<{ prices: PriceListPriceDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [
      eq(prices.priceListId, params.priceListId),
      isNull(prices.deletedAt),
      isNull(productVariants.deletedAt),
      isNull(products.deletedAt),
    ];
    if (params.query?.trim()) {
      const term = params.query.trim();
      conditions.push(
        or(
          likeContains(products.title, term),
          likeContains(productVariants.title, term),
          likeContains(productVariants.sku, term),
        )!,
      );
    }
    const where = and(...conditions);
    const sortColumn =
      params.sortBy === "product"
        ? products.title
        : params.sortBy === "amount"
          ? prices.amount
          : prices.createdAt;
    const direction = params.sortOrder === "asc" ? asc : desc;
    const [totalRows, rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(prices)
        .innerJoin(
          productVariantPriceSets,
          eq(productVariantPriceSets.priceSetId, prices.priceSetId),
        )
        .innerJoin(
          productVariants,
          eq(productVariants.id, productVariantPriceSets.variantId),
        )
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(where),
      db
        .select({
          price: prices,
          productId: products.id,
          variantId: productVariants.id,
          productTitle: products.title,
          variantTitle: productVariants.title,
          sku: productVariants.sku,
        })
        .from(prices)
        .innerJoin(
          productVariantPriceSets,
          eq(productVariantPriceSets.priceSetId, prices.priceSetId),
        )
        .innerJoin(
          productVariants,
          eq(productVariants.id, productVariantPriceSets.variantId),
        )
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(where)
        .orderBy(direction(sortColumn), asc(prices.id))
        .limit(params.limit)
        .offset(params.offset ?? (params.page - 1) * params.limit),
    ]);
    return {
      prices: rows.map(
        ({ price, productId, variantId, productTitle, variantTitle, sku }) => ({
          id: price.id,
          productId,
          variantId,
          productTitle,
          variantTitle,
          sku,
          currencyCode: price.currencyCode,
          amount: price.amount,
          minQuantity: price.minQuantity,
          maxQuantity: price.maxQuantity,
          createdAt: price.createdAt,
        }),
      ),
      total: Number(totalRows[0]?.total ?? 0),
    };
  },

  async activeCustomerGroups(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const db = await getDb();
    const rows = await db
      .select({ id: customerGroups.id })
      .from(customerGroups)
      .where(
        and(inArray(customerGroups.id, ids), isNull(customerGroups.deletedAt)),
      );
    return rows.map((row) => row.id);
  },

  async create(input: {
    id: string;
    title: string;
    description: string;
    status: "draft" | "active";
    type: "sale" | "override";
    startsAt: string | null;
    endsAt: string | null;
    customerGroupIds: string[];
    regionIds: string[];
    metadata: typeof priceLists.$inferInsert.metadata;
    now: string;
  }) {
    const db = await getDb();
    const rules = priceListRuleRows({
      priceListId: input.id,
      customerGroupIds: input.customerGroupIds,
      regionIds: input.regionIds,
      now: input.now,
    });
    const statements: BatchItem<"sqlite">[] = [
      db.insert(priceLists).values({
        id: input.id,
        title: input.title,
        description: input.description,
        status: input.status,
        type: input.type,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        rulesCount: rules.length,
        metadata: input.metadata,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      }),
    ];
    for (const group of chunkForInsert(rules, RULE_COLUMNS))
      statements.push(db.insert(priceListRules).values(group));
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },

  async update(input: {
    id: string;
    title?: string;
    description?: string;
    status?: "draft" | "active";
    type?: "sale" | "override";
    startsAt?: string | null;
    endsAt?: string | null;
    customerGroupIds?: string[];
    regionIds?: string[];
    metadata?: typeof priceLists.$inferInsert.metadata;
    now: string;
  }) {
    const db = await getDb();
    const activeRows = await db
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(and(eq(priceLists.id, input.id), isNull(priceLists.deletedAt)))
      .limit(1);
    if (!activeRows.length) return false;
    const rules = priceListRuleRows({
      priceListId: input.id,
      customerGroupIds: input.customerGroupIds ?? [],
      regionIds: input.regionIds ?? [],
      now: input.now,
    });
    const updates: Partial<typeof priceLists.$inferInsert> = {
      updatedAt: input.now,
    };
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.status !== undefined) updates.status = input.status;
    if (input.type !== undefined) updates.type = input.type;
    if (input.startsAt !== undefined) updates.startsAt = input.startsAt;
    if (input.endsAt !== undefined) updates.endsAt = input.endsAt;
    if (input.metadata !== undefined) updates.metadata = input.metadata;
    if (
      input.customerGroupIds !== undefined ||
      input.regionIds !== undefined
    ) {
      updates.rulesCount = rules.length;
    }
    const statements: BatchItem<"sqlite">[] = [
      db
        .update(priceLists)
        .set(updates)
        .where(and(eq(priceLists.id, input.id), isNull(priceLists.deletedAt))),
    ];
    if (
      input.customerGroupIds !== undefined ||
      input.regionIds !== undefined
    ) {
      statements.push(
        db
          .update(priceListRules)
          .set({ deletedAt: input.now, updatedAt: input.now })
          .where(
            and(
              eq(priceListRules.priceListId, input.id),
              isNull(priceListRules.deletedAt),
            ),
          ),
      );
    }
    for (const group of chunkForInsert(rules, RULE_COLUMNS))
      statements.push(db.insert(priceListRules).values(group));
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return true;
  },

  async softDelete(id: string, now: string) {
    const db = await getDb();
    const [row] = await db
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(and(eq(priceLists.id, id), isNull(priceLists.deletedAt)))
      .limit(1);
    if (!row) return false;
    await db.batch([
      db
        .update(priceLists)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(priceLists.id, id), isNull(priceLists.deletedAt))),
      db
        .update(priceListRules)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(priceListRules.priceListId, id),
            isNull(priceListRules.deletedAt),
          ),
        ),
    ]);
    return true;
  },

  async savePrice(input: {
    priceListId: string;
    variantId: string;
    currencyCode: string;
    amount: number;
    minQuantity?: number;
    maxQuantity?: number;
    now: string;
  }): Promise<"saved" | "missing-list" | "missing-variant" | "duplicate"> {
    const db = await getDb();
    const [list] = await db
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(
        and(eq(priceLists.id, input.priceListId), isNull(priceLists.deletedAt)),
      )
      .limit(1);
    if (!list) return "missing-list";
    const [variant] = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          eq(productVariants.id, input.variantId),
          isNull(productVariants.deletedAt),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);
    if (!variant) return "missing-variant";
    const setId = await this.ensureVariantPriceSet(input.variantId, input.now);
    const existing = await db
      .select({ id: prices.id })
      .from(prices)
      .where(
        and(
          eq(prices.priceSetId, setId),
          eq(prices.priceListId, input.priceListId),
          eq(prices.currencyCode, input.currencyCode),
          input.minQuantity === undefined
            ? isNull(prices.minQuantity)
            : eq(prices.minQuantity, input.minQuantity),
          input.maxQuantity === undefined
            ? isNull(prices.maxQuantity)
            : eq(prices.maxQuantity, input.maxQuantity),
          isNull(prices.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length) return "duplicate";
    const inserted = await db
      .insert(prices)
      .values({
        id: crypto.randomUUID(),
        priceSetId: setId,
        priceListId: input.priceListId,
        currencyCode: input.currencyCode,
        amount: input.amount,
        minQuantity: input.minQuantity ?? null,
        maxQuantity: input.maxQuantity ?? null,
        rulesCount: 0,
        title: null,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      })
      .onConflictDoNothing()
      .returning({ id: prices.id });
    return inserted.length ? "saved" : "duplicate";
  },

  /**
   * Apply a Medusa-shaped price batch as one D1 batch transaction. All
   * references are checked before any mutation; the unique price-list index
   * remains the final guard against concurrent duplicate tiers.
   */
  async applyPriceBatch(input: {
    priceListId: string;
    create: BatchPriceCreateInput[];
    update: BatchPriceUpdateInput[];
    delete: string[];
    now: string;
  }): Promise<
    | {
        success: true;
        createdIds: string[];
        updatedIds: string[];
        deletedIds: string[];
      }
    | {
        success: false;
        error:
          | "missing-list"
          | "missing-variant"
          | "missing-price"
          | "invalid-range";
      }
  > {
    const db = await getDb();
    const [list] = await db
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(
        and(eq(priceLists.id, input.priceListId), isNull(priceLists.deletedAt)),
      )
      .limit(1);
    if (!list) return { success: false, error: "missing-list" };

    const updateIds = input.update.map((price) => price.id);
    const [currentUpdates, currentDeletes] = await Promise.all([
      updateIds.length
        ? db
            .select({
              id: prices.id,
              priceSetId: prices.priceSetId,
              currencyCode: prices.currencyCode,
              minQuantity: prices.minQuantity,
              maxQuantity: prices.maxQuantity,
            })
            .from(prices)
            .where(
              and(
                eq(prices.priceListId, input.priceListId),
                inArray(prices.id, updateIds),
                isNull(prices.deletedAt),
              ),
            )
        : Promise.resolve([]),
      input.delete.length
        ? db
            .select({ id: prices.id })
            .from(prices)
            .where(
              and(
                eq(prices.priceListId, input.priceListId),
                inArray(prices.id, input.delete),
                isNull(prices.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ]);
    if (currentUpdates.length !== input.update.length)
      return { success: false, error: "missing-price" };
    if (currentDeletes.length !== input.delete.length)
      return { success: false, error: "missing-price" };

    const variantIds = [
      ...new Set([
        ...input.create.map((price) => price.variantId),
        ...input.update.flatMap((price) =>
          price.variantId === undefined ? [] : [price.variantId],
        ),
      ]),
    ];
    const validVariants = variantIds.length
      ? await db
          .select({ id: productVariants.id })
          .from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(
            and(
              inArray(productVariants.id, variantIds),
              isNull(productVariants.deletedAt),
              isNull(products.deletedAt),
            ),
          )
      : [];
    if (validVariants.length !== variantIds.length)
      return { success: false, error: "missing-variant" };

    const associations = variantIds.length
      ? await db
          .select({
            variantId: productVariantPriceSets.variantId,
            priceSetId: productVariantPriceSets.priceSetId,
          })
          .from(productVariantPriceSets)
          .innerJoin(
            priceSets,
            and(
              eq(priceSets.id, productVariantPriceSets.priceSetId),
              isNull(priceSets.deletedAt),
            ),
          )
          .where(inArray(productVariantPriceSets.variantId, variantIds))
          .orderBy(asc(productVariantPriceSets.priceSetId))
      : [];
    const priceSetByVariant = new Map<string, string>();
    for (const association of associations) {
      if (!priceSetByVariant.has(association.variantId)) {
        priceSetByVariant.set(association.variantId, association.priceSetId);
      }
    }

    const updatesById = new Map(input.update.map((price) => [price.id, price]));
    const currentById = new Map(
      currentUpdates.map((price) => [price.id, price]),
    );
    const resolvedUpdates = input.update.map((price) => {
      const current = currentById.get(price.id)!;
      const minQuantity =
        price.minQuantity === undefined
          ? current.minQuantity
          : price.minQuantity;
      const maxQuantity =
        price.maxQuantity === undefined
          ? current.maxQuantity
          : price.maxQuantity;
      if (
        (maxQuantity !== null && minQuantity === null) ||
        (maxQuantity !== null &&
          minQuantity !== null &&
          maxQuantity < minQuantity)
      ) {
        return null;
      }
      return {
        ...price,
        priceSetId:
          price.variantId === undefined
            ? current.priceSetId
            : (priceSetByVariant.get(price.variantId) ??
              `pset_${price.variantId}`),
        minQuantity,
        maxQuantity,
      };
    });
    if (resolvedUpdates.some((price) => price === null))
      return { success: false, error: "invalid-range" };

    const createdIds = input.create.map(() => crypto.randomUUID());
    const deletedIds = [...input.delete];
    const neededVariantIds = [
      ...new Set([
        ...input.create.map((price) => price.variantId),
        ...input.update.flatMap((price) =>
          price.variantId === undefined ? [] : [price.variantId],
        ),
      ]),
    ];
    const missingVariantIds = neededVariantIds.filter(
      (id) => !priceSetByVariant.has(id),
    );
    const newPriceSets = missingVariantIds.map((variantId) => ({
      id: `pset_${variantId}`,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }));
    const newAssociations = missingVariantIds.map((variantId) => ({
      variantId,
      priceSetId: `pset_${variantId}`,
      createdAt: input.now,
      updatedAt: input.now,
    }));
    for (const variantId of missingVariantIds) {
      priceSetByVariant.set(variantId, `pset_${variantId}`);
    }

    const createdRows = input.create.map((price, index) => ({
      id: createdIds[index]!,
      priceSetId: priceSetByVariant.get(price.variantId)!,
      priceListId: input.priceListId,
      currencyCode: price.currencyCode,
      amount: price.amount,
      minQuantity: price.minQuantity ?? null,
      maxQuantity: price.maxQuantity ?? null,
      rulesCount: 0,
      title: null,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }));

    const statements: BatchItem<"sqlite">[] = [];
    for (const rows of chunkForInsert(newPriceSets, 4)) {
      statements.push(db.insert(priceSets).values(rows).onConflictDoNothing());
    }
    for (const rows of chunkForInsert(newAssociations, 4)) {
      statements.push(
        db.insert(productVariantPriceSets).values(rows).onConflictDoNothing(),
      );
    }
    if (deletedIds.length) {
      statements.push(
        db
          .update(prices)
          .set({ deletedAt: input.now, updatedAt: input.now })
          .where(
            and(
              eq(prices.priceListId, input.priceListId),
              inArray(prices.id, deletedIds),
              isNull(prices.deletedAt),
            ),
          ),
      );
    }
    for (const price of resolvedUpdates) {
      if (!price) continue;
      const updates: Partial<typeof prices.$inferInsert> = {
        priceSetId: price.priceSetId,
        updatedAt: input.now,
      };
      if (price.currencyCode !== undefined)
        updates.currencyCode = price.currencyCode;
      if (price.amount !== undefined) updates.amount = price.amount;
      if (price.minQuantity !== undefined)
        updates.minQuantity = price.minQuantity;
      if (price.maxQuantity !== undefined)
        updates.maxQuantity = price.maxQuantity;
      statements.push(
        db
          .update(prices)
          .set(updates)
          .where(
            and(
              eq(prices.id, price.id),
              eq(prices.priceListId, input.priceListId),
              isNull(prices.deletedAt),
            ),
          ),
      );
    }
    for (const rows of chunkForInsert(createdRows, PRICE_COLUMNS)) {
      statements.push(db.insert(prices).values(rows));
    }
    if (statements.length) {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    }

    return {
      success: true,
      createdIds,
      updatedIds: [...updatesById.keys()],
      deletedIds,
    };
  },

  async findPricesByIds(
    priceListId: string,
    ids: string[],
  ): Promise<PriceListPriceDTO[]> {
    if (!ids.length) return [];
    const db = await getDb();
    const rows = await db
      .select({
        price: prices,
        productId: products.id,
        variantId: productVariants.id,
        productTitle: products.title,
        variantTitle: productVariants.title,
        sku: productVariants.sku,
      })
      .from(prices)
      .innerJoin(
        productVariantPriceSets,
        eq(productVariantPriceSets.priceSetId, prices.priceSetId),
      )
      .innerJoin(
        productVariants,
        eq(productVariants.id, productVariantPriceSets.variantId),
      )
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          eq(prices.priceListId, priceListId),
          inArray(prices.id, ids),
          isNull(prices.deletedAt),
          isNull(productVariants.deletedAt),
          isNull(products.deletedAt),
        ),
      )
      .orderBy(asc(prices.createdAt), asc(prices.id));
    const rowById = new Map(rows.map((row) => [row.price.id, row]));
    return ids.flatMap((id) => {
      const row = rowById.get(id);
      if (!row) return [];
      return [
        {
          id: row.price.id,
          productId: row.productId,
          variantId: row.variantId,
          productTitle: row.productTitle,
          variantTitle: row.variantTitle,
          sku: row.sku,
          currencyCode: row.price.currencyCode,
          amount: row.price.amount,
          minQuantity: row.price.minQuantity,
          maxQuantity: row.price.maxQuantity,
          createdAt: row.price.createdAt,
        },
      ];
    });
  },

  async ensureVariantPriceSet(
    variantId: string,
    now = new Date().toISOString(),
  ): Promise<string> {
    return priceSetDal.ensureForVariant(variantId, now);
  },

  async removePrice(input: {
    priceListId: string;
    priceId: string;
    now: string;
  }) {
    const db = await getDb();
    const [row] = await db
      .select({ id: prices.id })
      .from(prices)
      .innerJoin(
        priceLists,
        and(
          eq(priceLists.id, prices.priceListId),
          isNull(priceLists.deletedAt),
        ),
      )
      .where(
        and(
          eq(prices.id, input.priceId),
          eq(prices.priceListId, input.priceListId),
          isNull(prices.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return false;
    await db
      .update(prices)
      .set({ deletedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(prices.id, input.priceId),
          eq(prices.priceListId, input.priceListId),
          isNull(prices.deletedAt),
        ),
      );
    return true;
  },
};
