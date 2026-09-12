import { queryOptions } from "@tanstack/react-query";
import { startThemePreviewServer } from "@/server/storefront/storefront-theme-preview-server.serverFn";

/**
 * The dev server a Theme's Live Preview is served from.
 *
 * Always asked, because the answer is the server's to give. It resolves the
 * preview host before touching a container, so a deployment that has not
 * configured one refuses immediately and costs nothing — and the editor is
 * not left holding a second switch that has to agree with the first. Two of
 * them is how this came to look enabled while showing the old preview.
 *
 * Asked once per editor and Theme, and never retried on its own: starting one
 * runs a container, so a failing start that retried in the background would
 * keep doing that while the author works in a preview already showing them
 * something. It stays fresh indefinitely for the same reason — the container
 * is reattached by id, so asking again would only re-answer a question whose
 * answer has not changed.
 */
export const themePreviewServerQueries = {
  all: () => ["theme-preview-server"] as const,
  forTheme: (storefrontId: string, themeId: string) =>
    queryOptions({
      queryKey: [...themePreviewServerQueries.all(), storefrontId, themeId],
      queryFn: () =>
        startThemePreviewServer({ data: { storefrontId, themeId } }),
      retry: false,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};
