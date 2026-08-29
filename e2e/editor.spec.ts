import { expect, test, type Page } from "@playwright/test";

import {
  EDITOR_PATH,
  clickExposedElement,
  enableSelection,
  openEditor,
  previewFrame,
} from "./helpers";

test.skip(
  !EDITOR_PATH,
  "Set E2E_EDITOR_PATH to the editor route of a theme with content.",
);

test.describe("visual editor", () => {
  test("selecting a plain container on the canvas selects its tree row", async ({
    page,
  }) => {
    await openEditor(page);
    await enableSelection(page);

    // Every marker excluded on purpose: an element carrying a field, a stable
    // node id or an element key is matched by one of the other branches, so it
    // would pass whether or not the source-position branch exists. Only an
    // element with nothing but its compile-time position tests that branch.
    const containers = previewFrame(page).locator(
      [
        "[data-storefront-section-id] [data-morph-loc]",
        ":not([data-storefront-field])",
        ":not([data-storefront-field-path])",
        ":not([data-morph-node])",
        ":not([data-morph-element])",
      ].join(""),
    );
    expect(
      await containers.count(),
      "the canvas rendered no plain containers",
    ).toBeGreaterThan(0);

    const clicked = await clickExposedElement(page, containers);
    expect(
      clicked,
      "no plain container was reachable in the canvas",
    ).not.toBeNull();

    await expect(
      page.locator('[data-editor-tree-node-selected="true"]'),
    ).toHaveCount(1, { timeout: 15_000 });
  });

  test("the preview frame is as tall as the rendered page, not taller", async ({
    page,
  }) => {
    await openEditor(page);
    const frame = page.locator("iframe").first();
    await expect(frame).toBeVisible();

    // Layout is the whole point of running in a browser: jsdom reports 0 for
    // every height, so this measurement cannot exist in the unit suite.
    await expect
      .poll(
        async () => {
          const frameHeight = await frame.evaluate(
            (el) => el.getBoundingClientRect().height,
          );
          const contentHeight = await previewFrame(page)
            .locator("[data-storefront-preview-root]")
            .evaluate((el) => el.getBoundingClientRect().height);
          return Math.abs(frameHeight - contentHeight);
        },
        {
          timeout: 30_000,
          message: "frame height never settled on the content height",
        },
      )
      .toBeLessThan(4);
  });

  test("the frame follows content that shrinks, not only content that grows", async ({
    page,
  }) => {
    await openEditor(page);

    const frame = page.locator("iframe").first();
    const measure = async () => {
      const frameHeight = await frame.evaluate((el) =>
        Math.round(el.getBoundingClientRect().height),
      );
      const contentHeight = await previewFrame(page)
        .locator("[data-storefront-preview-root]")
        .evaluate((el) => Math.round(el.getBoundingClientRect().height));
      return { frameHeight, contentHeight };
    };

    const before = await settleHeight(page, measure);
    const hide = page.getByRole("button", { name: /^Hide section / }).first();
    await hide.click();

    try {
      // The theme's own `min-h-screen` resolves against the frame, so content
      // that becomes shorter cannot report itself shorter while the frame is
      // still tall. Without a re-measure the removed section's space stays
      // behind as blank canvas, and only a file write ever cleared it.
      const after = await settleHeight(page, measure);
      expect(
        after.frameHeight,
        "the frame kept the height of a section that is no longer rendered",
      ).toBeLessThan(before.frameHeight);
      expect(Math.abs(after.frameHeight - after.contentHeight)).toBeLessThan(4);
    } finally {
      const show = page.getByRole("button", { name: /^Show section / }).first();
      if (await show.count()) await show.click();
      await page.waitForTimeout(2_000);
    }
  });

  test("a style edit reaches the canvas and can be reversed", async ({
    page,
  }) => {
    await openEditor(page);
    await enableSelection(page);

    // Which element the canvas exposes first differs by engine, and not every
    // one of them offers a text colour — an image field does not. The test is
    // about the round trip, so it looks for an element that can make one.
    const fields = previewFrame(page).locator("[data-storefront-field]");
    const colorInput = page.getByLabel("Text color value");
    let clicked: string | null = null;
    for (let attempt = 0; attempt < 6 && !clicked; attempt += 1) {
      const candidate = await clickExposedElement(page, fields, attempt);
      if (!candidate) break;
      if (await colorInput.isVisible().catch(() => false)) clicked = candidate;
    }
    expect(
      clicked,
      "no content element offering a text colour was reachable",
    ).not.toBeNull();
    await expect(colorInput).toBeVisible();

    const selected = previewFrame(page).locator(`[data-morph-loc="${clicked}"]`);
    const colorOf = () =>
      selected.evaluate((element) => getComputedStyle(element).color);
    const original = await colorOf();

    const undo = page.getByRole("button", { name: /undo/i }).first();
    // Nothing has been edited yet: an undo that is always enabled would hide
    // exactly the defect this test exists to catch.
    await expect(undo).toBeDisabled();

    try {
      await writeTextColor(page, "rgb(200, 30, 30)");
      await expect.poll(colorOf).toBe("rgb(200, 30, 30)");
      await writeTextColor(page, "rgb(10, 90, 180)");
      await expect.poll(colorOf).toBe("rgb(10, 90, 180)");

      await undo.click();
      await expect.poll(colorOf).toBe("rgb(200, 30, 30)");
      await undo.click();
      await expect.poll(colorOf).toBe(original);
    } finally {
      // The theme file is real, so the test puts it back whether it passed or
      // not; a failed run must not leave the workspace edited.
      await undoEverything(page);
    }

    await expect.poll(colorOf).toBe(original);
  });

  test("undo steps back through each write, not just the last one", async ({
    page,
  }) => {
    await openEditor(page);
    const original = await sectionOrder(page);
    expect(
      original.length,
      "this template needs at least three sections",
    ).toBeGreaterThan(2);

    const undo = page.getByRole("button", { name: /undo/i }).first();
    await expect(undo).toBeDisabled();

    try {
      // Each reorder rewrites the route file through the same save path, so
      // two of them are two entries for one file. Before per-file history
      // became a stack, the second write retired the first entry and one press
      // was all there was — the first order could never be reached again.
      await dragSection(page, 0, 1);
      await expect.poll(() => sectionOrder(page)).not.toEqual(original);
      await settleAfterWrite(page);
      const afterFirst = await sectionOrder(page);

      await dragSection(page, 1, 2);
      await expect.poll(() => sectionOrder(page)).not.toEqual(afterFirst);
      await settleAfterWrite(page);

      await undo.click();
      await expect.poll(() => sectionOrder(page), { timeout: 20_000 }).toEqual(
        afterFirst,
      );
      await undo.click();
      await expect.poll(() => sectionOrder(page), { timeout: 20_000 }).toEqual(
        original,
      );
    } finally {
      await undoEverything(page);
    }

    await expect.poll(() => sectionOrder(page), { timeout: 20_000 }).toEqual(
      original,
    );
  });
});

