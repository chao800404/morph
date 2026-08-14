import { getStorefrontThemeEditor } from "@/server/storefront/storefront-themes.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const storefrontThemeQueries = {
  all: () => ["storefront-theme-editor"] as const,
  detail: (storefrontId: string, themeId: string) =>
    queryOptions({
      queryKey: [
        ...storefrontThemeQueries.all(),
        "detail",
        storefrontId,
        themeId,
      ],
      queryFn: () =>
        getStorefrontThemeEditor({ data: { storefrontId, themeId } }),
    }),
};
