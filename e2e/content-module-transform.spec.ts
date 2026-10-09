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
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "../src/lib/storefront/starter-theme-v3-files";

/**
 * An author's `content()` that changes a value on its way to the component.
 *
 * `src/morph/content.ts` is the author's file. Here it rewrites one slot's
 * title, as a Theme may for formatting. The canvas has to show what the Theme
 * renders; the Inspector has to edit what the Document stores. Saving the
 * rendered text instead stored it transformed, and the next render transformed
 * it again — `TRANSFORMED:TRANSFORMED:…`, one layer per edit.
 *
 * A second instance of the same component, on a slot the transform leaves
 * alone, has to come through every step unchanged. A third component shows
 * its title in CSS capitals, which changes how it looks and not its text.
 *
 * Runs on a Theme of its own, inserted into the runner-owned database: an
 * interrupted run cannot leave the shared Theme's content module rewritten.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

let scope: ThemeScope | null = null;
let editorPath: string | null = null;
const ROUTE_PATH = "/content-transform";
const SLOT = "content-transform";
const OTHER_SLOT = "content-transform-plain";
const UPPER_SLOT = "content-transform-upper";
// The editor's wording (INLINE_TEXT_REFUSED_MESSAGE in visual-editor-shell),
// restated so the spec does not import the editor's React module.
const REFUSED_HINT =
  "This text can't be edited safely in place. Use the content fields on the right.";
const MODULE = "src/morph/content.ts";
const STARTER_LINE =
  "  return useContext(MorphContentContext).slots[slotId] ?? {};";
const TRANSFORMED_MODULE = STARTER_THEME_CONTENT_MODULE_SOURCE.replace(
  STARTER_LINE,
  `  const values = useContext(MorphContentContext).slots[slotId] ?? {};
  if (slotId === "${SLOT}" && typeof values.title === "string") {
    return { ...values, title: "TRANSFORMED:" + values.title.toUpperCase() };
  }
  return values;`,
);
const transformed = (value: string) => `TRANSFORMED:${value.toUpperCase()}`;

const FILES = [
  {
    path: "src/routes/content-transform.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import TransformCard from "../components/TransformCard";
import UpperCard from "../components/UpperCard";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: ContentTransformRoute,
});

function ContentTransformRoute() {
  return (
    <main>
      <TransformCard {...content("${SLOT}")} />
      <TransformCard {...content("${OTHER_SLOT}")} />
      <UpperCard {...content("${UPPER_SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/components/TransformCard.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Card title" },
} as const;

type TransformCardProps = { title?: string };

export default function TransformCard({
  title = "Card default",
}: TransformCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
  {
    path: "src/components/UpperCard.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Card title" },
} as const;

type UpperCardProps = { title?: string };

export default function UpperCard({ title = "Upper default" }: UpperCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold uppercase">{title}</h2>
    </section>
  );
}
`,
  },
];

/**
 * A Theme row of this spec's own; the editor's first read provisions its
 * Starter source and documents, as for any new Theme.
 */
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
      'content-transform-${created.themeId}', '{"starterTemplateVersion":1}',
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

/**
 * The title the Document holds for a slot, read back from the server — not
 * inferred from the canvas, which shows what the Theme made of it.
 */
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
  // One section per slot; two would make "the stored value" ambiguous.
  expect(sections.length).toBeLessThanOrEqual(1);
  return sections[0]?.props?.title;
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
  await expect(cardTitle(page, SLOT)).toBeVisible({ timeout: 90_000 });
  await expect(cardTitle(page, OTHER_SLOT)).toBeVisible();
  await expect(cardTitle(page, UPPER_SLOT)).toBeVisible();
}

async function ensureSelection(page: Page) {
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await expect(
    page.getByRole("button", { name: "Disable section selection" }),
  ).toBeVisible();
}

async function selectCard(page: Page, slot: string) {
  await ensureSelection(page);
  await cardTitle(page, slot).scrollIntoViewIfNeeded();
  expect(await clickExposedElement(page, cardTitle(page, slot))).not.toBeNull();
  await openContentTab(page);
  await expect(titleField(page)).toBeVisible();
}

/** Types a title into the Inspector and leaves the field, as an author would. */
async function typeTitle(page: Page, value: string) {
  const field = titleField(page);
  await field.fill(value);
  await field.press("Tab");
}

