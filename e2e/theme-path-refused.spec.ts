import { expect, test } from "@playwright/test";

import { EDITOR_PATH, isServerFunctionCall } from "./helpers";

/**
 * The platform's build files (`__entry.tsx`, the Start preview's Worker and
 * client modules) are refused by the server, not only by the editor's dialogs.
 * Unit tests call the handlers with the transport and the auth middleware
 * stood in for; this goes through the real thing — a signed-in browser, the
 * app's own client, Start's serialization — and checks the editor receives
 * the typed failure, and that nothing was written.
 *
 * Writes nothing when it passes. Runs against the seeded store only.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

test("a signed-in save onto a platform file reaches the browser as THEME_PATH_REFUSED", async ({
  page,
}) => {
  const match = /\/store\/([^/]+)\/themes\/([^/]+)/.exec(EDITOR_PATH!);
  expect(match, `no storefront or theme in ${EDITOR_PATH}`).not.toBeNull();
  const [, storefrontId, themeId] = match!;

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  // Signed in: a signed-out browser is sent to the sign-in page instead.
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  // The client's serializer is configured once the app has hydrated.
  await page.waitForFunction(() => Boolean(window.__TSR_ROUTER__));

  const sent = page.waitForRequest((request) =>
    isServerFunctionCall(request.url(), "saveStorefrontThemeFile"),
  );
  const outcome = await page.evaluate(
    async ({ storefrontId, themeId }) => {
      // A path, not a specifier: resolved by the dev server in the page.
      const load = (path: string) => import(/* @vite-ignore */ path);
      const {
        listStorefrontThemeFiles,
        saveStorefrontThemeFile,
        saveStorefrontThemeFilesBatch,
      } = await load(
        "/src/server/storefront/storefront-theme-files.serverFn.ts",
      );
      const listed = await listStorefrontThemeFiles({
        data: { storefrontId, themeId },
      });
      const generation: number = listed.data.sourceGeneration;
      const single = await saveStorefrontThemeFile({
        data: {
          storefrontId,
          themeId,
          path: "__entry.tsx",
          content: 'throw new Error("not the platform entry");',
          expectMissing: true,
          expectedSourceGeneration: generation,
        },
      });
      // One valid write beside the refused one: none of it may land.
      const batch = await saveStorefrontThemeFilesBatch({
        data: {
          storefrontId,
          themeId,
          files: [
            {
              path: "src/e2e-refused-path-probe.ts",
              content: "export {};",
              expectMissing: true,
            },
            {
              path: "__morph_preview_worker.ts",
              content: "export default {};",
              expectMissing: true,
            },
          ],
          expectedSourceGeneration: generation,
        },
      });
      const after = await listStorefrontThemeFiles({
        data: { storefrontId, themeId },
      });
      const paths = (files: { path: string }[]) => files.map((f) => f.path);
      return {
        single: { success: single.success, error: single.error },
        batch: { success: batch.success, error: batch.error },
        generationBefore: generation,
        generationAfter: after.data.sourceGeneration as number,
        written: paths(after.data.files).filter((path: string) =>
          [
            "__entry.tsx",
            "__morph_preview_worker.ts",
            "src/e2e-refused-path-probe.ts",
          ].includes(path),
        ),
      };
    },
    { storefrontId, themeId },
  );

  expect(outcome.single).toEqual({
    success: false,
    error: "THEME_PATH_REFUSED",
  });
  expect(outcome.batch).toEqual({
    success: false,
    error: "THEME_PATH_REFUSED",
  });
  expect(outcome.written).toEqual([]);
  expect(outcome.generationAfter).toBe(outcome.generationBefore);

  // Over the wire as a result, not an opaque 500.
  const response = await (await sent).response();
  expect(response!.status()).toBe(200);
  expect(await response!.text()).toContain("THEME_PATH_REFUSED");
});
