import { expect, test, type Page, type Request } from "@playwright/test";
import {
  EDITOR_PATH,
  SAMPLE_OFFSETS,
  clickExposedElement,
  enableSelection,
  openContentTab,
  openEditor,
  previewFrame,
  saveEditedSource,
} from "./helpers";

/**
 * Fixed text written in a component, made editable from Design.
 *
 * Runs against the seeded, disposable store only: it rewrites Theme source.
 * The text is added in Code first, since the starter has none left unbound.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const FIXED = "Fixed e2e text";
const EDITED = "Promoted e2e text";

/**
 * Diagnostics for a fixed text that is on the page but could not be clicked:
 * where each candidate is, and what each of `clickExposedElement`'s sample
 * points actually hits, in the editor and inside the frame. No text, no URLs.
 */
async function describeExposure(page: Page) {
  const frameBox = await page.locator("iframe").first().boundingBox();
  const candidates = previewFrame(page).getByText(FIXED, { exact: true });
  const count = await candidates.count();
  const described = [];
  for (let index = 0; index < Math.min(count, 3); index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox();
    const points = [];
    for (const [dx, dy] of SAMPLE_OFFSETS) {
      if (!box || !frameBox) break;
      const point = { x: box.x + box.width * dx, y: box.y + box.height * dy };
      const inEditor = await page.evaluate((at) => {
        const hit = document.elementFromPoint(at.x, at.y);
        return hit
          ? {
              tag: hit.tagName.toLowerCase(),
              testId: hit.closest("[data-testid]")?.getAttribute("data-testid"),
              slot: hit.closest("[data-slot]")?.getAttribute("data-slot"),
            }
          : null;
      }, point);
      const inFrame = await candidate.evaluate(
        (element, at) => {
          const hit = document.elementFromPoint(at.x, at.y);
          return {
            hit: hit
              ? {
                  tag: hit.tagName.toLowerCase(),
                  loc: hit.getAttribute("data-morph-loc"),
                  inBody: hit.closest("body") !== null,
                }
              : null,
            isItself: hit === element,
            insideIt: hit !== null && element.contains(hit),
            containsIt:
              hit !== null && hit !== element && hit.contains(element),
          };
        },
        { x: point.x - frameBox.x, y: point.y - frameBox.y },
      );
      points.push({ offset: [dx, dy], inEditor, ...inFrame });
    }
    described.push({
      box,
      element: await candidate.evaluate((element) => ({
        tag: element.tagName.toLowerCase(),
        loc: element.getAttribute("data-morph-loc"),
        children: element.children.length,
      })),
      points,
    });
  }
  return {
    frameBox,
    framePointerEvents: await page
      .locator("iframe")
      .first()
      .evaluate((frame) => getComputedStyle(frame).pointerEvents),
    viewport: page.viewportSize(),
    candidateCount: count,
    selectionEnabled: await previewFrame(page)
      .locator("html[data-storefront-editor-selection-enabled]")
      .count(),
    previewRoot: await previewFrame(page)
      .locator("body[data-storefront-preview-root]")
      .count(),
    candidates: described,
  };
}

async function selectFixedText(page: Page) {
  await expect(previewFrame(page).getByText(FIXED)).toBeVisible({
    timeout: 45_000,
  });
  // Opening a section from the tree can leave the pointer tool on already.
  if (
    await page
      .getByRole("button", { name: "Enable section selection" })
      .isVisible()
      .catch(() => false)
  ) {
    await enableSelection(page);
  }
  await previewFrame(page)
    .getByText(FIXED, { exact: true })
    .scrollIntoViewIfNeeded();
  const clicked = await clickExposedElement(
    page,
    previewFrame(page).getByText(FIXED, { exact: true }),
  );
  if (clicked === null) {
    await test.info().attach("fixed-text-not-exposed", {
      body: JSON.stringify(await describeExposure(page)),
      contentType: "application/json",
    });
  }
  expect(
    clicked,
    "the fixed text was not exposed on the canvas",
  ).not.toBeNull();
  await openContentTab(page);
  const notice = page.getByTestId("editor-code-text-notice");
  await expect(notice).toHaveAttribute("data-status", "convertible");
  return notice;
}

