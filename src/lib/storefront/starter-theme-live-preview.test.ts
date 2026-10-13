/**
 * Every starter Theme generation renders in the real React Live Preview.
 *
 * `interpreter-parity.test.ts` compared the interpreter with real React for
 * these components. Once the canvas runs real React, the comparison has no
 * second side; what is left worth holding is the real side itself: the
 * preview's source pass accepts every file a store can have been given, and
 * React renders the result without an error. A starter that broke here would
 * be broken on every new store's canvas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
} from "./default-storefront-document";
import { STARTER_THEME_CATALOG_FILES } from "./starter-theme-catalog-files";
import { STARTER_THEME_FILES } from "./starter-theme-files";
import {
  STARTER_THEME_V3_NEW_FILES,
  STARTER_THEME_V4_NEW_FILES,
} from "./starter-theme-v3-files";
import {
  renderLivePreviewComponent,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

// Later definitions win: the versioned sets replace files the base set also
// carries, the same way an upgrade replaces them in a workspace.
const files = Array.from(
  new Map(
    [
      ...STARTER_THEME_FILES,
      ...STARTER_THEME_V3_NEW_FILES,
      ...STARTER_THEME_V4_NEW_FILES,
      ...STARTER_THEME_CATALOG_FILES,
    ].map((file) => [file.path, { path: file.path, content: file.content }]),
  ).values(),
);

const COMPONENTS = files
  .map((file) => file.path)
  .filter(
    (path) =>
      path.startsWith("src/components/") &&
      !path.startsWith("src/components/sections/") &&
      path.endsWith(".tsx") &&
      // Rendered by their routes below, from their loaders' data.
      !path.endsWith("/ProductList.tsx") &&
      !path.endsWith("/ProductDetail.tsx"),
  )
  .sort();

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe("the starter in the real React Live Preview", () => {
  it("has components to render", () => {
    // Guards the list itself: a filter that matched nothing would pass every
    // test below by running none of them.
    expect(COMPONENTS).toEqual([
      "src/components/CategoryShowcase.tsx",
      "src/components/EditorialIntro.tsx",
      "src/components/Footer.tsx",
      "src/components/Header.tsx",
      "src/components/Hero.tsx",
      "src/components/ImageWithText.tsx",
      "src/components/Newsletter.tsx",
      "src/components/Principles.tsx",
    ]);
  });

  for (const sourcePath of COMPONENTS) {
    it(`renders ${sourcePath.replace("src/components/", "")} with its defaults`, async () => {
      const { html, prepared } = await renderLivePreviewComponent({
        files,
        sourcePath,
      });

      expect(prepared.bindings.skipped).toEqual([]);
      expect(html.length).toBeGreaterThan(120);
      expect(html).toContain("data-morph-loc");
      expect(errors.mock.calls).toEqual([]);
    });
  }

  it("renders the home route inside the shell, from its Documents", async () => {
    const { html, prepared } = await renderLivePreviewRoute({
      files,
      documents: {
        index: createDefaultStorefrontHomeDocument(),
        layout: createDefaultStorefrontLayoutDocument(),
      },
    });

    expect(prepared.bindings.skipped).toEqual([]);
    for (const section of [
      ...createDefaultStorefrontLayoutDocument().sections,
      ...createDefaultStorefrontHomeDocument().sections,
    ]) {
      expect(html).toContain(`data-storefront-section-id="${section.id}"`);
    }
    expect(errors.mock.calls).toEqual([]);
  });
});
