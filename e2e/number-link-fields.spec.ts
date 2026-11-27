import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
} from "./helpers";
import { THEMES, serverFn } from "./native-acceptance";
import {
  themeScopeFromEditorPath,
  themeSourceGeneration,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";
import {
  insertThrowawayTheme,
  specPreviewRuntime,
} from "./helpers/throwaway-theme";

/**
 * The Inspector's `number` and `link` content fields, in a real preview, on a
 * Theme and route of this spec's own.
 *
 * For each field: a canvas click selects that field, an Inspector edit reaches
 * the canvas, the Document keeps the raw value the contract declares (a
 * number as a number; a link as `{ href, target }`, with `rel` derived when
 * content is published and never stored), and after a reload the canvas, the Inspector and
 * the Document agree. The link also refuses an address that would run script,
 * and a number outside its declared range is not stored.
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

const ROUTE_PATH = "/number-link";
const METER = "meter";
const CTA = "cta";

const FILES = [
  {
    path: "src/routes/number-link.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import SeatMeter from "../components/SeatMeter";
import GuideLink from "../components/GuideLink";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: NumberLinkRoute,
});

function NumberLinkRoute() {
  return (
    <main>
      <SeatMeter {...content("${METER}")} />
      <GuideLink {...content("${CTA}")} />
    </main>
  );
}
`,
  },
  {
    // The count is shown as itself and, beside it, inside text the Theme
    // builds from it: what the canvas shows is not what is stored.
    path: "src/components/SeatMeter.tsx",
    content: `export const contentFields = {
  seats: {
    type: "number",
    label: "Seat count",
    min: 0,
    max: 500,
    step: 1,
  },
} as const;

type SeatMeterProps = { seats?: number };

export default function SeatMeter({ seats = 8 }: SeatMeterProps) {
  return (
    <section style={{ margin: "0 auto", maxWidth: 480, padding: "40px 24px", textAlign: "center" }}>
      <p className="text-2xl">
        <strong>{seats}</strong> seats
      </p>
      <p data-testid="capacity">{\`Room for \${seats * 2} guests\`}</p>
    </section>
  );
}
`,
  },
  {
    // A plain anchor: the destination is an \`href\` the Inspector can type
    // into, and \`rel\` arrives already derived from the target.
    path: "src/components/GuideLink.tsx",
    content: `export const contentFields = {
  guide: { type: "link", label: "Guide link" },
} as const;

type GuideLinkProps = {
  guide?: { href?: string; target?: "_self" | "_blank"; rel?: string };
};

export default function GuideLink({ guide = { href: "/guide" } }: GuideLinkProps) {
  return (
    <section style={{ margin: "0 auto", maxWidth: 480, padding: "40px 24px", textAlign: "center" }}>
      <a href={guide.href} target={guide.target} rel={guide.rel}>
        Read the guide
      </a>
    </section>
  );
}
`,
  },
];

async function createThrowawayTheme(): Promise<ThemeScope> {
  const created = { ...shared!, themeId: randomUUID() };
  insertThrowawayTheme({
    themeId: created.themeId,
    storefrontId: created.storefrontId,
    name: `number-link-${created.themeId}`,
    previewRuntime: specPreviewRuntime(),
  });
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

/** What the route's Document holds for a section, as the server holds it. */
async function storedProps(
  page: Page,
  sectionId: string,
): Promise<Record<string, unknown>> {
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
    ?.document.sections.find((candidate) => candidate.id === sectionId);
  return section?.props ?? {};
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
  await expect(count(page)).toBeAttached({ timeout: 90_000 });
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
}

const count = (page: Page) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${METER}"] [data-storefront-field="seats"]`,
  );
const capacity = (page: Page) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${METER}"] [data-testid="capacity"]`,
  );
const guide = (page: Page) =>
  previewFrame(page).locator(
    `[data-storefront-section-id="${CTA}"] a[data-storefront-field="guide"]`,
  );

const seatField = (page: Page) =>
  page
    .locator('[data-slot="inspector-content-field"]')
    .filter({ hasText: "Seat count" });
const seatInput = (page: Page) => seatField(page).getByRole("spinbutton");
const hrefInput = (page: Page) =>
  page.getByRole("textbox", { name: "Guide link path or URL" });
const targetSelect = (page: Page) =>
  page.getByRole("combobox").filter({ hasText: /^(Same tab|New tab)$/ });

async function selectCount(page: Page) {
  await expect(count(page)).toBeVisible({ timeout: 45_000 });
  await count(page).scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, count(page)),
    "the seat count was not exposed on the canvas",
  ).not.toBeNull();
  await openContentTab(page);
}

