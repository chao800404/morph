import { expect, test } from "@playwright/test";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "../src/lib/storefront/starter-theme-v3-files";
import { EDITOR_PATH, isServerFunctionCall, openEditor, previewFrame } from "./helpers";
import {
  CONTENT_MODULE,
  byPath,
  createOwnTheme,
  listFiles,
  openCodeMode,
  openCommandPalette,
  restoreCommand,
  type Listing,
} from "./helpers/content-module-restore";

/**
 * The restore of a deleted `src/morph/content.ts`, on the full Start lane
 * only. The command writes the current Starter's module, which from Starter
 * 32 needs the full Start preview, so it succeeds only on a Theme recording
 * start: this file is assigned to the full Start job as a whole
 * (LANE_EXCLUSIVE_SPECS in scripts/editor-e2e-shards.mjs, START_PREVIEW_SHARDS
 * in scripts/editor-e2e-start.mjs) and is not on the client shards. The
 * client lane's refusal of the same restore is
 * content-module-restore-client.spec.ts; the cases both lanes run are
 * content-module-restore.spec.ts.
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

test.describe("the author's content module", () => {
  test("deleted in Code mode, it is restored by the command, saved, and the Live Preview renders", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openEditor(page);
    const { scope, editorPath } = await createOwnTheme(page);
    await openEditor(page, editorPath);
    await openCodeMode(page);

    // Deleted the way an author would.
    const tree = page.getByRole("tree", { name: "Theme files" });
    const row = tree.getByText("content.ts", { exact: true });
    // A real right-click, with the row centred: near the bottom edge the
    // menu can open under the pointer, and releasing the button then picks an
    // item. That is tracked on its own; this covers the ordinary case.
    await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: /Delete File/i }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect
      .poll(async () => byPath(await listFiles(page, scope)).has(CONTENT_MODULE), {
        timeout: 20_000,
      })
      .toBe(false);
    const beforeRestore = await listFiles(page, scope);

    const saves: string[] = [];
    const previewSyncs: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (isServerFunctionCall(url, "saveStorefrontThemeFile")) saves.push(url);
      if (
        isServerFunctionCall(url, "startThemePreviewServer") ||
        isServerFunctionCall(url, "applyThemePreviewFiles")
      ) {
        previewSyncs.push(url);
      }
    });
    await openCommandPalette(page);
    await expect(restoreCommand(page)).not.toHaveAttribute("aria-disabled", "true");
    await restoreCommand(page).click();

    await expect(page.getByText(`Created ${CONTENT_MODULE}`)).toBeVisible({
      timeout: 20_000,
    });
    expect(saves).toHaveLength(1);
    const afterRestore = await listFiles(page, scope);
    const restored = byPath(afterRestore).get(CONTENT_MODULE);
    expect(restored?.content).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    expect(afterRestore.sourceGeneration).toBe(beforeRestore.sourceGeneration + 1);
    // Only the module was written: every other file is as it was.
    const others = (listing: Listing) =>
      listing.files
        .filter((file) => file.path !== CONTENT_MODULE)
        .map(({ path, version, content }) => ({ path, version, content }))
        .sort((a, b) => a.path.localeCompare(b.path));
    expect(others(afterRestore)).toEqual(others(beforeRestore));

    // The Live Preview is brought up again on the restored source, not left
    // showing the document it rendered before the deletion.
    await expect
      .poll(() => previewSyncs.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await expect(
      previewFrame(page).locator("[data-storefront-section-id]").first(),
    ).toBeAttached({ timeout: 60_000 });
    await expect(page.getByText(/Remote source changes detected/i)).toHaveCount(0);
  });
});
