import { type ReactNode } from "react";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  deriveThemeRouteSections,
  mergeDocumentWithRouteSections,
} from "@/lib/storefront/compiler/theme-route-sections";
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
import {
  TANSTACK_ROUTER_MODULE,
  renderThemeRouterLink,
} from "./safe-theme-router-link";
import { resolveThemeLinksInSlotValues } from "@/lib/storefront/theme-link";
import { resolveThemeMediaInSlotValues } from "@/lib/storefront/theme-media";

type ThemeSourceFile = {
  path: string;
  content: string;
};

function createRouterBuiltins(outlet: ReactNode): SafeThemeBuiltinComponentMap {
  return {
    [TANSTACK_ROUTER_MODULE]: {
      Link: renderThemeRouterLink,
      Outlet: () => outlet,
    },
  };
}

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
    if (
      !components ||
      typeof components !== "object" ||
      Array.isArray(components)
    ) {
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
      props: resolveThemeMediaInSlotValues(
        resolveThemeLinksInSlotValues(
          (section.props ?? {}) as Record<string, unknown>,
        ),
      ),
      section: {
        sectionId: section.id,
        sectionType: section.type,
        componentRef: section.componentRef ?? `${section.type}.default`,
      },
    };
  };
}

/**
 * Declared type of each stored section, keyed by its slot id.
 *
 * Read alongside the values because a component identified by its slot needs a
 * section type too, and only the Document knows it.
 */
function readSectionTypesBySlot(
  document: StorefrontPageDocument,
): Record<string, string> {
  const types: Record<string, string> = {};
  for (const section of document.sections ?? []) {
    if (typeof section?.id === "string" && typeof section.type === "string") {
      types[section.id] = section.type;
    }
  }
  return types;
}

function readComponentRefsBySlot(
  document: StorefrontPageDocument,
): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const section of document.sections ?? []) {
    if (typeof section?.id !== "string") continue;
    refs[section.id] = section.componentRef ?? `${section.type}.default`;
  }
  return refs;
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
    // Resolved the same way the published content response resolves them, so a
    // link behaves identically in the preview and on the built site.
    slots[section.id] = resolveThemeMediaInSlotValues(
      resolveThemeLinksInSlotValues(
        (section.props ?? {}) as Record<string, unknown>,
      ),
    );
    count += 1;
  }
  return slots;
}

function routeMatchesPath(
  routePath: string,
  pathname: string,
  options?: { splat?: boolean },
): boolean {
  const routeSegments = routePath.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (options?.splat) {
    if (pathSegments.length < routeSegments.length - 1) return false;
  } else if (routeSegments.length !== pathSegments.length) {
    return false;
  }
  return routeSegments.every((segment, index) => {
    if (segment === "$") return true;
    return segment.startsWith("$") || segment === pathSegments[index];
  });
}

function routeDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
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
  loaderData?: Record<string, unknown>;
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
        route.kind === "route" &&
        !route.isPathless &&
        routeMatchesPath(route.path, args.pathname, { splat: route.isSplat }),
    )
    .sort((left, right) => {
      const depthDifference = routeDepth(right.path) - routeDepth(left.path);
      if (depthDifference !== 0) return depthDifference;
      if (left.isSplat !== right.isSplat) return left.isSplat ? 1 : -1;
      if (left.dynamic !== right.dynamic) return left.dynamic ? 1 : -1;
      return left.sourcePath.localeCompare(right.sourcePath);
    })[0];
  if (!root || !matched) {
    return routeFailure(
      `No stored Theme route matches Design pathname "${args.pathname}".`,
    );
  }

  const chain = [matched];
  const routeSections = deriveThemeRouteSections(
    args.files,
    matched.sourcePath,
  );
  if (routeSections.diagnostics.length > 0) {
    return routeFailure(routeSections.diagnostics.join("; "));
  }
  const routeDocument = mergeDocumentWithRouteSections(
    args.document,
    routeSections.sections,
    { routeOwnsStructure: routeSections.hasContentImport },
  );
  const resolveComponent = createDocumentComponentResolver({
    files: args.files,
    document: routeDocument,
  });
  const contentSlots = readContentSlots(routeDocument);
  const sectionTypeBySlot = readSectionTypesBySlot(routeDocument);
  const componentRefBySlot = readComponentRefsBySlot(routeDocument);
  let parentSourcePath = matched.parentSourcePath ?? null;
  while (parentSourcePath) {
    const parent = registry.routes.find(
      (route) => route.sourcePath === parentSourcePath,
    );
    // The root shell is rendered once after the route/layout chain below. Do
    // not add it to the chain or the Design preview would duplicate the shell
    // around every root-level page.
    if (!parent || parent.kind === "root") break;
    chain.push(parent);
    parentSourcePath = parent.parentSourcePath ?? null;
  }

  let outlet: ReactNode = null;
  for (const route of chain) {
    if (!route.componentName) {
      return routeFailure(
        `Route module "${route.sourcePath}" must declare a named component for the safe Design preview.`,
      );
    }
    const rendered = renderSafeThemeComponent({
      loaderData: route === matched ? args.loaderData : undefined,
      files: args.files,
      sourcePath: route.sourcePath,
      componentName: route.componentName,
      props: {},
      builtinComponents: createRouterBuiltins(outlet),
      injectedProps: args.runtimeProps,
      resolveComponent,
      contentSlots,
      sectionTypeBySlot,
      componentRefBySlot,
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
      ...createRouterBuiltins(outlet),
      [TANSTACK_ROUTER_MODULE]: {
        ...createRouterBuiltins(outlet)[TANSTACK_ROUTER_MODULE],
        HeadContent: () => null,
        Scripts: () => null,
      },
    },
    injectedProps: args.runtimeProps,
    resolveComponent,
    contentSlots,
    sectionTypeBySlot,
    componentRefBySlot,
  });
}