async function selectGuide(page: Page) {
  await expect(guide(page)).toBeVisible({ timeout: 45_000 });
  await guide(page).scrollIntoViewIfNeeded();
  expect(
    await clickExposedElement(page, guide(page)),
    "the guide link was not exposed on the canvas",
  ).not.toBeNull();
  await openContentTab(page);
}

test.describe("the Inspector's number and link fields", () => {
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
    await storeSection(page, METER, { seats: 12 });
    await storeSection(page, CTA, { guide: { href: "/guide" } });
    expect((await storedProps(page, METER)).seats).toBe(12);
    await page.context().close();
  });

  test("a number is chosen on the canvas, edited in the Inspector, stored as a number and kept after a reload", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page);
    await expect(count(page)).toHaveText("12");
    await expect(capacity(page)).toHaveText("Room for 24 guests");

    // The click selects this field: its control is the one the panel shows,
    // holding the stored value, and the other section's field is not offered.
    await selectCount(page);
    await expect(seatInput(page)).toBeVisible();
    await expect(seatInput(page)).toHaveValue("12");
    await expect(
      page.getByRole("textbox", { name: "Guide link path or URL" }),
    ).toHaveCount(0);

    // An edit reaches the canvas, and what the Theme builds from it.
    await seatInput(page).fill("37");
    await seatInput(page).press("Tab");
    await expect(count(page)).toHaveText("37");
    await expect(capacity(page)).toHaveText("Room for 74 guests");

    // The Document holds the number itself, not the text the Theme built.
    await expect
      .poll(() => storedProps(page, METER).then((p) => p.seats))
      .toBe(37);
    expect(typeof (await storedProps(page, METER)).seats).toBe("number");

    // A number outside the field's declared range is not stored.
    await seatInput(page).fill("900");
    await seatInput(page).press("Tab");
    await page.waitForTimeout(2_000);
    expect((await storedProps(page, METER)).seats).toBe(37);

    // Canvas, Inspector and Document agree after a reload.
    await openRoute(page);
    await expect(count(page)).toHaveText("37");
    await expect(capacity(page)).toHaveText("Room for 74 guests");
    await selectCount(page);
    await expect(seatInput(page)).toHaveValue("37");
    expect((await storedProps(page, METER)).seats).toBe(37);
  });

  test("a link's address and target are chosen on the canvas, stored without rel, refused when unsafe, and kept after a reload", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openRoute(page);
    await expect(guide(page)).toHaveAttribute("href", "/guide");
    await expect(guide(page)).not.toHaveAttribute("target", /.+/);

    await selectGuide(page);
    await expect(hrefInput(page)).toBeVisible();
    await expect(hrefInput(page)).toHaveValue("/guide");
    await expect(targetSelect(page)).toHaveText("Same tab");
    await expect(seatInput(page)).toHaveCount(0);

    // The address reaches the canvas.
    await hrefInput(page).fill("https://example.com/docs");
    await hrefInput(page).press("Tab");
    await expect(guide(page)).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    await expect
      .poll(() => storedProps(page, CTA).then((p) => p.guide))
      .toMatchObject({ href: "https://example.com/docs" });

    // A new tab to another site: the canvas gets the target; the Document
    // keeps the address and the target, never the rel. The rel is derived
    // when published content is resolved (storefront-content-runtime), not in
    // the editor's preview content, so the canvas is not asked for it here.
    await targetSelect(page).click();
    await page.getByRole("option", { name: "New tab", exact: true }).click();
    await expect(guide(page)).toHaveAttribute("target", "_blank");
    await expect
      .poll(() => storedProps(page, CTA).then((p) => p.guide))
      .toMatchObject({ href: "https://example.com/docs", target: "_blank" });
    const stored = (await storedProps(page, CTA)).guide as Record<
      string,
      unknown
    >;
    expect(stored).not.toHaveProperty("rel");

    // An address that would run script is not stored.
    await hrefInput(page).fill("javascript:alert(1)");
    await hrefInput(page).press("Tab");
    await page.waitForTimeout(2_000);
    expect((await storedProps(page, CTA)).guide).toMatchObject({
      href: "https://example.com/docs",
      target: "_blank",
    });

    // Canvas, Inspector and Document agree after a reload.
    await openRoute(page);
    await expect(guide(page)).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    await expect(guide(page)).toHaveAttribute("target", "_blank");
    await selectGuide(page);
    await expect(hrefInput(page)).toHaveValue("https://example.com/docs");
    await expect(targetSelect(page)).toHaveText("New tab");
    expect((await storedProps(page, CTA)).guide).toMatchObject({
      href: "https://example.com/docs",
      target: "_blank",
    });
  });
});
