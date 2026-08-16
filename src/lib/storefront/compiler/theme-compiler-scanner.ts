import { parse } from "@babel/parser";
import type {
  ThemeCompilerDiagnostic,
  ThemeCompilerFile,
} from "./theme-compiler.types";

export type ScannedThemeTokens = {
  classes: Set<string>;
  cssFiles: Array<{ path: string; content: string }>;
  diagnostics: ThemeCompilerDiagnostic[];
};

/**
 * Extracts class strings from AST nodes recursively.
 */
function extractClassesFromNode(node: any, out: Set<string>) {
  if (!node || typeof node !== "object") return;

  // 1. StringLiteral
  if (node.type === "StringLiteral" && typeof node.value === "string") {
    addCandidateTokens(node.value, out);
    return;
  }

  // 2. TemplateLiteral
  if (node.type === "TemplateLiteral" && Array.isArray(node.quasis)) {
    for (const quasi of node.quasis) {
      if (typeof quasi.value?.raw === "string") {
        addCandidateTokens(quasi.value.raw, out);
      }
    }
  }

  // 3. JSXAttribute (className / class)
  if (node.type === "JSXAttribute" && node.name?.name && /^(className|class)$/.test(node.name.name)) {
    if (node.value?.type === "StringLiteral" && typeof node.value.value === "string") {
      addCandidateTokens(node.value.value, out);
    } else if (node.value?.type === "JSXExpressionContainer") {
      extractClassesFromNode(node.value.expression, out);
    }
    return;
  }

  // 4. CallExpression (cn, clsx, cva, etc.)
  if (node.type === "CallExpression") {
    if (Array.isArray(node.arguments)) {
      for (const arg of node.arguments) {
        extractClassesFromNode(arg, out);
      }
    }
  }

  // 5. LogicalExpression (active && "text-red-500") / ConditionalExpression (cond ? "a" : "b")
  if (node.type === "LogicalExpression") {
    extractClassesFromNode(node.left, out);
    extractClassesFromNode(node.right, out);
    return;
  }
  if (node.type === "ConditionalExpression") {
    extractClassesFromNode(node.consequent, out);
    extractClassesFromNode(node.alternate, out);
    return;
  }

  // 6. ArrayExpression / ObjectExpression
  if (node.type === "ArrayExpression" && Array.isArray(node.elements)) {
    for (const el of node.elements) {
      extractClassesFromNode(el, out);
    }
    return;
  }
  if (node.type === "ObjectExpression" && Array.isArray(node.properties)) {
    for (const prop of node.properties) {
      if (prop.type === "ObjectProperty") {
        extractClassesFromNode(prop.key, out);
        extractClassesFromNode(prop.value, out);
      }
    }
    return;
  }

  // Traverse children
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        extractClassesFromNode(item, out);
      }
    } else if (child && typeof child === "object") {
      extractClassesFromNode(child, out);
    }
  }
}

/**
 * Splits text into candidate Tailwind class tokens respecting brackets and quotes.
 */
export function addCandidateTokens(text: string, out: Set<string>) {
  if (!text) return;
  // Match whitespace-separated class names, respecting arbitrary values with brackets like [clamp(1.75rem,6vw,6rem)] or [&>img]:...
  // A robust token tokenizer splitting on top-level whitespace
  let current = "";
  let bracketDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let inQuote: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuote) {
      if (ch === inQuote && text[i - 1] !== "\\") {
        inQuote = null;
      }
      current += ch;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inQuote = ch;
      current += ch;
      continue;
    }

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
    if (ch === "(") {
      parenDepth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
      continue;
    }
    if (ch === "{") {
      braceDepth++;
      current += ch;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      current += ch;
      continue;
    }

    if (/\s/.test(ch) && bracketDepth === 0 && parenDepth === 0 && braceDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        // Clean outer wrapping punctuation if any
        const cleaned = trimmed.replace(/^[\'\"]|[\'\"]$/g, "");
        if (cleaned && isValidClassCandidate(cleaned)) {
          out.add(cleaned);
        }
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const finalTrimmed = current.trim().replace(/^[\'\"]|[\'\"]$/g, "");
  if (finalTrimmed && isValidClassCandidate(finalTrimmed)) {
    out.add(finalTrimmed);
  }
}

function isValidClassCandidate(token: string): boolean {
  if (token.length > 256) return false;
  // Ignore purely template expressions or invalid syntax
  if (token.startsWith("${") || token.endsWith("}")) return false;
  if (/^(true|false|null|undefined|return|function|const|let|var)$/.test(token)) return false;
  return true;
}

/**
 * Scans the complete theme virtual filesystem for Tailwind classes, CSS files, and diagnostics.
 */
export function scanThemeVirtualFilesystem(
  files: ThemeCompilerFile[],
): ScannedThemeTokens {
  const classes = new Set<string>();
  const cssFiles: Array<{ path: string; content: string }> = [];
  const diagnostics: ThemeCompilerDiagnostic[] = [];

  for (const file of files) {
    if (!file.content) continue;

    // CSS Files
    if (file.path.endsWith(".css")) {
      cssFiles.push({ path: file.path, content: file.content });
      // Also scan comments or utility definitions in CSS if present
      continue;
    }

    // TSX / JSX / TS / JS Source Files
    if (/\.(tsx|jsx|ts|js)$/.test(file.path)) {
      try {
        const ast = parse(file.content, {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
          errorRecovery: true,
        });

        if (Array.isArray((ast as any).errors) && (ast as any).errors.length > 0) {
          for (const err of (ast as any).errors) {
            diagnostics.push({
              level: "warning",
              message: err.message || "Parse error in source file",
              filePath: file.path,
              line: err.loc?.line,
              column: err.loc?.column,
            });
          }
        }

        extractClassesFromNode(ast, classes);
      } catch (err: any) {
        diagnostics.push({
          level: "error",
          message: err.message || "Failed to parse source file",
          filePath: file.path,
          line: err.loc?.line,
          column: err.loc?.column,
        });
      }
      continue;
    }

    // JSON or other files (e.g. morph.theme.json, package.json)
    if (file.path.endsWith(".json") || file.path.endsWith(".html")) {
      addCandidateTokens(file.content, classes);
    }
  }

  return {
    classes,
    cssFiles,
    diagnostics,
  };
}
