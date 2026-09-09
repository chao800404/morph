/**
 * One answer to "what is on this page, and who stores each part".
 *
 * The editor writes to two documents from one canvas, and every panel used to
 * work out which one for itself. The cases here are the disagreements that
 * produced: a header offered for editing with no values behind it, and an edit
 * routed into the page that was open rather than the shell that owns it.
 */
import { describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { ThemeRouteSection } from "@/lib/storefront/compiler/theme-route-sections";
import { resolveEditorSectionModel } from "./editor-section-model";

function derived(
  slotId: string,
  componentSourcePath: string,
  sectionType: string,
): ThemeRouteSection {
  return {
    slotId,
    sectionType,
    componentRef: `${sectionType}.default`,
    componentName: sectionType,
    componentSourcePath,
    routeSourcePath: "src/routes/index.tsx",
  };
}

const shellSections = [
  derived("starter-header", "src/components/Header.tsx", "header"),
  derived("starter-footer", "src/components/Footer.tsx", "footer"),
];
const pageSections = [derived("starter-hero", "src/components/Hero.tsx", "hero")];

const shellDocument: StorefrontPageDocument = {
  version: 1,
  sections: [
    {
      id: "starter-header",
      type: "header",
      enabled: true,
      props: { storeName: "Kinfolk", navItems: [{ label: "Shop" }] },
    },
    { id: "starter-footer", type: "footer", enabled: true, props: {} },
  ],
};
const pageDocument: StorefrontPageDocument = {
  version: 1,
  sections: [
    { id: "starter-hero", type: "hero", enabled: true, props: { heading: "Hi" } },
  ],
};

const shellTemplate = { id: "shell", document: shellDocument };
const pageTemplate = { id: "page", document: pageDocument };

function resolve(overrides?: Partial<Parameters<typeof resolveEditorSectionModel>[0]>) {
  return resolveEditorSectionModel({
    pageTemplate,
    shellTemplate,
    pageSections,
    pageOwnsStructure: true,
    shellSections,
    ...overrides,
  });
}

describe("the editor's section model", () => {
  it("puts the shell around the page, in that order", () => {
    expect(resolve().document.sections.map((section) => section.id)).toEqual([
      "starter-header",
      "starter-footer",
      "starter-hero",
    ]);
  });

  it("carries each section's values from the document that stores them", () => {
    const header = resolve().document.sections.find(
      (section) => section.id === "starter-header",
    );

    expect(header?.props).toEqual({
      storeName: "Kinfolk",
      navItems: [{ label: "Shop" }],
    });
  });

  it("binds every section to the template that stores it", () => {
    const { bindings } = resolve();

    expect(bindings.get("starter-header")).toEqual({
      sectionId: "starter-header",
      templateId: "shell",
      owner: "shell",
    });
    expect(bindings.get("starter-hero")).toEqual({
      sectionId: "starter-hero",
      templateId: "page",
      owner: "page",
    });
  });

  it("names the shell's sections and sources as shared", () => {
    const model = resolve();

    expect([...model.sharedSectionIds]).toEqual([
      "starter-header",
      "starter-footer",
    ]);
    expect(model.sharedSourcePaths.has("src/components/Header.tsx")).toBe(true);
  });

  it("omits the shell entirely when its template is absent", () => {
    // Offering the header for editing with nothing behind it is the failure
    // this guards: the fields render, the values are empty, and a save has
    // nowhere to go. Absent is a state to show, not one to paper over.
    const model = resolve({ shellTemplate: undefined });

    expect(model.document.sections.map((section) => section.id)).toEqual([
      "starter-hero",
    ]);
    expect(model.bindings.has("starter-header")).toBe(false);
    expect(model.sharedSectionIds.size).toBe(0);
  });

  it("keeps a route's stored sections when it declares no slots of its own", () => {
    const model = resolve({ pageSections: [], pageOwnsStructure: false });

    expect(model.document.sections.map((section) => section.id)).toEqual([
      "starter-header",
      "starter-footer",
      "starter-hero",
    ]);
  });

  it("drops a route's stored sections once it owns its structure", () => {
    const model = resolve({ pageSections: [], pageOwnsStructure: true });

    expect(model.document.sections.map((section) => section.id)).toEqual([
      "starter-header",
      "starter-footer",
    ]);
  });

  it("lets the shell keep a slot id a page also stores", () => {
    // Both would render, and the write would land in whichever document was
    // asked last.
    const model = resolveEditorSectionModel({
      pageTemplate: {
        id: "page",
        document: {
          version: 1,
          sections: [
            {
              id: "starter-header",
              type: "header",
              enabled: true,
              props: { storeName: "Stale copy" },
            },
          ],
        },
      },
      shellTemplate,
      pageSections: [],
      pageOwnsStructure: false,
      shellSections,
    });

    expect(
      model.document.sections.filter(
        (section) => section.id === "starter-header",
      ),
    ).toHaveLength(1);
    expect(model.bindings.get("starter-header")?.owner).toBe("shell");
  });
});
