import type { ReactNode } from "react";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  MAX_THEME_CONTENT_SLOTS,
  isValidThemeContentSlotId,
  type ThemeContentSlotValues,
} from "@/lib/storefront/theme-content-slots";
import {
  renderSafeThemeComponent,
  type SafeThemeBuiltinComponentMap,
  type SafeThemeComponentResolver,
  type SafeThemeComponentRenderResult,
} from "./safe-theme-component-renderer";

type ThemeSourceFile = {
  path: string;
  content: string;
};

const TANSTACK_ROUTER_MODULE = "@tanstack/react-router";

function normalizeSourcePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function readComponentSources(
  files: readonly ThemeSourceFile[],
): Map<string, string> {
  const manifest = files.find((file) => file.path === "morph.theme.json");
  if (!manifest) return new Map();
  try {
    const parsed: unknown = JSON.parse(manifest.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }
    const components = (parsed as Record<string, unknown>).components;
    if (!components || typeof components !== "object" || Array.isArray(components)) {
      return new Map();
    }
    return new Map(
      Object.entries(components).flatMap(([componentRef, value]) => {
        const source =
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>).source
            : null;
        return typeof source === "string"
          ? [[componentRef, normalizeSourcePath(source)] as const]
          : [];
      }),
    );
  } catch {
    return new Map();
  }
}

function createDocumentComponentResolver(args: {
  files: readonly ThemeSourceFile[];
  document: StorefrontPageDocument;
}): SafeThemeComponentResolver {
  const componentSources = readComponentSources(args.files);
  const remaining = args.document.sections.map((section) => ({
    section,
    sourcePath: componentSources.get(
      section.componentRef ?? `${section.type}.default`,
    ),
    used: false,
  }));

  return ({ sourcePath }) => {
    const normalized = normalizeSourcePath(sourcePath);
    const match = remaining.find(
      (candidate) => !candidate.used && candidate.sourcePath === normalized,
    );
    if (!match) return null;
    match.used = true;
    const { section } = match;
    return {
      render: section.enabled !== false,
      props: (section.props ?? {}) as Record<string, unknown>,
      section: {
        sectionId: section.id,
        sectionType: section.type,
        componentRef:
          section.componentRef ?? `${section.type}.default`,
      },
    };
  };
}

/**
 * Content values keyed by slot, built from the published Page Document.
 *
 * A Document section's id is the slot id, so a route that declares
 * `content("starter-hero")` reads exactly that section's props. No registration
 * step and no ordering heuristic sits between the two.
 */
function readContentSlots(
  document: StorefrontPageDocument,
): ThemeContentSlotValues {
  const slots: Record<string, Record<string, unknown>> = {};
  let count = 0;
  for (const section of document.sections ?? []) {
    if (count >= MAX_THEME_CONTENT_SLOTS) break;
    if (!isValidThemeContentSlotId(section.id)) continue;
    if (section.enabled === false) continue;
    slots[section.id] = (section.props ?? {}) as Record<string, unknown>;
    count += 1;
  }
  return slots;
}

function routeMatchesPath(routePath: string, pathname: string): boolean {
  const routeSegments = routePath.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (routeSegments.length !== pathSegments.length) return false;
  return routeSegments.every(
    (segment, index) => segment.startsWith("$") || segment === pathSegments[index],
  );
}

function routeDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function parentRoutePath(path: string, candidates: readonly string[]): string | null {
  const normalized = path.replace(/\/$/, "");
  return (
    candidates
      .filter((candidate) => {
        const candidatePath = candidate.replace(/\/$/, "");
        return (
          candidatePath !== normalized &&
          candidatePath !== "" &&
          normalized.startsWith(`${candidatePath}/`)
        );
      })
      .sort((left, right) => right.length - left.length)[0] ?? null
  );
}

function routeFailure(message: string): SafeThemeComponentRenderResult {
  return { success: false, node: null, diagnostics: [message] };
}

/**
 * Executes the authored route component tree with the same route source files
 * used by the Theme build. External capabilities are explicit bounded
 * components; customer code is never evaluated with JavaScript eval.
 */
export function renderSafeThemeRoute(args: {
  files: ThemeSourceFile[];
  pathname: string;
  document: StorefrontPageDocument;
  runtimeProps?: Record<string, unknown>;
}): SafeThemeComponentRenderResult {
  const registry = buildThemeRouteRegistry(args.files);
  if (!registry.valid) {
    return routeFailure(
      registry.diagnostics
        .filter((diagnostic) => diagnostic.level === "error")
        .map((diagnostic) => diagnostic.message)
        .join("; "),
    );
  }

  const root = registry.routes.find((route) => route.kind === "root");
  const matched = registry.routes
    .filter(
      (route) =>
        route.kind === "route" && routeMatchesPath(route.path, args.pathname),
    )
    .sort((left, right) => routeDepth(right.path) - routeDepth(left.path))[0];
  if (!root || !matched) {
    return routeFailure(
      `No stored Theme route matches Design pathname "${args.pathname}".`,
    );
  }

  const routePaths = registry.routes
    .filter((route) => route.kind === "route")
    .map((route) => route.path);
  const chain = [matched];
  const resolveComponent = createDocumentComponentResolver({
    files: args.files,
    document: args.document,
  });
  const contentSlots = readContentSlots(args.document);
  let parentPath = parentRoutePath(matched.path, routePaths);
  while (parentPath) {
    const parent = registry.routes.find(
      (route) => route.kind === "route" && route.path === parentPath,
    );
    if (!parent) break;
    chain.push(parent);
    parentPath = parentRoutePath(parent.path, routePaths);
  }

  let outlet: ReactNode = null;
  for (const route of chain) {
    if (!route.componentName) {
      return routeFailure(
        `Route module "${route.sourcePath}" must declare a named component for the safe Design preview.`,
      );
    }
    const builtins: SafeThemeBuiltinComponentMap = {
      [TANSTACK_ROUTER_MODULE]: {
        Outlet: () => outlet,
      },
    };
    const rendered = renderSafeThemeComponent({
      files: args.files,
      sourcePath: route.sourcePath,
      componentName: route.componentName,
      props: {},
      builtinComponents: builtins,
      injectedProps: args.runtimeProps,
      resolveComponent,
      contentSlots,
    });
    if (!rendered.success) return rendered;
    outlet = rendered.node;
  }

  if (!root.componentName) {
    return routeFailure(
      `Root route module "${root.sourcePath}" must declare a named component for the safe Design preview.`,
    );
  }
  return renderSafeThemeComponent({
    files: args.files,
    sourcePath: root.sourcePath,
    componentName: root.componentName,
    props: {},
    builtinComponents: {
      [TANSTACK_ROUTER_MODULE]: {
        Outlet: () => outlet,
        HeadContent: () => null,
        Scripts: () => null,
      },
    },
    injectedProps: args.runtimeProps,
    resolveComponent,
    contentSlots,
  });
}
