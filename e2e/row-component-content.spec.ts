import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  EDITOR_PATH,
  assertServerFnSuccess,
  clickExposedElement,
  enableSelection,
  isServerFunctionCall,
  openContentTab,
  previewFrame,
} from "./helpers";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
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

/**
 * Design element edits in the real Live Preview, against the route's
 * sections (handoff/2026-10-31/guard-d-reorder-removal.md;
 * visual-editor-shell-element-structure-guard.test.tsx is the shell-level
 * version).
 *
 * b194679 tried to delete the route's own wrapper from the layers panel. In
 * this Live Preview fixture the route's own markup is not listed in the
 * panel, so that step never reached the guard (run kept in
 * handoff/2026-10-31/guard-e2e-b194679/run1). The shell-level reproduction of
 * that path stands; it is not claimed here. The two cases below are what a
 * browser can show:
 * - the ordinary operation: a layers-panel Delete of a plain element inside
 *   a section component this page alone uses is saved, read back from the
 *   stored source, and still gone after a reload;
 * - a message-injection test, not a drag: a sibling reorder naming two
 *   section call sites, posted from the real preview iframe with its own
 *   envelope, is refused by the real shell; nothing is saved and the stored
 *   route is unchanged.
 */
const GUARD_ROUTE_PATH = "/element-guard";
const GUARD_ROUTE_FILE = "src/routes/element-guard.tsx";
const GUARD_HERO_FILE = "src/element-guard/GuardHero.tsx";
const GUARD_SECTIONS = ["guard-hero", "guard-banner"] as const;
const SECTIONS_MESSAGE = "Sections are managed from the page structure tree.";

const guardSection = (name: string) => `export const contentFields = {
  title: { type: "text", label: "${name} title" },
} as const;

export default function ${name}({ title = "${name} default" }: { title?: string }) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="${name.toLowerCase()}-note">${name} note</p>
    </section>
  );
}
`;

