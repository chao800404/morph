import { astroRouteRegistry } from "../compiler/astro-route-registry";
import {
  buildThemeRouteRegistry,
  type ThemeRouteRegistry,
} from "../compiler/theme-route-registry";
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
