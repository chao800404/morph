import { getDb } from "@/db";
import { assets } from "@/db/asset.schema";
import {
  productAssets,
  productCategories,
  productCategoryLinks,
  productCollections,
  productOptionValues,
  productOptions,
  productProductOptionValues,
  productProductOptions,
  productTagLinks,
  productTags,
  productTypes,
  productVariants,
  products,
} from "@/db/product.schema";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  notInArray,
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
  ProductListItemDTO,
  UpdateProductDTO,
} from "../dto/product.dto";
import { toProductOptionDTO } from "../mappers/product-option.mapper";
import { toProductDTO, type ProductRow } from "../mappers/product.mapper";
import { chunk, chunkForInsert } from "./d1-batch";
import { productOptionDal } from "./product-option.dal";
import { productVariantDal } from "./product-variant.dal";
import { MAX_GENERATED_VARIANTS } from "../variant-limits";
import { containsPattern } from "@/lib/db/like-pattern";
import { productSalesChannels } from "@/db/link.schema";
import { salesChannels } from "@/db/sales-channel.schema";
import { toSalesChannelDTO } from "@/lib/sales-channel/mappers/sales-channel.mapper";

// Column counts drive the insert batch size; see d1-batch.ts.
const PRODUCT_OPTION_VALUE_LINK_COLUMNS = 3;
const PRODUCT_ASSET_COLUMNS = 3;
/** Both link tables are a composite primary key and nothing else. */
const PRODUCT_LINK_COLUMNS = 2;

const mapFirst = (rows: ProductRow[]): ProductDTO | null =>
  rows.length > 0 ? toProductDTO(rows[0]) : null;

