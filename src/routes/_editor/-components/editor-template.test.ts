import { describe, expect, it } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { normalizeEditorTemplateSearch } from "./editor-template";

const context = {
  templates: [
    { id: "index-template", type: "index", name: "Home" },
    { id: "product-template", type: "product", name: "Product" },
  ],
} as unknown as StorefrontThemeEditorDTO;

describe("normalizeEditorTemplateSearch", () => {
  it("fills a missing template id before the preview is created", () => {
    expect(
      normalizeEditorTemplateSearch(context, {
        template: "index",
        viewport: "desktop",
      }),
    ).toEqual({
      template: "index",
      templateId: "index-template",
      viewport: "desktop",
    });
  });

  it("replaces an invalid id with the template selected by type", () => {
    expect(
      normalizeEditorTemplateSearch(context, {
        template: "product",
        templateId: "missing-template",
        viewport: "desktop",
      }),
    ).toMatchObject({
      template: "product",
      templateId: "product-template",
    });
  });

  it("preserves a canonical search object", () => {
    const search = {
      template: "index",
      templateId: "index-template",
      viewport: "desktop",
    } satisfies StorefrontThemeEditorSearch;

    expect(normalizeEditorTemplateSearch(context, search)).toBe(search);
  });
});
