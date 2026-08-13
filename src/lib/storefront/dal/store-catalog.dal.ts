import { getDb } from "@/db";
import { assets } from "@/db/asset.schema";
import { productSalesChannels } from "@/db/link.schema";
import {
  productCategories,
  productCategoryLinks,
  productCollections,
  productAssets,
  productVariantAssets,
  productVariants,
  products,
} from "@/db/product.schema";
import { containsPattern } from "@/lib/db/like-pattern";
import { productDal } from "@/lib/product/dal/product.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { MAX_GENERATED_VARIANTS } from "@/lib/product/variant-limits";
import { pricingDal } from "@/lib/pricing/dal/pricing.dal";
import { cartReservationDal } from "@/lib/inventory/dal/cart-reservation.dal";
import { DB_FANOUT_CONCURRENCY } from "@/lib/db/concurrency";
import pLimit from "p-limit";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  isNull,
  like,
  or,
  type SQL,
} from "drizzle-orm";
import type {
  StoreCategoryDTO,
  StoreCollectionDTO,
  StoreProductDetailDTO,
  StoreProductListItemDTO,
} from "../dto/store-catalog.dto";

export const storeCatalogDal = {
  async listProducts(options: {
    salesChannelId: string;
    query?: string | null;
    page: number;
    limit: number;
    sortOrder: "asc" | "desc";
  }) {
    const db = await getDb();
    const conditions: SQL[] = [
      eq(products.status, "published"),
      isNull(products.deletedAt),
      exists(
        db
          .select({ value: productSalesChannels.productId })
          .from(productSalesChannels)
          .where(
            and(
              eq(productSalesChannels.productId, products.id),
              eq(productSalesChannels.salesChannelId, options.salesChannelId),
            ),
          ),
      ),
    ];
    if (options.query?.trim()) {
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(
          like(products.title, pattern),
          like(products.handle, pattern),
        ) as SQL,
      );
    }
    const where = and(...conditions);
    const [totals, rows] = await Promise.all([
      db.select({ value: count() }).from(products).where(where),
      db
        .select({
          product: products,
          collectionTitle: productCollections.title,
          thumbnailAssetId: assets.id,
        })
        .from(products)
        .leftJoin(
          productCollections,
          and(
            eq(productCollections.id, products.collectionId),
            isNull(productCollections.deletedAt),
          ),
        )
        .leftJoin(
          assets,
          and(
            eq(assets.id, products.thumbnailAssetId),
            isNull(assets.deletedAt),
          ),
        )
        .where(where)
        .orderBy(
          options.sortOrder === "asc"
            ? asc(products.updatedAt)
            : desc(products.updatedAt),
        )
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    const data: StoreProductListItemDTO[] = rows.map(
      ({ product, collectionTitle, thumbnailAssetId }) => ({
        id: product.id,
        title: product.title,
        handle: product.handle,
        subtitle: product.subtitle,
        description: product.description,
        thumbnailUrl: thumbnailAssetId
          ? `/api/store/assets/${thumbnailAssetId}`
          : null,
        collectionId: product.collectionId,
        collectionTitle,
        updatedAt: product.updatedAt,
      }),
    );
    return { products: data, total: Number(totals[0]?.value ?? 0) };
  },

  async findProductByHandle(
    handle: string,
    salesChannelId: string,
    currencyCode: string,
    regionId: string,
  ): Promise<StoreProductDetailDTO | null> {
    const db = await getDb();
    const [match] = await db
      .select({ id: products.id })
      .from(products)
      .innerJoin(
        productSalesChannels,
        and(
          eq(productSalesChannels.productId, products.id),
          eq(productSalesChannels.salesChannelId, salesChannelId),
        ),
      )
      .where(
        and(
          eq(products.handle, handle),
          eq(products.status, "published"),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);
    if (!match) return null;
    const product = await productDal.findDetail(match.id);
    if (!product) return null;
    const variantPage = await productVariantDal.listPage({
      productId: product.id,
      sortBy: "createdAt",
      sortOrder: "asc",
      page: 1,
      limit: MAX_GENERATED_VARIANTS,
    });
    if (variantPage.total > MAX_GENERATED_VARIANTS) {
      throw new Error("Product variant limit exceeded");
    }
    const resolveVariant = pLimit(DB_FANOUT_CONCURRENCY);
    const variants = await Promise.all(
      variantPage.variants.map((variant) =>
        resolveVariant(async () => {
          const [price, managedAvailable] = await Promise.all([
            pricingDal.resolveVariantPrice(variant.id, {
              currencyCode,
              quantity: 1,
              regionId,
              salesChannelId,
            }),
            cartReservationDal.availableForVariant(variant.id, salesChannelId),
          ]);
          return {
            id: variant.id,
            title: variant.title,
            sku: variant.sku,
            allowBackorder: variant.allowBackorder,
            availableQuantity: managedAvailable ?? variant.inventoryQuantity,
            optionValueIds: variant.optionValueIds,
            assets: variant.assets.map((asset) => ({
              ...asset,
              url: `/api/store/assets/${asset.id}`,
            })),
            price: price
              ? {
                  currencyCode,
                  amount: price.amount,
                  originalAmount: price.originalAmount,
                  priceListType: price.priceListType,
                }
              : null,
          };
        }),
      ),
    );
    return {
      id: product.id,
      title: product.title,
      handle: product.handle,
      subtitle: product.subtitle,
      description: product.description,
      thumbnailUrl: product.thumbnailAssetId
        ? `/api/store/assets/${product.thumbnailAssetId}`
        : product.assets[0]
          ? `/api/store/assets/${product.assets[0].id}`
          : null,
      collectionId: product.collectionId,
      collectionTitle: product.collectionTitle,
      updatedAt: product.updatedAt.toISOString(),
      assets: product.assets.map((asset) => ({
        ...asset,
        url: `/api/store/assets/${asset.id}`,
      })),
      options: product.options.map((option) => ({
        id: option.id,
        title: option.title,
        values: option.values.map((value) => ({
          id: value.id,
          value: value.value,
        })),
      })),
      variants,
    };
  },

  async listCollections(salesChannelId: string): Promise<StoreCollectionDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productCollections)
      .where(
        and(
          isNull(productCollections.deletedAt),
          exists(
            db
              .select({ value: products.id })
              .from(products)
              .innerJoin(
                productSalesChannels,
                and(
                  eq(productSalesChannels.productId, products.id),
                  eq(productSalesChannels.salesChannelId, salesChannelId),
                ),
              )
              .where(
                and(
                  eq(products.collectionId, productCollections.id),
                  eq(products.status, "published"),
                  isNull(products.deletedAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(productCollections.title));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      handle: row.handle,
      description: row.description,
    }));
  },

  async listCategories(salesChannelId: string): Promise<StoreCategoryDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productCategories)
      .where(
        and(
          eq(productCategories.isActive, true),
          eq(productCategories.isInternal, false),
          isNull(productCategories.deletedAt),
          exists(
            db
              .select({ value: productCategoryLinks.productId })
              .from(productCategoryLinks)
              .innerJoin(
                products,
                eq(products.id, productCategoryLinks.productId),
              )
              .innerJoin(
                productSalesChannels,
                and(
                  eq(productSalesChannels.productId, products.id),
                  eq(productSalesChannels.salesChannelId, salesChannelId),
                ),
              )
              .where(
                and(
                  eq(productCategoryLinks.categoryId, productCategories.id),
                  eq(products.status, "published"),
                  isNull(products.deletedAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(productCategories.rank), asc(productCategories.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      handle: row.handle,
      description: row.description,
      parentCategoryId: row.parentCategoryId,
      rank: row.rank,
    }));
  },

  async findPublishedAsset(assetId: string, salesChannelId: string) {
    const db = await getDb();
    const [asset] = await db
      .select({ id: assets.id, url: assets.url })
      .from(assets)
      .where(and(eq(assets.id, assetId), isNull(assets.deletedAt)))
      .limit(1);
    if (!asset) return null;
    const [direct, variant] = await Promise.all([
      db
        .select({ id: productAssets.assetId })
        .from(productAssets)
        .innerJoin(products, eq(products.id, productAssets.productId))
        .innerJoin(
          productSalesChannels,
          and(
            eq(productSalesChannels.productId, products.id),
            eq(productSalesChannels.salesChannelId, salesChannelId),
          ),
        )
        .where(
          and(
            eq(productAssets.assetId, assetId),
            eq(products.status, "published"),
            isNull(products.deletedAt),
          ),
        )
        .limit(1),
      db
        .select({ id: productVariantAssets.assetId })
        .from(productVariantAssets)
        .innerJoin(
          productVariants,
          eq(productVariants.id, productVariantAssets.variantId),
        )
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(
          productSalesChannels,
          and(
            eq(productSalesChannels.productId, products.id),
            eq(productSalesChannels.salesChannelId, salesChannelId),
          ),
        )
        .where(
          and(
            eq(productVariantAssets.assetId, assetId),
            eq(products.status, "published"),
            isNull(productVariants.deletedAt),
            isNull(products.deletedAt),
          ),
        )
        .limit(1),
    ]);
    return direct[0] || variant[0] ? asset : null;
  },
};
