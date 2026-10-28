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
 *   Bind say why and change neither the source nor its generation;
 * - a section that already spreads props of its own is not bound, since the
 *   spread could override the fields the binding adds, and nothing is
 *   written; a plain section beside it still binds.
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

/** Every write a bind could reach, directly or through a save. */
const WRITE_FUNCTIONS = [
  "saveStorefrontThemeFile",
  "saveStorefrontThemeFilesBatch",
  "updateStorefrontThemeSectionProps",
  "reorderStorefrontThemeSections",
  "renameStorefrontThemeSection",
  "createStorefrontThemeRevision",
];

/** What a refused bind must leave exactly as it was. */
async function storedState(page: Page, scope: ThemeScope) {
  const listing = await listFiles(page, scope);
  const stored = await page.evaluate(async ({ scope, filesModule }) => {
    const themesModule = "/src/server/storefront/storefront-themes.serverFn.ts";
    const themes = await import(/* @vite-ignore */ themesModule);
    const files = await import(/* @vite-ignore */ filesModule);
    const editor = await themes.getStorefrontThemeEditor({ data: scope });
    if (!editor.success) throw new Error(editor.message);
    const revisions = await files.listStorefrontThemeRevisions({
      data: { ...scope, limit: 50, offset: 0 },
    });
    if (!revisions.success) throw new Error(revisions.message);
    return {
      templates: editor.data.templates.map(
        (template: Record<string, unknown>) => ({
          id: template.id,
          draftGeneration: template.draftGeneration,
          version: template.version,
          document: template.document,
        }),
      ),
      revisions: revisions.data,
    };
  }, { scope, filesModule: SERVER_FN_MODULE });
  return {
    sourceGeneration: listing.sourceGeneration,
    files: listing.files,
    ...stored,
  };
}

test.describe("binding a section that spreads props of its own", () => {
  test("is refused with the reason and writes nothing, while a plain section next to it still binds", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    const { scope, editorPath } = await createOwnTheme(page);

    const initial = await listFiles(page, scope);
    const section = initial.files
      .map((file) => file.path)
      .find((path) => /^src\/components\/sections\/[A-Za-z]\w*\.tsx$/.test(path));
    expect(section, "the Starter has a library section").toBeTruthy();
    const from = `../components/sections/${section!.slice("src/components/sections/".length, -".tsx".length)}`;
    const home = byPath(initial).get("src/routes/index.tsx")!;
    // Two unbound uses of one library section: one spreads an object of its
    // own, which a binding written before it could be overridden by; the
    // other has no props at all and is the control.
    const route = `import E2eSpread from "${from}";\nimport E2ePlain from "${from}";\n${home.content.replace(
      /\n(\s*)<\/main>/,
      '\n$1  <E2eSpread {...{ title: "From code" }} />\n$1  <E2ePlain />\n$1</main>',
    )}`;
    expect(route).toContain("<E2eSpread {...");
    expect(route).toContain("<E2ePlain />");
    expect(
      await writeThemeFiles(page, scope, [
        { path: "src/routes/index.tsx", content: route },
      ]),
    ).toMatchObject({ success: true });
    const before = await storedState(page, scope);

    const writes: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (WRITE_FUNCTIONS.some((name) => isServerFunctionCall(url, name))) {
        writes.push(url);
      }
    });

    await openEditor(page, editorPath);
    const reason =
      "This component spreads props of its own, which could override the content fields a binding would add. Bind it in Code mode.";
    const candidates = page.locator('[aria-label="Unbound section candidates"]');
    const spreadRow = candidates.getByRole("button", { name: /^E2eSpread/ });
    await expect(spreadRow).toBeVisible({ timeout: 30_000 });
    await expect(spreadRow).toBeDisabled();
    await expect(spreadRow).toHaveAttribute("title", reason);
    await expect(spreadRow).toContainText("Unsupported");
    await expect(
      page.getByRole("button", { name: "Bind E2eSpread", exact: true }),
    ).toHaveCount(0);
    // A disabled control still gets the pointer here; nothing may follow it.
    await spreadRow.click({ force: true });

    const after = await storedState(page, scope);
    expect(writes).toEqual([]);
    expect(after).toEqual(before);
    expect(byPath(after).get("src/routes/index.tsx")?.content).toBe(route);

    // The control: the plain section is bound through the same panel and save.
    await page.getByRole("button", { name: "Bind E2ePlain", exact: true }).click();
    await expect
      .poll(
        async () =>
          byPath(await listFiles(page, scope)).get("src/routes/index.tsx")
            ?.content,
        { timeout: 30_000 },
      )
      .toMatch(/<E2ePlain \{\.\.\.content\("[^"]+"\)\} \/>/);
    const bound = await listFiles(page, scope);
    expect(bound.sourceGeneration).toBeGreaterThan(before.sourceGeneration);
    expect(byPath(bound).get("src/routes/index.tsx")?.content).toContain(
      '<E2eSpread {...{ title: "From code" }} />',
    );
  });
});
/**
 * A new section never takes an id the page's Document still holds.
 *
 * When a section leaves the route, its stored content stays in the
 * Document: invisible, unbound, and kept on purpose. A section added or
 * bound later used to pick its id by looking at the route alone, so it could
 * take that id, and the old content came back on a section that is not the
 * one it was written for. Both entry points are checked: binding an unbound
 * candidate, and adding a section from the library.
 */
