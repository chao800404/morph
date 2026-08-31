import {
  LEGACY_STARTER_THEME_FOOTER_SOURCE,
  LEGACY_STARTER_THEME_HEADER_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE,
  LEGACY_STARTER_THEME_INDEX_SOURCE,
  LEGACY_STARTER_THEME_HOME_ROUTE_SOURCE,
  LEGACY_STARTER_THEME_HOME_ROUTE_SLOTLESS_SOURCE,
  LEGACY_STARTER_THEME_ROOT_ROUTE_CONTENTLESS_SOURCE,
  LEGACY_STARTER_THEME_ROOT_ROUTE_SOURCE,
  LEGACY_STARTER_THEME_STOREFRONT_PAGE_ROUTE_SOURCE,
  STARTER_THEME_FOOTER_SOURCE,
  STARTER_THEME_V4_NEW_FILES,
  STARTER_THEME_HEADER_SOURCE,
  STARTER_THEME_INDEX_SOURCE,
  STARTER_THEME_HOME_ROUTE_SOURCE,
  STARTER_THEME_V3_NEW_FILES,
} from "./starter-theme-v3-files";
import {
  THEME_START_BUILD_DEPENDENCIES,
  THEME_START_RUNTIME_DEPENDENCIES,
} from "./compiler/theme-start-toolchain";