/** The gallery's lead image, which is what the thumbnail always is. */
export const thumbnailOf = (assetIds: string[]): string | null =>
  assetIds[0] ?? null;

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
          .where(and(inArray(products.id, group), isNull(products.deletedAt)))),
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
    // Each link table is joined to the row it points at, so the names arrive
    // with the ids rather than costing another query per card.
    const [
      options,
      assetRows,
      tagRows,
      categoryRows,
      organization,
      channelRows,
    ] = await Promise.all([
      this.findOptions(id),
      db
        .select({ id: assets.id, name: assets.name, url: assets.url })
        .from(productAssets)
        .innerJoin(assets, eq(assets.id, productAssets.assetId))
        .where(and(eq(productAssets.productId, id), isNull(assets.deletedAt)))
        .orderBy(asc(productAssets.rank)),
      db
        .select({ id: productTags.id, value: productTags.value })
        .from(productTagLinks)
        .innerJoin(productTags, eq(productTags.id, productTagLinks.tagId))
        .where(eq(productTagLinks.productId, id)),
      db
        .select({ id: productCategories.id, name: productCategories.name })
        .from(productCategoryLinks)
        .innerJoin(
          productCategories,
          eq(productCategories.id, productCategoryLinks.categoryId),
        )
        .where(eq(productCategoryLinks.productId, id)),
      // Both are nullable single links, so one row carries both names and a
      // left join keeps the product row when neither is set.
      db
        .select({
          collectionTitle: productCollections.title,
          typeValue: productTypes.value,
        })
        .from(products)
        .leftJoin(
          productCollections,
          eq(productCollections.id, products.collectionId),
        )
        .leftJoin(productTypes, eq(productTypes.id, products.typeId))
        .where(eq(products.id, id))
        .limit(1),
      db
        .select({ channel: salesChannels })
        .from(productSalesChannels)
        .innerJoin(
          salesChannels,
          and(
            eq(salesChannels.id, productSalesChannels.salesChannelId),
            isNull(salesChannels.deletedAt),
          ),
        )
        .where(eq(productSalesChannels.productId, id)),
    ]);

    return {
      ...product,
      options,
      assets: assetRows,
      assetIds: assetRows.map((row) => row.id),
      tags: tagRows,
      tagIds: tagRows.map((row) => row.id),
      categories: categoryRows,
      categoryIds: categoryRows.map((row) => row.id),
      collectionTitle: organization[0]?.collectionTitle ?? null,
      typeValue: organization[0]?.typeValue ?? null,
      salesChannels: channelRows.map(({ channel }) =>
        toSalesChannelDTO(channel),
      ),
      salesChannelIds: channelRows.map(({ channel }) => channel.id),
    };
  },

  async listPage(options: {
    query?: string | null;
    status?: ProductDTO["status"] | null;
    createdWithin?: "24h" | "7d" | "30d" | "90d" | null;
    updatedWithin?: "24h" | "7d" | "30d" | "90d" | null;
    collectionId?: string | null;
    categoryId?: string | null;
    optionId?: string | null;
    salesChannelId?: string | null;
    excludeSalesChannelId?: string | null;
    sortBy: "title" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ products: ProductListItemDTO[]; total: number }> {
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
    const withinHours = (within: "24h" | "7d" | "30d" | "90d") =>
      ({ "24h": 24, "7d": 168, "30d": 720, "90d": 2160 })[within];
    if (options.createdWithin) {
      conditions.push(
        gte(
          products.createdAt,
          new Date(
            Date.now() - withinHours(options.createdWithin) * 60 * 60 * 1000,
          ).toISOString(),
        ),
      );
    }
    if (options.updatedWithin) {
      conditions.push(
        gte(
          products.updatedAt,
          new Date(
            Date.now() - withinHours(options.updatedWithin) * 60 * 60 * 1000,
          ).toISOString(),
        ),
      );
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
    if (options.optionId) {
      // Same reason as categories: the link table would multiply rows.
      conditions.push(
        inArray(
          products.id,
          db
            .select({ id: productProductOptions.productId })
            .from(productProductOptions)
            .where(eq(productProductOptions.optionId, options.optionId)),
        ),
      );
    }
    if (options.salesChannelId) {
      conditions.push(
        inArray(
          products.id,
          db
            .select({ id: productSalesChannels.productId })
            .from(productSalesChannels)
            .where(
              eq(productSalesChannels.salesChannelId, options.salesChannelId),
            ),
        ),
      );
    }
    if (options.excludeSalesChannelId) {
      conditions.push(
        notInArray(
          products.id,
          db
            .select({ id: productSalesChannels.productId })
            .from(productSalesChannels)
            .where(
              eq(
                productSalesChannels.salesChannelId,
                options.excludeSalesChannelId,
              ),
            ),
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

    const productIds = rows.map((row) => row.id);
    const thumbnailIds = rows.flatMap((row) =>
      row.thumbnailAssetId ? [row.thumbnailAssetId] : [],
    );
    const collectionIds = rows.flatMap((row) =>
      row.collectionId ? [row.collectionId] : [],
    );
    const typeIds = rows.flatMap((row) => (row.typeId ? [row.typeId] : []));
    const [thumbnailRows, collectionRows, typeRows, channelRows, variantRows] =
      productIds.length === 0
        ? [[], [], [], [], []]
        : await Promise.all([
            thumbnailIds.length
              ? db
                  .select({ id: assets.id, url: assets.url })
                  .from(assets)
                  .where(
                    and(
                      inArray(assets.id, thumbnailIds),
                      isNull(assets.deletedAt),
                    ),
                  )
              : [],
            collectionIds.length
              ? db
                  .select({
                    id: productCollections.id,
                    title: productCollections.title,
                  })
                  .from(productCollections)
                  .where(
                    and(
                      inArray(productCollections.id, collectionIds),
                      isNull(productCollections.deletedAt),
                    ),
                  )
              : [],
            typeIds.length
              ? db
                  .select({ id: productTypes.id, value: productTypes.value })
                  .from(productTypes)
                  .where(
                    and(
                      inArray(productTypes.id, typeIds),
                      isNull(productTypes.deletedAt),
                    ),
                  )
              : [],
            db
              .select({
                productId: productSalesChannels.productId,
                id: salesChannels.id,
                name: salesChannels.name,
              })
              .from(productSalesChannels)
              .innerJoin(
                salesChannels,
                eq(productSalesChannels.salesChannelId, salesChannels.id),
              )
              .where(
                and(
                  inArray(productSalesChannels.productId, productIds),
                  isNull(salesChannels.deletedAt),
                ),
              ),
            db
              .select({
                productId: productVariants.productId,
                count: countDistinct(productVariants.id),
              })
              .from(productVariants)
              .where(
                and(
                  inArray(productVariants.productId, productIds),
                  isNull(productVariants.deletedAt),
                ),
              )
              .groupBy(productVariants.productId),
          ]);

    const thumbnails = new Map(thumbnailRows.map((row) => [row.id, row.url]));
    const collections = new Map(
      collectionRows.map((row) => [row.id, row.title]),
    );
    const types = new Map(typeRows.map((row) => [row.id, row.value]));
    const channelsByProduct = new Map<
      string,
      Array<{ id: string; name: string }>
    >();
    for (const row of channelRows) {
      const current = channelsByProduct.get(row.productId) ?? [];
      current.push({ id: row.id, name: row.name });
      channelsByProduct.set(row.productId, current);
    }
    const variantCounts = new Map(
      variantRows.map((row) => [row.productId, Number(row.count)]),
    );

    return {
      products: rows.map((row) => ({
        ...toProductDTO(row),
        thumbnailUrl: row.thumbnailAssetId
          ? (thumbnails.get(row.thumbnailAssetId) ?? null)
          : null,
        collectionTitle: row.collectionId
          ? (collections.get(row.collectionId) ?? null)
          : null,
        typeValue: row.typeId ? (types.get(row.typeId) ?? null) : null,
        salesChannels: channelsByProduct.get(row.id) ?? [],
        variantCount: variantCounts.get(row.id) ?? 0,
      })),
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
        // `typeId` and `discountable` were in the DTO and passed by the server
        // function, but never written — changing the product type or turning
        // discounts off looked like it saved and did nothing.
        ...(data.typeId !== undefined ? { typeId: data.typeId } : {}),
        ...(data.discountable !== undefined
          ? { discountable: data.discountable }
          : {}),
        ...(data.thumbnailAssetId !== undefined
          ? { thumbnailAssetId: data.thumbnailAssetId }
          : {}),
        ...(data.weight !== undefined ? { weight: data.weight } : {}),
        ...(data.length !== undefined ? { length: data.length } : {}),
        ...(data.width !== undefined ? { width: data.width } : {}),
        ...(data.height !== undefined ? { height: data.height } : {}),
        ...(data.originCountry !== undefined
          ? { originCountry: data.originCountry }
          : {}),
        ...(data.hsCode !== undefined ? { hsCode: data.hsCode } : {}),
        ...(data.midCode !== undefined ? { midCode: data.midCode } : {}),
        ...(data.material !== undefined ? { material: data.material } : {}),
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

    await this.linkOptions(productId, selections, actorId, 0);

    return this.findOptions(productId);
  },

  /**
   * Attach option axes to a product without disturbing the ones already there.
   *
   * `replaceOptions` deletes every link first, which orphans the option value
   * ids the existing variants store. Adding an axis has to leave those alone —
   * the old variants simply have no value on the new axis until someone edits
   * them.
   */
  async addOptions(
    productId: string,
    selections: ProductOptionSelectionDTO[],
    actorId: string,
  ): Promise<ProductOptionDTO[]> {
    const existing = await this.findOptions(productId);
    const taken = new Set(existing.map((option) => option.id));

    const additions = selections.filter(
      (selection) =>
        !("optionId" in selection) || !taken.has(selection.optionId),
    );
    if (additions.length === 0) return existing;

    await this.linkOptions(productId, additions, actorId, existing.length);

    return this.findOptions(productId);
  },

  /**
   * Detach option axes from a product.
   *
   * Only the link and its value links go; the option itself survives unless it
   * was exclusive to this product. The caller decides whether removal is
   * allowed — this does not check, because "is a variant using it" is a
   * question the server function answers with a message.
   */
  async removeOptions(
    productId: string,
    optionIds: string[],
    actorId: string,
  ): Promise<void> {
    if (optionIds.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();

    const links = await db
      .select()
      .from(productProductOptions)
      .where(
        and(
          eq(productProductOptions.productId, productId),
          inArray(productProductOptions.optionId, optionIds),
        ),
      );
    if (links.length === 0) return;

    for (const group of chunk(
      links.map((link) => link.id),
      50,
    )) {
      await db
        .delete(productProductOptionValues)
        .where(
          inArray(productProductOptionValues.productProductOptionId, group),
        );
      await db
        .delete(productProductOptions)
        .where(inArray(productProductOptions.id, group));
    }

    // An exclusive option exists only to serve this product, so it goes too.
    const exclusiveIds = (
      await db
        .select({ id: productOptions.id })
        .from(productOptions)
        .where(
          and(
            inArray(
              productOptions.id,
              links.map((link) => link.optionId),
            ),
            eq(productOptions.isExclusive, true),
          ),
        )
    ).map((row) => row.id);

    for (const group of chunk(exclusiveIds, 50)) {
      await db
        .update(productOptions)
        .set({ deletedAt: now, updatedAt: now, updatedBy: actorId })
        .where(inArray(productOptions.id, group));
    }
  },

  /**
   * Which variants reference each option, keyed by option id.
   *
   * Titles rather than a boolean so the refusal can name them: "Size is in use"
   * leaves the author hunting, and the Variants table only shows one page.
   */
  async variantsByOption(productId: string): Promise<Map<string, string[]>> {
    const options = await this.findOptions(productId);
    const page = await productVariantDal.listPage({
      productId,
      sortBy: "createdAt",
      sortOrder: "asc",
      page: 1,
      limit: MAX_GENERATED_VARIANTS,
    });
    if (page.total > MAX_GENERATED_VARIANTS) {
      throw new Error("Product variant limit exceeded");
    }
    const variants = page.variants;

    const byOption = new Map<string, string[]>();
    for (const option of options) {
      const owned = new Set(option.values.map((value) => value.id));
      const users = variants
        .filter((variant) => variant.optionValueIds.some((id) => owned.has(id)))
        .map((variant) => variant.title);
      if (users.length > 0) byOption.set(option.id, users);
    }
    return byOption;
  },

  /** Shared by `replaceOptions` and `addOptions`; `rankFrom` offsets the order. */
  async linkOptions(
    productId: string,
    selections: ProductOptionSelectionDTO[],
    actorId: string,
    rankFrom: number,
  ): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    for (const [offset, selection] of selections.entries()) {
      const index = rankFrom + offset;
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
      for (const group of chunkForInsert(
        valueLinks,
        PRODUCT_OPTION_VALUE_LINK_COLUMNS,
      )) {
        await db.insert(productProductOptionValues).values(group);
      }
    }
  },

  /** Replace the gallery. `assetIds` order becomes the display order. */
  async setAssets(productId: string, assetIds: string[]): Promise<void> {
    const db = await getDb();
    await db
      .delete(productAssets)
      .where(eq(productAssets.productId, productId));

    const rows = assetIds.map((assetId, index) => ({
      productId,
      assetId,
      rank: index,
    }));
    for (const group of chunkForInsert(rows, PRODUCT_ASSET_COLUMNS)) {
      await db.insert(productAssets).values(group);
    }

    // The thumbnail is the first image, and it is derived here rather than by
    // each caller: the two that existed both computed `assetIds[0]`, and the
    // third would have been the one that forgot. Kept as a column instead of a
    // join at read time because the storefront reads it on every product.
    await db
      .update(products)
      .set({ thumbnailAssetId: thumbnailOf(assetIds) })
      .where(eq(products.id, productId));
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
