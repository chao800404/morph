import {
  isBinaryThemeFile,
  type StorefrontThemeWorkspaceEntryDTO,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import type {
  ThemeWorkspaceBinaryLoader,
  ThemeWorkspaceFile,
} from "@/lib/storefront/compiler/theme-sandbox-workspace";

/**
 * What a Live Preview is started from: every file of the workspace, binary
 * files by reference, and the one way to read a binary file's bytes.
 *
 * Source files alone would start a preview whose `public/` is empty, and
 * every image on it broken. The bytes are not read here: a start names them,
 * and each is read only as it is written (`materializeThemeSandboxWorkspace`),
 * through a reader that checks them against their digest.
 */
export type ThemePreviewWorkspaceInput = Readonly<{
  files: readonly ThemeWorkspaceFile[];
  /** The Theme's entry file, which is always source. */
  entry: string | null;
  fileVersions: Readonly<Record<string, number>>;
  loadBinary: ThemeWorkspaceBinaryLoader;
}>;

export function themePreviewWorkspaceInput(
  entries: readonly StorefrontThemeWorkspaceEntryDTO[],
  /** Reads bytes by digest, refusing any that do not hash to it. */
  readBinaryFile: (digest: string) => Promise<Uint8Array>,
): ThemePreviewWorkspaceInput {
  return {
    files: entries.map((entry): ThemeWorkspaceFile =>
      isBinaryThemeFile(entry)
        ? {
            path: entry.path,
            binary: { digest: entry.blobDigest, sizeBytes: entry.sizeBytes },
          }
        : { path: entry.path, content: entry.content },
    ),
    entry:
      entries.find((entry) => !isBinaryThemeFile(entry) && entry.isEntry)
        ?.path ?? null,
    fileVersions: Object.fromEntries(
      entries.map((entry) => [entry.path, entry.version]),
    ),
    loadBinary: (ref) => readBinaryFile(ref.digest),
  };
}
