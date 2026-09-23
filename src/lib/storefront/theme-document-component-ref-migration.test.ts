import { describe, expect, it } from "vitest";
import {
  migrateThemeDocumentComponentRefs,
  readExactManifestComponentRefs,
} from "./theme-document-component-ref-migration";

const files = [
  { path: "src/components/Hero.tsx" },
  { path: "src/components/Promo.tsx" },
];

const document = {
  version: 1 as const,
  sections: [
    {
      id: "hero-1",
      type: "hero",
      componentRef: "hero.default",
      enabled: true,
      props: {},
    },
    {
      id: "promo-1",
      type: "promo",
      componentRef: "src/components/Promo.tsx",
      enabled: true,
      props: {},
    },
  ],
};

describe("theme document component-ref migration", () => {
  it("rewrites only exact manifest refs to source paths", () => {
    const result = migrateThemeDocumentComponentRefs({
      document,
      files,
      manifestContent: JSON.stringify({
        components: {
          "hero.default": { source: "src/components/Hero.tsx" },
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      rewrites: [
        {
          from: "hero.default",
          to: "src/components/Hero.tsx",
          sectionId: "hero-1",
        },
      ],
    });
    if (result.ok) {
      expect(result.document.sections[0]?.componentRef).toBe(
        "src/components/Hero.tsx",
      );
      expect(result.document.sections[1]?.componentRef).toBe(
        "src/components/Promo.tsx",
      );
    }
  });

  it("rejects unknown refs instead of guessing from section type", () => {
    const result = migrateThemeDocumentComponentRefs({
      document: {
        ...document,
        sections: [
          { ...document.sections[0], componentRef: "hero.custom" },
        ],
      },
      files,
      manifestContent: JSON.stringify({
        components: {
          "hero.default": { source: "src/components/Hero.tsx" },
        },
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "unknown-component-ref",
      componentRef: "hero.custom",
      sectionId: "hero-1",
    });
  });

  it("rejects a manifest mapping whose source no longer exists", () => {
    const result = migrateThemeDocumentComponentRefs({
      document,
      files: [{ path: "src/components/Promo.tsx" }],
      manifestContent: JSON.stringify({
        components: {
          "hero.default": { source: "src/components/Hero.tsx" },
        },
      }),
    });

    expect(result).toMatchObject({ ok: false, reason: "missing-source" });
  });

  it("rejects invalid documents and invalid manifest JSON", () => {
    expect(
      migrateThemeDocumentComponentRefs({
        document: { version: 1, sections: "not-an-array" },
        files,
        manifestContent: "{}",
      }),
    ).toMatchObject({ ok: false, reason: "invalid-document" });

    expect(readExactManifestComponentRefs("{oops")).toMatchObject({
      ok: false,
      reason: "invalid-manifest",
    });
  });
});
