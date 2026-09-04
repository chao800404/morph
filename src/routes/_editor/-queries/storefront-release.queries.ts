import { listStorefrontReleaseHistory } from "@/server/storefront/storefront-releases.serverFn";
import { queryOptions } from "@tanstack/react-query";

/** Releases fetched per request; the server caps this at 100. */
export const RELEASE_HISTORY_PAGE_SIZE = 25;

export const storefrontReleaseQueries = {
  all: () => ["storefront-releases"] as const,

  /**
   * One page of release history, newest first.
   *
   * Paged rather than fetched whole because releases only ever accumulate: a
   * storefront published daily for a year has hundreds, and a fixed first page
   * would leave every older one unreachable from this panel — which is exactly
   * where someone goes when they need to roll back to one.
   *
   * Addressed by page rather than by cursor so the shared pager can drive it:
   * that control moves to a page number, and it is the same one every other
   * resource list in the dashboard uses.
   */
  history: (
    storefrontId: string,
    page = 1,
    pageSize = RELEASE_HISTORY_PAGE_SIZE,
  ) =>
    queryOptions({
      queryKey: [
        ...storefrontReleaseQueries.all(),
        "history",
        storefrontId,
        page,
        pageSize,
      ] as const,
      queryFn: async () => {
        const result = await listStorefrontReleaseHistory({
          data: { storefrontId, limit: pageSize, page },
        });
        if (!result.success) throw new Error(result.message);
        return result.data;
      },
    }),
};
