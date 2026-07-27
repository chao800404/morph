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
