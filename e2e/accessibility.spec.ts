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
      first: violation.nodes[0]?.target.join(" "),
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
    await page.getByRole("button", { name: /History/ }).click();
    await expect(page.getByRole("dialog").first()).toBeVisible();

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
    const history = page.getByRole("button", { name: /History/ });

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

    const stops: string[] = [];
    for (let press = 0; press < 24; press += 1) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element || element === document.body) return "BODY";
          const visible = element.getBoundingClientRect().width > 0;
          return visible ? "ok" : `INVISIBLE:${element.outerHTML.slice(0, 80)}`;
        }),
      );
    }

    // A focus stop nobody can see is a place the keyboard goes and the eye
    // cannot follow; landing on BODY mid-run means focus escaped the editor.
    expect(stops.filter((stop) => stop !== "ok")).toEqual([]);
  });
});
