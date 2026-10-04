import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { EDITOR_PATH, openEditor, previewFrame } from "./helpers";
import { themeScopeFromEditorPath, writeThemeFiles } from "./native-compat";

test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

// This sidecar test verifies initial preparation and the build handoff, NOT
// deployment. It aborts the actual build request before the server sees it.
// The DAL acceptance separately checks the existing release/publication write.
for (const sourceOnly of [false, true]) {
  test(`Code-only initial publish prepares ${sourceOnly ? "a new route document" : "content revisions"} before its build`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await openEditor(page);
    const scope = {
      ...themeScopeFromEditorPath(EDITOR_PATH!),
      themeId: randomUUID(),
    };
    // The suite's shared Theme may already have content revisions. Insert only
    // our own new Theme row in the runner-owned database; the ordinary editor
    // read provisions its starter source and documents through the existing
    // upgrade path. Never reset revisions authored by preceding tests.
    const now = new Date().toISOString();
    await promisify(execFile)("npx", [
      "wrangler",
      "d1",
      "execute",
      "DATABASE",
      "--local",
      ...((process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") ===
      "local-sidecar"
        ? ["--env", "local_preview_e2e"]
        : []),
      "--persist-to",
      process.env.MORPH_E2E_STATE_DIR!,
      "--command",
      `INSERT INTO storefront_themes
      (id, storefront_id, name, metadata, created_at, updated_at)
      VALUES ('${scope.themeId}', '${scope.storefrontId}',
        'initial-publish-${scope.themeId}', '{"starterTemplateVersion":1}',
        '${now}', '${now}');`,
    ]);
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
    const routePath = "/code-first-publish";
    const editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home.id}${sourceOnly ? `&routePath=${routePath}` : ""}`;
    expect(home.draftRevisionId).toBeNull();
    expect(layout.draftRevisionId).toBeNull();
    const source = await page.evaluate(async (scope) => {
      const module =
        "/src/server/storefront/storefront-theme-files.serverFn.ts";
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
          ...(sourceOnly
            ? [
                {
                  path: "src/routes/code-first-publish.tsx",
                  content: `import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/code-first-publish')({ component: () => <main>Code first publish</main> });`,
                },
              ]
            : []),
        ])
      ).success,
    ).toBe(true);
    // Reload the saved source using the normal editor readiness check.
    if (sourceOnly) {
      // A source-only page has no Document sections/sortable rows. Waiting for
      // the starter's tree rows would time out before Publish is even exercised.
      await page.goto(editorPath, { waitUntil: "domcontentloaded" });
      await expect(
        previewFrame(page).getByText("Code first publish", { exact: true }),
      ).toBeVisible({ timeout: 45_000 });
    } else {
      await openEditor(page, editorPath);
    }
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
    for (const original of sourceOnly ? [layout] : [home, layout]) {
      const prepared = after.templates.find(
        (item: { id: string }) => item.id === original.id,
      );
      expect(prepared.draftRevisionId).toEqual(expect.any(String));
      expect(prepared.draftGeneration).toBe(original.draftGeneration + 1);
      expect(prepared.document).toEqual(original.document);
      expect(prepared.publishedRevisionId).toBeNull();
    }
    expect(after.storefront.activeReleaseId).toBeNull();
    if (sourceOnly) {
      expect(
        after.templates.find((item: { id: string }) => item.id === home.id)
          .draftRevisionId,
      ).toBeNull();
      const route = after.templates.find(
        (item: { routePath: string | null }) => item.routePath === routePath,
      );
      expect(
        route,
        "Publish creates the selected Code route's own document, not only the borrowed home template",
      ).toBeDefined();
      expect(route.draftRevisionId).toEqual(expect.any(String));
      expect(route.publishedRevisionId).toBeNull();
      expect(route.document).toEqual({ version: 1, sections: [] });
    }
    expect(pageErrors).toEqual([]);
  });
}
