import { safeThemeFilePathSchema } from "@/lib/validations/storefront-theme-file";
import { existingFolderPaths } from "./pending-theme-folders";

export type NewThemeFolderResult =
  { ok: true; path: string } | { ok: false; message: string };

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * Validates the name entered by the explorer's inline folder editor.
 *
 * Empty folders are intentionally a client-side workspace affordance, so this
 * only returns a safe normalized path. A later file create is what makes the
 * folder real in Theme Source storage.
 */
export function prepareNewThemeFolder(
  rawName: string,
  parentPath: string,
  existingFilePaths: readonly string[],
  pendingFolderPaths: readonly string[] = [],
): NewThemeFolderResult {
  const name = normalizePath(rawName);
  if (!name) return { ok: false, message: "Enter a folder name." };

  const parent = normalizePath(parentPath);
  const candidate = parent ? `${parent}/${name}` : name;
  const parsed = safeThemeFilePathSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid folder path.",
    };
  }

  const path = parsed.data;
  const samePath = (value: string) => normalizePath(value) === path;
  if (existingFilePaths.some(samePath)) {
    return { ok: false, message: `A file already exists at "${path}".` };
  }
  if (pendingFolderPaths.some(samePath)) {
    return { ok: false, message: `The folder "${path}" already exists.` };
  }

  if (existingFolderPaths(existingFilePaths).has(path)) {
    return { ok: false, message: `The folder "${path}" already exists.` };
  }

  return { ok: true, path };
}
