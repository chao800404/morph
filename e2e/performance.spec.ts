import { expect, test, type Page } from "@playwright/test";

import {
  EDITOR_PATH,
  enableSelection,
  median,
  openEditor as openEditorShell,
} from "./helpers";

/**
 * How long the editor takes to answer the things people do constantly.
 *
 * These are not micro-benchmarks and the ceilings are deliberately far above
 * the numbers observed: a dev server on a developer's machine is not a stable
 * measuring instrument, and a test that fails when a run is 40% slower than
 * usual gets muted rather than read. The ceilings exist to catch the kind of
 * regression that changes an interaction from immediate to obviously broken —
 * an accidental synchronous re-parse, a lost memo, a round trip added to a
 * path that used to be local.
 *
 * The measured values are always printed, so the trend is visible even when
 * nothing fails.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to run performance checks.");

// One engine only. The ceilings below were calibrated against Chromium, and the
// same numbers elsewhere measure the engine rather than this code: the tree
// interaction takes about 150ms in Chromium and about 1100ms in a headless
// WebKit on this host, with no difference in what the editor does. Comparing
// engines is worth doing, but it needs baselines of its own.
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Latency ceilings are calibrated on Chromium.",
);

/** Points to try inside a target, as fractions of its own box. */
const SAMPLE_OFFSETS = [
  [0.5, 0.5],
  [0.5, 0.2],
  [0.75, 0.5],
] as const;

async function openEditor(page: Page) {
  await openEditorShell(page);
  await enableSelection(page);
  await page.waitForTimeout(1_000);
}

/** Canvas points that are neither covered by a panel nor over a child. */
async function usableTargets(page: Page, wanted: number) {
  const frameBox = await page.locator("iframe").first().boundingBox();
  const fields = page.frameLocator("iframe").locator("[data-storefront-field]");
  const total = await fields.count();
  const points: { x: number; y: number }[] = [];

  for (let index = 0; index < total && points.length < wanted; index += 1) {
    const box = await fields.nth(index).boundingBox();
    if (!box || !frameBox) continue;
    for (const [dx, dy] of SAMPLE_OFFSETS) {
      const point = { x: box.x + box.width * dx, y: box.y + box.height * dy };
      const uncovered = await page.evaluate(
        (at) => document.elementFromPoint(at.x, at.y)?.tagName === "IFRAME",
        point,
      );
      if (!uncovered) continue;
      const isItself = await fields
        .nth(index)
        .evaluate((el, at) => document.elementFromPoint(at.x, at.y) === el, {
          x: point.x - frameBox.x,
          y: point.y - frameBox.y,
        });
      if (!isItself) continue;
      points.push(point);
      break;
    }
  }
  return points;
}

test.describe("editor responsiveness", () => {
  test("selecting on the canvas reaches the tree promptly", async ({ page }) => {
    await openEditor(page);
    const points = await usableTargets(page, 3);
    expect(points.length, "no canvas targets were reachable").toBeGreaterThan(1);

    // Read without waiting: `innerText` on a missing element waits for it to
    // appear, which would measure the timeout rather than the interaction.
    const selectedLabel = async () =>
      (
        await page
          .locator('[data-editor-tree-node-selected="true"]')
          .allInnerTexts()
      )[0] ?? "";

    const samples: number[] = [];
    let previous = await selectedLabel();
    for (const point of points) {
      const started = Date.now();
      await page.mouse.click(point.x, point.y);
      await expect.poll(selectedLabel, { timeout: 15_000 }).not.toBe(previous);
      samples.push(Date.now() - started);
      previous = await selectedLabel();
    }

    console.log("[canvas click -> tree selection]", samples, "median", median(samples));
    expect(median(samples)).toBeLessThan(2_500);
  });

  test("selecting in the tree marks the row promptly", async ({ page }) => {
    await openEditor(page);
    const rows = page.locator(
      '[data-sidebar="menu-item"] button:has([data-editor-tree-icon="section"])',
    );
    const count = await rows.count();
    expect(count, "the tree rendered no sections").toBeGreaterThan(1);

    const samples: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const row = rows.nth(index % count);
      const started = Date.now();
      await row.click();
      await expect(row).toHaveAttribute("data-active", "true", {
        timeout: 10_000,
      });
      samples.push(Date.now() - started);
    }

    console.log("[tree row click -> active]", samples, "median", median(samples));
    // Around 150ms once the row stopped waiting for the canvas to confirm;
    // the old behaviour measured about 950ms. The ceiling sits between the two
    // with room for a slow run, not tight against the good number.
    expect(median(samples)).toBeLessThan(600);
  });

  test("switching between Design and Code stays immediate", async ({ page }) => {
    await openEditor(page);

    const toCode = Date.now();
    await page.getByRole("button", { name: /^Code$/ }).click();
    await page.locator("text=EXPLORER").first().waitFor({ timeout: 30_000 });
    const codeMs = Date.now() - toCode;

    const toDesign = Date.now();
    await page.getByRole("button", { name: /^Design$/ }).click();
    await page.locator("iframe").first().waitFor({ state: "visible", timeout: 30_000 });
    const designMs = Date.now() - toDesign;

    console.log("[design -> code]", codeMs, "[code -> design]", designMs);
    // Both surfaces stay mounted, so a switch is a visibility change. Anything
    // near a second means something is being rebuilt that should not be.
    expect(codeMs).toBeLessThan(2_000);
    expect(designMs).toBeLessThan(2_000);
  });
});
