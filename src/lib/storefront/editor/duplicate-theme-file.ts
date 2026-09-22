import {
  prepareNewThemeFile,
  type NewThemeFileResult,
} from "./new-theme-file";

const MAX_DUPLICATE_ATTEMPTS = 1000;
const PAGE_SECTION_COPY_ROOT = "src/components/page-sections";

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
 * Derives a stable, filesystem-safe directory name from a public route path.
 *
 * The route path is used instead of a concrete preview URL so dynamic routes
 * keep one page-specific component regardless of which product or record is
 * currently being previewed. For example, `/products/$slug` becomes
 * `products-slug`, while `/` is kept as `home`.
 */
export function pageSectionRouteKey(routePath: string): string {
  const segments = routePath
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment
        .replace(/^\$+/, "")
        .replace(/^\[+|\]+$/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean);

  return segments.join("-") || "home";
}

/**
 * Finds the first available page-specific component path.
 *
 * Detached components intentionally live outside `src/components/sections`:
 * that folder is the shared Add section library. Keeping page copies under a
 * route-keyed directory makes ownership visible in Code mode and prevents a
 * detached copy from being offered as a reusable section by accident.
 */
export function preparePageSectionCopy(
  originalPath: string,
  routePath: string,
  existingPaths: readonly string[],
  content = "",
): NewThemeFileResult {
  const normalizedOriginal = normalizePath(originalPath);
  const fileName = normalizedOriginal.slice(
    normalizedOriginal.lastIndexOf("/") + 1,
  );
  if (!fileName || !fileName.includes(".")) {
    return {
      ok: false,
      message: "The component file must have a supported extension.",
    };
  }

  const directory = `${PAGE_SECTION_COPY_ROOT}/${pageSectionRouteKey(routePath)}`;
  const basePath = `${directory}/${fileName}`;
  const existing = new Set(existingPaths.map(normalizePath));

  for (let copyNumber = 0; copyNumber < MAX_DUPLICATE_ATTEMPTS; copyNumber += 1) {
    const candidate =
      copyNumber === 0
        ? basePath
        : duplicateCandidate(basePath, copyNumber);
    if (existing.has(candidate)) continue;

    const result = prepareNewThemeFile(candidate, existingPaths);
    if (!result.ok) return result;
    return { ...result, content };
  }

  return {
    ok: false,
    message: "Could not find an available page-specific component path.",
  };
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
