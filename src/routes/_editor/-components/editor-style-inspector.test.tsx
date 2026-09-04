import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import {
  EditorStyleInspector,
  resolveStyleInspectorClassName,
} from "./editor-style-inspector";

type TestSection = StorefrontPageDocument["sections"][number];

const baseSection = (
  type: string,
  props: TestSection["props"],
): TestSection => ({
  id: "section-1",
  type,
  componentRef: type + ".default",
  enabled: true,
  props,
});
const selectionDescriptor = (
  overrides: Partial<EditorSelectionDescriptor>,
): EditorSelectionDescriptor => ({
  sectionId: "section-1",
  kind: "custom",
  componentType: "test",
  tagName: null,
  role: null,
  inputType: null,
  nodeId: null,
  sourceFilePath: null,
  elementKey: null,
  fieldKey: null,
  fieldPath: null,
  className: "",
  isSection: false,
  computed: null,
  parentComputed: null,
  sectionComputed: null,
  inspectorOverride: null,
  ...overrides,
});

describe("resolveStyleInspectorClassName", () => {
  it("uses the selected node className even when the node has no classes", () => {
    expect(
      resolveStyleInspectorClassName(
        {
          elementName: "card-title-node",
          nodeId: "card-title-node",
          tag: "h2",
          className: "",
          isSelfClosing: false,
          location: { line: 1, column: 1 },
          startOffset: 0,
          endOffset: 10,
          openingStartOffset: 0,
          openingEndOffset: 10,
        },
        "section-grid bg-stone-100",
        null,
        "props-class",
      ),
    ).toBe("");
  });

  it("uses the rendered DOM class for a nested CMS target when source metadata is absent", () => {
    expect(
      resolveStyleInspectorClassName(
        undefined,
        "section-grid bg-stone-100",
        "principle-item flex gap-4",
      ),
    ).toBe("principle-item flex gap-4");
  });

  it("preserves an empty rendered DOM class instead of falling back to the section", () => {
    expect(
      resolveStyleInspectorClassName(
        undefined,
        "section-grid bg-stone-100",
        "",
      ),
    ).toBe("");
  });

  it("keeps section and props fallback for unresolved targets", () => {
    expect(resolveStyleInspectorClassName(undefined, "section-grid")).toBe(
      "section-grid",
    );
    expect(
      resolveStyleInspectorClassName(
        undefined,
        "",
        null,
        "props-class",
        "custom-class",
      ),
    ).toBe("props-class");
  });
});

describe("code-authored text content", () => {
  it("edits a selected label even before the section has an authored prop", () => {
    const onPreviewSelectionField = vi.fn();
    const onPropsChange = vi.fn();
    render(
      <EditorStyleInspector
        view="content"
        section={baseSection("principles", { items: [] })}
        selection={selectionDescriptor({
          kind: "label",
          tagName: "p",
          nodeId: "principles-label",
          elementKey: "label",
          fieldKey: "label",
          fieldPath: "label",
          contentValue: "Why we choose differently",
        })}
        onPreviewSelectionField={onPreviewSelectionField}
        onPropsChange={onPropsChange}
      />,
    );

    const label = screen.getByDisplayValue("Why we choose differently");
    fireEvent.input(label, { target: { value: "Designed with purpose" } });
    expect(onPreviewSelectionField).toHaveBeenLastCalledWith(
      "label",
      null,
      "Designed with purpose",
    );
    fireEvent.blur(label);
    expect(onPropsChange).toHaveBeenLastCalledWith({
      items: [],
      label: "Designed with purpose",
    });
  });

  it("uses Theme manifest contentFields for a custom code-authored heading", () => {
    const onPreviewSelectionField = vi.fn();
    const onPropsChange = vi.fn();
    const themeFileBase = {
      storefrontId: "storefront-1",
      themeId: "theme-1",
      mimeType: "text/typescript",
      isEntry: false,
      version: 1,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    render(
      <EditorStyleInspector
        view="content"
        section={baseSection("promo", {})}
        themeFiles={[
          {
            ...themeFileBase,
            id: "manifest",
            path: "morph.theme.json",
            mimeType: "application/json",
            content: JSON.stringify({
              components: {
                "promo.default": {
                  source: "src/components/Promo.tsx",
                  contentFields: {
                    heading: {
                      type: "text",
                      label: "Promo heading",
                      maxLength: 80,
                    },
                  },
                },
              },
            }),
          },
          {
            ...themeFileBase,
            id: "promo-source",
            path: "src/components/Promo.tsx",
            content: `export default function Promo({ heading = "A thoughtful default" }) {
              return <section data-morph-node="promo-root"><h2 data-morph-node="promo-heading" data-morph-element="heading">{heading}</h2></section>;
            }`,
          },
        ]}
        selection={selectionDescriptor({
          kind: "heading",
          tagName: "h2",
          sourceFilePath: "src/components/Promo.tsx",
          nodeId: "promo-heading",
          elementKey: "heading",
          fieldKey: "heading",
          fieldPath: "heading",
          contentValue: "A thoughtful default",
        })}
        onPreviewSelectionField={onPreviewSelectionField}
        onPropsChange={onPropsChange}
      />,
    );

    const heading = screen.getByDisplayValue("A thoughtful default");
    expect(screen.getByText("Promo heading")).toBeTruthy();
    fireEvent.input(heading, {
      target: { value: "Designed for everyday use" },
    });
    expect(onPreviewSelectionField).toHaveBeenLastCalledWith(
      "heading",
      null,
      "Designed for everyday use",
    );
    fireEvent.blur(heading);
    expect(onPropsChange).toHaveBeenLastCalledWith({
      heading: "Designed for everyday use",
    });
  });

  it("does not persist untouched default text controls but does persist an intentional clear", () => {
    const onPropsChange = vi.fn();
    const themeFileBase = {
      storefrontId: "storefront-1",
      themeId: "theme-1",
      mimeType: "text/typescript",
      isEntry: false,
      version: 1,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    render(
      <EditorStyleInspector
        view="content"
        section={baseSection("promo", {})}
        themeFiles={[
          {
            ...themeFileBase,
            id: "manifest",
            path: "morph.theme.json",
            mimeType: "application/json",
            content: JSON.stringify({
              components: {
                "promo.default": {
                  source: "src/components/Promo.tsx",
                  contentFields: {
                    label: { type: "text", label: "Promo label" },
                    heading: { type: "textarea", label: "Promo heading" },
                  },
                },
              },
            }),
          },
          {
            ...themeFileBase,
            id: "promo-source",
            path: "src/components/Promo.tsx",
            content: `export default function Promo({ label = "Default label", heading = "Default heading" }) {
              return <section data-morph-node="promo-root"><span data-morph-element="label">{label}</span><h2 data-morph-element="heading">{heading}</h2></section>;
            }`,
          },
        ]}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          sourceFilePath: "src/components/Promo.tsx",
          nodeId: "promo-root",
          isSection: true,
        })}
        onPropsChange={onPropsChange}
      />,
    );

    const label = screen.getByDisplayValue("Default label");
    const heading = screen.getByDisplayValue("Default heading");
    fireEvent.focus(label);
    fireEvent.blur(label);
    fireEvent.focus(heading);
    fireEvent.blur(heading);
    expect(onPropsChange).not.toHaveBeenCalled();

    fireEvent.input(heading, { target: { value: "" } });
    fireEvent.blur(heading);
    expect(onPropsChange).toHaveBeenCalledWith({ heading: "" });
  });

  it("persists a custom text field while it is edited", () => {
    const onPreviewSelectionField = vi.fn();
    const onPropsChange = vi.fn();
    const themeFileBase = {
      storefrontId: "storefront-1",
      themeId: "theme-1",
      mimeType: "text/typescript",
      isEntry: false,
      version: 1,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    render(
      <EditorStyleInspector
        view="content"
        section={baseSection("principles", { items: [] })}
        themeFiles={[
          {
            ...themeFileBase,
            id: "manifest",
            path: "morph.theme.json",
            mimeType: "application/json",
            content: JSON.stringify({
              components: {
                "principles.default": {
                  source: "src/components/Principles.tsx",
                  contentFields: {
                    nn: { type: "text", label: "hello" },
                  },
                },
              },
            }),
          },
          {
            ...themeFileBase,
            id: "principles-source",
            path: "src/components/Principles.tsx",
            content: `export default function Principles({ nn = "t" }) {
              return <section data-morph-node="principles-root"><p data-morph-node="principles-nn" data-morph-element="nn">{nn}</p></section>;
            }`,
          },
        ]}
        selection={selectionDescriptor({
          kind: "text",
          tagName: "p",
          sourceFilePath: "src/components/Principles.tsx",
          nodeId: "principles-nn",
          elementKey: "nn",
          fieldKey: "nn",
          fieldPath: "nn",
          contentValue: "t",
        })}
        onPreviewSelectionField={onPreviewSelectionField}
        onPropsChange={onPropsChange}
      />,
    );

    const field = screen.getByDisplayValue("t");
    fireEvent.input(field, { target: { value: "saved nn" } });

    expect(onPreviewSelectionField).toHaveBeenLastCalledWith(
      "nn",
      null,
      "saved nn",
    );
    expect(onPropsChange).toHaveBeenLastCalledWith(
      {
        items: [],
        nn: "saved nn",
      },
      { skipPreviewSync: true },
    );
  });

  it("shows declared code defaults when the custom parent section is selected", () => {
    const themeFileBase = {
      storefrontId: "storefront-1",
      themeId: "theme-1",
      mimeType: "text/typescript",
      isEntry: false,
      version: 1,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    render(
      <EditorStyleInspector
        view="content"
        section={baseSection("promo", {})}
        themeFiles={[
          {
            ...themeFileBase,
            id: "manifest",
            path: "morph.theme.json",
            mimeType: "application/json",
            content: JSON.stringify({
              components: {
                "promo.default": {
                  source: "src/components/Promo.tsx",
                  contentFields: {
                    heading: { type: "text", label: "Promo heading" },
                  },
                },
              },
            }),
          },
          {
            ...themeFileBase,
            id: "promo-source",
            path: "src/components/Promo.tsx",
            content: `export default function Promo({ heading = "A thoughtful default" }) {
              return <section data-morph-node="promo-root"><h2 data-morph-node="promo-heading" data-morph-element="heading">{heading}</h2></section>;
            }`,
          },
        ]}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          sourceFilePath: "src/components/Promo.tsx",
          nodeId: "promo-root",
          isSection: true,
        })}
        onPropsChange={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("A thoughtful default")).toBeTruthy();
  });
});

