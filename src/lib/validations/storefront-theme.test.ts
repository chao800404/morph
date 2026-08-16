import { describe, expect, it } from "vitest";
import {
  publishStorefrontThemeTemplateInputSchema,
  storefrontThemeEditorSearchSchema,
  storefrontThemePreviewSearchSchema,
} from "./storefront-theme";

describe("storefront theme editor search", () => {
  it("keeps legacy template type links compatible", () => {
    expect(
      storefrontThemeEditorSearchSchema.parse({
        template: "index",
        viewport: "desktop",
      }),
    ).toMatchObject({ template: "index", viewport: "desktop" });
  });

  it("accepts a unique template identity", () => {
    const templateId = crypto.randomUUID();
    expect(
      storefrontThemeEditorSearchSchema.parse({
        template: "product",
        templateId,
        viewport: "tablet",
      }).templateId,
    ).toBe(templateId);
  });

  it("normalizes a shareable canvas width", () => {
    expect(
      storefrontThemeEditorSearchSchema.parse({
        template: "index",
        viewport: "desktop",
        canvasWidth: "1024",
      }).canvasWidth,
    ).toBe(1024);

    expect(
      storefrontThemeEditorSearchSchema.parse({
        template: "index",
        viewport: "desktop",
        canvasWidth: "200",
      }).canvasWidth,
    ).toBeUndefined();
  });
});

describe("storefront theme preview search", () => {
  it("requires an exact template identity and bounded viewport height", () => {
    const templateId = crypto.randomUUID();

    expect(
      storefrontThemePreviewSearchSchema.parse({
        templateId,
        viewportHeight: "900",
      }),
    ).toEqual({ templateId, viewportHeight: 900 });
    expect(() =>
      storefrontThemePreviewSearchSchema.parse({
        templateId: "index",
        viewportHeight: 900,
      }),
    ).toThrow();
    expect(() =>
      storefrontThemePreviewSearchSchema.parse({
        templateId,
        viewportHeight: 30_000,
      }),
    ).toThrow();
  });
});

describe("publish storefront theme template input schema", () => {
  it("requires valid UUIDs for all IDs", () => {
    const valid = {
      storefrontId: "11111111-1111-4111-8111-111111111111",
      themeId: "22222222-2222-4222-8222-222222222222",
      templateId: "33333333-3333-4333-8333-333333333333",
      sourceRevisionId: "44444444-4444-4444-8444-444444444444",
      expectedDraftRevisionId: "55555555-5555-4555-8555-555555555555",
    };

    expect(publishStorefrontThemeTemplateInputSchema.parse(valid)).toEqual(valid);

    // Missing sourceRevisionId
    expect(() =>
      publishStorefrontThemeTemplateInputSchema.parse({
        storefrontId: "11111111-1111-4111-8111-111111111111",
        themeId: "22222222-2222-4222-8222-222222222222",
        templateId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: "55555555-5555-4555-8555-555555555555",
      }),
    ).toThrow();

    // Missing expectedDraftRevisionId
    expect(() =>
      publishStorefrontThemeTemplateInputSchema.parse({
        storefrontId: "11111111-1111-4111-8111-111111111111",
        themeId: "22222222-2222-4222-8222-222222222222",
        templateId: "33333333-3333-4333-8333-333333333333",
        sourceRevisionId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toThrow();
  });
});
