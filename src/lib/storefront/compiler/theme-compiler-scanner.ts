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
 * Extracts candidate tokens from source text using standard Tailwind whitespace/delimiter tokenization,
 * preserving bracketed arbitrary values e.g. text-[64px], lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)],
 * [&>img]:object-cover, supports-[display:grid]:grid, bg-[#ff0055].
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

    // Delimiters outside brackets: whitespace, quotes, backticks, <, >, =, ;, ,, (, ), {, }
    if (/[\s"'`<=;,(){}]/.test(ch)) {
      const trimmed = current.trim();
      if (trimmed && trimmed.length <= 256) {
        const cleaned = trimmed.replace(/^[:./]|[:./]$/g, "");
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

  const finalTrimmed = current.trim().replace(/^[:./]|[:./]$/g, "");
  if (
    finalTrimmed &&
    finalTrimmed.length <= 256 &&
    !/^(true|false|null|undefined|return|function|const|let|var|import|export|default|from|className|class)$/.test(
      finalTrimmed,
    )
  ) {
    out.add(finalTrimmed);
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
