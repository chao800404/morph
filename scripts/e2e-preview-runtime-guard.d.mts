/**
 * Types for the parts of the E2E runner's preview runtime guard the record
 * helper (`e2e/helpers/recorded-preview-runtime.ts`) reads. Plain JavaScript
 * because the runner is.
 */
export declare const RECORD_PREVIEW_RUNTIME_VAR: "MORPH_E2E_RECORD_PREVIEW_RUNTIME";

export declare const WORKER_PREVIEW_RUNTIME_FOR_SPECS_VAR: "MORPH_E2E_WORKER_PREVIEW_RUNTIME";

export declare const RECORD_VERIFIED_FILE: string;

export declare const RECORD_MODE_SPECS: readonly string[];

export declare function recordedThemeRefusal(input: {
  themeId: string;
  rows: ReadonlyArray<Record<string, unknown>>;
  declared: "client" | "start";
  workerDefault: string | undefined;
  specValue: string | undefined;
}): string | null;

export declare function previewedThemeRefusal(
  pageUrl: string,
  verifiedThemeIds: readonly string[],
): string | null;
