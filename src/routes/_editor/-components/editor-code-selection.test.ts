import { describe, expect, it } from "vitest";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { resolveCodeSelectionTarget } from "./editor-code-selection";

const file = (path: string, content: string): StorefrontThemeFileDTO =>
  ({ path, content }) as StorefrontThemeFileDTO;

const selection = (
  overrides: Partial<EditorSelectionDescriptor> = {},
): EditorSelectionDescriptor => ({
  sectionId: "section-1",
  kind: "component",
  componentType: "hero",
  tagName: "div",
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

const files = [
  file(
    "src/components/Hero.tsx",
    `export function Hero() {
  return <section data-morph-node="hero-root"><h1 data-morph-node="hero-heading">Hello</h1></section>;
}`,
  ),
  file(
    "src/components/ProductCard.tsx",
    `export function ProductCard() {
  return <article data-morph-node="product-card"><h2 data-morph-node="product-title">Product</h2></article>;
}`,
  ),
];

describe("resolveCodeSelectionTarget", () => {
  it("opens a repeated item instance in its component TSX", () => {
    expect(
      resolveCodeSelectionTarget({
        section: {
          id: "principles-1",
          type: "principles",
          componentRef: "principles.default",
        },
        selection: selection({
          nodeId: "hero-heading",
          fieldPath: "items.1.title",
          sourceFilePath: "src/components/Hero.tsx",
        }),
        themeFiles: files,
      }),
    ).toMatchObject({
      filePath: "src/components/Hero.tsx",
      line: 2,
    });
  });
  it("opens the selected section source", () => {
    expect(
      resolveCodeSelectionTarget({
        section: { type: "hero", componentRef: "hero.default" },
        selection: selection({
          isSection: true,
          nodeId: "hero-root",
          sourceFilePath: "src/components/Hero.tsx",
        }),
        themeFiles: files,
      }),
    ).toMatchObject({ filePath: "src/components/Hero.tsx", line: 2 });
  });

  it("opens the selected node in its explicit child component source", () => {
    expect(
      resolveCodeSelectionTarget({
        section: { type: "hero", componentRef: "hero.default" },
        selection: selection({
          nodeId: "product-title",
          sourceFilePath: "src/components/ProductCard.tsx",
        }),
        themeFiles: files,
      }),
    ).toMatchObject({ filePath: "src/components/ProductCard.tsx", line: 2 });
  });

  it("finds one uniquely annotated child file without explicit provenance", () => {
    expect(
      resolveCodeSelectionTarget({
        section: { type: "hero", componentRef: "hero.default" },
        selection: selection({ nodeId: "product-card" }),
        themeFiles: files,
      }),
    ).toMatchObject({ filePath: "src/components/ProductCard.tsx", line: 2 });
  });

  it("falls back to the section source when no child source is resolvable", () => {
    expect(
      resolveCodeSelectionTarget({
        section: { type: "hero", componentRef: "hero.default" },
        selection: selection({ elementKey: "heading" }),
        themeFiles: files,
      }),
    ).toMatchObject({ filePath: "src/components/Hero.tsx" });
  });
});
