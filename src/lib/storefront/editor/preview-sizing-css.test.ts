// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  PREVIEW_HEIGHT_SELECTORS,
  PREVIEW_MIN_HEIGHT_SELECTORS,
  PREVIEW_SIZING_CSS,
} from "./preview-sizing-css";

/** A theme element mounted where the preview rules apply. */
function element(className: string, sourceFile = true) {
  const root = document.createElement("div");
  root.setAttribute("data-storefront-preview-root", "");
  const node = document.createElement("div");
  node.className = className;
  if (sourceFile) node.setAttribute("data-morph-source-file", "routes/x.tsx");
  root.appendChild(node);
  document.body.appendChild(root);
  return node;
}

const matchesAny = (node: Element, selectors: readonly string[]) =>
  selectors.some((selector) => node.matches(selector));

describe("preview sizing selectors", () => {
  // `[class*="h-screen"]` is a substring test, so it also caught
  // `min-h-screen`: a page asking for a minimum was pinned to exactly the
  // viewport height, and everything below the fold was cut off.
  it("never pins a min-height class to a fixed height", () => {
    for (const className of [
      "min-h-screen",
      "min-h-svh",
      "min-h-dvh",
      "min-h-lvh",
      "min-h-[100vh]",
    ]) {
      const node = element(className);
      expect(matchesAny(node, PREVIEW_HEIGHT_SELECTORS)).toBe(false);
      expect(matchesAny(node, PREVIEW_MIN_HEIGHT_SELECTORS)).toBe(true);
    }
  });

  it("still pins a real viewport height class", () => {
    for (const className of ["h-screen", "h-svh", "h-lvh", "h-[100dvh]"]) {
      const node = element(className);
      expect(matchesAny(node, PREVIEW_HEIGHT_SELECTORS)).toBe(true);
    }
  });

  it("covers responsive variants and elements without a source file", () => {
    expect(matchesAny(element("md:h-screen"), PREVIEW_HEIGHT_SELECTORS)).toBe(
      true,
    );
    expect(
      matchesAny(element("h-screen", false), PREVIEW_HEIGHT_SELECTORS),
    ).toBe(true);
    expect(
      matchesAny(element("lg:min-h-screen"), PREVIEW_MIN_HEIGHT_SELECTORS),
    ).toBe(true);
  });

  // `max-h-screen` caps a scroll area; forcing it to the viewport height would
  // change what the author asked for.
  it("leaves unrelated height utilities alone", () => {
    for (const className of ["max-h-screen", "h-full", "min-h-0"]) {
      const node = element(className);
      expect(matchesAny(node, PREVIEW_HEIGHT_SELECTORS)).toBe(false);
      expect(matchesAny(node, PREVIEW_MIN_HEIGHT_SELECTORS)).toBe(false);
    }
  });

  it("resolves both rules against the editor viewport token", () => {
    expect(PREVIEW_SIZING_CSS).toContain(
      "min-height: var(--storefront-preview-viewport-height, 100vh) !important;",
    );
    expect(PREVIEW_SIZING_CSS).toContain(
      "height: var(--storefront-preview-viewport-height, 100vh) !important;",
    );
  });
});
