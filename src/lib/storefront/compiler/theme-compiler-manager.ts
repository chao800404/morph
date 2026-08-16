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
 * Coordinates theme compilation jobs, memory caching by inputHash,
 * in-flight request deduplication, sequence-guarded job superseding,
 * and last-known-good result retention against out-of-order race conditions.
 */
export class ThemeCompilerManager {
  private cache = new Map<string, ThemeCompilerCacheEntry>();
  private inFlight = new Map<string, Promise<ThemeCompilerResult>>();
  private lastKnownGood = new Map<string, ThemeCompilerResult>();
  private themeSequences = new Map<string, number>();
  private defaultCompiler: ThemeCompiler;

  constructor(compiler?: ThemeCompiler) {
    this.defaultCompiler = compiler ?? new BrowserPreviewThemeCompiler();
  }

  async compile(
    input: ThemeCompilerInput,
    compiler?: ThemeCompiler,
  ): Promise<ThemeCompilerResult> {
    const targetCompiler = compiler ?? this.defaultCompiler;
    const themeKey = input.themeId ?? "default";

    // 1. Unified, single identity inputHash based on compiler id & version
    const inputHash = computeThemeInputHash(input, {
      id: targetCompiler.id,
      version: targetCompiler.version,
    });

    // 2. Cache hit check (content-addressed, updates caller's sourceGeneration metadata)
    const cached = this.cache.get(inputHash);
    if (cached) {
      return {
        ...cached.result,
        sourceGeneration: input.sourceGeneration,
      };
    }

    // 3. In-flight deduplication
    const existingFlight = this.inFlight.get(inputHash);
    if (existingFlight) {
      const flightResult = await existingFlight;
      return {
        ...flightResult,
        sourceGeneration: input.sourceGeneration,
      };
    }

    // 4. Sequence guard: record latest request sequence for this theme to prevent out-of-order race
    const currentSeq = (this.themeSequences.get(themeKey) ?? 0) + 1;
    this.themeSequences.set(themeKey, currentSeq);

    // 5. Launch compilation
    const compilePromise = (async () => {
      try {
        const result = await targetCompiler.compile(input, { inputHash });

        // Store in cache
        this.cache.set(inputHash, {
          result,
          timestamp: Date.now(),
          sourceGeneration: input.sourceGeneration,
        });

        // Sequence guard: only update last-known-good if this is still the newest compile job
        if (currentSeq === this.themeSequences.get(themeKey)) {
          if (result.success && result.css) {
            this.lastKnownGood.set(themeKey, result);
          }
        }

        // If compile failed, attach last known good CSS if available so preview remains visual
        if (!result.success) {
          const fallback = this.lastKnownGood.get(themeKey);
          if (fallback?.css) {
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
    this.themeSequences.clear();
  }
}

export const themeCompilerManager = new ThemeCompilerManager();
