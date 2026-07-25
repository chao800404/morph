import { getDb } from "@/db";
import {
  productAssets,
  productOptionValues,
  productOptions,
  products,
} from "@/db/product.schema";
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
  SQL,
} from "drizzle-orm";
import type {
  CreateProductOptionDTO,
  ProductDetailDTO,
  ProductDTO,
  ProductInsertDTO,
  ProductOptionDTO,
  UpdateProductDTO,
} from "../dto/product.dto";
import {
  toProductDTO,
  toProductOptionDTO,
  type ProductOptionRow,
  type ProductOptionValueRow,
  type ProductRow,
} from "../mappers/product.mapper";
import { chunk, chunkForInsert } from "./d1-batch";
import { productVariantDal } from "./product-variant.dal";
import { containsPattern } from "@/lib/db/like-pattern";

// Column counts drive the insert batch size; see d1-batch.ts.
const OPTION_COLUMNS = 6;
const OPTION_VALUE_COLUMNS = 6;
const PRODUCT_ASSET_COLUMNS = 3;

const mapFirst = (rows: ProductRow[]): ProductDTO | null =>
  rows.length > 0 ? toProductDTO(rows[0]) : null;

export const productDal = {
  async findById(id: string): Promise<ProductDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .limit(1);
    return mapFirst(rows);
  },

  async findByHandle(handle: string): Promise<ProductDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.handle, handle), isNull(products.deletedAt)))
      .limit(1);
    return mapFirst(rows);
  },

  async findByIds(ids: string[]): Promise<ProductDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows: ProductRow[] = [];
    for (const group of chunk(ids, 50)) {
      rows.push(
        ...(await db
          .select()
          .from(products)
          .where(
            and(inArray(products.id, group), isNull(products.deletedAt)),
          )),
      );
    }
    return rows.map(toProductDTO);
  },

  async findOptions(productId: string): Promise<ProductOptionDTO[]> {
    const db = await getDb();
    const optionRows = await db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, productId))
      .orderBy(asc(productOptions.rank));

    if (optionRows.length === 0) return [];

    const valueRows = await db
      .select()
      .from(productOptionValues)
      .where(
        inArray(
          productOptionValues.optionId,
          optionRows.map((row) => row.id),
        ),
      );

    return optionRows.map((row) => toProductOptionDTO(row, valueRows));
  },

  /** Product plus everything the detail view renders. */
  async findDetail(id: string): Promise<ProductDetailDTO | null> {
    const product = await this.findById(id);
    if (!product) return null;

    const db = await getDb();
    const [options, variants, assetRows] = await Promise.all([
      this.findOptions(id),
      productVariantDal.findByProductId(id),
      db
        .select()
        .from(productAssets)
        .where(eq(productAssets.productId, id))
        .orderBy(asc(productAssets.rank)),
    ]);

    return {
      ...product,
      options,
      variants,
      assetIds: assetRows.map((row) => row.assetId),
    };
  },

  async listPage(options: {
    query?: string | null;
    status?: ProductDTO["status"] | null;
    collectionId?: string | null;
    sortBy: "title" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ products: ProductDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(products.deletedAt)];

    if (options.query?.trim()) {
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(
          like(products.title, pattern),
          like(products.handle, pattern),
          like(products.subtitle, pattern),
        ) as SQL,
      );
    }
    if (options.status) {
      conditions.push(eq(products.status, options.status));
    }
    if (options.collectionId) {
      conditions.push(eq(products.collectionId, options.collectionId));
    }

    const sortColumn = {
      title: products.title,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
    }[options.sortBy];
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(products).where(condition),
      db
        .select()
        .from(products)
        .where(condition)
        .orderBy(orderBy)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    return {
      products: rows.map(toProductDTO),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async create(data: ProductInsertDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.insert(products).values({
      id: data.id,
      title: data.title,
      handle: data.handle,
      subtitle: data.subtitle ?? null,
      description: data.description ?? null,
      status: data.status ?? "draft",
      collectionId: data.collectionId ?? null,
      thumbnailAssetId: data.thumbnailAssetId ?? null,
      metadata: data.metadata ?? {},
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
      createdAt: data.createdAt?.toISOString() ?? now,
      updatedAt: data.updatedAt?.toISOString() ?? now,
    });
  },

  async update(id: string, data: UpdateProductDTO): Promise<void> {
    const db = await getDb();
    await db
      .update(products)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.handle !== undefined ? { handle: data.handle } : {}),
        ...(data.subtitle !== undefined ? { subtitle: data.subtitle } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.collectionId !== undefined
          ? { collectionId: data.collectionId }
          : {}),
        ...(data.thumbnailAssetId !== undefined
          ? { thumbnailAssetId: data.thumbnailAssetId }
          : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        updatedBy: data.updatedBy,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(products.id, id), isNull(products.deletedAt)));
  },

  /**
   * Replace a product's option axes and their values.
   *
   * Existing rows are deleted, which cascades to `product_variant_option_values`
   * and therefore detaches variants from the values they used. Callers that
   * keep variants must re-link them afterwards.
   */
  async replaceOptions(
    productId: string,
    options: CreateProductOptionDTO[],
  ): Promise<ProductOptionDTO[]> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db
      .delete(productOptions)
      .where(eq(productOptions.productId, productId));

    const optionRows: ProductOptionRow[] = [];
    const valueRows: ProductOptionValueRow[] = [];

    options.forEach((option, optionIndex) => {
      const optionId = crypto.randomUUID();
      optionRows.push({
        id: optionId,
        productId,
        title: option.title,
        rank: option.rank ?? optionIndex,
        createdAt: now,
        updatedAt: now,
      });
      option.values.forEach((value, valueIndex) => {
        valueRows.push({
          id: crypto.randomUUID(),
          optionId,
          value,
          rank: valueIndex,
          createdAt: now,
          updatedAt: now,
        });
      });
    });

    for (const group of chunkForInsert(optionRows, OPTION_COLUMNS)) {
      await db.insert(productOptions).values(group);
    }
    for (const group of chunkForInsert(valueRows, OPTION_VALUE_COLUMNS)) {
      await db.insert(productOptionValues).values(group);
    }

    return optionRows.map((row) => toProductOptionDTO(row, valueRows));
  },

  /** Replace the gallery. `assetIds` order becomes the display order. */
  async setAssets(productId: string, assetIds: string[]): Promise<void> {
    const db = await getDb();
    await db.delete(productAssets).where(eq(productAssets.productId, productId));

    const rows = assetIds.map((assetId, index) => ({
      productId,
      assetId,
      rank: index,
    }));
    for (const group of chunkForInsert(rows, PRODUCT_ASSET_COLUMNS)) {
      await db.insert(productAssets).values(group);
    }
  },

  async softDelete(ids: string[], updatedBy: string): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();

    for (const group of chunk(ids, 50)) {
      await db
        .update(products)
        .set({ deletedAt: now, updatedAt: now, updatedBy })
        .where(and(inArray(products.id, group), isNull(products.deletedAt)));
    }

    // Variants carry their own `deletedAt`, so they are marked too. Otherwise a
    // query that reads variants directly would still surface them.
    await productVariantDal.softDeleteByProductIds(ids, updatedBy);
  },
};
