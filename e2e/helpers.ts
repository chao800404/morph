import { expect, test, type Locator, type Page } from "@playwright/test";

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
 * The preview server's own account of its startup, read off the console.
 *
 * Both transports measure `workspaceMs`, `workspaceMaterializeMs`,
 * `viteReadyMs` and the rest, and the server function returns them beside
 * `readyMs` — the sandbox server's comment calls this "returned stage timings
 * make local and deployed latency measurable". They are the server half of
 * every stage below, so a stall inside a container is a number here instead of
 * a guess.
 *
 * Taken from a console line, not from the response. Reading the response is
 * what a first version did and it could not work: TanStack Start encodes server
 * function replies with seroval, so the body is
 * `{"t":10,"i":0,"p":{"k":[…],"v":[…]}}` and `data.timings` is not something to
 * access. Decoding that by hand would tie these tests to an internal format
 * whose failure mode is silence. The editor logs the decoded object instead,
 * which is the same line an operator reads on a deployed editor.
 */
function capturePreviewServerReport(page: Page): { line: string | null } {
  const report: { line: string | null } = { line: null };
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[preview-server]")) report.line = text;
  });
  return report;
}

/** `name 123ms` pairs, in the order they finished. */
function describeStages(stages: ReadonlyArray<[string, number]>): string {
  return stages.length
    ? stages.map(([name, ms]) => `${name} ${ms}ms`).join(", ")
    : "none";
}

/**
 * Opens the editor and puts the canvas back to its default pan and zoom.
 *
 * The canvas remembers where it was left, and a panned canvas puts the theme's
 * elements under the editor's panels. A double click resets the transform, but
 * only while selection is off — which is also the state the editor loads in.
 */
export async function openEditor(page: Page) {
  const server = capturePreviewServerReport(page);
  const done: [string, number][] = [];

  /**
   * One handoff, named, timed, and reported when it is the one that stalled.
   *
   * This phase is the most expensive thing every spec does and it used to be
   * opaque: six waits behind one 45s ceiling, so a stall failed whichever
   * assertion came next and the error named a spec that had nothing to do with
   * it. Two CI reds were read that way before the real causes were found.
   *
   * `test.step` puts each stage in the report and the trace with its own
   * duration; the rethrow adds what a trace cannot show at a glance — which
   * stages did complete, and what the preview server said about its own half.
   */
  const stage = async (name: string, run: () => Promise<void>) => {
    const startedAt = Date.now();
    try {
      await test.step(`openEditor: ${name}`, run);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `openEditor stalled at "${name}" after ${Date.now() - startedAt}ms.\n` +
          `Completed: ${describeStages(done)}.\n` +
          `Preview server: ${server.line ?? "said nothing yet"}.\n\n` +
          reason,
      );
    }
    done.push([name, Date.now() - startedAt]);
  };

  // "domcontentloaded", not the default "load": the editor holds a preview
  // iframe that keeps fetching, so the load event can arrive late or not at all.
  await stage("document", async () => {
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
  });

  await stage("editor chrome", async () => {
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
  });

  await stage("preview frame", async () => {
    await expect(page.locator("iframe").first()).toBeAttached({
      timeout: 45_000,
    });
  });

  // The toolbar can appear before the preview has rendered anything and before
  // the editor has heard what is on the page. A fixed pause stood in for both
  // and covered them only on an idle machine: every test that reads the tree
  // passed alone and failed in a full run, which is the run that matters.
  //
  // Waited for instead: a section in the preview document, which is the Theme
  // actually rendered, and a row in the sidebar, which can only exist once the
  // preview has reported its structure back. Together they say the bridge
  // completed its handshake — the thing the pause was guessing at.
  await stage("theme rendered", async () => {
    await expect(
      previewFrame(page).locator("[data-storefront-section-id]").first(),
    ).toBeAttached({ timeout: 45_000 });
  });

  await stage("structure reported", async () => {
    await expect(
      page.locator("[data-editor-tree-sortable]").first(),
    ).toBeAttached({ timeout: 45_000 });
  });

  // The one guess left in this phase, and named so that it is visible as one.
  // Handlers attach on the commit after that structure lands, and no marker
  // says when that commit happened — so this is a fixed pause, deliberately
  // still here rather than replaced by a signal invented to retire it. Its cost
  // is now measured alongside the stages that are real, which is what a
  // replacement would have to be argued against.
  await stage("handlers attached (fixed 500ms)", async () => {
    await page.waitForTimeout(500);
  });

  // The pointer tool can be restored from the previous iframe document while
  // the editor shell stays mounted. A double click selects in that mode; it
  // does not reset the canvas transform, leaving the targets under a panel.
  await stage("canvas reset", async () => {
    const disableSelection = page.getByRole("button", {
      name: "Disable section selection",
    });
    if (await disableSelection.isVisible().catch(() => false)) {
      await disableSelection.click();
    }
    const point = await exposedCanvasPoint(page);
    if (point) {
      await page.mouse.dblclick(point.x, point.y);
    }
  });

  // Printed the way the latency specs print theirs, so a run carries the
  // distribution of this phase without a second job to collect it.
  console.log(
    `[openEditor] ${describeStages(done)}` +
      (server.line ? `\n${server.line}` : ""),
  );
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
  ).toBeAttached({ timeout: 45_000 });
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
      await settleSelection(page);
      return (await candidate.getAttribute("data-morph-loc")) ?? "";
    }
  }
  return null;
}

