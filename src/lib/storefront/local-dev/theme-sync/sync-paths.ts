import { isThemeAuthoringRefusedPath } from "../../compiler/theme-start-toolchain";
import { themeTextFilePathSchema } from "../../../validations/storefront-theme-file";

/**
 * Which paths local sync carries, in either direction.
 *
 * One rule for both ends: `morph-sync` skips these when it scans the local
 * folder and when it reads the workspace, and the sync API refuses a write to
 * any of them whatever the client claims. Shared so the two cannot drift.
 *
 * - Platform files a Theme cannot author (`isThemeAuthoringRefusedPath`).
 * - `src/routeTree.gen.ts`: the router plugin regenerates it on every local
 *   dev start; carrying it would turn each start into a write.
 * - `morph.theme.json`: a manifest-era Theme's manifest changes only through
 *   the server-owned migration, never as a file save.
 * - `public/`: images and fonts are uploaded as bytes, not text. Not carried
 *   yet; `morph-sync` says which files it left out.
 * - What only exists on the developer's machine: dependencies, VCS data,
 *   build output, local secrets, and sync's own files.
 * - Anything the editor itself would refuse as a text path.
 */

const LOCAL_ONLY_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".morph",
  ".wrangler",
  ".output",
  ".tanstack",
  ".vinxi",
  ".vite",
  ".turbo",
  ".cache",
  "dist",
]);

const LOCAL_ONLY_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"]);

export const THEME_SYNC_CONFLICT_SUFFIX = ".morph-remote";

export type ThemeSyncPathExclusion =
  | "local-only"
  | "platform-owned"
  | "generated"
  | "legacy-manifest"
  | "binary-directory"
  | "invalid-path";

export function themeSyncPathExclusion(
  rawPath: string,
): ThemeSyncPathExclusion | null {
  const path = rawPath.replace(/\\/g, "/");
  const segments = path.split("/");
  const name = segments.at(-1) ?? "";
  if (segments.some((segment) => LOCAL_ONLY_DIRECTORIES.has(segment))) {
    return "local-only";
  }
  if (
    LOCAL_ONLY_FILE_NAMES.has(name) ||
    name.startsWith(".env") ||
    name.startsWith(".dev.vars") ||
    name.endsWith(THEME_SYNC_CONFLICT_SUFFIX) ||
    name.endsWith(".morph-tmp")
  ) {
    return "local-only";
  }
  if (isThemeAuthoringRefusedPath(path)) return "platform-owned";
  if (path === "src/routeTree.gen.ts") return "generated";
  if (path === "morph.theme.json") return "legacy-manifest";
  if (path.startsWith("public/")) return "binary-directory";
  // The schema trims; a path it would change is not the path on disk.
  const parsed = themeTextFilePathSchema.safeParse(path);
  if (!parsed.success || parsed.data !== path) return "invalid-path";
  return null;
}

export function isThemeSyncPath(path: string): boolean {
  return themeSyncPathExclusion(path) === null;
}
