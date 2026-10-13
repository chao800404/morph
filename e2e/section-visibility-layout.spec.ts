import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { EDITOR_PATH, previewFrame } from "./helpers";
import { THEMES, publishShowingRelease, serverFn } from "./native-acceptance";
import { themeScopeFromEditorPath, themeSourceGeneration, type ThemeScope } from "./native-compat";

/**
 * A Header the layout Document marks hidden stays hidden on every load.
 *
 * Hiding a layout section drops its stored values and lists it in
 * `hiddenSlots`, but the Starter layout rendered
 * `<Header {...content("starter-header")} />` without asking
 * `isSectionHidden`: the next load — Live Preview or the published site —
 * showed the Header again, with the component's defaults in place of the
 * author's values.
 *
 * The hide is written through `updateStorefrontThemeSectionProps`, the write
 * the editor's section toggle ends in. The Sections panel shows the layout's
 * Header and Footer as Global page roots, which have no Hide control of their
 * own, so a hidden layout section reaches a Document some other way (an
 * earlier editor that listed them as ordinary rows, or a write through the
 * same server function).
 *
 *   1. hide, then reload: still hidden, and the Document says so (any
 *      transport);
 *   2. publish with the Header and Footer hidden: the served release renders
 *      neither, and the public content answer carries none of their values;
 *      shown again and republished, both come back with the author's values
 *      (container transport only, since the build runs in the Sandbox
 *      container). The bridge's stylesheet only covers the live canvas; this
 *      is what checks the release itself.
 *
 * Runs on a Theme of its own, inserted into the runner-owned database, so a
 * run that stops halfway cannot leave the shared Theme's Header hidden. Named
 * to run after native-compat-published.spec.ts, which needs a storefront that
 * has never been published.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const HEADER = "starter-header";
const FOOTER = "starter-footer";
// The author's values, which no component default can produce: seeing one
// proves the Document reached the component, not seeing it proves nothing did.
const STORE_NAME = `Store ${randomUUID()}`;
const COPYRIGHT = `Copyright ${randomUUID()}`;

let scope: ThemeScope | null = null;
let editorPath: string | null = null;

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
      'section-visibility-${created.themeId}', '{"starterTemplateVersion":1}',
      '${now}', '${now}');`,
  ]);
  return created;
}

async function signedInPage(browser: Browser) {
  const { baseURL, storageState } = test.info().project.use;
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}

const slot = (page: Page, id: string) =>
  previewFrame(page).locator(`[data-storefront-section-id="${id}"]`);

type LayoutTemplate = {
  id: string;
  type: string;
  draftGeneration: number;
  document: {
    sections: Array<{
      id: string;
      enabled?: boolean;
      props?: Record<string, unknown>;
    }>;
  };
};

/** The layout Document, read back from the server. */
async function layoutTemplate(page: Page): Promise<LayoutTemplate> {
  const result = (await serverFn(page, THEMES, "getStorefrontThemeEditor", {
    ...scope!,
  })) as { success: boolean; data?: { templates: LayoutTemplate[] } };
  expect(result.success, JSON.stringify(result)).toBe(true);
  const layout = result.data!.templates.find(
    (template) => template.type === "layout",
  );
  expect(layout, "the Theme has a layout Document").toBeDefined();
  return layout!;
}

const stored = async (page: Page, sectionId: string) =>
  (await layoutTemplate(page)).document.sections.find(
    (section) => section.id === sectionId,
  );

/** Writes a layout section's values the way the editor's section writes do. */
async function writeSlot(
  page: Page,
  sectionId: string,
  props: Record<string, unknown>,
) {
  const layout = await layoutTemplate(page);
  const written = (await serverFn(
    page,
    THEMES,
    "updateStorefrontThemeSectionProps",
    {
      ...scope!,
      templateId: layout.id,
      sectionId,
      props,
      expectedDraftGeneration: layout.draftGeneration,
      expectedSourceGeneration: await themeSourceGeneration(page,scope!),
    },
  )) as { success: boolean; message?: string };
  expect(written.success, written.message).toBe(true);
}

