import { getDb } from "@/db";
import {
  productAssets,
  productCategoryLinks,
  productOptionValues,
  productOptions,
  productProductOptionValues,
  productProductOptions,
  productTagLinks,
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
  ProductOptionDTO,
  ProductOptionSelectionDTO,
} from "../dto/product-option.dto";
import type {
  ProductDetailDTO,
  ProductDTO,
  ProductInsertDTO,
  UpdateProductDTO,
} from "../dto/product.dto";
import { toProductOptionDTO } from "../mappers/product-option.mapper";
import { toProductDTO, type ProductRow } from "../mappers/product.mapper";
import { chunk, chunkForInsert } from "./d1-batch";
import { productOptionDal } from "./product-option.dal";
import { productVariantDal } from "./product-variant.dal";
import { containsPattern } from "@/lib/db/like-pattern";

// Column counts drive the insert batch size; see d1-batch.ts.
const PRODUCT_OPTION_VALUE_LINK_COLUMNS = 3;
const PRODUCT_ASSET_COLUMNS = 3;
/** Both link tables are a composite primary key and nothing else. */
const PRODUCT_LINK_COLUMNS = 2;

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

  /**
   * The options this product uses, each carrying only the values the product
   * actually offers. An option may be global and shared, so its full value list
   * is filtered down to the product's selection.
   */
  async findOptions(productId: string): Promise<ProductOptionDTO[]> {
    const db = await getDb();
    const links = await db
      .select()
      .from(productProductOptions)
      .where(eq(productProductOptions.productId, productId))
      .orderBy(asc(productProductOptions.rank));

    if (links.length === 0) return [];

    const [optionRows, valueLinks] = await Promise.all([
      db
        .select()
        .from(productOptions)
        .where(
          and(
            inArray(
              productOptions.id,
              links.map((link) => link.optionId),
            ),
            isNull(productOptions.deletedAt),
          ),
        ),
      db
        .select()
        .from(productProductOptionValues)
        .where(
          inArray(
            productProductOptionValues.productProductOptionId,
            links.map((link) => link.id),
          ),
        ),
    ]);

    const selectedValueIds = new Set(
      valueLinks.map((link) => link.optionValueId),
    );
    const valueRows =
      selectedValueIds.size === 0
        ? []
        : await db
            .select()
            .from(productOptionValues)
            .where(
              and(
                inArray(productOptionValues.id, [...selectedValueIds]),
                isNull(productOptionValues.deletedAt),
              ),
            );

    const optionById = new Map(optionRows.map((row) => [row.id, row]));
    return links
      .map((link) => optionById.get(link.optionId))
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
      .map((row) => toProductOptionDTO(row, valueRows));
  },

  /** Product plus everything the detail view renders. */
  async findDetail(id: string): Promise<ProductDetailDTO | null> {
    const product = await this.findById(id);
    if (!product) return null;

    const db = await getDb();
    const [options, variants, assetRows, tagRows, categoryRows] =
      await Promise.all([
        this.findOptions(id),
        productVariantDal.findByProductId(id),
        db
          .select()
          .from(productAssets)
          .where(eq(productAssets.productId, id))
          .orderBy(asc(productAssets.rank)),
        db
          .select({ tagId: productTagLinks.tagId })
          .from(productTagLinks)
          .where(eq(productTagLinks.productId, id)),
        db
          .select({ categoryId: productCategoryLinks.categoryId })
          .from(productCategoryLinks)
          .where(eq(productCategoryLinks.productId, id)),
      ]);

    return {
      ...product,
      options,
      variants,
      assetIds: assetRows.map((row) => row.assetId),
      tagIds: tagRows.map((row) => row.tagId),
      categoryIds: categoryRows.map((row) => row.categoryId),
    };
  },

  async listPage(options: {
    query?: string | null;
    status?: ProductDTO["status"] | null;
    collectionId?: string | null;
    categoryId?: string | null;
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
    if (options.categoryId) {
      // A product belongs to many categories, so this filters through the link
      // table with a subquery rather than joining — a join would multiply rows
      // and break the count.
      conditions.push(
        inArray(
          products.id,
          db
            .select({ id: productCategoryLinks.productId })
            .from(productCategoryLinks)
            .where(eq(productCategoryLinks.categoryId, options.categoryId)),
        ),
      );
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
   * Replace which options a product uses and which of their values it offers.
   *
   * A selection either references an option from the shared library, or defines
   * one exclusive to this product. Only the link rows are rebuilt — the options
   * themselves are left alone, because a global option belongs to every product
   * that uses it.
   */
  async replaceOptions(
    productId: string,
    selections: ProductOptionSelectionDTO[],
    actorId: string,
  ): Promise<ProductOptionDTO[]> {
    const db = await getDb();
    const now = new Date().toISOString();

    // Exclusive options exist only to serve this product, so they go with the
    // links. Shared ones stay.
    const previous = await db
      .select()
      .from(productProductOptions)
      .where(eq(productProductOptions.productId, productId));
    const previousOptionIds = previous.map((link) => link.optionId);
    const exclusiveIds =
      previousOptionIds.length === 0
        ? []
        : (
            await db
              .select({ id: productOptions.id })
              .from(productOptions)
              .where(
                and(
                  inArray(productOptions.id, previousOptionIds),
                  eq(productOptions.isExclusive, true),
                ),
              )
          ).map((row) => row.id);

    await db
      .delete(productProductOptions)
      .where(eq(productProductOptions.productId, productId));
    for (const group of chunk(exclusiveIds, 50)) {
      await db
        .update(productOptions)
        .set({ deletedAt: now, updatedAt: now, updatedBy: actorId })
        .where(inArray(productOptions.id, group));
    }

    for (const [index, selection] of selections.entries()) {
      let optionId: string;
      let valueIds: string[];

      if ("optionId" in selection) {
        // The client sends ids, so ownership is re-checked here: a value id
        // belonging to another option would otherwise link silently.
        const library = await productOptionDal.findById(selection.optionId);
        if (!library) {
          throw new Error("The selected option no longer exists");
        }
        const owned = new Set(library.values.map((value) => value.id));
        optionId = selection.optionId;
        valueIds = selection.valueIds.filter((id) => owned.has(id));
        if (valueIds.length === 0) {
          throw new Error(
            `None of the selected values belong to the option "${library.title}"`,
          );
        }
      } else {
        optionId = crypto.randomUUID();
        await productOptionDal.create({
          id: optionId,
          title: selection.title,
          isExclusive: true,
          rank: index,
          values: selection.values,
          createdBy: actorId,
          updatedBy: actorId,
        });
        const created = await productOptionDal.findById(optionId);
        valueIds = created?.values.map((value) => value.id) ?? [];
      }

      const linkId = crypto.randomUUID();
      await db.insert(productProductOptions).values({
        id: linkId,
        productId,
        optionId,
        rank: index,
        createdAt: now,
        updatedAt: now,
      });

      const valueLinks = valueIds.map((optionValueId, rank) => ({
        productProductOptionId: linkId,
        optionValueId,
        rank,
      }));
      for (const group of chunkForInsert(valueLinks, PRODUCT_OPTION_VALUE_LINK_COLUMNS)) {
        await db.insert(productProductOptionValues).values(group);
      }
    }

    return this.findOptions(productId);
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

  /** Replace the product's tags. Ids are assumed to exist. */
  async setTags(productId: string, tagIds: string[]): Promise<void> {
    const db = await getDb();
    await db
      .delete(productTagLinks)
      .where(eq(productTagLinks.productId, productId));

    const rows = [...new Set(tagIds)].map((tagId) => ({ productId, tagId }));
    for (const group of chunkForInsert(rows, PRODUCT_LINK_COLUMNS)) {
      await db.insert(productTagLinks).values(group);
    }
  },

  /** Replace the product's categories. Ids are assumed to exist. */
  async setCategories(productId: string, categoryIds: string[]): Promise<void> {
    const db = await getDb();
    await db
      .delete(productCategoryLinks)
      .where(eq(productCategoryLinks.productId, productId));

    const rows = [...new Set(categoryIds)].map((categoryId) => ({
      productId,
      categoryId,
    }));
    for (const group of chunkForInsert(rows, PRODUCT_LINK_COLUMNS)) {
      await db.insert(productCategoryLinks).values(group);
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
