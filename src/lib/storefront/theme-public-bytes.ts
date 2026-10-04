import { describeSvgRefusal, validateSvg } from "@/lib/security/svg-validation";
import { SaxesParser } from "saxes";

import {
  isThemePublicSvgPath,
  THEME_PUBLIC_LIMITS,
  themePublicBytesMatch,
  themePublicTextMimeType,
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
  const textType = themePublicTextMimeType(path);
  if (textType) {
    if (bytes.byteLength > THEME_PUBLIC_LIMITS.maxFileBytes) {
      return {
        ok: false,
        message: `Files are limited to ${THEME_PUBLIC_LIMITS.maxFileBytes / 1024 / 1024} MB.`,
      };
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, message: "The file must contain valid UTF-8 text." };
    }
    if (content.includes("\0")) {
      return { ok: false, message: "Text files cannot contain null bytes." };
    }
    if (
      textType.startsWith("application/json") ||
      textType.startsWith("application/manifest+json")
    ) {
      try {
        const value: unknown = JSON.parse(content);
        if (
          textType.startsWith("application/manifest+json") &&
          (value === null || typeof value !== "object" || Array.isArray(value))
        ) {
          return {
            ok: false,
            message: "A web manifest must be a JSON object.",
          };
        }
      } catch {
        return { ok: false, message: "The file must contain valid JSON." };
      }
    }
    if (textType.startsWith("application/xml")) {
      try {
        // Data XML only, not another way to upload executable SVG/XHTML/XSLT.
        // Saxes never fetches entities. Abort on DOCTYPE before processing it.
        const parser = new SaxesParser({ xmlns: true });
        let depth = 0;
        parser.on("xmldecl", (declaration) => {
          if (
            declaration.encoding &&
            declaration.encoding.toLowerCase() !== "utf-8"
          ) {
            throw new Error("XML declarations must use UTF-8.");
          }
        });
        parser.on("error", (error) => {
          throw error;
        });
        parser.on("doctype", () => {
          throw new Error("DOCTYPE is not allowed.");
        });
        parser.on("processinginstruction", () => {
          throw new Error("Processing instructions are not allowed.");
        });
        parser.on("opentag", (tag) => {
          if (++depth > 128) throw new Error("XML nesting exceeds 128 levels.");
          if (
            [
              "http://www.w3.org/2000/svg",
              "http://www.w3.org/1999/xhtml",
              "http://www.w3.org/1999/XSL/Transform",
            ].includes(tag.uri) ||
            ["svg", "html", "script", "style"].includes(tag.local.toLowerCase())
          ) {
            throw new Error(
              "Executable document elements are not allowed in data XML.",
            );
          }
        });
        parser.on("closetag", () => {
          depth--;
        });
        parser.write(content).close();
      } catch (error) {
        return {
          ok: false,
          message: `The file must contain safe, well-formed data XML (${error instanceof Error ? error.message.slice(0, 200) : "invalid XML"}).`,
        };
      }
    }
    return { ok: true };
  }
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
