import { describe, expect, it } from "vitest";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import { astroPreviewSourceHash } from "@/lib/storefront/theme-framework/astro-preview-locate";
import { resolveCodeSelectionTarget } from "./editor-code-selection";

// L1.5a (docs/astro-theme-plan.md 3.6.2.2).

const SOURCE = [
  "---",
  "const title = 1;",
  "---",
  '<p id="cjk">中文😀<span>後</span></p>',
  '<Hero title="z" /><em>after</em>',
].join("\n");

const file = (
  path: string,
  content: string,
  extra = {},
): StorefrontThemeFileDTO =>
  ({ path, content, ...extra }) as StorefrontThemeFileDTO;

const selection = (
  overrides: Partial<EditorSelectionDescriptor> = {},
): EditorSelectionDescriptor => ({
  sectionId: "source:src/pages/index.astro",
  kind: "component",
  componentType: "custom",
  tagName: "span",
  role: null,
  inputType: null,
  nodeId: null,
  sourceFilePath: "src/pages/index.astro",
  sourceLocation: "src/pages/index.astro:4:17",
  sourceVersion: astroPreviewSourceHash(SOURCE),
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

const resolve = (
  overrides: Partial<EditorSelectionDescriptor> = {},
  files = [file("src/pages/index.astro", SOURCE)],
) =>
  resolveCodeSelectionTarget({
    section: null,
    selection: selection(overrides),
    themeFiles: files,
  });

describe("a source-located selection from an Astro Live Preview", () => {
  it("opens at the element's `<`, counting columns in UTF-16 units", () => {
    // `<p id="cjk">` is 12 units, 中文 2, 😀 2: the span starts at column 17.
    expect(resolve()).toEqual({
      filePath: "src/pages/index.astro",
      line: 4,
      column: 17,
    });
    expect(
      resolve({ tagName: "em", sourceLocation: "src/pages/index.astro:5:19" }),
    ).toEqual({ filePath: "src/pages/index.astro", line: 5, column: 19 });
  });

  it("refuses a location from another version of the file", () => {
    expect(resolve({ sourceVersion: "00000000" })).toBeNull();
    expect(
      resolve({}, [file("src/pages/index.astro", `\n${SOURCE}`)]),
    ).toBeNull();
  });

  it("refuses an `.astro` location without a version", () => {
    expect(resolve({ sourceVersion: null })).toBeNull();
  });

  it("refuses a line or column outside the file", () => {
    expect(resolve({ sourceLocation: "src/pages/index.astro:9:1" })).toBeNull();
    expect(
      resolve({ sourceLocation: "src/pages/index.astro:4:99" }),
    ).toBeNull();
  });

  it("refuses a position where the selected tag does not begin", () => {
    expect(resolve({ tagName: "b" })).toBeNull();
    expect(
      resolve({ sourceLocation: "src/pages/index.astro:4:18" }),
    ).toBeNull();
  });

  it("opens nothing outside the Theme's text sources", () => {
    expect(resolve({ sourceLocation: "../etc/passwd:1:1" })).toBeNull();
    expect(
      resolve({ sourceLocation: "/workspace/src/pages/index.astro:4:17" }),
    ).toBeNull();
    expect(resolve({ sourceLocation: "src/../.morph/x.astro:1:1" })).toBeNull();
    expect(
      resolve({ sourceLocation: "src/pages/missing.astro:1:1" }),
    ).toBeNull();
    expect(
      resolve({ sourceLocation: "src/assets/a.png:1:1" }, [
        file("src/assets/a.png", "", { encoding: "binary" }),
      ]),
    ).toBeNull();
    expect(
      resolve({ sourceLocation: "src/data.json:1:1", sourceVersion: null }, [
        file("src/data.json", "<span"),
      ]),
    ).toBeNull();
  });

  it("leaves other selections to the existing resolution", () => {
    expect(
      resolveCodeSelectionTarget({
        section: null,
        selection: selection({ sectionId: "section-1" }),
        themeFiles: [file("src/pages/index.astro", SOURCE)],
      }),
    ).toEqual(expect.objectContaining({ filePath: "src/pages/index.astro" }));
  });
});
