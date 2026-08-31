import { parse } from "@babel/parser";
import type { ThemeCompilerFile } from "./theme-compiler.types";
import {
  readThemePathAliases,
  resolveThemeBaseUrlImport,
  resolveThemePathAlias,
  type ThemePathAliasConfig,
} from "./theme-path-aliases";

/**
 * Import-boundary checks shared by Code Mode diagnostics and both Theme build
 * runners.  TanStack Start applies these boundaries to the client and server
 * graphs independently; this module performs the same check before source is
 * sent to Vite so an unsafe graph fails early and consistently.
 */
export type ThemeImportProtectionTarget = "client" | "server";

export type ThemeImportProtectionDiagnostic = Readonly<{
  code:
    | "THEME_IMPORT_SERVER_IN_CLIENT"
    | "THEME_IMPORT_CLIENT_IN_SERVER"
    | "THEME_IMPORT_MARKER"
    | "THEME_IMPORT_GRAPH";
  message: string;
  filePath: string;
  line: number;
  column: number;
  importSource: string;
  target: ThemeImportProtectionTarget;
}>;

type ThemeImportEdge = {
  source: string;
  line: number;
  column: number;
};

type ModuleBoundary = "server" | "client" | null;

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];
const SERVER_MARKERS = new Set([
  "server-only",
  "@tanstack/react-start/server-only",
]);
const CLIENT_MARKERS = new Set([
  "client-only",
  "@tanstack/react-start/client-only",
]);

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function dirname(value: string): string {
  const index = value.lastIndexOf("/");
  return index < 0 ? "" : value.slice(0, index);
}

function stripImportQuery(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value;
}

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function moduleBoundary(path: string): ModuleBoundary {
  const normalized = normalizePath(path);
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (/(?:^|\.)server(?:\..+)?$/.test(fileName)) return "server";
  if (/(?:^|\.)client(?:\..+)?$/.test(fileName)) return "client";
  return null;
}

function bareSpecifierBoundary(specifier: string): ModuleBoundary {
  if (
    specifier === "@tanstack/react-start/server" ||
    specifier.startsWith("@tanstack/react-start/server/")
  ) {
    return "server";
  }
  if (
    specifier === "@tanstack/react-start/client" ||
    specifier.startsWith("@tanstack/react-start/client/")
  ) {
    return "client";
  }
  if (SERVER_MARKERS.has(specifier)) return "server";
  if (CLIENT_MARKERS.has(specifier)) return "client";
  return null;
}

