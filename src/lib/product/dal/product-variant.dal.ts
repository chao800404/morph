import { getDb } from "@/db";
import {
  productVariantOptionValues,
  productVariantPrices,
  productVariants,
} from "@/db/product.schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { chunk, chunkForInsert } from "./d1-batch";
import type {
  ProductVariantDTO,
  ProductVariantInsertDTO,
  UpdateProductVariantDTO,
} from "../dto/product-variant.dto";
import {
  toProductVariantDTO,
  type ProductVariantOptionValueRow,
  type ProductVariantPriceRow,
  type ProductVariantRow,
} from "../mappers/product-variant.mapper";

// Column counts drive the insert batch size; see d1-batch.ts.
const VARIANT_COLUMNS = 18;
const PRICE_COLUMNS = 6;
const OPTION_LINK_COLUMNS = 2;

/** Load prices and option links for a set of variants, then assemble the DTOs. */
const hydrate = async (
  variantRows: ProductVariantRow[],
): Promise<ProductVariantDTO[]> => {
  if (variantRows.length === 0) return [];
  const db = await getDb();
  const variantIds = variantRows.map((row) => row.id);

  const priceRows: ProductVariantPriceRow[] = [];
  const linkRows: ProductVariantOptionValueRow[] = [];

  for (const ids of chunk(variantIds, 50)) {
    const [prices, links] = await Promise.all([
      db
        .select()
        .from(productVariantPrices)
        .where(inArray(productVariantPrices.variantId, ids)),
      db
        .select()
        .from(productVariantOptionValues)
        .where(inArray(productVariantOptionValues.variantId, ids)),
    ]);
    priceRows.push(...prices);
    linkRows.push(...links);
  }

  return variantRows.map((row) => toProductVariantDTO(row, priceRows, linkRows));
};

export const productVariantDal = {
  async findById(id: string): Promise<ProductVariantDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productVariants)
      .where(
        and(eq(productVariants.id, id), isNull(productVariants.deletedAt)),
      )
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
        updatedBy: data.updatedBy,
        updatedAt: now,
      })
      .where(
        and(eq(productVariants.id, id), isNull(productVariants.deletedAt)),
      );

    if (data.prices) {
      await this.replacePrices(id, data.prices);
    }
  },

  /** Replaces the variant's whole price list; absent currencies are removed. */
  async replacePrices(
    variantId: string,
    prices: { currencyCode: string; amount: number }[],
  ): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db
      .delete(productVariantPrices)
      .where(eq(productVariantPrices.variantId, variantId));

    const rows = prices.map((price) => ({
      id: crypto.randomUUID(),
      variantId,
      currencyCode: price.currencyCode,
      amount: price.amount,
      createdAt: now,
      updatedAt: now,
    }));
    for (const group of chunkForInsert(rows, PRICE_COLUMNS)) {
      await db.insert(productVariantPrices).values(group);
    }
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