// Line numbers matter: the injected reorder names the two section call sites
// by `line:column` of their opening tags (14:9 and 15:9).
const GUARD_FILES = [
  {
    path: GUARD_ROUTE_FILE,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import GuardHero from "../element-guard/GuardHero";
import GuardBanner from "../element-guard/GuardBanner";

export const Route = createFileRoute("${GUARD_ROUTE_PATH}")({
  component: ElementGuardRoute,
});

function ElementGuardRoute() {
  return (
    <main>
      <div className="guard-stack">
        <GuardHero {...content("${GUARD_SECTIONS[0]}")} />
        <GuardBanner {...content("${GUARD_SECTIONS[1]}")} />
      </div>
      <p className="guard-note">Plain note</p>
    </main>
  );
}
`,
  },
  { path: GUARD_HERO_FILE, content: guardSection("GuardHero") },
  {
    path: "src/element-guard/GuardBanner.tsx",
    content: guardSection("GuardBanner"),
  },
];
const HERO_CALL_SITE = "14:9";
const BANNER_CALL_SITE = "15:9";

/** A file as stored, read through the server function Code mode lists with. */
async function storedSource(page: Page, scope: ThemeScope, path: string) {
  const listed = await page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      return fns.listStorefrontThemeFiles({ data: scope });
    },
    {
      module: "/src/server/storefront/storefront-theme-files.serverFn.ts",
      scope,
    },
  );
  expect(listed?.success, "the Theme files were not listed").toBe(true);
  return (
    (listed.data.files as Array<{ path: string; content: string }>).find(
      (file) => file.path === path,
    )?.content ?? null
  );
}

const guardCanvas = (page: Page, selector: string) =>
  previewFrame(page).locator(selector);

/** A section's row in the structure panel, by the preview's tree node. */
const guardSectionRow = (page: Page, sectionId: string) =>
  page.locator(
    `[data-editor-tree-node-id^="${sectionId}:"] button[title^="Select "]`,
  );

async function openGuardRoute(page: Page) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  url.searchParams.set("routePath", GUARD_ROUTE_PATH);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(guardCanvas(page, "p.guard-note")).toBeVisible({
    timeout: 90_000,
  });
}

async function expectBothSections(page: Page) {
  for (const sectionId of GUARD_SECTIONS) {
    await expect(
      guardCanvas(page, `[data-storefront-section-id="${sectionId}"]`),
    ).toBeVisible();
    await expect(guardSectionRow(page, sectionId)).toBeVisible();
  }
}

/** Records every source save the editor sends from now on. */
function recordSourceSaves(page: Page) {
  const saves: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (isServerFunctionCall(request.url(), "saveStorefrontThemeFile") ||
        isServerFunctionCall(request.url(), "saveStorefrontThemeFilesBatch"))
    ) {
      saves.push(request.url());
    }
  });
  return saves;
}

test.describe("Design element edits around the route's sections, in the Live Preview", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const saved = await writeThemeFiles(page, scope!, GUARD_FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(
      page,
      scope!,
      GUARD_FILES.map((file) => file.path),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  test("a plain element inside this page's own section component is deleted from the layers panel, saved, and stays deleted", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openGuardRoute(page);
    // As the spec's other cases do: selection may already be on.
    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }
    await expectBothSections(page);
    const heroBefore = await storedSource(page, scope!, GUARD_HERO_FILE);
    const routeBefore = await storedSource(page, scope!, GUARD_ROUTE_FILE);
    expect(heroBefore).toContain('className="guardhero-note"');

    expect(
      await clickExposedElement(page, guardCanvas(page, "p.guardhero-note")),
      "the hero note was not exposed on the canvas",
    ).not.toBeNull();
    const row = page.locator(
      '[data-editor-tree-node-selected="true"] button[aria-current="true"]',
    );
    await expect(row).toBeVisible({ timeout: 15_000 });
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isServerFunctionCall(response.url(), "saveStorefrontThemeFile"),
      { timeout: 30_000 },
    );
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Delete/ }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    assertServerFnSuccess(await (await saved).text());
    await expect(dialog).toHaveCount(0);

    const heroAfter = await storedSource(page, scope!, GUARD_HERO_FILE);
    expect(heroAfter).not.toContain("guardhero-note");
    expect(heroAfter).toContain("{title}");
    expect(await storedSource(page, scope!, GUARD_ROUTE_FILE)).toBe(
      routeBefore,
    );
    await expect(guardCanvas(page, "p.guardhero-note")).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(guardCanvas(page, "p.guardbanner-note")).toBeVisible();
    await expectBothSections(page);

    // What was saved is what a fresh load renders.
    await openGuardRoute(page);
    await expect(guardCanvas(page, "p.guardhero-note")).toHaveCount(0);
    await expect(guardCanvas(page, "p.guardbanner-note")).toBeVisible();
    await expectBothSections(page);
  });

  test("message injection: a sibling reorder of two section call sites, posted from the real preview frame, is refused and saves nothing", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openGuardRoute(page);
    // As the spec's other cases do: selection may already be on.
    if (
      await page
        .getByRole("button", { name: "Enable section selection" })
        .isVisible()
        .catch(() => false)
    ) {
      await enableSelection(page);
    }
    await expectBothSections(page);
    const routeBefore = await storedSource(page, scope!, GUARD_ROUTE_FILE);
    expect(routeBefore).toContain('{...content("guard-hero")}');

    // The envelope the frame's own bridge stamps on its messages, read from
    // one it sends when a section is clicked.
    await page.evaluate(() => {
      const captured = window as unknown as {
        __guardEnvelope?: { previewSession: string; previewDocument: string };
      };
      window.addEventListener("message", (event) => {
        const data = event.data as Record<string, unknown> | null;
        if (
          data &&
          typeof data.previewSession === "string" &&
          typeof data.previewDocument === "string"
        ) {
          captured.__guardEnvelope = {
            previewSession: data.previewSession,
            previewDocument: data.previewDocument,
          };
        }
      });
    });
    expect(
      await clickExposedElement(page, guardCanvas(page, "p.guardbanner-note")),
    ).not.toBeNull();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __guardEnvelope?: unknown })
              .__guardEnvelope ?? null,
        ),
      )
      .not.toBeNull();
    const envelope = await page.evaluate(
      () =>
        (
          window as unknown as {
            __guardEnvelope: {
              previewSession: string;
              previewDocument: string;
            };
          }
        ).__guardEnvelope,
    );

    const saves = recordSourceSaves(page);
    const editorOrigin = new URL(page.url()).origin;
    const frame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame())!;
    await frame.evaluate(
      ({ message, envelope, editorOrigin }) => {
        window.parent.postMessage({ ...message, ...envelope }, editorOrigin);
      },
      {
        editorOrigin,
        envelope,
        message: {
          type: "morph:storefront-preview-commit-sibling-reorder",
          sectionId: GUARD_ROUTE_FILE,
          sourceFilePath: GUARD_ROUTE_FILE,
          draggedNodeId: HERO_CALL_SITE,
          targetNodeId: BANNER_CALL_SITE,
        },
      },
    );

    // The refusal is the signal that the shell took the message and judged
    // it; it is shown only on the path that returns before sending.
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: SECTIONS_MESSAGE }),
    ).toBeVisible({ timeout: 15_000 });
    expect(saves).toEqual([]);
    expect(await storedSource(page, scope!, GUARD_ROUTE_FILE)).toBe(
      routeBefore,
    );
    await expectBothSections(page);
  });
});
