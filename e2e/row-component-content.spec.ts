import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
} from "./helpers";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";

/**
 * A list whose rows are rendered by a component of their own, declared by
 * reference (`items: { type: "array", of: "./RowCard" }`), end to end in the
 * real Live Preview: the row's own element carries the row's path, a click on
 * it selects that row's field, and the edit lands in that row only — saved,
 * and still there after a fresh load.
 *
 * Writes its own route and components into the seeded, disposable store, in
 * a folder of their own, and removes them afterwards.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const ROUTE_PATH = "/row-component-fields";
const SLOT = "row-list";

const FILES = [
  {
    path: "src/routes/row-component-fields.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import RowList from "../row-component/RowList";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: RowComponentRoute,
});

function RowComponentRoute() {
  return (
    <main>
      <RowList {...content("${SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/row-component/RowList.tsx",
    content: `import RowCard from "./RowCard";

export const contentFields = {
  heading: { type: "text", label: "List heading" },
  items: { type: "array", label: "Cards", of: "./RowCard" },
} as const;

type Row = { id: string; title?: string; body?: string };

export default function RowList({
  heading = "Row cards",
  items = [
    { id: "row-a", title: "First row", body: "First body" },
    { id: "row-b", title: "Second row", body: "Second body" },
  ],
}: {
  heading?: string;
  items?: Row[];
}) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{heading}</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <RowCard key={item.id} {...item} />
        ))}
      </div>
    </section>
  );
}
`,
  },
  {
    path: "src/row-component/RowCard.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Card title" },
  body: { type: "textarea", label: "Card body" },
} as const;

export default function RowCard({
  title = "",
  body = "",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <article className="rounded border p-4">
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="mt-2 text-sm">{body}</p>
    </article>
  );
}
`,
  },
];

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

/** The element a row's own component renders for one of its fields. */
const rowField = (page: Page, path: string) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${SLOT}"] [data-storefront-field-path="${path}"]:not([data-morph-preview-row-wrapper])`,
  );

async function openRoute(page: Page) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  url.searchParams.set("routePath", ROUTE_PATH);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(rowField(page, "items.1.title")).toBeVisible({
    timeout: 90_000,
  });
}

/** The Inspector control a row offers for one of its declared fields. */
const rowControl = (page: Page, label: string) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ has: page.locator(":scope > label", { hasText: label }) })
    .locator("input, textarea");

test.describe("a list whose rows are rendered by their own component", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const saved = await writeThemeFiles(page, scope!, FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
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

  test("names each row's own fields by the row's path on the page", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openRoute(page);

    // RowCard's elements, not the List's: the path reached them through the
    // component boundary, and nothing claims a top-level `title`.
    await expect(rowField(page, "items.0.title")).toHaveText("First row");
    await expect(rowField(page, "items.1.title")).toHaveText("Second row");
    await expect(rowField(page, "items.1.body")).toHaveText("Second body");
    await expect(
      previewFrame(page).locator(
        `[data-storefront-section-id="${SLOT}"] [data-storefront-field="title"]:not([data-storefront-field-path])`,
      ),
    ).toHaveCount(0);
  });

  test("edits the clicked row's field, and only that row", async ({ page }) => {
    test.setTimeout(180_000);
    await openRoute(page);

    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }
    const second = rowField(page, "items.1.title");
    await second.scrollIntoViewIfNeeded();
    expect(
      await clickExposedElement(page, second),
      "the second row's title was not exposed on the canvas",
    ).not.toBeNull();
    await openContentTab(page);

    // The selected row, on its own.
    await expect(page.getByText("2 / 2")).toBeVisible();
    const title = rowControl(page, "Card title");
    await expect(title).toHaveValue("Second row");

    const edited = `Second row edited ${Date.now()}`;
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === new URL(page.url()).origin &&
        (response.request().postData() ?? "").includes(edited),
      { timeout: 30_000 },
    );
    await title.fill(edited);
    await title.press("Tab");
    const response = await saved;
    expect(response.ok()).toBe(true);
    // Written into the row, beside the row it did not touch.
    const body = response.request().postData() ?? "";
    expect(body).toContain("First row");
    expect(body).toContain("row-b");
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
    );

    await expect(rowField(page, "items.1.title")).toHaveText(edited);
    await expect(rowField(page, "items.0.title")).toHaveText("First row");

    // What was saved is what a fresh load renders.
    await openRoute(page);
    await expect(rowField(page, "items.1.title")).toHaveText(edited);
    await expect(rowField(page, "items.0.title")).toHaveText("First row");
  });
});
