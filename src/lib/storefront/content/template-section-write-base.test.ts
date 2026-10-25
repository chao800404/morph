import { describe, expect, it } from "vitest";
import { templateSectionWriteBase } from "./template-section-write-base";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { ThemeRouteSectionResult } from "../compiler/theme-route-sections";

const document: StorefrontPageDocument = {
  version: 1,
  sections: [
    {
      id: "stored",
      type: "old-type",
      enabled: false,
      props: { undeclared: "keep" },
    },
  ],
};
const structure: ThemeRouteSectionResult = {
  hasContentImport: true,
  diagnostics: [],
  unboundSections: [],
  sections: ["stored", "target", "other"].map((slotId) => ({
    slotId,
    sectionType: "hero",
    componentRef: "src/components/Hero.tsx",
    componentName: "Hero",
    componentSourcePath: "src/components/Hero.tsx",
    routeSourcePath: "src/routes/index.tsx",
  })),
};
describe("one content edit, not a source projection", () => {
  it("never replaces an existing section's metadata or drops unrelated content", () => {
    expect(
      templateSectionWriteBase(
        { document, routeStructure: structure },
        "stored",
      ),
    ).toBe(document);
  });
  it("creates only the requested proven virtual slot and leaves the stored document untouched", () => {
    const result = templateSectionWriteBase(
      { document, routeStructure: structure },
      "target",
    );
    expect(result.sections).toEqual([
      document.sections[0],
      {
        id: "target",
        type: "hero",
        componentRef: "src/components/Hero.tsx",
        enabled: true,
        props: {},
      },
    ]);
    expect(document.sections).toHaveLength(1);
  });
  it("does not fabricate a slot absent from the source", () => {
    expect(
      templateSectionWriteBase(
        { document, routeStructure: structure },
        "unknown",
      ),
    ).toBe(document);
  });
  it("does not materialize any source with diagnostics", () => {
    expect(
      templateSectionWriteBase(
        {
          document,
          routeStructure: { ...structure, diagnostics: ["Broken source"] },
        },
        "target",
      ),
    ).toBe(document);
  });
  it("does not materialize a slot whose component source is missing", () => {
    expect(
      templateSectionWriteBase(
        {
          document,
          routeStructure: {
            ...structure,
            sections: structure.sections.map((section) => ({
              ...section,
              missingComponentSourcePath: "src/components/Hero.tsx",
            })),
          },
        },
        "target",
      ),
    ).toBe(document);
  });
});
