import { parse } from "@babel/parser";
import type {
  ThemeCompilerDiagnostic,
  ThemeCompilerFile,
} from "./theme-compiler.types";

export type ScannedThemeFilesystem = {
  candidates: string[];
  cssFiles: Array<{ path: string; content: string }>;
  diagnostics: ThemeCompilerDiagnostic[];
};

/**
 * Cleans extracted candidate token while preserving valid Tailwind syntax
 * including bracketed values text-[64px] and theme variables bg-(--brand-color).
 */
export function cleanCandidateToken(token: string): string {
  let cleaned = token.replace(/^[\s"'`<>=;,{}]+|[\s"'`<>=;,{}]+$/g, "");

  // If wrapped entirely in parens e.g. "(active)" or "(isDark)"
  while (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  // Strip stray leading paren e.g. "(text-4xl" -> "text-4xl"
  if (cleaned.startsWith("(") && !cleaned.includes(")")) {
    cleaned = cleaned.slice(1);
  }
  // Strip stray trailing paren e.g. "text-4xl)" -> "text-4xl"
  if (cleaned.endsWith(")") && !cleaned.includes("(")) {
    cleaned = cleaned.slice(0, -1);
  }

  // Strip leading/trailing colons or dots if outside brackets
  if (!cleaned.includes("[")) {
    cleaned = cleaned.replace(/^[:./]+|[:./]+$/g, "");
  }

  return cleaned;
}

/**
 * Extracts candidate tokens from source text using Tailwind candidate tokenization,
 * preserving bracketed arbitrary values e.g. text-[64px], lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)],
 * [&>img]:object-cover, supports-[display:grid]:grid, bg-[#ff0055], bg-(--brand-color).
 */
export function extractCandidateTokens(text: string, out: Set<string>) {
  if (!text) return;

  let current = "";
  let bracketDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "[") {
      bracketDepth++;
      current += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ch;
      continue;
    }

    if (bracketDepth > 0) {
      current += ch;
      continue;
    }

    // Delimiters outside brackets: whitespace, quotes, backticks, <, >, =, ;, ,, {, }
    if (/[\s"'`<=;,{}]/.test(ch)) {
      const trimmed = current.trim();
      if (trimmed && trimmed.length <= 256) {
        const cleaned = cleanCandidateToken(trimmed);
        if (
          cleaned &&
          !/^(true|false|null|undefined|return|function|const|let|var|import|export|default|from|className|class)$/.test(
            cleaned,
          )
        ) {
          out.add(cleaned);
        }
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const finalTrimmed = current.trim();
  if (finalTrimmed && finalTrimmed.length <= 256) {
    const cleaned = cleanCandidateToken(finalTrimmed);
    if (
      cleaned &&
      !/^(true|false|null|undefined|return|function|const|let|var|import|export|default|from|className|class)$/.test(
        cleaned,
      )
    ) {
      out.add(cleaned);
    }
  }
}

/**
 * Scans the complete theme virtual filesystem:
 * - Validates TSX/JSX syntax via AST parser, capturing syntax diagnostics
 * - Validates manifest JSON files
 * - Extracts candidate tokens for Tailwind compilation
 */
export function scanThemeVirtualFilesystem(
  files: ThemeCompilerFile[],
): ScannedThemeFilesystem {
  const candidateSet = new Set<string>();
  const cssFiles: Array<{ path: string; content: string }> = [];
  const diagnostics: ThemeCompilerDiagnostic[] = [];

  for (const file of files) {
    if (!file.content) continue;

    // 1. CSS Files
    if (file.path.endsWith(".css")) {
      cssFiles.push({ path: file.path, content: file.content });
      continue;
    }

    // 2. TSX / JSX / TS / JS Source Files
    if (/\.(tsx|jsx|ts|js)$/.test(file.path)) {
      try {
        parse(file.content, {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
          errorRecovery: false,
        });
      } catch (err: any) {
        diagnostics.push({
          level: "error",
          message: err.message || "Syntax error in source file",
          filePath: file.path,
          line: err.loc?.line,
          column: err.loc?.column,
        });
      }

      // Extract candidate tokens from source text
      extractCandidateTokens(file.content, candidateSet);
      continue;
    }

    // 3. Manifest / Config JSON Files
    if (file.path.endsWith(".json")) {
      if (file.path === "morph.theme.json") {
        try {
          JSON.parse(file.content);
        } catch (err: any) {
          diagnostics.push({
            level: "warning",
            message: `Malformed JSON in ${file.path}: ${err.message}`,
            filePath: file.path,
          });
        }
      }
      extractCandidateTokens(file.content, candidateSet);
    }
  }

  return {
    candidates: Array.from(candidateSet),
    cssFiles,
    diagnostics,
  };
}
