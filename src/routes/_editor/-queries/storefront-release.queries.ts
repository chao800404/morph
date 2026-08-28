import { listStorefrontReleaseHistory } from "@/server/storefront/storefront-releases.serverFn";
import { infiniteQueryOptions } from "@tanstack/react-query";

/** Releases fetched per request; the server caps this at 100. */
export const RELEASE_HISTORY_PAGE_SIZE = 25;

export const storefrontReleaseQueries = {
  all: () => ["storefront-releases"] as const,

  /**
   * Release history, newest first, one page at a time.
   *
   * Paged rather than fetched whole because releases only ever accumulate: a
   * storefront published daily for a year has hundreds, and a fixed first page
   * would leave every older one unreachable from this panel — which is exactly
   * where someone goes when they need to roll back to one.
   */
  history: (storefrontId: string, pageSize = RELEASE_HISTORY_PAGE_SIZE) =>
    infiniteQueryOptions({
      queryKey: [
        ...storefrontReleaseQueries.all(),
        "history",
        storefrontId,
        pageSize,
      ] as const,
      initialPageParam: 0,
      queryFn: async ({ pageParam }) => {
        const result = await listStorefrontReleaseHistory({
          data: { storefrontId, limit: pageSize, offset: pageParam },
        });
        if (!result.success) throw new Error(result.message);
        return result.data;
      },
      // A short page is the end of the list: the server returned everything it
      // had left. Asking again would only repeat work to learn the same thing.
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length < pageSize
          ? undefined
          : allPages.reduce((total, page) => total + page.length, 0),
    }),
};
