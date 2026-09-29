import type { Page } from "@playwright/test";

import {
  NATIVE_COMPAT_COOKIE_HELPER_FILES,
  NATIVE_COMPAT_FILES,
  type NativeCompatFile,
} from "../src/lib/storefront/compat/native-compat-theme";

export { NATIVE_COMPAT_COOKIE_HELPER_FILES, NATIVE_COMPAT_FILES };

/**
 * Writing and removing the native compatibility Theme files, through the same
 * server function Code mode saves with — the write path under test, not a
 * seed that goes around it.
 *
 * The server function is imported by the page from the dev server, which is
 * how the editor itself reaches it: Start turns the module into client stubs
 * that call the server. Every call carries the signed-in session.
 */

const SERVER_FN_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";

export type ThemeScope = Readonly<{ storefrontId: string; themeId: string }>;

/** The storefront and theme `E2E_EDITOR_PATH` opens. */
export function themeScopeFromEditorPath(editorPath: string): ThemeScope {
  const match = /\/store\/([^/]+)\/themes\/([^/]+)\/editor/.exec(editorPath);
  if (!match)
    throw new Error(`E2E_EDITOR_PATH is not an editor path: ${editorPath}`);
  return { storefrontId: match[1]!, themeId: match[2]! };
}

type SaveResult = Readonly<{
  success: boolean;
  message?: string;
  errors?: unknown;
}>;

/** Writes the files, overwriting any left by an earlier run. */
export async function writeThemeFiles(
  page: Page,
  scope: ThemeScope,
  files: readonly NativeCompatFile[],
): Promise<SaveResult> {
  return page.evaluate(
    async ({ module, scope, files }) => {
      const fns = await import(/* @vite-ignore */ module);
      const listed = await fns.listStorefrontThemeFiles({ data: scope });
      if (!listed?.success) return listed;
      const existing = new Map<string, { id: string; version: number }>(
        listed.data.files.map(
          (file: { path: string; id: string; version: number }) => [
            file.path,
            { id: file.id, version: file.version },
          ],
        ),
      );
      return fns.saveStorefrontThemeFilesBatch({
        data: {
          ...scope,
          expectedSourceGeneration: listed.data.sourceGeneration,
          files: files.map((file) => {
            const current = existing.get(file.path);
            return current
              ? {
                  path: file.path,
                  content: file.content,
                  expectedFileId: current.id,
                  expectedVersion: current.version,
                }
              : { path: file.path, content: file.content, expectMissing: true };
          }),
        },
      });
    },
    { module: SERVER_FN_MODULE, scope, files: [...files] },
  );
}

/** Removes whichever of the paths exist, text or binary. */
export async function removeThemeFiles(
  page: Page,
  scope: ThemeScope,
  paths: readonly string[],
): Promise<SaveResult> {
  return page.evaluate(
    async ({ module, scope, paths }) => {
      const fns = await import(/* @vite-ignore */ module);
      const listed = await fns.listStorefrontThemeFiles({ data: scope });
      if (!listed?.success) return listed;
      const deletions = [...listed.data.files, ...listed.data.binaryFiles]
        .filter((file: { path: string }) => paths.includes(file.path))
        .map((file: { path: string; id: string; version: number }) => ({
          path: file.path,
          expectedFileId: file.id,
          expectedVersion: file.version,
        }));
      if (deletions.length === 0) return { success: true };
      return fns.saveStorefrontThemeFilesBatch({
        data: {
          ...scope,
          expectedSourceGeneration: listed.data.sourceGeneration,
          files: [],
          deletions,
        },
      });
    },
    { module: SERVER_FN_MODULE, scope, paths: [...paths] },
  );
}

/**
 * Uploads a new binary file through the entry the editor's upload uses. The
 * session rides on the page's context.
 */
export async function uploadThemeBinary(
  page: Page,
  scope: ThemeScope,
  path: string,
  bytes: Buffer,
) {
  const sourceGeneration = await page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      const listed = await fns.listStorefrontThemeFiles({ data: scope });
      return listed?.success ? listed.data.sourceGeneration : null;
    },
    { module: SERVER_FN_MODULE, scope },
  );
  if (sourceGeneration === null)
    throw new Error("Theme files could not be listed.");
  const query = new URLSearchParams({
    ...scope,
    path,
    expectedSourceGeneration: String(sourceGeneration),
    expectMissing: "1",
  });
  return page.request.post(`/api/storefront/theme-binary-file?${query}`, {
    headers: { "content-type": "application/octet-stream" },
    data: bytes,
  });
}
