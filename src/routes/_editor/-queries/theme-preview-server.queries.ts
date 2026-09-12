import { queryOptions } from "@tanstack/react-query";
import { startThemePreviewServer } from "@/server/storefront/storefront-theme-preview-server.serverFn";

/**
 * The dev server a Theme's Live Preview is served from.
 *
 * Asked for once per editor and Theme, and never retried on its own: starting
 * one runs a container, so a failing start that retried in the background
 * would keep doing that while the author works in a preview that is already
 * showing them something. It stays fresh indefinitely for the same reason —
 * the container is reattached by id, so asking again would only re-answer a
 * question whose answer has not changed.
 */
export const themePreviewServerQueries = {
  all: () => ["theme-preview-server"] as const,
  forTheme: (storefrontId: string, themeId: string, enabled: boolean) =>
    queryOptions({
      queryKey: [...themePreviewServerQueries.all(), storefrontId, themeId],
      queryFn: () =>
        startThemePreviewServer({ data: { storefrontId, themeId } }),
      // Off unless the deployment opted in. The editor must not run a
      // container for a preview it is not going to frame.
      enabled,
      retry: false,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};
