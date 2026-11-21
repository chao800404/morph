import type { Page } from "@playwright/test";

const PREVIEW_SERVER_FUNCTIONS =
  "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";

/**
 * Stops the signed-in author's Live Preview dev server for a Theme, through
 * the product's own `stopThemePreviewServer`, so the next start lays the
 * workspace out again and serves from a new instance.
 *
 * A start whose plan differs from the running server's only in preview
 * content reuses that server (the same instance keeps serving), so a start
 * alone no longer replaces it. A spec about what happens when the server is
 * replaced stops it first, immediately before the start that is to replace
 * it: the same stop a start used to run itself before laying out a new one.
 *
 * `page` must have the app loaded (any page of it). Throws when the answer is
 * not a success, so a spec never mistakes a failed stop for a replacement.
 */
export async function stopPreviewServer(
  page: Page,
  scope: { storefrontId: string; themeId: string },
): Promise<void> {
  const answer = (await page.evaluate(
    async ({ module, data }) => {
      const fns = await import(/* @vite-ignore */ module);
      return fns.stopThemePreviewServer({ data });
    },
    { module: PREVIEW_SERVER_FUNCTIONS, data: scope },
  )) as { success?: unknown } | null;
  if (answer?.success !== true) {
    throw new Error(`PREVIEW_STOP_FAILED: ${JSON.stringify(answer)}`);
  }
}
