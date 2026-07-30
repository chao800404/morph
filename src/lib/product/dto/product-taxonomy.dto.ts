import type { ProductMetadata } from "@/db/product.schema";

/**
 * The things a product is filed under: its type, its tags and its categories.
 *
 * Grouped in one module because the Organize step reads all three together and
 * none of them is big enough to earn its own DAL.
 */

export interface ProductTypeDTO {
  id: string;
  value: string;
  metadata: ProductMetadata | null;
}

export interface ProductTagDTO {
  id: string;
  value: string;
  metadata: ProductMetadata | null;
}

export interface ProductCategoryDTO {
  id: string;
  name: string;
  description: string;
  handle: string;
  /**
   * Materialised path of ancestor ids ending in this row's own id, e.g.
   * `/root-id/child-id`. Same shape as `asset_folders.idPath`, so subtree reads
   * are a half-open range scan rather than a `LIKE` — see the D1 pattern limit
   * in rules.md.
   */
  mpath: string;
  parentCategoryId: string | null;
  isActive: boolean;
  isInternal: boolean;
  rank: number;
  /** Free-form store-defined data; never trusted to hold anything private. */
  metadata: ProductMetadata;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A category as the list page shows it.
 *
 * `ancestorNames` is resolved per page rather than stored: names change, so a
 * denormalised path would go stale. It exists because the list is sorted
 * alphabetically and flat — the path is what tells a reader that this "Shirts"
 * is the one under "Clothing".
 */
export interface ProductCategoryListItemDTO extends ProductCategoryDTO {
  ancestorNames: string[];
}

/**
 * A category plus the structural context its detail page shows.
 *
 * Ancestors and direct children are part of what the record *is*, so they come
 * with it. The category's products do not: that list grows without bound and
 * is fetched separately, page by page.
 */
export interface ProductCategoryDetailDTO extends ProductCategoryListItemDTO {
  children: { id: string; name: string }[];
}

export interface CreateProductCategoryDTO {
  name: string;
  handle: string;
  description?: string;
  parentCategoryId?: string | null;
  isActive?: boolean;
  isInternal?: boolean;
}

export interface UpdateProductCategoryDTO {
  name?: string;
  handle?: string;
  description?: string;
  isActive?: boolean;
  isInternal?: boolean;
  metadata?: ProductMetadata;
}
