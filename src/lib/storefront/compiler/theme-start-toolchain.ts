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
  cloudflareVite: "1.50.0",
} as const;

export const THEME_START_RUNTIME_DEPENDENCIES: Readonly<
  Record<string, string>
> = {
  react: THEME_START_TOOLCHAIN.react,
  "react-dom": THEME_START_TOOLCHAIN.reactDom,
  "@tanstack/react-router": THEME_START_TOOLCHAIN.reactRouter,
  "@tanstack/react-start": THEME_START_TOOLCHAIN.reactStart,
};

export const THEME_START_BUILD_DEPENDENCIES: Readonly<
  Record<string, string>
> = {
  "@tanstack/router-plugin": THEME_START_TOOLCHAIN.routerPlugin,
  "@cloudflare/vite-plugin": THEME_START_TOOLCHAIN.cloudflareVite,
  "@vitejs/plugin-react": THEME_START_TOOLCHAIN.viteReact,
  "@tailwindcss/vite": THEME_START_TOOLCHAIN.tailwindVite,
  tailwindcss: THEME_START_TOOLCHAIN.tailwind,
  vite: THEME_START_TOOLCHAIN.vite,
};

const PLATFORM_OWNED_THEME_BUILD_PATHS = new Set([
  "__entry.tsx",
  "src/routeTree.gen.ts",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "wrangler.json",
  "wrangler.jsonc",
]);

export function isPlatformOwnedThemeBuildPath(path: string): boolean {
  return PLATFORM_OWNED_THEME_BUILD_PATHS.has(path.replace(/\\/g, "/"));
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
