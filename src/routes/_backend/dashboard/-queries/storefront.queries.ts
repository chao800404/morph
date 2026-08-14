import { getStorefront } from "@/server/storefront/storefronts.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const storefrontQueries = {
  all: () => ["storefront"] as const,
  detail: (id?: string) =>
    queryOptions({
      queryKey: [...storefrontQueries.all(), "detail", id ?? "active"],
      queryFn: () => getStorefront({ data: id ? { id } : {} }),
    }),
};
