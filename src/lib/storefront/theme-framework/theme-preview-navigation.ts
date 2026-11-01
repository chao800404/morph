import {
  THEME_FRAMEWORK_IDS,
  UNRECORDED_THEME_FRAMEWORK,
  type ThemeFrameworkId,
} from "./theme-framework.types";

/**
 * How a Live Preview page moves to another page when the editor asks it to
 * (docs/astro-theme-plan.md 2.6 `preview.navigation`, 6.3; D3).
 *
 * - `router`: the page hands the bridge its router, which navigates inside
 *   the one document. A Start Theme with no router keeps the one page it has
 *   and is never sent anywhere.
 * - `document`: every page is its own document. The bridge loads the other
 *   page (`location.assign`), and the editor waits for that new document to
 *   come up and say where it is before it takes anything from it.
 */
export type ThemePreviewNavigation = "router" | "document";

/**
 * The one table, for the preview workspace that tells the bridge which kind
 * it runs in and for the editor that waits on it. A `Record` over every id,
 * so a new framework does not compile until it says how its pages navigate.
 *
 * Client-safe: imports nothing but the framework ids.
 */
export const THEME_FRAMEWORK_PREVIEW_NAVIGATION: Readonly<
  Record<ThemeFrameworkId, ThemePreviewNavigation>
> = {
  "tanstack-start": "router",
  astro: "document",
};

/**
 * The window global the preview client sets, before the bridge loads, on a
 * page that navigates as documents. Read once by the bridge
 * (theme-preview-bridge-entry.ts spells the same name); absent means the
 * bridge's own behaviour, unchanged.
 */
export const PREVIEW_NAVIGATION_GLOBAL = "__morphPreviewNavigation";

/**
 * How the preview of a Theme recorded with `recorded` navigates, or null for
 * a framework Morph does not know. Absent is `UNRECORDED_THEME_FRAMEWORK`, as
 * everywhere else. Read from the record, never guessed from the files or from
 * whether the page has a router.
 */
export function previewNavigationFor(
  recorded: string | null | undefined,
): ThemePreviewNavigation | null {
  const id = recorded ?? UNRECORDED_THEME_FRAMEWORK;
  if (!(THEME_FRAMEWORK_IDS as readonly string[]).includes(id)) return null;
  return THEME_FRAMEWORK_PREVIEW_NAVIGATION[id as ThemeFrameworkId];
}
