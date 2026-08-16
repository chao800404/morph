import { BrowserPreviewThemeCompiler } from "./browser-preview-compiler";
import { computeThemeInputHash } from "./theme-compiler-hasher";
import type {
  ThemeCompiler,
  ThemeCompilerCacheEntry,
  ThemeCompilerInput,
  ThemeCompilerResult,
} from "./theme-compiler.types";

/**
 * ThemeCompilerManager
 *
 * Coordinates theme compilation jobs, memory caching by inputHash / sourceGeneration,
 * in-flight request deduplication, job superseding, and last-known-good result retention.
 */
export class ThemeCompilerManager {
  private cache = new Map<string, ThemeCompilerCacheEntry>();
  private inFlight = new Map<string, Promise<ThemeCompilerResult>>();
  private lastKnownGood = new Map<string, ThemeCompilerResult>();
  private defaultCompiler: ThemeCompiler;

  constructor(compiler?: ThemeCompiler) {
    this.defaultCompiler = compiler ?? new BrowserPreviewThemeCompiler();
  }

  async compile(
    input: ThemeCompilerInput,
    compiler?: ThemeCompiler,
  ): Promise<ThemeCompilerResult> {
    const targetCompiler = compiler ?? this.defaultCompiler;
    const inputHash = computeThemeInputHash(input);
    const themeKey = input.themeId ?? "default";

    // 1. Cache hit check
    const cached = this.cache.get(inputHash);
    if (cached) {
      return cached.result;
    }

    // 2. In-flight deduplication
    const existingFlight = this.inFlight.get(inputHash);
    if (existingFlight) {
      return existingFlight;
    }

    // 3. Launch compilation
    const compilePromise = (async () => {
      try {
        const result = await targetCompiler.compile(input);

        // Store in cache
        this.cache.set(inputHash, {
          result,
          timestamp: Date.now(),
          sourceGeneration: input.sourceGeneration,
        });

        // If compile succeeded, update last-known-good
        if (result.success) {
          this.lastKnownGood.set(themeKey, result);
        } else {
          // If compile failed, attach last known good CSS if available so preview remains usable
          const fallback = this.lastKnownGood.get(themeKey);
          if (fallback?.css && !result.css) {
            result.css = fallback.css;
          }
        }

        return result;
      } finally {
        this.inFlight.delete(inputHash);
      }
    })();

    this.inFlight.set(inputHash, compilePromise);
    return compilePromise;
  }

  getLastKnownGood(themeId?: string): ThemeCompilerResult | undefined {
    return this.lastKnownGood.get(themeId ?? "default");
  }

  clearCache() {
    this.cache.clear();
    this.inFlight.clear();
    this.lastKnownGood.clear();
  }
}

export const themeCompilerManager = new ThemeCompilerManager();
