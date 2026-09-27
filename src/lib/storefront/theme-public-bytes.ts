import { describeSvgRefusal, validateSvg } from "@/lib/security/svg-validation";

import {
  isThemePublicSvgPath,
  THEME_PUBLIC_LIMITS,
  themePublicBytesMatch,
} from "./theme-public-files";

/**
 * Whether bytes may be stored at a `public/` path: the one check every write
 * of new bytes goes through — an upload, a copy from the media library, and a
 * project import — and that publish repeats on the frozen revision.
 *
 * An SVG is parsed by `validateSvg` and refused with its reason; it is never
 * rewritten, so what passes is stored byte for byte. Anything else must carry
 * the signature of the format its name says. The path itself is the
 * contract's to judge first (`checkThemePublicPath`), which is also where SVG
 * is still refused while `themePublicSvgGate` is closed.
 *
 * Server-only, and a module of its own for that reason: the SVG parser has no
 * business in the browser bundle `theme-public-files.ts` is part of.
 */
export function checkThemePublicBytes(
  path: string,
  bytes: Uint8Array,
): { ok: true } | { ok: false; message: string } {
  if (isThemePublicSvgPath(path)) {
    // Refused before parsing, so a large file costs nothing to turn away.
    if (bytes.byteLength > THEME_PUBLIC_LIMITS.maxSvgBytes) {
      return {
        ok: false,
        message: `SVG files are limited to ${THEME_PUBLIC_LIMITS.maxSvgBytes / 1024 / 1024} MB.`,
      };
    }
    const verdict = validateSvg(bytes);
    return verdict.ok
      ? { ok: true }
      : { ok: false, message: describeSvgRefusal(verdict) };
  }
  return themePublicBytesMatch(path, bytes)
    ? { ok: true }
    : {
        ok: false,
        message: "The file's content is not the format its name says.",
      };
}
