import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOOTER_EXPLORE_ITEM_IDS,
  DEFAULT_FOOTER_HELP_ITEM_IDS,
  DEFAULT_HEADER_NAV_ITEM_IDS,
} from "./default-row-ids";
import { parseComponentSource } from "./ast/theme-ast-transformer";
import { validateThemeStartPackageContract } from "./compiler/theme-start-toolchain";
import {
  createStarterThemeWorkspaceUpgrade,
  createStarterThemeWorkspaceUpgradePlan,
  createStarterThemeWorkspaceBootstrapPlan,
  STARTER_THEME_FILES,
  STARTER_THEME_FILES_WITH_LEGACY_MANIFEST,
  starterThemeWorkspaceFiles,
} from "./starter-theme-files";
import {
  LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_SOURCE,
  LEGACY_STARTER_THEME_FOOTER_SOURCE,
  LEGACY_STARTER_THEME_HEADER_SOURCE,
  LEGACY_STARTER_THEME_HEADER_INDEXED_SPAN_SOURCE,
  LEGACY_STARTER_THEME_HEADER_ID_FALLBACK_SOURCE,
  LEGACY_STARTER_THEME_HEADER_INDEX_KEYED_SOURCE,
  STARTER_THEME_FOOTER_LEGACY_ANCHORS,
  STARTER_THEME_LEGACY_ANCHORS,
  LEGACY_STARTER_THEME_HEADER_UNINDEXED_SOURCE,
  LEGACY_STARTER_THEME_HERO_SOURCE,
  LEGACY_STARTER_THEME_IMAGE_WITH_TEXT_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V12_SOURCE,
  LEGACY_STARTER_THEME_HOME_ROUTE_ALWAYS_VISIBLE_SOURCE,
  LEGACY_STARTER_THEME_INDEX_SOURCE,
  LEGACY_STARTER_THEME_HOME_ROUTE_SOURCE,
  LEGACY_STARTER_THEME_HOME_ROUTE_SLOTLESS_SOURCE,
  LEGACY_STARTER_THEME_ROOT_ROUTE_CONTENTLESS_SOURCE,
  LEGACY_STARTER_THEME_ROOT_ROUTE_SOURCE,
  LEGACY_STARTER_THEME_STOREFRONT_PAGE_ROUTE_SOURCE,
  STARTER_THEME_HEADER_SOURCE,
  STARTER_THEME_HOME_ROUTE_SOURCE,
  STARTER_THEME_V3_NEW_FILES,
} from "./starter-theme-v3-files";

