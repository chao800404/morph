import { isPlatformOwnedThemeBuildPath } from "./theme-start-toolchain";

/**
 * Whether a Theme file may be written into a container workspace.
 *
 * Shared, because two things write Theme files into a container now — a build
 * laying a workspace out, and a Live Preview updating one that is already
 * running — and a rule that only one of them applied would be a way in
 * through whichever forgot it.
 *
 * Returns the reason it is refused, or `null` when the path is fine. A reason
 * rather than a boolean so the caller can tell the author which rule they
 * met, which for a path they typed themselves is the whole of the answer.
 */
export function refuseThemeWorkspacePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");

  if (
    normalized
      .split("/")
      .some((segment) => segment.toLowerCase() === "node_modules")
  ) {
    return `RESERVED_THEME_PATH: Theme files cannot be created inside node_modules: "${path}"`;
  }

  if (isPlatformOwnedThemeBuildPath(normalized)) {
    return `RESERVED_THEME_BUILD_PATH: Theme source cannot replace platform-owned build file "${path}"`;
  }

  if (
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.startsWith("/")
  ) {
    return `WORKSPACE_PATH_ESCAPE: File path "${path}" escapes sandbox workspace root`;
  }

  return null;
}
