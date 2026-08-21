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
  kind: "custom",
  componentType: "test",
  tagName: null,
  role: null,
  inputType: null,
  nodeId: null,
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

describe("EditorStyleInspector selection content", () => {
  const common = {
    onPropsChange: vi.fn(),
    onUpdateThemeFileStyle: vi.fn(),
    onJumpToCode: vi.fn(),
  };

  it("shows only image content for an image selection", () => {
    render(
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", {
          heading: "Heading",
          description: "Description",
          actionLabel: "Shop",
          actionHref: "/shop",
          imageSrc: "/image.png",
          imageAlt: "Alt",
        })}
        selection={selectionDescriptor({
          kind: "image",
          tagName: "img",
          elementKey: "image",
          fieldKey: "imageSrc",
        })}
      />,
    );
    expect(screen.getByText("Media Image")).toBeTruthy();

    for (const name of ["Object fit", "Aspect ratio"]) {
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

  it("shows only the selected heading field", () => {
    render(
      <EditorStyleInspector
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

  it("shows section content when the section itself is selected", () => {
    render(
      <EditorStyleInspector
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

  it("updates only the selected nested item", () => {
    const onPropsChange = vi.fn();
    const onPreviewSelectionField = vi.fn();
    render(
      <EditorStyleInspector
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
          'export function Hero() { return <section data-morph-node="section" className="p-[16px] bg-[#ffffff] rounded-[2px]"><h1 data-morph-node="heading" className="font-serif font-normal text-left text-[48px] leading-[1.1]">Heading</h1></section>; }',
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    ];
    const inspector = (
      <EditorStyleInspector
        {...common}
        section={baseSection("hero", { heading: "Heading" })}
        themeFiles={themeFiles}
        selection={selectionDescriptor({
          kind: "section",
          tagName: "section",
          isSection: true,
          computed: {
            fontSize: "48px",
            lineHeight: "52.8px",
            fontFamily: "serif",
            fontWeight: "400",
            textAlign: "left",
          },
          sectionComputed: {
            paddingTop: "16px",
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
    const { rerender } = render(inspector);

    for (const name of ["Font family", "Font weight"]) {
      const control = screen.getByRole("combobox", { name });
      expect(control.getAttribute("data-size")).toBe("sm");
      expect(
        control.querySelector("[data-slot=select-value]")?.parentElement
          ?.className,
      ).toContain("ml-auto");
    }

    const changeNumber = (name: string, value: string) => {
      const input = screen.getByRole("spinbutton", { name });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    };

    const paddingInput = screen.getByRole("spinbutton", {
      name: "Section padding in pixels",
    });
    expect(paddingInput.closest("form")?.parentElement?.className).toContain(
      "h-8",
    );

    changeNumber("Section padding in pixels", "64");
    changeNumber("Heading font size", "60");
    changeNumber("Line height multiplier", "1.4");
    fireEvent.click(screen.getByRole("button", { name: /Border & Radius/i }));
    const radiusInput = screen.getByRole("spinbutton", {
      name: "Corner radius",
    });
    expect(radiusInput.closest("form")?.parentElement?.className).toContain(
      "rounded-md",
    );
    changeNumber("Corner radius", "12");

    rerender(inspector);

    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Section padding in pixels",
        }) as HTMLInputElement
      ).value,
    ).toBe("64");
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Heading font size",
        }) as HTMLInputElement
      ).value,
    ).toBe("60");
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Line height multiplier",
        }) as HTMLInputElement
      ).value,
    ).toBe("1.4");
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Corner radius",
        }) as HTMLInputElement
      ).value,
    ).toBe("12");
    expect(onUpdateThemeFileStyle).toHaveBeenCalledTimes(4);
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
      name: "Section padding in pixels",
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

  it("places Tailwind classes before content and keeps them collapsed initially", () => {
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
    const contentToggle = screen.getByRole("button", {
      name: "Content & Fields",
    });
    const tailwindGroup = tailwindToggle.parentElement;

    expect(tailwindGroup?.className).not.toContain("overflow-hidden");
    expect(tailwindGroup?.className).toContain("focus-within:z-20");
    expect(
      tailwindToggle.compareDocumentPosition(contentToggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Add Tailwind CSS class" }),
    ).toBeNull();

    fireEvent.click(tailwindToggle);
    expect(
      screen.getByRole("textbox", { name: "Add Tailwind CSS class" }),
    ).toBeTruthy();
  });

  it("uses an allowlisted module profile and commits sizing only after input completes", () => {
    const onPreviewSelectionStyle = vi.fn();
    const onUpdateThemeFileStyle = vi.fn(() => 4);
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
              'export function Hero() { return <section data-morph-node="section" className="w-[100px]">Hero</section>; }',
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
          computed: { width: "100px", height: "200.536px" },
          sectionComputed: { width: "100px", height: "200.536px" },
          inspectorOverride: ["sizing", "appearance"],
        })}
        onPreviewSelectionStyle={onPreviewSelectionStyle}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
      />,
    );

    expect(screen.getByRole("button", { name: "Sizing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Appearance" })).toBeTruthy();

    const overflow = screen.getByRole("combobox", { name: "Element overflow" });
    expect(overflow.getAttribute("data-size")).toBe("sm");
    expect(overflow.textContent).toContain("Overflow");
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
    expect((height as HTMLInputElement).value).toBe("200.54");
    expect(width.parentElement?.parentElement?.className).toContain(
      "items-center",
    );
    expect(width.parentElement?.parentElement?.className).toContain(
      "rounded-md",
    );

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
  });
});
