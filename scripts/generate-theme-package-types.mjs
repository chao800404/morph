#!/usr/bin/env node

/**
 * Build the declaration snapshot consumed by the browser Monaco worker.
 *
 * The worker cannot read the server's node_modules, so declarations have to be
 * resolved while the Morph app is being built. This script follows the same
 * approved dependency list used by the Theme compiler, walks the declaration
 * imports that those packages actually use, and writes a small virtual
 * /node_modules tree for Monaco. It intentionally never reads a Theme path or
 * executes a package.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as ts from "typescript";

const root = process.cwd();
const allowlistPath = path.join(
  root,
  "src/lib/storefront/compiler/sandbox-vite-theme-build-runner.types.ts",
);
const toolchainPath = path.join(
  root,
  "src/lib/storefront/compiler/theme-start-toolchain.ts",
);
const managedTypesPath = path.join(
  root,
  "src/routes/_editor/-components/editor-code-package-types.ts",
);
const outputPath = path.join(
  root,
  "src/routes/_editor/-components/editor-code-package-types.generated.ts",
);

const allowlistSource = fs.readFileSync(allowlistPath, "utf8");
const toolchainSource = fs.readFileSync(toolchainPath, "utf8");
const managedTypesSource = fs.readFileSync(managedTypesPath, "utf8");
const allowlistMatch = allowlistSource.match(
  /DEFAULT_APPROVED_DEPENDENCIES[\s\S]*?=\s*\[([\s\S]*?)\]/,
);
if (!allowlistMatch) {
  throw new Error("Could not read DEFAULT_APPROVED_DEPENDENCIES");
}

const approvedDependencies = [
  ...allowlistMatch[1].matchAll(/"([^"\r\n]+)"/g),
].map((match) => match[1]);

const buildDependenciesMatch = toolchainSource.match(
  /THEME_START_BUILD_DEPENDENCIES[\s\S]*?=\s*\{([\s\S]*?)\}/,
);
const buildOnlyDependencies = new Set(
  buildDependenciesMatch
    ? [
        ...buildDependenciesMatch[1].matchAll(
          /(?:"([^"\r\n]+)"|([A-Za-z0-9_$./-]+))\s*:/g,
        ),
      ].map((match) => match[1] ?? match[2])
    : [],
);

const manifestSource = managedTypesSource.slice(
  managedTypesSource.indexOf("THEME_PACKAGE_TYPE_MANIFEST"),
);
const managedPackageRoots = new Set(
  [...manifestSource.matchAll(/^\s+"([^"\r\n]+)":\s*\{/gm)].map((match) =>
    toModuleRoot(match[1]),
  ),
);

// The compiler allowlist is the source of truth. A package becomes available
// to both the Theme build and Monaco only after it is approved there and is
// installed in this app's pinned toolchain. This avoids shipping declarations
// for unrelated dev tools such as Playwright or the TypeScript compiler.
const packageNames = [...new Set(approvedDependencies)].filter(
  (name) =>
    !buildOnlyDependencies.has(name) &&
    (!name.startsWith("@types/") || name === "@types/react") &&
    !managedPackageRoots.has(toModuleRoot(name)),
);

const require = createRequire(import.meta.url);
const compilerOptions = {
  allowJs: true,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noResolve: false,
  target: ts.ScriptTarget.ES2022,
};

const declarationExtensions = new Set([".d.ts", ".d.mts", ".d.cts"]);
const files = new Map();
const moduleTargets = new Map();
const packageRoots = new Map();
const visiting = new Set();

function isDeclarationFile(filePath) {
  return [...declarationExtensions].some((extension) =>
    filePath.endsWith(extension),
  );
}

function realPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function virtualPath(filePath) {
  const normalized = realPath(filePath).replaceAll("\\", "/");
  const marker = "/node_modules/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  return `/node_modules/${normalized.slice(markerIndex + marker.length)}`;
}

function toModuleRoot(specifier) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? parts.slice(0, 2).join("/") : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

function resolveModule(specifier, containingFile) {
  const resolved = ts.resolveModuleName(
    specifier,
    containingFile,
    compilerOptions,
    ts.sys,
  ).resolvedModule;
  if (!resolved?.resolvedFileName) return null;
  const resolvedFileName = realPath(resolved.resolvedFileName);
  if (!isDeclarationFile(resolvedFileName)) return null;
  return resolvedFileName;
}

function recordModuleTarget(specifier, filePath) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/"))
    return;
  const targetVirtualPath = virtualPath(filePath);
  if (targetVirtualPath) {
    const segments = targetVirtualPath.split("/").filter(Boolean);
    const packageRoot =
      segments[0] === "node_modules"
        ? segments[1]?.startsWith("@")
          ? segments.slice(1, 3).join("/")
          : segments[1]
        : undefined;
    if (packageRoot && managedPackageRoots.has(packageRoot)) return;
  }
  if (!moduleTargets.has(specifier)) moduleTargets.set(specifier, filePath);
}

function addFile(filePath) {
  const normalizedFilePath = realPath(filePath);
  if (
    !isDeclarationFile(normalizedFilePath) ||
    visiting.has(normalizedFilePath)
  )
    return;
  const uriPath = virtualPath(normalizedFilePath);
  if (!uriPath) return;

  const virtualSegments = uriPath.split("/").filter(Boolean);
  const packageRoot =
    virtualSegments[0] === "node_modules"
      ? virtualSegments[1]?.startsWith("@")
        ? virtualSegments.slice(1, 3).join("/")
        : virtualSegments[1]
      : undefined;
  if (packageRoot && managedPackageRoots.has(packageRoot)) return;

  visiting.add(normalizedFilePath);
  const content = fs.readFileSync(normalizedFilePath, "utf8");
  files.set(uriPath, content);

  const preprocessed = ts.preProcessFile(content, true, true);
  for (const imported of preprocessed.importedFiles) {
    const importedFile = imported.fileName.startsWith(".")
      ? resolveModule(imported.fileName, normalizedFilePath)
      : resolveModule(imported.fileName, normalizedFilePath);
    if (!importedFile) continue;
    recordModuleTarget(imported.fileName, importedFile);
    addFile(importedFile);
  }
  for (const referenced of preprocessed.referencedFiles) {
    const referencedFile = referenced.fileName.startsWith(".")
      ? resolveModule(referenced.fileName, normalizedFilePath)
      : null;
    if (referencedFile) addFile(referencedFile);
  }
  for (const typeReference of preprocessed.typeReferenceDirectives) {
    const referencedFile = ts.resolveTypeReferenceDirective(
      typeReference.fileName,
      normalizedFilePath,
      compilerOptions,
      ts.sys,
    ).resolvedTypeReferenceDirective?.resolvedFileName;
    if (referencedFile && isDeclarationFile(referencedFile))
      addFile(referencedFile);
  }
}

function resolvePackageEntry(specifier) {
  const rootPackage = toModuleRoot(specifier);
  let packageJsonFile;
  try {
    packageJsonFile = require.resolve(`${rootPackage}/package.json`);
  } catch {
    try {
      let directory = path.dirname(require.resolve(rootPackage));
      while (directory !== path.dirname(directory)) {
        const candidate = path.join(directory, "package.json");
        if (fs.existsSync(candidate)) {
          packageJsonFile = candidate;
          break;
        }
        directory = path.dirname(directory);
      }
    } catch {
      return null;
    }
  }
  if (!packageJsonFile) return null;
  const packageRoot = path.dirname(realPath(packageJsonFile));
  packageRoots.set(rootPackage, packageRoot);
  return resolveModule(specifier, path.join(root, "__morph_theme_types__.ts"));
}

function collectPackageExportEntries(rootPackage, packageJsonFile) {
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonFile, "utf8"));
  } catch {
    return;
  }
  const exportsField = packageJson.exports;
  if (!exportsField) return;
  const containingFile = path.join(root, "__morph_theme_types__.ts");

  const visitTarget = (specifier, target) => {
    if (typeof target === "string") {
      const resolved = resolveModule(specifier, containingFile);
      if (resolved) moduleTargets.set(specifier, resolved);
      return;
    }
    if (!target || typeof target !== "object") return;
    // Conditional exports should prefer the declaration-aware `types` branch,
    // but walking all branches is safe because only resolvable .d.ts files are
    // retained.
    for (const [key, value] of Object.entries(target)) {
      if (
        key === "types" ||
        key === "import" ||
        key === "require" ||
        key === "default"
      ) {
        visitTarget(specifier, value);
      }
    }
  };

  if (typeof exportsField === "string") {
    visitTarget(rootPackage, exportsField);
    return;
  }
  if (!exportsField || typeof exportsField !== "object") return;
  for (const [subpath, target] of Object.entries(exportsField)) {
    if (!subpath.startsWith(".")) continue;
    const specifier =
      subpath === "." ? rootPackage : `${rootPackage}/${subpath.slice(2)}`;
    visitTarget(specifier, target);
  }
}

for (const packageName of packageNames) {
  const entry = resolvePackageEntry(packageName);
  if (!entry) continue;
  moduleTargets.set(packageName, entry);
  addFile(entry);
  const rootPackage = toModuleRoot(packageName);
  const packageJsonFile = packageRoots.get(rootPackage)
    ? path.join(packageRoots.get(rootPackage), "package.json")
    : null;
  if (packageJsonFile)
    collectPackageExportEntries(rootPackage, packageJsonFile);
}

// Exported subpaths are valid Theme imports too (for example `pkg/server`).
// Add their declaration entry points before walking the graph so Monaco can
// resolve them without needing a real package.json in its worker filesystem.
for (const [specifier, target] of moduleTargets) addFile(target);

function relativeImport(fromVirtualPath, targetVirtualPath) {
  let value = path.posix.relative(
    path.posix.dirname(fromVirtualPath),
    targetVirtualPath,
  );
  if (!value.startsWith(".")) value = `./${value}`;
  return value;
}

// Add a tiny declaration entry point for every package specifier encountered in
// the declaration graph. Monaco can resolve these virtual package paths just as
// it would resolve node_modules/package/index.d.ts.
for (const [specifier, target] of moduleTargets) {
  const targetVirtualPath = virtualPath(target);
  if (!targetVirtualPath) continue;
  const shimPath = `/node_modules/${specifier}.d.ts`;
  if (files.has(shimPath)) continue;
  const targetImport = relativeImport(shimPath, targetVirtualPath);
  const targetContent = files.get(targetVirtualPath) ?? "";
  const defaultExport = /(?:export\s+default|export\s*=)/.test(targetContent)
    ? `\nexport { default } from "${targetImport}";`
    : "";
  files.set(shimPath, `export * from "${targetImport}";${defaultExport}\n`);
}

const entries = packageNames.filter((packageName) =>
  moduleTargets.has(packageName),
);
const serializedFiles = [...files.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(
    ([uriPath, content]) =>
      `  { path: ${JSON.stringify(uriPath)}, content: ${JSON.stringify(content)} },`,
  )
  .join("\n");

const generatedSource = `/* eslint-disable */
// Generated by scripts/generate-theme-package-types.mjs. Do not edit by hand.
export type GeneratedThemePackageDeclaration = {
  readonly path: string;
  readonly content: string;
};

// prettier-ignore
export const GENERATED_THEME_PACKAGE_NAMES: readonly string[] = ${JSON.stringify(entries)};
// prettier-ignore
export const GENERATED_THEME_PACKAGE_DECLARATIONS: readonly GeneratedThemePackageDeclaration[] = [
${serializedFiles}
];
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, generatedSource);
console.log(
  `Generated ${files.size} Monaco declaration files for ${entries.length} approved/installed packages (${Buffer.byteLength(generatedSource)} bytes).`,
);
