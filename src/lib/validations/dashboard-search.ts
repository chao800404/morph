import { z } from "zod";

/**
 * Shareable dashboard route state.
 *
 * Lives in `lib` rather than beside the routes because the collection registry
 * and the query layer both need it: a second copy would let them drift and
 * produce different query keys for the same view.
 */
export const dashboardSearchSchema = z.object({
  folderId: z.string().optional().nullable(),
  q: z.string().optional(),
  sortBy: z.enum(["name", "createdAt", "updatedAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
});

export type DashboardSearch = z.infer<typeof dashboardSearchSchema>;
