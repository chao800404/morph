import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openStylesTab,
  previewFrame,
  settleSelection,
} from "./helpers";
import { STARTER_THEME_V3_NEW_FILES } from "../src/lib/storefront/starter-theme-v3-files";
import { THEMES, serverFn } from "./native-acceptance";
import {
  themeScopeFromEditorPath,
  themeSourceGeneration,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * The Inspector's object position on the Starter's own components, in a real
 * preview, on a Theme and route of this spec's own.
 *
 * A collection row's image reads `item.imagePosition`, a declared row field,
 * through an inline style: the control writes that field, and the canvas, the
 * stored draft and a reload agree. The story image reads `imagePosition` too,
 * but the Starter does not declare it, so the control is left to Code there:
 * a class edit beside the inline style would change nothing.
 *
 * Nothing here touches the shared store's content: the Theme is inserted into
 * the runner-owned database for this spec, and its route's Document is written
 * through the same server writes the editor makes.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const shared = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
let scope: ThemeScope | null = null;
let editorPath: string | null = null;

const ROUTE_PATH = "/object-position";
const COLLECTIONS = "collections";
const STORY = "story";
const STORY_HEADING = "Object position story";

const FILES = [
  {
    path: "src/routes/object-position.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import CategoryShowcase from "../components/CategoryShowcase";
import ImageWithText from "../components/ImageWithText";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: ObjectPositionRoute,
});

function ObjectPositionRoute() {
  return (
    <main>
      <CategoryShowcase {...content("${COLLECTIONS}")} />
      <ImageWithText {...content("${STORY}")} />
    </main>
  );
}
`,
  },
  // The Starter's own components, byte for byte, with what they import: a
  // new Theme does not carry them.
  ...STARTER_THEME_V3_NEW_FILES.filter((file) =>
    [
      "src/morph/content-fields.ts",
      "src/morph/link.tsx",
      "src/components/CategoryShowcase.tsx",
      "src/components/ImageWithText.tsx",
    ].includes(file.path),
  ).map((file) => ({ path: file.path, content: file.content })),
];

const ROWS = [
  {
    id: "row-a",
    title: "First collection",
    image: { src: "/static/storefront/theme-preview-default.png", alt: "A" },
    imagePosition: "30% center",
  },
  {
    id: "row-b",
    title: "Second collection",
    image: { src: "/static/storefront/theme-preview-default.png", alt: "B" },
    imagePosition: "72% center",
  },
];

async function createThrowawayTheme(): Promise<ThemeScope> {
  const created = { ...shared!, themeId: randomUUID() };
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
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'object-position-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`,
  ]);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

async function storeSection(
  page: Page,
  sectionId: string,
  props: Record<string, unknown>,
) {
  const ensured = (await serverFn(
    page,
    THEMES,
    "ensureStorefrontThemeRouteTemplate",
    { ...scope!, routePath: ROUTE_PATH },
  )) as { success: boolean; data?: { id: string; draftGeneration: number } };
  expect(ensured.success, JSON.stringify(ensured)).toBe(true);
  const stored = (await serverFn(
    page,
    THEMES,
    "updateStorefrontThemeSectionProps",
    {
      ...scope!,
      templateId: ensured.data!.id,
      sectionId,
      props,
      expectedDraftGeneration: ensured.data!.draftGeneration,
      expectedSourceGeneration: await themeSourceGeneration(page, scope!),
      routePath: ROUTE_PATH,
    },
  )) as { success: boolean };
  expect(stored.success, JSON.stringify(stored)).toBe(true);
}

/** The route Document's stored rows, as the server holds them. */
async function storedRows(page: Page) {
  const editor = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    success: boolean;
    data?: {
      templates: Array<{
        routePath: string | null;
        document: {
          sections: Array<{ id: string; props?: Record<string, unknown> }>;
        };
      }>;
    };
  };
  expect(editor.success, JSON.stringify(editor)).toBe(true);
  const section = editor
    .data!.templates.find((template) => template.routePath === ROUTE_PATH)
    ?.document.sections.find((candidate) => candidate.id === COLLECTIONS);
  return (section?.props?.items ?? []) as Array<Record<string, unknown>>;
}

