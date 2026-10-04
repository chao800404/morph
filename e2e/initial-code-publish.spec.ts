import { expect, test } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";
import { themeScopeFromEditorPath, writeThemeFiles } from "./native-compat";

test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

// This sidecar test verifies initial preparation and the build handoff, NOT
// deployment. It aborts the actual build request before the server sees it.
// The DAL acceptance separately checks the existing release/publication write.
test("Code-only initial publish prepares content revisions before its build", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openEditor(page);
  const scope = themeScopeFromEditorPath(EDITOR_PATH!);
  const readContext = () =>
    page.evaluate(async (scope) => {
      const module = "/src/server/storefront/storefront-themes.serverFn.ts";
      const fns = await import(/* @vite-ignore */ module);
      const result = await fns.getStorefrontThemeEditor({ data: scope });
      if (!result.success) throw new Error(result.message);
      return result.data;
    }, scope);
  const initial = await readContext();
  const home = initial.templates.find(
    (item: { type: string }) => item.type === "index",
  );
  const layout = initial.templates.find(
    (item: { type: string }) => item.type === "layout",
  );
  expect(home.draftRevisionId).toBeNull();
  expect(layout.draftRevisionId).toBeNull();
  const source = await page.evaluate(async (scope) => {
    const module = "/src/server/storefront/storefront-theme-files.serverFn.ts";
    const fns = await import(/* @vite-ignore */ module);
    const result = await fns.listStorefrontThemeFiles({ data: scope });
    if (!result.success) throw new Error(result.message);
    return result.data.files.find(
      (file: { path: string }) => file.path === "src/routes/index.tsx",
    ).content;
  }, scope);
  expect(
    (
      await writeThemeFiles(page, scope, [
        {
          path: "src/routes/index.tsx",
          content: source + "\n// code-only-first-publish\n",
        },
      ])
    ).success,
  ).toBe(true);
  // Reload the saved source using the normal editor readiness check.
  await openEditor(page);
  const urls = await page.evaluate(async () => {
    const buildModule =
      "/src/server/storefront/storefront-theme-builds.serverFn.ts";
    const publishModule =
      "/src/server/storefront/storefront-themes.serverFn.ts";
    const build = await import(/* @vite-ignore */ buildModule);
    const publish = await import(/* @vite-ignore */ publishModule);
    return {
      build: build.createPreviewBuild.url,
      publish: publish.publishStorefrontThemeTemplate.url,
    };
  });
  let buildRequests = 0;
  let publishRequests = 0;
  await page.route(
    "**" + new URL(urls.build, page.url()).pathname + "*",
    async (route) => {
      buildRequests++;
      await route.abort("failed");
    },
  );
  await page.route(
    "**" + new URL(urls.publish, page.url()).pathname + "*",
    async (route) => {
      publishRequests++;
      await route.abort("failed");
    },
  );
  await page.getByRole("button", { name: /^Publish$/ }).click();
  await page.locator("[data-publish-confirm]").click();
  await expect.poll(() => buildRequests, { timeout: 30_000 }).toBe(1);
  expect(publishRequests).toBe(0);
  const after = await readContext();
  for (const original of [home, layout]) {
    const prepared = after.templates.find(
      (item: { id: string }) => item.id === original.id,
    );
    expect(prepared.draftRevisionId).toEqual(expect.any(String));
    expect(prepared.draftGeneration).toBe(original.draftGeneration + 1);
    expect(prepared.document).toEqual(original.document);
    expect(prepared.publishedRevisionId).toBeNull();
  }
  expect(after.storefront.activeReleaseId).toBeNull();
  expect(pageErrors).toEqual([]);
});
