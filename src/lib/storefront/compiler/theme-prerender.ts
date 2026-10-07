import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";
import { resolveStorefrontRenderPolicy } from "../../validations/storefront-render-policy";
import type { ThemeRouteRegistry } from "./theme-route-registry";
import { frozenContentRoute } from "./theme-build-content-route";

/** A route with one concrete URL that renders a page: what can be prerendered. */
export function isStaticPageRoute(
  route: ThemeRouteRegistry["routes"][number],
): boolean {
  return (
    route.kind === "route" &&
    !route.dynamic &&
    !route.isServerOnly &&
    !route.isPathless &&
    route.routeType !== "layout"
  );
}

export function assertThemePrerenderArtifacts(
  snapshot: ThemeBuildContentSnapshot | undefined,
  registry: ThemeRouteRegistry,
  artifactPaths: ReadonlySet<string>,
) {
  for (const page of themePrerenderOptions(snapshot, registry, true)?.pages ??
    []) {
    const expected = `runtime/client${page.path === "/" ? "" : page.path.replace(/\/$/, "")}/index.html`;
    if (!artifactPaths.has(expected)) {
      throw new Error(`INCOMPLETE_SSG_ARTIFACT: Missing HTML for ${page.path}`);
    }
  }
}

/** Platform-owned native Start options, derived only from frozen build input.
 * Publication stays guarded until content injection and static serving are wired.
 */
export function themePrerenderOptions(
  snapshot: ThemeBuildContentSnapshot | undefined,
  registry: ThemeRouteRegistry,
  contentConnected = false,
) {
  if (!snapshot) return undefined;
  const defaults = snapshot.documents.filter(
    ({ item, document }) =>
      item.metadata?.templateType === "layout" ||
      document.websiteRenderPolicy !== undefined,
  );
  if (defaults.length > 1) throw new Error("SSG_AMBIGUOUS_WEBSITE_POLICY");
  const website = defaults[0]?.document.websiteRenderPolicy;
  const overrides = new Map<string, unknown>();
  for (const { item, document } of snapshot.documents) {
    if (
      item.metadata?.templateType === "layout" ||
      document.websiteRenderPolicy !== undefined
    )
      continue;
    const routePath = frozenContentRoute(item);
    if (!routePath) {
      if (document.renderPolicy?.mode === "ssg" || website?.mode === "ssg") {
        throw new Error(
          "SSG_DOCUMENT_ROUTE_REQUIRED: Static HTML requires an immutable concrete route reference.",
        );
      }
      continue;
    }
    if (overrides.has(routePath))
      throw new Error("SSG_DUPLICATE_DOCUMENT_ROUTE");
    if (
      !registry.routes.some(
        (route) =>
          route.path === routePath &&
          !route.dynamic &&
          !route.isServerOnly &&
          route.kind === "route" &&
          !route.isPathless &&
          route.routeType !== "layout",
      )
    ) {
      const effective = resolveStorefrontRenderPolicy({
        website,
        page: document.renderPolicy,
      });
      if (!effective.success) throw new Error(effective.code);
      if (effective.policy.mode === "ssg") {
        throw new Error(
          "SSG_ROUTE_UNSUPPORTED: A concrete static page route is required; dynamic URLs need separate materialization.",
        );
      }
      continue;
    }
    overrides.set(routePath, document.renderPolicy);
  }
  const paths: string[] = [];
  for (const route of registry.routes) {
    if (!isStaticPageRoute(route)) continue;
    const resolved = resolveStorefrontRenderPolicy({
      website,
      page: overrides.get(route.path),
    });
    if (!resolved.success) throw new Error(resolved.code);
    if (resolved.policy.mode === "ssg") paths.push(route.path);
  }
  if (paths.length === 0) return undefined;
  // Until the frozen content endpoint is connected, do not silently produce
  // HTML from component defaults instead of CMS field values (including shell).
  if (
    !contentConnected &&
    snapshot.documents.some(({ document }) => document.sections.length > 0)
  ) {
    throw new Error(
      "SSG_CONTENT_NOT_CONNECTED: CMS content injection must be connected before generating content-backed static HTML.",
    );
  }
  return {
    prerender: {
      enabled: true,
      autoStaticPathsDiscovery: false,
      crawlLinks: false,
      concurrency: 1,
      retryCount: 0,
      maxRedirects: 0,
      failOnError: true,
    },
    pages: [...new Set(paths)]
      .sort()
      .map((path) => ({ path, prerender: { enabled: true } })),
  };
}
