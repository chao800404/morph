import { throwawayThemePlan } from "../../scripts/e2e-client-lane-guard.mjs";
import {
  RECORDED_PREVIEW_RUNTIME,
  previewRuntimeSql,
  verifyRecordedThemePreviewRuntime,
} from "./recorded-preview-runtime";
import { execLocalD1 } from "./editor-writes-paused";
import { seedClientLaneThrowaway } from "./client-lane-theme";

/**
 * The preview runtime a throwaway Theme records, named by its spec.
 *
 * `"start"` records the full Start preview, `"client"` the client-only one;
 * null records nothing, so the Theme is previewed as the Worker's
 * `MORPH_THEME_PREVIEW_RUNTIME` says (the client-only preview unless the run
 * turned Start on). It is a required argument on purpose: a spec that
 * creates Themes states which preview it means to run under, and a lane that
 * changes what a new Theme records changes it here, in one place, instead of
 * in every spec's own INSERT.
 */
export type ThrowawayPreviewRuntime = "start" | "client" | null;

export type ThrowawayThemeInput = {
  storefrontId: string;
  themeId: string;
  name: string;
  /** Required; there is no default. */
  previewRuntime: ThrowawayPreviewRuntime;
  /**
   * A bare row, never seeded: for a spec that needs an empty or a stale
   * Theme and never previews it. On the client lane every other throwaway is
   * seeded on the pinned Starter 31 workspace, and a previewed Theme the lane
   * did not seed fails the run.
   */
  rowOnly?: boolean;
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

/**
 * The run's record mode when it declares one (`MORPH_E2E_RECORD_PREVIEW_RUNTIME`,
 * never in CI), else the runtime the specs expect. For the specs that record
 * the run's record on their Themes and also run in the full Start job: from
 * Starter 32 the editor provisions the Starter only into a Theme that records
 * start, so a Theme recording nothing there would get no files.
 */
export function recordedOrSpecPreviewRuntime(): ThrowawayPreviewRuntime {
  return RECORDED_PREVIEW_RUNTIME ?? specPreviewRuntime();
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
 * Makes a throwaway Theme in the runner-owned database.
 *
 * Off the client lane, and for a `rowOnly` Theme, it inserts the row,
 * recording the preview runtime its spec names; the editor's first read then
 * provisions the Starter as for any new Theme. A Theme recording a runtime
 * is read back and checked like any other recorded Theme
 * (`verifyRecordedThemePreviewRuntime`, which does nothing outside record
 * mode).
 *
 * On the client lane it seeds the Theme on the pinned Starter 31 workspace
 * instead, through the Node seed the lane's slots use, recording no runtime
 * (the lane's Worker serves the client-only preview, which the guard checks
 * after the suite). The current Starter's own provisioning would give such a
 * Theme nothing: from Starter 32 it needs a Theme that records start. See
 * `throwawayThemePlan` in scripts/e2e-client-lane-guard.mjs.
 */
export function insertThrowawayTheme(input: ThrowawayThemeInput): void {
  const plan = throwawayThemePlan(input, process.env);
  if (plan.action === "refuse") throw new Error(plan.refusal);
  if (plan.action === "seed") {
    seedClientLaneThrowaway({
      storefrontId: input.storefrontId,
      themeId: input.themeId,
      name: input.name,
    });
    return;
  }
  execLocalD1(throwawayThemeInsertSql(input));
  if (input.previewRuntime !== null) {
    verifyRecordedThemePreviewRuntime({
      storefrontId: input.storefrontId,
      themeId: input.themeId,
    });
  }
}
