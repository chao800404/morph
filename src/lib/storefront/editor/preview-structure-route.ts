import type { ThemeRouteRecord } from "@/lib/storefront/compiler/theme-route-registry";

function normalizeRoutePattern(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

/**
 * Whether a structure report describes the route the editor is showing.
 *
 * The Live Preview boots on `/` and navigates to the selected route, and it
 * reports what is on the page at each step. A report from before it arrived
 * describes another page; taken as this one, its sections were listed in the
 * tree as the selected route's shell for as long as the navigation took.
 *
 * Compared as route patterns, the way the router matched them, with a
 * trailing slash ignored: the router spells an index route `/products/` where
 * the route registry says `/products`. A report that names no route comes
 * from a page with no router to ask and is accepted, as every report was
 * before routes were named.
 */
export function previewStructureMatchesRoute(
  reportedRoutePath: string | undefined,
  selectedRoutePath: string | undefined,
): boolean {
  if (reportedRoutePath === undefined) return true;
  return (
    normalizeRoutePattern(reportedRoutePath) ===
    normalizeRoutePattern(selectedRoutePath ?? "/")
  );
}

/**
 * The Theme page a frame's own navigation landed on, when the editor may
 * follow it there; null otherwise.
 *
 * Only a static page that exactly one registry record names: a dynamic route
 * would need the address the author opened, which a report does not carry,
 * and a layout, a pathless layout or a handler-only route is not a page the
 * editor can show. Compared as `previewStructureMatchesRoute` compares, so an
 * index route's trailing slash still names its page.
 */
export function previewFrameNavigationRoute(
  reportedRoutePath: string,
  routes: readonly ThemeRouteRecord[],
): ThemeRouteRecord | null {
  const reported = normalizeRoutePattern(reportedRoutePath);
  const matches = routes.filter(
    (route) =>
      route.kind === "route" &&
      !route.dynamic &&
      !route.isPathless &&
      route.routeType !== "layout" &&
      !route.isServerOnly &&
      normalizeRoutePattern(route.path) === reported,
  );
  return matches.length === 1 ? matches[0]! : null;
}
