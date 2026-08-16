import { compile as tailwindCompile } from "tailwindcss";
import { BUILTIN_STYLESHEETS, TAILWIND_VERSION } from "./tailwind-builtin-stylesheets";
import { computeThemeInputHash } from "./theme-compiler-hasher";
import { scanThemeVirtualFilesystem } from "./theme-compiler-scanner";
import type {
  ThemeCompiler,
  ThemeCompilerDiagnostic,
  ThemeCompilerInput,
  ThemeCompilerResult,
} from "./theme-compiler.types";

/**
 * Normalizes a virtual file path, resolving '.' and '..' relative segments.
 */
export function normalizeVirtualPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

/**
 * Resolves a virtual stylesheet import path relative to a base directory.
 */
export function resolveVirtualCssPath(baseDir: string, importPath: string): string {
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    const combined = baseDir ? `${baseDir}/${importPath}` : importPath;
    return normalizeVirtualPath(combined);
  }
  return normalizeVirtualPath(importPath);
}

/**
 * Returns the base directory of a virtual file path.
 */
export function getVirtualBaseDir(filePath: string): string {
  const normalized = normalizeVirtualPath(filePath);
  const idx = normalized.lastIndexOf("/");
  return idx !== -1 ? normalized.slice(0, idx) : "";
}

/**
 * BrowserPreviewThemeCompiler
 *
 * Implements the unified ThemeCompiler contract for Preview and in-memory compilation.
 * Compiles virtual theme CSS and source files with the official Tailwind CSS v4 compiler engine,
 * generating fully-built static CSS stylesheets with preflight, layers, variants, and arbitrary values.
 */
export class BrowserPreviewThemeCompiler implements ThemeCompiler {
  readonly id = "tailwind-v4-preview";
  readonly version = TAILWIND_VERSION;

  async compile(
    input: ThemeCompilerInput,
    options?: { inputHash?: string },
  ): Promise<ThemeCompilerResult> {
    const inputHash =
      options?.inputHash ??
      computeThemeInputHash(input, { id: this.id, version: this.version });
    const now = new Date().toISOString();
    const diagnostics: ThemeCompilerDiagnostic[] = [];

    // 1. Scan complete virtual filesystem for diagnostics and candidate tokens
    const scanResult = scanThemeVirtualFilesystem(input.files);
    diagnostics.push(...scanResult.diagnostics);

    const hasFatalErrors = diagnostics.some((d) => d.level === "error");

    // 2. Prepare virtual CSS map with normalized paths
    const virtualCssMap = new Map<string, string>();
    for (const cssFile of scanResult.cssFiles) {
      const normalizedPath = normalizeVirtualPath(cssFile.path);
      virtualCssMap.set(normalizedPath, cssFile.content);
    }

    // Determine root CSS and its base directory
    let rootPath = "src/styles/global.css";
    let rootCss = virtualCssMap.get(rootPath);

    if (!rootCss && scanResult.cssFiles.length > 0) {
      rootPath = normalizeVirtualPath(scanResult.cssFiles[0].path);
      rootCss = virtualCssMap.get(rootPath);
    }

    if (!rootCss) {
      rootPath = "src/styles/global.css";
      rootCss = `@import "tailwindcss";`;
    }

    const initialBaseDir = getVirtualBaseDir(rootPath);

    // 3. Compile with official Tailwind CSS v4 compiler engine (only if no fatal syntax errors)
    let compiledCss: string | undefined = undefined;

    if (!hasFatalErrors) {
      try {
        const compiler = await tailwindCompile(rootCss, {
          base: initialBaseDir,
          loadStylesheet: async (id: string, base: string) => {
            // A. Check built-in Tailwind core stylesheets
            if (BUILTIN_STYLESHEETS[id]) {
              return {
                path: id,
                base: base || "",
                content: BUILTIN_STYLESHEETS[id],
              };
            }

            // B. Resolve relative or absolute path against virtual filesystem
            const candidatePaths = [
              resolveVirtualCssPath(base, id),
              resolveVirtualCssPath(initialBaseDir, id),
              normalizeVirtualPath(id),
              resolveVirtualCssPath("src/styles", id),
            ];

            for (const candidate of candidatePaths) {
              if (virtualCssMap.has(candidate)) {
                return {
                  path: candidate,
                  base: getVirtualBaseDir(candidate),
                  content: virtualCssMap.get(candidate)!,
                };
              }
            }

            throw new Error(
              `Unable to resolve virtual stylesheet import: "${id}" from base "${base}"`,
            );
          },
        });

        // Build CSS for all extracted candidate tokens
        compiledCss = compiler.build(scanResult.candidates);
      } catch (err: any) {
        diagnostics.push({
          level: "error",
          message: err.message || "Failed to compile theme stylesheet",
        });
      }
    }

    return {
      success: !hasFatalErrors && compiledCss !== undefined,
      inputHash,
      css: compiledCss,
      diagnostics,
      sourceGeneration: input.sourceGeneration,
      tokensCount: scanResult.candidates.length,
      compiledAt: now,
    };
  }
}
