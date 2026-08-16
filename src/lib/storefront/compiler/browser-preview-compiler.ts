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

    // 2. Prepare virtual CSS map
    const virtualCssMap = new Map<string, string>();
    for (const cssFile of scanResult.cssFiles) {
      virtualCssMap.set(cssFile.path, cssFile.content);
      // Also map basename without path e.g. "global.css"
      const basename = cssFile.path.split("/").pop();
      if (basename) {
        virtualCssMap.set(basename, cssFile.content);
      }
    }

    // Determine root CSS
    let rootCss = virtualCssMap.get("src/styles/global.css");
    if (!rootCss && scanResult.cssFiles.length > 0) {
      rootCss = scanResult.cssFiles.map((f) => f.content).join("\n\n");
    }
    if (!rootCss) {
      rootCss = `@import "tailwindcss";`;
    }

    // 3. Compile with official Tailwind CSS v4 compiler engine (only if no fatal syntax errors)
    let compiledCss: string | undefined = undefined;

    if (!hasFatalErrors) {
      try {
        const compiler = await tailwindCompile(rootCss, {
          base: "/",
          loadStylesheet: async (id: string, base: string) => {
            // A. Check built-in Tailwind core stylesheets
            if (BUILTIN_STYLESHEETS[id]) {
              return {
                path: id,
                base: base || "/",
                content: BUILTIN_STYLESHEETS[id],
              };
            }

            // B. Check virtual stylesheets from theme
            const normalizedId = id.startsWith("./") ? id.slice(2) : id;
            if (virtualCssMap.has(id)) {
              return {
                path: id,
                base: base || "/",
                content: virtualCssMap.get(id)!,
              };
            }
            if (virtualCssMap.has(normalizedId)) {
              return {
                path: normalizedId,
                base: base || "/",
                content: virtualCssMap.get(normalizedId)!,
              };
            }
            if (virtualCssMap.has(`src/styles/${normalizedId}`)) {
              return {
                path: `src/styles/${normalizedId}`,
                base: base || "/",
                content: virtualCssMap.get(`src/styles/${normalizedId}`)!,
              };
            }

            throw new Error(`Unable to resolve stylesheet import: "${id}"`);
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
