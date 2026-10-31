/**
 * Viewport-relative sizing, rewritten for the editor's live preview.
 *
 * The preview iframe is sized from the page it renders, so a shell that asks
 * for `min-h-screen` creates a loop: the frame height becomes the CSS viewport
 * height, which becomes the shell's minimum, which is reported back as the
 * frame height. These rules resolve viewport units against the editor-provided
 * viewport token instead, leaving the production theme untouched.
 *
 * Kept here rather than inline in the route so the selectors can be asserted
 * against real elements — an over-broad one silently truncates every page.
 */
const VIEWPORT_UNITS = ["screen", "svh", "dvh", "lvh"] as const;
const BREAKPOINTS = ["sm", "md", "lg", "xl", "2xl"] as const;
const ARBITRARY_UNITS = ["100vh", "100svh", "100dvh", "100lvh"] as const;

const scoped = (selector: string) =>
  `[data-storefront-preview-root] ${selector}`;

/**
 * `~=` matches a whole whitespace-separated class token.
 *
 * A substring match (`*=`) here also matched `min-h-screen`, pinning a page
 * that only asked for a minimum to exactly the viewport height: everything
 * below the fold overflowed the root and the frame reported the short height,
 * so the page appeared cut off.
 */
const token = (className: string) => `[class~="${className}"]`;

export const PREVIEW_MIN_HEIGHT_SELECTORS: readonly string[] = [
  ...VIEWPORT_UNITS.map((unit) => token(`min-h-${unit}`)),
  ...BREAKPOINTS.map((breakpoint) => token(`${breakpoint}:min-h-screen`)),
  ...ARBITRARY_UNITS.map((unit) => token(`min-h-[${unit}]`)),
].map(scoped);

export const PREVIEW_HEIGHT_SELECTORS: readonly string[] = [
  ...VIEWPORT_UNITS.map(
    (unit) => `[data-morph-source-file]${token(`h-${unit}`)}`,
  ),
  ...VIEWPORT_UNITS.map((unit) => token(`h-${unit}`)),
  ...BREAKPOINTS.map((breakpoint) => token(`${breakpoint}:h-screen`)),
  ...ARBITRARY_UNITS.map((unit) => token(`h-[${unit}]`)),
].map(scoped);

/**
 * Authored routes commonly put viewport sizing on their own `<main>`, so the
 * rules apply to descendants, not just the immediate child.
 */
export const PREVIEW_SIZING_CSS = `
  [data-storefront-preview-root] > [data-morph-source-file] {
    min-height: 0 !important;
  }
  ${PREVIEW_MIN_HEIGHT_SELECTORS.join(",\n  ")} {
    min-height: var(--storefront-preview-viewport-height, 100vh) !important;
  }
  ${PREVIEW_HEIGHT_SELECTORS.join(",\n  ")} {
    height: var(--storefront-preview-viewport-height, 100vh) !important;
  }
`;
