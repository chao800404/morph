import type { ProductListParams } from "@queries/product.queries";
import type { SalesChannelListParams } from "@queries/sales-channel.queries";

export const DASHBOARD_HOME_PRODUCT_PARAMS: ProductListParams = {
  sortBy: "updatedAt",
  sortOrder: "desc",
  page: 1,
  // The dashboard needs three visual previews, not merely the newest three
  // records. Fetch a small recent window so a product without a thumbnail
  // does not hide another recent product that has one.
  limit: 20,
};

export const selectDashboardProductCards = <
  T extends { thumbnailUrl: string | null },
>(products: T[], limit = 3): T[] => {
  const withThumbnail = products.filter((product) => product.thumbnailUrl);
  const withoutThumbnail = products.filter((product) => !product.thumbnailUrl);

  return [...withThumbnail, ...withoutThumbnail].slice(0, limit);
};

export const DASHBOARD_HOME_CHANNEL_PARAMS: SalesChannelListParams = {
  sortBy: "createdAt",
  sortOrder: "asc",
  page: 1,
  limit: 100,
};

/** Shared by the live preview and its pending skeleton to prevent a layout jump. */
export const DASHBOARD_PRODUCT_CARD_TRANSFORMS = [
  "z-10 translate-y-1 rotate-[-7deg] group-hover/product-stack:-translate-x-2 group-hover/product-stack:translate-y-0 group-focus-within/product-stack:-translate-x-2 group-focus-within/product-stack:translate-y-0 sm:group-hover/product-stack:-translate-x-3 sm:group-focus-within/product-stack:-translate-x-3",
  "z-20 rotate-[-1deg] group-hover/product-stack:-translate-y-1 group-focus-within/product-stack:-translate-y-1",
  "z-30 translate-y-1 rotate-[5deg] group-hover/product-stack:translate-x-2 group-hover/product-stack:translate-y-0 group-focus-within/product-stack:translate-x-2 group-focus-within/product-stack:translate-y-0 sm:group-hover/product-stack:translate-x-3 sm:group-focus-within/product-stack:translate-x-3",
] as const;
