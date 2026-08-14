import { describe, expect, it } from "vitest";
import {
  storefrontPreferencesSchema,
  updateStorefrontAccessInputSchema,
  updateStorefrontInputSchema,
} from "./storefront";

const validInput = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Morph Store",
};

describe("storefront website information validation", () => {
  it("accepts website identity and default SEO metadata", () => {
    expect(
      updateStorefrontInputSchema.parse({
        ...validInput,
        seoTitle: "Objects for everyday rituals",
        seoDescription: "Quiet essentials for considered spaces.",
      }),
    ).toMatchObject(validInput);
  });

  it("keeps unrelated JSON preferences available to later capabilities", () => {
    const parsed = storefrontPreferencesSchema.parse({
      seoTitle: "Morph Store",
      themeTokens: { radius: "medium" },
    });
    expect(parsed.themeTokens).toEqual({ radius: "medium" });
  });

  it("defaults storefront access to private", () => {
    expect(storefrontPreferencesSchema.parse({}).accessMode).toBe("private");
  });

  it("only accepts supported storefront access modes", () => {
    expect(
      updateStorefrontAccessInputSchema.parse({
        id: validInput.id,
        accessMode: "public",
      }).accessMode,
    ).toBe("public");
    expect(() =>
      updateStorefrontAccessInputSchema.parse({
        id: validInput.id,
        accessMode: "password",
      }),
    ).toThrow();
  });

  it("rejects an empty website name", () => {
    expect(() =>
      updateStorefrontInputSchema.parse({ ...validInput, name: " " }),
    ).toThrow();
  });

  it("rejects SEO values beyond their publishing limits", () => {
    expect(() =>
      updateStorefrontInputSchema.parse({
        ...validInput,
        seoTitle: "x".repeat(71),
      }),
    ).toThrow();
    expect(() =>
      updateStorefrontInputSchema.parse({
        ...validInput,
        seoDescription: "x".repeat(321),
      }),
    ).toThrow();
  });
});
