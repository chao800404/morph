import { queryOptions } from "@tanstack/react-query";
import { getStorefrontPreviewCatalog } from "@/server/storefront/storefront-catalog.serverFn";

export const storefrontCatalogQueries = {
  preview: (
    storefrontId: string,
    themeId: string,
    page: number,
    handle?: string,
  ) =>
    queryOptions({
      queryKey: [
        "storefront-catalog",
        storefrontId,
        themeId,
        page,
        handle,
      ] as const,
      queryFn: async () => {
        const result = await getStorefrontPreviewCatalog({
          data: {
            storefrontId,
            themeId,
            page,
            handle: handle === "$slug" ? undefined : handle,
            sampleDetail: handle === "$slug",
          },
        });
        if (!result.success) throw new Error(result.message);
        return result.data;
      },
      staleTime: 0,
      retry: 1,
    }),
};