/** Double-clicks a title on the canvas, which is how inline editing begins. */
async function doubleClickTitle(page: Page, slot: string) {
  await ensureSelection(page);
  const title = cardTitle(page, slot);
  await title.scrollIntoViewIfNeeded();
  const box = await title.boundingBox();
  expect(box, `no box for the ${slot} title`).not.toBeNull();
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test.describe("an author's content() that transforms a value", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    expect(TRANSFORMED_MODULE).not.toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
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
    const saved = await writeThemeFiles(page, scope, [
      ...FILES,
      { path: MODULE, content: TRANSFORMED_MODULE },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    // Nothing to put back if the Theme was never created.
    if (!scope) return;
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const restored = await writeThemeFiles(page, scope!, [
      { path: MODULE, content: STARTER_THEME_CONTENT_MODULE_SOURCE },
    ]);
    expect(restored.success, JSON.stringify(restored)).toBe(true);
    const removed = await removeThemeFiles(
      page,
      scope!,
      FILES.map((file) => file.path),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("a field with no stored value is edited in the Inspector, not on the canvas", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openRoute(page);
    expect(await storedTitle(page, SLOT)).toBeUndefined();
    // Nothing stored: content() returns no title, and the default renders.
    await expect(cardTitle(page, SLOT)).toHaveText("Card default");

    await selectCard(page, SLOT);
    // What the canvas shows is a default nobody can tie to this field, so it
    // cannot be typed over, and the author is told where to edit it.
    await doubleClickTitle(page, SLOT);
    await expect(page.getByText(REFUSED_HINT)).toBeVisible();
    await expect(cardTitle(page, SLOT)).not.toHaveAttribute(
      "contenteditable",
      /.*/,
    );

    // The Inspector still edits it, and what it saves is what was typed.
    await selectCard(page, SLOT);
    const first = `first value ${Date.now()}`;
    await typeTitle(page, first);
    await expect.poll(() => storedTitle(page, SLOT)).toBe(first);
    await expect(cardTitle(page, SLOT)).toHaveText(transformed(first));
  });

  test("the canvas shows the transformed value, the Inspector the stored one, and saving stores what was typed", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await openRoute(page);

    // The other instance holds a value of its own first.
    await selectCard(page, OTHER_SLOT);
    const other = `other instance ${Date.now()}`;
    await typeTitle(page, other);
    await expect.poll(() => storedTitle(page, OTHER_SLOT)).toBe(other);
    await expect(cardTitle(page, OTHER_SLOT)).toHaveText(other);

    const stored = await storedTitle(page, SLOT);
    expect(typeof stored).toBe("string");
    await expect(cardTitle(page, SLOT)).toHaveText(
      transformed(stored as string),
    );
    await selectCard(page, SLOT);
    await expect(titleField(page)).toHaveValue(stored as string);

    // An edit renders through content() while typing, without a reload.
    const edited = `edited value ${Date.now()}`;
    await typeTitle(page, edited);
    await expect(cardTitle(page, SLOT)).toHaveText(transformed(edited));
    await expect(titleField(page)).toHaveValue(edited);
    await expect.poll(() => storedTitle(page, SLOT)).toBe(edited);

    // A fresh load renders the saved draft through the server, and the
    // Inspector still offers the stored value, not the rendered one.
    await openRoute(page);
    await expect(cardTitle(page, SLOT)).toHaveText(transformed(edited));
    await selectCard(page, SLOT);
    await expect(titleField(page)).toHaveValue(edited);

    // Editing again from there does not compound the transform.
    const again = `${edited} again`;
    await typeTitle(page, again);
    await expect.poll(() => storedTitle(page, SLOT)).toBe(again);
    await openRoute(page);
    await expect(cardTitle(page, SLOT)).toHaveText(transformed(again));
    await expect(cardTitle(page, SLOT)).not.toContainText(
      "TRANSFORMED:TRANSFORMED:",
    );
    expect(await storedTitle(page, SLOT)).toBe(again);

    // The other instance came through all of it untouched.
    expect(await storedTitle(page, OTHER_SLOT)).toBe(other);
    await expect(cardTitle(page, OTHER_SLOT)).toHaveText(other);
  });

  test("transformed text is not edited in place; text that is the stored value is", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openRoute(page);
    const stored = await storedTitle(page, SLOT);
    const other = await storedTitle(page, OTHER_SLOT);
    expect(typeof stored).toBe("string");
    expect(typeof other).toBe("string");

    // The control first: the untransformed instance does begin, so the
    // refusal below is about the text and not about double-clicking.
    await selectCard(page, OTHER_SLOT);
    await doubleClickTitle(page, OTHER_SLOT);
    await expect(cardTitle(page, OTHER_SLOT)).toHaveAttribute(
      "contenteditable",
      "plaintext-only",
    );
    await page.keyboard.press("Escape");
    await expect(cardTitle(page, OTHER_SLOT)).not.toHaveAttribute(
      "contenteditable",
      /.*/,
    );

    await selectCard(page, SLOT);
    await doubleClickTitle(page, SLOT);
    await expect(page.getByText(REFUSED_HINT)).toBeVisible();
    await expect(cardTitle(page, SLOT)).not.toHaveAttribute(
      "contenteditable",
      /.*/,
    );
    expect(await storedTitle(page, SLOT)).toBe(stored);
    await expect(cardTitle(page, SLOT)).toHaveText(
      transformed(stored as string),
    );
  });

  test("CSS capitals are how text looks, not what it is: edited in place, stored as typed", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openRoute(page);
    await selectCard(page, UPPER_SLOT);
    const stored = `Mixed Case ${Date.now()}`;
    await typeTitle(page, stored);
    await expect.poll(() => storedTitle(page, UPPER_SLOT)).toBe(stored);
    // The DOM holds the text as stored; only CSS shows it in capitals.
    await expect(cardTitle(page, UPPER_SLOT)).toHaveText(stored);

    await doubleClickTitle(page, UPPER_SLOT);
    await expect(cardTitle(page, UPPER_SLOT)).toHaveAttribute(
      "contenteditable",
      "plaintext-only",
    );
    // The edit opens with its text selected, so typing replaces it.
    const edited = `Edited Mixed ${Date.now()}`;
    await page.keyboard.type(edited);
    await page.keyboard.press("Enter");

    await expect.poll(() => storedTitle(page, UPPER_SLOT)).toBe(edited);
    // The committed value reaches the canvas through the Theme's rendering,
    // and the Inspector shows it before any reload.
    await expect(cardTitle(page, UPPER_SLOT)).toHaveText(edited);
    await expect(cardTitle(page, UPPER_SLOT)).not.toHaveAttribute(
      "contenteditable",
      /.*/,
    );
    await expect(titleField(page)).toHaveValue(edited);

    await openRoute(page);
    await expect(cardTitle(page, UPPER_SLOT)).toHaveText(edited);
    expect(await storedTitle(page, UPPER_SLOT)).toBe(edited);
  });
});
