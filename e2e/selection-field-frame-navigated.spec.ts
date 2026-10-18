import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
} from "./helpers";
import { THEMES, serverFn } from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * Typing into the Inspector after the preview moved to another page by
 * itself.
 *
 * An `update-selection-field` post names the section it is for, and the editor
 * sends it only while the frame shows the editor's page. Here the frame is
 * sent to another page from inside (its own router, as a link would), to a
 * dynamic route the editor does not follow. The author then types into the
 * field still open for the first page's section: nothing on the frame's page
 * changes as they type, and leaving the field saves the value.
 *
 * Runs on a Theme of its own, inserted into the runner-owned database, as in
 * `content-module-transform.spec.ts`.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

let scope: ThemeScope | null = null;
let editorPath: string | null = null;
const HOME_ROUTE = "/selection-field-home";
const OTHER_ROUTE = "/selection-field-other/$item";
const OTHER_PATH = "/selection-field-other/elsewhere";
const SLOT = "selection-field-home-card";
const OTHER_SLOT = "selection-field-other-card";

const FILES = [
  {
    path: "src/routes/selection-field-home.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import FieldCard from "../components/FieldCard";

export const Route = createFileRoute("${HOME_ROUTE}")({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <main>
      <FieldCard {...content("${SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/routes/selection-field-other.$item.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import FieldCard from "../components/FieldCard";

export const Route = createFileRoute("${OTHER_ROUTE}")({
  component: OtherRoute,
});

function OtherRoute() {
  return (
    <main>
      <FieldCard {...content("${OTHER_SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/components/FieldCard.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Card title" },
} as const;

type FieldCardProps = { title?: string };

export default function FieldCard({ title = "Card default" }: FieldCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
];

async function createThrowawayTheme(): Promise<ThemeScope> {
  const created = {
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
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'selection-field-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`,
  ]);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

const cardTitle = (page: Page, slot: string) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${slot}"] [data-storefront-field="title"]`,
  );

const titleField = (page: Page) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: "Card title" })
    .locator("input");

/** The title the Document holds for a slot, read back from the server. */
async function storedTitle(page: Page, slot: string): Promise<unknown> {
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as {
    success: boolean;
    data?: {
      templates: Array<{
        document: {
          sections: Array<{ id: string; props?: Record<string, unknown> }>;
        };
      }>;
    };
  };
  expect(result.success, JSON.stringify(result)).toBe(true);
  const sections = result
    .data!.templates.flatMap((template) => template.document.sections)
    .filter((section) => section.id === slot);
  expect(sections.length).toBeLessThanOrEqual(1);
  return sections[0]?.props?.title;
}

test.describe("typing after the preview moved to another page by itself", () => {
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
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    if (!scope) return;
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(
      page,
      scope!,
      FILES.map((file) => file.path),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("the canvas stays as it is while typing, and leaving the field saves the value", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const url = new URL(editorPath!, "http://placeholder");
    url.searchParams.set("routePath", HOME_ROUTE);
    await page.goto(`${url.pathname}${url.search}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(cardTitle(page, SLOT)).toBeVisible({ timeout: 90_000 });

    await enableSelection(page);
    expect(await clickExposedElement(page, cardTitle(page, SLOT))).not.toBeNull();
    await openContentTab(page);
    await expect(titleField(page)).toBeVisible();

    // Live typing reaches the canvas while the frame shows the editor's page.
    const live = `live ${Date.now()}`;
    await titleField(page).fill(live);
    await expect(cardTitle(page, SLOT)).toHaveText(live);
    await titleField(page).press("Tab");
    await expect.poll(() => storedTitle(page, SLOT)).toBe(live);

    // The frame moves by itself, as a link inside it would.
    await previewFrame(page)
      .locator("body")
      .evaluate((_body, to) => {
        const router = (
          window as unknown as {
            __morphPreviewRouter?: { navigate(options: { to: string }): unknown };
          }
        ).__morphPreviewRouter;
        if (!router) throw new Error("the preview exposes no router");
        void router.navigate({ to });
      }, OTHER_PATH);
    await expect(cardTitle(page, OTHER_SLOT)).toBeVisible({ timeout: 30_000 });
    await expect(cardTitle(page, SLOT)).toHaveCount(0);
    const otherBefore = await cardTitle(page, OTHER_SLOT).textContent();

    // The field for the first page's section is still open; typing into it
    // changes nothing on the page the frame shows now.
    await expect(titleField(page)).toBeVisible();
    const typed = `typed after navigation ${Date.now()}`;
    await titleField(page).fill(typed);
    await page.waitForTimeout(1_000);
    await expect(cardTitle(page, OTHER_SLOT)).toHaveText(otherBefore ?? "");
    await expect(previewFrame(page).getByText(typed)).toHaveCount(0);

    // Leaving the field saves what was typed, to the section it was typed for.
    await titleField(page).press("Tab");
    await expect.poll(() => storedTitle(page, SLOT)).toBe(typed);
    expect(await storedTitle(page, OTHER_SLOT)).toBeUndefined();
  });
});
