import {
  previewRuntimeSql,
  verifyRecordedThemePreviewRuntime,
} from "./recorded-preview-runtime";
import { execLocalD1 } from "./editor-writes-paused";

/**
 * The preview runtime a throwaway Theme records, named by its spec.
 *
 * `"start"` records the full Start preview; null records nothing, so the
 * Theme is previewed as the Worker's `MORPH_THEME_PREVIEW_RUNTIME` says (the
 * client-only preview unless the run turned Start on). It is a required
 * argument on purpose: a spec that creates Themes states which preview it
 * means to run under, and a lane that changes what a new Theme records
 * changes it here, in one place, instead of in every spec's own INSERT.
 */
export type ThrowawayPreviewRuntime = "start" | null;

export type ThrowawayThemeInput = {
  storefrontId: string;
  themeId: string;
  name: string;
  /** Required; there is no default. */
  previewRuntime: ThrowawayPreviewRuntime;
  /** The `metadata` column, JSON text. Defaults to Starter template version 1. */
  metadata?: string;
  /** The `framework` column; omitted leaves it unrecorded (TanStack Start). */
  framework?: string;
  /** Timestamp for `created_at` and `updated_at`; defaults to now. */
  now?: string;
};

/** The runtime a spec running under `MORPH_E2E_PREVIEW_RUNTIME` is expecting. */
export function specPreviewRuntime(): ThrowawayPreviewRuntime {
  return process.env.MORPH_E2E_PREVIEW_RUNTIME === "start" ? "start" : null;
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** The `INSERT INTO storefront_themes` for a throwaway Theme. */
export function throwawayThemeInsertSql(input: ThrowawayThemeInput): string {
  const now = quote(input.now ?? new Date().toISOString());
  const framework = input.framework === undefined ? null : quote(input.framework);
  return `INSERT INTO storefront_themes
    (id, storefront_id, name, metadata,${framework ? " framework," : ""} preview_runtime, created_at, updated_at)
    VALUES (${quote(input.themeId)}, ${quote(input.storefrontId)}, ${quote(input.name)},
      ${quote(input.metadata ?? '{"starterTemplateVersion":1}')},${framework ? ` ${framework},` : ""}
      ${previewRuntimeSql(input.previewRuntime)}, ${now}, ${now});`;
}

/**
 * Inserts a throwaway Theme into the runner-owned database, recording the
 * preview runtime its spec names. A Theme recorded as `"start"` is read back
 * and checked like any other recorded Theme (`verifyRecordedThemePreviewRuntime`,
 * which does nothing outside record mode).
 */
export function insertThrowawayTheme(input: ThrowawayThemeInput): void {
  execLocalD1(throwawayThemeInsertSql(input));
  if (input.previewRuntime === "start") {
    verifyRecordedThemePreviewRuntime({
      storefrontId: input.storefrontId,
      themeId: input.themeId,
    });
  }
}