export const STARTER_THEME_FILES: Array<{
  path: string;
  content: string;
  mimeType: string;
  isEntry?: boolean;
}> = [
  {
    path: "package.json",
    mimeType: "application/json",
    content: JSON.stringify(
      {
        name: "morph-storefront-theme",
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: {
          dev: "vite dev",
          build: "vite build",
        },
        dependencies: {
          ...THEME_START_RUNTIME_DEPENDENCIES,
          "lucide-react": "^0.475.0",
          clsx: "^2.1.1",
          "tailwind-merge": "^3.0.1",
        },
        devDependencies: THEME_START_BUILD_DEPENDENCIES,
      },
      null,
      2,
    ),
  },
  {
    path: "src/styles/global.css",
    mimeType: "text/css",
    content: `@import "tailwindcss";

:root {
  --color-brand-primary: #1c1917;
  --color-brand-accent: #78716c;
  --font-serif: Georgia, Cambria, "Times New Roman", Times, serif;
}

body {
  margin: 0;
  padding: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1c1917;
  background-color: #fafaf9;
}

`,
  },
  {
    path: "src/components/Hero.tsx",
    mimeType: "text/typescript",
    content: `export type HeroProps = {
  eyebrow?: string;
  heading?: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  imageSrc?: string;
  imageAlt?: string;
};

export default function Hero({
  eyebrow = "New collection",
  heading = "Objects for everyday rituals.",
  description = "Quiet essentials, thoughtfully made for the spaces you call home.",
  actionLabel = "Explore the collection",
  actionHref = "/collections/new",
  imageSrc = "/static/storefront/theme-preview-default.png",
  imageAlt = "A neutral collection of ceramic objects",
}: HeroProps) {
  return (
    <section
      className="grid min-h-[42rem] bg-stone-100 lg:min-h-[50rem] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
    >
      <div className="flex items-center px-[clamp(1.75rem,6vw,6rem)] py-20">
        <div className="max-w-xl">
          <p
            className="text-xs font-medium uppercase tracking-[0.24em] text-stone-500"
          >
            {eyebrow}
          </p>
          <h1
            className="mt-6 font-serif text-[clamp(3.25rem,7vw,7rem)] leading-[0.88] tracking-[-0.055em] text-stone-950"
          >
            {heading}
          </h1>
          <p
            className="mt-7 max-w-md text-base leading-7 text-stone-600"
          >
            {description}
          </p>
          <div className="mt-8">
            <a
              href={actionHref}
              className="inline-flex items-center justify-center rounded-md bg-stone-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-800"
            >
              {actionLabel}
            </a>
          </div>
        </div>
      </div>
      <div
        className="min-h-[30rem] overflow-hidden lg:min-h-0"
      >
        <img
          src={imageSrc}
          alt={imageAlt}
          className="size-full object-cover"
        />
      </div>
    </section>
  );
}
`,
  },
  {
    path: "src/components/Header.tsx",
    mimeType: "text/typescript",
    content: STARTER_THEME_HEADER_SOURCE,
  },
  ...STARTER_THEME_V4_NEW_FILES,
  ...STARTER_THEME_V3_NEW_FILES,
  {
    path: "src/components/Principles.tsx",
    mimeType: "text/typescript",
    content: `import { clsx as cn } from "clsx";

export type PrincipleItem = {
  id?: string;
  number?: string;
  title?: string;
  body?: string;
};

export type PrinciplesProps = {
  items?: PrincipleItem[];
  label?: string;
};

const morphInstanceClasses: Record<string, string> = {};

export default function Principles({
  items = [],
  label = "Why we choose differently",
}: PrinciplesProps) {
  return (
    <section
      className="bg-stone-50 px-[clamp(1.75rem,6vw,6rem)] py-[clamp(6rem,10vw,9rem)]"
    >
      <p
        data-storefront-field="label"
        className="mb-14 text-xs font-medium uppercase tracking-[0.22em] text-stone-500"
      >
        {label}
      </p>
      <div
        className="grid border-t border-stone-300 lg:grid-cols-3"
      >
        {items.map((item, idx) => (
          <article
            key={item.id ?? item.number ?? idx}
            className={cn(
              "border-b border-stone-300 py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0",
              morphInstanceClasses[\`\${item.id}:principle-card\`],
            )}
          >
            <span
              className="text-xs text-stone-400"
            >
              {item.number ?? ("0" + (idx + 1))}
            </span>
            <h3
              className={cn(
                "mt-12 font-serif text-3xl tracking-tight text-stone-950",
                morphInstanceClasses[\`\${item.id}:principle-title\`],
              )}
            >
              {item.title ?? ""}
            </h3>
            <p
              className={cn(
                "mt-4 max-w-sm text-sm leading-6 text-stone-600",
                morphInstanceClasses[\`\${item.id}:principle-body\`],
              )}
            >
              {item.body ?? ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
`,
  },
  {
    path: "src/components/Footer.tsx",
    mimeType: "text/typescript",
    content: STARTER_THEME_FOOTER_SOURCE,
  },
  {
    path: "morph.theme.json",
    mimeType: "application/json",
    content: JSON.stringify(
      {
        name: "Dawn Starter",
        version: "1.1.0",
        author: "Morph Studio",
        entry: "src/routes/index.tsx",
        router: {
          framework: "tanstack-start",
          previewAdapter: "tanstack-router-client",
          routesDirectory: "src/routes",
          rootRoute: "src/routes/__root.tsx",
          generatedRouteTree: "src/routeTree.gen.ts",
        },
        documentLayout: {
          source: "src/layouts/StorefrontLayout.tsx",
        },
        components: {
          "hero.default": {
            name: "Hero",
            source: "src/components/Hero.tsx",
            sectionType: "hero",
            contentFields: {
              eyebrow: { type: "text", label: "Eyebrow", maxLength: 100 },
              heading: { type: "text", label: "Heading", maxLength: 200 },
              description: {
                type: "textarea",
                label: "Description",
                maxLength: 500,
              },
              actionLabel: {
                type: "text",
                label: "Action label",
                maxLength: 100,
              },
              actionHref: { type: "url", label: "Action link" },
              imageSrc: { type: "url", label: "Image" },
              imageAlt: {
                type: "text",
                label: "Image description",
                maxLength: 200,
              },
            },
          },
          "editorial-intro.default": {
            name: "Editorial intro",
            source: "src/components/EditorialIntro.tsx",
            sectionType: "editorial-intro",
            contentFields: {
              label: { type: "text", label: "Label", maxLength: 100 },
              heading: { type: "text", label: "Heading", maxLength: 200 },
              body: { type: "textarea", label: "Body", maxLength: 700 },
            },
          },
          "category-showcase.default": {
            name: "Category showcase",
            source: "src/components/CategoryShowcase.tsx",
            sectionType: "category-showcase",
            contentFields: {
              heading: { type: "text", label: "Heading", maxLength: 200 },
            },
          },
          "image-with-text.default": {
            name: "Image with text",
            source: "src/components/ImageWithText.tsx",
            sectionType: "image-with-text",
            contentFields: {
              eyebrow: { type: "text", label: "Eyebrow", maxLength: 100 },
              heading: { type: "text", label: "Heading", maxLength: 200 },
              body: { type: "textarea", label: "Body", maxLength: 700 },
              actionLabel: {
                type: "text",
                label: "Action label",
                maxLength: 100,
              },
              actionHref: { type: "url", label: "Action link" },
              imageSrc: { type: "url", label: "Image" },
              imageAlt: {
                type: "text",
                label: "Image description",
                maxLength: 200,
              },
            },
          },
          "principles.default": {
            name: "Principles",
            source: "src/components/Principles.tsx",
            sectionType: "principles",
            contentFields: {
              label: { type: "text", label: "Label", maxLength: 100 },
            },
          },
          "newsletter.default": {
            name: "Newsletter",
            source: "src/components/Newsletter.tsx",
            sectionType: "newsletter",
            contentFields: {
              eyebrow: { type: "text", label: "Eyebrow", maxLength: 100 },
              heading: { type: "text", label: "Heading", maxLength: 200 },
              body: { type: "textarea", label: "Body", maxLength: 500 },
              placeholder: {
                type: "text",
                label: "Placeholder",
                maxLength: 100,
              },
              actionLabel: {
                type: "text",
                label: "Action label",
                maxLength: 100,
              },
            },
          },
          "layout.header": {
            name: "Header",
            source: "src/components/Header.tsx",
          },
          "layout.footer": {
            name: "Footer",
            source: "src/components/Footer.tsx",
          },
        },
        sections: {
          hero: {
            componentRef: "hero.default",
            source: "src/components/Hero.tsx",
          },
          "editorial-intro": {
            componentRef: "editorial-intro.default",
            source: "src/components/EditorialIntro.tsx",
          },
          "category-showcase": {
            componentRef: "category-showcase.default",
            source: "src/components/CategoryShowcase.tsx",
          },
          "image-with-text": {
            componentRef: "image-with-text.default",
            source: "src/components/ImageWithText.tsx",
          },
          principles: {
            componentRef: "principles.default",
            source: "src/components/Principles.tsx",
          },
          newsletter: {
            componentRef: "newsletter.default",
            source: "src/components/Newsletter.tsx",
          },
        },
      },
      null,
      2,
    ),
  },
];

