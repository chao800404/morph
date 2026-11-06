import {
  expect,
  test,
  type Browser,
  type Page,
  type Route,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
} from "./helpers";
import { execLocalD1, isServerFn } from "./helpers/editor-writes-paused";
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
  execLocalD1(`INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'selection-field-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`);
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

/**
 * The first write on a route that has no document of its own yet creates one
 * (`ensureStorefrontThemeRouteTemplate`). When the editor reads it back, it
 * moves its own URL from the borrowed index `templateId` to that document on
 * the same route. That is the editor completing its own address, not the
 * author switching pages, so it must not hold the editor behind the "saving"
 * leave dialog while the first write is still unanswered. Found in PR #351 CI
 * run 42105313742: the dialog took focus and the next thing typed never
 * reached the field (handoff/2026-11-06/diag-save-8bdf85e/REPORT.md).
 *
 * The first write's response is held here, so the order is the one that
 * failed. The test moves on when the URL has taken the route's document,
 * never by waiting for a dialog. A real page switch still waits for the save.
 */
test.describe("the editor adopting a route document it just created", () => {
  test.describe.configure({ mode: "serial" });

  let own: ThemeScope | null = null;
  let homeTemplateId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    own = await createThrowawayTheme();
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...own,
    })) as {
      success: boolean;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(result.success, JSON.stringify(result)).toBe(true);
    homeTemplateId = result.data!.templates.find(
      (template) => template.type === "index",
    )!.id;
    const saved = await writeThemeFiles(page, own, FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    if (!own) return;
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(
      page,
      own,
      FILES.map((file) => file.path),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  type StoredTemplate = {
    id: string;
    routePath: string | null;
    document: {
      sections: Array<{ id: string; props?: Record<string, unknown> }>;
    };
  };

  /** The slot's stored title in the route's own document, and in any other. */
  async function storedOn(page: Page) {
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...own!,
    })) as { success: boolean; data?: { templates: StoredTemplate[] } };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const titleIn = (template: StoredTemplate) =>
      template.document.sections.find((section) => section.id === SLOT)?.props
        ?.title;
    const templates = result.data!.templates;
    const route = templates.find(
      (template) => template.routePath === HOME_ROUTE,
    );
    return {
      routeTemplateId: route?.id ?? null,
      route: route ? titleIn(route) : undefined,
      elsewhere: templates
        .filter((template) => template !== route)
        .map(titleIn)
        .filter((title) => title !== undefined),
    };
  }

  /** Holds the response of the next section-props write until released. */
  async function holdNextPropsWrite(page: Page) {
    const held = {
      reached: false,
      answered: false,
      release: () => {},
    };
    const released = new Promise<void>((resolve) => {
      held.release = resolve;
    });
    let taken = false;
    await page.route(
      (url) => isServerFn(url.toString(), "updateStorefrontThemeSectionProps"),
      async (route: Route) => {
        if (taken) return route.continue();
        taken = true;
        // The write reaches the server as it is; only its answer waits.
        const response = await route.fetch();
        held.reached = true;
        await released;
        await route.fulfill({ response });
        held.answered = true;
      },
    );
    return held;
  }

  const urlTemplateId = (page: Page) =>
    new URL(page.url()).searchParams.get("templateId");
  const leaveDialog = (page: Page) =>
    page.locator("[data-editor-leave-prompt]");

  test("typing while the first save is unanswered stays in the field and is saved to the route's document", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto(
      `/store/${own!.storefrontId}/themes/${own!.themeId}/editor?templateId=${homeTemplateId}&routePath=${encodeURIComponent(HOME_ROUTE)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(cardTitle(page, SLOT)).toBeVisible({ timeout: 90_000 });
    await enableSelection(page);
    expect(
      await clickExposedElement(page, cardTitle(page, SLOT)),
    ).not.toBeNull();
    await openContentTab(page);
    await expect(titleField(page)).toBeVisible();

    const held = await holdNextPropsWrite(page);
    try {
      const first = `first ${Date.now()}`;
      await titleField(page).fill(first);
      await titleField(page).press("Tab");
      await expect.poll(() => held.reached, { timeout: 30_000 }).toBe(true);

      // The first save is unanswered: nothing asks the author anything, and
      // they go on editing. (When the page takes up the route's new document
      // is not fixed here: the editor's own read of it waits for the write,
      // and a read arriving earlier is covered by the shell tests.)
      await page.waitForTimeout(1_000);
      expect(held.answered).toBe(false);
      await expect(leaveDialog(page)).toHaveCount(0);

      // What the author types now reaches the field.
      await openContentTab(page);
      const second = `second ${Date.now()}`;
      await titleField(page).fill(second);
      await expect(titleField(page)).toHaveValue(second);
      expect(held.answered).toBe(false);
      await expect(leaveDialog(page)).toHaveCount(0);

      // The first answer arrives; it does not take the second value away,
      // and the address is the document the server created for this route.
      held.release();
      await expect.poll(() => held.answered, { timeout: 30_000 }).toBe(true);
      const created = (await storedOn(page)).routeTemplateId;
      expect(created).not.toBeNull();
      expect(created).not.toBe(homeTemplateId);
      await expect
        .poll(() => urlTemplateId(page), {
          timeout: 30_000,
          message: "the URL should name the route document the server created",
        })
        .toBe(created);
      await expect(titleField(page)).toHaveValue(second);
      await titleField(page).press("Tab");
      await expect
        .poll(async () => (await storedOn(page)).route, { timeout: 30_000 })
        .toBe(second);
      const stored = await storedOn(page);
      expect(stored.routeTemplateId).toBe(created);
      expect(stored.routeTemplateId).toBe(urlTemplateId(page));
      expect(stored.elsewhere).toEqual([]);
      await expect(titleField(page)).toHaveValue(second);
      await expect(cardTitle(page, SLOT)).toHaveText(second);

      // And it is still there after a reload.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(cardTitle(page, SLOT)).toHaveText(second, {
        timeout: 90_000,
      });
    } finally {
      // Never leave the answer waiting, whatever failed above.
      held.release();
    }
  });

  test("switching to another page while a save is unanswered still waits for it", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto(
      `/store/${own!.storefrontId}/themes/${own!.themeId}/editor?routePath=${encodeURIComponent(HOME_ROUTE)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(cardTitle(page, SLOT)).toBeVisible({ timeout: 90_000 });
    await enableSelection(page);
    expect(
      await clickExposedElement(page, cardTitle(page, SLOT)),
    ).not.toBeNull();
    await openContentTab(page);
    await expect(titleField(page)).toBeVisible();

    const held = await holdNextPropsWrite(page);
    try {
      const third = `third ${Date.now()}`;
      await titleField(page).fill(third);
      await titleField(page).press("Tab");
      await expect.poll(() => held.reached, { timeout: 30_000 }).toBe(true);

      // The author goes to the home page: a real page switch.
      await page.evaluate(() => {
        const router = (
          window as unknown as {
            __TSR_ROUTER__: {
              navigate(options: {
                to: string;
                search: (
                  previous: Record<string, unknown>,
                ) => Record<string, unknown>;
              }): unknown;
            };
          }
        ).__TSR_ROUTER__;
        void router.navigate({
          to: location.pathname,
          search: (previous) => {
            const next = { ...previous };
            delete next.routePath;
            delete next.section;
            return next;
          },
        });
      });
      await expect(leaveDialog(page)).toHaveAttribute(
        "data-editor-leave-kind",
        "switch-page",
        { timeout: 15_000 },
      );
      expect(new URL(page.url()).searchParams.get("routePath")).toBe(
        HOME_ROUTE,
      );

      held.release();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("routePath"), {
          timeout: 30_000,
        })
        .toBeNull();
      await expect
        .poll(async () => (await storedOn(page)).route, { timeout: 30_000 })
        .toBe(third);
    } finally {
      // Never leave the answer waiting, whatever failed above.
      held.release();
    }
  });
});

