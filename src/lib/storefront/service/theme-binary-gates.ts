/**
 * The upload entry for binary Theme files, ahead of the editor's own.
 *
 * A local flag decides whether it answers at all, and only that: the write
 * goes through `saveBinaryFile`, which holds the same ownership, path,
 * format, quota, route and source-generation checks any write does. Never
 * open in production, whatever the variables say.
 */

export const THEME_BINARY_UPLOAD_FLAG = "MORPH_ENABLE_THEME_BINARY_UPLOAD";

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
