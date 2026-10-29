// @ts-check
/**
 * The deployment's Live Preview runtime rule, in plain JavaScript so the one
 * definition serves both the Worker (through `theme-preview-runtime.ts`, which
 * re-exports it) and the editor E2E runner (`scripts/run-editor-e2e.mjs`),
 * which runs under Node without the app's build. A second copy of "absent
 * means client-only" in the runner could drift from the Worker's, and the
 * runner's guard exists precisely to stop the two disagreeing.
 */

/** The Worker variable that names the deployment's runtime. */
export const THEME_PREVIEW_RUNTIME_VAR = "MORPH_THEME_PREVIEW_RUNTIME";

/** Every Live Preview runtime there is. */
export const THEME_PREVIEW_RUNTIMES = /** @type {const} */ (["client", "start"]);

/**
 * The deployment's runtime, from `MORPH_THEME_PREVIEW_RUNTIME`, read as it
 * always was: exactly `start` is the full Start preview, anything else the
 * client-only one.
 *
 * @param {unknown} envValue
 * @returns {"client" | "start"}
 */
export function deploymentThemePreviewRuntime(envValue) {
  return envValue === "start" ? "start" : "client";
}
