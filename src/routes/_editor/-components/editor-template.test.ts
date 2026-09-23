import { describe, expect, it } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  normalizeEditorTemplateSearch,
  resolveEditorTemplate,
  routeOwnsDocument,
  routePathFromTemplatePlaceholder,
  routeTemplatePlaceholderId,
  templateAppliesToRoute,
  templateForRoute,
} from "./editor-template";

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

describe("routes with a document of their own", () => {
  const withRoutes = {
    templates: [
      { id: "index-template", type: "index", name: "Home" },
      { id: "product-template", type: "product", name: "Product" },
      { id: "aboutus-doc", type: "page", name: "/aboutus", routePath: "/aboutus" },
      { id: "layout", type: "layout", name: "Shell" },
    ],
  } as unknown as StorefrontThemeEditorDTO;
  const search = (routePath: string, templateId?: string) =>
    ({
      template: "index",
      viewport: "desktop",
      routePath,
      ...(templateId ? { templateId } : {}),
    }) as StorefrontThemeEditorSearch;

  it("finds the document the route owns, not one of its type", () => {
    expect(templateForRoute(withRoutes.templates, "/aboutus")?.id).toBe("aboutus-doc");
    expect(templateForRoute(withRoutes.templates, "/products/$slug")?.id).toBe(
      "product-template",
    );
    expect(templateForRoute(withRoutes.templates, "/contact")).toBeUndefined();
  });

  it("opens a route on its own document even when the URL carries a borrowed id", () => {
    expect(
      resolveEditorTemplate(withRoutes, search("/aboutus", "index-template"))?.id,
    ).toBe("aboutus-doc");
  });

  it("never borrows another route's document for a route without one", () => {
    expect(
      resolveEditorTemplate(withRoutes, search("/contact", "aboutus-doc"))?.id,
    ).toBe("index-template");
  });

  it("treats a borrowed template as not this route's content", () => {
    const [index, , aboutus] = withRoutes.templates;
    expect(templateAppliesToRoute(index, "/aboutus")).toBe(false);
    expect(templateAppliesToRoute(aboutus, "/aboutus")).toBe(true);
    expect(templateAppliesToRoute(aboutus, "/contact")).toBe(false);
    expect(templateAppliesToRoute(aboutus, "/")).toBe(false);
    expect(templateAppliesToRoute(index, "/")).toBe(true);
  });

  it("lists a route's own sections before its document exists", () => {
    expect(routeOwnsDocument("/contact")).toBe(true);
    expect(routeOwnsDocument("/products/$slug")).toBe(false);
    expect(routeOwnsDocument("/journal/$slug")).toBe(false);
  });

  it("round-trips the placeholder a first write resolves", () => {
    const id = routeTemplatePlaceholderId("/contact");
    expect(routePathFromTemplatePlaceholder(id)).toBe("/contact");
    expect(routePathFromTemplatePlaceholder("index-template")).toBeNull();
  });
});
