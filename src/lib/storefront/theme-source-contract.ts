import {
  buildThemeRouteRegistry,
  type ThemeRouteRecord,
} from "./compiler/theme-route-registry";
import {
  deriveThemeDocumentLayoutPath,
  deriveThemeLayoutSections,
  deriveThemeRouteSections,
  type ThemeRouteSection,
} from "./compiler/theme-route-sections";
import { validateThemeStartPackageContract } from "./compiler/theme-start-toolchain";
import { listThemeSectionEntries } from "./theme-section-convention";

/** Bump when the source contract derivation rules change. */
export const THEME_SOURCE_CONTRACT_DERIVATION_VERSION = 1 as const;

export type ThemeSourceContractFile = Readonly<{
  path: string;
  content?: string | null;
  isEntry?: boolean;
}>;

export type ThemeSourceContractSection = Readonly<{
  slotId: string;
  sourcePath: string;
  componentRef: string;
  componentName: string;
  routeSourcePath: string;
  placement?: "before-page" | "after-page";
}>;

export type ThemeSourceContractComponent = Readonly<{
  sourcePath: string;
  componentName: string;
  sectionType: string;
}>;

export type ThemeSourceContract = Readonly<{
  entry: string | null;
  router: Readonly<{
    framework: "tanstack-start";
    previewAdapter: "tanstack-router-client";
    routesDirectory: "src/routes";
    rootRoute: "src/routes/__root.tsx";
    generatedRouteTree: "src/routeTree.gen.ts";
  }> | null;
  documentLayout: Readonly<{ source: string; export: "default" }> | null;
  routes: readonly Readonly<{
    sourcePath: string;
    path: string;
    kind: ThemeRouteRecord["kind"];
  }>[];
  components: readonly ThemeSourceContractComponent[];
  sections: readonly ThemeSourceContractSection[];
}>;

export type ThemeSourceContractDerivation = Readonly<{
  derivationVersion: typeof THEME_SOURCE_CONTRACT_DERIVATION_VERSION;
  contract: ThemeSourceContract;
  complete: boolean;
  diagnostics: readonly string[];
  categories: Readonly<{
    entry: "derived" | "unsupported";
    router: "derived" | "unsupported";
    documentLayout: "derived" | "not-declared" | "unsupported";
    routes: "derived" | "unsupported";
    sections: "derived" | "unsupported";
  }>;
}>;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceFile(
  files: readonly ThemeSourceContractFile[],
  path: string,
): ThemeSourceContractFile | undefined {
  const normalized = normalizePath(path);
  return files.find((file) => normalizePath(file.path) === normalized);
}

