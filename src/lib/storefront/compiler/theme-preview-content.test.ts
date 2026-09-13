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
  });
});
