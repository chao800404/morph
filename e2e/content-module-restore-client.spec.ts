import { expect, test } from "@playwright/test";
import { EDITOR_PATH, isServerFunctionCall, openEditor } from "./helpers";
import {
  CONTENT_MODULE,
  byPath,
  createOwnTheme,
  listFiles,
  openCodeMode,
  openCommandPalette,
  restoreCommand,
} from "./helpers/content-module-restore";

/**
 * The restore of a deleted `src/morph/content.ts`, on the client lane only.
 * The client lane's Themes are the pinned Starter 31 workspace recording no
 * runtime, and the current Starter's module needs the full Start preview, so
 * the restore is refused there with nothing written. This file is assigned
 * to the client shards as a whole (LANE_EXCLUSIVE_SPECS in
 * scripts/editor-e2e-shards.mjs) and is not in the full Start job, where the
 * same restore succeeds (content-module-restore-start.spec.ts).
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

test.describe("the author's content module", () => {
  test("on a client-lane Theme the restore is refused, saying why, and nothing is written", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openEditor(page);
    const { scope, editorPath } = await createOwnTheme(page);
    await openEditor(page, editorPath);
    await openCodeMode(page);

    // Deleted the way an author would, as in the restore case
    // (content-module-restore-start.spec.ts).
    const tree = page.getByRole("tree", { name: "Theme files" });
    const row = tree.getByText("content.ts", { exact: true });
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

    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isServerFunctionCall(response.url(), "saveStorefrontThemeFile"),
      { timeout: 30_000 },
    );
    await openCommandPalette(page);
    await expect(restoreCommand(page)).not.toHaveAttribute("aria-disabled", "true");
    await restoreCommand(page).click();
    // A refused save still answers 200; the refusal is in the body.
    const body = await (await answered).text();
    expect(body).toContain("STARTER_START_PREVIEW_REQUIRED");

    const afterRestore = await listFiles(page, scope);
    expect(byPath(afterRestore).has(CONTENT_MODULE)).toBe(false);
    expect(afterRestore).toEqual(beforeRestore);
  });
});
