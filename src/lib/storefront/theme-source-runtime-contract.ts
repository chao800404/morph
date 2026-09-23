/**
 * Small, dependency-free source contract used by the preview/build bootstrap.
 *
 * This intentionally does not parse JSX or read morph.theme.json. It only
 * proves the minimum runtime facts from the authored workspace. The full
 * source contract derivation remains in theme-source-contract.ts for audits;
 * keeping this helper small prevents the client preview path from importing
 * the audit-only AST machinery.
 */

export type ThemeRuntimeContractFile = Readonly<{
  path: string;
  content?: string | null;
  isEntry?: boolean;
}>;

export type ThemeSourceRuntimeContract = Readonly<{
  entry: string | null;
  routerFramework: "tanstack-start" | null;
}>;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function hasPath(
  files: readonly ThemeRuntimeContractFile[],
  path: string,
): boolean {
  const normalized = normalizePath(path);
  return files.some((file) => normalizePath(file.path) === normalized);
}

function readPackage(
  files: readonly ThemeRuntimeContractFile[],
): Record<string, unknown> | null {
  const packageFile = files.find(
    (file) => normalizePath(file.path) === "package.json",
  );
  if (typeof packageFile?.content !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(packageFile.content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasDependency(
  packageJson: Record<string, unknown> | null,
  name: string,
): boolean {
  const dependencyGroups = ["dependencies", "devDependencies"];
  return dependencyGroups.some((group) => {
    const dependencies = packageJson?.[group];
    return (
      dependencies !== null &&
      typeof dependencies === "object" &&
      !Array.isArray(dependencies) &&
      typeof (dependencies as Record<string, unknown>)[name] === "string"
    );
  });
}

/** Derives an entry only from an explicit source marker or supported convention. */
export function deriveThemeSourceEntry(
  files: readonly ThemeRuntimeContractFile[],
): string | null {
  const explicit = files
    .filter((file) => file.isEntry)
    .map((file) => normalizePath(file.path));
  if (explicit.length === 1) return explicit[0]!;
  if (explicit.length > 1) return null;

  const conventional = [
    "src/routes/index.tsx",
    "src/routes/index.jsx",
    "src/routes/index.ts",
    "src/routes/index.js",
    "src/pages/index.tsx",
    "src/pages/index.jsx",
    "src/pages/index.ts",
    "src/pages/index.js",
  ].filter((path) => hasPath(files, path));
  return conventional.length === 1 ? conventional[0]! : null;
}

/**
 * Proves the source has the minimum TanStack Start shape.
 *
 * A partial route-looking workspace is deliberately not treated as a router:
 * the caller can then use its normal diagnostic/fallback instead of booting a
 * half-configured runtime.
 */
export function deriveThemeSourceRouterFramework(
  files: readonly ThemeRuntimeContractFile[],
): "tanstack-start" | null {
  const hasRouteFile = files.some((file) => {
    const path = normalizePath(file.path);
    return /^src\/routes\/.+\.(?:tsx|jsx|ts|js)$/.test(path);
  });
  const packageJson = readPackage(files);
  return hasPath(files, "src/router.tsx") &&
    hasPath(files, "src/routes/__root.tsx") &&
    hasRouteFile &&
    hasDependency(packageJson, "@tanstack/react-router") &&
    hasDependency(packageJson, "@tanstack/react-start")
    ? "tanstack-start"
    : null;
}

export function deriveThemeSourceRuntimeContract(
  files: readonly ThemeRuntimeContractFile[],
): ThemeSourceRuntimeContract {
  return {
    entry: deriveThemeSourceEntry(files),
    routerFramework: deriveThemeSourceRouterFramework(files),
  };
}
