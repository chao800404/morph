import { z } from "zod";
import { PRODUCT_OPTION_CREATED_WITHIN_VALUES } from "@/lib/product/config/product-option-list";

export const dashboardSortKeySchema = z.enum([
  "name",
  "code",
  "extension",
  "size",
  "createdAt",
  "updatedAt",
]);
export const dashboardSortOrderSchema = z.enum(["asc", "desc"]);

export type DashboardSortKey = z.infer<typeof dashboardSortKeySchema>;
export type DashboardSortOrder = z.infer<typeof dashboardSortOrderSchema>;

/**
 * Shareable dashboard route state.
 *
 * Lives in `lib` rather than beside the routes because the collection registry
 * and the query layer both need it: a second copy would let them drift and
 * produce different query keys for the same view.
 */
export const dashboardSearchSchema = z.object({
  folderId: z.string().optional().nullable(),
  /**
   * Which form a create route shows when a collection offers more than one,
   * e.g. Assets creating a folder or uploading files. Keeping it in the URL is
   * what makes both variants linkable.
   */
  variant: z.string().optional(),
  /**
   * Assets mixes files and folders under one collection route. The id alone
   * cannot identify which table owns the record, so permanent detail/edit URLs
   * carry the resource kind as validated route state.
   */
  itemType: z.enum(["asset", "folder"]).optional(),
  /**
   * Ordered asset/folder selection for the route-backed Assets editor.
   * It is serialized JSON so a multi-item edit survives refresh and can be
   * shared without depending on the explorer's in-memory selection store.
   */
  editItems: z.string().max(10_000).optional(),
  /** Currently displayed asset on a collection preview route. */
  assetId: z.string().optional(),
  /** Assets-only media category filter. */
  assetType: z.enum(["image", "video", "rive", "model"]).optional(),
  /** Product Options creation-date window. */
  optionCreatedWithin: z.enum(PRODUCT_OPTION_CREATED_WITHIN_VALUES).optional(),
  /**
   * Seeds the product create wizard with an option already chosen, so an
   * author can start a product from the option's own page. Only a starting
   * point — the wizard's picker can still change it.
   */
  /**
   * Which variant the product's variant editor is opening.
   *
   * A `pages` key names the surface; this names the record inside it. The
   * variant has no page of its own because it is only reachable from its
   * product.
   */
  variantId: z.string().optional(),
  seedOptionId: z.string().optional(),
  /** Seeds the product create wizard with a category already assigned. */
  seedCategoryId: z.string().optional(),
  /** Seeds the product create wizard with a collection already chosen. */
  seedCollectionId: z.string().optional(),
  /**
   * Where a create or edit surface returns to when it closes.
   *
   * Without it a surface closes to its parent route, which is right when it was
   * opened from there and wrong when it was opened from somewhere else — the
   * product wizard reached from an option's page would land on the product
   * list. Kept in the URL rather than read from history so it survives a
   * refresh and a pasted link, which is the whole reason these are routes.
   */
  returnTo: z.string().optional(),
  q: z.string().optional(),
  /**
   * A scalar keeps old/shareable single-sort URLs valid. Assets promotes these
   * fields to ordered arrays once a second table heading is selected.
   */
  sortBy: z
    .union([
      dashboardSortKeySchema,
      z.array(dashboardSortKeySchema).min(1).max(5),
    ])
    .optional(),
  sortOrder: z
    .union([
      dashboardSortOrderSchema,
      z.array(dashboardSortOrderSchema).min(1).max(5),
    ])
    .optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
});

export type DashboardSearch = z.infer<typeof dashboardSearchSchema>;

/**
 * Narrow an unvalidated `?returnTo` to a dashboard path.
 *
 * Only in-app dashboard paths are accepted. The value comes from the URL, so
 * anything else — an absolute URL, a protocol-relative `//host`, an API route —
 * is discarded rather than navigated to.
 */
export const toDashboardReturnTo = (
  value: string | undefined,
): string | undefined => {
  if (!value) return undefined;
  if (!value.startsWith("/dashboard")) return undefined;
  if (value.startsWith("//")) return undefined;
  return value;
};
