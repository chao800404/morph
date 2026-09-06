import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { patchThemeInstanceStyleClasses } from "@/lib/storefront/editor/theme-instance-style-source";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { StorefrontDocumentRenderer } from "./storefront-document-renderer";

describe("StorefrontDocumentRenderer Principles source mapping", () => {
  it("uses source locations and inferred fields while preserving document content", () => {
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
    expect(section?.getAttribute("data-morph-node")).toBeNull();
    expect(section?.className).toContain("bg-stone-50");
    expect(
      container.querySelectorAll('[data-storefront-field-path$=".title"]'),
    ).toHaveLength(2);
    expect(
      container.querySelector('[data-storefront-field-path="items.0.title"]')
        ?.textContent,
    ).toBe("Care");
    expect(
      container.querySelector('[data-storefront-field-path="items.0.body"]')
        ?.textContent,
    ).toBe("Made with intention.");
    expect(
      container
        .querySelector('[data-storefront-field-path="items.0.title"]')
        ?.getAttribute("data-storefront-field-path"),
    ).toBe("items.0.title");
    expect(
      container.querySelectorAll('[data-storefront-field-path="items.1.body"]'),
    ).toHaveLength(1);
  });

  it("uses an authored prop to override a code-authored editable text default", () => {
    const document: StorefrontPageDocument = {
      version: 1,
      sections: [
        {
          id: "principles-1",
          type: "principles",
          componentRef: "principles.default",
          enabled: true,
          props: {
            label: "Materials, made meaningful",
            items: [],
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
    const label = container.querySelector('[data-storefront-field="label"]');

    expect(label?.getAttribute("data-storefront-field")).toBe("label");
    expect(label?.textContent).toBe("Materials, made meaningful");
  });

  it("applies a saved Hero content wrapper class from the latest theme source", () => {
    const hero = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Hero.tsx",
    );
    expect(hero).toBeDefined();
    const themeFiles = STARTER_THEME_FILES.map((file) =>
      file.path === "src/components/Hero.tsx"
        ? {
            ...file,
            content:
              hero?.content.replace(
                '<div className="max-w-xl">',
                '<div data-morph-node="hero-content" data-morph-element="content" className="max-w-xl p-24 bg-black">',
              ) ?? file.content,
          }
        : file,
    );
    const document: StorefrontPageDocument = {
      version: 1,
      sections: [
        {
          id: "hero-1",
          type: "hero",
          componentRef: "hero.default",
          enabled: true,
          props: {},
        },
      ],
    };

    const { container } = render(
      <StorefrontDocumentRenderer
        document={document}
        themeFiles={themeFiles}
      />,
    );
    const content = container.querySelector('[data-morph-node="hero-content"]');
    expect(content?.getAttribute("data-morph-node")).toBe("hero-content");
    expect(content?.getAttribute("data-morph-element")).toBe("content");
    expect(content?.className).toContain("max-w-xl");
    expect(content?.className).toContain("p-24");
    expect(content?.className).toContain("bg-black");
  });

  it("resolves an Asset-backed Hero image before rendering the Theme", () => {
    const document: StorefrontPageDocument = {
      version: 1,
      sections: [
        {
          id: "hero-1",
          type: "hero",
          componentRef: "hero.default",
          enabled: true,
          props: {
            imageSrc: {
              source: "asset",
              mediaType: "image",
              assetId: "6550fe95-9fb0-4008-b837-962da1b449d7",
              url: "/assets/hero.webp",
              name: "Hero image",
            },
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

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/hero.webp",
    );
  });

  it("renders the grouped Hero image source and alt text", () => {
    const document: StorefrontPageDocument = {
      version: 1,
      sections: [
        {
          id: "hero-1",
          type: "hero",
          componentRef: "hero.default",
          enabled: true,
          props: {
            image: {
              src: {
                source: "asset",
                mediaType: "image",
                assetId: "asset-hero",
                url: "/assets/hero.webp",
              },
              alt: "Grouped hero image",
            },
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

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/assets/hero.webp");
    expect(image?.getAttribute("alt")).toBe("Grouped hero image");
    expect(image?.getAttribute("data-storefront-field")).toBe("image");
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
      "47:13",
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

  it("renders a newly code-authored annotated node and keeps it Design-addressable", () => {
    const hero = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Hero.tsx",
    );
    const themeFiles = STARTER_THEME_FILES.map((file) =>
      file.path === "src/components/Hero.tsx"
        ? {
            ...file,
            content:
              hero?.content.replace(
                '<div className="max-w-xl">',
                `<div className="max-w-xl">
          <div
            data-morph-node="hero-notice"
            data-morph-element="notice"
            className="mb-4 rounded-md bg-amber-100 px-4 py-2"
          >
            Code-authored notice
          </div>`,
              ) ?? file.content,
          }
        : file,
    );
    const document: StorefrontPageDocument = {
      version: 1,
      sections: [
        {
          id: "hero-1",
          type: "hero",
          componentRef: "hero.default",
          enabled: true,
          props: {},
        },
      ],
    };

    const { container } = render(
      <StorefrontDocumentRenderer
        document={document}
        themeFiles={themeFiles}
      />,
    );
    const notice = container.querySelector('[data-morph-node="hero-notice"]');

    expect(notice?.textContent).toBe("Code-authored notice");
    expect(notice?.className).toContain("bg-amber-100");
    expect(notice?.getAttribute("data-storefront-field")).toBe("notice");
    expect(
      notice
        ?.closest("[data-storefront-section-id]")
        ?.getAttribute("data-storefront-section-id"),
    ).toBe("hero-1");
  });

  it("renders a newly imported local component with its own source identity", () => {
    const hero = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Hero.tsx",
    );
    const themeFiles = [
      ...STARTER_THEME_FILES.map((file) =>
        file.path === "src/components/Hero.tsx"
          ? {
              ...file,
              content: `import Notice from "./Notice";
${hero?.content ?? ""}`.replace(
                '<div className="max-w-xl">',
                `<div className="max-w-xl">
          <Notice text={heading} />`,
              ),
            }
          : file,
      ),
      {
        path: "src/components/Notice.tsx",
        content: `export default function Notice({ text }: { text: string }) {
  return (
    <aside
      data-morph-node="notice-root"
      data-morph-element="notice"
      className="rounded-lg border p-4"
    >
      {text}
    </aside>
  );
}`,
      },
    ];
    const document: StorefrontPageDocument = {
      version: 1,
      sections: [
        {
          id: "hero-1",
          type: "hero",
          componentRef: "hero.default",
          enabled: true,
          props: { heading: "Imported component" },
        },
      ],
    };

    const { container } = render(
      <StorefrontDocumentRenderer
        document={document}
        themeFiles={themeFiles}
      />,
    );
    const notice = container.querySelector('[data-morph-node="notice-root"]');

    expect(notice?.textContent).toBe("Imported component");
    expect(notice?.getAttribute("data-morph-source-file")).toBe(
      "src/components/Notice.tsx",
    );
    expect(
      notice
        ?.closest("[data-storefront-section-id]")
        ?.getAttribute("data-storefront-section-id"),
    ).toBe("hero-1");
  });

  it("updates code-authored classes without replacing the selected DOM node", () => {
    const createFiles = (className: string) =>
      STARTER_THEME_FILES.map((file) =>
        file.path === "src/components/Hero.tsx"
          ? {
              ...file,
              content: file.content.replace(
                '<div className="max-w-xl">',
                `<div data-morph-node="hero-content" data-morph-element="content" className="${className}">`,
              ),
            }
          : file,
      );
    const document: StorefrontPageDocument = {
      version: 1,
      sections: [
        {
          id: "hero-1",
          type: "hero",
          componentRef: "hero.default",
          enabled: true,
          props: {},
        },
      ],
    };
    const { container, rerender } = render(
      <StorefrontDocumentRenderer
        document={document}
        themeFiles={createFiles("max-w-xl bg-white")}
      />,
    );
    const before = container.querySelector('[data-morph-node="hero-content"]');
    before?.setAttribute("data-storefront-editor-selected", "true");

    rerender(
      <StorefrontDocumentRenderer
        document={document}
        themeFiles={createFiles("max-w-xl bg-black")}
      />,
    );
    const after = container.querySelector('[data-morph-node="hero-content"]');

    expect(after).toBe(before);
    expect(after?.className).toContain("bg-black");
    expect(after?.getAttribute("data-storefront-editor-selected")).toBe("true");
  });

  it("fails closed for executable tags instead of silently using a specialized renderer", () => {
    const themeFiles = STARTER_THEME_FILES.map((file) =>
      file.path === "src/components/Hero.tsx"
        ? {
            ...file,
            content: `export default function Hero() {
  return <section data-morph-node="hero-root"><script>unsafe()</script></section>;
}`,
          }
        : file,
    );
    const document: StorefrontPageDocument = {
      version: 1,
      sections: [
        {
          id: "hero-1",
          type: "hero",
          componentRef: "hero.default",
          enabled: true,
          props: {},
        },
      ],
    };

    const { container } = render(
      <StorefrontDocumentRenderer
        document={document}
        themeFiles={themeFiles}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(
      container.querySelector("[data-storefront-theme-component-diagnostic]")
        ?.textContent,
    ).toContain("not allowed");
  });
});
