import { expect, test, type Page } from "@playwright/test";

/**
 * The editor at the widths people actually use.
 *
 * Overlap, not overflow, is what breaks first here: the header is a three
 * column grid, and a column that cannot shrink pushes its neighbour's content
 * underneath rather than widening the page. A scrollWidth check sees nothing
 * wrong while the save status is printed on top of the mode switch.
 */
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;

test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to run responsive checks.");

/** Widths the editor is expected to be usable at. */
const SUPPORTED_WIDTHS = [
  { name: "wide", width: 1600, height: 950 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "small laptop", width: 1024, height: 720 },
] as const;

async function openEditor(page: Page) {
  await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  await page.waitForTimeout(4_000);
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
