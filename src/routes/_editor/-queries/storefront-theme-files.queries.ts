import {
  getStorefrontThemeFile,
  listStorefrontThemeFiles,
  listStorefrontThemeRevisions,
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
      // A schema/configuration failure should reach the editor promptly instead
      // of keeping the Live Preview spinner alive through the default backoff.
      // One short retry still covers a transient local D1 cold start.
      retry: 1,
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2_000),
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

  revisions: (storefrontId: string, themeId: string) =>
    queryOptions({
      queryKey: ["storefront-theme-files", storefrontId, themeId, "revisions"] as const,
      queryFn: async () => {
        const result = await listStorefrontThemeRevisions({
          data: { storefrontId, themeId },
        });
        if (!result.success) throw new Error(result.message);
        return result.data;
      },
    }),
};
