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

function routePieceImportPath(path: string): string {
  return `./${path.replace(/\\/g, "/").replace(/\.[cm]?[jt]sx?$/, "")}`;
}

function hasRootComponentPieces(route: ThemeRouteRecord): boolean {
  return Boolean(
    route.routePieces?.component ||
    route.routePieces?.errorComponent ||
    route.routePieces?.notFoundComponent ||
    route.routePieces?.pendingComponent,
  );
}

function routePieceUpdates(
  route: ThemeRouteRecord,
  options: { includeLoader?: boolean; includeLazy?: boolean } = {},
): string {
  const pieces = route.routePieces;
  if (!pieces) return "";
  const includeLoader = options.includeLoader ?? true;
  const includeLazy = options.includeLazy ?? true;
  const updates: string[] = [];
  if (includeLoader && pieces.loader) {
    updates.push(
      `.updateLoader({ loader: lazyFn(() => import(${JSON.stringify(
        routePieceImportPath(pieces.loader),
      )}), "loader") })`,
    );
  }
  const componentPieces = [
    ["component", pieces.component],
    ["errorComponent", pieces.errorComponent],
    ["notFoundComponent", pieces.notFoundComponent],
    ["pendingComponent", pieces.pendingComponent],
  ] as const;
  const componentUpdates = componentPieces
    .map(([name, path]) =>
      path
        ? `${name}: lazyRouteComponent(() => import(${JSON.stringify(
            routePieceImportPath(path),
          )}), "${name}")`
        : null,
    )
    .filter((value): value is string => value !== null);
  if (componentUpdates.length > 0) {
    updates.push(`.update({ ${componentUpdates.join(", ")} })`);
  }
  if (includeLazy && pieces.lazy) {
    updates.push(
      `.lazy(() => import(${JSON.stringify(
        routePieceImportPath(pieces.lazy),
      )}).then((module) => module.Route))`,
    );
  }
  return updates.join("");
}

function routeParentIndex(
  route: ThemeRouteRecord,
  routes: readonly ThemeRouteRecord[],
): number | null {
  if (route.parentSourcePath !== undefined) {
    if (!route.parentSourcePath) return null;
    const explicitIndex = routes.findIndex(
      (candidate) => candidate.sourcePath === route.parentSourcePath,
    );
    return explicitIndex >= 0 ? explicitIndex : null;
  }
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
    .map((route, registryIndex) => ({ route, registryIndex }))
    .filter(({ route }) => !route.isVirtual)
    .map(
      ({ route, registryIndex }) =>
        `import { Route as ${routeImportName(route, registryIndex)} } from "./${route.sourcePath}";`,
    )
    .join("\n");
  const hasVirtualRoute = childRoutes.some((route) => route.isVirtual);
  const hasLoaderPieces = registry.routes.some(
    (route) => route.routePieces?.loader,
  );
  const hasComponentPieces = registry.routes.some((route) =>
    Boolean(
      route.routePieces?.component ||
      route.routePieces?.errorComponent ||
      route.routePieces?.notFoundComponent ||
      route.routePieces?.pendingComponent,
    ),
  );
  const routeRuntimeImports = [
    hasVirtualRoute ? "  createFileRoute," : "",
    hasLoaderPieces ? "  lazyFn," : "",
    hasComponentPieces ? "  lazyRouteComponent," : "",
  ]
    .filter(Boolean)
    .join("\n");
  const childRouteRegistryIndexes = childRoutes.map((route) =>
    registry.routes.indexOf(route),
  );
  const parentIndexes = childRoutes.map((route) =>
    routeParentIndex(route, childRoutes),
  );
  const relativeRouteId = (
    route: ThemeRouteRecord,
    parentIndex: number | null,
  ): string => {
    const routeId = route.routeId ?? route.path;
    if (parentIndex === null) return routeId;
    const parentId =
      childRoutes[parentIndex].routeId ?? childRoutes[parentIndex].path;
    if (
      route.isIndex &&
      route.path.replace(/\/$/, "") ===
        childRoutes[parentIndex].path.replace(/\/$/, "")
    ) {
      return "/";
    }
    const normalizedParent = parentId.replace(/\/$/, "");
    if (!normalizedParent || normalizedParent === "/") return routeId;
    return routeId.startsWith(`${normalizedParent}/`)
      ? routeId.slice(normalizedParent.length) || "/"
      : routeId;
  };
  const rootHasComponentPieces = hasRootComponentPieces(root);
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
      const relativeId = relativeRouteId(route, parentIndex);
      const pathProperty = route.isPathless
        ? ""
        : `\n  path: ${JSON.stringify(relativePath)},`;
      const routeExpression = route.isVirtual
        ? `createFileRoute(${JSON.stringify(route.routeId ?? route.path)})({}).update({
  id: ${JSON.stringify(relativeId)},${pathProperty}
  getParentRoute: () => ${parentIndex === null ? (rootHasComponentPieces ? "rootRoute" : "rootRouteImport") : `route${parentIndex}`},
})`
        : `${routeImportName(route, registryIndex)}.update({
  id: ${JSON.stringify(relativeId)},${pathProperty}
  getParentRoute: () => ${parentIndex === null ? (rootHasComponentPieces ? "rootRoute" : "rootRouteImport") : `route${parentIndex}`},
})`;
      return `const route${index} = ${routeExpression}${routePieceUpdates(route)};`;
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
  const rootReference = hasRootComponentPieces(root)
    ? "rootRoute"
    : "rootRouteImport";
  const rootRouteDeclaration = hasRootComponentPieces(root)
    ? `const rootRoute = rootRouteImport${routePieceUpdates(root, {
        includeLoader: false,
        includeLazy: false,
      })};`
    : "";

  return {
    routeRegistry: registry,
    content: `
import React from "react";
import { createRoot } from "react-dom/client";
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
${routeRuntimeImports}
} from "@tanstack/react-router";
${cssImports}
${routeImports}

${rootRouteDeclaration}
${updatedRoutes}
const routeTree = ${rootReference}.addChildren([${children}]);
// The preview is served from a capability-scoped URL
// (/preview-build/<buildId>/<token>/...), so browser history would ask the
// router to match that path and every Theme route would miss. The token also
// changes per session while this bundle is immutable, which rules out a
// basepath. Memory history lets the Theme resolve its own routes from "/".
const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
const container = document.getElementById("root");
if (container) {
  createRoot(container).render(React.createElement(RouterProvider, { router }));
}
`,
  };
}