function readPackage(files: readonly ThemeSourceContractFile[]): Record<string, unknown> | null {
  const file = sourceFile(files, "package.json");
  if (typeof file?.content !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(file.content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasDependency(
  packageJson: Record<string, unknown> | null,
  name: string,
): boolean {
  const dependencies = isRecord(packageJson?.dependencies)
    ? packageJson.dependencies
    : {};
  const devDependencies = isRecord(packageJson?.devDependencies)
    ? packageJson.devDependencies
    : {};
  return typeof dependencies[name] === "string" || typeof devDependencies[name] === "string";
}

function deriveEntry(files: readonly ThemeSourceContractFile[]): {
  entry: string | null;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const explicit = files
    .filter((file) => file.isEntry)
    .map((file) => normalizePath(file.path));
  if (explicit.length > 1) {
    diagnostics.push(
      `Source declares multiple entry files: ${explicit.join(", ")}.`,
    );
    return { entry: null, diagnostics };
  }
  if (explicit.length === 1) return { entry: explicit[0]!, diagnostics };

  const conventional = [
    "src/routes/index.tsx",
    "src/routes/index.jsx",
    "src/routes/index.ts",
    "src/routes/index.js",
    "src/pages/index.tsx",
    "src/pages/index.jsx",
    "src/pages/index.ts",
    "src/pages/index.js",
  ].filter((path) => sourceFile(files, path));
  if (conventional.length === 1) return { entry: conventional[0]!, diagnostics };
  diagnostics.push(
    conventional.length === 0
      ? "No source entry could be proven from isEntry or the supported route/page convention."
      : `Multiple conventional entry files exist: ${conventional.join(", ")}.`,
  );
  return { entry: null, diagnostics };
}

function deriveRouter(
  files: readonly ThemeSourceContractFile[],
  diagnostics: string[],
): ThemeSourceContract["router"] {
  const hasRouter = Boolean(sourceFile(files, "src/router.tsx"));
  const hasRoot = Boolean(sourceFile(files, "src/routes/__root.tsx"));
  const hasRoutes = files.some((file) =>
    /^src\/routes\/.+\.(?:tsx|jsx|ts|js)$/.test(normalizePath(file.path)),
  );
  const packageJson = readPackage(files);
  const hasTanStack =
    hasDependency(packageJson, "@tanstack/react-router") &&
    hasDependency(packageJson, "@tanstack/react-start");

  if (!hasRouter && !hasRoot && !hasRoutes && !hasTanStack) return null;
  if (!hasRouter || !hasRoot || !hasRoutes || !hasTanStack) {
    diagnostics.push(
      "TanStack Start could not be proven: src/router.tsx, src/routes/__root.tsx, src/routes, and the TanStack Start dependencies must all exist.",
    );
    return null;
  }

  const packageDiagnostics = validateThemeStartPackageContract(
    files.flatMap((file) =>
      typeof file.content === "string"
        ? [{ path: normalizePath(file.path), content: file.content }]
        : [],
    ),
  );
  diagnostics.push(...packageDiagnostics.map((message) => `package.json: ${message}`));
  return {
    framework: "tanstack-start",
    previewAdapter: "tanstack-router-client",
    routesDirectory: "src/routes",
    rootRoute: "src/routes/__root.tsx",
    generatedRouteTree: "src/routeTree.gen.ts",
  };
}

function sectionFromRouteSection(
  section: ThemeRouteSection,
): ThemeSourceContractSection {
  return {
    slotId: section.slotId,
    sourcePath: normalizePath(section.componentSourcePath),
    componentRef: section.componentRef,
    componentName: section.componentName,
    routeSourcePath: normalizePath(section.routeSourcePath),
    ...(section.layoutPlacement
      ? { placement: section.layoutPlacement }
      : {}),
  };
}

function deriveComponents(
  files: readonly ThemeSourceContractFile[],
  sections: readonly ThemeSourceContractSection[],
): ThemeSourceContractComponent[] {
  const components = new Map<string, ThemeSourceContractComponent>();
  for (const entry of listThemeSectionEntries(files)) {
    components.set(entry.componentSourcePath, {
      sourcePath: entry.componentSourcePath,
      componentName: entry.componentName,
      sectionType: entry.sectionType,
    });
  }
  for (const section of sections) {
    const sourcePath = normalizePath(section.sourcePath);
    if (components.has(sourcePath)) continue;
    components.set(sourcePath, {
      sourcePath,
      componentName: section.componentName,
      sectionType: sourcePath
        .slice(sourcePath.lastIndexOf("/") + 1)
        .replace(/\.[^.]+$/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase(),
    });
  }
  return [...components.values()].sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath),
  );
}

function deriveRouteSections(
  files: readonly ThemeSourceContractFile[],
  routes: readonly ThemeRouteRecord[],
  diagnostics: string[],
): ThemeSourceContractSection[] {
  const sections: ThemeSourceContractSection[] = [];
  for (const route of routes) {
    if (route.kind !== "route" || route.isVirtual) continue;
    const result = deriveThemeRouteSections(files, route.sourcePath);
    diagnostics.push(...result.diagnostics);
    sections.push(...result.sections.map(sectionFromRouteSection));
  }
  const layout = deriveThemeLayoutSections(files);
  diagnostics.push(...layout.diagnostics);
  sections.push(...layout.sections.map(sectionFromRouteSection));
  const seen = new Set<string>();
  return sections.filter((section) => {
    const key = `${section.routeSourcePath}:${section.slotId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Derives the source-owned Theme contract without reading morph.theme.json.
 * The manifest is intentionally not an input: callers can compare this result
 * against it as an oracle during migration, but source is the candidate SSOT.
 */
export function deriveThemeSourceContract(
  files: readonly ThemeSourceContractFile[],
): ThemeSourceContractDerivation {
  const diagnostics: string[] = [];
  const entryResult = deriveEntry(files);
  diagnostics.push(...entryResult.diagnostics);
  const router = deriveRouter(files, diagnostics);
  const registry = buildThemeRouteRegistry(
    files.flatMap((file) =>
      typeof file.content === "string"
        ? [{ path: normalizePath(file.path), content: file.content }]
        : [],
    ),
  );
  diagnostics.push(
    ...registry.diagnostics
      .filter((diagnostic) => diagnostic.level === "error")
      .map((diagnostic) => diagnostic.message),
  );
  const routes = registry.routes.map((route) => ({
    sourcePath: normalizePath(route.sourcePath),
    path: route.path,
    kind: route.kind,
  }));
  const sections = deriveRouteSections(files, registry.routes, diagnostics);
  const documentLayoutPath = deriveThemeDocumentLayoutPath(files);
  const hasLayoutDeclaration = files.some((file) =>
    typeof file.content === "string" && file.content.includes("<Outlet"),
  );
  if (hasLayoutDeclaration && !documentLayoutPath) {
    diagnostics.push(
      "A page outlet exists, but no unique source-owned document layout could be proven.",
    );
  }

  const contract: ThemeSourceContract = {
    entry: entryResult.entry,
    router,
    documentLayout: documentLayoutPath
      ? { source: documentLayoutPath, export: "default" }
      : null,
    routes,
    components: deriveComponents(files, sections),
    sections,
  };
  const categories = {
    entry: entryResult.entry ? ("derived" as const) : ("unsupported" as const),
    router: router ? ("derived" as const) : ("unsupported" as const),
    documentLayout: documentLayoutPath
      ? ("derived" as const)
      : hasLayoutDeclaration
        ? ("unsupported" as const)
        : ("not-declared" as const),
    routes: registry.valid ? ("derived" as const) : ("unsupported" as const),
    sections: sections.every((section) => Boolean(section.sourcePath))
      ? ("derived" as const)
      : ("unsupported" as const),
  };
  return {
    derivationVersion: THEME_SOURCE_CONTRACT_DERIVATION_VERSION,
    contract,
    complete: diagnostics.length === 0,
    diagnostics,
    categories,
  };
}
