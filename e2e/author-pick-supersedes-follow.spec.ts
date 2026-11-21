import { expect, test, type Browser, type Page } from "@playwright/test";
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
 * An explicit page pick replaces a route request the frame has left behind.
 *
 * The frame goes to a page by itself and the editor follows: its frame-follow
 * set-route for that page is held inside the frame, unanswered. The frame then
 * goes back by its own history. The author picks, in the page list, the page
 * the editor shows. That pick takes the frame back to the page; the late
 * answer to the held request, released afterwards, does not take the canvas
 * away from it; and an edit there is saved exactly once.
 *
 * Full Start only: the frame's own history is the browser history there, as
 * in history-back-controlled-repro.spec.ts.
 */
test.skip(
  !EDITOR_PATH ||
    !process.env.MORPH_E2E_STATE_DIR ||
    process.env.MORPH_E2E_PREVIEW_RUNTIME !== "start",
  "Needs the runner-owned throwaway store and full Start preview runtime (MORPH_E2E_PREVIEW_RUNTIME=start).",
);

const HOME_ROUTE = "/author-pick-home";
const DETAIL_ROUTE = "/author-pick-detail";
const HOME_SLOT = "author-pick-home-card";
const DETAIL_SLOT = "author-pick-detail-card";

const FILES = [
  {
    path: "src/routes/author-pick-home.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import PickCard from "../components/PickCard";

export const Route = createFileRoute("${HOME_ROUTE}")({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <main>
      <PickCard {...content("${HOME_SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/routes/author-pick-detail.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import PickCard from "../components/PickCard";

export const Route = createFileRoute("${DETAIL_ROUTE}")({
  component: DetailRoute,
});

function DetailRoute() {
  return (
    <main>
      <PickCard {...content("${DETAIL_SLOT}")} />
    </main>
  );
}
`,
  },
  {
    path: "src/components/PickCard.tsx",
    content: `export const contentFields = {
  title: { type: "text", label: "Card title" },
} as const;

type PickCardProps = { title?: string };

export default function PickCard({ title = "Card default" }: PickCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  },
];

let own: ThemeScope | null = null;
let homeTemplateId: string | null = null;

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

function createThrowawayTheme(): ThemeScope {
  const created = {
    ...themeScopeFromEditorPath(EDITOR_PATH!),
    themeId: randomUUID(),
  };
  const now = new Date().toISOString();
  execLocalD1(`INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, created_at, updated_at)
    VALUES ('${created.themeId}', '${created.storefrontId}',
      'author-pick-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`);
  return created;
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

/** The title stored for a slot, in whichever document holds it. */
async function storedTitle(page: Page, slot: string): Promise<unknown> {
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...own!,
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

const routePathOf = (page: Page) =>
  new URL(page.url()).searchParams.get("routePath");

const framePathname = (page: Page) =>
  previewFrame(page)
    .locator("body")
    .evaluate(() => window.location.pathname);

test.describe("an author pick replaces a frame-follow request the frame left", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      own = createThrowawayTheme();
      const result = (await serverFn(
        page,
        THEMES,
        "getStorefrontThemeEditor",
        { ...own },
      )) as {
        success: boolean;
        data?: { templates: Array<{ id: string; type: string }> };
      };
      expect(result.success, JSON.stringify(result)).toBe(true);
      homeTemplateId = result.data!.templates.find(
        (template) => template.type === "index",
      )!.id;
      const saved = await writeThemeFiles(page, own, FILES);
      expect(saved.success, JSON.stringify(saved)).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(240_000);
    if (!own) return;
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      const removed = await removeThemeFiles(
        page,
        own,
        FILES.map((file) => file.path),
      );
      expect(removed.success, JSON.stringify(removed)).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  test("the late answer to the old request leaves the canvas on the picked page, and an edit there is saved once", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const writeBodies: string[] = [];
    page.on("request", (request) => {
      if (isServerFn(request.url(), "updateStorefrontThemeSectionProps")) {
        writeBodies.push(request.postData() ?? "");
      }
    });

    // Inside the frame: hold the first frame-follow set-route for the
    // detail page, once armed, until the test releases it.
    await page.addInitScript((detailRoute) => {
      if (window === window.top) return;
      const w = window as unknown as Record<string, any>;
      w.__morphHoldFollow = false;
      w.__morphHeldSetRoutes = [];
      w.__morphSetRoutes = [];
      window.addEventListener(
        "message",
        (event: MessageEvent) => {
          if (event.data?.type !== "morph:storefront-preview-set-route") return;
          const held =
            w.__morphHoldFollow === true &&
            event.data?.navigationIntent === "frame-follow" &&
            event.data?.routePath === detailRoute;
          w.__morphSetRoutes.push({
            routePath: event.data?.routePath ?? null,
            routeRequestId: event.data?.routeRequestId ?? null,
            navigationIntent: event.data?.navigationIntent ?? null,
            held,
          });
          if (!held) return;
          w.__morphHoldFollow = false;
          event.stopImmediatePropagation();
          w.__morphHeldSetRoutes.push({
            data: event.data,
            origin: event.origin,
            source: event.source,
          });
        },
        true,
      );
      w.__morphReleaseHeldSetRoutes = () => {
        const held = w.__morphHeldSetRoutes.splice(0);
        for (const item of held) {
          window.dispatchEvent(
            new MessageEvent("message", {
              data: item.data,
              origin: item.origin,
              source: item.source,
            }),
          );
        }
        return held.length;
      };
    }, DETAIL_ROUTE);

    await page.goto(
      `/store/${own!.storefrontId}/themes/${own!.themeId}/editor?templateId=${homeTemplateId}&routePath=${encodeURIComponent(HOME_ROUTE)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(cardTitle(page, HOME_SLOT)).toBeVisible({ timeout: 90_000 });

    const frameBody = previewFrame(page).locator("body");
    const setRoutes = () =>
      frameBody.evaluate(
        () =>
          (window as unknown as Record<string, any>).__morphSetRoutes as Array<{
            routePath: string | null;
            routeRequestId: number | null;
            navigationIntent: string | null;
            held: boolean;
          }>,
      );

    let released = false;
    const release = async () => {
      if (released) return 0;
      released = true;
      return frameBody.evaluate(() =>
        (window as unknown as Record<string, any>).__morphReleaseHeldSetRoutes(),
      );
    };

    try {
      // The frame goes to the detail page by itself; the editor follows,
      // and its frame-follow set-route is held, unanswered.
      await frameBody.evaluate(() => {
        (window as unknown as Record<string, any>).__morphHoldFollow = true;
      });
      await frameBody.evaluate((_body, to) => {
        const router = (
          window as unknown as {
            __morphPreviewRouter?: { navigate(options: { to: string }): unknown };
          }
        ).__morphPreviewRouter;
        if (!router) throw new Error("the preview exposes no router");
        void router.navigate({ to });
      }, DETAIL_ROUTE);
      await expect(cardTitle(page, DETAIL_SLOT)).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(() => routePathOf(page), { timeout: 30_000 })
        .toBe(DETAIL_ROUTE);
      await expect
        .poll(
          async () => (await setRoutes()).filter((entry) => entry.held).length,
          { timeout: 30_000 },
        )
        .toBe(1);

      // The frame goes back by its own history. The editor stays on the
      // detail page: its latest request is unanswered.
      await frameBody.evaluate(() => window.history.back());
      await expect(cardTitle(page, HOME_SLOT)).toBeVisible({ timeout: 30_000 });
      await expect(cardTitle(page, DETAIL_SLOT)).toHaveCount(0);
      expect(await framePathname(page)).toBe(HOME_ROUTE);
      expect(routePathOf(page)).toBe(DETAIL_ROUTE);

      // The author picks the page the editor shows: the frame is taken
      // back to it, by an author set-route.
      await page.locator(`button[title="Preview ${DETAIL_ROUTE}"]`).click();
      await expect(cardTitle(page, DETAIL_SLOT)).toBeVisible({
        timeout: 30_000,
      });
      await expect(cardTitle(page, HOME_SLOT)).toHaveCount(0);
      expect(await framePathname(page)).toBe(DETAIL_ROUTE);
      const afterPick = await setRoutes();
      expect(
        afterPick.filter(
          (entry) =>
            !entry.held &&
            entry.navigationIntent === "author" &&
            entry.routePath === DETAIL_ROUTE,
        ).length,
        JSON.stringify(afterPick),
      ).toBeGreaterThanOrEqual(1);

      // The late answer to the old request: released now, it does not take
      // the canvas or the editor anywhere.
      expect(await release()).toBe(1);
      await page.waitForTimeout(1_500);
      await expect(cardTitle(page, DETAIL_SLOT)).toBeVisible();
      await expect(cardTitle(page, HOME_SLOT)).toHaveCount(0);
      expect(await framePathname(page)).toBe(DETAIL_ROUTE);
      expect(routePathOf(page)).toBe(DETAIL_ROUTE);
    } finally {
      // Never leave the request held, whatever failed above.
      await release().catch(() => 0);
    }

    // Back on the picked page: an edit is saved exactly once.
    const selecting = page.getByRole("button", {
      name: "Disable section selection",
    });
    if (!(await selecting.isVisible())) await enableSelection(page);
    await expect(selecting).toBeVisible();
    expect(
      await clickExposedElement(page, cardTitle(page, DETAIL_SLOT)),
    ).not.toBeNull();
    await openContentTab(page);
    await expect(titleField(page)).toBeVisible();

    expect(writeBodies).toHaveLength(0);
    const value = `picked page ${Date.now()}`;
    await titleField(page).fill(value);
    await expect(cardTitle(page, DETAIL_SLOT)).toHaveText(value, {
      timeout: 30_000,
    });
    await titleField(page).press("Tab");
    await expect
      .poll(() => storedTitle(page, DETAIL_SLOT), { timeout: 30_000 })
      .toBe(value);
    await expect(page.getByText(/Preview syncing/)).toHaveCount(0, {
      timeout: 30_000,
    });
    // Nothing more is written after a settle.
    await page.waitForTimeout(2_000);
    expect(writeBodies).toHaveLength(1);
    expect(await storedTitle(page, HOME_SLOT)).toBeUndefined();
    expect(routePathOf(page)).toBe(DETAIL_ROUTE);
    expect(await framePathname(page)).toBe(DETAIL_ROUTE);
  });
});