async function openRoute(page: Page) {
  const url = new URL(editorPath!, "http://placeholder");
  url.searchParams.set("routePath", ROUTE_PATH);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(previewFrame(page).getByText(STORY_HEADING)).toBeAttached({
    timeout: 90_000,
  });
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
}

const images = (page: Page, sectionId: string) =>
  previewFrame(page).locator(`[data-storefront-section-id="${sectionId}"] img`);

/** The rendered value, not the stored one: what a visitor sees. */
const positionOf = (image: Locator) =>
  image.evaluate((element) => getComputedStyle(element).objectPosition);

async function selectCollectionImage(page: Page, nth: number) {
  const image = images(page, COLLECTIONS).nth(nth);
  await expect(image).toBeAttached({ timeout: 45_000 });
  await image.scrollIntoViewIfNeeded();
  const clicked = await clickExposedElement(
    page,
    images(page, COLLECTIONS),
    nth,
  );
  expect(clicked, "the image was never exposed to a click").not.toBeNull();
  await openStylesTab(page);
  return image;
}

test.describe("the Inspector's object position", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    scope = await createThrowawayTheme();
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...scope,
    })) as {
      success: boolean;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const home = result.data!.templates.find(
      (template) => template.type === "index",
    );
    expect(home).toBeDefined();
    editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`;
    const saved = await writeThemeFiles(page, scope, FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await storeSection(page, COLLECTIONS, {
      heading: "Object position collections",
      items: ROWS,
    });
    await storeSection(page, STORY, {
      heading: STORY_HEADING,
      image: { src: "/static/storefront/theme-preview-default.png", alt: "S" },
      imagePosition: "center center",
    });
    expect(
      (await storedRows(page)).map((row) => [row.id, row.imagePosition]),
    ).toEqual([
      ["row-a", "30% center"],
      ["row-b", "72% center"],
    ]);
    await page.context().close();
  });

  test("a collection image's position is saved, shown, and kept after a reload", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page);
    const image = await selectCollectionImage(page, 1);
    const control = page.getByRole("combobox", { name: "Object position" });
    await expect(control).toBeEnabled();
    await expect(control).toHaveText(/Custom \(72% center\)/);

    await control.click();
    await page.getByRole("option", { name: "Top", exact: true }).click();
    await expect
      .poll(() => positionOf(image), { timeout: 20_000 })
      .toBe("50% 0%");
    await expect
      .poll(async () =>
        (await storedRows(page)).map((row) => [row.id, row.imagePosition]),
      )
      .toEqual([
        ["row-a", "30% center"],
        ["row-b", "top"],
      ]);

    await openRoute(page);
    await expect
      .poll(() => positionOf(images(page, COLLECTIONS).nth(1)), {
        timeout: 20_000,
      })
      .toBe("50% 0%");
    // The neighbouring row kept its own stored position.
    await expect
      .poll(() => positionOf(images(page, COLLECTIONS).nth(0)))
      .toBe("30% 50%");
    await selectCollectionImage(page, 1);
    await expect(
      page.getByRole("combobox", { name: "Object position" }),
    ).toHaveText(/Top/);
  });

  test("the story image's position is left to Code: the Starter does not declare it", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page);
    const image = images(page, STORY).first();
    await expect(image).toBeAttached({ timeout: 45_000 });
    // A synthetic click on the image itself, which the preview's own capture
    // listener turns into a selection (`reportSelection(event.target)`). What
    // this covers: that handler, the selection report and everything the
    // editor does with it. What it does not: pointer hit-testing, that is,
    // whether a real pointer could reach the image on screen. A pointer click
    // found no exposed point of it in an earlier run.
    await image.dispatchEvent("click");
    await settleSelection(page);
    await openStylesTab(page);
    const before = await positionOf(image);
    const control = page.getByRole("combobox", { name: "Object position" });
    await expect(control).toBeDisabled();
    await expect(
      page.locator('[data-inspector-note="object-position"]'),
    ).toContainText("set in code, not by an editable field");
    // Fit is a class on the element and stays editable.
    await expect(
      page.getByRole("combobox", { name: "Object fit" }),
    ).toBeEnabled();
    expect(await positionOf(image)).toBe(before);
  });
});
