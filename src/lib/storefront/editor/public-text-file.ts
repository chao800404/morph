import type {
  StorefrontThemeBinaryFileDTO,
  StorefrontThemeFileDTO,
} from "../dto/storefront-theme-file.dto";
import {
  isThemePublicPath,
  themePublicTextMimeType,
  THEME_PUBLIC_LIMITS,
} from "../theme-public-files";

/** An editor projection only. The persisted file remains immutable bytes. */
export function projectPublicTextFile(
  file: StorefrontThemeBinaryFileDTO,
  bytes: Uint8Array,
): StorefrontThemeFileDTO {
  if (!isThemePublicPath(file.path) || !themePublicTextMimeType(file.path)) {
    throw new Error("This public file cannot be edited as text.");
  }
  if (
    file.sizeBytes > THEME_PUBLIC_LIMITS.maxFileBytes ||
    bytes.byteLength !== file.sizeBytes
  ) {
    throw new Error("Public text file size does not match its metadata.");
  }
  // Preserve a UTF-8 BOM as a character so an unchanged save preserves bytes.
  const content = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  const {
    encoding: _encoding,
    blobDigest: _digest,
    sizeBytes: _size,
    ...metadata
  } = file;
  return { ...metadata, content, encoding: "utf8" };
}

export function isEditablePublicTextPath(path: string): boolean {
  return isThemePublicPath(path) && themePublicTextMimeType(path) !== null;
}
