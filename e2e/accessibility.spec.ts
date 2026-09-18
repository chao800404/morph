import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { EDITOR_PATH, openEditor as openEditorShell } from "./helpers";

/**
 * What a keyboard and a screen reader make of the editor.
 *
 * Run against the real editor rather than isolated components: the problems
 * that matter here are structural — an unlabelled control, a trap, an order
 * that makes no sense — and none of them are visible in a component test.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to run accessibility checks.");

async function openEditor(page: Page) {
  await openEditorShell(page);
}

/**
 * Scans the editor's own chrome, not the theme inside the canvas.
 *
 * The canvas renders whatever the Theme author wrote; holding Morph's editor to
 * account for someone else's markup would report failures nobody here can fix,
 * and the real ones would be lost among them.
 */
function scanEditorChrome(page: Page) {
  return new AxeBuilder({ page })
    .exclude("iframe")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
}

test.describe("editor accessibility", () => {
  test("has no automatically detectable violations", async ({ page }) => {
    await openEditor(page);
    const results = await scanEditorChrome(page).analyze();

    // Reported in full: a count tells you nothing about what to fix.
    const summary = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
      help: violation.help,
      // A selector like `.text-[10px]` matches half the editor; the failing
      // element and what axe measured are what make this actionable.
      first: violation.nodes[0]?.target.join(" "),
      html: violation.nodes[0]?.html.slice(0, 120),
      why: violation.nodes[0]?.any[0]?.message,
    }));
    if (summary.length > 0) console.log(JSON.stringify(summary, null, 2));

    expect(summary).toEqual([]);
  });

  test("every control in the editor has an accessible name", async ({
    page,
  }) => {
    await openEditor(page);
    // Switching to Code mode brings its own controls into play; they are part
    // of the editor and were where the first unnamed button turned up.
    await page.getByRole("button", { name: /^Code$/ }).click();
    await page.waitForTimeout(2_000);

    // Scoped by the editor's own root marker. The dev-only TanStack devtools
    // mount as a sibling of the app, and reporting their controls as faults
    // here would bury the ones this project can actually fix.
    const unnamed = await page
      .locator("[data-morph-editor] button, [role='dialog'] button")
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => {
            const label =
              button.getAttribute("aria-label") ??
              button.getAttribute("title") ??
              button.textContent?.trim();
            return !label;
          })
          .map((button) => button.outerHTML.slice(0, 120)),
      );

    expect(unnamed).toEqual([]);
  });

  test("a dialog is scannable too, not just the page behind it", async ({
    page,
  }) => {
    await openEditor(page);
    // Axe only reports what is rendered and visible, so anything behind a
    // closed dialog is invisible to it. Scanning only the resting page is how
    // an unnamed close button and three contrast failures went unnoticed.
    await page.getByRole("button", { name: "Release history" }).click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();

    // Waited for opacity, not just visibility. The dialog and its overlay fade
    // in over 300ms (`fade-in-0`, `duration-300`), and an element at opacity
    // 0.3 is already "visible" to Playwright — so a scan can start mid-fade,
    // where axe resolves every text node against a blended background and
    // reports contrast failures that do not exist once the animation lands.
    // That is what it did on CI: five nodes of `color-contrast` on the release
    // table's headers, on a token pair that measures 4.83:1 on white and
    // 5.66:1 on the dark popover — both above the 4.5 it was said to fail.
    await expect
      .poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity), {
        timeout: 5_000,
      })
      .toBe("1");

    const results = await scanEditorChrome(page).analyze();
    const summary = results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.length,
      first: violation.nodes[0]?.html.slice(0, 100),
    }));
    if (summary.length > 0) console.log(JSON.stringify(summary, null, 2));

    expect(summary).toEqual([]);
  });

  test("the section tree can be operated without a mouse", async ({ page }) => {
    await openEditor(page);
    const hero = page.getByRole("button", { name: "hero", exact: true });

    await hero.focus();
    await page.keyboard.press("Enter");

    // Selecting from the keyboard has to do what clicking does, or the tree is
    // decorative for anyone who cannot use a pointer.
    await expect(hero).toHaveAttribute("data-active", "true");
  });

  test("closing a dialog returns focus to the control that opened it", async ({
    page,
  }) => {
    await openEditor(page);
    const history = page.getByRole("button", { name: "Release history" });

    await history.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog").first()).toBeHidden();

    // Without this the keyboard user is dropped at the top of the document and
    // has to tab back through the whole toolbar to where they were.
    await expect(history).toBeFocused();
  });

  test("tabbing through the editor never stops on an unreachable control", async ({
    page,
  }) => {
    await openEditor(page);

    // Walked as a cycle rather than a fixed number of presses. Focus entering
    // the preview stays on the iframe element for as many presses as the
    // Theme has focusable content, and that count changes with what the
    // preview has finished loading — so any fixed count lands somewhere
    // different each run. Reaching BODY is the end of the document, not an
    // escape: the next press starts the cycle again.
    const stops: Array<{
      tag: string;
      name: string;
      visible: boolean;
      devtools: boolean;
    }> = [];
    let boundaries = 0;
    for (let press = 0; press < 200 && boundaries < 2; press += 1) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) {
          return { tag: "BODY", name: "", visible: true, devtools: false };
        }
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          name: (
            element.getAttribute("aria-label") ??
            element.getAttribute("title") ??
            element.textContent ??
            ""
          )
            .trim()
            .slice(0, 80),
          visible: rect.width > 0 && rect.height > 0,
          // Development tooling is not part of the editor's own tab order and
          // is not shipped, so it is not this test's to vouch for.
          devtools: Boolean(
            element.closest(
              "[data-tsrd],[data-tsqd],[id*=devtools i],[class*=devtools i]",
            ),
          ),
        };
      });
      if (stop.tag === "BODY") boundaries += 1;
      stops.push(stop);
    }

    const controls = stops.filter(
      (stop) =>
        stop.tag !== "BODY" &&
        // Focus inside the preview keeps the iframe as the active element, so
        // the whole frame is one stop from out here and has no name of its own.
        stop.tag !== "IFRAME" &&
        !stop.devtools,
    );
    // Guards against a cycle that never reached the editor at all, which would
    // otherwise satisfy every assertion below by having nothing to check.
    expect(
      controls.length,
      "the tab cycle reached no editor control",
    ).toBeGreaterThan(10);

    // A focus stop nobody can see is a place the keyboard goes and the eye
    // cannot follow; one with no name is a place a screen reader cannot
    // announce.
    expect(
      controls.filter((stop) => !stop.visible).map((stop) => stop.tag),
    ).toEqual([]);
    expect(
      controls.filter((stop) => stop.name.length === 0).map((stop) => stop.tag),
    ).toEqual([]);
  });
});
