/**
 * The shell's sections are derived the same way a route's are.
 *
 * A header is a section that happens to be on every page, so it reaches the
 * editor, the store and the runtime through the slot contract rather than
 * through a second mechanism built beside it.
 */
import { describe, expect, it } from "vitest";
import { deriveThemeLayoutSections } from "./theme-route-sections";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import {
  STOREFRONT_LAYOUT_FOOTER_SLOT_ID,
  STOREFRONT_LAYOUT_HEADER_SLOT_ID,
} from "../default-storefront-document";

const files = STARTER_THEME_FILES.map((file) => ({
  path: file.path,
  content: file.content,
}));

describe("layout sections derived from the starter shell", () => {
  it("derives one section per slot the shell declares", () => {
    const derived = deriveThemeLayoutSections(files);

    expect(derived.diagnostics).toEqual([]);
    expect(derived.sections.map((section) => section.slotId)).toEqual([
      STOREFRONT_LAYOUT_HEADER_SLOT_ID,
      STOREFRONT_LAYOUT_FOOTER_SLOT_ID,
    ]);
    expect(derived.sections.map((section) => section.layoutPlacement)).toEqual([
      "before-page",
      "after-page",
    ]);
  });

  it("places layout slots around either children or a direct Outlet", () => {
    const manifest = JSON.stringify({
      documentLayout: { source: "src/layouts/Shell.tsx", export: "default" },
    });
    const customFiles = [
      { path: "morph.theme.json", content: manifest },
      {
        path: "src/layouts/Shell.tsx",
        content: `import { Outlet } from "@tanstack/react-router";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { content } from "../morph/content";
function Helper({ children }: { children: React.ReactNode }) {
  return <aside>{children}</aside>;
}
export default function Shell() {
  return <><Header {...content("header")} /><Outlet /><Footer {...content("footer")} /></>;
}`,
      },
      {
        path: "src/components/Header.tsx",
        content: "export default function Header() { return <header />; }",
      },
      {
        path: "src/components/Footer.tsx",
        content: "export default function Footer() { return <footer />; }",
      },
    ];

    expect(
      deriveThemeLayoutSections(customFiles).sections.map((section) => [
        section.slotId,
        section.layoutPlacement,
      ]),
    ).toEqual([
      ["header", "before-page"],
      ["footer", "after-page"],
    ]);
  });

  it("names a section type per component rather than one shared 'layout'", () => {
    const derived = deriveThemeLayoutSections(files);

    expect(
      derived.sections.map((section) => ({
        type: section.sectionType,
        ref: section.componentRef,
        source: section.componentSourcePath,
      })),
    ).toEqual([
      {
        type: "header",
        ref: "header.default",
        source: "src/components/Header.tsx",
      },
      {
        type: "footer",
        ref: "footer.default",
        source: "src/components/Footer.tsx",
      },
    ]);
  });

  it("returns nothing when the manifest declares no shell", () => {
    const withoutLayout = files.filter(
      (file) => file.path !== "morph.theme.json",
    );

    expect(deriveThemeLayoutSections(withoutLayout).sections).toEqual([]);
  });
});
