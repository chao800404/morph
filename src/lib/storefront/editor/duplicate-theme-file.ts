import {
  prepareNewThemeFile,
  type NewThemeFileResult,
} from "./new-theme-file";

const MAX_DUPLICATE_ATTEMPTS = 1000;

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function duplicateCandidate(path: string, copyNumber: number): string {
  const slashIndex = path.lastIndexOf("/");
  const extensionIndex = path.lastIndexOf(".");
  const hasExtension = extensionIndex > slashIndex;
  const stem = hasExtension ? path.slice(0, extensionIndex) : path;
  const extension = hasExtension ? path.slice(extensionIndex) : "";
  const suffix = copyNumber === 1 ? "-copy" : `-copy-${copyNumber}`;
  return `${stem}${suffix}${extension}`;
}

/**
 * Finds the first available sibling name for a duplicated source file.
 *
 * The first copy keeps the familiar `-copy` suffix. If that path is already
 * present, subsequent attempts use `-copy-2`, `-copy-3`, and so on instead of
 * failing the create precondition with a duplicate-path error.
 */
export function prepareDuplicateThemeFile(
  originalPath: string,
  existingPaths: readonly string[],
): NewThemeFileResult {
  const normalizedOriginal = normalizePath(originalPath);
  const existing = new Set(existingPaths.map(normalizePath));

  for (let copyNumber = 1; copyNumber <= MAX_DUPLICATE_ATTEMPTS; copyNumber += 1) {
    const candidate = duplicateCandidate(normalizedOriginal, copyNumber);
    if (existing.has(candidate)) continue;

    // Reuse the create validator so duplicate names have the same path,
    // extension, generated-file, and platform-owned checks as new files.
    return prepareNewThemeFile(candidate, existingPaths);
  }

  return {
    ok: false,
    message: "Could not find an available duplicate file name.",
  };
}
