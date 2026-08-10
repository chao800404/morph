import { getDb } from "@/db";
import {
  productVariantAssets,
  productVariantOptionValues,
  productVariantPriceHistory,
  productVariantPrices,
  productVariants,
  products,
} from "@/db/product.schema";
import { assets } from "@/db/asset.schema";
import { users } from "@/db/auth.schema";
import { and, asc, count, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { containsPattern } from "@/lib/db/like-pattern";
import { toGlobalSearchTerms } from "@/lib/search/global-search";
import { chunk, chunkForInsert } from "./d1-batch";
import type {
  ProductVariantDTO,
  ProductVariantInsertDTO,
  ProductVariantPriceHistoryDTO,
  ProductVariantSearchResultDTO,
  UpdateProductVariantDTO,
} from "../dto/product-variant.dto";
import {
  toProductVariantDTO,
  type ProductVariantOptionValueRow,
  type ProductVariantAssetRow,
  type ProductVariantPriceRow,
  type ProductVariantRow,
} from "../mappers/product-variant.mapper";

// Column counts drive the insert batch size; see d1-batch.ts.
const VARIANT_COLUMNS = 19;
const PRICE_COLUMNS = 6;
const OPTION_LINK_COLUMNS = 2;
const ASSET_LINK_COLUMNS = 3;

/** Load prices and option links for a set of variants, then assemble the DTOs. */
const hydrate = async (
  variantRows: ProductVariantRow[],
): Promise<ProductVariantDTO[]> => {
  if (variantRows.length === 0) return [];
  const db = await getDb();
  const variantIds = variantRows.map((row) => row.id);

  const priceRows: ProductVariantPriceRow[] = [];
  const linkRows: ProductVariantOptionValueRow[] = [];
  const assetRows: ProductVariantAssetRow[] = [];

  for (const ids of chunk(variantIds, 50)) {
    const [prices, links, variantAssets] = await Promise.all([
      db
        .select()
        .from(productVariantPrices)
        .where(inArray(productVariantPrices.variantId, ids)),
      db
        .select()
        .from(productVariantOptionValues)
        .where(inArray(productVariantOptionValues.variantId, ids)),
      db
        .select({
          variantId: productVariantAssets.variantId,
          assetId: productVariantAssets.assetId,
          rank: productVariantAssets.rank,
          name: assets.name,
          url: assets.url,
        })
        .from(productVariantAssets)
        .innerJoin(assets, eq(assets.id, productVariantAssets.assetId))
        .where(inArray(productVariantAssets.variantId, ids)),
    ]);
    priceRows.push(...prices);
    linkRows.push(...links);
    assetRows.push(...variantAssets);
  }

  return variantRows.map((row) =>
    toProductVariantDTO(row, priceRows, linkRows, assetRows),
  );
};

export const productVariantDal = {
  async findById(id: string): Promise<ProductVariantDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.id, id), isNull(productVariants.deletedAt)))
      .limit(1);
    const hydrated = await hydrate(rows);
    return hydrated[0] ?? null;
  },

  async findByProductId(productId: string): Promise<ProductVariantDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productVariants)
      .where(
        and(
          eq(productVariants.productId, productId),
          isNull(productVariants.deletedAt),
        ),
      )
      .orderBy(asc(productVariants.rank));
    return hydrate(rows);
  },

  async findByProductIds(productIds: string[]): Promise<ProductVariantDTO[]> {
    if (productIds.length === 0) return [];
    const db = await getDb();
    const rows: ProductVariantRow[] = [];

    for (const ids of chunk(productIds, 50)) {
      rows.push(
        ...(await db
          .select()
          .from(productVariants)
          .where(
            and(
              inArray(productVariants.productId, ids),
              isNull(productVariants.deletedAt),
            ),
          )
          .orderBy(asc(productVariants.rank))),
      );
    }
    return hydrate(rows);
  },

  /**
   * Global search across a variant and its parent product/options.
   * Every whitespace-delimited term must match somewhere, so a query such as
   * `p01 red` can match the product title and an option value respectively.
   */
  async searchPage(options: { query: string; limit: number }): Promise<{
    variants: ProductVariantSearchResultDTO[];
    total: number;
  }> {
    const db = await getDb();
    const optionSearchText = sql<string>`coalesce((
      select group_concat(po.title || ' ' || pov.value, ' ')
      from product_variant_option_values as pvov
      inner join product_option_values as pov on pov.id = pvov.option_value_id
      inner join product_options as po on po.id = pov.option_id
      where pvov.variant_id = ${productVariants.id}
        and pov.deleted_at is null
        and po.deleted_at is null
    ), '')`;
    const searchableText = sql<string>`
      coalesce(${products.title}, '') || ' ' ||
      coalesce(${products.handle}, '') || ' ' ||
      coalesce(${productVariants.title}, '') || ' ' ||
      coalesce(${productVariants.sku}, '') || ' ' ||
      coalesce(${productVariants.barcode}, '') || ' ' ||
      coalesce(${productVariants.ean}, '') || ' ' ||
      coalesce(${productVariants.upc}, '') || ' ' ||
      ${optionSearchText}
    `;
    const matches = toGlobalSearchTerms(options.query).map((term) =>
      like(searchableText, containsPattern(term)),
    );
    const condition = and(
      isNull(productVariants.deletedAt),
      isNull(products.deletedAt),
      ...matches,
    );

    const [totals, rows] = await Promise.all([
      db
        .select({ value: count() })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(condition),
      db
        .select({
          id: productVariants.id,
          productId: productVariants.productId,
          productTitle: products.title,
          title: productVariants.title,
          sku: productVariants.sku,
          optionValues: sql<string | null>`(
            select group_concat(pov.value, ' / ')
            from product_variant_option_values as pvov
            inner join product_option_values as pov on pov.id = pvov.option_value_id
            where pvov.variant_id = ${productVariants.id}
              and pov.deleted_at is null
          )`,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(condition)
        .orderBy(desc(productVariants.updatedAt), asc(productVariants.id))
        .limit(options.limit),
    ]);

    return { variants: rows, total: Number(totals[0]?.value ?? 0) };
  },

  /**
   * Which of a variant's unique identifiers is already taken.
   *
   * `sku` and `barcode` each have an active-only unique index, so a duplicate
   * is a D1 constraint failure wrapped in Drizzle's `Failed query:` — unusable
   * as a form error. Checking first is what lets the handler point at the field.
   *
   * Racy in principle: nothing stops a concurrent insert between this read and
   * the write. The index is still the real guarantee; this only decides which
   * of the two errors the author sees, and on a single-operator dashboard the
   * friendly one wins nearly always.
   */
  async findIdentifierConflict(options: {
    sku?: string | null;
    barcode?: string | null;
    excludeId?: string;
  }): Promise<"sku" | "barcode" | null> {
    const db = await getDb();

    for (const [field, column, value] of [
      ["sku", productVariants.sku, options.sku],
      ["barcode", productVariants.barcode, options.barcode],
    ] as const) {
      // A blank identifier is "no value" and many variants may share it — the
      // index is partial on `IS NOT NULL` for exactly that reason.
      if (!value) continue;

      const rows = await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(and(eq(column, value), isNull(productVariants.deletedAt)))
        .limit(2);

      if (rows.some((row) => row.id !== options.excludeId)) return field;
    }

    return null;
  },

  /**
   * Insert variants together with their option links and prices.
   *
   * D1 has no interactive transactions, so a failure part-way leaves the rows
   * written so far. Callers must treat a rejection as "the product is in an
   * unknown state" and re-read rather than assume nothing happened.
   */
  async createMany(dataList: ProductVariantInsertDTO[]): Promise<void> {
    if (dataList.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();

    for (const group of chunkForInsert(dataList, VARIANT_COLUMNS)) {
      await db.insert(productVariants).values(
        group.map((data) => ({
          id: data.id,
          productId: data.productId,
          title: data.title,
          sku: data.sku ?? null,
          barcode: data.barcode ?? null,
          rank: data.rank ?? 0,
          manageInventory: data.manageInventory ?? true,
          allowBackorder: data.allowBackorder ?? false,
          inventoryQuantity: data.inventoryQuantity ?? 0,
          weight: data.weight ?? null,
          length: data.length ?? null,
          width: data.width ?? null,
          height: data.height ?? null,
          metadata: data.metadata ?? {},
          createdBy: data.createdBy,
          updatedBy: data.updatedBy,
          createdAt: data.createdAt?.toISOString() ?? now,
          updatedAt: data.updatedAt?.toISOString() ?? now,
        })),
      );
    }

    const links = dataList.flatMap((data) =>
      (data.optionValueIds ?? []).map((optionValueId) => ({
        variantId: data.id,
        optionValueId,
      })),
    );
    for (const group of chunkForInsert(links, OPTION_LINK_COLUMNS)) {
      await db.insert(productVariantOptionValues).values(group);
    }

    const prices = dataList.flatMap((data) =>
      (data.prices ?? []).map((price) => ({
        id: crypto.randomUUID(),
        variantId: data.id,
        currencyCode: price.currencyCode,
        amount: price.amount,
        createdAt: now,
        updatedAt: now,
      })),
    );
    for (const group of chunkForInsert(prices, PRICE_COLUMNS)) {
      await db.insert(productVariantPrices).values(group);
    }

    for (const data of dataList) {
      if (data.assetIds?.length) await this.setAssets(data.id, data.assetIds);
    }
  },

  async update(id: string, data: UpdateProductVariantDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db
      .update(productVariants)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.sku !== undefined ? { sku: data.sku } : {}),
        ...(data.barcode !== undefined ? { barcode: data.barcode } : {}),
        ...(data.rank !== undefined ? { rank: data.rank } : {}),
        ...(data.manageInventory !== undefined
          ? { manageInventory: data.manageInventory }
          : {}),
        ...(data.allowBackorder !== undefined
          ? { allowBackorder: data.allowBackorder }
          : {}),
        ...(data.inventoryQuantity !== undefined
          ? { inventoryQuantity: data.inventoryQuantity }
          : {}),
        ...(data.weight !== undefined ? { weight: data.weight } : {}),
        ...(data.length !== undefined ? { length: data.length } : {}),
        ...(data.width !== undefined ? { width: data.width } : {}),
        ...(data.height !== undefined ? { height: data.height } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        updatedBy: data.updatedBy,
        updatedAt: now,
      })
      .where(
        and(eq(productVariants.id, id), isNull(productVariants.deletedAt)),
      );

    if (data.prices) {
      await this.replacePrices(id, data.prices, data.updatedBy);
    }
  },

  /** Replaces the variant's whole price list; absent currencies are removed. */
  async replacePrices(
    variantId: string,
    prices: { currencyCode: string; amount: number }[],
    changedBy: string,
  ): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    const previous = await db
      .select()
      .from(productVariantPrices)
      .where(eq(productVariantPrices.variantId, variantId));
    const previousByCurrency = new Map(
      previous.map((price) => [price.currencyCode, price.amount]),
    );
    const nextByCurrency = new Map(
      prices.map((price) => [price.currencyCode, price.amount]),
    );
    const changedCurrencies = new Set([
      ...previousByCurrency.keys(),
      ...nextByCurrency.keys(),
    ]);
    const historyRows = [...changedCurrencies]
      .filter(
        (currencyCode) =>
          previousByCurrency.get(currencyCode) !==
          nextByCurrency.get(currencyCode),
      )
      .map((currencyCode) => ({
        id: crypto.randomUUID(),
        variantId,
        currencyCode,
        oldAmount: previousByCurrency.get(currencyCode) ?? null,
        newAmount: nextByCurrency.get(currencyCode) ?? null,
        changedBy,
        changedAt: now,
      }));

    const rows = prices.map((price) => ({
      id: crypto.randomUUID(),
      variantId,
      currencyCode: price.currencyCode,
      amount: price.amount,
      createdAt: now,
      updatedAt: now,
    }));
    const statements: BatchItem<"sqlite">[] = [
      db
        .delete(productVariantPrices)
        .where(eq(productVariantPrices.variantId, variantId)),
    ];
    for (const group of chunkForInsert(rows, PRICE_COLUMNS)) {
      statements.push(db.insert(productVariantPrices).values(group));
    }
    for (const group of chunkForInsert(historyRows, 7)) {
      statements.push(db.insert(productVariantPriceHistory).values(group));
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },

  async findPriceHistory(
    variantId: string,
    limit = 20,
  ): Promise<ProductVariantPriceHistoryDTO[]> {
    const db = await getDb();
    const rows = await db
      .select({
        history: productVariantPriceHistory,
        changedByName: users.name,
      })
      .from(productVariantPriceHistory)
      .leftJoin(users, eq(productVariantPriceHistory.changedBy, users.id))
      .where(eq(productVariantPriceHistory.variantId, variantId))
      .orderBy(desc(productVariantPriceHistory.changedAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map((row) => ({
      ...row.history,
      changedByName: row.changedByName,
      changedAt: new Date(row.history.changedAt),
    }));
  },

  async setOptionValues(
    variantId: string,
    optionValueIds: string[],
  ): Promise<void> {
    const db = await getDb();
    await db
      .delete(productVariantOptionValues)
      .where(eq(productVariantOptionValues.variantId, variantId));

    const rows = optionValueIds.map((optionValueId) => ({
      variantId,
      optionValueId,
    }));
    for (const group of chunkForInsert(rows, OPTION_LINK_COLUMNS)) {
      await db.insert(productVariantOptionValues).values(group);
    }
  },

  /** Replace variant media; order defines display order and thumbnail. */
  async setAssets(variantId: string, assetIds: string[]): Promise<void> {
    const db = await getDb();
    await db
      .delete(productVariantAssets)
      .where(eq(productVariantAssets.variantId, variantId));

    const rows = [...new Set(assetIds)].map((assetId, rank) => ({
      variantId,
      assetId,
      rank,
    }));
    for (const group of chunkForInsert(rows, ASSET_LINK_COLUMNS)) {
      await db.insert(productVariantAssets).values(group);
    }

    await db
      .update(productVariants)
      .set({ thumbnailAssetId: rows[0]?.assetId ?? null })
      .where(
        and(
          eq(productVariants.id, variantId),
          isNull(productVariants.deletedAt),
        ),
      );
  },

  async softDelete(ids: string[], updatedBy: string): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();

    for (const group of chunk(ids, 50)) {
      await db
        .update(productVariants)
        .set({ deletedAt: now, updatedAt: now, updatedBy })
        .where(
          and(
            inArray(productVariants.id, group),
            isNull(productVariants.deletedAt),
          ),
        );
    }
  },

  async softDeleteByProductIds(
    productIds: string[],
    updatedBy: string,
  ): Promise<void> {
    if (productIds.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();

    for (const group of chunk(productIds, 50)) {
      await db
        .update(productVariants)
        .set({ deletedAt: now, updatedAt: now, updatedBy })
        .where(
          and(
            inArray(productVariants.productId, group),
            isNull(productVariants.deletedAt),
          ),
        );
    }
  },
};
