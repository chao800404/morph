import type {
  ThemeRouteRecord,
  ThemeRouteRegistry,
} from "./theme-route-registry";
import { normalizeRoutePath } from "../theme-template-routes";

const PAGE_EXTENSIONS = /\.(astro|md|mdx|html|js|ts)$/;
/** What Astro builds as an endpoint, which answers with a Response. */
const ENDPOINT_EXTENSIONS = /\.(js|ts)$/;

/**
 * An Astro project's routes, from its `src/pages/` file names, in the shape
 * the sealed content is made from (`createNativePrerenderContent`).
 *
 * `[param]` and `[...rest]` are dynamic; a name starting with `_` is not a
 * route; a `.js` or `.ts` file is an endpoint (`isEndpoint`): listed, and
 * built as before, but not a page. Paths are URL paths — percent-encoded as `Astro.url.pathname` is —
 * and Core's content keys (`normalizeRoutePath`). Whether a page prerenders is
 * the page's own `prerender` export, which the build records; this says only
 * which paths exist.
 *
 * Pure and client-safe: the build (astro-native-prerender.ts re-exports it)
 * and Core's route checks (theme-framework/theme-routes.ts) read the same
 * function, so neither can see different routes from the other.
 */
export function astroRouteRegistry(
  files: readonly Readonly<{ path: string }>[],
): ThemeRouteRegistry {
  const routes: ThemeRouteRecord[] = [];
  for (const file of files) {
    if (!file.path.startsWith("src/pages/") || !PAGE_EXTENSIONS.test(file.path))
      continue;
    const segments = file.path
      .slice("src/pages/".length)
      .replace(PAGE_EXTENSIONS, "")
      .split("/");
    if (segments.some((segment) => segment.startsWith("_"))) continue;
    if (segments[segments.length - 1] === "index") segments.pop();
    const dynamic = segments.some((segment) => /\[.+\]/.test(segment));
    const path = normalizeRoutePath(
      new URL(`/${segments.join("/")}`, "http://astro.invalid").pathname,
    );
    routes.push({
      id: path,
      path,
      sourcePath: file.path,
      kind: "route",
      dynamic,
      routeType: "route",
      componentName: null,
      // Only on an endpoint, so a page's record is what it always was.
      ...(ENDPOINT_EXTENSIONS.test(file.path) ? { isEndpoint: true } : {}),
    });
  }
  return { valid: true, routes, diagnostics: [] };
}
