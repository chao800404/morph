import { astroRouteRegistry } from "../compiler/astro-route-registry";
import {
  buildThemeRouteRegistry,
  parseThemeRouteSourcePath,
  isThemeEndpointRoute,
  themeRoutePathAfterFileMoves,
  type ThemeRouteRegistry,
} from "../compiler/theme-route-registry";
import {
  contentTargetForRoutePath,
  type RouteContentTarget,
} from "../theme-template-routes";
import {
  THEME_FRAMEWORK_IDS,
  UNRECORDED_THEME_FRAMEWORK,
  type ThemeFrameworkId,
} from "./theme-framework.types";

type ThemeRouteFiles = readonly Readonly<{ path: string; content: string }>[];

/**
 * How each framework Morph knows reads a project's routes from its files.
 *
 * The one table: the adapters' `build.native.routeRegistry`, the build's
 * public-file check and Core's write-time checks all read routes through it,
 * so a build and an upload can never disagree about which paths are pages.
 * A `Record` over every id, so naming a new framework does not compile until
 * it says how its routes are read.
 *
 * Client-safe on purpose: it imports the two route readers and nothing of
 * the adapters' preview or build planners, so the editor can use it without
 * taking those into its bundle.
 */
export const THEME_FRAMEWORK_ROUTES: Readonly<
  Record<ThemeFrameworkId, (files: ThemeRouteFiles) => ThemeRouteRegistry>
> = {
  "tanstack-start": (files) => buildThemeRouteRegistry(files),
  astro: (files) => astroRouteRegistry(files),
};

export type ThemeRoutesResult =
  | Readonly<{
      ok: true;
      framework: ThemeFrameworkId;
      registry: ThemeRouteRegistry;
    }>
  | Readonly<{ ok: false; code: "THEME_FRAMEWORK_UNKNOWN"; framework: string }>;

/**
 * A Theme's routes, read the way the framework its record names reads them.
 *
 * Absent (`null` or `undefined`) is `UNRECORDED_THEME_FRAMEWORK`, as
 * everywhere else. A recorded value that is no framework id is refused,
 * never read as Start's. The framework is the record's, never guessed from
 * the files: a workspace can hold both Start's and Astro's.
 *
 * Reading routes is not serving the framework, so this does not ask for the
 * server's Astro switch (`resolveThemeFramework`'s `astroThemes`).
 */
export function themeRoutesFor(
  recorded: string | null | undefined,
  files: ThemeRouteFiles,
): ThemeRoutesResult {
  const id = recorded ?? UNRECORDED_THEME_FRAMEWORK;
  if (!(THEME_FRAMEWORK_IDS as readonly string[]).includes(id)) {
    return { ok: false, code: "THEME_FRAMEWORK_UNKNOWN", framework: id };
  }
  const framework = id as ThemeFrameworkId;
  return {
    ok: true,
    framework,
    registry: THEME_FRAMEWORK_ROUTES[framework](files),
  };
}

/**
 * What one source file is as a route of the framework a Theme records, for
 * moving and rolling back the Documents routes own (D7): the URL path, and
 * whether the file is a page route of its own. Null for a file that is no
 * route of that framework.
 *
 * - Start (and a Theme recording none): TanStack Router's file convention,
 *   exactly as before (`parseThemeRouteSourcePath`). A companion piece
 *   (`about.lazy.tsx`) is not standalone; the root route is `root`.
 * - Astro: the Astro route registry's reading of `src/pages/`. An endpoint
 *   (`.js`/`.ts`) is not standalone; `dynamic` is the registry's, the only
 *   judge of an Astro parameter (Q6).
 * - Any other recorded value: null. Its routes are not read as Start's.
 */
export type RouteSourcePathInfo = Readonly<{
  routePath: string;
  standalone: boolean;
  root: boolean;
  /** Astro's `[param]`; Start reports false (its `$param` is judged below). */
  dynamic: boolean;
}>;

export function routeSourcePathInfo(
  recorded: string | null | undefined,
  path: string,
): RouteSourcePathInfo | null {
  const id = recorded ?? UNRECORDED_THEME_FRAMEWORK;
  if (id === "tanstack-start") {
    const metadata = parseThemeRouteSourcePath(path);
    if (!metadata) return null;
    return {
      routePath: metadata.path,
      standalone: !metadata.isRoutePiece,
      root: metadata.routeType === "root",
      dynamic: false,
    };
  }
  if (id === "astro") {
    const [record] = astroRouteRegistry([{ path }]).routes;
    if (!record) return null;
    return {
      routePath: record.path,
      standalone: !record.isEndpoint,
      root: false,
      dynamic: record.dynamic,
    };
  }
  return null;
}

/**
 * Where a route's content lives, by `contentTargetForRoutePath`, except that
 * a dynamic Astro page is `unsupported` before that rule is asked: it does
 * not know `[slug]` as a parameter and would call the path static.
 */
export function routeSourceContentTarget(
  info: RouteSourcePathInfo,
): RouteContentTarget {
  if (info.dynamic) {
    return {
      kind: "unsupported",
      reason:
        "Pages with route parameters have no content document of their own.",
    };
  }
  return contentTargetForRoutePath(info.routePath);
}

/**
 * The public path of one page source file, as its framework reads it, or null
 * when the file is no page the editor can be on: not a route file, a dynamic
 * pattern (`/blog/[slug]` is no page to stand on), an endpoint, or a name
 * starting with `_`. Read through the same table as `themeRoutesFor`.
 */
function pagePathOfSourceFile(
  framework: ThemeFrameworkId,
  sourcePath: string,
): string | null {
  const [route] = THEME_FRAMEWORK_ROUTES[framework]([
    { path: sourcePath, content: "" },
  ]).routes;
  if (!route || route.sourcePath !== sourcePath) return null;
  if (route.dynamic || isThemeEndpointRoute(route)) return null;
  return route.path;
}

/**
 * Where the editor's current page is after files were moved in Code, or null
 * when it did not move. Keeps the editor on the page it was on when its source
 * file is renamed or moved, the way the recorded framework names pages: a
 * `src/routes/*` file for TanStack Start (`themeRoutePathAfterFileMoves`), a
 * `src/pages/*` file for Astro. A framework that is no id never moves it.
 */
export function themeRoutePathAfterFileMovesFor(
  recorded: string | null | undefined,
  currentRoutePath: string | undefined,
  moves: ReadonlyArray<{ from: string; to: string }>,
): string | null {
  const id = recorded ?? UNRECORDED_THEME_FRAMEWORK;
  if (!(THEME_FRAMEWORK_IDS as readonly string[]).includes(id)) return null;
  const framework = id as ThemeFrameworkId;
  if (framework === "tanstack-start") {
    return themeRoutePathAfterFileMoves(currentRoutePath, moves);
  }
  if (!currentRoutePath) return null;
  const moved = moves.find(
    (move) => pagePathOfSourceFile(framework, move.from) === currentRoutePath,
  );
  if (!moved) return null;
  const next = pagePathOfSourceFile(framework, moved.to);
  return next && next !== currentRoutePath ? next : null;
}
