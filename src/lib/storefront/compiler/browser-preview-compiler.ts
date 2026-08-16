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
 * Implements the ThemeCompiler contract for Preview / in-browser authoring.
 * Ingests the complete Theme virtual filesystem, validates syntax,
 * scans Tailwind class tokens across all files (including TSX, CSS, JSON),
 * and generates compiled stylesheet artifacts with full Tailwind CSS v4 support.
 */
export class BrowserPreviewThemeCompiler implements ThemeCompiler {
  private readonly compilerVersion = "4.0.0-preview";

  async compile(input: ThemeCompilerInput): Promise<ThemeCompilerResult> {
    const inputHash = computeThemeInputHash({
      ...input,
      compilerVersion: this.compilerVersion,
    });
    const now = new Date().toISOString();

    const diagnostics: ThemeCompilerDiagnostic[] = [];

    // 1. Scan complete virtual filesystem
    const scanResult = scanThemeVirtualFilesystem(input.files);
    diagnostics.push(...scanResult.diagnostics);

    const hasFatalErrors = diagnostics.some((d) => d.level === "error");

    // 2. Assemble theme stylesheet from virtual CSS files
    const cssBlocks: string[] = [];

    for (const cssFile of scanResult.cssFiles) {
      cssBlocks.push(`/* ${cssFile.path} */\n${cssFile.content}`);
    }

    // 3. In the browser runtime, ensure Tailwind v4 compiler is initialized
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      this.ensureTailwindBrowserRuntime();
    }

    const compiledCss = cssBlocks.join("\n\n");

    return {
      success: !hasFatalErrors,
      inputHash,
      css: compiledCss,
      diagnostics,
      sourceGeneration: input.sourceGeneration,
      tokensCount: scanResult.classes.size,
      compiledAt: now,
    };
  }

  private ensureTailwindBrowserRuntime() {
    if (typeof document === "undefined") return;

    let script = document.getElementById("morph-tailwind-cdn") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "morph-tailwind-cdn";
      script.src = "https://unpkg.com/@tailwindcss/browser@4";
      script.async = true;
      document.head.appendChild(script);
    }
  }
}
