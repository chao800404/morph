import {
  getStorefrontThemeFile,
  listStorefrontThemeFiles,
} from "@/server/storefront/storefront-theme-files.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const storefrontThemeFileQueries = {
  all: () => ["storefront-theme-files"] as const,

  tree: (storefrontId: string, themeId: string) =>
    queryOptions({
      queryKey: ["storefront-theme-files", storefrontId, themeId, "tree"] as const,
      queryFn: async () => {
        const result = await listStorefrontThemeFiles({
          data: { storefrontId, themeId },
        });
        if (!result.success) throw new Error(result.message);
        return result.data;
      },
    }),

  file: (storefrontId: string, themeId: string, path: string) =>
    queryOptions({
      queryKey: ["storefront-theme-files", storefrontId, themeId, "file", path] as const,
      queryFn: async () => {
        const result = await getStorefrontThemeFile({
          data: { storefrontId, themeId, path },
        });
        if (!result.success) throw new Error(result.message);
        return result.data;
      },
    }),
};
