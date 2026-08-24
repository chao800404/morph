import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { patchThemeInstanceStyleClasses } from "@/lib/storefront/editor/theme-instance-style-source";
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
              {
                id: "principle-care",
                number: "01",
                title: "Care",
                body: "Made with intention.",
              },
              {
                id: "principle-time",
                number: "02",
                title: "Time",
                body: "Built to last.",
              },
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
      container
        .querySelector('[data-morph-node="principle-title"]')
        ?.getAttribute("data-storefront-field-path"),
    ).toBe("items.0.title");
    expect(
      container.querySelectorAll('[data-storefront-field-path="items.1.body"]'),
    ).toHaveLength(1);
  });

  it("renders component-local instance classes for only the matching item", () => {
    const principles = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Principles.tsx",
    );
    expect(principles).toBeDefined();
    const patched = patchThemeInstanceStyleClasses(
      principles?.content ?? "",
      {
        sectionId: "principles-1",
        fieldPath: "items.1.title",
        itemId: "principle-time",
      },
      "principle-title",
      () => "text-[54px] p-[13px]",
    );
    expect(patched.editable).toBe(true);
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
              {
                id: "principle-care",
                number: "01",
                title: "Care",
                body: "First",
              },
              {
                id: "principle-time",
                number: "02",
                title: "Time",
                body: "Second",
              },
            ],
          },
        },
      ],
    };
    const themeFiles = STARTER_THEME_FILES.map((file) =>
      file.path === "src/components/Principles.tsx"
        ? { ...file, content: patched.code }
        : file,
    );
    const { container } = render(
      <StorefrontDocumentRenderer
        document={document}
        themeFiles={themeFiles}
      />,
    );
    const title = container.querySelector(
      '[data-storefront-field-path="items.1.title"]',
    );

    expect(title?.className).toContain("text-[54px]");
    expect(title?.className).toContain("p-[13px]");
    expect(
      container.querySelector('[data-storefront-field-path="items.0.title"]')
        ?.className,
    ).not.toContain("text-[54px]");
    expect(title?.className).not.toContain("data-storefront-section-id");
  });
});
