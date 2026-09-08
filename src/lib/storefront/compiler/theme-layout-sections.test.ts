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
