import type { ThemePreviewRuntime } from "./compiler/theme-sandbox-workspace";
import {
  THEME_PREVIEW_RUNTIMES,
  deploymentThemePreviewRuntime,
  isThemePreviewRuntime,
  recordedThemePreviewRuntime,
  resolveThemePreviewRuntime,
} from "./theme-preview-runtime-default.mjs";
import { UNRECORDED_THEME_FRAMEWORK } from "./theme-framework/theme-framework.types";

export type { ThemePreviewRuntime } from "./compiler/theme-sandbox-workspace";
export type { ThemePreviewRuntimeResolution } from "./theme-preview-runtime-default.mjs";

/**
 * Which Live Preview runtime a Theme is served with (R-0, R1).
 *
 * A Theme may record one (`storefront_themes.preview_runtime`). One that does
 * not is previewed as the deployment says (`MORPH_THEME_PREVIEW_RUNTIME`),
 * exactly as every Theme was before it could record one, so recording one is
 * the only way a Theme's preview changes. Nothing here switches a Theme on
 * its own.
 *
 * The runtimes, the deployment's default and the "recorded first, else the
 * deployment's" resolution are defined in `theme-preview-runtime-default.mjs`,
 * which the E2E runner and the E2E record helper read too, so they and the
 * Worker share one rule.
 */
export {
  THEME_PREVIEW_RUNTIMES,
  deploymentThemePreviewRuntime,
  isThemePreviewRuntime,
  recordedThemePreviewRuntime,
  resolveThemePreviewRuntime,
};
THEME_PREVIEW_RUNTIMES satisfies readonly ThemePreviewRuntime[];

/**
 * Whether a Theme of this recorded framework (NULL is TanStack Start) may
 * record this runtime. The full Start preview is TanStack Start's; any other
 * framework serves its own preview and is never recorded as `start`.
 */
export function themeFrameworkAllowsPreviewRuntime(
  framework: string | null | undefined,
  runtime: ThemePreviewRuntime,
): boolean {
  if (runtime === "client") return true;
  return (framework ?? UNRECORDED_THEME_FRAMEWORK) === "tanstack-start";
}

/**
 * The first Starter version whose new Themes record the full Start preview.
 * Starter v30's route layer reads content through the SDK on the server, so
 * a Theme created from it needs `start` to preview at all (R-0).
 */
export const FIRST_STARTER_VERSION_RECORDING_START_PREVIEW = 30;

/**
 * What a Theme created from this Starter version records. Null below
 * `FIRST_STARTER_VERSION_RECORDING_START_PREVIEW`: such a Theme records
 * nothing and is previewed as the deployment says, as before.
 *
 * Only for creating a Theme. Upgrading a Theme's Starter never records or
 * changes its runtime.
 */
export function defaultPreviewRuntimeForNewTheme(
  starterVersion: number,
): ThemePreviewRuntime | null {
  return starterVersion >= FIRST_STARTER_VERSION_RECORDING_START_PREVIEW
    ? "start"
    : null;
}
