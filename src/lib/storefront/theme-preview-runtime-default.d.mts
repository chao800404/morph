/**
 * Types for `theme-preview-runtime-default.mjs`, which is plain JavaScript so
 * the E2E runner can import the same rule the Worker uses.
 */
export declare const THEME_PREVIEW_RUNTIME_VAR: "MORPH_THEME_PREVIEW_RUNTIME";

export declare const THEME_PREVIEW_RUNTIMES: readonly ["client", "start"];

export declare function deploymentThemePreviewRuntime(
  envValue: unknown,
): "client" | "start";
