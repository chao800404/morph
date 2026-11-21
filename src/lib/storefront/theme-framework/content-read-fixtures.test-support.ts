import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

import { nativeAstroAllowedPackages } from "./astro-native-build";

/**
 * The content read core prototype and the two Themes that read through it
 * (docs/content-read-core-design.md):
 *
 * - `fixtures/morph/content-read-core/`: TEST PROTOTYPE. `core.ts`, the one
 *   framework-agnostic read core, and the platform wiring for each framework
 *   (`astro/`, `start/`). Neither Theme carries any of it.
 * - `fixtures/morph/astro-case-a/`: a pure Astro Theme, what an author writes.
 * - `fixtures/morph/start-content-read/`: a pure Start/React Theme, the same.
 *
 * A workspace is a Theme's own files plus what the platform installs: the
 * core, byte for byte from its one file, and that framework's wiring. Tests
 * read all of it from disk; no product module imports it.
 */
const FIXTURES = join(process.cwd(), "fixtures", "morph");

export const CONTENT_READ_CORE_ROOT = join(FIXTURES, "content-read-core");
/** The one file of the core. */
export const CONTENT_READ_CORE_FILE = join(CONTENT_READ_CORE_ROOT, "core.ts");
/** Where the platform installs it in every workspace. */
export const CORE_WORKSPACE_PATH = "src/morph/core.ts";
/** The module pages import `morph` from, in every workspace. */
export const CONTENT_WORKSPACE_PATH = "src/morph/content.ts";

export const CASE_A_FIXTURE_ROOT = join(FIXTURES, "astro-case-a");
export const START_FIXTURE_ROOT = join(FIXTURES, "start-content-read");

export type ContentReadFramework = "astro" | "start";
export type FixtureFile = { path: string; content: string };

/** Each framework's wiring: file in content-read-core/ → path in the workspace. */
export const PLATFORM_WIRING: Record<
  ContentReadFramework,
  readonly (readonly [string, string])[]
> = {
  astro: [
    ["astro/content.ts", CONTENT_WORKSPACE_PATH],
    ["astro/request-context.ts", "src/morph/request-context.ts"],
    ["astro/middleware.ts", "src/morph/middleware.ts"],
    ["astro/integration.mjs", "morph-content-wiring.mjs"],
  ],
  start: [["start/content.ts", CONTENT_WORKSPACE_PATH]],
};

export const sha256 = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");

export function walkFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walkFiles(full) : [full];
  });
}

