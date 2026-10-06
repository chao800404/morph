import { tanstackStartFramework } from "./tanstack-start.framework";
import type { ThemeFrameworkAdapter } from "./theme-framework.types";

export type {
  ThemeFrameworkAdapter,
  ThemeFrameworkId,
} from "./theme-framework.types";

/** Every framework Morph can preview and build. */
export const THEME_FRAMEWORKS: readonly ThemeFrameworkAdapter[] = [
  tanstackStartFramework,
];

/**
 * The framework a Theme's preview and build go through.
 *
 * There is one today, and it also serves the older single-entry Themes that
 * its `detect` does not claim, so it is returned for every Theme. A second
 * framework turns this into a choice: by the framework the site was created
 * with, or by `detect` for an imported project.
 */
export function themeFramework(): ThemeFrameworkAdapter {
  return tanstackStartFramework;
}
