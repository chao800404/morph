import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The editor path under test.
 *
 * Storefront and theme ids belong to whoever is running this, so they come from
 * the environment rather than being pinned to one developer's database.
 */
export const EDITOR_PATH = process.env.E2E_EDITOR_PATH;

/** Points to try inside a target, as fractions of its own box. */
export const SAMPLE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.02],
  [0.75, 0.02],
  [0.5, 0.98],
  [0.02, 0.5],
  [0.98, 0.5],
];

/** The canvas is an iframe; everything rendered by the theme lives inside it. */
export function previewFrame(page: Page) {
  return page.frameLocator("iframe");
}

export function median(values: number[]) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

/**
 * Returns a point that is really on the canvas.
 *
 * The canvas is wider than its visible area, so part of the frame sits under
 * the editor's own panels. A fixed offset into the frame lands on a panel at
 * narrower viewports — which is a click delivered to the wrong element rather
 * than a failure anyone would recognise.
 */
export async function exposedCanvasPoint(page: Page) {
  const box = await page.locator("iframe").first().boundingBox();
  if (!box) return null;
  for (const fraction of [0.5, 0.65, 0.8, 0.35]) {
    const point = {
      x: box.x + box.width * fraction,
      y: box.y + Math.min(box.height * 0.2, 300),
    };
    const exposed = await page.evaluate(
      (at) => document.elementFromPoint(at.x, at.y)?.tagName === "IFRAME",
      point,
    );
    if (exposed) return point;
  }
  return null;
}

/**
 * Opens the editor and puts the canvas back to its default pan and zoom.
 *
 * The canvas remembers where it was left, and a panned canvas puts the theme's
 * elements under the editor's panels. A double click resets the transform, but
 * only while selection is off — which is also the state the editor loads in.
 */
export async function openEditor(page: Page) {
  // "domcontentloaded", not the default "load": the editor holds a preview
  // iframe that keeps fetching, so the load event can arrive late or not at all.
  await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });

  const point = await exposedCanvasPoint(page);
  if (point) {
    await page.mouse.dblclick(point.x, point.y);
  }
  // The toolbar renders before the page finishes hydrating, and a click in that
  // window is received by nothing at all — the control looks pressed and
  // nothing happens. Every caller needs this, so it waits here rather than in
  // each of them.
  await page.waitForTimeout(3_000);
}

/** Turns on the pointer tool, the first thing a person does to select. */
export async function enableSelection(page: Page) {
  await page.getByRole("button", { name: "Enable section selection" }).click();
  await expect(
    page.getByRole("button", { name: "Disable section selection" }),
  ).toBeVisible();
  // The preview can restart its bridge while Theme source is being applied.
  // Its ready handshake must restore the active tool before a canvas click is
  // meaningful; waiting for the iframe state verifies that real protocol
  // contract instead of relying on the parent toolbar's local state.
  await expect(
    previewFrame(page).locator(
      "html[data-storefront-editor-selection-enabled]",
    ),
  ).toBeAttached();
}

/**
 * Clicks the first candidate the canvas actually exposes, at a point that hits
 * the element itself. Returns its source position, or null if none is exposed.
 *
 * Two things can go wrong otherwise, and both did while these tests were
 * written: the editor's own panels overlap part of the frame, so a click can
 * press a panel instead of the page; and a point over a child selects the
 * child, which is matched by a different rule and would pass regardless of the
 * behaviour under test.
 */
export async function clickExposedElement(
  page: Page,
  candidates: Locator,
  skip = 0,
): Promise<string | null> {
  const frameBox = await page.locator("iframe").first().boundingBox();
  if (!frameBox) return null;
  const total = await candidates.count();
  let skipped = 0;

  for (let index = 0; index < total; index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox();
    if (!box) continue;

    for (const [dx, dy] of SAMPLE_OFFSETS) {
      const point = { x: box.x + box.width * dx, y: box.y + box.height * dy };
      const uncovered = await page.evaluate(
        (at) => document.elementFromPoint(at.x, at.y)?.tagName === "IFRAME",
        point,
      );
      if (!uncovered) continue;

      const isItself = await candidate.evaluate(
        (element, at) => document.elementFromPoint(at.x, at.y) === element,
        { x: point.x - frameBox.x, y: point.y - frameBox.y },
      );
      if (!isItself) continue;
      // `skip` walks past candidates a caller has already tried and rejected.
      if (skipped < skip) {
        skipped += 1;
        break;
      }

      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(1_500);
      return (await candidate.getAttribute("data-morph-loc")) ?? "";
    }
  }
  return null;
}

/**
 * Bring the Styles module into view.
 *
 * Selecting a node in the canvas lands on Content, so a test that reaches
 * straight for a style control is asserting against a panel that was never
 * showing styles. Silent when the tab is already pressed or not rendered, so
 * callers can use it as a precondition rather than a step.
 */
export async function openStylesTab(page: Page) {
  const styles = page.getByRole("button", { name: "Styles", exact: true });
  if (!(await styles.isVisible().catch(() => false))) return;
  if ((await styles.getAttribute("aria-pressed")) === "true") return;
  await styles.click();
  await page.waitForTimeout(300);
}
