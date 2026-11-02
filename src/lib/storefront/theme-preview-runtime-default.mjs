// @ts-check
/**
 * The Live Preview runtime rules, in plain JavaScript so the one definition
 * serves the Worker (through `theme-preview-runtime.ts`, which re-exports
 * them), the editor E2E runner (`scripts/run-editor-e2e.mjs`, which runs under
 * Node without the app's build) and the E2E record helper
 * (`e2e/helpers/recorded-preview-runtime.ts`). A second copy of "absent means
 * client-only" or of "recorded first, else the deployment's" in the runner or
 * the helper could drift from the Worker's, and their guards exist precisely
 * to stop a run's expectations disagreeing with what the Worker serves.
 */

/** The Worker variable that names the deployment's runtime. */
export const THEME_PREVIEW_RUNTIME_VAR = "MORPH_THEME_PREVIEW_RUNTIME";

/** Every Live Preview runtime there is. */
export const THEME_PREVIEW_RUNTIMES = /** @type {const} */ (["client", "start"]);

/**
 * @param {unknown} value
 * @returns {value is "client" | "start"}
 */
export function isThemePreviewRuntime(value) {
  return (
    typeof value === "string" &&
    /** @type {readonly string[]} */ (THEME_PREVIEW_RUNTIMES).includes(value)
  );
}

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

/**
 * The runtime a Theme records, or null when it records none. A stored value
 * that names no runtime is only possible by hand; it is read as none, so the
 * Theme is previewed as the deployment says rather than as a guess.
 *
 * @param {string | null | undefined} stored
 * @returns {"client" | "start" | null}
 */
export function recordedThemePreviewRuntime(stored) {
  return isThemePreviewRuntime(stored) ? stored : null;
}

/**
 * The Theme's recorded runtime if it has one, else the deployment's.
 * `source` is `theme` when the Theme records it, `deployment` when it is
 * inherited from the env.
 *
 * @param {{ recorded: string | null | undefined, deploymentEnvValue: unknown }} input
 * @returns {Readonly<{ runtime: "client" | "start", source: "theme" | "deployment" }>}
 */
export function resolveThemePreviewRuntime(input) {
  const recorded = recordedThemePreviewRuntime(input.recorded);
  return recorded
    ? { runtime: recorded, source: "theme" }
    : {
        runtime: deploymentThemePreviewRuntime(input.deploymentEnvValue),
        source: "deployment",
      };
}
