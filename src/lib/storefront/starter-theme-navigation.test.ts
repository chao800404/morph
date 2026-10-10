// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeThemeComponent } from "@/components/storefront/safe-theme-component-renderer";
import { resolveThemeLinksInSlotValues } from "./theme-link";
import { renderLivePreviewRoute } from "@/lib/test-utils/live-preview-render";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
  STOREFRONT_LAYOUT_FOOTER_SLOT_ID,
  STOREFRONT_LAYOUT_HEADER_SLOT_ID,
} from "./default-storefront-document";
import { STARTER_THEME_FILES } from "./starter-theme-files";
import type { StorefrontPageDocument } from "@/db/storefront.schema";

type SectionProps = StorefrontPageDocument["sections"][number]["props"];
import {
  STARTER_THEME_FOOTER_SOURCE,
  STARTER_THEME_HEADER_SOURCE,
  STARTER_THEME_LINK_MODULE_SOURCE,
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
    // The shared destination component travels with the starter, so a render
    // of one component in isolation still has to be given the module it
    // imports — the same way the build resolves it.
    files: [
      { path, content: source },
      {
        path: "src/morph/link.tsx",
        content: STARTER_THEME_LINK_MODULE_SOURCE,
      },
    ],
    sourcePath: path,
    componentName,
    props: resolveThemeLinksInSlotValues(props),
  } as never);
  expect(
    result.success,
    result.success ? "" : result.diagnostics.join("; "),
  ).toBe(true);
  if (!result.success) throw new Error("render failed");
  return renderToStaticMarkup(result.node as never);
}

const renderHeader = (props?: Record<string, unknown>) =>
  render(
    "src/components/Header.tsx",
    STARTER_THEME_HEADER_SOURCE,
    "Header",
    props,
  );

const renderFooter = (props?: Record<string, unknown>) =>
  render(
    "src/components/Footer.tsx",
    STARTER_THEME_FOOTER_SOURCE,
    "Footer",
    props,
  );

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

/**
 * The same menus in the real React Live Preview, with the values stored the
 * way the editor stores them: on the layout Document's Header and Footer
 * sections. Links reach the Theme already resolved (`rel` included) by the
 * content resolution the preview snapshot and the published site share.
 */
describe("starter navigation in real React", () => {
  const starter = STARTER_THEME_FILES.map((file) => ({
    path: file.path,
    content: file.content,
  }));

  async function renderShell(
    slotProps: Record<string, SectionProps>,
    files = starter,
  ): Promise<string> {
    const layout = createDefaultStorefrontLayoutDocument();
    const { html } = await renderLivePreviewRoute({
      files,
      documents: {
        index: createDefaultStorefrontHomeDocument(),
        layout: {
          ...layout,
          // Stored values replace the seeded ones for the slots a test names,
          // and nothing is stored for the others: what a new store holds.
          sections: layout.sections.map((section) => ({
            ...section,
            props: slotProps[section.id] ?? {},
          })),
        },
      },
    });
    return html;
  }
  const header = (props: SectionProps) => ({
    [STOREFRONT_LAYOUT_HEADER_SLOT_ID]: props,
  });
  const footer = (props: SectionProps) => ({
    [STOREFRONT_LAYOUT_FOOTER_SLOT_ID]: props,
  });
  const nav = (html: string) =>
    html.slice(html.indexOf("<header"), html.indexOf("</header>"));

  it("renders the Header's default menu when a store has stored nothing", async () => {
    const html = nav(await renderShell({}));

    expect(html).toContain('href="/collections/all"');
    expect(html).toContain(">Shop</a>");
    expect(html).toContain('href="/pages/about"');
    expect(html).toContain('href="/blogs/journal"');
    expect(html).toContain('href="/cart"');
    expect(html).toContain("Cart (0)");
  });

  it("renders a menu the store replaced", async () => {
    const html = nav(
      await renderShell(
        header({
          navItems: [
            { label: "Lookbook", link: { href: "/collections/lookbook" } },
            { label: "Stockists", link: { href: "/pages/stockists" } },
          ],
        }),
      ),
    );

    expect(html).toContain('href="/collections/lookbook"');
    expect(html).toContain(">Lookbook</a>");
    expect(html).toContain(">Stockists</a>");
    expect(html).not.toContain(">Journal</a>");
  });

  const instagram = header({
    navItems: [
      {
        label: "Instagram",
        link: { href: "https://instagram.com/store", target: "_blank" },
      },
    ],
  });

  it("protects an external menu link opened in a new tab", async () => {
    const html = nav(await renderShell(instagram));

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("would notice a link component that dropped the protection", async () => {
    // The protection is worked out before the value reaches the Theme and
    // applied by the Theme's link component. A link component that stopped
    // forwarding it must leave the new tab unprotected here.
    const unprotected = starter.map((file) =>
      file.path === "src/morph/link.tsx"
        ? {
            ...file,
            content: file.content.replaceAll("rel={destination.rel}", ""),
          }
        : file,
    );
    expect(
      unprotected.find((file) => file.path === "src/morph/link.tsx")?.content,
    ).not.toContain("rel={destination.rel}");

    const html = nav(await renderShell(instagram, unprotected));
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("noopener");
  });

  it("renders no menu links when the store empties the menu", async () => {
    const html = nav(await renderShell(header({ navItems: [] })));

    expect(html).not.toContain(">Shop</a>");
    expect(html).toContain("Cart (0)");
  });

  it("renders both default Footer link columns", async () => {
    const html = await renderShell({});

    expect(html).toContain("Explore");
    expect(html).toContain(">Shop all</a>");
    expect(html).toContain("Help");
    expect(html).toContain('href="/pages/returns"');
  });

  it("renders Footer columns the store replaced", async () => {
    const html = await renderShell(
      footer({
        exploreHeading: "Browse",
        exploreItems: [{ label: "New in", link: { href: "/collections/new" } }],
      }),
    );

    expect(html).toContain("Browse");
    expect(html).toContain(">New in</a>");
    expect(html).not.toContain(">Our story</a>");
    expect(html).toContain(">Contact</a>");
  });

  it("renders the Footer tagline from content", async () => {
    expect(
      await renderShell(footer({ tagline: "Made slowly, kept for years." })),
    ).toContain("Made slowly, kept for years.");
  });
});