type ExistingStarterThemeFile = {
  id: string;
  path: string;
  content: string;
  version: number;
};

export type StarterThemeWorkspaceUpgradeFile = {
  path: string;
  content: string;
  mimeType: string;
  expectedFileId?: string;
  expectedVersion?: number;
  expectMissing?: boolean;
};

export type StarterThemeWorkspaceUpgradeDeletion = {
  path: string;
  expectedFileId: string;
  expectedVersion: number;
};

export type StarterThemeWorkspaceUpgradePlan = {
  files: StarterThemeWorkspaceUpgradeFile[];
  deletions: StarterThemeWorkspaceUpgradeDeletion[];
};

/**
 * Builds the one-click bootstrap plan used by Code Mode.
 *
 * An empty workspace receives the complete Starter Theme. A partially
 * populated workspace receives only files that are missing, plus the existing
 * byte-for-byte-safe starter upgrades. Authored files are never replaced by a
 * template copy. This is intentionally a plan (rather than a direct write) so
 * the editor can show the user exactly what will be added before the OCC
 * mutation is applied.
 */
export function createStarterThemeWorkspaceBootstrapPlan(
  existingFiles: ExistingStarterThemeFile[],
): StarterThemeWorkspaceUpgradePlan {
  const existingByPath = new Map(
    existingFiles.map((file) => [file.path, file]),
  );
  const upgradePlan = createStarterThemeWorkspaceUpgradePlan(existingFiles);
  const plannedPaths = new Set(upgradePlan.files.map((file) => file.path));
  const targetByPath = new Map(
    STARTER_THEME_FILES.map((file) => [file.path, file]),
  );

  // `createStarterThemeWorkspaceUpgradePlan` already knows how to migrate
  // legacy Morph starters without touching authored bytes. Keep those changes
  // and add the complete template's missing files around them.
  const files = [...upgradePlan.files];
  for (const target of STARTER_THEME_FILES) {
    if (existingByPath.has(target.path) || plannedPaths.has(target.path)) {
      continue;
    }
    files.push({
      path: target.path,
      content: target.content,
      mimeType: target.mimeType,
      expectMissing: true,
    });
    plannedPaths.add(target.path);
  }

  // A customer may already have a package manifest. Merge the platform's
  // pinned toolchain and Starter dependencies instead of replacing the file.
  // This keeps custom packages/scripts while making the one-click bootstrap
  // buildable by the managed Sandbox toolchain.
  const existingPackage = existingByPath.get("package.json");
  const targetPackage = targetByPath.get("package.json");
  if (existingPackage && targetPackage && !plannedPaths.has("package.json")) {
    try {
      const parsedExisting: unknown = JSON.parse(existingPackage.content);
      const parsedTarget: unknown = JSON.parse(targetPackage.content);
      if (isRecord(parsedExisting) && isRecord(parsedTarget)) {
        const existingDependencies = isRecord(parsedExisting.dependencies)
          ? { ...parsedExisting.dependencies }
          : {};
        const existingDevDependencies = isRecord(
          parsedExisting.devDependencies,
        )
          ? { ...parsedExisting.devDependencies }
          : {};
        const targetDependencies = isRecord(parsedTarget.dependencies)
          ? parsedTarget.dependencies
          : {};
        const targetDevDependencies = isRecord(parsedTarget.devDependencies)
          ? parsedTarget.devDependencies
          : {};
        const nextScripts = {
          ...(isRecord(parsedTarget.scripts) ? parsedTarget.scripts : {}),
          ...(isRecord(parsedExisting.scripts) ? parsedExisting.scripts : {}),
        };
        let packageChanged = false;

        for (const [dependency, version] of Object.entries(
          targetDependencies,
        )) {
          const isPlatformDependency =
            dependency in THEME_START_RUNTIME_DEPENDENCIES;
          const nextVersion = isPlatformDependency
            ? THEME_START_RUNTIME_DEPENDENCIES[
                dependency as keyof typeof THEME_START_RUNTIME_DEPENDENCIES
              ]
            : existingDependencies[dependency] ?? version;
          if (existingDependencies[dependency] === nextVersion) continue;
          existingDependencies[dependency] = nextVersion;
          packageChanged = true;
        }
        for (const [dependency, version] of Object.entries(
          targetDevDependencies,
        )) {
          const isPlatformDependency =
            dependency in THEME_START_BUILD_DEPENDENCIES;
          const nextVersion = isPlatformDependency
            ? THEME_START_BUILD_DEPENDENCIES[
                dependency as keyof typeof THEME_START_BUILD_DEPENDENCIES
              ]
            : existingDevDependencies[dependency] ?? version;
          if (existingDevDependencies[dependency] === nextVersion) continue;
          existingDevDependencies[dependency] = nextVersion;
          packageChanged = true;
        }
        const nextManifest: Record<string, unknown> = {
          ...parsedExisting,
          type: parsedExisting.type ?? parsedTarget.type,
          scripts: nextScripts,
          dependencies: existingDependencies,
          devDependencies: existingDevDependencies,
        };
        if (JSON.stringify(nextManifest) !== JSON.stringify(parsedExisting)) {
          packageChanged = true;
        }
        if (packageChanged) {
          files.push({
            path: existingPackage.path,
            content: `${JSON.stringify(nextManifest, null, 2)}\n`,
            mimeType: "application/json",
            expectedFileId: existingPackage.id,
            expectedVersion: existingPackage.version,
          });
        }
      }
    } catch {
      // Leave malformed authored manifests untouched. The normal build
      // diagnostics remain the source of truth for that error.
    }
  }

  return { files, deletions: upgradePlan.deletions };
}

