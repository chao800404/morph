import {
  getStorefrontThemeEditor,
  readThemeRouteBindings,
} from "@/server/storefront/storefront-themes.serverFn";
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
  /**
   * One Astro page's binding view (M2 C3). Beside `detail`, never under it:
   * the many invalidations of the editor read must not re-run the parser.
   * The source generation is part of the key, so a source change is a new
   * key and an answer is never reused across generations; within one it
   * does not go stale. The editor re-confirms after a preview reload by
   * refetching this key explicitly.
   */
  routeBindings: (
    storefrontId: string,
    themeId: string,
    routePath: string,
    sourceGeneration: number,
  ) =>
    queryOptions({
      queryKey: [
        ...storefrontThemeQueries.all(),
        "route-bindings",
        storefrontId,
        themeId,
        routePath,
        sourceGeneration,
      ],
      queryFn: () =>
        readThemeRouteBindings({
          data: {
            storefrontId,
            themeId,
            routePath,
            expectedSourceGeneration: sourceGeneration,
          },
        }),
      staleTime: Infinity,
    }),
};
