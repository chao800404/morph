import { createElement, type ReactNode } from "react";
import { sanitizeThemeLinkHref } from "@/lib/storefront/theme-link";

export const TANSTACK_ROUTER_MODULE = "@tanstack/react-router";

/**
 * Router props are meaningful to TanStack at runtime but must not be passed
 * through to the preview's native anchor. The preview has no live Router
 * instance, so Link is represented by a safe, ordinary anchor instead.
 */
const ROUTER_LINK_OPTION_KEYS = new Set([
  "to",
  "params",
  "search",
  "hash",
  "state",
  "preload",
  "preloadDelay",
  "preloadIntentProximity",
  "activeProps",
  "inactiveProps",
  "activeOptions",
  "replace",
  "startTransition",
  "resetScroll",
  "viewTransition",
  "hashScrollIntoView",
  "reloadDocument",
  "unsafeRelative",
  "from",
  "mask",
  "_fromLocation",
]);

function interpolateRouterParams(path: string, params: unknown): string {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return path;
  }
  const values = params as Record<string, unknown>;
  return path.replace(/\$([A-Za-z0-9_]+)/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null
      ? match
      : encodeURIComponent(String(value));
  });
}

function appendRouterSearchAndHash(
  path: string,
  search: unknown,
  hash: unknown,
): string {
  let output = path;
  if (typeof search === "string" && search) {
    output += search.startsWith("?") ? search : `?${search}`;
  } else if (search && typeof search === "object" && !Array.isArray(search)) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(
      search as Record<string, unknown>,
    )) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean"
          ) {
            query.append(key, String(item));
          }
        }
        continue;
      }
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        query.set(key, String(value));
      }
    }
    const encoded = query.toString();
    if (encoded) output += `?${encoded}`;
  }
  if (typeof hash === "string" && hash) {
    output += hash.startsWith("#") ? hash : `#${hash}`;
  }
  return output;
}

/**
 * Renders `<Link>` as a plain anchor for the interpreted preview.
 *
 * Shared by the route renderer and the standalone component renderer. Theme
 * authors use `<Link>` in ordinary components — headers, footers and hero
 * sections — not only inside routes, so a component rendered on its own must
 * resolve it too instead of being refused as a non-local component.
 */
export function renderThemeRouterLink(
  props: Record<string, unknown>,
): ReactNode {
  const { to, href, params, search, hash, ...rest } = props;
  const children = props.children as ReactNode;
  const rawTarget =
    typeof to === "string" || typeof to === "number"
      ? to
      : typeof href === "string" || typeof href === "number"
        ? href
        : undefined;
  const target =
    rawTarget === undefined
      ? undefined
      : appendRouterSearchAndHash(
          interpolateRouterParams(String(rawTarget), params),
          search,
          hash,
        );
  const anchorProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (!ROUTER_LINK_OPTION_KEYS.has(key)) anchorProps[key] = value;
  }
  const safeHref = sanitizeThemeLinkHref(target);
  if (safeHref !== undefined) anchorProps.href = safeHref;
  return createElement("a", anchorProps, children);
}