function resolveRelativeFile(
  importer: string,
  specifier: string,
  files: ReadonlyMap<string, ThemeCompilerFile>,
): string | null {
  const clean = stripImportQuery(specifier);
  let candidate = clean.startsWith("/")
    ? normalizePath(clean)
    : normalizePath(`${dirname(importer)}/${clean}`);

  const candidates = [candidate];
  if (!SOURCE_EXTENSIONS.some((extension) => candidate.endsWith(extension))) {
    candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${candidate}${extension}`));
  }
  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(`${candidate}/index${extension}`);
  }
  return candidates.find((path) => files.has(path)) ?? null;
}

function collectImportEdges(content: string): {
  edges: ThemeImportEdge[];
  markerBoundaries: Array<{ boundary: Exclude<ModuleBoundary, null>; edge: ThemeImportEdge }>;
} {
  const edges: ThemeImportEdge[] = [];
  const markerBoundaries: Array<{
    boundary: Exclude<ModuleBoundary, null>;
    edge: ThemeImportEdge;
  }> = [];
  let ast: any;
  try {
    ast = parse(content, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "importAttributes", "topLevelAwait"],
      errorRecovery: false,
    });
  } catch {
    // The syntax scanner reports parse errors separately. Do not manufacture
    // import-boundary errors from a partially parsed file.
    return { edges, markerBoundaries };
  }

  const seen = new Set<object>();
  const visit = (node: any): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    let source: unknown;
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      source = node.source?.value;
    } else if (
      node.type === "CallExpression" &&
      node.callee?.type === "Import" &&
      node.arguments?.length === 1
    ) {
      source = node.arguments[0]?.value;
    } else if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments?.length === 1
    ) {
      source = node.arguments[0]?.value;
    }

    if (typeof source === "string") {
      const edge: ThemeImportEdge = {
        source,
        line: Number(node.loc?.start?.line ?? 1),
        column: Number(node.loc?.start?.column ?? 0) + 1,
      };
      edges.push(edge);
      const marker = bareSpecifierBoundary(source);
      if (marker && (SERVER_MARKERS.has(source) || CLIENT_MARKERS.has(source))) {
        markerBoundaries.push({
          boundary: marker,
          edge,
        });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else {
        visit(value);
      }
    }
  };
  visit(ast);
  return { edges, markerBoundaries };
}

function getCalleeRootName(node: any): string | undefined {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "CallExpression") return getCalleeRootName(node.callee);
  if (node?.type === "MemberExpression" && !node.computed) {
    return getCalleeRootName(node.object);
  }
  return undefined;
}

/**
 * Start's compiler removes server/client imports when they are only used by
 * the corresponding isomorphic boundary. Mirror that important exception so
 * the platform starter (`createIsomorphicFn().server(...)`) is not reported as
 * a false positive while a direct component import still fails.
 */
function isSafeBoundaryFunction(
  call: any,
  functionNode: any,
  target: ThemeImportProtectionTarget,
  safeBoundaryNames: ReadonlySet<string>,
): boolean {
  if (!call || call.type !== "CallExpression") return false;
  if (!Array.isArray(call.arguments) || !call.arguments.includes(functionNode)) {
    return false;
  }
  const callee = call.callee;
  if (target === "client" && callee?.type === "Identifier") {
    return callee.name === "createServerOnlyFn" && safeBoundaryNames.has(callee.name);
  }
  if (callee?.type !== "MemberExpression" || callee.computed) return false;
  const property = callee.property?.type === "Identifier" ? callee.property.name : undefined;
  const rootName = getCalleeRootName(callee.object);
  if (target === "client") {
    if (property === "handler") {
      return rootName === "createServerFn" && safeBoundaryNames.has(rootName);
    }
    if (property === "server") {
      return (
        (rootName === "createMiddleware" || rootName === "createIsomorphicFn") &&
        safeBoundaryNames.has(rootName)
      );
    }
    return false;
  }
  return property === "client" && rootName === "createIsomorphicFn";
}

function isIdentifierBinding(node: any, parent: any): boolean {
  if (!parent) return false;
  if (
    (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    parent.property === node &&
    !parent.computed
  ) {
    return true;
  }
  if (
    (parent.type === "ObjectProperty" || parent.type === "ObjectMethod") &&
    parent.key === node &&
    !parent.computed &&
    !parent.shorthand
  ) {
    return true;
  }
  if (parent.type === "ExportSpecifier" && parent.exported === node) return true;
  return false;
}

function packageImportUsesOnlySafeBoundary(
  content: string,
  source: string,
  target: ThemeImportProtectionTarget,
): boolean {
  let ast: any;
  try {
    ast = parse(content, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "importAttributes", "topLevelAwait"],
      errorRecovery: false,
    });
  } catch {
    return false;
  }

  const importedNames = new Set<string>();
  let hasSideEffectImport = false;
  let hasRuntimeImport = false;
  const safeBoundaryNames = new Set<string>();
  for (const statement of ast.program.body ?? []) {
    if (statement.type !== "ImportDeclaration") {
      continue;
    }
    if (statement.source?.value === "@tanstack/react-start" || statement.source?.value === "@tanstack/react-router") {
      for (const specifier of statement.specifiers) {
        const importedName =
          specifier.imported?.name ?? specifier.imported?.value;
        if (
          typeof importedName === "string" &&
          [
            "createServerFn",
            "createMiddleware",
            "createIsomorphicFn",
            "createServerOnlyFn",
          ].includes(importedName) &&
          specifier.local?.name
        ) {
          safeBoundaryNames.add(specifier.local.name);
        }
      }
    }
    if (statement.source?.value !== source) continue;
    if (statement.specifiers.length === 0) {
      hasSideEffectImport = true;
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.importKind === "type") continue;
      hasRuntimeImport = true;
      if (specifier.local?.name) importedNames.add(specifier.local.name);
    }
  }
  if (hasSideEffectImport || !hasRuntimeImport || importedNames.size === 0) {
    return !hasSideEffectImport;
  }

  // A same-named local declaration could make a call look like a Start
  // boundary while it is actually ordinary user code. Reject that entire
  // file as a safe-boundary candidate instead of risking a server leak.
  const declaredNames = new Set<string>();
  const collectDeclaredNames = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "ClassDeclaration") &&
      node.id?.name
    ) {
      declaredNames.add(node.id.name);
    }
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      declaredNames.add(node.id.name);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "ImportDeclaration") continue;
      if (Array.isArray(value)) value.forEach(collectDeclaredNames);
      else collectDeclaredNames(value);
    }
  };
  collectDeclaredNames(ast.program);
  for (const name of declaredNames) safeBoundaryNames.delete(name);

  let hasUsage = false;
  let unsafeUsage = false;
  const seen = new Set<object>();
  const visit = (node: any, parents: any[]): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (node.type === "ImportDeclaration") return;
    if (node.type === "Identifier" && importedNames.has(node.name)) {
      const parent = parents[parents.length - 1];
      if (!isIdentifierBinding(node, parent)) {
        hasUsage = true;
        const inSafeBoundary = parents.some((ancestor, index) => {
          if (!ancestor || !/Function/.test(ancestor.type ?? "")) return false;
          return isSafeBoundaryFunction(
            parents[index - 1],
            ancestor,
            target,
            safeBoundaryNames,
          );
        });
        if (!inSafeBoundary) unsafeUsage = true;
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (Array.isArray(value)) {
        value.forEach((child) => visit(child, [...parents, node]));
      } else {
        visit(value, [...parents, node]);
      }
    }
  };
  visit(ast, []);
  // An unused static import is removed by the bundler and is safe to defer.
  return !hasUsage || !unsafeUsage;
}

function pushDiagnostic(
  diagnostics: ThemeImportProtectionDiagnostic[],
  diagnostic: ThemeImportProtectionDiagnostic,
  seen: Set<string>,
): void {
  const key = [
    diagnostic.target,
    diagnostic.filePath,
    diagnostic.line,
    diagnostic.column,
    diagnostic.importSource,
    diagnostic.code,
  ].join(":");
  if (seen.has(key)) return;
  seen.add(key);
  diagnostics.push(diagnostic);
}

function graphRoots(
  files: ReadonlyMap<string, ThemeCompilerFile>,
  entryPaths: readonly string[] | undefined,
): string[] {
  if (entryPaths && entryPaths.length > 0) {
    return entryPaths
      .map((entry) => normalizePath(entry))
      .map((entry) => {
        if (files.has(entry)) return entry;
        const importer = "";
        return resolveRelativeFile(importer, `/${entry}`, files) ?? entry;
      })
      .filter((entry) => files.has(entry));
  }
  return [...files.keys()].filter(isSourceFile);
}

function validateTargetGraph(
  files: ReadonlyMap<string, ThemeCompilerFile>,
  target: ThemeImportProtectionTarget,
  entryPaths: readonly string[] | undefined,
  pathAliases: ThemePathAliasConfig,
): ThemeImportProtectionDiagnostic[] {
  const diagnostics: ThemeImportProtectionDiagnostic[] = [];
  const seenDiagnostics = new Set<string>();
  const visited = new Set<string>();
  const queue = graphRoots(files, entryPaths);
  const expectedBoundary: ModuleBoundary = target === "client" ? "server" : "client";

  while (queue.length > 0) {
    const filePath = queue.shift()!;
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    const file = files.get(filePath);
    if (!file || !isSourceFile(filePath)) continue;

    const ownBoundary = moduleBoundary(filePath);
    if (ownBoundary === expectedBoundary) {
      pushDiagnostic(
        diagnostics,
        {
          code:
            target === "client"
              ? "THEME_IMPORT_SERVER_IN_CLIENT"
              : "THEME_IMPORT_CLIENT_IN_SERVER",
          message:
            target === "client"
              ? `Server-only module "${filePath}" cannot be included in the client build.`
              : `Client-only module "${filePath}" cannot be included in the server build.`,
          filePath,
          line: 1,
          column: 1,
          importSource: filePath,
          target,
        },
        seenDiagnostics,
      );
    }

    const { edges, markerBoundaries } = collectImportEdges(String(file.content));
    for (const { boundary, edge } of markerBoundaries) {
      if (boundary !== expectedBoundary) continue;
      pushDiagnostic(
        diagnostics,
        {
          code: "THEME_IMPORT_MARKER",
          message:
            target === "client"
              ? `This module is marked server-only and cannot be imported by the client build.`
              : `This module is marked client-only and cannot be imported by the server build.`,
          filePath,
          line: edge.line,
          column: edge.column,
          importSource: edge.source,
          target,
        },
        seenDiagnostics,
      );
    }

    for (const edge of edges) {
      const packageBoundary = bareSpecifierBoundary(edge.source);
      const resolved = edge.source.startsWith(".") || edge.source.startsWith("/")
        ? resolveRelativeFile(filePath, edge.source, files)
        : resolveThemePathAlias(edge.source, files, pathAliases) ??
          resolveThemeBaseUrlImport(edge.source, files, pathAliases);
      const packageBoundaryIsSafe =
        packageBoundary &&
        (edge.source === "@tanstack/react-start/server" ||
          edge.source.startsWith("@tanstack/react-start/server/") ||
          edge.source === "@tanstack/react-start/client" ||
          edge.source.startsWith("@tanstack/react-start/client/"))
          ? packageImportUsesOnlySafeBoundary(String(file.content), edge.source, target)
          : false;
      const importedBoundary =
        packageBoundary && !packageBoundaryIsSafe
          ? packageBoundary
          : resolved
            ? moduleBoundary(resolved)
            : null;

      if (importedBoundary === expectedBoundary) {
        pushDiagnostic(
          diagnostics,
          {
            code:
              target === "client"
                ? "THEME_IMPORT_SERVER_IN_CLIENT"
                : "THEME_IMPORT_CLIENT_IN_SERVER",
            message:
              target === "client"
                ? `Client code cannot import server-only module "${edge.source}".`
                : `Server code cannot import client-only module "${edge.source}".`,
            filePath,
            line: edge.line,
            column: edge.column,
            importSource: edge.source,
            target,
          },
          seenDiagnostics,
        );
      }
      if (resolved) queue.push(resolved);
    }
  }

  return diagnostics;
}

/**
 * Validates the reachable client/server graphs.  Missing relative modules are
 * intentionally left to Vite/TypeScript so this check remains a boundary
 * check rather than a second module resolver.
 */
export function collectThemeImportProtectionDiagnostics(
  files: readonly ThemeCompilerFile[],
  options: {
    target: ThemeImportProtectionTarget;
    entryPaths?: readonly string[];
  },
): ThemeImportProtectionDiagnostic[] {
  const normalized = new Map<string, ThemeCompilerFile>();
  for (const file of files) {
    normalized.set(normalizePath(file.path), file);
  }
  return validateTargetGraph(
    normalized,
    options.target,
    options.entryPaths,
    readThemePathAliases(files),
  );
}

export function collectThemeImportProtectionDiagnosticsForBuild(
  files: readonly ThemeCompilerFile[],
  options: {
    entry: string;
    hasStartRuntime: boolean;
  },
): ThemeImportProtectionDiagnostic[] {
  const clientEntryPaths = options.hasStartRuntime
    ? [
        options.entry,
        "src/router.tsx",
        ...files
          .map((file) => normalizePath(file.path))
          .filter((filePath) => filePath.startsWith("src/routes/")),
      ]
    : [options.entry];
  const diagnostics = collectThemeImportProtectionDiagnostics(files, {
    target: "client",
    entryPaths: clientEntryPaths,
  });
  if (options.hasStartRuntime) {
    diagnostics.push(
      ...collectThemeImportProtectionDiagnostics(files, {
        target: "server",
        entryPaths: [
          "src/router.tsx",
          "src/start.ts",
          "src/start.tsx",
          "src/start.js",
          "src/start.jsx",
          "src/server.ts",
          "src/server.tsx",
          "src/server.js",
          "src/server.jsx",
          ...files
            .map((file) => normalizePath(file.path))
            .filter((filePath) => filePath.startsWith("src/routes/")),
        ],
      }),
    );
  }
  return diagnostics;
}
