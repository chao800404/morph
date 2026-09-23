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

    // Pinned so a bump is always a deliberate decision: raising it re-runs the
    // Starter upgrade for every existing Theme.
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(26);
    expect(storefrontPageDocumentSchema.parse(first)).toEqual(first);
    expect(first.sections).toHaveLength(6);
    expect(first.sections[0]?.type).toBe("hero");
    expect(first.sections.map((section) => section.componentRef)).toEqual([
      "src/components/Hero.tsx",
      "src/components/EditorialIntro.tsx",
      "src/components/CategoryShowcase.tsx",
      "src/components/ImageWithText.tsx",
      "src/components/Principles.tsx",
      "src/components/Newsletter.tsx",
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
    expect(
      isUpgradeableStarterHomeDocument({
        version: 1,
        sections: [
          {
            id: "starter-hero",
            type: "hero",
            enabled: true,
            props: {
              eyebrow: "New collection",
              heading: "Objects for everyday rituals.",
              description:
                "Quiet essentials, thoughtfully made for the spaces you call home.",
              actionLabel: "Explore the collection",
              actionHref: "/collections/new",
              imageSrc: "/static/storefront/theme-preview-default.png",
              imageAlt: "A neutral collection of ceramic objects",
            },
          },
        ],
      }),
    ).toBe(true);
  });
});
