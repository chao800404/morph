import AxeBuilder from "@axe-core/playwright";
import type { AxeResults } from "axe-core";
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
 * The editor's own surfaces, without the Theme rendered inside the preview.
 *
 * `exclude("iframe")` is here to keep someone else's markup out of this
 * project's results, and it does that: the Theme in the canvas fails
 * `color-contrast` on eight nodes of its own (`src/components/Hero.tsx`,
 * `src/components/Principles.tsx`), which nobody here can fix and which would
 * bury the ones they can.
 *
 * It does not cost coverage, which is worth stating because an earlier version
 * of this comment claimed at length that it did — that excluding the frame left
 * axe unable to resolve a background for chrome overlapping it, pushing real
 * failures into `incomplete` as `bgOverlap`. Measured over four fresh page
 * loads with the release table's header regressed back to `muted-foreground` on
 * `bg-accent`, the two configurations are identical on the editor's own
 * document: 0 violations, 9 incomplete, 38 passes, every round, whether the
 * frame is excluded or scanned and then filtered out of the results by frame
 * depth. The nine unresolved nodes are unresolved either way, because the
 * iframe *element* is an opaque box in the parent's layout regardless of
 * whether axe was allowed inside it.
 *
 * Also measured, and the reason the test below exists: in six runs against that
 * regression, axe reported those `<th>`s once. The other five times they were
 * in no bucket at all — not `violations`, not `incomplete`, not `passes` — so
 * this suite is not what stands between that defect and a release.
 *
 * Tried and rejected: `include("[data-morph-editor]")` does not scope frames at
 * all (@axe-core/playwright injects into every frame Playwright can reach, so a
 * cross-origin preview is no barrier) and returns the unexcluded result, Theme
 * violations included. `setLegacyMode(true)` reports the same nine as
 * incomplete; scoping to `[role="dialog"]` reports neither a violation nor an
 * incomplete.
 *
 * `summarizeViolations` prints what went to `incomplete` so the gap is visible
 * in a passing run rather than silent.
 */
function scanEditorChrome(page: Page) {
  return new AxeBuilder({ page })
    .exclude("iframe")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
}

/**
 * The contrast of a colour pair, measured in the page rather than reasoned about.
 *
 * Colours are resolved through a canvas because the tokens are authored as
 * `oklch(...)` and WCAG luminance is defined on sRGB. `fillStyle` keeps its
 * previous value when handed something it cannot parse, so a sentinel is
 * checked: an unparsable token returns null and fails the test rather than
 * quietly measuring black.
 */
async function measureTokenContrast(
  page: Page,
  foregroundToken: string,
  backgroundToken: string,
) {
  return page.evaluate(
    ([foregroundName, backgroundName]) => {
      const toRgb = (value: string): [number, number, number] | null => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) return null;
        const sentinel = "#123456";
        context.fillStyle = sentinel;
        context.fillStyle = value;
        if (context.fillStyle === sentinel && value !== sentinel) return null;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        return [red, green, blue];
      };

      const luminance = ([red, green, blue]: [number, number, number]) => {
        const channel = (value: number) => {
          const ratio = value / 255;
          return ratio <= 0.04045
            ? ratio / 12.92
            : ((ratio + 0.055) / 1.055) ** 2.4;
        };
        return (
          0.2126 * channel(red) +
          0.7152 * channel(green) +
          0.0722 * channel(blue)
        );
      };

      const root = getComputedStyle(document.documentElement);
      const foreground = root.getPropertyValue(foregroundName).trim();
      const background = root.getPropertyValue(backgroundName).trim();
      const foregroundRgb = foreground ? toRgb(foreground) : null;
      const backgroundRgb = background ? toRgb(background) : null;
      if (!foregroundRgb || !backgroundRgb) {
        return { ratio: null, foreground, background };
      }

      const [darker, lighter] = [
        luminance(foregroundRgb),
        luminance(backgroundRgb),
      ].sort((left, right) => left - right);
      return {
        ratio: Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100,
        foreground,
        background,
      };
    },
    [foregroundToken, backgroundToken] as const,
  );
}

/**
 * Holds the pair the table header actually uses to AA.
 *
 * Asserted on the tokens, not on a rendered header, and that is deliberate. The
 * first version of this test measured the release history table directly and
 * timed out in the full suite: those rows arrive from a query, and under
 * parallel workers they did not arrive inside sixty seconds. A guard that
 * depends on data arriving is not a guard. The tokens are present the moment the
 * document has a stylesheet.
 *
 * `--foreground` on `--accent` is the pairing `TableHeader` sets explicitly. It
 * has to be explicit: `bg-accent` is a state surface, and the inherited
 * `muted-foreground` on it is 4.39:1 in light against the 4.5 AA asks for —
 * while being 5.66:1 in dark, which is how it stayed hidden for as long as it
 * did. Both themes run this, so neither can carry the other.
 */