test("fixed text in a component becomes a field of this page", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const hmrEvents: unknown[] = [];
  // Diagnostics only, not a pass condition. React reports an attribute-only
  // mismatch as a console warning ("A tree hydrated but some attributes…")
  // and does not re-render for it; a content mismatch ("Hydration failed…")
  // can arrive as a console error or as an uncaught error. Both are kept,
  // with the differing lines, and without URLs.
  const hydrationReports: unknown[] = [];
  const startedAt = Date.now();
  const recordHydration = (source: string, text: string) => {
    const kind = text.startsWith("A tree hydrated but some attributes")
      ? "attributes-differ"
      : /Hydration failed|error while hydrating/.test(text)
        ? "content-differs"
        : null;
    if (!kind || hydrationReports.length >= 20) return;
    hydrationReports.push({
      source,
      kind,
      atMs: Date.now() - startedAt,
      diff: text
        .split("\n")
        // Only the tree diff's own lines (an attribute or a tag), not the
        // "- …" list of causes React prints above it.
        .filter((line) => /^\s*[+-]\s+(<|[\w:-]+=)/.test(line))
        .slice(0, 20)
        .map((line) => line.trim().replace(/https?:\/\/\S+/g, "<url>")),
    });
  };
  page.on("console", (message) => recordHydration("console", message.text()));
  page.on("pageerror", (error) => recordHydration("pageerror", error.message));
  // Every request the preview frame makes, for where the time between its
  // document and its hydration goes. Path only: no host, no query.
  const marks: [string, number][] = [];
  const mark = (stage: string) => marks.push([stage, Date.now() - startedAt]);
  type PreviewRequest = {
    path: string;
    type: string;
    start: number;
    end?: number;
    firstByte?: number;
    failed?: string;
  };
  const previewRequests = new Map<Request, PreviewRequest>();
  const fromPreview = (request: Request) => {
    try {
      return request.frame() !== page.mainFrame();
    } catch {
      return false;
    }
  };
  page.on("request", (request) => {
    if (!fromPreview(request) || previewRequests.size >= 2_000) return;
    previewRequests.set(request, {
      path: new URL(request.url()).pathname,
      type: request.resourceType(),
      start: Date.now() - startedAt,
    });
  });
  page.on("requestfinished", (request) => {
    const entry = previewRequests.get(request);
    if (!entry) return;
    entry.end = Date.now() - startedAt;
    const timing = request.timing();
    if (timing.requestStart >= 0 && timing.responseStart >= 0) {
      entry.firstByte = Math.round(timing.responseStart - timing.requestStart);
    }
  });
  page.on("requestfailed", (request) => {
    const entry = previewRequests.get(request);
    if (!entry) return;
    entry.end = Date.now() - startedAt;
    entry.failed = request.failure()?.errorText ?? "failed";
  });
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) {
      if (hmrEvents.length >= 100) return;
      hmrEvents.push({
        // This event includes same-document router navigation, not just reloads.
        event: "frame-navigation",
        path: new URL(frame.url(), "http://blank.invalid").pathname,
      });
    }
  });
  page.on("response", async (response) => {
    if (!new URL(response.url()).pathname.endsWith("/_morph/hmr")) return;
    try {
      const value = await response.json();
      if (hmrEvents.length < 100)
        hmrEvents.push({
          event: "hmr",
          status: response.status(),
          sequence: value.sequence,
          entries: value.entries?.map(
            (entry: { sequence: number; payload: { type: string } }) => ({
              sequence: entry.sequence,
              type: entry.payload?.type,
            }),
          ),
        });
    } catch {
      if (hmrEvents.length < 100)
        hmrEvents.push({ event: "hmr", status: response.status() });
    }
  });
  try {
    await openEditor(page);
    mark("editor-open");

    // Write the fixed text into the hero, in Code. The seeded home page
    // renders its own copy of the hero, so the change is this page's alone.
    await page.getByRole("button", { name: "hero", exact: true }).click();
    await openContentTab(page);
    const openInCode = page.locator('button[title$=" in Monaco Code Editor"]');
    const hero = (await openInCode.getAttribute("title"))!
      .replace(/^Open /, "")
      .replace(/ in Monaco Code Editor$/, "");
    expect(hero).toMatch(/^src\/components\/page-sections\/index\//);
    await openInCode.click();
    await saveEditedSource(page, hero, (source) => {
      const end = source.lastIndexOf("</section>");
      return `${source.slice(0, end)}<p>${FIXED}</p>\n${source.slice(end)}`;
    });
    mark("code-saved");
    // By keyboard, not by pointer. The save's toast sits over the toolbar, and
    // a toast the pointer rests on pauses its own timer. Waiting for "no toast"
    // first was not enough: it can pass before the toast appears, and the click
    // then moved the pointer onto it and waited until the test's four minutes
    // ran out (CI, twice). Focus and Enter need no hit test, so the toast
    // neither blocks the button nor gets hovered.
    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: /^Design$/ }).focus();
    await page.keyboard.press("Enter");
    mark("design");

    const notice = await selectFixedText(page);
    mark("fixed-text-selected");
    // What the server renders now, after the save. The frame's first
    // document may predate the save; a document asked for now must not.
    // Recorded, not asserted: the check is whether the server keeps an
    // outdated module (TanStack/router#6556), separate from this test's
    // subject.
    await testInfo.attach("server-render-after-save", {
      body: JSON.stringify(
        await previewFrame(page)
          .locator("body")
          .evaluate(async (_, text) => {
            const response = await fetch(location.pathname, {
              cache: "no-store",
            });
            return {
              status: response.status,
              hasFixedText: (await response.text()).includes(text),
            };
          }, FIXED),
      ),
      contentType: "application/json",
    });
    await notice.locator("textarea").fill(EDITED);
    await notice.locator("input").fill("e2eNote");
    await notice.getByRole("button", { name: "Make editable" }).click();

    // A page's own copy reaches nothing else, so nothing is asked to confirm.
    await expect(previewFrame(page).getByText(EDITED)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("editor-code-text-notice")).toHaveCount(0);
    await expect(page.getByTestId("editor-code-text-shared")).toHaveCount(0);

    // What was written is what a fresh load renders.
    await openEditor(page);
    await expect(previewFrame(page).getByText(EDITED)).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      previewFrame(page).getByText(FIXED, { exact: true }),
    ).toHaveCount(0);

    // Removing this page's value brings back the text the code holds.
    await enableSelection(page);
    await previewFrame(page).getByText(EDITED).scrollIntoViewIfNeeded();
    expect(
      await clickExposedElement(page, previewFrame(page).getByText(EDITED)),
      "the promoted text was not exposed on the canvas",
    ).not.toBeNull();
    await openContentTab(page);
    const field = page
      .locator('[data-slot="inspector-content-field"]')
      .filter({ hasText: "E2e note" });
    await field.getByRole("button", { name: "Use code default" }).click();
    await expect(
      previewFrame(page).getByText(FIXED, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    await openEditor(page);
    await expect(
      previewFrame(page).getByText(FIXED, { exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(previewFrame(page).getByText(EDITED)).toHaveCount(0);
  } finally {
    await testInfo.attach("preview-hmr-events", {
      body: JSON.stringify(hmrEvents),
      contentType: "application/json",
    });
    await testInfo.attach("preview-hydration-reports", {
      body: JSON.stringify(hydrationReports),
      contentType: "application/json",
    });
    await testInfo.attach("preview-requests", {
      body: JSON.stringify({
        marks,
        requests: [...previewRequests.values()].sort(
          (a, b) => a.start - b.start,
        ),
      }),
      contentType: "application/json",
    });
  }
});
