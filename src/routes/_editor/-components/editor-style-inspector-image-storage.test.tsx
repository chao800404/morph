import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { EditorStyleInspector } from "./editor-style-inspector";

type TestSection = StorefrontPageDocument["sections"][number];

const section = (props: TestSection["props"]): TestSection => ({
  id: "section-1",
  type: "hero",
  componentRef: "hero.default",
  enabled: true,
  props,
});

const imageSelection = (fieldKey: string): EditorSelectionDescriptor => ({
  sectionId: "section-1",
  kind: "image",
  componentType: "hero",
  tagName: "img",
  role: null,
  inputType: null,
  nodeId: null,
  sourceFilePath: null,
  elementKey: "image",
  fieldKey,
  fieldPath: null,
  className: "",
  isSection: false,
  computed: null,
  parentComputed: null,
  sectionComputed: null,
  inspectorOverride: null,
});

const common = {
  view: "content" as const,
  onPropsChange: vi.fn(),
  onUpdateThemeFileStyle: vi.fn(),
  onJumpToCode: vi.fn(),
};

const themeFileBase = {
  storefrontId: "storefront-1",
  themeId: "theme-1",
  mimeType: "application/json",
  isEntry: false,
  version: 1,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

const HINT = /cannot use the Asset library/;

describe("EditorStyleInspector image storage", () => {
  it("does not offer the Asset library to an image stored as a string", () => {
    render(
      <EditorStyleInspector
        {...common}
        section={section({ imageSrc: "/image.png", imageAlt: "Alt" })}
        selection={imageSelection("imageSrc")}
      />,
    );

    expect(screen.queryByRole("button", { name: "Assets" })).toBeNull();
    expect(screen.getByRole("button", { name: "External URL" })).toBeTruthy();
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it("offers it to a grouped image, which keeps the asset", () => {
    render(
      <EditorStyleInspector
        {...common}
        section={section({ image: { src: "/image.png", alt: "Alt" } })}
        selection={imageSelection("image")}
      />,
    );

    expect(screen.getByRole("button", { name: "Assets" })).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("offers it to a legacy key the Theme declares as an image", () => {
    render(
      <EditorStyleInspector
        {...common}
        section={section({ imageSrc: "/image.png" })}
        selection={imageSelection("imageSrc")}
        themeFiles={[
          {
            ...themeFileBase,
            id: "manifest",
            path: "morph.theme.json",
            content: JSON.stringify({
              components: {
                "hero.default": {
                  source: "src/components/Hero.tsx",
                  contentFields: {
                    imageSrc: { type: "image", label: "Hero image" },
                  },
                },
              },
            }),
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Assets" })).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
