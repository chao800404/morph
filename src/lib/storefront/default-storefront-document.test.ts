import { describe, expect, it } from "vitest";
import {
  createDefaultStorefrontHomeDocument,
  isUpgradeableStarterHomeDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "./default-storefront-document";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";

describe("default storefront home document", () => {
  it("creates a schema-valid, independently mutable starter document", () => {
    const first = createDefaultStorefrontHomeDocument();
    const second = createDefaultStorefrontHomeDocument();

    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(9);
    expect(storefrontPageDocumentSchema.parse(first)).toEqual(first);
    expect(first.sections).toHaveLength(6);
    expect(first.sections[0]?.type).toBe("hero");
    expect(first.sections.map((section) => section.componentRef)).toEqual([
      "hero.default",
      "editorial-intro.default",
      "category-showcase.default",
      "image-with-text.default",
      "principles.default",
      "newsletter.default",
    ]);
    expect(first).not.toBe(second);
    expect(first.sections).not.toBe(second.sections);
  });

  it("only upgrades an empty or untouched legacy starter document", () => {
    expect(isUpgradeableStarterHomeDocument({ version: 1, sections: [] })).toBe(
      true,
    );
    expect(
      isUpgradeableStarterHomeDocument(createDefaultStorefrontHomeDocument()),
    ).toBe(false);
  });
});
