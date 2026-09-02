// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeThemeComponent } from "@/components/storefront/safe-theme-component-renderer";
import { resolveThemeLinksInSlotValues } from "./theme-link";
import {
  STARTER_THEME_FOOTER_SOURCE,
  STARTER_THEME_HEADER_SOURCE,
} from "./starter-theme-v3-files";

/**
 * The starter Header and Footer used to hard-code their navigation, so a store
 * could only change its menu by editing the Theme. These cover the props path
 * that replaced it, including the defaults a brand new store renders with.
 */
function render(
  path: string,
  source: string,
  componentName: string,
  props: Record<string, unknown> = {},
) {
  const result = renderSafeThemeComponent({
    files: [{ path, content: source }],
    sourcePath: path,
    componentName,
    props: resolveThemeLinksInSlotValues(props),
  } as never);
  expect(result.success, result.success ? "" : result.diagnostics.join("; ")).toBe(
    true,
  );
  if (!result.success) throw new Error("render failed");
  return renderToStaticMarkup(result.node as never);
}

const renderHeader = (props?: Record<string, unknown>) =>
  render("src/components/Header.tsx", STARTER_THEME_HEADER_SOURCE, "Header", props);

const renderFooter = (props?: Record<string, unknown>) =>
  render("src/components/Footer.tsx", STARTER_THEME_FOOTER_SOURCE, "Footer", props);

describe("starter Header navigation", () => {
  it("renders its default menu when a store has stored nothing", () => {
    const html = renderHeader();

    expect(html).toContain('href="/collections/all"');
    expect(html).toContain(">Shop</a>");
    expect(html).toContain('href="/pages/about"');
    expect(html).toContain('href="/blogs/journal"');
    expect(html).toContain('href="/cart"');
    expect(html).toContain("Cart (0)");
  });

  it("renders a menu the store replaced", () => {
    const html = renderHeader({
      navItems: [
        { label: "Lookbook", link: { href: "/collections/lookbook" } },
        { label: "Stockists", link: { href: "/pages/stockists" } },
      ],
    });

    expect(html).toContain('href="/collections/lookbook"');
    expect(html).toContain(">Lookbook</a>");
    expect(html).toContain(">Stockists</a>");
    // The replaced menu is the whole menu, not an addition to the default.
    expect(html).not.toContain(">Journal</a>");
  });

  it("protects an external menu link opened in a new tab", () => {
    const html = renderHeader({
      navItems: [
        {
          label: "Instagram",
          link: { href: "https://instagram.com/store", target: "_blank" },
        },
      ],
    });

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders no menu links when the store empties the menu", () => {
    const html = renderHeader({ navItems: [] });

    expect(html).not.toContain(">Shop</a>");
    // The cart is its own field, so it survives an empty menu.
    expect(html).toContain("Cart (0)");
  });
});

describe("starter Footer navigation", () => {
  it("renders both default link columns", () => {
    const html = renderFooter();

    expect(html).toContain("Explore");
    expect(html).toContain('href="/collections/all"');
    expect(html).toContain(">Shop all</a>");
    expect(html).toContain("Help");
    expect(html).toContain('href="/pages/returns"');
  });

  it("renders columns the store replaced", () => {
    const html = renderFooter({
      exploreHeading: "Browse",
      exploreItems: [{ label: "New in", link: { href: "/collections/new" } }],
    });

    expect(html).toContain("Browse");
    expect(html).toContain(">New in</a>");
    expect(html).not.toContain(">Our story</a>");
    // The untouched column keeps its defaults.
    expect(html).toContain(">Contact</a>");
  });

  it("renders the tagline from content", () => {
    const html = renderFooter({ tagline: "Made slowly, kept for years." });
    expect(html).toContain("Made slowly, kept for years.");
  });
});
