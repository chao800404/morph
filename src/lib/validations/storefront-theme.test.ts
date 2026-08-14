import { describe, expect, it } from "vitest";
import {
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
