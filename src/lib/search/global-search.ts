export const GLOBAL_SEARCH_MIN_QUERY_LENGTH = 2;
export const GLOBAL_SEARCH_MAX_QUERY_LENGTH = 100;
export const GLOBAL_SEARCH_DEFAULT_LIMIT = 3;
export const GLOBAL_SEARCH_LIMIT_INCREMENT = 20;

export const GLOBAL_SEARCH_AREAS = [
  "all",
  "products",
  "productVariants",
  "assets",
  "orders",
  "promotions",
  "collections",
  "categories",
  "options",
  "navigation",
] as const;

export type GlobalSearchArea = (typeof GLOBAL_SEARCH_AREAS)[number];

const GLOBAL_SEARCH_AREA_LABELS: Record<GlobalSearchArea, string> = {
  all: "All areas",
  products: "Products",
  productVariants: "Product variants",
  assets: "Assets",
  orders: "Orders",
  promotions: "Promotions",
  collections: "Collections",
  categories: "Categories",
  options: "Options",
  navigation: "Navigation",
};

export const GLOBAL_SEARCH_AREA_OPTIONS = GLOBAL_SEARCH_AREAS.map((value) => ({
  value,
  label: GLOBAL_SEARCH_AREA_LABELS[value],
}));

export const toGlobalSearchTerms = (query: string): string[] =>
  query.trim().split(/\s+/).filter(Boolean);

export type GlobalSearchResource =
  | "product"
  | "product-variant"
  | "asset"
  | "asset-folder"
  | "order"
  | "promotion"
  | "collection"
  | "category"
  | "option";

export interface GlobalSearchResult {
  id: string;
  resource: GlobalSearchResource;
  group: string;
  title: string;
  subtitle?: string;
  href: string;
}

export interface GlobalSearchResultGroup {
  area: Exclude<GlobalSearchArea, "all" | "navigation">;
  title: string;
  count: number;
  hasMore: boolean;
  items: GlobalSearchResult[];
}