/**
 * Bring the Styles module into view.
 *
 * Selecting a node in the canvas leaves both module toggles unpressed, so a test
 * that reaches straight for a style control is asserting against a panel that was
 * never showing styles. This note used to say the click lands on Content; it does
 * not, and the measurement is recorded on `openContentTab` below.
 *
 * Silent when the tab is already pressed or not rendered, so callers can use it
 * as a precondition rather than a step.
 */
export async function openStylesTab(page: Page) {
  const styles = page.getByRole("button", { name: "Styles", exact: true });
  if (!(await styles.isVisible().catch(() => false))) return;
  if ((await styles.getAttribute("aria-pressed")) === "true") return;
  await styles.click();
  await page.waitForTimeout(300);
}

/**
 * Bring the Content module into view.
 *
 * The counterpart to `openStylesTab`, and needed for the same reason: selecting a
 * paragraph leaves both toggles `aria-pressed="false"`, so neither module is in
 * view and a test that reaches straight for a content field finds no fields at
 * all and reports it as a missing control.
 *
 * `Content` is a button carrying `aria-pressed`, not a checkbox. A `check()`
 * against it waits for a role that is never there, which is a ten-minute
 * timeout rather than a failure that says what is wrong.
 *
 * Silent when the tab is already pressed or not rendered, so callers can use it
 * as a precondition rather than a step.
 */
export async function openContentTab(page: Page) {
  const content = page.getByRole("button", { name: "Content", exact: true });
  if (!(await content.isVisible().catch(() => false))) return;
  if ((await content.getAttribute("aria-pressed")) === "true") return;
  await content.click();
  await page.waitForTimeout(300);
}

/**
 * Waits for a canvas click to reach the panels.
 *
 * This was a flat 1.5s, which is a bet on how long the round trip takes rather
 * than a wait for it. The trip measures around 700ms and exceeds a second on a
 * loaded machine, so the bet lost often enough to read as "the click did not
 * select anything" -- in a test about something else entirely. The cap is
 * generous because how *fast* selection lands is the performance suite's
 * question, not this one's.
 */
export async function settleSelection(page: Page) {
  const selected = page.locator(
    '[data-editor-tree-node-selected="true"], [data-sidebar="menu-button"][data-active="true"]',
  );
  await selected
    .first()
    .waitFor({ state: "visible", timeout: 6_000 })
    .catch(() => undefined);
  // One frame past the tree so the inspector has rendered against it too.
  await page.waitForTimeout(250);
}
