// Match Start's conventional entry resolver order. Keep the import-protection
// server roots in sync so every executable entry is checked before Vite runs.
export const THEME_START_SERVER_ENTRY_PATHS = [
  "src/server.ts",
  "src/server.js",
  "src/server.mts",
  "src/server.mjs",
  "src/server.tsx",
  "src/server.jsx",
] as const;

export function resolveThemeStartServerEntry(
  files: readonly { path: string }[],
): string {
  const paths = new Set(files.map((file) => file.path.replace(/\\/g, "/")));
  const entry = THEME_START_SERVER_ENTRY_PATHS.find((path) => paths.has(path));
  return entry ? `./${entry}` : "@tanstack/react-start/server-entry";
}

export const THEME_START_TOOLCHAIN = {
  react: "19.2.1",
  reactDom: "19.2.1",
  reactRouter: "1.170.18",
  reactStart: "1.168.32",
  routerPlugin: "1.168.23",
  vite: "7.3.5",
  viteReact: "5.2.0",
  tailwind: "4.1.17",
  tailwindVite: "4.1.17",
  cloudflareVite: "1.62.4",
} as const;

export const THEME_START_RUNTIME_DEPENDENCIES: Readonly<
  Record<string, string>
> = {
  react: THEME_START_TOOLCHAIN.react,
  "react-dom": THEME_START_TOOLCHAIN.reactDom,
  "@tanstack/react-router": THEME_START_TOOLCHAIN.reactRouter,
  "@tanstack/react-start": THEME_START_TOOLCHAIN.reactStart,
};

export const THEME_START_BUILD_DEPENDENCIES: Readonly<Record<string, string>> =
  {
    "@tanstack/router-plugin": THEME_START_TOOLCHAIN.routerPlugin,
    "@cloudflare/vite-plugin": THEME_START_TOOLCHAIN.cloudflareVite,
    "@vitejs/plugin-react": THEME_START_TOOLCHAIN.viteReact,
    "@tailwindcss/vite": THEME_START_TOOLCHAIN.tailwindVite,
    tailwindcss: THEME_START_TOOLCHAIN.tailwind,
    vite: THEME_START_TOOLCHAIN.vite,
  };

const PLATFORM_OWNED_THEME_BUILD_PATHS = new Set([
  "__entry.tsx",
  // The Start Live Preview's Worker entry and page module; see
  // theme-preview-start-runtime.ts, whose constants name the same paths.
  "__morph_preview_worker.ts",
  "__morph_preview_client.ts",
  "src/routeTree.gen.ts",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "wrangler.json",
  "wrangler.jsonc",
]);

/**
 * Whether a Morph-built workspace holds the platform's own version of this
 * path (or the build generates it). The Theme's copy, if it has one, never
 * reaches that workspace. Authoring is a separate question: see
 * `isThemeSourceOnlyPath`.
 */
export function isPlatformOwnedThemeBuildPath(path: string): boolean {
  return PLATFORM_OWNED_THEME_BUILD_PATHS.has(path.replace(/\\/g, "/"));
}

/**
 * A native TanStack Start project's own build configuration. An imported
 * project keeps these unchanged (docs/start-native-import-plan.md); Morph's
 * builds do not use them yet.
 */
const THEME_START_CONFIG_PATHS = new Set([
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "wrangler.json",
  "wrangler.jsonc",
]);

export function isThemeStartConfigPath(path: string): boolean {
  return THEME_START_CONFIG_PATHS.has(path.replace(/\\/g, "/"));
}

/**
 * Kept in Theme source, but never written into a Morph-built workspace: the
 * project's own build configuration, and the route tree Start regenerates
 * (official projects commit it). An author may create, import and save
 * these; the workspace keeps using the platform's version.
 */
export function isThemeSourceOnlyPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return (
    isThemeStartConfigPath(normalized) || normalized === "src/routeTree.gen.ts"
  );
}

/** Platform files an author cannot create, rename to, or import. */
export function isThemeAuthoringRefusedPath(path: string): boolean {
  return isPlatformOwnedThemeBuildPath(path) && !isThemeSourceOnlyPath(path);
}

type ThemeStartContractFile = {
  path: string;
  content: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the authored package contract for a TanStack Start Theme without
 * installing or executing customer dependencies. The isolated build runner
 * still owns the executable toolchain; package.json is the portable Theme
 * declaration shown to customers and AI authoring.
 */
export function validateThemeStartPackageContract(
  files: readonly ThemeStartContractFile[],
): string[] {
  const packageFile = files.find(
    (file) => file.path.replace(/\\/g, "/") === "package.json",
  );
  if (!packageFile) {
    return ["TanStack Start Theme requires package.json."];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(packageFile.content);
  } catch {
    return ["TanStack Start Theme package.json must contain valid JSON."];
  }
  if (!isRecord(parsed)) {
    return ["TanStack Start Theme package.json must be a JSON object."];
  }

  const dependencies = isRecord(parsed.dependencies) ? parsed.dependencies : {};
  const devDependencies = isRecord(parsed.devDependencies)
    ? parsed.devDependencies
    : {};
  const diagnostics: string[] = [];

  for (const [name, expectedVersion] of Object.entries(
    THEME_START_RUNTIME_DEPENDENCIES,
  )) {
    if (dependencies[name] !== expectedVersion) {
      diagnostics.push(
        `package.json dependencies.${name} must equal the supported version ${expectedVersion}.`,
      );
    }
  }
  for (const [name, expectedVersion] of Object.entries(
    THEME_START_BUILD_DEPENDENCIES,
  )) {
    if (devDependencies[name] !== expectedVersion) {
      diagnostics.push(
        `package.json devDependencies.${name} must equal the supported version ${expectedVersion}.`,
      );
    }
  }

  return diagnostics;
}
