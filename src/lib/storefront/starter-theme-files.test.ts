import { describe, expect, it } from "vitest";
import { parseComponentSource } from "./ast/theme-ast-transformer";
import {
  createStarterThemeWorkspaceUpgrade,
  createStarterThemeWorkspaceUpgradePlan,
  STARTER_THEME_FILES,
} from "./starter-theme-files";
import {
  LEGACY_STARTER_THEME_FOOTER_SOURCE,
  LEGACY_STARTER_THEME_HEADER_SOURCE,
  LEGACY_STARTER_THEME_INDEX_SOURCE,
  LEGACY_STARTER_THEME_HOME_ROUTE_SOURCE,
  LEGACY_STARTER_THEME_STOREFRONT_PAGE_ROUTE_SOURCE,
  STARTER_THEME_HOME_ROUTE_SOURCE,
  STARTER_THEME_V3_NEW_FILES,
} from "./starter-theme-v3-files";

describe("starter Principles theme source", () => {
  it("registers the principles component and exposes stable editable nodes", () => {
    const manifest = JSON.parse(
      STARTER_THEME_FILES.find((file) => file.path === "morph.theme.json")!
        .content,
    ) as {
      components: Record<string, { source: string }>;
      sections: Record<string, { componentRef: string; source: string }>;
    };
    expect(manifest.components["principles.default"]).toMatchObject({
      source: "src/components/Principles.tsx",
      sectionType: "principles",
    });
    expect(manifest.sections.principles).toEqual({
      componentRef: "principles.default",
      source: "src/components/Principles.tsx",
    });

    const source = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Principles.tsx",
    )!.content;
    const parsed = parseComponentSource(source);
    expect(parsed.parseOk).toBe(true);
    expect(parsed.nodeMap["principles-root"]?.className).toContain(
      "bg-stone-50",
    );
    expect(parsed.nodeMap["principle-card"]?.className).toContain("border-b");
    expect(parsed.nodeMap["principle-title"]?.className).toContain(
      "font-serif",
    );
    expect(parsed.nodeMap["principle-body"]?.className).toContain("leading-6");
  });

  it("stores the complete preview shell and every starter section in the workspace", () => {
    const manifest = JSON.parse(
      STARTER_THEME_FILES.find((file) => file.path === "morph.theme.json")!
        .content,
    ) as {
      entry: string;
      router: {
        framework: string;
        routesDirectory: string;
      };
      documentLayout: { source: string };
      components: Record<string, { source: string }>;
      sections: Record<string, { componentRef: string; source: string }>;
    };

    expect(manifest.documentLayout).toEqual({
      source: "src/layouts/StorefrontLayout.tsx",
    });
    expect(manifest.entry).toBe("src/routes/index.tsx");
    expect(manifest.router).toEqual(
      expect.objectContaining({
        framework: "tanstack-start",
        routesDirectory: "src/routes",
      }),
    );
    expect(Object.keys(manifest.sections)).toEqual([
      "hero",
      "editorial-intro",
      "category-showcase",
      "image-with-text",
      "principles",
      "newsletter",
    ]);
    for (const section of Object.values(manifest.sections)) {
      expect(manifest.components[section.componentRef]?.source).toBe(
        section.source,
      );
      expect(
        STARTER_THEME_FILES.some((file) => file.path === section.source),
      ).toBe(true);
    }
    expect(
      STARTER_THEME_FILES.some((file) => file.path.startsWith("src/pages/")),
    ).toBe(false);
    expect(
      STARTER_THEME_FILES.some((file) => file.path === "src/routes/__root.tsx"),
    ).toBe(true);
    expect(
      STARTER_THEME_FILES.some((file) => file.path === "src/router.tsx"),
    ).toBe(true);
    const homeRoute = STARTER_THEME_FILES.find(
      (file) => file.path === "src/routes/index.tsx",
    )!.content;
    for (const component of [
      "Hero",
      "EditorialIntro",
      "CategoryShowcase",
      "ImageWithText",
      "Principles",
      "Newsletter",
    ]) {
      expect(homeRoute).toContain(`import ${component} from`);
      expect(homeRoute).toContain(`<${component} />`);
    }
    expect(homeRoute).not.toContain("StorefrontPage");

    const packageJson = JSON.parse(
      STARTER_THEME_FILES.find((file) => file.path === "package.json")!.content,
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.dependencies).toMatchObject({
      "@tanstack/react-router": "1.170.18",
      "@tanstack/react-start": "1.168.32",
    });
    expect(packageJson.devDependencies).toMatchObject({
      "@tanstack/router-plugin": "1.168.23",
      "@cloudflare/vite-plugin": "1.50.0",
      vite: "7.2.7",
    });
  });

  it("upgrades only untouched legacy layout files and missing v3 components", () => {
    const legacyManifest = {
      name: "Dawn Starter",
      entry: "src/pages/index.tsx",
      components: {
        "hero.default": {
          source: "src/components/Hero.tsx",
          customMetadata: "preserve-me",
        },
        "principles.default": {
          source: "src/components/Principles.tsx",
          contentFields: { label: { type: "text" } },
        },
        "layout.header": { source: "src/components/Header.tsx" },
        "layout.footer": { source: "src/components/Footer.tsx" },
      },
      sections: {
        hero: {
          componentRef: "hero.default",
          source: "src/components/Hero.tsx",
        },
        principles: {
          componentRef: "principles.default",
          source: "src/components/Principles.tsx",
        },
      },
    };
    const existing = [
      {
        id: "header",
        path: "src/components/Header.tsx",
        content: LEGACY_STARTER_THEME_HEADER_SOURCE,
        version: 1,
      },
      {
        id: "footer",
        path: "src/components/Footer.tsx",
        content: LEGACY_STARTER_THEME_FOOTER_SOURCE,
        version: 1,
      },
      {
        id: "index",
        path: "src/pages/index.tsx",
        content: LEGACY_STARTER_THEME_INDEX_SOURCE,
        version: 1,
      },
      {
        id: "manifest",
        path: "morph.theme.json",
        content: JSON.stringify(legacyManifest, null, 2),
        version: 7,
      },
      {
        id: "package",
        path: "package.json",
        content: JSON.stringify({
          name: "customer-theme",
          dependencies: { clsx: "customer-version" },
        }),
        version: 3,
      },
      {
        id: "principles",
        path: "src/components/Principles.tsx",
        content: "authored principles source",
        version: 11,
      },
    ];

    const upgradePlan = createStarterThemeWorkspaceUpgradePlan(existing);
    const upgrades = upgradePlan.files;
    expect(
      STARTER_THEME_V3_NEW_FILES.every((file) =>
        upgrades.some(
          (upgrade) => upgrade.path === file.path && upgrade.expectMissing,
        ),
      ),
    ).toBe(true);
    expect(
      upgrades.some((upgrade) => upgrade.path === "src/pages/index.tsx"),
    ).toBe(false);
    expect(upgradePlan.deletions).toEqual([
      {
        path: "src/pages/index.tsx",
        expectedFileId: "index",
        expectedVersion: 1,
      },
    ]);
    expect(
      upgrades.some(
        (upgrade) => upgrade.path === "src/components/Principles.tsx",
      ),
    ).toBe(false);

    const manifestUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "morph.theme.json",
    );
    const upgradedManifest = JSON.parse(
      manifestUpgrade!.content,
    ) as typeof legacyManifest & {
      documentLayout: { source: string };
    };
    expect(upgradedManifest.components["hero.default"].customMetadata).toBe(
      "preserve-me",
    );
    expect(
      upgradedManifest.components["principles.default"].contentFields,
    ).toEqual({ label: { type: "text" } });
    expect(upgradedManifest.documentLayout).toEqual({
      source: "src/layouts/StorefrontLayout.tsx",
    });
    expect(upgradedManifest.entry).toBe("src/routes/index.tsx");

    const packageUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "package.json",
    );
    const upgradedPackage = JSON.parse(packageUpgrade!.content) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageUpgrade).toMatchObject({
      expectedFileId: "package",
      expectedVersion: 3,
    });
    expect(upgradedPackage.dependencies.clsx).toBe("customer-version");
    expect(upgradedPackage.dependencies["@tanstack/react-start"]).toBe(
      "1.168.32",
    );
    expect(upgradedPackage.devDependencies["@tanstack/router-plugin"]).toBe(
      "1.168.23",
    );
  });

  it("does not declare a document layout over an authored entry file", () => {
    const targetManifest = STARTER_THEME_FILES.find(
      (file) => file.path === "morph.theme.json",
    )!;
    const legacyManifest = JSON.parse(targetManifest.content) as Record<
      string,
      unknown
    >;
    delete legacyManifest.documentLayout;
    const upgrades = createStarterThemeWorkspaceUpgrade([
      {
        id: "index",
        path: "src/pages/index.tsx",
        content: "export default function CustomPage() { return <main />; }",
        version: 4,
      },
      {
        id: "manifest",
        path: "morph.theme.json",
        content: JSON.stringify(legacyManifest, null, 2),
        version: 4,
      },
      {
        id: "package",
        path: "package.json",
        content: JSON.stringify({
          name: "authored-start-theme",
          dependencies: { clsx: "customer-version" },
        }),
        version: 9,
      },
    ]);
    const manifestUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "morph.theme.json",
    );
    expect(manifestUpgrade?.content ?? "").not.toContain('"documentLayout"');
    expect(
      upgrades.some((upgrade) => upgrade.path === "src/pages/index.tsx"),
    ).toBe(false);
    const packageUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "package.json",
    );
    expect(packageUpgrade).toMatchObject({
      expectedFileId: "package",
      expectedVersion: 9,
    });
    expect(packageUpgrade?.content).toContain('"@tanstack/react-start"');
  });

  it("preserves an authored legacy page during the route workspace upgrade", () => {
    const plan = createStarterThemeWorkspaceUpgradePlan([
      {
        id: "authored-page",
        path: "src/pages/index.tsx",
        content: "export default function CustomPage() { return <main />; }",
        version: 8,
      },
      {
        id: "route",
        path: "src/routes/index.tsx",
        content: "export const Route = {};",
        version: 2,
      },
    ]);

    expect(plan.deletions).toEqual([]);
  });

  it("upgrades untouched legacy routes to direct component composition", () => {
    const upgrades = createStarterThemeWorkspaceUpgrade([
      {
        id: "route",
        path: "src/routes/index.tsx",
        content: LEGACY_STARTER_THEME_STOREFRONT_PAGE_ROUTE_SOURCE,
        version: 4,
      },
      {
        id: "manifest",
        path: "morph.theme.json",
        content: STARTER_THEME_FILES.find(
          (file) => file.path === "morph.theme.json",
        )!.content,
        version: 7,
      },
      {
        id: "package",
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            "@morph/storefront-runtime": "1.0.0",
          },
        }),
        version: 5,
      },
    ]);

    expect(upgrades).toContainEqual(
      expect.objectContaining({
        path: "src/routes/index.tsx",
        content: STARTER_THEME_HOME_ROUTE_SOURCE,
        expectedFileId: "route",
        expectedVersion: 4,
      }),
    );
    const packageUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "package.json",
    );
    expect(packageUpgrade?.content).not.toContain(
      "@morph/storefront-runtime",
    );

    const emptyRouteUpgrade = createStarterThemeWorkspaceUpgrade([
      {
        id: "empty-route",
        path: "src/routes/index.tsx",
        content: LEGACY_STARTER_THEME_HOME_ROUTE_SOURCE,
        version: 2,
      },
      {
        id: "empty-route-manifest",
        path: "morph.theme.json",
        content: STARTER_THEME_FILES.find(
          (file) => file.path === "morph.theme.json",
        )!.content,
        version: 3,
      },
    ]);
    expect(emptyRouteUpgrade).toContainEqual(
      expect.objectContaining({
        path: "src/routes/index.tsx",
        content: STARTER_THEME_HOME_ROUTE_SOURCE,
      }),
    );
  });
});
