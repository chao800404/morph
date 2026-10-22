import { parse, type ParseResult } from "@babel/parser";

export type ParsedThemeAst = ParseResult;

export const THEME_SOURCE_AST_LIMIT_BYTES = 512 * 1024;

type ThemeSourceFile = Readonly<{
  path: string;
  content?: string | null;
}>;

type ThemeSourceAstResult =
  | Readonly<{ ok: true; ast: ParseResult }>
  | Readonly<{
      ok: false;
      reason: "missing-source" | "too-large" | "syntax";
      message: string;
    }>;

type CachedAst = Readonly<{
  path: string;
  content: string;
  result: ThemeSourceAstResult;
}>;

/**
 * AST is derived only from a particular source object, path and byte content.
 * Weak keys ensure this cache cannot retain an old Theme snapshot. A caller
 * that reuses a file object after changing its contents gets a fresh parse.
 */
const astBySource = new WeakMap<object, CachedAst>();

function utf8LengthUpToLimit(source: string): number {
  let bytes = 0;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < source.length &&
      source.charCodeAt(index + 1) >= 0xdc00 &&
      source.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > THEME_SOURCE_AST_LIMIT_BYTES) return bytes;
  }
  return bytes;
}

export function parseThemeSourceAst(file: ThemeSourceFile): ThemeSourceAstResult {
  const content = file.content;
  if (typeof content !== "string") {
    return {
      ok: false,
      reason: "missing-source",
      message: `Theme source "${file.path}" is unavailable.`,
    };
  }

  const cached = astBySource.get(file as object);
  if (cached?.path === file.path && cached.content === content) {
    return cached.result;
  }

  let result: ThemeSourceAstResult;
  if (utf8LengthUpToLimit(content) > THEME_SOURCE_AST_LIMIT_BYTES) {
    result = {
      ok: false,
      reason: "too-large",
      message: `Theme source "${file.path}" exceeds the 512 KiB binding-analysis limit.`,
    };
  } else {
    try {
      result = {
        ok: true,
        ast: parse(content, {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
        }),
      };
    } catch (error) {
      result = {
        ok: false,
        reason: "syntax",
        message:
          error instanceof Error
            ? error.message
            : `Theme source "${file.path}" could not be parsed.`,
      };
    }
  }

  astBySource.set(file as object, { path: file.path, content, result });
  return result;
}