test.describe("a new section never takes an id the Document still holds", () => {
  type StoredSection = { id: string; props?: Record<string, unknown> };
  type StoredTemplate = {
    id: string;
    routePath: string | null;
    type: string;
    draftGeneration: number;
    document: { sections: StoredSection[] };
  };

  /** The stored template and Document of one route. */
  async function routeTemplate(
    page: Page,
    scope: ThemeScope,
    routePath: string,
  ) {
    return page.evaluate(
      async ({ scope, routePath, filesModule }) => {
        const themesModule =
          "/src/server/storefront/storefront-themes.serverFn.ts";
        const themes = await import(/* @vite-ignore */ themesModule);
        const files = await import(/* @vite-ignore */ filesModule);
        const editor = await themes.getStorefrontThemeEditor({ data: scope });
        if (!editor.success) throw new Error(editor.message);
        const listed = await files.listStorefrontThemeFiles({ data: scope });
        if (!listed.success) throw new Error(listed.message);
        const template = editor.data.templates.find(
          (candidate: { routePath: string | null; type: string }) =>
            candidate.routePath === routePath ||
            (routePath === "/" && candidate.type === "index"),
        );
        if (!template) throw new Error(`no template for ${routePath}`);
        return {
          sourceGeneration: listed.data.sourceGeneration as number,
          template: {
            id: template.id,
            routePath: template.routePath ?? null,
            type: template.type,
            draftGeneration: template.draftGeneration,
            document: template.document,
          } as StoredTemplate,
        };
      },
      { scope, routePath, filesModule: SERVER_FN_MODULE },
    );
  }

  /** Stores `value` in `field` of section `sectionId`, as the Inspector would. */
  async function storeProp(
    page: Page,
    scope: ThemeScope,
    routePath: string,
    sectionId: string,
    field: string,
    value: string,
  ) {
    const { sourceGeneration, template } = await routeTemplate(
      page,
      scope,
      routePath,
    );
    const result = await page.evaluate(
      async ({
        scope,
        template,
        sectionId,
        field,
        value,
        generation,
        routePath,
      }) => {
        const module = "/src/server/storefront/storefront-themes.serverFn.ts";
        const fns = await import(/* @vite-ignore */ module);
        return fns.updateStorefrontThemeSectionProps({
          data: {
            ...scope,
            templateId: template.id,
            sectionId,
            props: { [field]: value },
            expectedDraftGeneration: template.draftGeneration,
            expectedSourceGeneration: generation,
            routePath,
          },
        });
      },
      {
        scope,
        template: {
          id: template.id,
          draftGeneration: template.draftGeneration,
        },
        sectionId,
        field,
        value,
        generation: sourceGeneration,
        routePath,
      },
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  }

  const storedProp = async (
    page: Page,
    scope: ThemeScope,
    routePath: string,
    sectionId: string,
    field: string,
  ) =>
    (
      await routeTemplate(page, scope, routePath)
    ).template.document.sections.find((section) => section.id === sectionId)
      ?.props?.[field];

  const firstField = (source: string) =>
    /contentFields\s*=\s*\{\s*["']?(\w+)/.exec(source)?.[1] ?? null;

  test("binding: the bound section gets a new id, and the kept content stays where it was", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const ROUTE_FILE = "src/routes/index.tsx";
    const slotOf = (route: string) =>
      /<E2eSlot \{\.\.\.content\("([^"]+)"\)\} \/>/.exec(route)?.[1] ?? null;
    await openEditor(page);
    const { scope, editorPath } = await createOwnTheme(page);
    const initial = await listFiles(page, scope);
    const sectionFile = initial.files.find((file) =>
      /^src\/components\/sections\/[A-Za-z]\w*\.tsx$/.test(file.path),
    );
    expect(sectionFile, "the Starter has a library section").toBeTruthy();
    const field = firstField(sectionFile!.content);
    expect(field, "the library section declares a field").toBeTruthy();
    const from = `../components/sections/${sectionFile!.path.slice("src/components/sections/".length, -".tsx".length)}`;
    const home = byPath(initial).get(ROUTE_FILE)!;
    const unbound = `import E2eSlot from "${from}";\n${home.content.replace(
      /\n(\s*)<\/main>/,
      "\n$1  <E2eSlot />\n$1</main>",
    )}`;
    expect(
      await writeThemeFiles(page, scope, [
        { path: ROUTE_FILE, content: unbound },
      ]),
    ).toMatchObject({ success: true });

    // First binding, and content stored for it.
    await openEditor(page, editorPath);
    await page
      .getByRole("button", { name: "Bind E2eSlot", exact: true })
      .click();
    let first: string | null = null;
    await expect
      .poll(
        async () =>
          (first = slotOf(
            byPath(await listFiles(page, scope)).get(ROUTE_FILE)!.content,
          )),
        { timeout: 30_000 },
      )
      .not.toBeNull();
    const OLD = `old-content-${randomUUID().slice(0, 8)}`;
    await storeProp(page, scope, "/", first!, field!, OLD);

    // The section leaves the route, as an author removing it in Code would;
    // its content stays in the Document.
    expect(
      await writeThemeFiles(page, scope, [
        { path: ROUTE_FILE, content: unbound },
      ]),
    ).toMatchObject({ success: true });
    expect(
      await storedProp(page, scope, "/", first!, field!),
      "the Document keeps the content",
    ).toBe(OLD);

    // Bound again: a new section, so a new id.
    await openEditor(page, editorPath);
    await page
      .getByRole("button", { name: "Bind E2eSlot", exact: true })
      .click();
    let second: string | null = null;
    await expect
      .poll(
        async () =>
          (second = slotOf(
            byPath(await listFiles(page, scope)).get(ROUTE_FILE)!.content,
          )),
        { timeout: 30_000 },
      )
      .not.toBeNull();
    test.info().annotations.push({
      type: "bind ids",
      description: JSON.stringify({ first, second }),
    });
    expect(second, "the new binding took the id the Document holds").not.toBe(
      first,
    );
    // Kept, not deleted, and not shown on the new section.
    expect(await storedProp(page, scope, "/", first!, field!)).toBe(OLD);
    await expect(previewFrame(page).getByText(OLD)).toHaveCount(0);
  });

  test("adding: the added section gets a new id, and the kept content stays where it was", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const ROUTE_PATH = "/e2e-slot-add";
    const ROUTE_FILE = "src/routes/e2e-slot-add.tsx";
    // A route that returns a plain container, which is what an add needs.
    const EMPTY_ROUTE = `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: E2eSlotAddRoute,
});

function E2eSlotAddRoute() {
  return <main></main>;
}
`;
    await openEditor(page);
    const { scope } = await createOwnTheme(page);
    expect(
      await writeThemeFiles(page, scope, [
        { path: ROUTE_FILE, content: EMPTY_ROUTE },
      ]),
    ).toMatchObject({ success: true });
    const ensured = await page.evaluate(
      async ({ scope, routePath }) => {
        const module = "/src/server/storefront/storefront-themes.serverFn.ts";
        const fns = await import(/* @vite-ignore */ module);
        return fns.ensureStorefrontThemeRouteTemplate({
          data: { ...scope, routePath },
        });
      },
      { scope, routePath: ROUTE_PATH },
    );
    expect(ensured.success, JSON.stringify(ensured)).toBe(true);
    const routeEditor = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${ensured.data.id}&routePath=${ROUTE_PATH}`;

    // An empty route reports no section structure, so the editor is ready
    // once the route's own container is on the canvas.
    const openRoute = async () => {
      await page.goto(routeEditor, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible(
        { timeout: 45_000 },
      );
      await expect(
        previewFrame(page).locator(
          `main[data-morph-source-file="${ROUTE_FILE}"]`,
        ),
      ).toBeAttached({ timeout: 60_000 });
    };

    const add = async () => {
      const addSection = page.getByRole("button", {
        name: "Add section",
        exact: true,
      });
      await expect(addSection).toBeEnabled({ timeout: 20_000 });
      await addSection.click();
      const option = page.getByRole("menuitem").first();
      await option.click();
      let id: string | null = null;
      await expect
        .poll(() => (id = new URL(page.url()).searchParams.get("section")), {
          timeout: 30_000,
        })
        .not.toBeNull();
      return id!;
    };

    await openRoute();
    const beforeAdd = await listFiles(page, scope);
    const pathsBefore = new Set(beforeAdd.files.map((file) => file.path));
    const first = await add();
    // Its route source and its page copy, as the add wrote them.
    let added = await listFiles(page, scope);
    await expect
      .poll(
        async () =>
          byPath((added = await listFiles(page, scope))).get(ROUTE_FILE)!
            .content,
        { timeout: 30_000 },
      )
      .toContain(`content("${first}")`);
    const copyFiles = added.files.filter((file) => !pathsBefore.has(file.path));
    expect(copyFiles.length, "the add created a page copy").toBeGreaterThan(0);
    const field =
      copyFiles.map((file) => firstField(file.content)).find(Boolean) ?? null;
    expect(field, "the added section declares a field").toBeTruthy();
    const OLD = `old-content-${randomUUID().slice(0, 8)}`;
    await storeProp(page, scope, ROUTE_PATH, first, field!, OLD);

    // The section leaves the route and its copy goes with it, the way an
    // author removing it in Code would leave the Theme; its content stays.
    const removed = await page.evaluate(
      async ({ module, scope, route, routeFile, deletions }) => {
        const fns = await import(/* @vite-ignore */ module);
        const listed = await fns.listStorefrontThemeFiles({ data: scope });
        const current = listed.data.files.find(
          (file: { path: string }) => file.path === routeFile,
        );
        return fns.saveStorefrontThemeFilesBatch({
          data: {
            ...scope,
            expectedSourceGeneration: listed.data.sourceGeneration,
            files: [
              {
                path: routeFile,
                content: route,
                expectedFileId: current.id,
                expectedVersion: current.version,
              },
            ],
            deletions: listed.data.files
              .filter((file: { path: string }) => deletions.includes(file.path))
              .map((file: { path: string; id: string; version: number }) => ({
                path: file.path,
                expectedFileId: file.id,
                expectedVersion: file.version,
              })),
          },
        });
      },
      {
        module: SERVER_FN_MODULE,
        scope,
        route: EMPTY_ROUTE,
        routeFile: ROUTE_FILE,
        deletions: copyFiles.map((file) => file.path),
      },
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    expect(
      await storedProp(page, scope, ROUTE_PATH, first, field!),
      "the Document keeps the content",
    ).toBe(OLD);

    await openRoute();
    const second = await add();
    test.info().annotations.push({
      type: "add ids",
      description: JSON.stringify({ first, second }),
    });
    expect(second, "the new section took the id the Document holds").not.toBe(
      first,
    );
    expect(await storedProp(page, scope, ROUTE_PATH, first, field!)).toBe(OLD);
    await expect(previewFrame(page).getByText(OLD)).toHaveCount(0);
  });
});
