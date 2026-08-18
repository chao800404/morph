import { describe, expect, it } from "vitest";
import {
  publishStorefrontThemeTemplateInputSchema,
  reorderStorefrontThemeSectionsInputSchema,
  storefrontThemeEditorSearchSchema,
  storefrontThemePreviewSearchSchema,
  updateStorefrontThemeSectionPropsInputSchema,
} from "./storefront-theme";
import {
  createThemeRevisionInputSchema,
  deleteThemeFileInputSchema,
  rollbackThemeRevisionInputSchema,
  saveThemeFileInputSchema,
  saveThemeFilesBatchInputSchema,
} from "./storefront-theme-file";

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

describe("publish storefront theme template input schema", () => {
  it("requires valid UUIDs for all IDs, valid expectedDraftGeneration, and valid expectedReleaseGeneration", () => {
    const valid = {
      storefrontId: "11111111-1111-4111-8111-111111111111",
      themeId: "22222222-2222-4222-8222-222222222222",
      templateId: "33333333-3333-4333-8333-333333333333",
      sourceRevisionId: "44444444-4444-4444-8444-444444444444",
      themeBuildId: "66666666-6666-4666-8666-666666666666",
      expectedDraftRevisionId: "55555555-5555-4555-8555-555555555555",
      expectedDraftGeneration: 1,
      expectedReleaseGeneration: 1,
    };

    expect(publishStorefrontThemeTemplateInputSchema.parse(valid)).toEqual(valid);

    // Missing sourceRevisionId
    expect(() =>
      publishStorefrontThemeTemplateInputSchema.parse({
        storefrontId: "11111111-1111-4111-8111-111111111111",
        themeId: "22222222-2222-4222-8222-222222222222",
        templateId: "33333333-3333-4333-8333-333333333333",
        expectedDraftRevisionId: "55555555-5555-4555-8555-555555555555",
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 1,
      }),
    ).toThrow();

    // Missing expectedDraftRevisionId
    expect(() =>
      publishStorefrontThemeTemplateInputSchema.parse({
        storefrontId: "11111111-1111-4111-8111-111111111111",
        themeId: "22222222-2222-4222-8222-222222222222",
        templateId: "33333333-3333-4333-8333-333333333333",
        sourceRevisionId: "44444444-4444-4444-8444-444444444444",
        expectedDraftGeneration: 1,
        expectedReleaseGeneration: 1,
      }),
    ).toThrow();

    // Missing expectedDraftGeneration
    expect(() =>
      publishStorefrontThemeTemplateInputSchema.parse({
        storefrontId: "11111111-1111-4111-8111-111111111111",
        themeId: "22222222-2222-4222-8222-222222222222",
        templateId: "33333333-3333-4333-8333-333333333333",
        sourceRevisionId: "44444444-4444-4444-8444-444444444444",
        expectedDraftRevisionId: "55555555-5555-4555-8555-555555555555",
        expectedReleaseGeneration: 1,
      }),
    ).toThrow();

    // Missing expectedReleaseGeneration
    expect(() =>
      publishStorefrontThemeTemplateInputSchema.parse({
        storefrontId: "11111111-1111-4111-8111-111111111111",
        themeId: "22222222-2222-4222-8222-222222222222",
        templateId: "33333333-3333-4333-8333-333333333333",
        sourceRevisionId: "44444444-4444-4444-8444-444444444444",
        expectedDraftRevisionId: "55555555-5555-4555-8555-555555555555",
        expectedDraftGeneration: 1,
      }),
    ).toThrow();
  });
});

describe("create theme revision input schema", () => {
  it("requires expectedSourceGeneration integer >= 1", () => {
    const valid = {
      storefrontId: "storefront-1",
      themeId: "theme-1",
      expectedSourceGeneration: 5,
      message: "Checkpoint",
    };

    expect(createThemeRevisionInputSchema.parse(valid)).toEqual({
      ...valid,
      source: "manual",
    });

    // Missing expectedSourceGeneration
    expect(() =>
      createThemeRevisionInputSchema.parse({
        storefrontId: "storefront-1",
        themeId: "theme-1",
        message: "Checkpoint",
      }),
    ).toThrow();

    // Invalid generation (< 1)
    expect(() =>
      createThemeRevisionInputSchema.parse({
        storefrontId: "storefront-1",
        themeId: "theme-1",
        expectedSourceGeneration: 0,
      }),
    ).toThrow();
  });
});

