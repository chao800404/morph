import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { orderDal } from "@/lib/order/dal/order.dal";
import { promotionDal } from "@/lib/promotion/dal/promotion.dal";
import { productCollectionDal } from "@/lib/product/dal/product-collection.dal";
import { productOptionDal } from "@/lib/product/dal/product-option.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { productCategoryDal } from "@/lib/product/dal/product-taxonomy.dal";
import { productDal } from "@/lib/product/dal/product.dal";
import {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  GLOBAL_SEARCH_AREAS,
  GLOBAL_SEARCH_MAX_QUERY_LENGTH,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
  type GlobalSearchArea,
  type GlobalSearchResultGroup,
} from "@/lib/search/global-search";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { commerceReadMiddleware } from "../middleware/auth.middleware";

const searchableAreaSchema = z.enum(GLOBAL_SEARCH_AREAS);

const inputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(GLOBAL_SEARCH_MIN_QUERY_LENGTH)
    .max(GLOBAL_SEARCH_MAX_QUERY_LENGTH),
  area: searchableAreaSchema.default("all"),
  limit: z.number().int().min(1).max(100).default(GLOBAL_SEARCH_DEFAULT_LIMIT),
});

type SearchableArea = z.infer<typeof searchableAreaSchema>;
type SearchTask = () => Promise<GlobalSearchResultGroup>;
const enabled = (selected: SearchableArea, area: GlobalSearchArea) =>
  selected === "all" || selected === area;

export const globalSearch = createServerFn({ method: "POST" })
  .validator((data: unknown) => inputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    const { query, area, limit } = data;
    const tasks: SearchTask[] = [];

    if (enabled(area, "products")) {
      tasks.push(async () => {
        const page = await productDal.listPage({
          query,
          sortBy: "updatedAt",
          sortOrder: "desc",
          page: 1,
          limit,
        });
        return {
          area: "products",
          title: "Products",
          count: page.total,
          hasMore: page.total > page.products.length,
          items: page.products.map((product) => ({
            id: product.id,
            resource: "product",
            group: "Products",
            title: product.title,
            subtitle: product.handle,
            href: `/dashboard/products/${product.id}`,
          })),
        };
      });
    }

    if (enabled(area, "productVariants")) {
      tasks.push(async () => {
        const page = await productVariantDal.searchPage({ query, limit });
        return {
          area: "productVariants",
          title: "Product variants",
          count: page.total,
          hasMore: page.total > page.variants.length,
          items: page.variants.map((variant) => ({
            id: variant.id,
            resource: "product-variant",
            group: "Product variants",
            title: `${variant.productTitle} · ${variant.title}`,
            subtitle:
              [variant.optionValues, variant.sku].filter(Boolean).join(" · ") ||
              undefined,
            href: `/dashboard/products/${variant.productId}/variant/${variant.id}`,
          })),
        };
      });
    }

    if (enabled(area, "assets")) {
      tasks.push(async () => {
        const [assetPage, folderPage] = await Promise.all([
          assetDal.searchPage({
            query,
            type: "all",
            sortBy: "updatedAt",
            sortOrder: "desc",
            page: 1,
            limit,
          }),
          assetFolderDal.search({ query, limit }),
        ]);
        const items = [
          ...folderPage.folders.map((folder) => ({
            id: folder.id,
            resource: "asset-folder" as const,
            group: "Assets",
            title: folder.name,
            subtitle: folder.path,
            href: `/dashboard/assets?folderId=${encodeURIComponent(folder.id)}`,
          })),
          ...assetPage.assets.map((asset) => ({
            id: asset.id,
            resource: "asset" as const,
            group: "Assets",
            title: asset.name,
            subtitle: asset.originalName,
            href: `/dashboard/assets/view?assetId=${encodeURIComponent(asset.id)}`,
          })),
        ].slice(0, limit);
        const count = assetPage.total + folderPage.total;
        return {
          area: "assets",
          title: "Assets",
          count,
          hasMore: count > items.length,
          items,
        };
      });
    }

    if (enabled(area, "orders")) {
      tasks.push(async () => {
        const page = await orderDal.listPage({
          query: query.replace(/^#/, ""),
          sortBy: "updatedAt",
          sortOrder: "desc",
          page: 1,
          limit,
        });
        return {
          area: "orders",
          title: "Orders",
          count: page.total,
          hasMore: page.total > page.orders.length,
          items: page.orders.map((order) => ({
            id: order.id,
            resource: "order",
            group: "Orders",
            title: `Order #${order.displayId}`,
            subtitle: order.email ?? undefined,
            href: `/dashboard/orders/${order.id}`,
          })),
        };
      });
    }

    if (enabled(area, "promotions")) {
      tasks.push(async () => {
        const page = await promotionDal.listPage({
          query,
          sortBy: "updatedAt",
          sortOrder: "desc",
          page: 1,
          limit,
        });
        return {
          area: "promotions",
          title: "Promotions",
          count: page.total,
          hasMore: page.total > page.promotions.length,
          items: page.promotions.map((promotion) => ({
            id: promotion.id,
            resource: "promotion",
            group: "Promotions",
            title: promotion.code,
            subtitle: promotion.status,
            href: `/dashboard/promotions/${promotion.id}`,
          })),
        };
      });
    }

    if (enabled(area, "collections")) {
      tasks.push(async () => {
        const page = await productCollectionDal.listPage({
          query,
          sortBy: "updatedAt",
          sortOrder: "desc",
          page: 1,
          limit,
        });
        return {
          area: "collections",
          title: "Collections",
          count: page.total,
          hasMore: page.total > page.collections.length,
          items: page.collections.map((collection) => ({
            id: collection.id,
            resource: "collection",
            group: "Collections",
            title: collection.title,
            subtitle: collection.handle,
            href: `/dashboard/collections/${collection.id}`,
          })),
        };
      });
    }

    if (enabled(area, "categories")) {
      tasks.push(async () => {
        const page = await productCategoryDal.listPage({
          query,
          sortBy: "updatedAt",
          sortOrder: "desc",
          page: 1,
          limit,
        });
        return {
          area: "categories",
          title: "Categories",
          count: page.total,
          hasMore: page.total > page.categories.length,
          items: page.categories.map((category) => ({
            id: category.id,
            resource: "category",
            group: "Categories",
            title: category.name,
            subtitle: category.ancestorNames.join(" / "),
            href: `/dashboard/categories/${category.id}`,
          })),
        };
      });
    }

    if (enabled(area, "options")) {
      tasks.push(async () => {
        const page = await productOptionDal.listPage({
          query,
          sortBy: "updatedAt",
          sortOrder: "desc",
          page: 1,
          limit,
        });
        return {
          area: "options",
          title: "Options",
          count: page.total,
          hasMore: page.total > page.options.length,
          items: page.options.map((option) => ({
            id: option.id,
            resource: "option",
            group: "Options",
            title: option.title,
            subtitle: option.values.map((value) => value.value).join(", "),
            href: `/dashboard/product-options/${option.id}`,
          })),
        };
      });
    }

    const settled = await Promise.allSettled(tasks.map((task) => task()));
    const groups = settled
      .filter(
        (result): result is PromiseFulfilledResult<GlobalSearchResultGroup> =>
          result.status === "fulfilled" && result.value.items.length > 0,
      )
      .map((result) => result.value);
    const failures = settled.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    if (failures.length === tasks.length && tasks.length > 0) {
      return {
        success: false as const,
        message: "Search is temporarily unavailable",
        data: { groups },
        error: "SEARCH_FAILED",
      };
    }

    return { success: true as const, data: { groups } };
  });
