/**
 * Types for `theme-preview-runtime-default.mjs`, which is plain JavaScript so
 * the E2E runner and the E2E record helper can import the rules the Worker
 * uses.
 */
export declare const THEME_PREVIEW_RUNTIME_VAR: "MORPH_THEME_PREVIEW_RUNTIME";

export declare const THEME_PREVIEW_RUNTIMES: readonly ["client", "start"];

export declare function isThemePreviewRuntime(
  value: unknown,
): value is "client" | "start";

export declare function deploymentThemePreviewRuntime(
  envValue: unknown,
): "client" | "start";

export declare function recordedThemePreviewRuntime(
  stored: string | null | undefined,
): "client" | "start" | null;

export type ThemePreviewRuntimeResolution = Readonly<{
  runtime: "client" | "start";
  /** `theme`: the Theme records it. `deployment`: inherited from the env. */
  source: "theme" | "deployment";
}>;

export declare function resolveThemePreviewRuntime(input: {
  recorded: string | null | undefined;
  deploymentEnvValue: unknown;
}): ThemePreviewRuntimeResolution;
