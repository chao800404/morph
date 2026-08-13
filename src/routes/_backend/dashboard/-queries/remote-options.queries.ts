import { listFolderOptions } from "@/server/asset/list-items.serverFn";
import { listPromotionCampaigns } from "@/server/marketing/promotions.serverFn";
import { listProductTaxonomyOptions } from "@/server/product/taxonomy.serverFn";
import type { RemoteOptionSource } from "@/lib/remote-options/source";
import { infiniteQueryOptions } from "@tanstack/react-query";

export interface RemoteOptionParams {
  source: RemoteOptionSource;
  query?: string;
  selectedIds?: string[];
  limit?: number;
}

interface RemoteOptionResult {
  success: boolean;
  message: string;
  data: {
    items: { id: string; label: string }[];
    selectedItems: { id: string; label: string }[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  } | null;
  error?: string;
}

export const remoteOptionQueries = {
  all: () => ["remote-options"] as const,
  pages: (params: RemoteOptionParams) =>
    infiniteQueryOptions({
      queryKey: [...remoteOptionQueries.all(), params],
      initialPageParam: 1,
      queryFn: async ({ pageParam }): Promise<RemoteOptionResult> => {
        const data = {
          query: params.query,
          selectedIds: params.selectedIds,
          page: pageParam,
          limit: params.limit ?? 20,
        };
        if (params.source === "asset-folders") {
          return await listFolderOptions({ data });
        }
        if (params.source === "promotion-campaigns") {
          return await listPromotionCampaigns({ data });
        }
        const kind =
          params.source === "product-types"
            ? "type"
            : params.source === "product-tags"
              ? "tag"
              : "category";
        return await listProductTaxonomyOptions({ data: { ...data, kind } });
      },
      getNextPageParam: (lastPage) => {
        if (!lastPage.success || !lastPage.data) return undefined;
        const { page, totalPages } = lastPage.data.pagination;
        return page < totalPages ? page + 1 : undefined;
      },
    }),
};