/** Writes a colour through the Inspector the way a person would. */
async function writeTextColor(page: Page, value: string) {
  const input = page.getByLabel("Text color value");
  await input.fill(value);
  await input.press("Enter");
}

/** Presses undo until there is nothing left to reverse. */
async function undoEverything(page: Page) {
  const undo = page.getByRole("button", { name: /undo/i }).first();
  for (let press = 0; press < 20; press += 1) {
    if (!(await undo.isEnabled())) return;
    await undo.click();
    await page.waitForTimeout(400);
  }
}

/** Section rows in the left tree, in the order they are shown. */
function sectionRows(page: Page) {
  // Identified by the icon the panel gives a section row, not by its label:
  // labels are the theme author's words and the page row sits in the same list.
  return page.locator(
    '[data-sidebar="menu-item"] button:has([data-editor-tree-icon="section"])',
  );
}

async function sectionOrder(page: Page) {
  // A row can be read mid-render with no text yet. Dropping the blanks keeps a
  // transient frame from being compared as if a section had lost its name; a
  // row that is genuinely missing still shows up as a shorter list.
  return (await sectionRows(page).allInnerTexts())
    .map((text) => text.trim())
    .filter((text) => text.length > 0);
}

/**
 * Drags one section row onto another.
 *
 * The sidebar uses pointer-based sorting rather than native drag and drop, so
 * a real pointer sequence drives it — including the small first move that gets
 * past the sensor's activation distance.
 */
async function dragSection(page: Page, fromIndex: number, toIndex: number) {
  // The panel re-renders whenever the preview reports its structure, so the
  // rows are waited for rather than assumed to be settled from a prior read.
  await sectionRows(page).nth(fromIndex).waitFor({ state: "visible" });
  await sectionRows(page).nth(toIndex).waitFor({ state: "visible" });
  const from = await sectionRows(page).nth(fromIndex).boundingBox();
  const to = await sectionRows(page).nth(toIndex).boundingBox();
  if (!from || !to) throw new Error("section rows are not laid out");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 10, {
    steps: 5,
  });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 4, {
    steps: 12,
  });
  await page.mouse.up();
}

/**
 * Waits until a reorder has actually landed.
 *
 * The panel reorders optimistically, so the new order is on screen before the
 * route file has been written. Pressing undo in that window reverses the write
 * before it — which is what made this test fail while the editor was behaving
 * correctly.
 */
async function settleAfterWrite(page: Page) {
  const undo = page.getByRole("button", { name: /undo/i }).first();
  await expect(undo).toBeEnabled({ timeout: 20_000 });
  let previous = await sectionOrder(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(500);
    const current = await sectionOrder(page);
    if (current.join("\u0000") === previous.join("\u0000")) return;
    previous = current;
  }
}

/** Reads a measurement repeatedly until two consecutive reads agree. */
async function settleHeight(
  page: Page,
  measure: () => Promise<{ frameHeight: number; contentHeight: number }>,
) {
  let previous = "";
  let latest = await measure();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(600);
    latest = await measure();
    const now = `${latest.frameHeight}/${latest.contentHeight}`;
    if (now === previous) return latest;
    previous = now;
  }
  return latest;
}