async function expectAccentSurfaceReadable(page: Page) {
  await openEditor(page);
  const measured = await measureTokenContrast(page, "--foreground", "--accent");
  expect(
    measured.ratio,
    `could not resolve the pair: ${JSON.stringify(measured)}`,
  ).not.toBeNull();
  expect(
    measured.ratio,
    `--foreground (${measured.foreground}) on --accent (${measured.background})`,
  ).toBeGreaterThanOrEqual(4.5);
}

/**
 * One shape for every scan, so a failure reads the same wherever it came from.
 *
 * Carries what axe measured, not just what it objected to. Working out which
 * background a failing node actually had cost an afternoon and one wrong fix:
 * the element's class said `text-muted-foreground` and the surface behind it
 * was assumed to be the dialog's, when the table header carried a `bg-accent`
 * of its own. `measured` is axe's own colour data — foreground, background,
 * the ratio it computed and the one it expected — so the next contrast failure
 * arrives with the numbers rather than a research project.
 */
function summarizeViolations(results: AxeResults) {
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
    help: violation.help,
    // A selector like `.text-[10px]` matches half the editor; the failing
    // element and what axe measured are what make this actionable.
    first: violation.nodes[0]?.target.join(" "),
    html: violation.nodes[0]?.html.slice(0, 120),
    why: violation.nodes[0]?.any?.[0]?.message,
    measured: violation.nodes[0]?.any?.[0]?.data ?? null,
  }));
  if (summary.length > 0) console.log(JSON.stringify(summary, null, 2));

  // Printed, not asserted. These are the checks axe could not complete — for
  // contrast that is almost always `bgOverlap`, the blind spot described above.
  // A run that passes while carrying twelve of them is passing on less than it
  // appears to, and that should at least be readable.
  const unresolved = results.incomplete
    .filter((entry) => entry.id === "color-contrast")
    .map((entry) => ({ id: entry.id, nodes: entry.nodes.length }));
  if (unresolved.length > 0) {
    console.log(
      `[a11y] contrast axe could not resolve: ${JSON.stringify(unresolved)}`,
    );
  }
  return summary;
}

/**
 * The same two scans in the theme the suite does not pin.
 *
 * Colour lives in tokens that change with the theme, so a scan is a statement
 * about one of them. `playwright.config.ts` pins light because that is where
 * contrast is tightest here; this covers the other, so a token that passes in
 * one and fails in the other cannot ride on whichever the runner happened to
 * be in. That is not hypothetical — it is how `muted-foreground` on `accent`
 * stayed hidden: 4.387:1 in light, 5.663:1 in dark, and the machine decided
 * which one anybody saw.
 */
test.describe("editor accessibility in dark", () => {
  test.use({ colorScheme: "dark" });

  test("has no automatically detectable violations", async ({ page }) => {
    await openEditor(page);
    const results = await scanEditorChrome(page).analyze();
    expect(summarizeViolations(results)).toEqual([]);
  });

  test("the accent surface stays readable in dark", async ({ page }) => {
    await expectAccentSurfaceReadable(page);
  });

  test("a dialog is scannable in dark too", async ({ page }) => {
    await openEditor(page);
    await page.getByRole("button", { name: "Release history" }).click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity), {
        timeout: 5_000,
      })
      .toBe("1");

    const results = await scanEditorChrome(page).analyze();
    expect(summarizeViolations(results)).toEqual([]);
  });
});

test.describe("editor accessibility", () => {
  test("has no automatically detectable violations", async ({ page }) => {
    await openEditor(page);
    const results = await scanEditorChrome(page).analyze();

    // Reported in full: a count tells you nothing about what to fix.
    expect(summarizeViolations(results)).toEqual([]);
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

  test("the accent surface stays readable", async ({ page }) => {
    await expectAccentSurfaceReadable(page);
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
    // 0.3 is already "visible" to Playwright, so a scan can start mid-fade.
    // That is worth avoiding on its own — but it is not why this test failed,
    // and an earlier version of this comment said it was. The five
    // `color-contrast` nodes on the release table's headers are real: the
    // header is `bg-accent`, not the dialog surface, and `muted-foreground` on
    // `accent` is 4.387:1 in light mode against the 4.5 that AA asks for. The
    // figures quoted here before were measured against the wrong background.
    await expect
      .poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity), {
        timeout: 5_000,
      })
      .toBe("1");

    const results = await scanEditorChrome(page).analyze();
    expect(summarizeViolations(results)).toEqual([]);
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
