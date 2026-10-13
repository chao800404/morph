import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

import { nativeAstroAllowedPackages } from "./astro-native-build";

/**
 * The pure Astro Theme for case A of the content binding contract
 * (docs/content-binding-contract-design.md §6;
 * docs/astro-content-read-module-design.md), as committed under
 * `fixtures/morph/astro-case-a`. Tests read it from disk; nothing imports it.
 */
export const CASE_A_FIXTURE_ROOT = join(
  process.cwd(),
  "fixtures",
  "morph",
  "astro-case-a",
);

/** The fixture's test stand-in for the Astro content read module. */
export const CASE_A_STAND_IN = "src/morph/content.ts";

export type CaseAFixtureFile = { path: string; content: string };

export function walkFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walkFiles(full) : [full];
  });
}

/** Every file of the fixture, by its path in the Theme, sorted. */
export function caseAFixtureFiles(): CaseAFixtureFile[] {
  return walkFiles(CASE_A_FIXTURE_ROOT)
    .map((full) => ({
      path: relative(CASE_A_FIXTURE_ROOT, full).split(sep).join("/"),
      content: readFileSync(full, "utf8"),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
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

/**
 * Only these packages: Astro and its Cloudflare adapter. Stricter than the
 * import guards on purpose — the Astro toolchain also carries React, so a
 * guard letting a file through does not make it pure Astro.
 */
const PURE_ASTRO_PACKAGES = new Set(["astro", "@astrojs/cloudflare"]);
const PURE_ASTRO_EXTENSIONS = /\.(astro|ts|mjs|json|jsonc)$/;

const packageOf = (specifier: string) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!;
};

/** Why `files` is not a pure Astro project; empty when it is. */
export function pureAstroViolations(
  files: readonly CaseAFixtureFile[],
): string[] {
  const violations: string[] = [];
  const paths = new Set(files.map((file) => file.path));
  const allowed = new Set(nativeAstroAllowedPackages());
  for (const file of files) {
    if (!PURE_ASTRO_EXTENSIONS.test(file.path)) {
      violations.push(
        `${file.path}: not an Astro, TypeScript, module or JSON file`,
      );
      continue;
    }
    if (/\.jsonc?$/.test(file.path)) continue;
    for (const specifier of moduleSpecifiers(file.content)) {
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const target = posix.normalize(
          posix.join(posix.dirname(file.path), specifier),
        );
        const candidates = [
          target,
          `${target}.ts`,
          `${target}.astro`,
          `${target}/index.ts`,
        ];
        if (
          target.startsWith("..") ||
          !candidates.some((candidate) => paths.has(candidate))
        ) {
          violations.push(
            `${file.path}: "${specifier}" is not a file of this Theme`,
          );
        }
        continue;
      }
      if (specifier.startsWith("node:") || specifier.startsWith("astro:")) {
        continue;
      }
      const name = packageOf(specifier);
      if (!PURE_ASTRO_PACKAGES.has(name) || !allowed.has(name)) {
        violations.push(
          `${file.path}: imports "${specifier}" from package "${name}"`,
        );
      }
    }
  }
  const manifest = files.find((file) => file.path === "package.json");
  const dependencies = manifest
    ? Object.keys(
        (
          JSON.parse(manifest.content) as {
            dependencies?: Record<string, string>;
          }
        ).dependencies ?? {},
      )
    : [];
  for (const name of dependencies) {
    if (!PURE_ASTRO_PACKAGES.has(name) || !allowed.has(name)) {
      violations.push(`package.json: depends on "${name}"`);
    }
  }
  return violations;
}
