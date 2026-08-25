import type { ThemeCompilerFile } from "./theme-compiler.types";
import {
  buildThemeRouteRegistry,
  type ThemeRouteRecord,
} from "./theme-route-registry";

export type ThemeBuildBootstrap = {
  content: string;
  routeRegistry: ReturnType<typeof buildThemeRouteRegistry> | null;
};

function readRouterFramework(
  files: readonly ThemeCompilerFile[],
): string | null {
  const manifest = files.find((file) => file.path === "morph.theme.json");
  if (!manifest) return null;
  try {
    const parsed: unknown = JSON.parse(manifest.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const router = (parsed as Record<string, unknown>).router;
    if (!router || typeof router !== "object" || Array.isArray(router)) {
      return null;
    }
    const framework = (router as Record<string, unknown>).framework;
    return typeof framework === "string" ? framework : null;
  } catch {
    return null;
  }
}

function routeImportName(route: ThemeRouteRecord, index: number): string {
  return route.kind === "root" ? "rootRouteImport" : `route${index}Import`;
}

function routeParentIndex(
  route: ThemeRouteRecord,
  routes: readonly ThemeRouteRecord[],
): number | null {
  let bestIndex: number | null = null;
  let bestLength = -1;
  routes.forEach((candidate, index) => {
    if (candidate === route || candidate.kind !== "route") return;
    const candidatePath = candidate.path.replace(/\/$/, "");
    if (
      candidatePath === "" ||
      !(
        route.path === `${candidatePath}/` ||
        route.path.startsWith(`${candidatePath}/`)
      )
    ) {
      return;
    }
    if (candidatePath.length > bestLength) {
      bestIndex = index;
      bestLength = candidatePath.length;
    }
  });
  return bestIndex;
}

/**
 * Creates the isolated client-preview bootstrap for a Theme build. TanStack
 * route modules stay as the authored SSOT; the generated route tree exists
 * only in the temporary build workspace and never becomes an authored file.
 */
export function createThemeBuildBootstrap(args: {
  files: readonly ThemeCompilerFile[];
  entry: string;
  cssFiles: readonly string[];
}): ThemeBuildBootstrap {
  const cssImports = args.cssFiles
    .map((css) => `import "./${css.replace(/\\/g, "/")}";`)
    .join("\n");
  const framework = readRouterFramework(args.files);

  if (framework !== "tanstack-start") {
    const normalizedEntry = args.entry.replace(/\\/g, "/");
    return {
      routeRegistry: null,
      content: `
import React from "react";
import { createRoot } from "react-dom/client";
${cssImports}
import EntryComponent from "./${normalizedEntry}";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(React.createElement(EntryComponent));
}
`,
    };
  }

  const registry = buildThemeRouteRegistry(args.files);
  if (!registry.valid) {
    throw new Error(
      `INVALID_THEME_ROUTES: ${registry.diagnostics
        .filter((diagnostic) => diagnostic.level === "error")
        .map((diagnostic) => diagnostic.message)
        .join("; ")}`,
    );
  }

  const root = registry.routes.find((route) => route.kind === "root");
  if (!root) {
    throw new Error(
      "INVALID_THEME_ROUTES: Customer Theme requires a root route.",
    );
  }
  const childRoutes = registry.routes.filter((route) => route.kind === "route");
  const routeImports = registry.routes
    .map(
      (route, index) =>
        `import { Route as ${routeImportName(route, index)} } from "./${route.sourcePath}";`,
    )
    .join("\n");
  const childRouteRegistryIndexes = childRoutes.map((route) =>
    registry.routes.indexOf(route),
  );
  const parentIndexes = childRoutes.map((route) =>
    routeParentIndex(route, childRoutes),
  );
  const updatedRoutes = childRoutes
    .map((route, index) => {
      const registryIndex = childRouteRegistryIndexes[index];
      const parentIndex = parentIndexes[index];
      const parentPath =
        parentIndex === null
          ? null
          : childRoutes[parentIndex].path.replace(/\/$/, "");
      const relativePath = parentPath
        ? route.path.slice(parentPath.length) || "/"
        : route.path;
      return `const route${index} = ${routeImportName(route, registryIndex)}.update({
  id: ${JSON.stringify(relativePath)},
  path: ${JSON.stringify(relativePath)},
  getParentRoute: () => ${parentIndex === null ? "rootRouteImport" : `route${parentIndex}`},
});`;
    })
    .join("\n");
  const childrenByParent = new Map<number | null, number[]>();
  parentIndexes.forEach((parentIndex, index) => {
    const children = childrenByParent.get(parentIndex) ?? [];
    children.push(index);
    childrenByParent.set(parentIndex, children);
  });
  const renderRouteTree = (index: number): string => {
    const children = childrenByParent.get(index) ?? [];
    return children.length === 0
      ? `route${index}`
      : `route${index}.addChildren([${children.map(renderRouteTree).join(", ")}])`;
  };
  const children = (childrenByParent.get(null) ?? [])
    .map(renderRouteTree)
    .join(", ");

  return {
    routeRegistry: registry,
    content: `
import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
${cssImports}
${routeImports}

${updatedRoutes}
const routeTree = rootRouteImport.addChildren([${children}]);
const router = createRouter({ routeTree });
const container = document.getElementById("root");
if (container) {
  createRoot(container).render(React.createElement(RouterProvider, { router }));
}
`,
  };
}