function filesUnder(root: string): FixtureFile[] {
  return walkFiles(root)
    .map((full) => ({
      path: relative(root, full).split(sep).join("/"),
      content: readFileSync(full, "utf8"),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The pure Astro Theme's own files, as its author wrote them. */
export const caseAFixtureFiles = () => filesUnder(CASE_A_FIXTURE_ROOT);
/** The pure Start Theme's own files, as its author wrote them. */
export const startFixtureFiles = () => filesUnder(START_FIXTURE_ROOT);

export const readCoreSource = () => readFileSync(CONTENT_READ_CORE_FILE, "utf8");

/** Where the Astro wiring stand-in adds its integration to the Theme's config. */
const ASTRO_CONFIG_ANCHOR = "export default defineConfig({\n";

/**
 * A Theme as the platform would run it: its own files, the core from its one
 * file, and the framework's wiring. `integration: false` leaves Astro's
 * integration out, so nothing installs the middleware (the reverse case).
 */
export function withPlatformWiring(
  framework: ContentReadFramework,
  themeFiles: readonly FixtureFile[],
  options: { integration?: boolean } = {},
): FixtureFile[] {
  const installed: FixtureFile[] = [
    { path: CORE_WORKSPACE_PATH, content: readCoreSource() },
    ...PLATFORM_WIRING[framework].map(([from, to]) => ({
      path: to,
      content: readFileSync(join(CONTENT_READ_CORE_ROOT, from), "utf8"),
    })),
  ];
  for (const file of installed) {
    if (themeFiles.some((own) => own.path === file.path)) {
      throw new Error(`The Theme already has ${file.path}; the platform installs it.`);
    }
  }
  const own = themeFiles.map((file) => {
    if (
      framework !== "astro" ||
      file.path !== "astro.config.mjs" ||
      options.integration === false
    ) {
      return file;
    }
    if (!file.content.includes(ASTRO_CONFIG_ANCHOR)) {
      throw new Error("astro.config.mjs does not have the shape the wiring stand-in expects.");
    }
    // Stands in for Morph's wrapper config adding the integration, which is
    // product code and not changed here; see content-read-core/astro/integration.mjs.
    return {
      ...file,
      content:
        'import { morphContentWiring } from "./morph-content-wiring.mjs";\n' +
        file.content.replace(
          ASTRO_CONFIG_ANCHOR,
          `${ASTRO_CONFIG_ANCHOR}  integrations: [morphContentWiring()],\n`,
        ),
    };
  });
  return [...own, ...installed].sort((a, b) => a.path.localeCompare(b.path));
}

export const astroWorkspaceFiles = (options?: { integration?: boolean }) =>
  withPlatformWiring("astro", caseAFixtureFiles(), options);
export const startWorkspaceFiles = () => withPlatformWiring("start", startFixtureFiles());

/**
 * The same content for both Themes, in the Live Preview snapshot shape: the
 * hero both render, or the same page with the hero hidden.
 */
export const parityContent = (
  hero: { title: string; subtitle: string },
  options: { hidden?: boolean } = {},
) => ({
  templates: {
    index: options.hidden
      ? { slots: {}, hiddenSlots: ["hero"] }
      : { slots: { hero }, hiddenSlots: [] },
  },
  pages: {},
});

/** The hero's heading and paragraph, as a server rendered them; null if absent. */
export function renderedHero(html: string) {
  // The preview may add its own attributes to the element, before ours.
  const section = /<section\b[^>]*\bdata-case-a-hero\b[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1];
  return section === undefined
    ? null
    : {
        title: /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(section)?.[1]?.trim(),
        subtitle: /<p[^>]*>([\s\S]*?)<\/p>/.exec(section)?.[1]?.trim(),
      };
}

/** Every module specifier a file names: static, re-export, side-effect, dynamic. */
export function moduleSpecifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"()]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

const packageOf = (specifier: string) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!;
};

type PureRule = {
  packages: ReadonlySet<string>;
  /** Module prefixes allowed besides packages, e.g. `node:`. */
  prefixes: readonly string[];
  /** Theme paths the framework generates, so no Theme file has them. */
  generated: readonly string[];
  extensions: RegExp;
  /** The import guard's packages, when the rule must also be inside them. */
  approved: ReadonlySet<string> | null;
};

/**
 * Why `files` is not a pure project of one framework; empty when it is.
 * Stricter than the import guards on purpose: the Astro toolchain also
 * carries React, so a guard letting a file through does not make it pure.
 */
function pureViolations(files: readonly FixtureFile[], rule: PureRule): string[] {
  const violations: string[] = [];
  const paths = new Set(files.map((file) => file.path));
  const packageAllowed = (name: string) =>
    rule.packages.has(name) && (rule.approved === null || rule.approved.has(name));
  for (const file of files) {
    if (!rule.extensions.test(file.path)) {
      violations.push(`${file.path}: not a file this framework's Theme is written in`);
      continue;
    }
    if (/\.jsonc?$/.test(file.path)) continue;
    for (const specifier of moduleSpecifiers(file.content)) {
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const target = posix.normalize(posix.join(posix.dirname(file.path), specifier));
        const candidates = [
          target,
          `${target}.ts`,
          `${target}.tsx`,
          `${target}.astro`,
          `${target}/index.ts`,
        ];
        if (rule.generated.includes(target)) continue;
        if (target.startsWith("..") || !candidates.some((candidate) => paths.has(candidate))) {
          violations.push(`${file.path}: "${specifier}" is not a file of this Theme`);
        }
        continue;
      }
      if (rule.prefixes.some((prefix) => specifier.startsWith(prefix))) continue;
      const name = packageOf(specifier);
      if (!packageAllowed(name)) {
        violations.push(`${file.path}: imports "${specifier}" from package "${name}"`);
      }
    }
  }
  const manifest = files.find((file) => file.path === "package.json");
  const dependencies = manifest
    ? Object.keys(
        (JSON.parse(manifest.content) as { dependencies?: Record<string, string> })
          .dependencies ?? {},
      )
    : [];
  for (const name of dependencies) {
    if (!packageAllowed(name)) violations.push(`package.json: depends on "${name}"`);
  }
  return violations;
}

/** Astro and its Cloudflare adapter only, plus node: and astro: modules. */
export const pureAstroViolations = (files: readonly FixtureFile[]) =>
  pureViolations(files, {
    packages: new Set(["astro", "@astrojs/cloudflare"]),
    prefixes: ["node:", "astro:"],
    generated: [],
    extensions: /\.(astro|ts|mjs|json|jsonc)$/,
    approved: new Set(nativeAstroAllowedPackages()),
  });

/** React, TanStack Router and Start only. */
export const pureStartViolations = (files: readonly FixtureFile[]) =>
  pureViolations(files, {
    packages: new Set(["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"]),
    prefixes: [],
    // TanStack Router's plugin writes the route tree.
    generated: ["src/routeTree.gen"],
    extensions: /\.(ts|tsx|json)$/,
    approved: null,
  });
