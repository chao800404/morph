/**
 * The Inspector, driven the way the editor drives it, over the real starter.
 *
 * The pieces each passed their own tests while the panel still showed a header
 * with no entries: the seam between "which document owns this section" and
 * "what values does the Inspector read" was where they disagreed. This drives
 * the real derivation, the real section model and the real panel so the seam
 * itself is covered.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  deriveThemeLayoutSections,
  deriveThemeRouteSections,
} from "@/lib/storefront/compiler/theme-route-sections";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
} from "@/lib/storefront/default-storefront-document";
import { resolveEditorSectionModel } from "@/lib/storefront/editor/editor-section-model";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { EditorAssistantPanel } from "./editor-assistant-panel";

const files = STARTER_THEME_FILES.map((file) => ({
  path: file.path,
  content: file.content,
  mimeType: file.mimeType,
}));

function shellDocument(options?: { withoutStoredHeaderProps?: boolean }) {
  const document = createDefaultStorefrontLayoutDocument();
  if (!options?.withoutStoredHeaderProps) return document;
  return {
    ...document,
    sections: document.sections.map((section) =>
      section.id === "starter-header" ? { ...section, props: {} } : section,
    ),
  };
}

function renderPanel(options?: {
  withShellTemplate?: boolean;
  /** Strip the shell's stored values, leaving only what the source declares. */
  withoutStoredHeaderProps?: boolean;
}) {
  const shell = deriveThemeLayoutSections(files);
  const route = deriveThemeRouteSections(files, "src/routes/index.tsx");
  expect(shell.diagnostics).toEqual([]);
  expect(route.diagnostics).toEqual([]);

  const pageTemplate = { id: "page", document: createDefaultStorefrontHomeDocument() };
  const model = resolveEditorSectionModel({
    pageTemplate,
    shellTemplate:
      options?.withShellTemplate === false
        ? undefined
        : { id: "shell", document: shellDocument(options) },
    pageSections: route.sections,
    pageOwnsStructure: route.hasContentImport,
    shellSections: shell.sections,
  });

  render(
    <EditorAssistantPanel
      context={
        {
          storefront: {
            id: "s",
            name: "Store",
            domain: null,
            status: "draft",
            activeReleaseId: null,
          },
          theme: {
            id: "t",
            name: "Default",
            status: "published",
            sourceGeneration: 1,
            activeBuild: null,
          },
          templates: [
            {
              ...pageTemplate,
              type: "index",
              name: "Default",
              document: model.document,
              draftRevisionId: null,
              publishedRevisionId: null,
              draftGeneration: 1,
            },
          ],
          files,
          panelTab: "content",
        } as never
      }
      search={
        { template: "index", templateId: "page", viewport: "desktop" } as never
      }
      themeFiles={files as never}
      sharedLayoutPaths={model.sharedSourcePaths}
      selection={
        {
          sectionId: "starter-header",
          kind: "link",
          componentType: "header",
          tagName: "a",
          role: null,
          inputType: null,
          nodeId: null,
          sourceFilePath: "src/components/Header.tsx",
          elementKey: null,
          fieldKey: "label",
          fieldPath: "navItems.0.label",
          className: "",
          isSection: false,
          computed: null,
          parentComputed: null,
          sectionComputed: null,
          inspectorOverride: null,
        } as never
      }
    />,
  );
  return model;
}

describe("selecting a navigation link in the shell", () => {
  it("offers the selected entry's label and destination", () => {
    renderPanel();

    expect(screen.getByText("Navigation")).toBeTruthy();
    expect(screen.getByText("Label")).toBeTruthy();
    expect(screen.getByText("Destination")).toBeTruthy();
  });

  it("reads the entries from the document that stores them", () => {
    renderPanel();

    // The count is the proof: an empty list here is the panel offering fields
    // with nothing behind them, which is what a header edit used to save into.
    expect(screen.getByText("1 / 3")).toBeTruthy();
    expect(screen.getByDisplayValue("Shop")).toBeTruthy();
  });

  it("says the row is shared by every page", () => {
    renderPanel();

    expect(screen.getByText("All pages")).toBeTruthy();
  });

  it("falls back to the entries the component itself declares", () => {
    // A section can legitimately hold no stored value yet. Showing "no
    // entries" beside a page that visibly renders three is the editor
    // disagreeing with the canvas — and the first edit then saves that
    // emptiness over the defaults.
    renderPanel({ withoutStoredHeaderProps: true });

    expect(screen.getByText("1 / 3")).toBeTruthy();
    expect(screen.getByDisplayValue("Shop")).toBeTruthy();
  });

  it("offers nothing to edit when the shell has no document", () => {
    renderPanel({ withShellTemplate: false });

    expect(screen.queryByText("Navigation")).toBeNull();
    expect(screen.queryByText("1 / 3")).toBeNull();
  });
});
