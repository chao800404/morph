import type { StorefrontTemplateType } from "@/db/storefront.schema";

export type RouteTemplateType = Exclude<StorefrontTemplateType, "layout">;

function normalizeRoutePath(path: string): string {
  return (path || "/").split("?")[0]!.replace(/\/+$/, "") || "/";
}

/**
 * The template type whose document a path's content is stored in, or null.
 *
 * One rule for every reader. The editor decides where a write goes, the server
 * decides what that write may contain, and the public runtime decides what a
 * visitor sees; with two copies of this rule the editor stored content under
 * `/products` in the product document while the runtime served that path from
 * nothing. So a type covers exactly the paths the runtime reads through it:
 * `/`, and everything *under* `/products/`, `/collections/`, `/blogs/` and
 * `/pages/`. The listing at `/products` itself is under none of them.
 *
 * Works for a route pattern (`/products/$slug`) and a concrete request path
 * (`/products/shoe`) alike, because only the leading segment decides it.
 */
export function templateTypeForRoutePath(path: string): RouteTemplateType | null {
  const normalized = normalizeRoutePath(path);
  if (normalized === "/") return "index";
  if (normalized.startsWith("/products/")) return "product";
  if (normalized.startsWith("/collections/")) return "collection";
  if (normalized.startsWith("/blogs/")) return "blog";
  if (normalized.startsWith("/pages/")) return "page";
  return null;
}

/** Whether a route pattern matches one fixed URL, with no parameters. */
function isStaticRoutePath(routePath: string): boolean {
  return normalizeRoutePath(routePath)
    .split("/")
    .every(
      (segment) =>
        !segment.startsWith("$") &&
        !segment.includes("{") &&
        !segment.includes("*"),
    );
}

export type RouteContentTarget =
  /** Shared by every route of the type, found by type. */
  | Readonly<{ kind: "template"; type: RouteTemplateType }>
  /** A document this one route owns, found by its path. */
  | Readonly<{ kind: "route"; routePath: string }>
  /** Nowhere the runtime could serve it from. */
  | Readonly<{ kind: "unsupported"; reason: string }>;

/**
 * Where a source route's content lives.
 *
 * A route a type covers shares that type's document. A static route no type
 * covers (`/aboutus`) gets a document of its own, bound by its path: sharing
 * one `page` document between several such routes would let a write on one
 * route drop the others' sections, and the runtime can find it by the exact
 * request path. A route with parameters that no type covers has no document
 * yet — the runtime would have to match the pattern to find one — so it is
 * reported rather than given one it could never be served from.
 */
export function contentTargetForRoutePath(routePath: string): RouteContentTarget {
  const type = templateTypeForRoutePath(routePath);
  if (type) return { kind: "template", type };
  if (!isStaticRoutePath(routePath)) {
    return {
      kind: "unsupported",
      reason:
        "Routes with parameters outside /products, /collections, /blogs and /pages have no content document. Move the route under one of those paths, or give it fixed values in Code mode.",
    };
  }
  return { kind: "route", routePath: normalizeRoutePath(routePath) };
}

/** The route path a stored route template answers for, normalised for lookup. */
export function routeTemplatePathForRequest(pathname: string): string {
  return normalizeRoutePath(pathname);
}
