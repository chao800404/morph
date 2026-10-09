import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "../src/lib/storefront/starter-theme-v3-files";
import { EDITOR_PATH, isServerFunctionCall, openEditor, previewFrame } from "./helpers";
import { themeScopeFromEditorPath, writeThemeFiles, type ThemeScope } from "./native-compat";

/**
 * `src/morph/content.ts` is the author's file. These run the real editor,
 * transport and Live Preview against it:
 *
 * - deleted in Code mode, it comes back only through the explicit restore
 *   command, which creates the Starter module and touches nothing else;
 * - while it exists the command is disabled and the author's module stays;
 * - when Design cannot confirm the `content()` it writes, Add section and
 *   Bind say why and change neither the source nor its generation.
 *
 * Each test inserts its own Theme row in the runner's throwaway database, the
 * way initial-code-publish.spec.ts does, so deleting the module can never
 * leave the suite's shared Theme broken for the specs after it.
 */

test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const CONTENT_MODULE = "src/morph/content.ts";
const RESTORE_COMMAND = "Theme: Restore Starter Content Module";
const SERVER_FN_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";

type ListedFile = { path: string; id: string; version: number; content: string };
type Listing = { sourceGeneration: number; files: ListedFile[] };

/** A Theme of this test's own, provisioned by the ordinary editor read. */
async function createOwnTheme(page: Page): Promise<{ scope: ThemeScope; editorPath: string }> {
  const scope = {
    ...themeScopeFromEditorPath(EDITOR_PATH!),
    themeId: randomUUID(),
  };
  const now = new Date().toISOString();
  await promisify(execFile)("npx", [
    "wrangler",
    "d1",
    "execute",
    "DATABASE",
    "--local",
    ...((process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") === "local-sidecar"
      ? ["--env", "local_preview_e2e"]
      : []),
    "--persist-to",
    process.env.MORPH_E2E_STATE_DIR!,
    "--command",
    `INSERT INTO storefront_themes
      (id, storefront_id, name, metadata, created_at, updated_at)
      VALUES ('${scope.themeId}', '${scope.storefrontId}',
        'content-module-${scope.themeId}', '{"starterTemplateVersion":1}',
        '${now}', '${now}');`,
  ]);
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

function listFiles(page: Page, scope: ThemeScope): Promise<Listing> {
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

const byPath = (listing: Listing) =>
  new Map(listing.files.map((file) => [file.path, file]));

async function openCodeMode(page: Page) {
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByRole("tree", { name: "Theme files" })).toBeVisible();
}

function restoreCommand(page: Page) {
  return page.getByRole("option", { name: RESTORE_COMMAND });
}

async function openCommandPalette(page: Page) {
  await page.getByTitle("Command Palette (Ctrl+Shift+P)").click();
  await expect(restoreCommand(page)).toBeVisible();
}

/** The author's own module: `content` made by a factory Design cannot confirm. */
const FACTORY_MODULE = STARTER_THEME_CONTENT_MODULE_SOURCE.replace(
  "export function content(slotId: string): Record<string, unknown> {",
  "function readSlot(slotId: string): Record<string, unknown> {",
).concat(
  "\nconst makeReader = () => readSlot;\nexport const content = makeReader();\n",
);

test.describe("the author's content module", () => {
  test("deleted in Code mode, it is restored by the command, saved, and the Live Preview renders", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openEditor(page);
    const { scope, editorPath } = await createOwnTheme(page);
    await openEditor(page, editorPath);
    await openCodeMode(page);

    // Deleted the way an author would.
    const tree = page.getByRole("tree", { name: "Theme files" });
    const row = tree.getByText("content.ts", { exact: true });
    // A real right-click, with the row centred: near the bottom edge the
    // menu can open under the pointer, and releasing the button then picks an
    // item. That is tracked on its own; this covers the ordinary case.
    await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: /Delete File/i }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect
      .poll(async () => byPath(await listFiles(page, scope)).has(CONTENT_MODULE), {
        timeout: 20_000,
      })
      .toBe(false);
    const beforeRestore = await listFiles(page, scope);

    const saves: string[] = [];
    const previewSyncs: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (isServerFunctionCall(url, "saveStorefrontThemeFile")) saves.push(url);
      if (
        isServerFunctionCall(url, "startThemePreviewServer") ||
        isServerFunctionCall(url, "applyThemePreviewFiles")
      ) {
        previewSyncs.push(url);
      }
    });
    await openCommandPalette(page);
    await expect(restoreCommand(page)).not.toHaveAttribute("aria-disabled", "true");
    await restoreCommand(page).click();

    await expect(page.getByText(`Created ${CONTENT_MODULE}`)).toBeVisible({
      timeout: 20_000,
    });
    expect(saves).toHaveLength(1);
    const afterRestore = await listFiles(page, scope);
    const restored = byPath(afterRestore).get(CONTENT_MODULE);
    expect(restored?.content).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    expect(afterRestore.sourceGeneration).toBe(beforeRestore.sourceGeneration + 1);
    // Only the module was written: every other file is as it was.
    const others = (listing: Listing) =>
      listing.files
        .filter((file) => file.path !== CONTENT_MODULE)
        .map(({ path, version, content }) => ({ path, version, content }))
        .sort((a, b) => a.path.localeCompare(b.path));
    expect(others(afterRestore)).toEqual(others(beforeRestore));

    // The Live Preview is brought up again on the restored source, not left
    // showing the document it rendered before the deletion.
    await expect
      .poll(() => previewSyncs.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await expect(
      previewFrame(page).locator("[data-storefront-section-id]").first(),
    ).toBeAttached({ timeout: 60_000 });
    await expect(page.getByText(/Remote source changes detected/i)).toHaveCount(0);
  });

  test("while the module exists the command is disabled and the author's module stays", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    const { scope, editorPath } = await createOwnTheme(page);
    const authored = `${STARTER_THEME_CONTENT_MODULE_SOURCE}\n// the author's own change\n`;
    expect(
      await writeThemeFiles(page, scope, [{ path: CONTENT_MODULE, content: authored }]),
    ).toMatchObject({ success: true });
    const before = await listFiles(page, scope);

    await openEditor(page, editorPath);
    await openCodeMode(page);
    const saves: string[] = [];
    page.on("request", (request) => {
      if (isServerFunctionCall(request.url(), "saveStorefrontThemeFile")) {
        saves.push(request.url());
      }
    });
    await openCommandPalette(page);
    await expect(restoreCommand(page)).toHaveAttribute("aria-disabled", "true");
    await restoreCommand(page).click({ force: true });
    await page.waitForTimeout(1_000);

    expect(saves).toEqual([]);
    const after = await listFiles(page, scope);
    expect(byPath(after).get(CONTENT_MODULE)?.content).toBe(authored);
    expect(after.sourceGeneration).toBe(before.sourceGeneration);
  });

  test("when Design cannot confirm content(), Add section and Bind say why and change nothing", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    const { scope, editorPath } = await createOwnTheme(page);

    // A library section rendered straight into the home route, unbound, so
    // the panel offers to bind it.
    const initial = await listFiles(page, scope);
    const section = initial.files
      .map((file) => file.path)
      .find((path) => /^src\/components\/sections\/[A-Za-z]\w*\.tsx$/.test(path));
    expect(section, "the Starter has a library section").toBeTruthy();
    const home = byPath(initial).get("src/routes/index.tsx")!;
    const unboundRoute = `import E2eUnbound from "../components/sections/${section!.slice("src/components/sections/".length, -".tsx".length)}";\n${home.content.replace(
      /\n(\s*)<\/main>/,
      "\n$1  <E2eUnbound />\n$1</main>",
    )}`;
    expect(unboundRoute).toContain("<E2eUnbound />");
    expect(
      await writeThemeFiles(page, scope, [
        { path: CONTENT_MODULE, content: FACTORY_MODULE },
        { path: "src/routes/index.tsx", content: unboundRoute },
      ]),
    ).toMatchObject({ success: true });
    const before = await listFiles(page, scope);

    await openEditor(page, editorPath);
    const unconfirmed =
      "Design cannot confirm that src/morph/content.ts exports content as a function";

    const addSection = page.getByRole("button", { name: "Add section", exact: true });
    await expect(addSection).toBeEnabled({ timeout: 20_000 });
    await addSection.click();
    await page.getByRole("menuitem").first().click();
    await expect(
      page.getByText(`Cannot add a section: ${unconfirmed}`),
    ).toBeVisible({ timeout: 20_000 });

    const bind = page.getByRole("button", { name: "Bind E2eUnbound", exact: true });
    await bind.click({ force: true });
    await expect(
      page.getByText(`Cannot bind this section: ${unconfirmed}`),
    ).toBeVisible({ timeout: 20_000 });

    const after = await listFiles(page, scope);
    expect(after.sourceGeneration).toBe(before.sourceGeneration);
    expect(byPath(after).get("src/routes/index.tsx")?.content).toBe(unboundRoute);
    expect(after.files.map((file) => file.path).sort()).toEqual(
      before.files.map((file) => file.path).sort(),
    );
  });
});