describe("reorder and update props schemas", () => {
  it("requires expectedDraftGeneration on reorder and update props", () => {
    const storefrontId = crypto.randomUUID();
    const themeId = crypto.randomUUID();
    const templateId = crypto.randomUUID();

    const validReorder = {
      storefrontId,
      themeId,
      templateId,
      sectionIds: ["s1", "s2"],
      expectedDraftGeneration: 2,
    };
    expect(reorderStorefrontThemeSectionsInputSchema.parse(validReorder)).toEqual(validReorder);

    expect(() =>
      reorderStorefrontThemeSectionsInputSchema.parse({
        storefrontId,
        themeId,
        templateId,
        sectionIds: ["s1", "s2"],
      }),
    ).toThrow();

    const validProps = {
      storefrontId,
      themeId,
      templateId,
      sectionId: "s1",
      props: { title: "Hello" },
      expectedDraftGeneration: 3,
    };
    expect(updateStorefrontThemeSectionPropsInputSchema.parse(validProps)).toEqual(validProps);

    expect(() =>
      updateStorefrontThemeSectionPropsInputSchema.parse({
        storefrontId,
        themeId,
        templateId,
        sectionId: "s1",
        props: { title: "Hello" },
      }),
    ).toThrow();
  });
});

describe("rollback theme revision input schema", () => {
  it("requires expectedSourceGeneration >= 1", () => {
    const valid = {
      storefrontId: "storefront-1",
      themeId: "theme-1",
      revisionNumber: 2,
      expectedSourceGeneration: 4,
    };
    expect(rollbackThemeRevisionInputSchema.parse(valid)).toEqual(valid);

    expect(() =>
      rollbackThemeRevisionInputSchema.parse({
        storefrontId: "storefront-1",
        themeId: "theme-1",
        revisionNumber: 2,
      }),
    ).toThrow();
  });
});

describe("save and delete theme file schemas", () => {
  it("requires expectedSourceGeneration on save, batch save, and delete", () => {
    const validSave = {
      storefrontId: "store-1",
      themeId: "theme-1",
      path: "src/pages/index.tsx",
      content: "console.log(1)",
      expectMissing: true,
      expectedSourceGeneration: 1,
    };
    expect(saveThemeFileInputSchema.parse(validSave)).toEqual({
      ...validSave,
      createRevision: false,
    });

    expect(() =>
      saveThemeFileInputSchema.parse({
        storefrontId: "store-1",
        themeId: "theme-1",
        path: "src/pages/index.tsx",
        content: "console.log(1)",
        expectMissing: true,
      }),
    ).toThrow();

    const validBatch = {
      storefrontId: "store-1",
      themeId: "theme-1",
      files: [
        {
          path: "src/pages/index.tsx",
          content: "console.log(1)",
          expectMissing: true,
        },
      ],
      expectedSourceGeneration: 2,
    };
    expect(saveThemeFilesBatchInputSchema.parse(validBatch)).toEqual({
      ...validBatch,
      createRevision: false,
    });

    expect(() =>
      saveThemeFilesBatchInputSchema.parse({
        storefrontId: "store-1",
        themeId: "theme-1",
        files: [
          {
            path: "src/pages/index.tsx",
            content: "console.log(1)",
            expectMissing: true,
          },
        ],
      }),
    ).toThrow();

    const validDelete = {
      storefrontId: "store-1",
      themeId: "theme-1",
      path: "src/pages/index.tsx",
      expectedFileId: crypto.randomUUID(),
      expectedVersion: 1,
      expectedSourceGeneration: 3,
    };
    expect(deleteThemeFileInputSchema.parse(validDelete)).toEqual(validDelete);

    expect(() =>
      deleteThemeFileInputSchema.parse({
        storefrontId: "store-1",
        themeId: "theme-1",
        path: "src/pages/index.tsx",
        expectedFileId: crypto.randomUUID(),
        expectedVersion: 1,
      }),
    ).toThrow();
  });

  it("rejects file paths containing node_modules segments", () => {
    const invalidPaths = [
      "node_modules/foo.js",
      "node_modules/vite/x.js",
      "node_modules/.bin/vite",
      "src/node_modules/evil.ts",
      "foo/node_modules/bar.js",
      "NODE_MODULES/package.json",
    ];

    for (const invalidPath of invalidPaths) {
      expect(() =>
        saveThemeFileInputSchema.parse({
          storefrontId: "store-1",
          themeId: "theme-1",
          path: invalidPath,
          content: "console.log(1)",
          expectMissing: true,
          expectedSourceGeneration: 1,
        }),
      ).toThrow(/node_modules/);
    }
  });
});
