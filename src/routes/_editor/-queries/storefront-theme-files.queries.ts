import {
  getStorefrontThemeFile,
  listStorefrontThemeFiles,
  listStorefrontThemeRevisions,
  previewStorefrontThemeRollback,
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

  revisions: (
    storefrontId: string,
    themeId: string,
    page = 1,
    limit = 50,
  ) =>
    queryOptions({
      // Page is part of the key so each page caches separately rather than
      // overwriting the previous one.
      queryKey: [
        "storefront-theme-files",
        storefrontId,
        themeId,
        "revisions",
        page,
        limit,
      ] as const,
      queryFn: async () => {
        const result = await listStorefrontThemeRevisions({
          data: {
            storefrontId,
            themeId,
            limit,
            offset: (page - 1) * limit,
          },
        });
        if (!result.success) throw new Error(result.message);
        return result.data;
      },
    }),

  /**
   * What rolling back to one revision would change.
   *
   * Keyed by revision so switching between two in the list does not refetch
   * the one already looked at, and never cached across a workspace edit: the
   * plan describes the workspace as it is right now.
   */
  rollbackPreview: (
    storefrontId: string,
    themeId: string,
    revisionNumber: number,
  ) =>
    queryOptions({
      queryKey: [
        "storefront-theme-files",
        storefrontId,
        themeId,
        "rollback-preview",
        revisionNumber,
      ] as const,
      staleTime: 0,
      gcTime: 0,
      queryFn: async () => {
        const result = await previewStorefrontThemeRollback({
          data: { storefrontId, themeId, revisionNumber },
        });
        if (!result.success) throw new Error(result.message);
        return result.data;
      },
    }),
};
