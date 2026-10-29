import type { ThemePreviewRuntime } from "./compiler/theme-sandbox-workspace";
import {
  THEME_PREVIEW_RUNTIMES,
  deploymentThemePreviewRuntime,
} from "./theme-preview-runtime-default.mjs";
import { UNRECORDED_THEME_FRAMEWORK } from "./theme-framework/theme-framework.types";

export type { ThemePreviewRuntime } from "./compiler/theme-sandbox-workspace";

/**
 * Which Live Preview runtime a Theme is served with (R-0, R1).
 *
 * A Theme may record one (`storefront_themes.preview_runtime`). One that does
 * not is previewed as the deployment says (`MORPH_THEME_PREVIEW_RUNTIME`),
 * exactly as every Theme was before it could record one, so recording one is
 * the only way a Theme's preview changes. Nothing here switches a Theme on
 * its own.
 */
// Defined in `theme-preview-runtime-default.mjs`, which the E2E runner reads
// too, so the runner's runtime guard and the Worker share one rule.
export { THEME_PREVIEW_RUNTIMES, deploymentThemePreviewRuntime };
THEME_PREVIEW_RUNTIMES satisfies readonly ThemePreviewRuntime[];

export function isThemePreviewRuntime(
  value: unknown,
): value is ThemePreviewRuntime {
  return (
    typeof value === "string" &&
    (THEME_PREVIEW_RUNTIMES as readonly string[]).includes(value)
  );
}

/**
 * The runtime a Theme records, or null when it records none. A stored value
 * that names no runtime is only possible by hand; it is read as none, so the
 * Theme is previewed as the deployment says rather than as a guess.
 */
export function recordedThemePreviewRuntime(
  stored: string | null | undefined,
): ThemePreviewRuntime | null {
  return isThemePreviewRuntime(stored) ? stored : null;
}

export type ThemePreviewRuntimeResolution = Readonly<{
  runtime: ThemePreviewRuntime;
  /** `theme`: the Theme records it. `deployment`: inherited from the env. */
  source: "theme" | "deployment";
}>;

/** The Theme's recorded runtime if it has one, else the deployment's. */
export function resolveThemePreviewRuntime(input: {
  recorded: string | null | undefined;
  deploymentEnvValue: unknown;
}): ThemePreviewRuntimeResolution {
  const recorded = recordedThemePreviewRuntime(input.recorded);
  return recorded
    ? { runtime: recorded, source: "theme" }
    : {
        runtime: deploymentThemePreviewRuntime(input.deploymentEnvValue),
        source: "deployment",
      };
}

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
