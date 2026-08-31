#!/usr/bin/env node

/**
 * Build the declaration snapshot consumed by the browser Monaco worker.
 *
 * The worker cannot read the server's node_modules, so declarations have to be
 * resolved while the Morph app is being built. This script follows the
 * dependency list declared in cms.config.ts, walks the declaration
 * imports that those packages actually use, and writes a small virtual
 * /node_modules tree for Monaco. It also emits the exact root-package manifest
 * consumed when Dockerfile.sandbox is rebuilt. It intentionally never reads a
 * Theme path or executes a package.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as ts from "typescript";

const root = process.cwd();
const cmsConfigPath = path.join(root, "src/cms.config.ts");
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
const sandboxDependenciesJsonPath = path.join(
  root,
  "sandbox-toolchain-dependencies.json",
);
const sandboxDependenciesModulePath = path.join(
  root,
  "src/lib/storefront/compiler/theme-sandbox-dependencies.generated.ts",
);

const cmsConfigSource = fs.readFileSync(cmsConfigPath, "utf8");
const toolchainSource = fs.readFileSync(toolchainPath, "utf8");
const managedTypesSource = fs.readFileSync(managedTypesPath, "utf8");

function staticPropertyName(property, sourceFile) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return property.name.getText(sourceFile).replace(/^['"]|['"]$/g, "");
}

function readConfiguredThemeDependencies(source) {
  const sourceFile = ts.createSourceFile(
    cmsConfigPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let dependencyObject;

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "defineConfig" &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const theme = node.arguments[0].properties.find(
        (property) => staticPropertyName(property, sourceFile) === "theme",
      );
      if (theme && ts.isPropertyAssignment(theme)) {
        const themeObject = theme.initializer;
        if (ts.isObjectLiteralExpression(themeObject)) {
          const dependencies = themeObject.properties.find(
            (property) =>
              staticPropertyName(property, sourceFile) === "dependencies",
          );
          if (dependencies && ts.isPropertyAssignment(dependencies)) {
            dependencyObject = dependencies.initializer;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!dependencyObject || !ts.isObjectLiteralExpression(dependencyObject)) {
    throw new Error(
      "cms.config.ts must define theme.dependencies as a static package/version object",
    );
  }

  const dependencies = {};
  for (const property of dependencyObject.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(
        "cms.config.ts theme.dependencies cannot use spreads or computed package names",
      );
    }
    const name = staticPropertyName(property, sourceFile);
    const version = property.initializer;
    if (
      !name ||
      (!ts.isStringLiteral(version) &&
        !ts.isNoSubstitutionTemplateLiteral(version))
    ) {
      throw new Error(
        "cms.config.ts theme.dependencies keys and versions must be static strings",
      );
    }
    dependencies[name] = version.text;
  }
  return dependencies;
}

const configuredDependencies = readConfiguredThemeDependencies(cmsConfigSource);
const approvedDependencies = Object.keys(configuredDependencies);

const configuredRootDependencies = {};
for (const [specifier, version] of Object.entries(configuredDependencies)) {
  const rootPackage = toModuleRoot(specifier);
  const existingVersion = configuredRootDependencies[rootPackage];
  if (existingVersion && existingVersion !== version) {
    throw new Error(
      `cms.config.ts assigns conflicting versions to ${rootPackage}: ${existingVersion} and ${version}`,
    );
  }
  configuredRootDependencies[rootPackage] = version;
}

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

// Managed declarations are intentionally compact in source, but a configured
// dependency should still get its real declaration graph when it is installed.
// The generated snapshot is what lets Monaco expose the same props, overloads,
// and generic signatures that the Theme's build sees. Compact declarations are
// retained as a fallback for packages that cannot be resolved safely.
const generatedDeclarationRoots = new Set(
  approvedDependencies
    .filter((name) => !buildOnlyDependencies.has(name))
    .map(toModuleRoot),
);

function usesCompactDeclarations(rootPackage) {
  return (
    managedPackageRoots.has(rootPackage) &&
    !generatedDeclarationRoots.has(rootPackage)
  );
}

// A package becomes available to both the Theme build and Monaco only after it
// is declared in cms.config.ts and installed in this app's pinned toolchain.
// This avoids shipping declarations for unrelated dev tools such as Playwright
// or the TypeScript compiler.
const packageNames = [...new Set(approvedDependencies)].filter(
  (name) =>
    !buildOnlyDependencies.has(name) &&
    (!name.startsWith("@types/") || name === "@types/react") &&
    !usesCompactDeclarations(toModuleRoot(name)),
);

const require = createRequire(import.meta.url);

function resolvePackageJson(rootPackage) {
  const directPackageJson = path.join(
    root,
    "node_modules",
    ...rootPackage.split("/"),
    "package.json",
  );
  if (fs.existsSync(directPackageJson)) return directPackageJson;
  try {
    return require.resolve(`${rootPackage}/package.json`);
  } catch {
    try {
      let directory = path.dirname(require.resolve(rootPackage));
      while (directory !== path.dirname(directory)) {
        const candidate = path.join(directory, "package.json");
        if (fs.existsSync(candidate)) return candidate;
        directory = path.dirname(directory);
      }
    } catch {
      return null;
    }
  }
  return null;
}

for (const [rootPackage, expectedVersion] of Object.entries(
  configuredRootDependencies,
)) {
  const packageJsonFile = resolvePackageJson(rootPackage);
  if (!packageJsonFile) {
    throw new Error(
      `Theme dependency ${rootPackage}@${expectedVersion} is configured in cms.config.ts but is not installed in the workspace. Install it before generating Theme types.`,
    );
  }
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonFile, "utf8"));
  } catch {
    throw new Error(
      `Unable to read installed package metadata for ${rootPackage}.`,
    );
  }
  if (packageJson.version !== expectedVersion) {
    throw new Error(
      `Theme dependency ${rootPackage} is configured at ${expectedVersion} but the installed workspace version is ${packageJson.version ?? "unknown"}. Install the exact configured version before generating Theme types.`,
    );
  }
}

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

function resolveDeclarationTarget(packageRoot, target) {
  if (typeof target === "string") {
    const candidate = realPath(path.resolve(packageRoot, target));
    return isDeclarationFile(candidate) && fs.existsSync(candidate)
      ? candidate
      : null;
  }
  if (!target || typeof target !== "object") return null;
  for (const key of ["types", "import", "default", "require"]) {
    const next = resolveDeclarationTarget(packageRoot, target[key]);
    if (next) return next;
  }
  return null;
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
  // Triple-slash references commonly omit `./` (for example React's
  // `global.d.ts`). Resolve declaration references relative to the file before
  // asking TypeScript to interpret the same string as a package specifier.
  if (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    /\.d\.(?:ts|mts|cts)$/.test(specifier)
  ) {
    const relativeDeclaration = realPath(
      path.resolve(path.dirname(containingFile), specifier),
    );
    if (isDeclarationFile(relativeDeclaration) && fs.existsSync(relativeDeclaration)) {
      return relativeDeclaration;
    }
  }
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    const rootPackage = toModuleRoot(specifier);
    const packageJsonFile = resolvePackageJson(rootPackage);
    if (packageJsonFile) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonFile, "utf8"));
        const packageRoot = path.dirname(realPath(packageJsonFile));
        const subpath = specifier === rootPackage
          ? "."
          : `./${specifier.slice(rootPackage.length + 1)}`;
        const exportTarget =
          packageJson.exports && typeof packageJson.exports === "object"
            ? packageJson.exports[subpath]
            : null;
        const preferredDeclaration = resolveDeclarationTarget(
          packageRoot,
          exportTarget,
        );
        if (preferredDeclaration) return preferredDeclaration;
      } catch {
        // Fall through to TypeScript's resolver for malformed or unusual
        // package metadata; no untrusted declaration is executed.
      }
    }
  }
  const resolved = ts.resolveModuleName(
    specifier,
    containingFile,
    compilerOptions,
    ts.sys,
  ).resolvedModule;
  if (resolved?.resolvedFileName) {
    const resolvedFileName = realPath(resolved.resolvedFileName);
    if (isDeclarationFile(resolvedFileName)) return resolvedFileName;
  }

  // TypeScript's NodeNext resolver intentionally rejects packages that only
  // expose an `exports.import` declaration when the synthetic containing file
  // cannot be classified as ESM. Resolve that bounded package entry directly
  // from package.json so the Monaco snapshot still matches the installed
  // dependency (not a hand-written wildcard module).
  const rootPackage = toModuleRoot(specifier);
  const packageJsonFile = resolvePackageJson(rootPackage);
  if (!packageJsonFile) return null;
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonFile, "utf8"));
  } catch {
    return null;
  }
  const packageRoot = path.dirname(realPath(packageJsonFile));
  const subpath = specifier === rootPackage
    ? "."
    : `./${specifier.slice(rootPackage.length + 1)}`;
  const exportTarget =
    packageJson.exports && typeof packageJson.exports === "object"
      ? packageJson.exports[subpath]
      : null;
  return (
    resolveDeclarationTarget(packageRoot, exportTarget) ??
    (subpath === "."
      ? resolveDeclarationTarget(
          packageRoot,
          packageJson.types ?? packageJson.typings,
        )
      : null)
  );
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
    if (packageRoot && usesCompactDeclarations(packageRoot)) return;
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
  if (packageRoot && usesCompactDeclarations(packageRoot)) return;

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
    const referencedFile = resolveModule(referenced.fileName, normalizedFilePath);
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
  const packageJsonFile = resolvePackageJson(rootPackage);
  if (!packageJsonFile) return null;
  const packageRoot = path.dirname(realPath(packageJsonFile));
  packageRoots.set(rootPackage, packageRoot);
  // Use an ESM containing file so packages that expose declarations through
  // conditional `exports.import` entries (including TanStack Start) resolve
  // exactly as they do in a Theme's Vite/TypeScript build.
  return resolveModule(specifier, path.join(root, "__morph_theme_types__.mts"));
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
  const containingFile = path.join(root, "__morph_theme_types__.mts");

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
  if (/export\s*=/.test(targetContent)) {
    files.set(
      shimPath,
      `import ThemeModule = require("${targetImport}");\nexport = ThemeModule;\n`,
    );
  } else {
    const defaultExport = /export\s+default/.test(targetContent)
      ? `\nexport { default } from "${targetImport}";`
      : "";
    files.set(shimPath, `export * from "${targetImport}";${defaultExport}\n`);
  }
}

const entries = packageNames.filter((packageName) =>
  moduleTargets.has(packageName),
);
const sortedApprovedDependencies = [...approvedDependencies].sort(
  (left, right) => left.localeCompare(right),
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
export const GENERATED_THEME_APPROVED_DEPENDENCIES: readonly string[] = ${JSON.stringify(sortedApprovedDependencies)};
// prettier-ignore
export const GENERATED_THEME_PACKAGE_DECLARATIONS: readonly GeneratedThemePackageDeclaration[] = [
${serializedFiles}
];
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, generatedSource);

const sortedRootDependencies = Object.fromEntries(
  Object.entries(configuredRootDependencies).sort(([left], [right]) =>
    left.localeCompare(right),
  ),
);
const sortedThemeDependencies = Object.fromEntries(
  Object.entries(configuredDependencies).sort(([left], [right]) =>
    left.localeCompare(right),
  ),
);
const sandboxPackageSource = `${JSON.stringify(
  {
    name: "morph-sandbox-toolchain",
    private: true,
    type: "module",
    dependencies: {
      ...sortedRootDependencies,
      wrangler: "4.118.0",
    },
  },
  null,
  2,
)}\n`;
const sandboxDependencySource = `${JSON.stringify(sortedRootDependencies, null, 2)}\n`;
const sandboxDependencyModuleSource = `/* eslint-disable */
// Generated by scripts/generate-theme-package-types.mjs. Do not edit by hand.
// prettier-ignore
export const GENERATED_THEME_DEPENDENCY_VERSIONS = ${JSON.stringify(sortedThemeDependencies, null, 2)} as const;
// prettier-ignore
export const GENERATED_SANDBOX_DEPENDENCY_VERSIONS = ${JSON.stringify(sortedRootDependencies, null, 2)} as const;
`;
fs.writeFileSync(sandboxDependenciesJsonPath, sandboxDependencySource);
fs.writeFileSync(sandboxDependenciesModulePath, sandboxDependencyModuleSource);
fs.writeFileSync(
  path.join(root, "sandbox-toolchain-package.json"),
  sandboxPackageSource,
);
console.log(
  `Generated ${files.size} Monaco declaration files for ${entries.length} approved/installed packages (${Buffer.byteLength(generatedSource)} bytes) and synchronized ${Object.keys(sortedRootDependencies).length} sandbox package roots from cms.config.ts.`,
);