/**
 * The order "typing after the preview moved to another page by itself" leaves
 * to chance, fixed. There the first write on the route creates its document,
 * and the editor takes it up either before or after the frame moves by
 * itself. Found in PR #386 CI: when the editor took it up after the move, the
 * frame was sent back to the editor's page. Here the first write's answer is
 * held until the frame has moved and the author has typed, so the editor
 * always takes up the route document after the move. Taking up its own
 * document is the editor completing its address, not the author switching
 * pages: the frame stays where it moved.
 */
test.describe("a route document adopted after the frame moved by itself", () => {
  test.describe.configure({ mode: "serial" });

  let own: ThemeScope | null = null;
  let homeTemplateId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    own = await createThrowawayTheme();
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...own,
    })) as {
      success: boolean;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(result.success, JSON.stringify(result)).toBe(true);
    homeTemplateId = result.data!.templates.find(
      (template) => template.type === "index",
    )!.id;
    const saved = await writeThemeFiles(page, own, FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await page.context().close();
  });

  test.afterAll(async ({ browser }) => {
    if (!own) return;
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(
      page,
      own,
      FILES.map((file) => file.path),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    await page.context().close();
  });

  type StoredTemplate = {
    id: string;
    routePath: string | null;
    document: {
      sections: Array<{ id: string; props?: Record<string, unknown> }>;
    };
  };

  /**
   * The home slot's stored title in the route's own document and in any
   * other, and every stored title of the other page's slot.
   */
  async function storedOn(page: Page) {
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...own!,
    })) as { success: boolean; data?: { templates: StoredTemplate[] } };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const titleIn = (template: StoredTemplate, slot: string) =>
      template.document.sections.find((section) => section.id === slot)?.props
        ?.title;
    const templates = result.data!.templates;
    const route = templates.find(
      (template) => template.routePath === HOME_ROUTE,
    );
    return {
      routeTemplateId: route?.id ?? null,
      route: route ? titleIn(route, SLOT) : undefined,
      elsewhere: templates
        .filter((template) => template !== route)
        .map((template) => titleIn(template, SLOT))
        .filter((title) => title !== undefined),
      other: templates
        .map((template) => titleIn(template, OTHER_SLOT))
        .filter((title) => title !== undefined),
    };
  }

  /** Holds the response of the next section-props write until released. */
  async function holdNextPropsWrite(page: Page) {
    const held = {
      reached: false,
      answered: false,
      release: () => {},
    };
    const released = new Promise<void>((resolve) => {
      held.release = resolve;
    });
    let taken = false;
    await page.route(
      (url) => isServerFn(url.toString(), "updateStorefrontThemeSectionProps"),
      async (route: Route) => {
        if (taken) return route.continue();
        taken = true;
        // The write reaches the server as it is; only its answer waits.
        const response = await route.fetch();
        held.reached = true;
        await released;
        await route.fulfill({ response });
        held.answered = true;
      },
    );
    return held;
  }

  const urlTemplateId = (page: Page) =>
    new URL(page.url()).searchParams.get("templateId");

  test("a route document adopted after the frame moved by itself leaves the frame where it moved", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto(
      `/store/${own!.storefrontId}/themes/${own!.themeId}/editor?templateId=${homeTemplateId}&routePath=${encodeURIComponent(HOME_ROUTE)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(cardTitle(page, SLOT)).toBeVisible({ timeout: 90_000 });
    await enableSelection(page);
    expect(
      await clickExposedElement(page, cardTitle(page, SLOT)),
    ).not.toBeNull();
    await openContentTab(page);
    await expect(titleField(page)).toBeVisible();

    const held = await holdNextPropsWrite(page);
    try {
      // The first write on the route: it creates the route's document, and
      // its answer is held.
      const live = `live ${Date.now()}`;
      await titleField(page).fill(live);
      await expect(cardTitle(page, SLOT)).toHaveText(live);
      await titleField(page).press("Tab");
      await expect.poll(() => held.reached, { timeout: 30_000 }).toBe(true);

      // The frame moves by itself, as a link inside it would.
      await previewFrame(page)
        .locator("body")
        .evaluate((_body, to) => {
          const router = (
            window as unknown as {
              __morphPreviewRouter?: {
                navigate(options: { to: string }): unknown;
              };
            }
          ).__morphPreviewRouter;
          if (!router) throw new Error("the preview exposes no router");
          void router.navigate({ to });
        }, OTHER_PATH);
      await expect(cardTitle(page, OTHER_SLOT)).toBeVisible({
        timeout: 30_000,
      });
      await expect(cardTitle(page, SLOT)).toHaveCount(0);
      const otherBefore = await cardTitle(page, OTHER_SLOT).textContent();

      // The field for the first page's section is still open; the author
      // types into it while the frame shows the other page.
      await expect(titleField(page)).toBeVisible();
      const typed = `typed after navigation ${Date.now()}`;
      await titleField(page).fill(typed);
      await expect(previewFrame(page).getByText(typed)).toHaveCount(0);

      // The order this test is for: the editor has not taken up the route
      // document yet, and the frame has already moved.
      expect(held.answered).toBe(false);
      expect(urlTemplateId(page)).toBe(homeTemplateId);

      // The first answer arrives and the editor takes up the document the
      // server created for this route.
      held.release();
      await expect.poll(() => held.answered, { timeout: 30_000 }).toBe(true);
      const created = (await storedOn(page)).routeTemplateId;
      expect(created).not.toBeNull();
      expect(created).not.toBe(homeTemplateId);
      await expect
        .poll(() => urlTemplateId(page), {
          timeout: 30_000,
          message: "the URL should name the route document the server created",
        })
        .toBe(created);

      // The frame is still where it moved.
      await expect(cardTitle(page, OTHER_SLOT)).toBeVisible();
      await expect(cardTitle(page, SLOT)).toHaveCount(0);
      await expect(cardTitle(page, OTHER_SLOT)).toHaveText(otherBefore ?? "");

      // Leaving the field saves what was typed, to the section it was typed
      // for, in the route's document.
      await titleField(page).press("Tab");
      await expect
        .poll(async () => (await storedOn(page)).route, { timeout: 30_000 })
        .toBe(typed);
      const stored = await storedOn(page);
      expect(stored.routeTemplateId).toBe(created);
      expect(stored.elsewhere).toEqual([]);
      expect(stored.other).toEqual([]);

      // And the frame has still not been sent back.
      await expect(cardTitle(page, OTHER_SLOT)).toBeVisible();
      await expect(cardTitle(page, SLOT)).toHaveCount(0);
    } finally {
      // Never leave the answer waiting, whatever failed above.
      held.release();
    }
  });
});

/**
 * After the first write on a route with no document of its own, the author
 * goes on typing with the real keyboard at the end of the text, with no
 * click anywhere: the field keeps their text, focus and caret across the
 * page taking up the new route document, and what is stored, on the canvas
 * and after a reload is their text plus what they appended. `fill()` would
 * replace the field and hide a field rebuilt on another value. Each value is
 * checked with expect.soft, so one run records all of them. Each test has
 * its own Theme, so they run independently.
 */
test.describe("keyboard append across the page taking up its route document", () => {
  const created: ThemeScope[] = [];

  test.afterAll(async ({ browser }) => {
    if (created.length === 0) return;
    const page = await signedInPage(browser);
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    for (const theme of created) {
      const removed = await removeThemeFiles(
        page,
        theme,
        FILES.map((file) => file.path),
      );
      expect(removed.success, JSON.stringify(removed)).toBe(true);
    }
    await page.context().close();
  });

  type StoredTemplate = {
    id: string;
    routePath: string | null;
    document: {
      sections: Array<{ id: string; props?: Record<string, unknown> }>;
    };
  };

  async function freshTheme(page: Page) {
    const theme = await createThrowawayTheme();
    created.push(theme);
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...theme,
    })) as {
      success: boolean;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const homeTemplateId = result.data!.templates.find(
      (template) => template.type === "index",
    )!.id;
    const saved = await writeThemeFiles(page, theme, FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    return { theme, homeTemplateId };
  }

  async function storedOn(page: Page, theme: ThemeScope) {
    const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
      ...theme,
    })) as { success: boolean; data?: { templates: StoredTemplate[] } };
    expect(result.success, JSON.stringify(result)).toBe(true);
    const titleIn = (template: StoredTemplate) =>
      template.document.sections.find((section) => section.id === SLOT)?.props
        ?.title;
    const templates = result.data!.templates;
    const route = templates.find(
      (template) => template.routePath === HOME_ROUTE,
    );
    return {
      routeTemplateId: route?.id ?? null,
      route: route ? titleIn(route) : undefined,
      elsewhere: templates
        .filter((template) => template !== route)
        .map(titleIn)
        .filter((title) => title !== undefined),
    };
  }

  async function holdNextPropsWrite(page: Page) {
    const held = { reached: false, answered: false, release: () => {} };
    const released = new Promise<void>((resolve) => {
      held.release = resolve;
    });
    let taken = false;
    await page.route(
      (url) => isServerFn(url.toString(), "updateStorefrontThemeSectionProps"),
      async (route: Route) => {
        if (taken) return route.continue();
        taken = true;
        const response = await route.fetch();
        held.reached = true;
        await released;
        await route.fulfill({ response });
        held.answered = true;
      },
    );
    return held;
  }

  const urlTemplateId = (page: Page) =>
    new URL(page.url()).searchParams.get("templateId");

  /** The title field, focus and caret, and whether it is the marked element. */
  async function fieldState(page: Page) {
    const count = await titleField(page).count();
    const field =
      count === 1
        ? await titleField(page).evaluate((input: HTMLInputElement) => {
            const active = document.activeElement as HTMLInputElement | null;
            return {
              value: input.value,
              defaultValue: input.defaultValue,
              marked: input.dataset.appendMark ?? null,
              focused: active === input,
              caret: [
                input.selectionStart,
                input.selectionEnd,
                input.value.length,
              ],
            };
          })
        : null;
    const active = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return element
        ? {
            tag: element.tagName.toLowerCase(),
            slot: element.getAttribute("data-slot"),
            text: (element as HTMLInputElement).value ?? null,
          }
        : null;
    });
    const header = await page
      .locator('[data-slot="inspector-content-field"]')
      .count();
    return {
      fieldCount: count,
      field,
      activeElement: active,
      contentFields: header,
    };
  }

  async function canvasText(page: Page) {
    return (await cardTitle(page, SLOT).count()) === 1
      ? await cardTitle(page, SLOT).textContent()
      : null;
  }

  async function run(page: Page, hold: boolean, label: string) {
    test.setTimeout(300_000);
    const notes: Array<Record<string, unknown>> = [];
    const note = async (step: string, extra: Record<string, unknown> = {}) => {
      const entry = {
        step,
        t: Date.now(),
        url: urlTemplateId(page),
        canvas: await canvasText(page),
        ...(await fieldState(page)),
        ...extra,
      };
      notes.push(entry);
      console.log(`[keyboard-append] ${label} | ${JSON.stringify(entry)}`);
    };
    const writes: string[] = [];
    page.on("request", (request) => {
      if (isServerFn(request.url(), "updateStorefrontThemeSectionProps")) {
        writes.push((request.postData() ?? "").slice(0, 4000));
      }
    });
    const writeTitles = () =>
      writes.map((body) => {
        const match = body.match(/(first|Card default)[^"\\]*/g);
        return match ?? [body.slice(0, 300)];
      });

    // Fixed after the run: serverFn needs a page on the app origin first.
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const { theme, homeTemplateId } = await freshTheme(page);
    let releaseHeld: (() => void) | null = null;
    try {
      await page.goto(
        `/store/${theme.storefrontId}/themes/${theme.themeId}/editor?templateId=${homeTemplateId}&routePath=${encodeURIComponent(HOME_ROUTE)}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible(
        {
          timeout: 45_000,
        },
      );
      await expect(cardTitle(page, SLOT)).toBeVisible({ timeout: 90_000 });
      await enableSelection(page);
      expect(
        await clickExposedElement(page, cardTitle(page, SLOT)),
      ).not.toBeNull();
      await openContentTab(page);
      await expect(titleField(page)).toBeVisible();

      const held = hold ? await holdNextPropsWrite(page) : null;
      releaseHeld = held ? held.release : null;
      const first = `first ${Date.now()}`;
      await titleField(page).click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type(first, { delay: 20 });
      await titleField(page).evaluate((input: HTMLInputElement) => {
        input.dataset.appendMark = "m1";
      });
      await note("typed first with the keyboard, focus kept");
      if (held) {
        await expect.poll(() => held.reached, { timeout: 30_000 }).toBe(true);
      } else {
        await expect
          .poll(() => urlTemplateId(page), { timeout: 30_000 })
          .not.toBe(homeTemplateId);
        await expect
          .poll(async () => (await storedOn(page, theme)).route, {
            timeout: 30_000,
          })
          .toBe(first);
      }
      // While the first save is unanswered the page may or may not have
      // taken up the route document yet; either way the field is the author's.
      await page.waitForTimeout(800);
      await note(
        held ? "first write unanswered" : "after adoption, first answer landed",
        { answered: held ? held.answered : "n/a", writes: writeTitles() },
      );
      const beforeAppend = await fieldState(page);
      expect.soft(beforeAppend.field?.value, "field shows").toBe(first);
      expect.soft(beforeAppend.field?.focused, "focus kept").toBe(true);
      expect
        .soft(beforeAppend.field?.marked, "same input element (not remounted)")
        .toBe("m1");

      // No click: End, then type, as a keyboard does.
      await page.keyboard.press("End");
      await page.keyboard.type(" more", { delay: 30 });
      await page.waitForTimeout(800);
      await note("End + ' more' with no click", { writes: writeTitles() });
      const expected = `${first} more`;

      if (held) {
        held.release();
        await expect.poll(() => held.answered, { timeout: 30_000 }).toBe(true);
        await expect
          .poll(() => urlTemplateId(page), { timeout: 30_000 })
          .not.toBe(homeTemplateId);
        await page.waitForTimeout(800);
        const afterAdoption = await fieldState(page);
        await note("after the answer and adoption", { writes: writeTitles() });
        expect
          .soft(afterAdoption.field?.value, "field after adoption")
          .toBe(expected);
        expect
          .soft(afterAdoption.field?.focused, "focus after adoption")
          .toBe(true);
        expect
          .soft(afterAdoption.field?.marked, "same input after adoption")
          .toBe("m1");
      }
      await page.waitForTimeout(1_500);
      await note("after the first answer", { writes: writeTitles() });
      await page.keyboard.press("Tab");
      await page.waitForTimeout(3_000);
      const stored = await storedOn(page, theme);
      await note("after Tab and 3 s", {
        stored,
        writes: writeTitles(),
        saveStatus: await page
          .locator("[data-editor-save-status]")
          .first()
          .getAttribute("aria-label")
          .catch(() => null),
      });
      expect.soft(writeTitles().at(-1)?.[0], "last write sent").toBe(expected);
      expect.soft(stored.route, "stored").toBe(expected);
      expect.soft(stored.elsewhere, "stored elsewhere").toEqual([]);
      expect.soft(await canvasText(page), "canvas").toBe(expected);
      expect
        .soft((await fieldState(page)).field?.value, "field")
        .toBe(expected);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(cardTitle(page, SLOT)).toBeVisible({ timeout: 90_000 });
      await page.waitForTimeout(1_500);
      const storedAfterReload = await storedOn(page, theme);
      await enableSelection(page);
      await clickExposedElement(page, cardTitle(page, SLOT));
      await openContentTab(page);
      await page.waitForTimeout(800);
      await note("after reload, element re-selected", {
        stored: storedAfterReload,
      });
      expect.soft(await canvasText(page), "canvas after reload").toBe(expected);
      expect
        .soft((await fieldState(page)).field?.value, "field after reload")
        .toBe(expected);
    } finally {
      // Never leave the answer waiting, whatever failed above.
      releaseHeld?.();
      const fs = await import("node:fs");
      fs.writeFileSync(
        test.info().outputPath("keyboard-append-notes.json"),
        JSON.stringify({ label, notes, writes }, null, 2),
      );
    }
  }

  test("typed on while the first save is unanswered", async ({ page }) => {
    await run(page, true, "inflight");
  });

  test("typed on after the first answer has landed", async ({ page }) => {
    await run(page, false, "landed");
  });
});
