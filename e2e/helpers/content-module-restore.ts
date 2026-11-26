import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { EDITOR_PATH } from "../helpers";
import { themeScopeFromEditorPath, type ThemeScope } from "../native-compat";
import { insertThrowawayTheme, specPreviewRuntime } from "./throwaway-theme";

/**
 * What the content module specs share: content-module-restore.spec.ts (both
 * lanes), content-module-restore-start.spec.ts (the full Start job's
 * successful restore) and content-module-restore-client.spec.ts (the client
 * lane's refusal). Each test makes a Theme of its own.
 */

export const CONTENT_MODULE = "src/morph/content.ts";
export const RESTORE_COMMAND = "Theme: Restore Starter Content Module";
export const SERVER_FN_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";

export type ListedFile = { path: string; id: string; version: number; content: string };
export type Listing = { sourceGeneration: number; files: ListedFile[] };

/** A Theme of this test's own, provisioned by the ordinary editor read. */
export async function createOwnTheme(page: Page): Promise<{ scope: ThemeScope; editorPath: string }> {
  const scope = {
    ...themeScopeFromEditorPath(EDITOR_PATH!),
    themeId: randomUUID(),
  };
  insertThrowawayTheme({
    themeId: scope.themeId,
    storefrontId: scope.storefrontId,
    name: `content-module-${scope.themeId}`,
    // Start in the full Start job: from Starter 32 the editor provisions the
    // Starter only into a Theme that records it. Seeded on Starter 31 on the
    // client lane.
    previewRuntime: specPreviewRuntime(),
  });
  const context = await page.evaluate(async (scope) => {
    const module = "/src/server/storefront/storefront-themes.serverFn.ts";
    const fns = await import(/* @vite-ignore */ module);
    const result = await fns.getStorefrontThemeEditor({ data: scope });
    if (!result.success) throw new Error(result.message);
    return result.data;
  }, scope);
  const home = context.templates.find(
    (item: { type: string }) => item.type === "index",
  );
  return {
    scope,
    editorPath: `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home.id}`,
  };
}

export function listFiles(page: Page, scope: ThemeScope): Promise<Listing> {
  return page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      const listed = await fns.listStorefrontThemeFiles({ data: scope });
      if (!listed?.success) throw new Error(listed?.message ?? "list failed");
      return {
        sourceGeneration: listed.data.sourceGeneration,
        files: listed.data.files.map(
          (file: ListedFile) => ({
            path: file.path,
            id: file.id,
            version: file.version,
            content: file.content,
          }),
        ),
      };
    },
    { module: SERVER_FN_MODULE, scope },
  );
}

export const byPath = (listing: Listing) =>
  new Map(listing.files.map((file) => [file.path, file]));

export async function openCodeMode(page: Page) {
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByRole("tree", { name: "Theme files" })).toBeVisible();
}

export function restoreCommand(page: Page) {
  return page.getByRole("option", { name: RESTORE_COMMAND });
}

export async function openCommandPalette(page: Page) {
  await page.getByTitle("Command Palette (Ctrl+Shift+P)").click();
  await expect(restoreCommand(page)).toBeVisible();
}
