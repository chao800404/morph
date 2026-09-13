import { isPlatformOwnedThemeBuildPath } from "./theme-start-toolchain";

export const THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH =
  ".morph-preview-workspace.sha256";

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

  if (normalized === THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH) {
    return `RESERVED_THEME_PREVIEW_PATH: Theme source cannot replace platform-owned preview file "${path}"`;
  }

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

/**
 * Whether the container writes this file for itself.
 *
 * `package.json` belongs to the Theme — the author writes it, and it is
 * stored and versioned with the Theme — but the workspace replaces it on the
 * way in with a manifest pinned to the toolchain the container actually has
 * installed. So the copy on disk is never the copy the editor holds, and it
 * is not supposed to be.
 *
 * A running preview therefore has to leave it alone. Writing the authored one
 * would swap the dependency manifest out from under Vite, and because the two
 * can never agree, every sync would report a file it had changed — a change
 * no hot update can arrive to confirm, since `package.json` is in no module
 * graph. The editor would then wait for an acknowledgement that cannot come.
 *
 * Not a refusal: the editor is right to send it, and a Theme is right to
 * carry it. It simply is not the file the container is serving.
 */
export function isWorkspaceGeneratedThemePath(path: string): boolean {
  return path.replace(/\\/g, "/") === "package.json";
}