describe("EditorStyleInspector selection content", () => {
  const common = {
    onPropsChange: vi.fn(),
    onUpdateThemeFileStyle: vi.fn(),
    onJumpToCode: vi.fn(),
  };

  it("shows only image content for an image selection", () => {
    const props = {
      ...common,
      section: baseSection("hero", {
        heading: "Heading",
        description: "Description",
        actionLabel: "Shop",
        actionHref: "/shop",
        imageSrc: "/image.png",
        imageAlt: "Alt",
      }),
      selection: selectionDescriptor({
        kind: "image",
        tagName: "img",
        elementKey: "image",
        fieldKey: "imageSrc",
      }),
    };
    const content = render(<EditorStyleInspector view="content" {...props} />);
    expect(screen.getByText("Media Image")).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "Object position" }),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Object fit" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Aspect ratio" })).toBeNull();
    content.unmount();

    render(<EditorStyleInspector view="styles" {...props} />);
    expect(screen.getByText("Media")).toBeTruthy();

    for (const name of ["Object position", "Object fit", "Aspect ratio"]) {
      const control = screen.getByRole("combobox", { name });
      expect(
        control.querySelector("[data-slot=select-value]")?.parentElement
          ?.className,
      ).toContain("ml-auto");
    }

    expect(screen.queryByText("Action Button")).toBeNull();
    expect(screen.queryByPlaceholderText("Main headline...")).toBeNull();
    expect(screen.queryByPlaceholderText("Body description...")).toBeNull();
  });

  it("shows an empty state for a layout element with no content fields", () => {
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        section={baseSection("hero", { className: "flex min-h-32" })}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
          className: "flex min-h-32",
        })}
      />,
    );

    expect(
      screen.getByText("This element has no editable content."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Content & Fields" }),
    ).toBeNull();
  });

  it("shows only the selected heading field", () => {
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        section={baseSection("hero", {
          heading: "Heading",
          description: "Description",
          actionLabel: "Shop",
          imageSrc: "/image.png",
        })}
        selection={selectionDescriptor({
          kind: "heading",
          tagName: "h1",
          elementKey: "heading",
          fieldKey: "heading",
        })}
      />,
    );
    expect(screen.getByDisplayValue("Heading")).toBeTruthy();
    expect(screen.queryByDisplayValue("Description")).toBeNull();
    expect(screen.queryByText("Action Button")).toBeNull();
  });

  it("reflects a value committed from the live preview", () => {
    const section = baseSection("hero", { heading: "Original heading" });
    const selection = selectionDescriptor({
      kind: "heading",
      tagName: "h1",
      elementKey: "heading",
      fieldKey: "heading",
      fieldPath: "heading",
      contentValue: "Original heading",
    });
    const { rerender } = render(
      <EditorStyleInspector
        view="content"
        {...common}
        section={section}
        selection={selection}
      />,
    );

    expect(screen.getByDisplayValue("Original heading")).toBeTruthy();

    rerender(
      <EditorStyleInspector
        view="content"
        {...common}
        section={section}
        selection={{ ...selection, contentValue: "Edited in preview" }}
      />,
    );

    expect(screen.getByDisplayValue("Edited in preview")).toBeTruthy();
    expect(screen.queryByDisplayValue("Original heading")).toBeNull();
  });

  it("shows and edits only the bound child fields when a parent component is selected", () => {
    const onPreviewSelectionField = vi.fn();
    const onPropsChange = vi.fn();
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        section={baseSection("hero", {
          content: "01",
          eyebrow: "New collection",
          heading: "Heading",
          description: "Description",
          actionLabel: "Shop",
          actionHref: "/shop",
          imageSrc: "/image.png",
          imageAlt: "Alt",
        })}
        selection={selectionDescriptor({
          kind: "container",
          tagName: "div",
          nodeId: "hero-content",
          elementKey: "content",
          fieldKey: null,
          fieldPath: null,
          descendantFields: [
            { fieldKey: "eyebrow", fieldPath: "eyebrow", sectionId: null },
            { fieldKey: "heading", fieldPath: "heading", sectionId: null },
            {
              fieldKey: "description",
              fieldPath: "description",
              sectionId: null,
            },
            {
              fieldKey: "actionLabel",
              fieldPath: "actionLabel",
              sectionId: null,
            },
          ],
        })}
        onPreviewSelectionField={onPreviewSelectionField}
        onPropsChange={onPropsChange}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Content & Fields" }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("New collection")).toBeTruthy();
    expect(screen.getByDisplayValue("Heading")).toBeTruthy();
    expect(screen.getByDisplayValue("Description")).toBeTruthy();
    expect(screen.getByText("Action Button")).toBeTruthy();
    expect(screen.queryByDisplayValue("01")).toBeNull();
    expect(screen.queryByText("Media Image")).toBeNull();

    const simpleContentFields = [
      "Eyebrow / Subtitle",
      "Heading",
      "Description",
    ].map((label) => {
      const labelElement = screen
        .getAllByText(label)
        .find((element) => element.tagName === "LABEL");
      return labelElement?.closest('[data-slot="inspector-content-field"]');
    });
    expect(simpleContentFields.every(Boolean)).toBe(true);
    expect(
      new Set(simpleContentFields.map((field) => field?.className)).size,
    ).toBe(1);
    expect(simpleContentFields[0]?.className).toContain("bg-muted/20");
    expect(simpleContentFields[0]?.className).toContain("w-full");

    const heading = screen.getByPlaceholderText("Main headline...");
    fireEvent.input(heading, { target: { value: "Updated heading" } });
    expect(onPreviewSelectionField).toHaveBeenLastCalledWith(
      "heading",
      "heading",
      "Updated heading",
    );
    fireEvent.blur(heading);
    expect(onPropsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        heading: "Updated heading",
        description: "Description",
        imageSrc: "/image.png",
      }),
    );
  });

  it("keeps exact nested field paths when a repeated parent component is selected", () => {
    const onPreviewSelectionField = vi.fn();
    const onPropsChange = vi.fn();
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        section={baseSection("principles", {
          items: [
            { title: "First title", body: "First body" },
            { title: "Second title", body: "Second body" },
          ],
        })}
        selection={selectionDescriptor({
          kind: "component",
          tagName: "article",
          nodeId: "principle-card",
          elementKey: "principle-item",
          fieldKey: null,
          fieldPath: "items.1",
          descendantFields: [
            { fieldKey: "title", fieldPath: "items.1.title", sectionId: null },
            { fieldKey: "body", fieldPath: "items.1.body", sectionId: null },
          ],
        })}
        onPreviewSelectionField={onPreviewSelectionField}
        onPropsChange={onPropsChange}
      />,
    );

    const title = screen.getByDisplayValue("Second title");
    expect(screen.getByDisplayValue("Second body")).toBeTruthy();
    expect(screen.queryByDisplayValue("First title")).toBeNull();

    fireEvent.input(title, { target: { value: "Updated second title" } });
    expect(onPreviewSelectionField).toHaveBeenLastCalledWith(
      "title",
      "items.1.title",
      "Updated second title",
    );
    fireEvent.blur(title);
    expect(onPropsChange).toHaveBeenLastCalledWith({
      items: [
        { title: "First title", body: "First body" },
        { title: "Updated second title", body: "Second body" },
      ],
    });
  });

  it("shows fill controls for text and commits text color only after editing finishes", () => {
    const onPreviewSelectionStyle = vi.fn();
    const onUpdateThemeFileStyle = vi.fn(
      (
        _filePath: string,
        _elementName: string,
        _updater: (previous: string) => string,
      ) => 3,
    );
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", { heading: "Heading" })}
        themeFiles={[
          {
            id: "file-hero",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            path: "src/components/Hero.tsx",
            content:
              'export function Hero() { return <section data-morph-node="section" className="bg-white"><h1 data-morph-node="heading" className="font-serif text-stone-900 text-[48px]">Heading</h1></section>; }',
            mimeType: "text/typescript",
            isEntry: false,
            version: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ]}
        selection={selectionDescriptor({
          kind: "heading",
          tagName: "h1",
          nodeId: "heading",
          elementKey: "heading",
          fieldKey: "heading",
        })}
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />,
    );

    expect(screen.getByText("Fills & Background")).toBeTruthy();
    const textColorInput = screen.getByRole("textbox", {
      name: "Text color value",
    }) as HTMLInputElement;
    expect(textColorInput.value).toBe("#1c1917");
    expect(
      screen.getByRole("button", { name: "Open Text color picker" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open Background color picker" }),
    ).toBeTruthy();
    expect(screen.queryByText("Theme palette")).toBeNull();

    fireEvent.focus(textColorInput);
    fireEvent.input(textColorInput, { target: { value: "#123456" } });
    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      { color: "#123456" },
      "heading",
    );
    expect(onUpdateThemeFileStyle).not.toHaveBeenCalled();

    fireEvent.blur(textColorInput);
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(1);
    const updater = onUpdateThemeFileStyle.mock.calls[0]?.[2];
    expect(updater?.("font-serif text-stone-900 text-[48px]")).toBe(
      "font-serif text-[#123456] text-[48px]",
    );

    const gradient = "linear-gradient(90deg, #1c1917 0%, #d8d0c3 100%)";
    fireEvent.focus(textColorInput);
    fireEvent.input(textColorInput, { target: { value: gradient } });
    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      {
        color: "transparent",
        "background-image": gradient,
        "background-clip": "text",
        "-webkit-background-clip": "text",
      },
      "heading",
    );
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(1);

    fireEvent.blur(textColorInput);
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(2);
    const gradientUpdater = onUpdateThemeFileStyle.mock.calls[1]?.[2];
    const gradientClasses = gradientUpdater?.(
      "font-serif text-[#123456] text-[48px]",
    );
    expect(gradientClasses).toContain("text-transparent");
    expect(gradientClasses).toContain("bg-clip-text");
    expect(gradientClasses).toContain(
      "bg-[linear-gradient(90deg,_#1c1917_0%,_#d8d0c3_100%)]",
    );
  });

  it("removes text and background color utilities from the selected source element", () => {
    const onPreviewSelectionStyle = vi.fn();
    const onUpdateThemeFileStyle = vi.fn(
      (
        _filePath: string,
        _elementName: string,
        _updater: (previous: string) => string,
      ) => 4,
    );
    const themeFile = (content: string) => ({
      id: "file-hero",
      storefrontId: "storefront-1",
      themeId: "theme-1",
      path: "src/components/Hero.tsx",
      content,
      mimeType: "text/typescript",
      isEntry: false,
      version: 1,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    });
    const selection = selectionDescriptor({
      kind: "heading",
      tagName: "h1",
      nodeId: "heading",
      elementKey: "heading",
      fieldKey: "heading",
      computed: {
        color: "rgb(28, 25, 23)",
        backgroundColor: "rgb(255, 255, 255)",
      },
    });
    const { rerender } = render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", { heading: "Heading" })}
        themeFiles={[
          themeFile(
            'export function Hero() { return <section data-morph-node="section" className=""><h1 data-morph-node="heading" className="font-serif text-stone-900 bg-white text-[48px]">Heading</h1></section>; }',
          ),
        ]}
        selection={selection}
        activeComputedStyleRevision={1}
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Text color picker" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Text color" }));

    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      {
        color: "",
        "background-image": "",
        "background-clip": "",
        "-webkit-background-clip": "",
      },
      "heading",
    );
    const textUpdater = onUpdateThemeFileStyle.mock.calls[0]?.[2];
    expect(textUpdater?.("font-serif text-stone-900 text-[48px]")).toBe(
      "font-serif text-[48px]",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Background color picker" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Background color" }),
    );

    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      { "background-color": "", "background-image": "" },
      "heading",
    );
    const backgroundUpdater = onUpdateThemeFileStyle.mock.calls[1]?.[2];
    expect(backgroundUpdater?.("bg-white px-4")).toBe("px-4");

    rerender(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", { heading: "Heading" })}
        themeFiles={[
          themeFile(
            'export function Hero() { return <section data-morph-node="section" className=""><h1 data-morph-node="heading" className="font-serif text-[48px]">Heading</h1></section>; }',
          ),
        ]}
        selection={selection}
        activeComputedStyleRevision={4}
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />,
    );

    expect(
      (
        screen.getByRole("textbox", {
          name: "Text color value",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Background color value",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
  }, 10_000);

  it("shows section content when the section itself is selected", () => {
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        section={baseSection("hero", {
          heading: "Heading",
          description: "Description",
          actionLabel: "Shop",
          imageSrc: "/image.png",
        })}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
        })}
      />,
    );
    expect(screen.getByDisplayValue("Heading")).toBeTruthy();
    expect(screen.getByDisplayValue("Description")).toBeTruthy();
    expect(screen.getByText("Action Button")).toBeTruthy();
  });

  it("shows section content when the sidebar has cleared the canvas selection", () => {
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        section={baseSection("hero", {
          eyebrow: "Frame work is good to use",
          heading: "Tanstack start good use",
          description: "Quiet essentials.",
          actionLabel: "Explore the collection",
          actionHref: "/aboutus",
          imageSrc: "/hero.png",
          imageAlt: "Ceramic objects",
        })}
        selection={null}
      />,
    );

    expect(screen.getByDisplayValue("Frame work is good to use")).toBeTruthy();
    expect(screen.getByDisplayValue("Tanstack start good use")).toBeTruthy();
    expect(screen.getByDisplayValue("Quiet essentials.")).toBeTruthy();
    expect(screen.getByText("Action Button")).toBeTruthy();
    expect(screen.getByDisplayValue("/hero.png")).toBeTruthy();
  });

  it("updates only the selected nested item", () => {
    const onPropsChange = vi.fn();
    const onPreviewSelectionField = vi.fn();
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        onPropsChange={onPropsChange}
        onPreviewSelectionField={onPreviewSelectionField}
        section={baseSection("principles", {
          items: [
            { title: "One", body: "First" },
            { title: "Two", body: "Second" },
          ],
        })}
        selection={selectionDescriptor({
          kind: "text",
          tagName: "span",
          elementKey: "title",
          fieldKey: "title",
          fieldPath: "items.1.title",
        })}
      />,
    );
    const input = screen.getByDisplayValue("Two");
    fireEvent.input(input, { target: { value: "Changed" } });
    expect(onPreviewSelectionField).toHaveBeenLastCalledWith(
      "title",
      "items.1.title",
      "Changed",
    );
    expect(onPropsChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onPropsChange).toHaveBeenCalledWith({
      items: [
        { title: "One", body: "First" },
        { title: "Changed", body: "Second" },
      ],
    });
  });

  it("renders a nested category image field and hides unrelated section fields", () => {
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        section={baseSection("category-showcase", {
          heading: "Collections",
          items: [
            { imageSrc: "/one.png", imageAlt: "One", imagePosition: "center" },
            { imageSrc: "/two.png", imageAlt: "Two", imagePosition: "top" },
          ],
        })}
        selection={selectionDescriptor({
          kind: "image",
          tagName: "img",
          elementKey: "image",
          fieldKey: "imageSrc",
          fieldPath: "items.1.imageSrc",
        })}
      />,
    );
    expect(screen.getByDisplayValue("/two.png")).toBeTruthy();
    expect(screen.getByDisplayValue("Two")).toBeTruthy();
    expect(screen.queryByDisplayValue("Collections")).toBeNull();
    expect(screen.queryByText("Action Button")).toBeNull();
  });

  it("keeps pending numeric styles ahead of stale preview computed values", () => {
    const onUpdateThemeFileStyle = vi.fn(() => 9);
    const themeFiles = [
      {
        id: "file-hero",
        storefrontId: "storefront-1",
        themeId: "theme-1",
        path: "src/components/Hero.tsx",
        content:
          'export function Hero() { return <section data-morph-node="section" className="p-[16px] m-[12px] bg-[#ffffff] rounded-[2px]"><h1 data-morph-node="heading" className="font-serif font-normal text-left text-[48px] leading-[1.1]">Heading</h1></section>; }',
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    ];
    const renderInspector = () => (
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", {
          heading: "Heading",
          className: "m-[12px]",
        })}
        themeFiles={themeFiles}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
          className: "p-[16px] m-[12px]",
          computed: {
            fontSize: "48px",
            lineHeight: "52.8px",
            fontFamily: "serif",
            fontWeight: "400",
            textAlign: "left",
          },
          sectionComputed: {
            paddingTop: "16px",
            marginTop: "12px",
            marginBottom: "12px",
            marginLeft: "12px",
            marginRight: "12px",
            paddingBottom: "16px",
            paddingLeft: "16px",
            paddingRight: "16px",
            backgroundColor: "rgb(255, 255, 255)",
            borderRadius: "2px",
          },
        })}
        activeComputedStyleRevision={1}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />
    );
    const { rerender } = render(renderInspector());

    for (const name of ["Font family", "Font weight"]) {
      const control = screen.getByLabelText(name);
      expect(control.getAttribute("data-size")).toBe("sm");
      expect(
        control.closest('[data-slot="inspector-control-row"]')?.className,
      ).toContain("dark:bg-input/30");
      expect(
        control.querySelector("[data-slot=select-value]")?.parentElement
          ?.className,
      ).toContain("ml-auto");
    }

    const changeNumber = (name: string, value: string) => {
      const input = screen.getByLabelText(name);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    };

    const marginInput = screen.getByLabelText("Section margin");
    expect((marginInput as HTMLInputElement).value).toBe("12");
    const paddingInput = screen.getByLabelText("Section padding");
    expect(screen.getByLabelText("Heading font size unit").textContent).toBe(
      "px",
    );
    expect(
      screen.getByLabelText("Line height multiplier").closest("form")
        ?.textContent,
    ).toContain("×");
    const displayRow = screen
      .getByLabelText("Element display")
      .closest('[data-slot="inspector-control-row"]');
    const paddingRow = paddingInput.closest(
      '[data-slot="inspector-control-row"]',
    );
    const marginRow = marginInput.closest(
      '[data-slot="inspector-control-row"]',
    );
    const alignmentRow = screen
      .getByText("Alignment")
      .closest('[data-slot="inspector-control-row"]');
    for (const row of [displayRow, paddingRow, marginRow, alignmentRow]) {
      expect(row).toBeTruthy();
      expect(row?.className.split(" ")).toEqual(
        expect.arrayContaining(["h-8", "px-2", "border-input"]),
      );
      expect(row?.className).not.toMatch(/\bpl-(?:2|4)\b/);
    }
    expect(alignmentRow?.className.split(" ")).toContain("pr-0");
    const alignmentControl = screen.getByLabelText("Align left").parentElement;
    expect(alignmentControl?.className.split(" ")).not.toEqual(
      expect.arrayContaining(["rounded-lg", "border", "bg-muted/30"]),
    );
    expect(paddingRow?.className).toContain("dark:bg-input/30");
    const paddingLabel = screen.getByText("Padding");
    expect(paddingLabel.parentElement).toBe(paddingRow);
    expect(paddingLabel.className).toContain("text-xs");
    expect(paddingLabel.className).not.toContain("text-[10px]");
    const expandPaddingButton = screen.getByRole("button", {
      name: "Expand individual padding sides",
    });
    expect(expandPaddingButton.parentElement).toBe(paddingRow?.parentElement);
    expect(expandPaddingButton.parentElement).not.toBe(paddingRow);
    expect(screen.queryByLabelText("Top padding")).toBeNull();

    fireEvent.click(expandPaddingButton);

    expect(
      screen
        .getByRole("button", {
          name: "Collapse individual padding sides",
        })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByLabelText("Top padding")).not.toBeNull();
    for (const side of ["Top", "Bottom", "Left", "Right"]) {
      expect(screen.getByLabelText(`${side} padding`)).not.toBeNull();
    }
    expect(paddingRow?.parentElement?.className).not.toMatch(
      /\b(?:border|bg-background|dark:bg-input\/30)\b/,
    );
    expect(screen.getByLabelText("Section padding")).toBe(paddingInput);
    changeNumber("Top padding", "20");
    changeNumber("Bottom padding", "24");
    changeNumber("Left padding", "28");
    changeNumber("Right padding", "32");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand individual margin sides",
      }),
    );
    for (const side of ["Top", "Bottom", "Left", "Right"]) {
      expect(screen.getByLabelText(`${side} margin`)).not.toBeNull();
    }
    changeNumber("Top margin", "-20");
    changeNumber("Bottom margin", "-24");
    changeNumber("Left margin", "-28");
    changeNumber("Right margin", "-32");
    changeNumber("Section margin", "24");

    changeNumber("Section padding", "64");
    changeNumber("Heading font size", "60");
    changeNumber("Line height multiplier", "1.4");
    const radiusInput = screen.getByLabelText("Corner radius");
    expect(
      radiusInput.closest('[data-slot="inspector-control-row"]')?.className,
    ).toContain("rounded-md");
    expect(
      screen
        .getByLabelText("Heading font size")
        .closest('[data-slot="inspector-control-row"]')?.className,
    ).toContain("dark:bg-input/30");
    expect(
      screen.getByLabelText("Background color value").parentElement?.className,
    ).toContain("dark:bg-input/30");
    changeNumber("Corner radius", "12");

    rerender(renderInspector());

    expect(
      (screen.getByLabelText("Section padding") as HTMLInputElement).value,
    ).toBe("64");
    expect(
      (screen.getByLabelText("Heading font size") as HTMLInputElement).value,
    ).toBe("60");
    expect(
      (screen.getByLabelText("Line height multiplier") as HTMLInputElement)
        .value,
    ).toBe("1.4");
    expect(
      (screen.getByLabelText("Corner radius") as HTMLInputElement).value,
    ).toBe("12");
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(13);
  }, 20_000);

  it("switches font size units while keeping line height unitless", async () => {
    const onUpdateThemeFileStyle = vi.fn(
      (
        _filePath: string,
        _elementName: string,
        _updater: (previous: string) => string,
      ) => 2,
    );
    const onPreviewSelectionStyle = vi.fn();
    const renderInspector = () => (
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", { heading: "Heading" })}
        themeFiles={[
          {
            id: "file-hero",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            path: "src/components/Hero.tsx",
            content:
              'export function Hero() { return <section data-morph-node="section"><h1 data-morph-node="heading" className="font-serif text-[48px] leading-[1.1]">Heading</h1></section>; }',
            mimeType: "text/typescript",
            isEntry: false,
            version: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ]}
        selection={selectionDescriptor({
          kind: "heading",
          tagName: "h1",
          nodeId: "heading",
          elementKey: "heading",
          fieldKey: "heading",
          computed: {
            fontSize: "48px",
            lineHeight: "52.8px",
          },
        })}
        activeViewport="mobile"
        activeComputedStyleRevision={1}
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />
    );
    const { rerender } = render(renderInspector());

    const unit = screen.getByRole("combobox", {
      name: "Heading font size unit",
    });
    fireEvent.keyDown(unit, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "rem" }));

    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      { "font-size": "48rem" },
      "heading",
    );
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(1);
    expect(
      onUpdateThemeFileStyle.mock.calls[0]?.[2]?.(
        "font-serif text-[48px] leading-[1.1]",
      ),
    ).toBe("font-serif text-[48rem] leading-[1.1]");

    rerender(renderInspector());
    expect(
      screen.getByRole("combobox", { name: "Heading font size unit" })
        .textContent,
    ).toBe("rem");

    const sizeInput = screen.getByRole("spinbutton", {
      name: "Heading font size",
    });
    fireEvent.focus(sizeInput);
    fireEvent.change(sizeInput, { target: { value: "1.5" } });
    fireEvent.blur(sizeInput);
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(2);
    expect(
      onUpdateThemeFileStyle.mock.calls[1]?.[2]?.(
        "font-serif text-[48rem] leading-[1.1]",
      ),
    ).toBe("font-serif text-[1.5rem] leading-[1.1]");

    const lineHeight = screen.getByRole("spinbutton", {
      name: "Line height multiplier",
    });
    expect(lineHeight.closest("form")?.textContent).toContain("×");
    expect(
      screen.queryByRole("combobox", {
        name: "Line height multiplier unit",
      }),
    ).toBeNull();
  });

  it("stores responsive Margin Auto without changing Padding", async () => {
    const onUpdateThemeFileStyle = vi.fn(
      (
        _filePath: string,
        _elementName: string,
        _updater: (previous: string) => string,
      ) => 2,
    );
    const onPreviewSelectionStyle = vi.fn();
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", { heading: "Heading" })}
        themeFiles={[
          {
            id: "file-hero",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            path: "src/components/Hero.tsx",
            content:
              'export function Hero() { return <section data-morph-node="section" className="p-[16px] m-[12px] md:m-[20px]">Hero</section>; }',
            mimeType: "text/typescript",
            isEntry: false,
            version: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ]}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
          className: "p-[16px] m-[12px] md:m-[20px]",
          sectionComputed: {
            paddingTop: "16px",
            paddingBottom: "16px",
            paddingLeft: "16px",
            paddingRight: "16px",
            marginTop: "20px",
            marginBottom: "20px",
            marginLeft: "20px",
            marginRight: "20px",
          },
        })}
        activeViewport="tablet"
        activeComputedStyleRevision={1}
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />,
    );

    const marginUnit = screen.getByRole("combobox", {
      name: "Section margin unit",
    });
    fireEvent.keyDown(marginUnit, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Auto" }));

    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      {
        "margin-top": "auto",
        "margin-bottom": "auto",
        "margin-left": "auto",
        "margin-right": "auto",
      },
      "section",
    );
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(1);
    expect(
      onUpdateThemeFileStyle.mock.calls[0]?.[2]?.(
        "p-[16px] m-[12px] md:m-[20px]",
      ),
    ).toBe("p-[16px] m-[12px] md:m-auto");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand individual margin sides",
      }),
    );
    for (const side of ["Top", "Bottom", "Left", "Right"]) {
      const unit = screen.getByRole("combobox", {
        name: `${side} margin unit`,
      });
      fireEvent.keyDown(unit, { key: "ArrowDown" });
      expect(await screen.findByRole("option", { name: "Auto" })).toBeTruthy();
      fireEvent.keyDown(unit, { key: "Escape" });
    }

    const paddingUnit = screen.getByRole("combobox", {
      name: "Section padding unit",
    });
    fireEvent.keyDown(paddingUnit, { key: "ArrowDown" });
    expect(screen.queryByRole("option", { name: "Auto" })).toBeNull();
  }, 20_000);

  it("shows a standard mt utility from the selected element computed style", () => {
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", { heading: "Heading" })}
        themeFiles={[
          {
            id: "file-hero",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            path: "src/components/Hero.tsx",
            content:
              'export function Hero() { return <section data-morph-node="section"><h1 data-morph-node="heading" className="mt-6">Heading</h1></section>; }',
            mimeType: "text/typescript",
            isEntry: false,
            version: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ]}
        selection={selectionDescriptor({
          kind: "heading",
          tagName: "h1",
          nodeId: "heading",
          elementKey: "heading",
          fieldKey: "heading",
          className: "mt-6",
          computed: {
            marginTop: "24px",
            marginBottom: "0px",
            marginLeft: "0px",
            marginRight: "0px",
          },
        })}
        activeViewport="desktop"
        activeComputedStyleRevision={1}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand individual margin sides",
      }),
    );
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Top margin",
        }) as HTMLInputElement
      ).value,
    ).toBe("24");
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Bottom margin",
        }) as HTMLInputElement
      ).value,
    ).toBe("0");
  });

  it("previews scrubbing without updating source until pointer up", () => {
    const onUpdateThemeFileStyle = vi.fn(() => 2);
    const onPreviewSelectionStyle = vi.fn();
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", { heading: "Heading" })}
        themeFiles={[
          {
            id: "file-hero",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            path: "src/components/Hero.tsx",
            content:
              'export function Hero() { return <section data-morph-node="section" className="p-[16px]">Hero</section>; }',
            mimeType: "text/typescript",
            isEntry: false,
            version: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ]}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
          sectionComputed: {
            paddingTop: "16px",
            marginTop: "12px",
            marginBottom: "12px",
            marginLeft: "12px",
            marginRight: "12px",
            paddingBottom: "16px",
            paddingLeft: "16px",
            paddingRight: "16px",
          },
        })}
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Section padding",
    });
    Object.defineProperty(input, "setPointerCapture", { value: vi.fn() });

    fireEvent.pointerDown(input, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 116 });

    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      {
        "padding-top": "32px",
        "padding-bottom": "32px",
        "padding-left": "32px",
        "padding-right": "32px",
      },
      "section",
    );
    expect(onUpdateThemeFileStyle).not.toHaveBeenCalled();

    fireEvent.pointerUp(input, { pointerId: 1, clientX: 116 });
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(1);
  });

  it("updates the matched first-child padding variant for a repeated card", () => {
    const classes =
      "border-b py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0";
    const onPreviewSelectionStyle = vi.fn();
    const onUpdateThemeFileStyle = vi.fn(
      (
        _filePath: string,
        _elementName: string,
        _updater: (previous: string) => string,
      ) => 2,
    );
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("principles", {
          items: [
            { title: "First", body: "First body" },
            { title: "Second", body: "Second body" },
          ],
        })}
        themeFiles={[
          {
            id: "file-principles",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            path: "src/components/Principles.tsx",
            content:
              'export function Principles({ items }) { return <section data-morph-node="section">{items.map((item) => <article data-morph-node="principle-card" className="' +
              classes +
              '">{item.title}</article>)}</section>; }',
            mimeType: "text/typescript",
            isEntry: false,
            version: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ]}
        selection={selectionDescriptor({
          kind: "component",
          tagName: "article",
          nodeId: "principle-card",
          sourceFilePath: "src/components/Principles.tsx",
          elementKey: "card",
          fieldKey: "title",
          fieldPath: "items.0.title",
          className: classes,
          computed: {
            paddingTop: "32px",
            paddingBottom: "32px",
            paddingLeft: "0px",
            paddingRight: "32px",
          },
        })}
        activeViewport="desktop"
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand individual padding sides",
      }),
    );
    const left = screen.getByRole("spinbutton", { name: "Left padding" });
    fireEvent.focus(left);
    fireEvent.change(left, { target: { value: "28" } });
    fireEvent.blur(left);

    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      { "padding-left": "28px" },
      "principle-card",
    );
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(1);
    expect(onUpdateThemeFileStyle.mock.calls[0]?.[2]?.(classes)).toBe(
      "border-b py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-[28px] lg:last:border-r-0",
    );
  });

  it("keeps Tailwind classes out of the content view, and content out of styles", () => {
    // These write to different sources of truth — Tailwind to the Theme
    // Source, content fields to the Page Document — so neither view may offer
    // the other's controls. This replaces an ordering assertion that only made
    // sense while both lived in one scrolling panel.
    const props = {
      ...common,
      section: baseSection("hero", {
        heading: "Heading",
        className: "min-h-[30rem] overflow-hidden",
      }),
      selection: selectionDescriptor({
        kind: "section",
        tagName: "section",
        isSection: true,
        className: "min-h-[30rem] overflow-hidden",
      }),
    };

    const styles = render(<EditorStyleInspector {...props} />);
    expect(
      screen.getByRole("button", { name: "Tailwind CSS Classes · 2" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Content & Fields" }),
    ).toBeNull();
    styles.unmount();

    render(<EditorStyleInspector {...props} view="content" />);
    expect(
      screen.getByRole("button", { name: "Content & Fields" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Tailwind CSS Classes/ }),
    ).toBeNull();
  });

  it("keeps the Tailwind editor collapsed until it is asked for", () => {
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", {
          heading: "Heading",
          className: "min-h-[30rem] overflow-hidden",
        })}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
          className: "min-h-[30rem] overflow-hidden",
        })}
      />,
    );

    const tailwindToggle = screen.getByRole("button", {
      name: "Tailwind CSS Classes · 2",
    });
    expect(tailwindToggle.parentElement?.className).not.toContain(
      "overflow-hidden",
    );
    expect(tailwindToggle.parentElement?.className).toContain(
      "focus-within:z-20",
    );
    expect(
      screen.queryByRole("textbox", { name: "Add Tailwind CSS class" }),
    ).toBeNull();

    fireEvent.click(tailwindToggle);
    expect(
      screen.getByRole("textbox", { name: "Add Tailwind CSS class" }),
    ).toBeTruthy();
  });

  it("edits overall and per-side border widths and expands independent corner radii", () => {
    const onPreviewSelectionStyle = vi.fn();
    const onUpdateThemeFileStyle = vi.fn(
      (
        _filePath: string,
        _elementName: string,
        _updater: (previous: string) => string,
      ) => 6,
    );
    const sourceClasses =
      "border-[2px] border-t-[1px] border-dashed border-[#d8d0c3] rounded-[8px] rounded-tl-[4px]";
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", {})}
        themeFiles={[
          {
            id: "file-hero",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            path: "src/components/Hero.tsx",
            content: `export function Hero() { return <section data-morph-node="section" className="${sourceClasses}">Hero</section>; }`,
            mimeType: "text/typescript",
            isEntry: false,
            version: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ]}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
          sectionComputed: {
            borderTopWidth: "1px",
            borderBottomWidth: "2px",
            borderLeftWidth: "2px",
            borderRightWidth: "2px",
            borderTopStyle: "dashed",
            borderTopColor: "rgb(216, 208, 195)",
            borderRadius: "8px",
            borderTopLeftRadius: "4px",
          },
        })}
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />,
    );

    expect(screen.getByText("Border & Radius").closest("button")).toBeNull();

    const borderWidth = screen.getByLabelText(
      "Border width",
    ) as HTMLInputElement;
    expect(borderWidth.value).toBe("2");
    expect(screen.getByLabelText("Border style").textContent).toContain(
      "dashed",
    );
    const borderColor = screen.getByLabelText(
      "Color color value",
    ) as HTMLInputElement;
    expect(borderColor.value).toBe("#d8d0c3");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand individual border sides",
      }),
    );
    const topBorderWidth = screen.getByLabelText(
      "Top border width",
    ) as HTMLInputElement;
    expect(topBorderWidth.value).toBe("1");
    expect(
      (screen.getByLabelText("Bottom border width") as HTMLInputElement).value,
    ).toBe("2");
    expect(
      (screen.getByLabelText("Left border width") as HTMLInputElement).value,
    ).toBe("2");
    expect(
      (screen.getByLabelText("Right border width") as HTMLInputElement).value,
    ).toBe("2");

    fireEvent.focus(topBorderWidth);
    fireEvent.change(topBorderWidth, { target: { value: "5" } });
    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      { "border-top-width": "5px" },
      "section",
    );
    fireEvent.blur(topBorderWidth);
    const topWidthUpdater = onUpdateThemeFileStyle.mock.calls.at(-1)?.[2];
    expect(topWidthUpdater?.(sourceClasses)).toContain("border-t-[5px]");
    onUpdateThemeFileStyle.mockClear();

    fireEvent.input(borderColor, { target: { value: "#292524" } });
    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      { "border-color": "#292524" },
      "section",
    );
    expect(onUpdateThemeFileStyle).not.toHaveBeenCalled();
    fireEvent.blur(borderColor);
    const colorUpdater = onUpdateThemeFileStyle.mock.calls.at(-1)?.[2];
    expect(colorUpdater?.(sourceClasses)).toContain("border-[#292524]");
    onUpdateThemeFileStyle.mockClear();

    fireEvent.focus(borderWidth);
    fireEvent.change(borderWidth, { target: { value: "3" } });
    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      {
        "border-top-width": "3px",
        "border-bottom-width": "3px",
        "border-left-width": "3px",
        "border-right-width": "3px",
      },
      "section",
    );
    expect(onUpdateThemeFileStyle).not.toHaveBeenCalled();
    fireEvent.blur(borderWidth);
    const widthUpdater = onUpdateThemeFileStyle.mock.calls.at(-1)?.[2];
    const updatedWidthClasses = widthUpdater?.(sourceClasses);
    expect(updatedWidthClasses).toContain("border-[3px]");
    expect(updatedWidthClasses).not.toContain("border-t-[1px]");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand individual corner radii",
      }),
    );
    const topLeft = screen.getByLabelText(
      "Top left corner radius",
    ) as HTMLInputElement;
    expect(topLeft.value).toBe("4");
    expect(screen.getByLabelText("Top right corner radius")).toBeTruthy();
    expect(screen.getByLabelText("Bottom left corner radius")).toBeTruthy();
    expect(screen.getByLabelText("Bottom right corner radius")).toBeTruthy();

    fireEvent.focus(topLeft);
    fireEvent.change(topLeft, { target: { value: "12" } });
    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      { "border-top-left-radius": "12px" },
      "section",
    );
    fireEvent.blur(topLeft);
    const cornerUpdater = onUpdateThemeFileStyle.mock.calls.at(-1)?.[2];
    expect(cornerUpdater?.(sourceClasses)).toContain("rounded-tl-[12px]");
  });

  it("uses an allowlisted module profile and commits sizing only after input completes", () => {
    const onPreviewSelectionStyle = vi.fn();
    const onUpdateThemeFileStyle = vi.fn(
      (
        _filePath: string,
        _elementName: string,
        _updater: (previous: string) => string,
      ) => 4,
    );
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", {})}
        themeFiles={[
          {
            id: "file-hero",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            path: "src/components/Hero.tsx",
            content:
              'export function Hero() { return <section data-morph-node="section" className="w-[100px] h-[200.536px] min-w-[2rem] min-h-[20px] max-w-none max-h-[80vh]">Hero</section>; }',
            mimeType: "text/typescript",
            isEntry: false,
            version: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ]}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
          computed: {
            width: "100px",
            height: "200.536px",
            minWidth: "32px",
            minHeight: "20px",
            maxWidth: "none",
            maxHeight: "800px",
          },
          sectionComputed: {
            width: "100px",
            height: "200.536px",
            minWidth: "32px",
            minHeight: "20px",
            maxWidth: "none",
            maxHeight: "800px",
          },
          inspectorOverride: ["sizing", "appearance"],
        })}
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />,
    );

    expect(screen.queryByRole("button", { name: "Design" })).toBeNull();
    expect(screen.getByText("Sizing")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    const overflow = screen.getByRole("combobox", { name: "Element overflow" });
    const opacityLabel = screen.getByText("Opacity");
    const overflowLabel = overflow
      .closest('[data-slot="inspector-control-row"]')
      ?.querySelector('[data-slot="inspector-control-row-label"]');
    expect(opacityLabel.className.split(" ")).toContain("text-xs");
    expect(opacityLabel.className).not.toContain("text-[10px]");
    expect(overflowLabel?.className.split(" ")).toContain("text-xs");
    expect(overflow.getAttribute("data-size")).toBe("sm");
    expect(
      overflow.closest('[data-slot="inspector-control-row"]')?.textContent,
    ).toContain("Overflow");
    expect(overflow.textContent).toContain("visible");
    expect(
      overflow.querySelector("[data-slot=select-value]")?.parentElement
        ?.className,
    ).toContain("ml-auto");

    expect(screen.queryByRole("button", { name: "Layout" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Content & Fields" }),
    ).toBeNull();

    const width = screen.getByRole("spinbutton", { name: "Element width" });
    const height = screen.getByRole("spinbutton", { name: "Element height" });
    const minWidth = screen.getByRole("spinbutton", {
      name: "Element minimum width",
    });
    const maxHeight = screen.getByRole("spinbutton", {
      name: "Element maximum height",
    });
    expect((height as HTMLInputElement).value).toBe("200.54");
    expect((minWidth as HTMLInputElement).value).toBe("2");
    expect((maxHeight as HTMLInputElement).value).toBe("80");
    expect(screen.getByText("None")).toBeTruthy();
    const widthRow = width.closest('[data-slot="inspector-control-row"]');
    expect(widthRow?.className).toContain("items-center");
    expect(widthRow?.className).toContain("rounded-md");

    Object.defineProperty(width, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(width, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(width, { pointerId: 1, clientX: 124 });
    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      { width: "106px" },
      "section",
    );
    expect(onUpdateThemeFileStyle).not.toHaveBeenCalled();
    fireEvent.pointerUp(width, { pointerId: 1, clientX: 124 });
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(1);

    onUpdateThemeFileStyle.mockClear();
    fireEvent.focus(minWidth);
    fireEvent.change(minWidth, { target: { value: "3" } });
    expect(onPreviewSelectionStyle).toHaveBeenLastCalledWith(
      { "min-width": "3rem" },
      "section",
    );
    expect(onUpdateThemeFileStyle).not.toHaveBeenCalled();
    fireEvent.blur(minWidth);
    const minWidthUpdater = onUpdateThemeFileStyle.mock.calls.at(-1)?.[2];
    expect(
      minWidthUpdater?.(
        "w-[100px] h-[200.536px] min-w-[2rem] min-h-[20px] max-w-none max-h-[80vh]",
      ),
    ).toContain("min-w-[3rem]");
  });
  it("renders a nested category image field and hides unrelated section fields", () => {
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        section={baseSection("category-showcase", {
          heading: "Collections",
          items: [
            { imageSrc: "/one.png", imageAlt: "One", imagePosition: "center" },
            { imageSrc: "/two.png", imageAlt: "Two", imagePosition: "top" },
          ],
        })}
        selection={selectionDescriptor({
          kind: "image",
          tagName: "img",
          elementKey: "image",
          fieldKey: "imageSrc",
          fieldPath: "items.1.imageSrc",
        })}
      />,
    );
    expect(screen.getByDisplayValue("/two.png")).toBeTruthy();
    expect(screen.getByDisplayValue("Two")).toBeTruthy();
    expect(screen.queryByDisplayValue("Collections")).toBeNull();
    expect(screen.queryByText("Action Button")).toBeNull();
  });

  it("renders and writes a repeated item body field by its exact path", () => {
    const onPropsChange = vi.fn();
    const onPreviewSelectionField = vi.fn();
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        onPropsChange={onPropsChange}
        onPreviewSelectionField={onPreviewSelectionField}
        section={baseSection("principles", {
          items: [
            { title: "One", body: "First" },
            { title: "Two", body: "Second" },
          ],
        })}
        selection={selectionDescriptor({
          kind: "paragraph",
          tagName: "p",
          elementKey: "body",
          fieldKey: "body",
          fieldPath: "items.1.body",
        })}
      />,
    );
    const body = screen.getByDisplayValue("Second");
    fireEvent.input(body, { target: { value: "Changed body" } });
    expect(onPreviewSelectionField).toHaveBeenLastCalledWith(
      "body",
      "items.1.body",
      "Changed body",
    );
    fireEvent.blur(body);
    expect(onPropsChange).toHaveBeenLastCalledWith({
      items: [
        { title: "One", body: "First" },
        { title: "Two", body: "Changed body" },
      ],
    });
  });

  it("keeps the top-level body field behavior unchanged", () => {
    const onPropsChange = vi.fn();
    const onPreviewSelectionField = vi.fn();
    render(
      <EditorStyleInspector
        view="content"
        {...common}
        onPropsChange={onPropsChange}
        onPreviewSelectionField={onPreviewSelectionField}
        section={baseSection("image-with-text", { body: "Section body" })}
        selection={selectionDescriptor({
          kind: "paragraph",
          tagName: "p",
          elementKey: "body",
          fieldKey: "body",
          fieldPath: "body",
        })}
      />,
    );
    const body = screen.getByDisplayValue("Section body");
    fireEvent.input(body, { target: { value: "Updated section body" } });
    expect(onPreviewSelectionField).toHaveBeenLastCalledWith(
      "body",
      null,
      "Updated section body",
    );
    fireEvent.blur(body);
    expect(onPropsChange).toHaveBeenLastCalledWith({
      body: "Updated section body",
    });
  });

  it("does not render a standalone Design accordion while retaining nested design controls", () => {
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", { heading: "Heading", className: "py-8" })}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
        })}
      />,
    );

    const stylesCard = document.querySelector("[data-inspector-module=Styles]");
    expect(stylesCard).toBeTruthy();
    expect(stylesCard?.className).not.toContain("border");
    expect(stylesCard?.className).toContain("rounded-xl");
    const sizingCard = stylesCard?.querySelector(
      "[data-inspector-module=Sizing]",
    );
    expect(sizingCard?.className).not.toContain("rounded");
    expect(sizingCard?.className).toContain("border-b");
    expect(
      stylesCard?.querySelector("[data-inspector-module=Sizing]"),
    ).toBeTruthy();
    expect(
      stylesCard?.querySelector('[data-inspector-module="Content & Fields"]'),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /Tailwind CSS Classes/ })
        .closest("[data-inspector-module=Styles]"),
    ).toBeNull();
    expect(screen.queryByText("Layout & Spacing")).toBeNull();
    expect(screen.getByText("Margin")).toBeTruthy();
    const layoutOrder = [
      "Display",
      "Padding",
      "Margin",
      "Alignment",
      "Sizing",
    ].map((label) => screen.getByText(label));
    for (let index = 1; index < layoutOrder.length; index += 1) {
      expect(
        layoutOrder[index - 1].compareDocumentPosition(layoutOrder[index]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(screen.getByText("Sizing").closest("button")).toBeNull();
    expect(screen.getByText("Appearance").closest("button")).toBeNull();
    expect(screen.getByText("Typography").closest("button")).toBeNull();
    // Content fields are no longer part of this view; that they still render,
    // and only in the content view, is asserted where the split is tested.
  });

  it("keeps Layout wrapper and spacing controls for heading selections", () => {
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", {
          heading: "Heading",
          className: "p-4 m-2",
        })}
        selection={selectionDescriptor({
          kind: "heading",
          tagName: "h1",
          nodeId: "heading",
          elementKey: "heading",
          fieldKey: "heading",
          className: "p-4 m-2",
          computed: { display: "block", color: "rgb(28, 25, 23)" },
          sectionComputed: {
            paddingTop: "16px",
            paddingBottom: "16px",
            paddingLeft: "16px",
            paddingRight: "16px",
          },
        })}
      />,
    );
    const layout = screen
      .getByText("Layout")
      .closest("[data-inspector-module=Layout]");
    expect(layout).toBeTruthy();
    expect(layout?.className).toContain("border-b");
    expect(layout?.querySelector(".border-t")).toBeTruthy();
    expect(
      layout?.querySelector('[aria-label="Element display"]'),
    ).toBeTruthy();
    expect(
      layout?.querySelector('[aria-label="Section padding"]'),
    ).toBeTruthy();
    expect(layout?.querySelector('[aria-label="Section margin"]')).toBeTruthy();
    expect(layout?.querySelector('[aria-label="Element width"]')).toBeNull();
    expect(
      layout!.compareDocumentPosition(
        screen.getByText("Sizing").closest("[data-inspector-module=Sizing]")!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
