import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { describe, expect, it } from "vitest";
import {
  THEME_START_BUILD_DEPENDENCIES,
  THEME_START_RUNTIME_DEPENDENCIES,
} from "./compiler/theme-start-toolchain";
import { STARTER_THEME_FILES } from "./starter-theme-files";
import {
  buildThemeManifestMigrationPlan,
  type ThemeManifestMigrationSnapshot,
} from "./theme-manifest-migration";

const storefrontId = "storefront-1";
const themeId = "theme-1";

function filesWithIds(
  files: readonly {
    path: string;
    content: string;
    mimeType: string;
    isEntry?: boolean;
  }[],
) {
  return files.map((file, index) => ({
    id: `file-${index + 1}`,
    storefrontId,
    themeId,
    path: file.path,
    content: file.content,
    mimeType: file.mimeType,
    isEntry: file.isEntry ?? false,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

const minimalLegacyThemeFiles = filesWithIds([
  {
    path: "package.json",
    mimeType: "application/json",
    content: JSON.stringify({
      dependencies: THEME_START_RUNTIME_DEPENDENCIES,
      devDependencies: THEME_START_BUILD_DEPENDENCIES,
    }),
  },
  {
    path: "src/router.tsx",
    mimeType: "text/typescript",
    content: "export const router = {};",
  },
  {
    path: "src/routes/__root.tsx",
    mimeType: "text/typescript",
    content: `
      import { createRootRoute } from "@tanstack/react-router";
      export const Route = createRootRoute({ component: () => <main /> });
    `,
  },
  {
    path: "src/routes/index.tsx",
    mimeType: "text/typescript",
    isEntry: true,
    content: `
      import { createFileRoute } from "@tanstack/react-router";
      export const Route = createFileRoute("/")({
        component: () => <main />,
      });
    `,
  },
  {
    path: "src/components/sections/Hero.tsx",
    mimeType: "text/typescript",
    content: `
      export const contentFields = { title: { type: "text" } } as const;
      export default function Hero() { return <section />; }
    `,
  },
  {
    path: "morph.theme.json",
    mimeType: "application/json",
    content: JSON.stringify({
      entry: "src/routes/index.tsx",
      router: {
        framework: "tanstack-start",
        previewAdapter: "tanstack-router-client",
        routesDirectory: "src/routes",
        rootRoute: "src/routes/__root.tsx",
        generatedRouteTree: "src/routeTree.gen.ts",
      },
      components: {
        "hero.default": {
          source: "src/components/sections/Hero.tsx",
          contentFields: { title: { type: "text" } },
        },
      },
    }),
  },
]);

function documentWithRef(componentRef: string): StorefrontPageDocument {
  return {
    version: 1,
    sections: [
      {
        id: "hero-1",
        type: "hero",
        componentRef,
        enabled: true,
        props: {},
      },
    ],
  };
}

function snapshot(
  overrides: Partial<ThemeManifestMigrationSnapshot> = {},
): ThemeManifestMigrationSnapshot {
  return {
    storefrontId,
    themeId,
    sourceGeneration: 4,
    files: minimalLegacyThemeFiles,
    templates: [],
    pages: [],
    historicalDocuments: [],
    ...overrides,
  };
}

describe("buildThemeManifestMigrationPlan", () => {
  it("rewrites current logical refs before removing the manifest", () => {
    const plan = buildThemeManifestMigrationPlan(
      snapshot({
        templates: [
          {
            kind: "template",
            id: "template-1",
            baseDocument: documentWithRef("hero.default"),
            draftGeneration: 2,
            draftRevision: null,
            publishedRevision: null,
            maxRevisionVersion: 0,
          },
        ],
      }),
    );

    expect(plan.status).toBe("ready");
    expect(plan.manifestFile?.id).toBe(
      minimalLegacyThemeFiles.find((file) => file.path === "morph.theme.json")
        ?.id,
    );
    expect(
      plan.sourceFilesAfter.some((file) => file.path === "morph.theme.json"),
    ).toBe(false);
    expect(plan.sourceIndexAfter?.status).toBe("complete");
    expect(plan.rewriteCount).toBe(1);
    expect(plan.documentUpdates).toHaveLength(1);
    expect(
      plan.documentUpdates[0]?.baseDocument?.sections[0]?.componentRef,
    ).toBe("src/components/sections/Hero.tsx");
  });

  it("archives compatibility for immutable history without rewriting it", () => {
    const plan = buildThemeManifestMigrationPlan(
      snapshot({
        historicalDocuments: [
          {
            kind: "template",
            ownerId: "template-1",
            revisionId: "revision-1",
            document: documentWithRef("hero.default"),
          },
        ],
      }),
    );

    expect(plan.status).toBe("ready");
    expect(plan.historicalLegacyRefs).toEqual([
      {
        kind: "template",
        ownerId: "template-1",
        revisionId: "revision-1",
        componentRefs: ["hero.default"],
      },
    ]);
    expect(plan.warnings.join(" ")).toContain(
      "immutable history will not be rewritten",
    );
  });

  it("fails closed for an unknown current logical ref", () => {
    const plan = buildThemeManifestMigrationPlan(
      snapshot({
        templates: [
          {
            kind: "template",
            id: "template-1",
            baseDocument: documentWithRef("hero.custom"),
            draftGeneration: 1,
            draftRevision: null,
            publishedRevision: null,
            maxRevisionVersion: 0,
          },
        ],
      }),
    );

    expect(plan.status).toBe("blocked");
    expect(plan.blockers.join(" ")).toContain(
      'uses component ref "hero.custom"',
    );
    expect(plan.documentUpdates).toHaveLength(0);
  });

  it("does not request migration for a source-first Theme", () => {
    const plan = buildThemeManifestMigrationPlan(
      snapshot({ files: filesWithIds(STARTER_THEME_FILES) }),
    );

    expect(plan).toMatchObject({
      status: "not-needed",
      manifestFile: null,
      documentUpdates: [],
      blockers: [],
    });
  });
});
