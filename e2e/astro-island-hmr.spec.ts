import { randomUUID } from "node:crypto";

import { expect, test, type Frame, type Page } from "@playwright/test";

import { EDITOR_PATH } from "./helpers";
import { editAndSave, nextFileSave, readSource } from "./helpers/editor-writes-paused";
import { THEMES, serverFn, storefrontHarness } from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
  type ThemeScope,
} from "./native-compat";

/**
 * An Astro site's React island, edited in Code, updates in place in the
 * Live Preview (docs/astro-theme-plan.md 3.6.2.5): new text, the same page,
 * and the island's state kept.
 *
 * The edit goes through the editor's own Code save. That save is what tells
 * the page a write landed, and only then does the page pull the hot update
 * from the preview's HMR relay; writing the file with a server function
 * leaves the page as it was, which says nothing about the island.
 *
 * Runs on a Theme of its own holding only Astro files, so the dev server
 * sees a plain Astro project rather than Astro files beside the Start
 * Starter's components.
 *
 * Container transport only, with `MORPH_ASTRO_THEMES=1`.
 */
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this writes the run's own D1.",
);
test.skip(
  process.env.E2E_EXPECT_PREVIEW_TRANSPORT !== "cloudflare-sandbox",
  "The Astro dev server runs in the Sandbox container; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);
test.skip(
  process.env.MORPH_ASTRO_THEMES !== "1",
  "Astro is previewed only where the server sets MORPH_ASTRO_THEMES=1.",
);

const PREVIEW = "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";
const THEME_FILES = "/src/server/storefront/storefront-theme-files.serverFn.ts";
const COUNTER = "src/islands/Counter.jsx";
const counter = (label: string) => `import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button className="counter" type="button" onClick={() => setCount(count + 1)}>
      ${label} {count}
    </button>
  );
}
`;
const FILES = [
  {
    path: "astro.config.mjs",
    content: `import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  integrations: [react()],
});
`,
  },
  { path: COUNTER, content: counter("count") },
  {
    // The canvas opens at `/`. The island is centred: the frame is wider
    // than the visible canvas, and its left edge sits under the editor's
    // sidebar, where a click would land instead.
    path: "src/pages/index.astro",
    content: `---
import Counter from "../islands/Counter.jsx";
export const prerender = false;
---
<html><head><title>island</title></head><body>
<main id="island" style="display:flex;justify-content:center;padding:48px"><Counter client:load /></main>
</body></html>
`,
  },
];

let scope: ThemeScope | null = null;
let editorPath: string | null = null;

/** The preview's frame, once its island has hydrated. */
async function hydratedFrame(page: Page): Promise<Frame> {
  const iframe = page.locator("iframe").first();
  await expect(iframe).toBeVisible({ timeout: 180_000 });
  const host = new URL((await iframe.getAttribute("src"))!).hostname;
  let frame: Frame | null = null;
  await expect
    .poll(
      async () => {
        frame = page.frame({ url: (url) => url.hostname === host });
        if (!frame) return false;
        return frame
          .evaluate(
            () =>
              Boolean(document.querySelector("#island .counter")) &&
              !document.querySelector("astro-island[ssr]"),
          )
          .catch(() => false);
      },
      { timeout: 240_000 },
    )
    .toBe(true);
  return frame!;
}

test.describe("an Astro island edited in Code", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(15 * 60_000);
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR
    ? storefrontHarness({
        scope: themeScopeFromEditorPath(EDITOR_PATH!),
        stateDir: STATE_DIR,
      })
    : null;

  test.beforeAll(async ({ browser }) => {
    const { baseURL, storageState } = test.info().project.use;
    const context = await browser.newContext({ baseURL, storageState });
    const page = await context.newPage();
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    scope = { ...themeScopeFromEditorPath(EDITOR_PATH!), themeId: randomUUID() };
    const now = new Date().toISOString();
    expect(
      await harness!.writeD1(
        `INSERT INTO storefront_themes
           (id, storefront_id, name, metadata, framework, created_at, updated_at)
         VALUES (?1, ?2, ?3, '{"starterTemplateVersion":1}', 'astro', ?4, ?4)`,
        scope.themeId,
        scope.storefrontId,
        `astro-island-hmr-${scope.themeId}`,
        now,
      ),
    ).toBe(1);
    // Opening the Theme gives it the Start Starter's files and its templates
    // (as preview-error-recovery.spec.ts does); the Astro files then replace
    // every Starter file.
    const editor = (await serverFn(page, THEMES, "getStorefrontThemeEditor", scope)) as {
      success: boolean;
      data?: { templates: Array<{ id: string; type: string }> };
    };
    expect(editor.success, JSON.stringify(editor)).toBe(true);
    const home = editor.data!.templates.find((template) => template.type === "index");
    expect(home).toBeDefined();
    editorPath = `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${home!.id}`;
    const saved = await writeThemeFiles(page, scope, FILES);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const listed = (await serverFn(page, THEME_FILES, "listStorefrontThemeFiles", scope)) as {
      success: boolean;
      data: { files: Array<{ path: string }>; binaryFiles: Array<{ path: string }> };
    };
    expect(listed.success, JSON.stringify(listed)).toBe(true);
    const own = new Set(FILES.map((file) => file.path));
    const starter = [...listed.data.files, ...listed.data.binaryFiles]
      .map((file) => file.path)
      .filter((path) => !own.has(path));
    const removed = await removeThemeFiles(page, scope, starter);
    expect(removed.success, JSON.stringify(removed)).toBe(true);
    const left = (await serverFn(page, THEME_FILES, "listStorefrontThemeFiles", scope)) as typeof listed;
    expect(
      [...left.data.files, ...left.data.binaryFiles].map((file) => file.path).sort(),
    ).toEqual([...own].sort());
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    if (scope) {
      const page = await browser.newPage();
      await page.goto("/", { waitUntil: "domcontentloaded" });
      // The Theme is this run's own and is left as it is: removing its last
      // files is refused (EMPTY_THEME_WORKSPACE), and nothing else reads it.
      await serverFn(page, PREVIEW, "stopThemePreviewServer", scope).catch(() => {});
      await page.close();
    }
    await harness?.dispose();
  });

  test("shows the new source in place and keeps the island's state", async ({ page }) => {
    await page.goto(editorPath!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    const frame = await hydratedFrame(page);
    // Still only the Astro files once the editor has opened the Theme.
    const files = (await serverFn(page, THEME_FILES, "listStorefrontThemeFiles", scope)) as {
      data: { files: Array<{ path: string }>; binaryFiles: Array<{ path: string }> };
    };
    expect(
      [...files.data.files, ...files.data.binaryFiles].map((file) => file.path).sort(),
    ).toEqual(FILES.map((file) => file.path).sort());
    const button = frame.locator("#island .counter");
    await expect(button).toHaveText("count 0");
    // The editor may open its page search on its own; over the canvas it
    // takes the clicks meant for the island.
    await expect(async () => {
      if (await page.getByRole("dialog").count()) await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });

    // State the edit must not reset: a count other than the initial one.
    for (let click = 0; click < 3; click++) await button.click();
    await expect(button).toHaveText("count 3");
    // Gone if the page reloads.
    await frame.evaluate(() => {
      (window as unknown as { __islandPageKept: boolean }).__islandPageKept = true;
    });

    // Code, the editor's own way in, once its workspace is showing.
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(
      page
        .locator(".monaco-editor")
        .first()
        .or(page.getByText("Select a file from the explorer to begin editing.")),
    ).toBeVisible({ timeout: 30_000 });
    await page.locator("span.truncate", { hasText: /^Counter\.jsx$/ }).first().click();
    await expect
      .poll(() => readSource(page, COUNTER).catch(() => null), { timeout: 30_000 })
      .toBe(counter("count"));
    const saved = nextFileSave(page, COUNTER);
    await editAndSave(page, COUNTER, counter("clicks"));
    expect(await saved, "the island's edit was saved").toBe(true);

    // The new text with the old count: the module was replaced and the
    // component kept its state.
    await expect(button).toHaveText("clicks 3", { timeout: 90_000 });
    expect(
      await frame.evaluate(
        () => (window as unknown as { __islandPageKept?: boolean }).__islandPageKept === true,
      ),
      "the page was updated in place, not reloaded",
    ).toBe(true);
  });
});
