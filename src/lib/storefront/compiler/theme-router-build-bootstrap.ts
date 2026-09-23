import type { ThemeCompilerFile } from "./theme-compiler.types";
import {
  buildThemeRouteRegistry,
  type ThemeRouteRecord,
} from "./theme-route-registry";
import { deriveThemeSourceRouterFramework } from "../theme-source-runtime-contract";

export type ThemeBuildBootstrap = {
  content: string;
  routeRegistry: ReturnType<typeof buildThemeRouteRegistry> | null;
};

function readRouterFramework(
  files: readonly ThemeCompilerFile[],
): string | null {
  // Source is the primary contract for migrated Themes. The manifest branch
  // below remains as a compatibility fallback for legacy source revisions.
  const sourceFramework = deriveThemeSourceRouterFramework(files);
  if (sourceFramework) return sourceFramework;

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

function routePieceOptionKeys(route: ThemeRouteRecord): string[] {
  const pieces = route.routePieces;
  if (!pieces) return [];
  return [
    pieces.loader ? "loader" : null,
    pieces.component ? "component" : null,
    pieces.errorComponent ? "errorComponent" : null,
    pieces.notFoundComponent ? "notFoundComponent" : null,
    pieces.pendingComponent ? "pendingComponent" : null,
  ].filter((value): value is string => value !== null);
}

function createPreviewRouteHmrSource(args: {
  enabled: boolean;
  registryRoutes: readonly ThemeRouteRecord[];
  childRoutes: readonly ThemeRouteRecord[];
  rootReference: string;
}): string {
  if (!args.enabled) return "";

  const bindings = args.registryRoutes
    .filter((route) => !route.isVirtual)
    .map((route) => {
      const childIndex = args.childRoutes.indexOf(route);
      const currentRoute =
        route.kind === "root" ? args.rootReference : `route${childIndex}`;
      const preserve = [
        ...(route.kind === "route"
          ? ["id", ...(route.isPathless ? [] : ["path"]), "getParentRoute"]
          : []),
        ...routePieceOptionKeys(route),
      ];
      return {
        specifier: `./${route.sourcePath}`,
        currentRoute,
        preserve,
      };
    });

  if (bindings.length === 0) return "";

  return `
// Plain JavaScript on purpose, though the file it lands in is .tsx: nothing
// typechecks this string — the container compiles it with esbuild, which only
// strips types — and without type syntax the block can be lifted out and run
// directly by a test, which is the only thing that checks the handler behaves.
//
// Route modules export a Route object as well as defining React components.
// React Fast Refresh cannot treat that object as a stable component export;
// its normal fallback asks Vite to invalidate over the HMR WebSocket. The
// isolated preview deliberately carries native Vite payloads over HTTP, so
// this generated entry is the route boundary instead. It keeps the iframe,
// router and memory history alive while replacing the authored route options.
const __morphPreviewHotRoutes = [
${bindings
  .map(
    ({ currentRoute, preserve }) =>
      `  { current: ${currentRoute}, preserve: ${JSON.stringify(preserve)} },`,
  )
  .join("\n")}
];
if (import.meta.hot) {
  import.meta.hot.accept(
    ${JSON.stringify(bindings.map(({ specifier }) => specifier))},
    async (modules) => {
      let applied = false;
      for (let index = 0; index < modules.length; index += 1) {
        const nextRoute = modules[index]?.Route;
        const binding = __morphPreviewHotRoutes[index];
        if (!nextRoute?.options || !binding) continue;

        const current = binding.current;
        const preserved = {};
        for (const key of binding.preserve) {
          if (Object.prototype.hasOwnProperty.call(current.options, key)) {
            preserved[key] = current.options[key];
          }
        }
        current.options = { ...nextRoute.options, ...preserved };
        applied = true;
      }
      if (!applied) {
        // A hot update arrived and none of it could be used. The usual cause is
        // an edit that leaves the module valid but no longer exporting \`Route\`
        // — a syntax error would have raised Vite's own overlay instead. Silence
        // here shows the author their previous page as though nothing happened,
        // so it is said out loud in the preview's console.
        console.warn(
          "[morph] a route module was hot-updated but exported no usable Route; the preview is still showing the previous version.",
        );
        return;
      }
      await router.invalidate({ sync: true });
    },
  );
}
`;
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
  /**
   * Hand the router to the preview bridge.
   *
   * The editor changes which page is shown by asking the preview to, and a
   * real Theme owns its own router — so the entry Morph generates is the one
   * place that can pass it along. A build sets this false and the Theme is
   * reachable only through its own links, as a shopper reaches it.
   */
  exposeRouterForPreview?: boolean;
}): ThemeBuildBootstrap {
  const cssImports = args.cssFiles
    .map((css) => `import "./${css.replace(/\\/g, "/")}";`)
    .join("\n");
  const previewSetupImport = args.exposeRouterForPreview
    ? 'import "./src/morph/preview-content";'
    : "";
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
  const previewRouteHmrSource = createPreviewRouteHmrSource({
    enabled: Boolean(args.exposeRouterForPreview),
    registryRoutes: registry.routes,
    childRoutes,
    rootReference,
  });

  return {
    routeRegistry: registry,
    content: `
import React from "react";
import { createRoot } from "react-dom/client";
${previewSetupImport}
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
${previewRouteHmrSource}
${
  args.exposeRouterForPreview ? "window.__morphPreviewRouter = router;\n" : ""
}// A Theme that owns its document shell renders <html>, <head> and <body>
// itself. Mounted inside <div id="root"> that produces <html> nested in a
// <div>: React reports the invalid nesting on every load, and the preview
// stops matching the document the published site serves. Mounting on the
// document is what the shell was written for.
//
// Vite injects the styles imported by the Theme into the head of the page it
// served, and React owns that head once it renders one. They are moved across
// rather than left behind, because losing them would leave an unstyled
// preview of a styled site.
const documentShell = Boolean(
  (${
    hasRootComponentPieces(root) ? "rootRoute" : "rootRouteImport"
  } as { options?: { shellComponent?: unknown } }).options?.shellComponent,
);
if (documentShell) {
  const carried = Array.from(
    document.head.querySelectorAll("style, link[rel='stylesheet']"),
  );
  const root = createRoot(document);
  root.render(React.createElement(RouterProvider, { router }));
  queueMicrotask(() => {
    for (const node of carried) {
      if (!node.isConnected) document.head.appendChild(node);
    }
  });
} else {
  const container = document.getElementById("root");
  if (container) {
    createRoot(container).render(
      React.createElement(RouterProvider, { router }),
    );
  }
}
`,
  };
}
