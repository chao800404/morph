import { describe, expect, it } from "vitest";
import {
  auditThemeComponentRefs,
  buildThemeContentShadowReport,
} from "./theme-content-capability-shadow";
import {
  STARTER_THEME_FILES,
  STARTER_THEME_FILES_WITH_LEGACY_MANIFEST,
} from "./starter-theme-files";

const manifest = JSON.stringify({
  version: 1,
  components: {
    "hero.default": {
      source: "src/components/Hero.tsx",
      contentFields: { title: { type: "text" } },
    },
    "stale.default": {
      source: "src/components/Stale.tsx",
      contentFields: { oldTitle: { type: "text" } },
    },
    "missing.default": {
      source: "src/components/Missing.tsx",
      contentFields: { title: { type: "text" } },
    },
    "broken.default": {
      source: "src/components/Broken.tsx",
      contentFields: { title: { type: "text" } },
    },
  },
});

const files = [
  { path: "morph.theme.json", content: manifest },
  {
    path: "src/components/Hero.tsx",
    content: `
      export const contentFields = { title: { type: "text" } } as const;
      export default function Hero() { return null; }
    `,
  },
  {
    path: "src/components/Stale.tsx",
    content: `
      export const contentFields = { freshTitle: { type: "text" } } as const;
      export default function Stale() { return null; }
    `,
  },
  {
    path: "src/components/Only.tsx",
    content: `
      export const contentFields = { onlyHere: { type: "text" } } as const;
      export default function Only() { return null; }
    `,
  },
  {
    path: "src/components/Broken.tsx",
    content: `export const contentFields = { title: ;`,
  },
];

describe("buildThemeContentShadowReport", () => {
  it("separates equivalent, drifted, manifest-only, and unsupported entries", () => {
    const report = buildThemeContentShadowReport({
      files,
      sourceGeneration: 7,
      draftRefs: [
        { componentRef: "hero.default" },
        { componentRef: "missing.default" },
        { componentRef: "unknown.default" },
        {},
      ],
    });

    expect(report.sourceScan.completeness).toBe("complete");
    expect(report.sourceKey).toEqual({
      scope: "workspace",
      sourceGeneration: 7,
      derivationVersion: 1,
    });
    expect(report.summary).toEqual({
      equivalent: 1,
      "source-derived-manifest-drift": 2,
      "manifest-only": 1,
      unsupported: 1,
    });
    expect(report.migrationGate).toBe("blocked");
    expect(report.draftComponentRefs).toEqual({
      total: 4,
      resolved: 1,
      unresolved: 2,
      missingRef: 1,
      unresolvedRefs: ["missing.default", "unknown.default"],
    });
  });

  it("marks an index incomplete instead of treating the bounded scan as complete", () => {
    const manyFiles = [
      ...files,
      ...Array.from({ length: 201 }, (_, index) => ({
        path: `src/components/generated-${String(index).padStart(3, "0")}.tsx`,
        content: "export default function Generated() { return null; }",
      })),
    ];

    const report = buildThemeContentShadowReport({
      files: manyFiles,
      sourceGeneration: 1,
    });

    expect(report.sourceScan.completeness).toBe("incomplete");
    expect(report.migrationGate).toBe("blocked");
    expect(report.migrationBlockers[0]).toContain("incomplete");
  });

  it("keys an immutable revision audit by sorted source digests", () => {
    const report = buildThemeContentShadowReport({
      files,
      sourceGeneration: 12,
      sourceManifest: {
        version: 1,
        algorithm: "sha256",
        files: [
          { path: "src/components/Hero.tsx", digest: "b" },
          { path: "morph.theme.json", digest: "a" },
        ],
      },
    });

    expect(report.sourceKey).toEqual({
      scope: "revision",
      digestSet: "morph.theme.json:a|src/components/Hero.tsx:b",
      derivationVersion: 1,
    });
  });
});

describe("auditThemeComponentRefs", () => {
  it("keeps missing refs separate from unresolved refs", () => {
    expect(
      auditThemeComponentRefs({
        refs: [{}, { componentRef: "hero.default" }, { componentRef: "nope" }],
        knownRefs: new Set(["hero.default"]),
      }),
    ).toEqual({
      total: 3,
      resolved: 1,
      unresolved: 1,
      missingRef: 1,
      unresolvedRefs: ["nope"],
    });
  });
});

describe("source contract shadow comparison", () => {
  it("proves the starter route contract without reading the manifest", () => {
    const report = buildThemeContentShadowReport({
      files: STARTER_THEME_FILES,
      sourceGeneration: 4,
    });

    expect(report.sourceContract.derivation.complete).toBe(true);
    expect(report.sourceContract.comparisons).toEqual({
      entry: { status: "not-declared", differences: [] },
      router: { status: "not-declared", differences: [] },
      documentLayout: { status: "not-declared", differences: [] },
      components: { status: "equivalent", differences: [] },
      sections: { status: "equivalent", differences: [] },
    });
  });

  it("blocks manifest removal when a document still uses a legacy ref", () => {
    const report = buildThemeContentShadowReport({
      files: STARTER_THEME_FILES_WITH_LEGACY_MANIFEST,
      sourceGeneration: 3,
      draftRefs: [{ componentRef: "hero.default" }],
      historicalRefs: [],
    });

    expect(report.manifestRemovalGate).toBe("blocked");
    expect(report.draftSourceComponentRefs?.unresolved).toBe(1);
    expect(report.manifestRemovalBlockers).toContain(
      "Draft Documents still contain component references that source cannot resolve.",
    );
  });
});