const V3_COMPONENT_REFS = [
  "editorial-intro.default",
  "category-showcase.default",
  "image-with-text.default",
  "newsletter.default",
] as const;

const V3_SECTION_TYPES = [
  "editorial-intro",
  "category-showcase",
  "image-with-text",
  "newsletter",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Produces an additive, OCC-ready upgrade for an existing v2 starter
 * workspace. Authored files are preserved. Legacy shell components are
 * replaced only when their bytes still exactly match the previous bootstrap,
 * and new route/section files are inserted only when missing.
 */
export function createStarterThemeWorkspaceUpgrade(
  existingFiles: ExistingStarterThemeFile[],
): StarterThemeWorkspaceUpgradeFile[] {
  const existingByPath = new Map(
    existingFiles.map((file) => [file.path, file]),
  );
  const targetByPath = new Map(
    STARTER_THEME_FILES.map((file) => [file.path, file]),
  );
  const upgrades: StarterThemeWorkspaceUpgradeFile[] = [];

  const existingLegacyPage = existingByPath.get("src/pages/index.tsx");
  const existingManifestForRouteContract =
    existingByPath.get("morph.theme.json");
  let alreadyUsesStartRouteContract = false;
  if (existingManifestForRouteContract) {
    try {
      const parsedManifest: unknown = JSON.parse(
        existingManifestForRouteContract.content,
      );
      if (isRecord(parsedManifest) && isRecord(parsedManifest.router)) {
        alreadyUsesStartRouteContract =
          parsedManifest.router.framework === "tanstack-start";
      }
    } catch {
      // Malformed authored manifests remain untouched and fail through the
      // normal compiler diagnostics rather than being inferred as Starter.
    }
  }
  const canAdoptRouteContract =
    alreadyUsesStartRouteContract ||
    Boolean(
      existingLegacyPage &&
      (existingLegacyPage.content === STARTER_THEME_INDEX_SOURCE ||
        existingLegacyPage.content === LEGACY_STARTER_THEME_INDEX_SOURCE),
    );

  if (canAdoptRouteContract) {
    for (const file of STARTER_THEME_V4_NEW_FILES) {
      if (existingByPath.has(file.path)) continue;
      upgrades.push({
        path: file.path,
        content: file.content,
        mimeType: file.mimeType,
        expectMissing: true,
      });
    }

    const existingHomeRoute = existingByPath.get("src/routes/index.tsx");
    if (
      existingHomeRoute?.content === LEGACY_STARTER_THEME_HOME_ROUTE_SOURCE ||
      // Slotless route: renders every section with no props, so authored
      // content in the Document could never reach the component.
      existingHomeRoute?.content ===
        LEGACY_STARTER_THEME_HOME_ROUTE_SLOTLESS_SOURCE ||
      existingHomeRoute?.content ===
        LEGACY_STARTER_THEME_STOREFRONT_PAGE_ROUTE_SOURCE
    ) {
      upgrades.push({
        path: existingHomeRoute.path,
        content: STARTER_THEME_HOME_ROUTE_SOURCE,
        mimeType: "text/typescript",
        expectedFileId: existingHomeRoute.id,
        expectedVersion: existingHomeRoute.version,
      });
    }

    // A root route without a document shell builds successfully and previews
    // correctly, because the preview entry document is platform-generated.
    // Production serves the Theme's own SSR output, which would then have no
    // <html>, no <head> and no stylesheet. Only an untouched legacy copy is
    // replaced; an authored root route is left for its owner to migrate.
    const existingRootRoute = existingByPath.get("src/routes/__root.tsx");
    const targetRootRoute = targetByPath.get("src/routes/__root.tsx");
    if (
      existingRootRoute &&
      targetRootRoute &&
      (existingRootRoute.content === LEGACY_STARTER_THEME_ROOT_ROUTE_SOURCE ||
        // Renders the shell but never loads slot values, so an edited heading
        // stayed in the Document and the site kept showing component defaults.
        existingRootRoute.content ===
          LEGACY_STARTER_THEME_ROOT_ROUTE_CONTENTLESS_SOURCE)
    ) {
      upgrades.push({
        path: existingRootRoute.path,
        content: targetRootRoute.content,
        mimeType: "text/typescript",
        expectedFileId: existingRootRoute.id,
        expectedVersion: existingRootRoute.version,
      });
    }

    // The content module gained the SSR loader that fetches published values
    // from Morph Core. Without it a slot-based route renders, but always with
    // component defaults. Only an untouched copy is replaced.
    const existingContentModule = existingByPath.get("src/morph/content.ts");
    const targetContentModule = targetByPath.get("src/morph/content.ts");
    if (
      existingContentModule &&
      targetContentModule &&
      existingContentModule.content === LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE
    ) {
      upgrades.push({
        path: existingContentModule.path,
        content: targetContentModule.content,
        mimeType: "text/typescript",
        expectedFileId: existingContentModule.id,
        expectedVersion: existingContentModule.version,
      });
    }

    const existingPackage = existingByPath.get("package.json");
    const targetPackage = targetByPath.get("package.json");
    if (existingPackage && targetPackage) {
      try {
        const parsedExisting: unknown = JSON.parse(existingPackage.content);
        const parsedTarget: unknown = JSON.parse(targetPackage.content);
        if (isRecord(parsedExisting) && isRecord(parsedTarget)) {
          const existingDependencies = isRecord(parsedExisting.dependencies)
            ? { ...parsedExisting.dependencies }
            : {};
          const existingDevDependencies = isRecord(
            parsedExisting.devDependencies,
          )
            ? { ...parsedExisting.devDependencies }
            : {};
          const targetDependencies = isRecord(parsedTarget.dependencies)
            ? parsedTarget.dependencies
            : {};
          const targetDevDependencies = isRecord(parsedTarget.devDependencies)
            ? parsedTarget.devDependencies
            : {};
          let packageChanged = false;

          if (
            existingDependencies["@morph/storefront-runtime"] === "1.0.0"
          ) {
            delete existingDependencies["@morph/storefront-runtime"];
            packageChanged = true;
          }

          // Platform-owned toolchain versions are corrected, not merely added.
          // The build container ships one pinned version of each, so a Theme
          // cannot run against a different one — and the build contract
          // validates them by exact equality. Skipping an entry that is present
          // but wrong (for example `react: "^19.0.0"` from an older starter)
          // leaves the workspace permanently unbuildable with no way to
          // recover through the upgrade path.
          for (const [dependency, version] of Object.entries(
            THEME_START_RUNTIME_DEPENDENCIES,
          )) {
            const resolved = targetDependencies[dependency] ?? version;
            if (existingDependencies[dependency] === resolved) continue;
            existingDependencies[dependency] = resolved;
            packageChanged = true;
          }
          for (const [dependency, version] of Object.entries(
            THEME_START_BUILD_DEPENDENCIES,
          )) {
            const resolved = targetDevDependencies[dependency] ?? version;
            if (existingDevDependencies[dependency] === resolved) continue;
            existingDevDependencies[dependency] = resolved;
            packageChanged = true;
          }

          if (packageChanged) {
            upgrades.push({
              path: existingPackage.path,
              content: `${JSON.stringify(
                {
                  ...parsedExisting,
                  dependencies: existingDependencies,
                  devDependencies: existingDevDependencies,
                },
                null,
                2,
              )}\n`,
              mimeType: "application/json",
              expectedFileId: existingPackage.id,
              expectedVersion: existingPackage.version,
            });
          }
        }
      } catch {
        // Invalid authored package metadata remains untouched so the normal
        // compiler diagnostic can fail closed without destroying customer work.
      }
    }
  }

  for (const file of STARTER_THEME_V3_NEW_FILES) {
    if (existingByPath.has(file.path)) continue;
    upgrades.push({
      path: file.path,
      content: file.content,
      mimeType: file.mimeType,
      expectMissing: true,
    });
  }

  const exactLegacyReplacements = [
    {
      path: "src/components/Header.tsx",
      legacy: LEGACY_STARTER_THEME_HEADER_SOURCE,
      current: STARTER_THEME_HEADER_SOURCE,
    },
    {
      path: "src/components/Footer.tsx",
      legacy: LEGACY_STARTER_THEME_FOOTER_SOURCE,
      current: STARTER_THEME_FOOTER_SOURCE,
    },
  ] as const;

  const documentLayoutReady = Boolean(
    existingLegacyPage &&
    (existingLegacyPage.content === STARTER_THEME_INDEX_SOURCE ||
      existingLegacyPage.content === LEGACY_STARTER_THEME_INDEX_SOURCE),
  );
  for (const replacement of exactLegacyReplacements) {
    const existing = existingByPath.get(replacement.path);
    if (!existing) continue;
    const isLegacy = existing.content === replacement.legacy;
    if (!isLegacy) continue;
    upgrades.push({
      path: replacement.path,
      content: replacement.current,
      mimeType: "text/typescript",
      expectedFileId: existing.id,
      expectedVersion: existing.version,
    });
  }

  const existingManifest = existingByPath.get("morph.theme.json");
  const targetManifestFile = targetByPath.get("morph.theme.json");
  if (!existingManifest || !targetManifestFile) return upgrades;

  try {
    const parsedExisting: unknown = JSON.parse(existingManifest.content);
    const parsedTarget: unknown = JSON.parse(targetManifestFile.content);
    if (!isRecord(parsedExisting) || !isRecord(parsedTarget)) return upgrades;

    const existingComponents = isRecord(parsedExisting.components)
      ? { ...parsedExisting.components }
      : {};
    const targetComponents = isRecord(parsedTarget.components)
      ? parsedTarget.components
      : {};
    const existingSections = isRecord(parsedExisting.sections)
      ? { ...parsedExisting.sections }
      : {};
    const targetSections = isRecord(parsedTarget.sections)
      ? parsedTarget.sections
      : {};
    let changed = false;

    for (const componentRef of V3_COMPONENT_REFS) {
      if (existingComponents[componentRef] !== undefined) continue;
      const target = targetComponents[componentRef];
      if (target === undefined) continue;
      existingComponents[componentRef] = target;
      changed = true;
    }
    for (const sectionType of V3_SECTION_TYPES) {
      if (existingSections[sectionType] !== undefined) continue;
      const target = targetSections[sectionType];
      if (target === undefined) continue;
      existingSections[sectionType] = target;
      changed = true;
    }

    const nextManifest: Record<string, unknown> = {
      ...parsedExisting,
      components: existingComponents,
      sections: existingSections,
    };
    if (documentLayoutReady && canAdoptRouteContract) {
      for (const key of ["entry", "router", "documentLayout"] as const) {
        if (
          JSON.stringify(nextManifest[key]) ===
          JSON.stringify(parsedTarget[key])
        ) {
          continue;
        }
        nextManifest[key] = parsedTarget[key];
        changed = true;
      }
    }

    if (changed) {
      upgrades.push({
        path: existingManifest.path,
        content: `${JSON.stringify(nextManifest, null, 2)}\n`,
        mimeType: "application/json",
        expectedFileId: existingManifest.id,
        expectedVersion: existingManifest.version,
      });
    }
  } catch {
    // Invalid authored manifests remain untouched and continue to surface their
    // existing diagnostics. A bootstrap upgrade must never replace them.
  }

  return upgrades;
}

/**
 * Builds the complete OCC mutation for upgrading an existing Starter Theme.
 * The obsolete pages entry is removed only when its bytes still match a known
 * Morph Starter version and the TanStack Start route entry already exists or
 * will be inserted by the same mutation.
 */
export function createStarterThemeWorkspaceUpgradePlan(
  existingFiles: ExistingStarterThemeFile[],
): StarterThemeWorkspaceUpgradePlan {
  const files = createStarterThemeWorkspaceUpgrade(existingFiles);
  const existingLegacyPage = existingFiles.find(
    (file) => file.path === "src/pages/index.tsx",
  );
  const hasStartRoute =
    existingFiles.some((file) => file.path === "src/routes/index.tsx") ||
    files.some((file) => file.path === "src/routes/index.tsx");
  const isPristineStarterPage = Boolean(
    existingLegacyPage &&
    (existingLegacyPage.content === STARTER_THEME_INDEX_SOURCE ||
      existingLegacyPage.content === LEGACY_STARTER_THEME_INDEX_SOURCE),
  );

  return {
    files,
    deletions:
      existingLegacyPage && hasStartRoute && isPristineStarterPage
        ? [
            {
              path: existingLegacyPage.path,
              expectedFileId: existingLegacyPage.id,
              expectedVersion: existingLegacyPage.version,
            },
          ]
        : [],
  };
}