/** Opens the editor on this spec's Theme and waits for the layout to render. */
async function openEditor(page: Page) {
  await page.goto(editorPath!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  // The page's own content, which this spec never hides, says the route has
  // rendered inside the layout whether or not the Header or Footer is there.
  await expect(previewFrame(page).locator("main").first()).toBeVisible({
    timeout: 90_000,
  });
  // The toolbar renders before the page hydrates; a click in that window is
  // received by nothing.
  await page.waitForTimeout(2_000);
}

test.describe("a hidden layout section", () => {
  test.describe.configure({ mode: "serial" });
  // Publishing builds the whole workspace in a container.
  test.setTimeout(12 * 60_000);

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
    await page.context().close();
  });

  test("hide the Header, reload: still hidden", async ({ page }) => {
    // Values of the author's first, so the hidden Header cannot pass for one
    // that merely lost them: neither they nor the component's defaults may
    // show.
    await openEditor(page);
    await writeSlot(page, HEADER, { storeName: STORE_NAME });
    await writeSlot(page, FOOTER, { copyrightText: COPYRIGHT });
    await openEditor(page);
    await expect(slot(page, HEADER).locator("header")).toBeVisible();
    await expect(previewFrame(page).getByText(STORE_NAME)).toBeVisible();
    await expect(
      previewFrame(page).getByText("Cart (0)", { exact: true }),
    ).toBeVisible();

    // The editor's live section toggle sets `hidden` on a wrapper whose
    // inline style is `display: contents`, which beats the browser's own
    // [hidden] rule. The Starter's Tailwind preflight overrides it; the
    // editor's stylesheet has to do so on its own, for a Theme without
    // Tailwind. Checked with every other stylesheet switched off.
    const editorSheetOnly = await previewFrame(page)
      .locator("body")
      .evaluate((body) => {
        const editorSheet = document.querySelector(
          "style[data-storefront-editor-selection]",
        ) as HTMLStyleElement | null;
        const others = [...document.styleSheets].filter(
          (sheet) => sheet.ownerNode !== editorSheet && !sheet.disabled,
        );
        const probe = document.createElement("div");
        probe.setAttribute("data-storefront-section-id", "visibility-probe");
        probe.setAttribute("style", "display: contents");
        probe.hidden = true;
        probe.innerHTML = "<p>probe</p>";
        body.appendChild(probe);
        for (const sheet of others) sheet.disabled = true;
        try {
          return {
            editorSheet: Boolean(editorSheet),
            display: getComputedStyle(probe).display,
            childBoxes: probe.firstElementChild!.getClientRects().length,
          };
        } finally {
          for (const sheet of others) sheet.disabled = false;
          probe.remove();
        }
      });
    expect(editorSheetOnly).toEqual({
      editorSheet: true,
      display: "none",
      childBoxes: 0,
    });

    await writeSlot(page, HEADER, { enabled: false });
    expect((await stored(page, HEADER))?.enabled).toBe(false);

    // A fresh load renders from the Document alone. The always-visible
    // layout rendered the Header here again, with "Cart (0)" and "Online
    // Store" from the component's defaults.
    await openEditor(page);
    await expect(slot(page, HEADER)).toHaveCount(0);
    await expect(previewFrame(page).locator("header")).toHaveCount(0);
    await expect(
      previewFrame(page).getByText("Cart (0)", { exact: true }),
    ).toHaveCount(0);
    await expect(previewFrame(page).getByText(STORE_NAME)).toHaveCount(0);
  });

  test("publish: hidden stays hidden, shown again comes back", async ({
    page,
  }) => {
    test.skip(
      TRANSPORT !== "cloudflare-sandbox",
      "Publishing builds in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
    );
    await openEditor(page);
    expect((await stored(page, HEADER))?.enabled).toBe(false);
    await writeSlot(page, FOOTER, { enabled: false });
    expect((await stored(page, FOOTER))?.enabled).toBe(false);
    await openEditor(page);
    await expect(slot(page, FOOTER)).toHaveCount(0);

    const hidden = await publishShowingRelease(page);
    try {
      const home = await hidden.fetch("/");
      expect(home.status).toBe(200);
      // The page itself rendered, inside the layout.
      expect(home.body).toContain("<main");
      // Neither layout section did: not the author's values, not the
      // components' defaults.
      expect(home.body).not.toContain("<header");
      expect(home.body).not.toContain("<footer");
      expect(home.body).not.toContain("Cart (0)");
      expect(home.body).not.toContain("© Online Store");
      expect(home.body).not.toContain(STORE_NAME);
      expect(home.body).not.toContain(COPYRIGHT);

      // The public content answer lists both as hidden and carries none of
      // their values.
      const content = await hidden.fetch("/_morph/content?path=%2F");
      expect(content.status).toBe(200);
      const answer = JSON.parse(content.body) as {
        slots: Record<string, unknown>;
        hiddenSlots: string[];
      };
      expect(answer.hiddenSlots).toEqual(
        expect.arrayContaining([HEADER, FOOTER]),
      );
      expect(Object.keys(answer.slots)).not.toContain(HEADER);
      expect(Object.keys(answer.slots)).not.toContain(FOOTER);
      expect(content.body).not.toContain(STORE_NAME);
      expect(content.body).not.toContain(COPYRIGHT);
    } finally {
      await hidden.close();
    }

    // Shown again: the values the author stored before hiding are still in
    // the Document, and the next release renders them.
    await writeSlot(page, HEADER, { enabled: true });
    await writeSlot(page, FOOTER, { enabled: true });
    await openEditor(page);
    const shown = await publishShowingRelease(page);
    try {
      const home = await shown.fetch("/");
      expect(home.status).toBe(200);
      expect(home.body).toContain("<header");
      expect(home.body).toContain("<footer");
      expect(home.body).toContain(STORE_NAME);
      expect(home.body).toContain(COPYRIGHT);

      const content = await shown.fetch("/_morph/content?path=%2F");
      expect(content.status).toBe(200);
      const answer = JSON.parse(content.body) as {
        slots: Record<string, Record<string, unknown>>;
        hiddenSlots: string[];
      };
      expect(answer.hiddenSlots).not.toContain(HEADER);
      expect(answer.hiddenSlots).not.toContain(FOOTER);
      expect(answer.slots[HEADER]?.storeName).toBe(STORE_NAME);
      expect(answer.slots[FOOTER]?.copyrightText).toBe(COPYRIGHT);
    } finally {
      await shown.close();
    }
  });
});
