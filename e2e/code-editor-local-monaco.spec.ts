import { expect, test, type Page, type Route } from "@playwright/test";
import { EDITOR_PATH, isServerFunctionCall } from "./helpers";
import {
  MONACO_RUNTIME_PATH,
  readMonacoModel,
} from "./helpers/monaco-models";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";

/**
 * Code mode's editor comes from Morph itself, not from a CDN.
 *
 * A main CI run once failed because `@monaco-editor/react` fetched Monaco from
 * jsDelivr at runtime and the request hung: the editor stayed on "Loading..."
 * and nothing said why. Monaco is now bundled and loaded on demand, with its
 * workers, CSS and codicon font served from the same origin. These cases run
 * with every request to any other origin aborted, so a dependency on another
 * host fails here rather than on someone's slow network; and they hold or
 * abort Morph's own Monaco runtime to show the editor says so instead of
 * loading forever: a held request can be retried and recovers; a failed one
 * cannot be fetched again in the same page, and the editor says a reload is
 * needed.
 *
 * The preview frame may be served from another local origin; it is blocked
 * too, which Code mode does not need.
 */
// Environment gate, as in every editor spec: without the runner's
// disposable store (E2E_EDITOR_PATH) there is nothing to open. CI sets it on
// every shard; that this file ran is shown per test by the shard's JSON report
// (editor-e2e-results-<shard>-attempt-<n>/shard-<shard>.json), not by this line.
test.skip(!EDITOR_PATH, "Requires the disposable editor store.");

const PATH = "src/e2e-local-monaco.ts";
const SOURCE = "export const offlineValue: number = 1;\n";

/** Every request to another origin is aborted and listed. */
async function blockOtherOrigins(page: Page, origin: string) {
  const blocked: string[] = [];
  await page.context().route("**/*", (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.fallback();
    blocked.push(url);
    return route.abort("blockedbyclient");
  });
  return blocked;
}

/** The Monaco-related requests the page made, by URL. */
function recordMonacoRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/monaco|codicon|\.worker/i.test(url)) urls.push(url);
  });
  return urls;
}

