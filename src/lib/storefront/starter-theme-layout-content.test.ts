/**
 * The layout shell must not shadow what Header and Footer declare.
 *
 * A layout root has no Document slot, so the inspector's only write path for
 * one is patching the component's default props. A call-site attribute in the
 * layout beats exactly that, which made every Header and Footer content edit a
 * silent no-op: the source was patched, saved, and then rendered away.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import { patchComponentDefaultProp } from "./ast/theme-ast-transformer";
import {
  createDefaultStorefrontHomeDocument,
  STOREFRONT_LAYOUT_FOOTER_SLOT_ID,
  STOREFRONT_LAYOUT_HEADER_SLOT_ID,
} from "./default-storefront-document";
import {
  createStarterThemeWorkspaceUpgrade,
  STARTER_THEME_FILES,
} from "./starter-theme-files";
import { resolveThemeContentCapabilitiesFromFiles } from "./theme-content-capability-resolver";
import {
  LEGACY_STARTER_THEME_FOOTER_MARKED_SOURCE,
  LEGACY_STARTER_THEME_FOOTER_UNMARKED_SOURCE,
  LEGACY_STARTER_THEME_HEADER_MARKED_SOURCE,
  LEGACY_STARTER_THEME_HEADER_UNMARKED_SOURCE,
  LEGACY_STARTER_THEME_LAYOUT_MARKED_SOURCE,
  STARTER_THEME_FOOTER_SOURCE,
  STARTER_THEME_HEADER_SOURCE,
  STARTER_THEME_INDEX_SOURCE,
  STARTER_THEME_LAYOUT_SOURCE,
} from "./starter-theme-v3-files";

function starterFiles(): Array<{ path: string; content: string }> {
  return STARTER_THEME_FILES.map((file) => ({
    path: file.path,
    content: file.content,
  }));
}

function renderHome(files: Array<{ path: string; content: string }>): string {
  const result = renderSafeThemeRoute({
    files,
    pathname: "/",
    document: createDefaultStorefrontHomeDocument(),
  } as never);
  expect(result.diagnostics).toEqual([]);
  expect(result.success).toBe(true);
  return renderToStaticMarkup(result.node as never);
}

describe("starter layout and the layout components' own props", () => {
  it("renders a patched Header default instead of a layout-owned value", () => {
    const files = starterFiles();
    const header = files.find(
      (file) => file.path === "src/components/Header.tsx",
    )!;
    header.content = patchComponentDefaultProp(
      header.content,
      "storeName",
      "Patched Store",
    );

    expect(renderHome(files)).toContain("Patched Store");
  });

  it("renders a patched Footer default instead of a layout-owned value", () => {
    const files = starterFiles();
    const footer = files.find(
      (file) => file.path === "src/components/Footer.tsx",
    )!;
    footer.content = patchComponentDefaultProp(
      footer.content,
      "copyrightText",
      "© Patched",
    );

    expect(renderHome(files)).toContain("© Patched");
  });

  it("reads header and footer content from a slot rather than owning it", () => {
    expect(STARTER_THEME_LAYOUT_SOURCE).toContain(
      `<Header {...content("${STOREFRONT_LAYOUT_HEADER_SLOT_ID}")} />`,
    );
    expect(STARTER_THEME_LAYOUT_SOURCE).toContain(
      `<Footer {...content("${STOREFRONT_LAYOUT_FOOTER_SLOT_ID}")} />`,
    );
  });
});

describe("layout component upgrades reach every emitted generation", () => {
  const generations = [
    {
      name: "markers still present",
      header: LEGACY_STARTER_THEME_HEADER_MARKED_SOURCE,
      footer: LEGACY_STARTER_THEME_FOOTER_MARKED_SOURCE,
      layout: LEGACY_STARTER_THEME_LAYOUT_MARKED_SOURCE,
    },
    {
      name: "markers removed",
      header: LEGACY_STARTER_THEME_HEADER_UNMARKED_SOURCE,
      footer: LEGACY_STARTER_THEME_FOOTER_UNMARKED_SOURCE,
      layout: STARTER_THEME_INDEX_SOURCE,
    },
  ] as const;

  for (const generation of generations) {
    it(`upgrades Header, Footer and the layout with ${generation.name}`, () => {
      const existing = STARTER_THEME_FILES.map((file, index) => ({
        ...file,
        id: String(index),
        version: 1,
        content:
          file.path === "src/components/Header.tsx"
            ? generation.header
            : file.path === "src/components/Footer.tsx"
              ? generation.footer
              : file.path === "src/layouts/StorefrontLayout.tsx"
                ? generation.layout
                : file.content,
      }));

      const upgrades = createStarterThemeWorkspaceUpgrade(existing);
      const upgradeFor = (path: string) =>
        upgrades.find((upgrade) => upgrade.path === path);

      expect(upgradeFor("src/components/Header.tsx")?.content).toBe(
        STARTER_THEME_HEADER_SOURCE,
      );
      expect(upgradeFor("src/components/Footer.tsx")?.content).toBe(
        STARTER_THEME_FOOTER_SOURCE,
      );
      expect(upgradeFor("src/layouts/StorefrontLayout.tsx")?.content).toBe(
        STARTER_THEME_LAYOUT_SOURCE,
      );
    });
  }

  it("leaves an authored Header alone", () => {
    const existing = STARTER_THEME_FILES.map((file, index) => ({
      ...file,
      id: String(index),
      version: 1,
      content:
        file.path === "src/components/Header.tsx"
          ? `${LEGACY_STARTER_THEME_HEADER_UNMARKED_SOURCE}\n// authored`
          : file.content,
    }));

    expect(
      createStarterThemeWorkspaceUpgrade(existing).some(
        (upgrade) => upgrade.path === "src/components/Header.tsx",
      ),
    ).toBe(false);
  });

  it("gives the upgraded Header and Footer every field they declare", () => {
    const files = starterFiles();
    const { capabilities } = resolveThemeContentCapabilitiesFromFiles(
      files as never,
    );

    expect(
      Object.keys(capabilities["src/components/Header.tsx"]?.fields ?? {}),
    ).toEqual(["storeName", "navItems", "cartLabel", "cartLink"]);
    expect(
      Object.keys(capabilities["src/components/Footer.tsx"]?.fields ?? {}),
    ).toEqual([
      "storeName",
      "copyrightText",
      "tagline",
      "exploreHeading",
      "exploreItems",
      "helpHeading",
      "helpItems",
    ]);
  });
});
