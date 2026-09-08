/**
 * The shell's content reaches the page the same way a section's does.
 *
 * Header and footer used to be editable only by patching the components' own
 * default props, which cannot hold a list or a link and which the layout's
 * call-site attributes overrode anyway. Driving the real interpreter over the
 * real starter proves the slot contract carries what the source defaults could
 * not — and that an unedited store still renders exactly what it did before.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
  STOREFRONT_LAYOUT_HEADER_SLOT_ID,
} from "./default-storefront-document";
import { STARTER_THEME_FILES } from "./starter-theme-files";
import type { StorefrontPageDocument } from "@/db/storefront.schema";

const files = STARTER_THEME_FILES.map((file) => ({
  path: file.path,
  content: file.content,
}));

/**
 * The document the canvas and the runtime both see: the shell's sections
 * followed by the page's, which is how the two stores meet on one page.
 */
function combined(
  layout: StorefrontPageDocument = createDefaultStorefrontLayoutDocument(),
): StorefrontPageDocument {
  const page = createDefaultStorefrontHomeDocument();
  return { ...page, sections: [...layout.sections, ...page.sections] };
}

function renderHome(document: StorefrontPageDocument): string {
  const result = renderSafeThemeRoute({
    files,
    pathname: "/",
    document,
  } as never);
  expect(result.diagnostics).toEqual([]);
  expect(result.success).toBe(true);
  return renderToStaticMarkup(result.node as never);
}

type SectionProps = StorefrontPageDocument["sections"][number]["props"];

function withHeaderProps(props: SectionProps): StorefrontPageDocument {
  const layout = createDefaultStorefrontLayoutDocument();
  return combined({
    ...layout,
    sections: layout.sections.map((section) =>
      section.id === STOREFRONT_LAYOUT_HEADER_SLOT_ID
        ? { ...section, props: { ...section.props, ...props } }
        : section,
    ),
  });
}

describe("shell content stored in the layout document", () => {
  it("renders the seeded values, matching what the source declared", () => {
    const html = renderHome(combined());

    expect(html).toContain("Online Store");
    expect(html).toContain("Shop");
    expect(html).toContain("Journal");
    expect(html).toContain("Cart (0)");
    expect(html).toContain("© Online Store");
  });

  it("renders an edited store name", () => {
    expect(
      renderHome(withHeaderProps({ storeName: "Kinfolk Supply" })),
    ).toContain("Kinfolk Supply");
  });

  it("renders a navigation list the source defaults could never hold", () => {
    const html = renderHome(
      withHeaderProps({
        navItems: [
          { label: "Ceramics", link: { href: "/collections/ceramics" } },
          { label: "Contact", link: { href: "/pages/contact" } },
        ],
      }),
    );

    expect(html).toContain("Ceramics");
    expect(html).toContain('href="/collections/ceramics"');
    expect(html).toContain("Contact");
    // Replaced rather than merged: the stored list is the whole list. "About"
    // is the seeded nav's own entry — the footer never renders that word.
    expect(html).not.toContain(">About<");
  });

  it("renders an edited link destination", () => {
    const html = renderHome(
      withHeaderProps({ cartLink: { href: "/checkout" } }),
    );

    expect(html).toContain('href="/checkout"');
  });

  it("hides the header when the shell section is disabled", () => {
    const layout = createDefaultStorefrontLayoutDocument();
    const html = renderHome(
      combined({
        ...layout,
        sections: layout.sections.map((section) =>
          section.id === STOREFRONT_LAYOUT_HEADER_SLOT_ID
            ? { ...section, enabled: false }
            : section,
        ),
      }),
    );

    expect(html).not.toContain("Cart (0)");
    // The footer is a separate section and stays.
    expect(html).toContain("© Online Store");
  });
});