describe("starter Principles theme source", () => {
  it("upgrades both untouched v12 content bindings and visibility source, preserving authored files", () => {
    const existing = STARTER_THEME_FILES_WITH_LEGACY_MANIFEST.map((file, index) => ({
      ...file,
      id: String(index),
      version: 1,
      content:
        file.path === "src/routes/index.tsx"
          ? LEGACY_STARTER_THEME_HOME_ROUTE_ALWAYS_VISIBLE_SOURCE
          : file.path === "src/morph/content.ts"
            ? LEGACY_STARTER_THEME_CONTENT_MODULE_V12_SOURCE
            : file.content,
    }));
    const upgrades = createStarterThemeWorkspaceUpgrade(existing);
    expect(
      upgrades.find((file) => file.path === "src/routes/index.tsx")?.content,
    ).toBe(STARTER_THEME_HOME_ROUTE_SOURCE);
    expect(
      upgrades.find((file) => file.path === "src/morph/content.ts")?.content,
    ).toContain("isSectionHidden");
    const edited = existing.map((file) =>
      file.path === "src/routes/index.tsx"
        ? { ...file, content: file.content + "\n// authored" }
        : file,
    );
    expect(
      createStarterThemeWorkspaceUpgrade(edited).some(
        (file) => file.path === "src/routes/index.tsx",
      ),
    ).toBe(false);
  });
  it("creates the complete template as an additive plan for an empty workspace", () => {
    const plan = createStarterThemeWorkspaceBootstrapPlan([]);

    expect(plan.deletions).toEqual([]);
    // What a new workspace starts with: the Starter, home sections on copies.
    expect(plan.files).toHaveLength(starterThemeWorkspaceFiles().length);
    expect(STARTER_THEME_FILES.some((file) => file.path === "morph.theme.json")).toBe(
      false,
    );
    expect(
      STARTER_THEME_FILES_WITH_LEGACY_MANIFEST.some(
        (file) => file.path === "morph.theme.json",
      ),
    ).toBe(true);
    expect(plan.files.every((file) => file.expectMissing)).toBe(true);
    expect(plan.files.map((file) => file.path).sort()).toEqual(
      starterThemeWorkspaceFiles().map((file) => file.path).sort(),
    );
    expect(
      plan.files.find((file) => file.path === "src/routes/index.tsx")?.content,
    ).toBe(
      starterThemeWorkspaceFiles().find(
        (file) => file.path === "src/routes/index.tsx",
      )?.content,
    );
  });

  it("fills a partial workspace without replacing authored files", () => {
    const authored = {
      id: "custom-hero",
      path: "src/components/Hero.tsx",
      content: "export default function Hero() { return null; }\n",
      version: 4,
    };
    const packageFile = {
      id: "package",
      path: "package.json",
      content: JSON.stringify({
        name: "customer-theme",
        dependencies: { "customer-package": "^1.0.0" },
        scripts: { lint: "eslint ." },
      }),
      version: 2,
    };

    const plan = createStarterThemeWorkspaceBootstrapPlan([
      authored,
      packageFile,
    ]);
    const heroPlan = plan.files.find((file) => file.path === authored.path);
    const packagePlan = plan.files.find((file) => file.path === "package.json");

    expect(heroPlan).toBeUndefined();
    expect(packagePlan).toMatchObject({
      expectedFileId: packageFile.id,
      expectedVersion: packageFile.version,
    });
    const mergedPackage = JSON.parse(packagePlan!.content) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(mergedPackage.dependencies["customer-package"]).toBe("^1.0.0");
    expect(mergedPackage.dependencies["@tanstack/react-start"]).toBe(
      "1.168.32",
    );
    expect(mergedPackage.scripts.lint).toBe("eslint .");
    expect(mergedPackage.scripts.build).toBe("vite build");
    expect(
      plan.files.some(
        (file) => file.path === "src/routes/__root.tsx" && file.expectMissing,
      ),
    ).toBe(true);
  });

  it("registers the principles component and exposes editable source locations", () => {
    const manifest = JSON.parse(
      STARTER_THEME_FILES_WITH_LEGACY_MANIFEST.find((file) => file.path === "morph.theme.json")!
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
    const located = Object.values(parsed.locationMap);
    expect(
      located.some((element) => element.className.includes("bg-stone-50")),
    ).toBe(true);
    expect(
      located.some((element) => element.className.includes("border-b")),
    ).toBe(true);
    expect(
      located.some((element) => element.className.includes("font-serif")),
    ).toBe(true);
    expect(
      located.some((element) => element.className.includes("leading-6")),
    ).toBe(true);
  });

  it("keeps the current starter source free of hand-written identity markers", () => {
    for (const file of STARTER_THEME_FILES) {
      expect(file.content).not.toMatch(/data-morph-(section|node|element)/);
    }
  });

  it("stores the complete preview shell and every starter section in the workspace", () => {
    const manifest = JSON.parse(
      STARTER_THEME_FILES_WITH_LEGACY_MANIFEST.find((file) => file.path === "morph.theme.json")!
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
      // The shell's two sections come first: they wrap every page.
      "header",
      "footer",
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
    // Each section is rendered through its content slot, which is what lets
    // authored values in the Page Document reach the component at all.
    for (const [component, slot] of [
      ["Hero", "starter-hero"],
      ["EditorialIntro", "starter-introduction"],
      ["CategoryShowcase", "starter-categories"],
      ["ImageWithText", "starter-story"],
      ["Principles", "starter-principles"],
      ["Newsletter", "starter-newsletter"],
    ]) {
      expect(homeRoute).toContain(`import ${component} from`);
      expect(homeRoute).toContain(`<${component} {...content("${slot}")} />`);
    }
    // The route also asks whether a section is hidden: spreading props cannot
    // cancel a render, so hiding has to be a question the route asks.
    expect(homeRoute).toContain(
      'import { content, isSectionHidden } from "../morph/content"',
    );
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
      vite: "7.3.5",
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

  it("groups image source and alt props when upgrading untouched starter components", () => {
    const currentByPath = new Map(
      STARTER_THEME_FILES.map((file) => [file.path, file.content]),
    );
    for (const file of STARTER_THEME_V3_NEW_FILES) {
      currentByPath.set(file.path, file.content);
    }
    const existing = [
      {
        id: "hero",
        path: "src/components/Hero.tsx",
        content: LEGACY_STARTER_THEME_HERO_SOURCE,
        version: 4,
      },
      {
        id: "categories",
        path: "src/components/CategoryShowcase.tsx",
        content: LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_SOURCE,
        version: 3,
      },
      {
        id: "story",
        path: "src/components/ImageWithText.tsx",
        content: LEGACY_STARTER_THEME_IMAGE_WITH_TEXT_SOURCE,
        version: 2,
      },
    ];

    const upgrades = createStarterThemeWorkspaceUpgrade(existing);

    expect(
      upgrades.find((file) => file.path === "src/components/Hero.tsx"),
    ).toMatchObject({
      content: currentByPath.get("src/components/Hero.tsx"),
      expectedFileId: "hero",
      expectedVersion: 4,
    });
    expect(
      upgrades.find(
        (file) => file.path === "src/components/CategoryShowcase.tsx",
      ),
    ).toMatchObject({
      content: currentByPath.get("src/components/CategoryShowcase.tsx"),
      expectedFileId: "categories",
      expectedVersion: 3,
    });
    expect(
      upgrades.find((file) => file.path === "src/components/ImageWithText.tsx"),
    ).toMatchObject({
      content: currentByPath.get("src/components/ImageWithText.tsx"),
      expectedFileId: "story",
      expectedVersion: 2,
    });

    expect(
      createStarterThemeWorkspaceUpgrade(
        existing.map((file) => ({
          ...file,
          content: `${file.content}\n// authored`,
        })),
      ).some((file) =>
        [
          "src/components/Hero.tsx",
          "src/components/CategoryShowcase.tsx",
          "src/components/ImageWithText.tsx",
        ].includes(file.path),
      ),
    ).toBe(false);
  });

  it("removes hand-written field markers from untouched v20 component sources", () => {
    const currentByPath = new Map(
      STARTER_THEME_FILES.map((file) => [file.path, file.content]),
    );
    const v20 = (path: string) => {
      const source = currentByPath.get(path);
      if (!source) throw new Error(`missing starter source: ${path}`);
      return source;
    };
    const markerized = [
      {
        path: "src/components/Hero.tsx",
        content: v20("src/components/Hero.tsx")
          .replace(
            `}: HeroProps) {\n  return (`,
            `}: HeroProps) {\n  const displayImage = image ?? {\n    src: imageSrc ?? "/static/storefront/theme-preview-default.png",\n    alt: imageAlt ?? "A neutral collection of ceramic objects",\n  };\n  return (`,
          )
          .replace(
            `        <img\n          src={image?.src ?? imageSrc ?? "/static/storefront/theme-preview-default.png"}\n          alt={image?.alt ?? imageAlt ?? "A neutral collection of ceramic objects"}`,
            `        <img\n          data-storefront-field="image"\n          src={displayImage.src}\n          alt={displayImage.alt}`,
          ),
      },
      {
        path: "src/components/Principles.tsx",
        content: v20("src/components/Principles.tsx")
          .replace(
            `import type { ThemeContentFields } from "../morph/content-fields";\n`,
            "",
          )
          .replace(
            `export const contentFields = {\n  items: {\n    type: "array",\n    label: "Principles",\n    fields: {\n      number: { type: "text", label: "Number", maxLength: 20 },\n      title: { type: "text", label: "Title", maxLength: 150 },\n      body: { type: "textarea", label: "Body", maxLength: 300 },\n    },\n  },\n  label: { type: "text", label: "Label", maxLength: 100 },\n} as const satisfies ThemeContentFields;\n\n`,
            "",
          )
          .replace(
            `      <p\n        className="mb-14`,
            `      <p\n        data-storefront-field="label"\n        className="mb-14`,
          ),
      },
      {
        path: "src/components/EditorialIntro.tsx",
        content: v20("src/components/EditorialIntro.tsx")
          .replace(
            `import type { ThemeContentFields } from "../morph/content-fields";\n\n`,
            "",
          )
          .replace(
            `export const contentFields = {\n  label: { type: "text", label: "Label", maxLength: 100 },\n  heading: { type: "text", label: "Heading", maxLength: 200 },\n  body: { type: "textarea", label: "Body", maxLength: 500 },\n} as const satisfies ThemeContentFields;\n\n`,
            "",
          )
          .replace(
            `        <p\n          className="text-xs`,
            `        <p\n          data-storefront-field="label"\n          className="text-xs`,
          )
          .replace(
            `          <h2\n            className="max-w-4xl`,
            `          <h2\n            data-storefront-field="heading"\n            className="max-w-4xl`,
          )
          .replace(
            `          <p\n            className="ml-auto`,
            `          <p\n            data-storefront-field="body"\n            className="ml-auto`,
          ),
      },
      {
        path: "src/components/CategoryShowcase.tsx",
        content: v20("src/components/CategoryShowcase.tsx").replace(
          `        <h2\n          className="font-serif`,
          `        <h2\n          data-storefront-field="heading"\n          className="font-serif`,
        ),
      },
      {
        path: "src/components/ImageWithText.tsx",
        content: v20("src/components/ImageWithText.tsx")
          .replace(
            `}: ImageWithTextProps) {\n  return (`,
            `}: ImageWithTextProps) {\n  const displayImage = image ?? {\n    src: imageSrc ?? "/static/storefront/theme-preview-default.png",\n    alt: imageAlt ?? "Image with text",\n  };\n  return (`,
          )
          .replace(
            `        <img\n          src={image?.src ?? imageSrc ?? "/static/storefront/theme-preview-default.png"}\n          alt={image?.alt ?? imageAlt ?? "Image with text"}`,
            `        <img\n          data-storefront-field="image"\n          src={displayImage.src}\n          alt={displayImage.alt}`,
          )
          .replace(
            `          <p\n            className="text-xs`,
            `          <p\n            data-storefront-field="eyebrow"\n            className="text-xs`,
          )
          .replace(
            `          <h2\n            className="mt-5`,
            `          <h2\n            data-storefront-field="heading"\n            className="mt-5`,
          )
          .replace(
            `          <p\n            className="mt-7`,
            `          <p\n            data-storefront-field="body"\n            className="mt-7`,
          )
          .replace(
            `          <ThemeLink\n            link={action}\n            className=`,
            `          <ThemeLink\n            link={action}\n            data-storefront-field="actionLabel"\n            className=`,
          ),
      },
      {
        path: "src/components/Newsletter.tsx",
        content: v20("src/components/Newsletter.tsx")
          .replace(
            `import type { ThemeContentFields } from "../morph/content-fields";\n\n`,
            "",
          )
          .replace(
            `export const contentFields = {\n  eyebrow: { type: "text", label: "Eyebrow", maxLength: 100 },\n  heading: { type: "text", label: "Heading", maxLength: 200 },\n  body: { type: "textarea", label: "Body", maxLength: 700 },\n  placeholder: { type: "text", label: "Placeholder", maxLength: 100 },\n  actionLabel: { type: "text", label: "Action label", maxLength: 100 },\n} as const satisfies ThemeContentFields;\n\n`,
            "",
          )
          .replace(
            `        <p\n          className="text-xs`,
            `        <p\n          data-storefront-field="eyebrow"\n          className="text-xs`,
          )
          .replace(
            `        <h2\n          className="mt-6`,
            `        <h2\n          data-storefront-field="heading"\n          className="mt-6`,
          )
          .replace(
            `        <p\n          className="mx-auto mt-6`,
            `        <p\n          data-storefront-field="body"\n          className="mx-auto mt-6`,
          )
          .replace(
            `          <span className="flex-1 text-sm text-stone-700">`,
            `          <span data-storefront-field="placeholder" className="flex-1 text-sm text-stone-700">`,
          )
          .replace(
            `          <span className="text-sm font-medium text-stone-950">`,
            `          <span data-storefront-field="actionLabel" className="text-sm font-medium text-stone-950">`,
          ),
      },
    ];
    const existing = markerized.map((file, index) => ({
      ...file,
      id: String(index),
      version: 20,
    }));
    const upgrades = createStarterThemeWorkspaceUpgrade(existing);
    for (const file of markerized) {
      expect(
        upgrades.find((upgrade) => upgrade.path === file.path),
        file.path,
      ).toMatchObject({
        content: currentByPath.get(file.path),
      });
      expect(
        upgrades.find((upgrade) => upgrade.path === file.path)?.content,
      ).not.toMatch(/data-storefront-field(?:-path)?\s*=/);
    }

    const authored = existing.map((file) =>
      file.path === "src/components/Hero.tsx"
        ? { ...file, content: `${file.content}\n// authored` }
        : file,
    );
    expect(
      createStarterThemeWorkspaceUpgrade(authored).some(
        (upgrade) => upgrade.path === "src/components/Hero.tsx",
      ),
    ).toBe(false);
  });

  /**
   * The case the byte-exact replacements cannot reach: an author edited the
   * file, so its bytes match no generation Morph knows, and the marker they
   * were told they would never have to write is still sitting in it.
   */
  it("clears a derivable marker from a component the author has edited", () => {
    const authored = `import type { ThemeContentFields } from "../morph/content-fields";

export type PrinciplesProps = { label?: string };

export const contentFields = {
  label: { type: "text", label: "Label", maxLength: 8 },
} as const satisfies ThemeContentFields;

export default function Principles({ label = "Why we choose differently" }: PrinciplesProps) {
  return (
    <section className="bg-stone-50">
      <p
        data-storefront-field="label"
        className="mb-14 text-xs"
      >
        {label}
      </p>
    </section>
  );
}
`;
    const upgrades = createStarterThemeWorkspaceUpgrade([
      {
        id: "authored",
        path: "src/components/Principles.tsx",
        content: authored,
        version: 7,
      },
    ]);
    const upgrade = upgrades.find(
      (file) => file.path === "src/components/Principles.tsx",
    );
    expect(upgrade?.content).not.toContain("data-storefront-field");
    // Their edit survives: only the attribute is removed.
    expect(upgrade?.content).toContain("maxLength: 8");
    expect(upgrade?.content).toContain('label = "Why we choose differently"');
    // The write must lose to a concurrent edit rather than overwrite it.
    expect(upgrade?.expectedFileId).toBe("authored");
    expect(upgrade?.expectedVersion).toBe(7);
  });

  it("leaves an authored marker the compiler cannot reproduce", () => {
    // `title` is declared nowhere, so removing the marker would take the only
    // thing making this element editable with it.
    const authored = `export default function Card({ heading }) {
  return <h2 data-storefront-field="title">{heading}</h2>;
}
`;
    expect(
      createStarterThemeWorkspaceUpgrade([
        {
          id: "card",
          path: "src/components/Card.tsx",
          content: authored,
          version: 1,
        },
      ]).some((file) => file.path === "src/components/Card.tsx"),
    ).toBe(false);
  });

  /**
   * The Footer's shape, now the Header's too: the row is the link. The span
   * that used to wrap each one was standing in for a wrapper the compiler
   * decides — an attribute on a component is only a prop it may never pass on,
   * so the compiler hands markers to a `morph/link` anchor directly and wraps
   * anything it cannot vouch for.
   */
  it("makes a repeated link the row itself, in the Header as in the Footer", () => {
    const header = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Header.tsx",
    )!.content;

    expect(header).toContain("{navItems.map((item) => (");
    expect(header).not.toContain("<span key={item.label}>");
  });

  /**
   * Every Header generation must be recognised, and no two may be the same.
   *
   * The snapshots used to reverse one edit off the current source, so the next
   * edit to that source skipped a generation without a word: the Header with an
   * index but still wrapped in a span matched nothing and could never be
   * upgraded again. This fails the moment a generation is orphaned that way.
   */
  it("recognises every Header it has shipped, and tells them apart", () => {
    const generations = {
      "no index, span": LEGACY_STARTER_THEME_HEADER_UNINDEXED_SOURCE,
      "index, span": LEGACY_STARTER_THEME_HEADER_INDEXED_SPAN_SOURCE,
      "link row, keyed by position":
        LEGACY_STARTER_THEME_HEADER_INDEX_KEYED_SOURCE,
      "id with position fallback":
        LEGACY_STARTER_THEME_HEADER_ID_FALLBACK_SOURCE,
    };
    const seen = new Set<string>();
    for (const [name, content] of Object.entries(generations)) {
      expect(content, name).not.toBe(STARTER_THEME_HEADER_SOURCE);
      expect(seen.has(content), `${name} duplicates another generation`).toBe(
        false,
      );
      seen.add(content);
      const upgrades = createStarterThemeWorkspaceUpgrade([
        {
          id: "header",
          path: "src/components/Header.tsx",
          content,
          version: 4,
        },
      ]);
      expect(
        upgrades.find((file) => file.path === "src/components/Header.tsx")
          ?.content,
        name,
      ).toBe(STARTER_THEME_HEADER_SOURCE);
    }
  });

  // A workspace still on the previous shape has to be recognised, or it keeps
  // a navigation whose rows the editor cannot tell apart.
  it("still recognises the Header it replaced", () => {
    expect(LEGACY_STARTER_THEME_HEADER_UNINDEXED_SOURCE).not.toBe(
      STARTER_THEME_HEADER_SOURCE,
    );
    expect(LEGACY_STARTER_THEME_HEADER_UNINDEXED_SOURCE).toContain(
      "{navItems.map((item) => (",
    );
    expect(LEGACY_STARTER_THEME_HEADER_UNINDEXED_SOURCE).toContain(
      "<span key={item.label}>",
    );
    const upgrades = createStarterThemeWorkspaceUpgrade([
      {
        id: "header",
        path: "src/components/Header.tsx",
        content: LEGACY_STARTER_THEME_HEADER_UNINDEXED_SOURCE,
        version: 4,
      },
    ]);
    expect(
      upgrades.find((file) => file.path === "src/components/Header.tsx")
        ?.content,
    ).toBe(STARTER_THEME_HEADER_SOURCE);
  });

  /**
   * Keying a repeated row by its array index matches rows by position, so
   * reordering carries one row's DOM node — its caret, its scroll position,
   * any state in that subtree — into another. Morph stores an identity for a
   * row once it has given it one; the index remains the fallback for rows it
   * has not.
   */
  /**
   * The fallback is gone. It existed while documents holding rows without ids
   * were still out there, and one list keyed both ways is what carried a row's
   * DOM state into its neighbour on a reorder. It could only go once a row was
   * guaranteed to arrive with an id from every direction: the editor normalizes
   * what it reads, every draft write saves that repair with the author's edit,
   * publishing seals it into the release, and new rows are born with one.
   */
  it("keys a repeated row by its identity alone", () => {
    for (const path of [
      "src/components/Header.tsx",
      "src/components/Footer.tsx",
    ]) {
      const source = STARTER_THEME_FILES.find(
        (file) => file.path === path,
      )!.content;
      expect(source, path).toContain("key={item.id}");
      expect(source, path).not.toContain("?? index");
      expect(source, path).not.toContain("key={index}");
      // Declared, or a Theme in Code mode reads an error on its own row type.
      expect(source, path).toMatch(/id\?: string;/);
    }
  });

  /**
   * Every row the shell ships with is born identified, and the layout document
   * seeded beside it quotes the same ids — the document adopts the rows the
   * component would otherwise have defaulted to, so the two must agree or a
   * Store's rows are silently re-identified the first time it is saved.
   */
  it("gives the shell's own default rows the ids the document seeds", () => {
    const header = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Header.tsx",
    )!.content;
    const footer = STARTER_THEME_FILES.find(
      (file) => file.path === "src/components/Footer.tsx",
    )!.content;

    for (const id of DEFAULT_HEADER_NAV_ITEM_IDS) {
      expect(header, id).toContain(`id: "${id}"`);
    }
    for (const id of [
      ...DEFAULT_FOOTER_EXPLORE_ITEM_IDS,
      ...DEFAULT_FOOTER_HELP_ITEM_IDS,
    ]) {
      expect(footer, id).toContain(`id: "${id}"`);
    }
  });

  /**
   * A snapshot substitutes text into the current source, and `String.replace`
   * returns the original when it cannot find what it was given. So an anchor
   * that drifts does not fail — every generation derived through it collapses
   * into one string, which reads as "nothing to upgrade" for the workspaces
   * that most need upgrading. Changing the Header's key without updating its
   * anchor did exactly that, and only the distinctness check below caught it.
   */
  it("can still find every anchor its legacy snapshots substitute", () => {
    for (const { name, anchor, source } of [
      ...STARTER_THEME_LEGACY_ANCHORS,
      ...STARTER_THEME_FOOTER_LEGACY_ANCHORS,
    ]) {
      expect(source.includes(anchor), name).toBe(true);
    }
  });

  it("does not declare a document layout over an authored entry file", () => {
    const targetManifest = STARTER_THEME_FILES_WITH_LEGACY_MANIFEST.find(
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
        content: STARTER_THEME_FILES_WITH_LEGACY_MANIFEST.find(
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
    expect(packageUpgrade?.content).not.toContain("@morph/storefront-runtime");

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
        content: STARTER_THEME_FILES_WITH_LEGACY_MANIFEST.find(
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

describe("platform toolchain version correction", () => {
  it("corrects a platform dependency that exists with an unsupported version", () => {
    // A theme created by an older starter carries `^19.0.0`, which the Start
    // package contract rejects by exact equality. Leaving it in place would
    // make the workspace permanently unbuildable.
    const upgrades = createStarterThemeWorkspaceUpgrade([
      {
        id: "manifest",
        path: "morph.theme.json",
        content: JSON.stringify({
          name: "Dawn Starter",
          entry: "src/routes/index.tsx",
          router: { framework: "tanstack-start" },
          components: {},
        }),
        version: 1,
      },
      {
        id: "package",
        path: "package.json",
        content: JSON.stringify({
          name: "morph-storefront-theme",
          dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
            clsx: "customer-version",
            "@tanstack/react-router": "1.170.18",
            "@tanstack/react-start": "1.168.32",
          },
          devDependencies: {
            vite: "7.0.0",
            tailwindcss: "4.1.17",
          },
        }),
        version: 1,
      },
    ] as never);

    const packageUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "package.json",
    );
    expect(packageUpgrade).toBeDefined();

    const upgraded = JSON.parse(packageUpgrade!.content) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(upgraded.dependencies.react).toBe("19.2.1");
    expect(upgraded.dependencies["react-dom"]).toBe("19.2.1");
    expect(upgraded.devDependencies.vite).toBe("7.3.5");
    // Dependencies the platform does not own keep the customer's choice.
    expect(upgraded.dependencies.clsx).toBe("customer-version");
  });

  it("produces a package.json that satisfies the Start package contract", () => {
    const upgrades = createStarterThemeWorkspaceUpgrade([
      {
        id: "manifest",
        path: "morph.theme.json",
        content: JSON.stringify({
          name: "Dawn Starter",
          entry: "src/routes/index.tsx",
          router: { framework: "tanstack-start" },
          components: {},
        }),
        version: 1,
      },
      {
        id: "package",
        path: "package.json",
        content: JSON.stringify({
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
          devDependencies: {},
        }),
        version: 1,
      },
    ] as never);

    const packageUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "package.json",
    )!;
    expect(
      validateThemeStartPackageContract([
        { path: "package.json", content: packageUpgrade.content },
      ]),
    ).toEqual([]);
  });
});

describe("root document shell upgrade", () => {
  const withRoot = (rootContent: string) => [
    {
      id: "manifest",
      path: "morph.theme.json",
      content: JSON.stringify({
        name: "Dawn Starter",
        entry: "src/routes/index.tsx",
        router: { framework: "tanstack-start" },
        components: {},
      }),
      version: 1,
    },
    {
      id: "root",
      path: "src/routes/__root.tsx",
      content: rootContent,
      version: 2,
    },
  ];

  it("replaces an untouched legacy root route that renders no document shell", () => {
    const upgrades = createStarterThemeWorkspaceUpgrade(
      withRoot(LEGACY_STARTER_THEME_ROOT_ROUTE_SOURCE) as never,
    );
    const rootUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "src/routes/__root.tsx",
    );

    expect(rootUpgrade).toBeDefined();
    // Without these the Theme's production SSR output has no document shell and
    // no stylesheet, while the editor preview still looks correct.
    expect(rootUpgrade!.content).toContain("shellComponent");
    expect(rootUpgrade!.content).toContain("<html");
    expect(rootUpgrade!.content).toContain("Scripts");
    expect(rootUpgrade!.content).toContain("../styles/global.css");
    expect(rootUpgrade).toMatchObject({
      expectedFileId: "root",
      expectedVersion: 2,
    });
  });

  it("replaces a root route that renders the shell but loads no content", () => {
    const upgrades = createStarterThemeWorkspaceUpgrade(
      withRoot(LEGACY_STARTER_THEME_ROOT_ROUTE_CONTENTLESS_SOURCE) as never,
    );
    const rootUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "src/routes/__root.tsx",
    );

    expect(rootUpgrade).toBeDefined();
    // Without these an edited heading stays in the Document and the deployed
    // site keeps rendering the component's own defaults.
    expect(rootUpgrade!.content).toContain("beforeLoad");
    expect(rootUpgrade!.content).toContain("loadContentSlots");
    expect(rootUpgrade!.content).toContain("MorphContentProvider");
    // The shell must survive the upgrade, not be traded for content.
    expect(rootUpgrade!.content).toContain("shellComponent");
    expect(rootUpgrade!.content).toContain("../styles/global.css");
  });

  it("never overwrites an authored root route", () => {
    const authored = LEGACY_STARTER_THEME_ROOT_ROUTE_SOURCE.replace(
      "StorefrontLayout",
      "MyCustomLayout",
    );
    const upgrades = createStarterThemeWorkspaceUpgrade(
      withRoot(authored) as never,
    );
    expect(
      upgrades.some((upgrade) => upgrade.path === "src/routes/__root.tsx"),
    ).toBe(false);
  });
});

describe("content slot upgrade", () => {
  const withHomeRoute = (routeContent: string) => [
    {
      id: "manifest",
      path: "morph.theme.json",
      content: JSON.stringify({
        name: "Dawn Starter",
        entry: "src/routes/index.tsx",
        router: { framework: "tanstack-start" },
        components: {},
      }),
      version: 1,
    },
    {
      id: "home",
      path: "src/routes/index.tsx",
      content: routeContent,
      version: 4,
    },
  ];

  it("seeds the platform content module for themes that lack it", () => {
    const upgrades = createStarterThemeWorkspaceUpgrade(
      withHomeRoute(LEGACY_STARTER_THEME_HOME_ROUTE_SLOTLESS_SOURCE) as never,
    );
    const contentModule = upgrades.find(
      (upgrade) => upgrade.path === "src/morph/content.ts",
    );

    expect(contentModule).toBeDefined();
    expect(contentModule!.content).toContain("export function content(");
    // Added only when absent, never overwriting an existing file.
    expect(contentModule).toMatchObject({ expectMissing: true });
  });

  it("upgrades an untouched slotless home route to read its slots", () => {
    // Without this the route renders every section with no props, so authored
    // content stays in the Document and never reaches the component.
    const upgrades = createStarterThemeWorkspaceUpgrade(
      withHomeRoute(LEGACY_STARTER_THEME_HOME_ROUTE_SLOTLESS_SOURCE) as never,
    );
    const routeUpgrade = upgrades.find(
      (upgrade) => upgrade.path === "src/routes/index.tsx",
    );

    expect(routeUpgrade).toBeDefined();
    expect(routeUpgrade!.content).toContain(
      '<Hero {...content("starter-hero")} />',
    );
    expect(routeUpgrade).toMatchObject({
      expectedFileId: "home",
      expectedVersion: 4,
    });
  });

  it("never rewrites a home route the customer edited", () => {
    const authored = LEGACY_STARTER_THEME_HOME_ROUTE_SLOTLESS_SOURCE.replace(
      "<Newsletter />",
      "<Newsletter />\n      <MyPromo />",
    );
    const upgrades = createStarterThemeWorkspaceUpgrade(
      withHomeRoute(authored) as never,
    );

    expect(
      upgrades.some((upgrade) => upgrade.path === "src/routes/index.tsx"),
    ).toBe(false);
  });
});

describe("content module upgrade", () => {
  const withContentModule = (moduleContent: string) => [
    {
      id: "manifest",
      path: "morph.theme.json",
      content: JSON.stringify({
        name: "Dawn Starter",
        entry: "src/routes/index.tsx",
        router: { framework: "tanstack-start" },
        components: {},
      }),
      version: 1,
    },
    {
      id: "content",
      path: "src/morph/content.ts",
      content: moduleContent,
      version: 3,
    },
  ];

  it("replaces an untouched module that cannot load published content", () => {
    const upgrades = createStarterThemeWorkspaceUpgrade(
      withContentModule(LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE) as never,
    );
    const upgrade = upgrades.find(
      (candidate) => candidate.path === "src/morph/content.ts",
    );

    expect(upgrade).toBeDefined();
    expect(upgrade!.content).toContain("loadContentSlots");
    expect(upgrade!.content).toContain("x-morph-content-origin");
    expect(upgrade).toMatchObject({
      expectedFileId: "content",
      expectedVersion: 3,
    });
  });

  it("never overwrites an authored content module", () => {
    const authored = LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE.replace(
      "MorphContentContext",
      "MyContentContext",
    );
    const upgrades = createStarterThemeWorkspaceUpgrade(
      withContentModule(authored) as never,
    );

    expect(
      upgrades.some((candidate) => candidate.path === "src/morph/content.ts"),
    ).toBe(false);
  });
});
