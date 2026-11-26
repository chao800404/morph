// @vitest-environment node
/**
 * Hide on the safe route renderer, over the real current Starter.
 *
 * Hide means the section is gone from the preview and from publish. The
 * `/_editor/.../preview` route renders through `renderSafeThemeRoute`, so a
 * page section stored with `enabled: false` must not come back here as the
 * component rendered from its own prop defaults.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "@/lib/storefront/default-storefront-document";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { renderSafeThemeRoute } from "./safe-theme-route-renderer";

const files = STARTER_THEME_FILES.map((file) => ({
  path: file.path,
  content: file.content,
}));

const NEWSLETTER_SLOT = "starter-newsletter";

function homeDocument(hiddenSlot?: string): StorefrontPageDocument {
  const layout = createDefaultStorefrontLayoutDocument();
  const page = createDefaultStorefrontHomeDocument();
  return {
    ...page,
    sections: [
      ...layout.sections,
      ...page.sections.map((section) =>
        section.id === hiddenSlot ? { ...section, enabled: false } : section,
      ),
    ],
  };
}

function renderHome(document: StorefrontPageDocument): string {
  const result = renderSafeThemeRoute({ files, pathname: "/", document });
  expect(result.diagnostics).toEqual([]);
  expect(result.success).toBe(true);
  return renderToStaticMarkup(result.node as never);
}

describe("hidden page section on the safe route renderer (current Starter)", () => {
  it("uses the current Starter template", () => {
    // 32: its routes and layout are 31's; only the content module changed.
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(32);
    expect(
      createDefaultStorefrontHomeDocument().sections.some(
        (section) => section.id === NEWSLETTER_SLOT,
      ),
    ).toBe(true);
  });

  it("renders the newsletter when it is shown", () => {
    const html = renderHome(homeDocument());
    expect(html).toContain("A quieter kind of inbox.");
  });

  it("removes the newsletter, defaults included, when it is hidden", () => {
    const html = renderHome(homeDocument(NEWSLETTER_SLOT));
    // Other sections still render.
    expect(html).toContain("<main");
    // Neither the seeded copy nor the Newsletter component's own defaults.
    expect(html).not.toContain("A quieter kind of inbox.");
    expect(html).not.toContain("Join our newsletter");
    expect(html).not.toContain("Stay connected");
    expect(html).not.toContain("Enter your email");
  });
});
