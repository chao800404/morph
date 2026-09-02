import { expect, test, type Page } from "@playwright/test";

import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openEditor as openEditorShell,
} from "./helpers";

/**
 * The editor at the widths people actually use.
 *
 * Overlap, not overflow, is what breaks first here: the header is a three
 * column grid, and a column that cannot shrink pushes its neighbour's content
 * underneath rather than widening the page. A scrollWidth check sees nothing
 * wrong while the save status is printed on top of the mode switch.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to run responsive checks.");

/** Widths the editor is expected to be usable at. */
const SUPPORTED_WIDTHS = [
  { name: "wide", width: 1600, height: 950 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "small laptop", width: 1024, height: 720 },
] as const;

async function openEditor(page: Page) {
  await openEditorShell(page);
}

for (const size of SUPPORTED_WIDTHS) {
  test(`header controls do not overlap at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await openEditor(page);

    // The editor's own header, not every header on the page: the Inspector
    // renders one too, and comparing positions across two of them produces
    // overlaps that mean nothing.
    const boxes = await page
      .locator("[data-morph-editor] > header > *")
      .evaluateAll((groups) =>
        groups
          .map((group) => {
            const rect = group.getBoundingClientRect();
            return {
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              text: group.textContent?.trim().replace(/\s+/g, " ").slice(0, 40),
            };
          })
          .filter((box) => box.width > 0),
      );

    const overlaps: string[] = [];
    for (let index = 0; index < boxes.length - 1; index += 1) {
      const left = boxes[index];
      const right = boxes[index + 1];
      // A one pixel touch is rounding, not a layout fault.
      if (right.left < left.right - 1) {
        overlaps.push(`"${left.text}" overlaps "${right.text}"`);
      }
    }

    expect(overlaps, `at ${size.width}px`).toEqual([]);
    await expect(
      page.getByRole("button", { name: "Build the theme" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Release history" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
    await expect(page.locator("[data-editor-save-status]")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
      "the page scrolls sideways",
    ).toBeLessThanOrEqual(0);
  });
}

test("the canvas keeps usable width beside both panels", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await openEditor(page);

  // A canvas narrower than this is not a preview of anything; it means the
  // panels have taken the page and the editor has stopped being an editor.
  const frame = await page.locator("iframe").first().boundingBox();
  expect(frame).not.toBeNull();
  expect(frame!.width, "canvas width at 1024px").toBeGreaterThan(320);
});

test.describe("inspector panel", () => {
  for (const size of SUPPORTED_WIDTHS) {
    test(`controls stay inside the panel at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openEditor(page);
      await enableSelection(page);

      // Select something with styles to inspect; an empty panel proves nothing.
      // Which element the canvas exposes differs by width, so this walks the
      // candidates until one of them opens the controls being measured.
      const fields = page
        .frameLocator("iframe")
        .locator("[data-storefront-field]");
      const colorInput = page.getByLabel("Text color value");
      let opened = false;
      for (let attempt = 0; attempt < 6 && !opened; attempt += 1) {
        const clicked = await clickExposedElement(page, fields, attempt);
        if (!clicked) break;
        opened = await colorInput.isVisible().catch(() => false);
      }
      expect(opened, "no styleable element was reachable").toBe(true);

      const panel = page.locator("aside").last();
      const escaping = await panel.evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        const out: string[] = [];
        // Absolutely positioned swatches legitimately sit on top of their row,
        // so the panel's own edge is the boundary that matters.
        for (const element of root.querySelectorAll(
          "input, select, [role='group'], [data-slot='select-trigger']",
        )) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0) continue;
          if (rect.right > bounds.right + 1 || rect.left < bounds.left - 1) {
            out.push(
              `${element.tagName}:${element.getAttribute("aria-label") ?? ""}`,
            );
          }
        }
        return out;
      });

      expect(escaping, `at ${size.width}px`).toEqual([]);
      expect(
        await panel.evaluate((el) => el.scrollWidth - el.clientWidth),
        "the inspector scrolls sideways",
      ).toBeLessThanOrEqual(0);
    });
  }
});
