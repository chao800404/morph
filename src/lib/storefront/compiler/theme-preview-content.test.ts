import { describe, expect, it } from "vitest";
import {
  createThemePreviewContentSnapshot,
  themePreviewContentModuleSource,
  themePreviewContentPluginSource,
} from "./theme-preview-content";

describe("Live Preview draft content", () => {
  it("combines the draft route and layout documents without publishing them", async () => {
    const snapshot = await createThemePreviewContentSnapshot({
      templates: [
        {
          type: "layout",
          document: {
            version: 1,
            sections: [
              {
                id: "header",
                type: "header",
                enabled: true,
                props: { label: "Draft header" },
              },
            ],
          },
        },
        {
          type: "index",
          document: {
            version: 1,
            sections: [
              {
                id: "hero",
                type: "hero",
                enabled: true,
                props: { heading: "Draft heading" },
              },
              {
                id: "newsletter",
                type: "newsletter",
                enabled: false,
                props: {},
              },
            ],
          },
        },
      ],
    });

    expect(snapshot.templates.index).toEqual({
      slots: {
        header: { label: "Draft header" },
        hero: { heading: "Draft heading" },
      },
      hiddenSlots: ["newsletter"],
    });
  });

  it("keeps each draft Page isolated by handle", async () => {
    const snapshot = await createThemePreviewContentSnapshot({
      templates: [],
      pages: [
        {
          handle: "about",
          document: {
            version: 1,
            handle: "about",
            sections: [
              {
                id: "body",
                type: "text",
                enabled: true,
                props: { text: "About draft" },
              },
            ],
          },
        },
      ],
    });

    expect(snapshot.pages.about?.slots.body).toEqual({ text: "About draft" });
  });

  it("keeps a route's own document apart from the shared page document", async () => {
    const section = (id: string, heading: string) => ({
      id,
      type: id,
      enabled: true,
      props: { heading },
    });
    const snapshot = await createThemePreviewContentSnapshot({
      templates: [
        {
          type: "layout",
          document: { version: 1, sections: [section("header", "Shell")] },
        },
        {
          type: "page",
          document: { version: 1, sections: [section("page-hero", "Page")] },
        },
        {
          type: "page",
          routePath: "/aboutus",
          document: { version: 1, sections: [section("featured", "About")] },
        },
      ],
    });

    // The route's document neither replaces nor joins the shared one.
    expect(snapshot.templates.page?.slots).toEqual({
      header: { heading: "Shell" },
      "page-hero": { heading: "Page" },
    });
    expect(snapshot.routes?.["/aboutus"]?.slots).toEqual({
      header: { heading: "Shell" },
      featured: { heading: "About" },
    });
    expect(snapshot.shell?.slots).toEqual({ header: { heading: "Shell" } });

    // The resolver the preview runs, taken the way the dev-server plugin takes it.
    const source = themePreviewContentModuleSource(snapshot);
    const body = source
      .slice(
        source.indexOf("function templateTypeForPath"),
        source.indexOf("export function updatePreviewContent"),
      )
      .replace("export function previewContentForPath", "function previewContentForPath");
    const resolve = new Function(
      "snapshot",
      `${body}; return previewContentForPath;`,
    )(JSON.parse(JSON.stringify(snapshot))) as (path: string) => {
      slots: Record<string, unknown>;
    };
    expect(resolve("/aboutus/").slots).toHaveProperty("featured");
    // A path with no document of its own still gets the shell, as it does live.
    const contact = resolve("/contact");
    expect(contact.slots).toEqual({ header: { heading: "Shell" } });
    // A live edit on that path stays on that path.
    contact.slots.header = { heading: "Edited" };
    expect(resolve("/elsewhere").slots).toEqual({ header: { heading: "Shell" } });
  });

  it("generates a private workspace endpoint and a mutable browser cache", () => {
    const snapshot = {
      templates: {
        index: { slots: { hero: { heading: "Draft" } }, hiddenSlots: [] },
      },
      pages: {},
    } as const;

    expect(themePreviewContentPluginSource(snapshot)).toContain(
      'url.pathname !== "/_morph/content"',
    );
    const module = themePreviewContentModuleSource(snapshot);
    expect(module).toContain("window.fetch =");
    expect(module).toContain("updatePreviewContent");
    expect(module).toContain('heading":"Draft');
    expect(module).toContain("morph:storefront-preview-catalog-request");
    expect(module).toContain("morph:storefront-preview-catalog-response");
    expect(module).toContain("/^\\/api\\/store\\/products");
    expect(module).toContain('input instanceof Request ? input.method : "GET"');
    expect(module).toContain('error: "Invalid product handle"');
  });
});
