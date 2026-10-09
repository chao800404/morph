import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { EDITOR_PATH, isServerFunctionCall, openEditor } from "./helpers";
import { themeScopeFromEditorPath } from "./native-compat";

/**
 * A right-click on a Code file row only opens its menu, wherever the row is.
 *
 * Chromium opens the context menu on the right button's press. A row at the
 * bottom of the viewport has no room below, so the menu flips upward under the
 * pointer and the button's release lands on one of its items. Radix selects on
 * a release it saw no press for; the release used to start whichever item
 * landed there (Rename and Duplicate were both seen). This drives
 * a real mouse, not a dispatched `contextmenu` event, because the defect is
 * in the release.
 *
 * A Theme of its own: a regression duplicates or deletes a file, and that must
 * not reach the suite's shared Theme.
 */
test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

// The viewport the defect was reproduced in.
test.use({ viewport: { width: 1600, height: 950 } });

const ROW_PATH = "src/morph/content.ts";
const WRITES = [
  "saveStorefrontThemeFile",
  "saveStorefrontThemeFilesBatch",
  "deleteStorefrontThemeFile",
];

test("a right-click on a row at the bottom edge opens the menu and selects nothing", async ({
  page,
}) => {
  await openEditor(page);
  const scope = {
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
      VALUES ('${scope.themeId}', '${scope.storefrontId}',
        'context-menu-${scope.themeId}', '{"starterTemplateVersion":1}',
        '${now}', '${now}');`,
  ]);
  // The ordinary editor read provisions the starter source and documents.
  const homeId = await page.evaluate(async (scope) => {
    const module = "/src/server/storefront/storefront-themes.serverFn.ts";
    const fns = await import(/* @vite-ignore */ module);
    const result = await fns.getStorefrontThemeEditor({ data: scope });
    if (!result.success) throw new Error(result.message);
    return result.data.templates.find(
      (item: { type: string }) => item.type === "index",
    ).id as string;
  }, scope);
  await openEditor(
    page,
    `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${homeId}`,
  );

  const row = page.locator(`[data-file-tree-file="${ROW_PATH}"]`);
  // A click before hydration is received by nothing; clicked until Code mode
  // is actually showing its tree.
  await expect(async () => {
    await page.getByRole("button", { name: /^Code$/ }).click();
    await expect(row).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  await row.evaluate((element) => element.scrollIntoView({ block: "end" }));
  const box = (await row.boundingBox())!;
  expect(
    page.viewportSize()!.height - (box.y + box.height / 2),
    "the row sits at the bottom edge, with no room for the menu below it",
  ).toBeLessThan(100);

  const writes: string[] = [];
  page.on("request", (request) => {
    const name = WRITES.find((write) =>
      isServerFunctionCall(request.url(), write),
    );
    if (name) writes.push(name);
  });
  // Where the right button's release went. The menu opens on the press and
  // takes the release while it is still being placed; settled, it sits beside
  // the pointer. So the case under test is shown by the event, not by
  // hit-testing the settled menu.
  await page.evaluate(() => {
    const released: string[] = [];
    (window as unknown as { __released: string[] }).__released = released;
    window.addEventListener(
      "pointerup",
      (event) => {
        if (event.button !== 2) return;
        const target = event.target as Element | null;
        released.push(target?.closest("[role=menuitem]")?.textContent ?? "");
      },
      { capture: true },
    );
  });

  // A real press and release, as a person right-clicks.
  await row.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __released: string[] }).__released,
    ),
    "the right button's release reached an item of the flipped menu",
  ).toEqual([expect.stringMatching(/\S/)]);

  // Nothing was chosen: the menu stays open and no item's action started.
  // Waited out: an action would start within the same task as the release,
  // and its writes are requests sent right after.
  await page.waitForTimeout(500);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: `Rename ${ROW_PATH}` }),
  ).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(row).toBeVisible();
});
