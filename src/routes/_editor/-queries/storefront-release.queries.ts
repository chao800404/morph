import { listStorefrontReleaseHistory } from "@/server/storefront/storefront-releases.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const storefrontReleaseQueries = {
  all: () => ["storefront-releases"] as const,

  history: (storefrontId: string, limit = 25) =>
    queryOptions({
      queryKey: [
        ...storefrontReleaseQueries.all(),
        "history",
        storefrontId,
        limit,
      ] as const,
      queryFn: async () => {
        const result = await listStorefrontReleaseHistory({
          data: { storefrontId, limit },
        });
        if (!result.success) throw new Error(result.message);
        return result.data;
      },
    }),
};