/** Opens the editor page and the test file in Code, without the preview. */
async function openFileInCode(page: Page) {
  await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  const row = page.locator(`[data-file-tree-file="${PATH}"]`);
  // A click before hydration is received by nothing; clicked until Code mode
  // is actually showing its tree.
  await expect(async () => {
    await page.getByRole("button", { name: /^Code$/ }).click();
    await expect(row).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await row.click();
}

const editorLoad = (page: Page) => page.locator("[data-code-editor-load]");

test.describe("Code mode's bundled Monaco", () => {
  const scope = () => themeScopeFromEditorPath(EDITOR_PATH!);

  test.beforeEach(async ({ page }) => {
    // Any editor document serves the server function module the write uses.
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    expect(
      (await writeThemeFiles(page, scope(), [{ path: PATH, content: SOURCE }]))
        .success,
    ).toBe(true);
  });

  test.afterEach(async ({ page }) => {
    const context = page.context();
    await context.unrouteAll({ behavior: "ignoreErrors" });
    // Closed first, so an autosave of a draft it still holds cannot move the
    // source generation under the removal.
    await page.close();
    const cleanup = await context.newPage();
    await cleanup.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect(async () => {
      expect((await removeThemeFiles(cleanup, scope(), [PATH])).success).toBe(
        true,
      );
    }).toPass({ timeout: 30_000 });
    await cleanup.close();
  });

  test("edits, undoes, saves and type-checks with every other origin blocked", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const origin = new URL(baseURL!).origin;
    const blocked = await blockOtherOrigins(page, origin);
    const monacoRequests = recordMonacoRequests(page);

    await openFileInCode(page);
    await expect(page.locator(".monaco-editor").first()).toBeVisible({
      timeout: 45_000,
    });
    await expect
      .poll(() => readMonacoModel(page, `/${PATH}`), { timeout: 30_000 })
      .toBe(SOURCE);

    // Editing, then undoing and redoing it, through the keyboard as an author
    // does. One word, so Monaco holds it as one undo step. Each step is read
    // back at once (Monaco applies undo synchronously) rather than polled,
    // and no further round is taken: the workspace autosaves a draft shortly
    // after edits settle, and the save formats the file, an edit of its own
    // that would then be the next undo (seen on a loaded machine).
    const marker = "offlineUndoMarker";
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(marker);
    expect(await readMonacoModel(page, `/${PATH}`)).toContain(marker);
    await page.keyboard.press("Control+z");
    expect(await readMonacoModel(page, `/${PATH}`)).not.toContain(marker);
    await page.keyboard.press("Control+y");
    expect(await readMonacoModel(page, `/${PATH}`)).toContain(marker);

    // A type error only the TypeScript worker can find: its diagnostic is
    // the proof the worker started from this origin.
    // (Completion is not used as the proof: TypeScript completion in Code
    // mode stays on "Loading..." on main too, with the CDN build and the
    // network open, measured 90 s in both. That is its own defect.)
    //
    // The save is the workspace's autosave or Ctrl+S, whichever goes first:
    // either way the one write path, waited for from before the edit.
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isServerFunctionCall(response.url(), "saveStorefrontThemeFile") &&
        (response.request().postData() ?? "").includes("offlineBroken"),
      { timeout: 60_000 },
    );
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\nexport const offlineBroken: string = 42;");
    await expect(
      page.locator(".monaco-editor .squiggly-error").first(),
    ).toBeAttached({ timeout: 45_000 });

    // The find widget draws codicons, so the font is requested.
    await page.keyboard.press("Control+f");
    await expect(page.locator(".monaco-editor .find-widget")).toBeVisible();
    await expect
      .poll(() => monacoRequests.some((url) => /codicon/.test(url)), {
        timeout: 15_000,
      })
      .toBe(true);
    await page.keyboard.press("Escape");

    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.press("Control+s");
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("Theme file saved");
    const stored = () =>
      page.evaluate(
        async ({ module, scope, path }) => {
          const fns = await import(/* @vite-ignore */ module);
          const listed = await fns.listStorefrontThemeFiles({ data: scope });
          return listed.data.files.find(
            (file: { path: string }) => file.path === path,
          )?.content as string | undefined;
        },
        {
          module: "/src/server/storefront/storefront-theme-files.serverFn.ts",
          scope: scope(),
          path: PATH,
        },
      );
    await expect
      .poll(stored, { timeout: 15_000 })
      .toContain("offlineBroken: string = 42");
    // The redone word was saved with the rest.
    expect(await stored()).toContain(marker);

    // Everything Monaco needed came from this origin.
    expect(
      blocked.filter((url) => /monaco|jsdelivr|codicon|\.worker/i.test(url)),
    ).toEqual([]);
    expect(monacoRequests.filter((url) => new URL(url).origin !== origin)).toEqual(
      [],
    );
    expect(monacoRequests.some((url) => /ts\.worker/.test(url))).toBe(true);
    expect(monacoRequests.some((url) => /editor\.worker/.test(url))).toBe(true);
    expect(monacoRequests.some((url) => /codicon/.test(url))).toBe(true);
  });

  test("a runtime that does not arrive shows the error, and Retry opens the editor", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    await blockOtherOrigins(page, new URL(baseURL!).origin);
    const held: Route[] = [];
    await page.route(`**${MONACO_RUNTIME_PATH}*`, (route) => {
      held.push(route);
    });

    await openFileInCode(page);
    await expect(editorLoad(page)).toHaveAttribute(
      "data-code-editor-load",
      "loading",
    );
    // The editor's own timeout, not an endless "Loading".
    await expect(editorLoad(page)).toHaveAttribute(
      "data-code-editor-load-reason",
      "timeout",
      { timeout: 40_000 },
    );
    await expect(page.getByRole("alert")).toContainText(
      "The code editor is taking too long to load.",
    );
    await expect(page.locator(".monaco-editor")).toHaveCount(0);
    expect(held.length).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Retry" }).click();
    await expect(editorLoad(page)).toHaveAttribute(
      "data-code-editor-load",
      "loading",
    );
    for (const route of held) await route.continue();
    await expect(page.locator(".monaco-editor").first()).toBeVisible({
      timeout: 45_000,
    });
    await expect(editorLoad(page)).toHaveCount(0);
    await expect
      .poll(() => readMonacoModel(page, `/${PATH}`), { timeout: 30_000 })
      .toBe(SOURCE);
  });

  test("a runtime that fails to load says a reload is needed, with no Retry", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    await blockOtherOrigins(page, new URL(baseURL!).origin);
    await page.route(`**${MONACO_RUNTIME_PATH}*`, (route) =>
      route.abort("failed"),
    );

    await openFileInCode(page);
    await expect(editorLoad(page)).toHaveAttribute(
      "data-code-editor-load-reason",
      "failed",
      { timeout: 30_000 },
    );
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The code editor could not be loaded.");
    await expect(alert).toContainText("reload the page to open the code editor");
    await expect(alert).toContainText(
      "Unsaved changes are still in this tab, and reloading discards them.",
    );
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    await expect(page.locator(".monaco-editor")).toHaveCount(0);

    // Why no Retry: with the network back, the same import in this page still
    // rejects, without a request. If a browser ever fetches it again, this
    // fails and the choice above should be revisited.
    await page.unroute(`**${MONACO_RUNTIME_PATH}*`);
    let refetched = 0;
    page.on("request", (request) => {
      if (request.url().includes(MONACO_RUNTIME_PATH)) refetched += 1;
    });
    const again = await page.evaluate(async (runtime) => {
      try {
        await import(/* @vite-ignore */ runtime);
        return "loaded";
      } catch (error) {
        return `rejected: ${(error as Error).message}`;
      }
    }, MONACO_RUNTIME_PATH);
    expect(again).toMatch(/^rejected: /);
    expect(refetched).toBe(0);
    await expect(page.locator('[data-code-editor-load="loading"]')).toHaveCount(
      0,
    );
  });
});
