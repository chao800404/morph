import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { StorefrontDocumentRenderer } from "./storefront-document-renderer";

describe("StorefrontDocumentRenderer Principles source mapping", () => {
  it("uses source classes and stable node metadata while preserving document content", () => {
    const document: StorefrontPageDocument = {
      version: 1,
      sections: [
        {
          id: "principles-1",
          type: "principles",
          componentRef: "principles.default",
          enabled: true,
          props: {
            items: [
              { number: "01", title: "Care", body: "Made with intention." },
              { number: "02", title: "Time", body: "Built to last." },
            ],
          },
        },
      ],
    };
    const { container } = render(
      <StorefrontDocumentRenderer
        document={document}
        themeFiles={STARTER_THEME_FILES}
      />,
    );

    const section = container.querySelector(
      '[data-storefront-section-type="principles"]',
    );
    expect(section?.getAttribute("data-morph-source-file")).toBe(
      "src/components/Principles.tsx",
    );
    expect(section?.getAttribute("data-morph-node")).toBe("principles-root");
    expect(section?.className).toContain("bg-stone-50");
    expect(
      container.querySelectorAll('[data-morph-node="principle-card"]'),
    ).toHaveLength(2);
    expect(
      container.querySelector('[data-morph-node="principle-title"]')
        ?.textContent,
    ).toBe("Care");
    expect(
      container.querySelector('[data-morph-node="principle-body"]')
        ?.textContent,
    ).toBe("Made with intention.");
    expect(
      container.querySelector('[data-morph-node="principle-title"]')
        ?.getAttribute("data-storefront-field-path"),
    ).toBe("items.0.title");
    expect(
      container.querySelectorAll('[data-storefront-field-path="items.1.body"]'),
    ).toHaveLength(1);
  });
});
