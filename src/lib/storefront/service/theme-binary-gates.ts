/**
 * Where binary Theme files are reachable before the product offers them.
 *
 * Storage, preview and both build runners handle binary files, but the
 * editor has no upload yet and a normal build still refuses them
 * (`BINARY_THEME_FILE_NOT_BUILDABLE`). Until the Sandbox build path has
 * passed its own end-to-end gate, two things are opened for a test and for
 * nothing else:
 *
 * - An upload entry, which a local flag decides may answer at all. It only
 *   decides that: the write goes through `saveBinaryFile`, which holds the
 *   same ownership, path, format, quota, route and source-generation checks
 *   any write does.
 * - Building binary files, for one named storefront only, so a whole
 *   development server does not start building them by accident.
 *
 * Neither is ever open in production, whatever the variables say.
 */

export const THEME_BINARY_UPLOAD_FLAG = "MORPH_ENABLE_THEME_BINARY_UPLOAD";

/** The one storefront whose builds may place binary files. */
export const THEME_BINARY_BUILD_STOREFRONT_VAR =
  "MORPH_BINARY_BUILD_TEST_STOREFRONT_ID";

export type ThemeBinaryBuildPolicy = "refuse" | "include";

export function themeBinaryUploadRefusal(
  vars: Record<string, unknown>,
  isProduction: boolean,
): string | null {
  if (isProduction) return "Never available in production.";
  if (vars[THEME_BINARY_UPLOAD_FLAG] !== "1") {
    return `Disabled. Set ${THEME_BINARY_UPLOAD_FLAG}=1 locally to enable it.`;
  }
  return null;
}

/**
 * Whether a build of this storefront may place binary files.
 *
 * Decided from the storefront and the environment alone, so the build
 * service reaches the same answer when it checks for a reusable build and
 * when it runs one — including a run that arrives later from the queue,
 * whose message carries nothing but the build's ids.
 */
export function themeBinaryBuildPolicy(
  vars: Record<string, unknown>,
  isProduction: boolean,
  storefrontId: string,
): ThemeBinaryBuildPolicy {
  if (isProduction) return "refuse";
  const allowed = vars[THEME_BINARY_BUILD_STOREFRONT_VAR];
  return typeof allowed === "string" &&
    allowed.length > 0 &&
    allowed === storefrontId
    ? "include"
    : "refuse";
}
