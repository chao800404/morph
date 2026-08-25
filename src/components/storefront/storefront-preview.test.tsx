import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { createDefaultStorefrontHomeDocument } from "@/lib/storefront/default-storefront-document";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { StorefrontPreview } from "./storefront-preview";

const document = createDefaultStorefrontHomeDocument();
const context: StorefrontThemeEditorDTO = {
  storefront: {
    id: "storefront-a",
    name: "Stored test shop",
    domain: null,
    status: "draft",
    activeReleaseId: null,
  },
  theme: {
    id: "theme-a",
    name: "Default",
    status: "draft",
    releaseGeneration: 1,
    activeRelease: null,
  },
  templates: [
    {
      id: "template-a",
      type: "index",
      name: "Default",
      document,
      draftRevisionId: null,
      publishedRevisionId: null,
      draftGeneration: 1,
    },
  ],
};

describe("StorefrontPreview stored starter composition", () => {
  it("renders the Theme Workspace page shell around every stored document section", () => {
    const routeDocument = {
      ...document,
      sections: document.sections.map((section) =>
        section.id === "starter-hero"
          ? {
              ...section,
              props: { ...section.props, heading: "Heading from D1" },
            }
          : section,
      ),
    };
    const html = renderToStaticMarkup(
      <StorefrontPreview
        context={context}
        templateId="template-a"
        viewportHeight={900}
        document={routeDocument}
        themeFiles={STARTER_THEME_FILES}
      />,
    );

    expect(html).toContain('data-morph-node="page-root"');
    expect(html).toContain('data-morph-node="header-root"');
    expect(html).toContain('data-morph-node="footer-root"');
    expect(html).toContain("Stored test shop");
    expect(html).toContain("Heading from D1");
    for (const section of document.sections) {
      expect(html).toContain(`data-storefront-section-id="${section.id}"`);
    }
    expect(html).not.toContain("Theme layout preview unavailable");
    expect(html).not.toContain("Unsupported section");
  });

  it("fails visibly when the route-owned page shell cannot render", () => {
    const themeFiles = STARTER_THEME_FILES.map((file) =>
      file.path === "src/layouts/StorefrontLayout.tsx"
        ? {
            ...file,
            content: "export default function Broken() { return missing(); }",
          }
        : file,
    );
    const html = renderToStaticMarkup(
      <StorefrontPreview
        context={context}
        templateId="template-a"
        viewportHeight={900}
        themeFiles={themeFiles}
      />,
    );

    expect(html).toContain("Theme route preview unavailable");
    expect(html).not.toContain('data-morph-node="header-root"');
  });

  it("renders only the components explicitly imported by the authored route", () => {
    const themeFiles = STARTER_THEME_FILES.map((file) =>
      file.path === "src/routes/index.tsx"
        ? {
            ...file,
            content: `import { createFileRoute } from "@tanstack/react-router";
import Hero from "../components/Hero";
import Principles from "../components/Principles";
export const Route = createFileRoute("/")({
  component: () => <main data-morph-node="authored-home-route"><Hero /><Principles /></main>,
});`,
          }
        : file,
    );
    const html = renderToStaticMarkup(
      <StorefrontPreview
        context={context}
        templateId="template-a"
        viewportHeight={900}
        themeFiles={themeFiles}
      />,
    );

    expect(html).toContain('data-morph-node="authored-home-route"');
    expect(html).toContain('data-storefront-section-id="starter-hero"');
    expect(html).toContain('data-storefront-section-id="starter-principles"');
    expect(html).not.toContain(
      'data-storefront-section-id="starter-introduction"',
    );
  });
});
