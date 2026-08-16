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
 * Coordinates theme compilation jobs with clean separation between:
 * 1. Raw content-addressed compiler cache (`rawCache` keyed by inputHash)
 * 2. Per-theme last-known-good fallback (`lastKnownGood` keyed by themeKey)
 *
 * Every compile request (cache hit, in-flight deduplicated, or new compile)
 * advances the per-theme request sequence and maintains lastKnownGood accurately.
 */
export class ThemeCompilerManager {
  private rawCache = new Map<string, ThemeCompilerCacheEntry>();
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

    // 1. Unified single identity inputHash based on compiler id & version
    const inputHash = computeThemeInputHash(input, {
      id: targetCompiler.id,
      version: targetCompiler.version,
    });

    // 2. Advance per-theme request sequence for every incoming request
    const currentSeq = (this.themeSequences.get(themeKey) ?? 0) + 1;
    this.themeSequences.set(themeKey, currentSeq);

    // 3. Cache hit check (content-addressed raw cache)
    const cached = this.rawCache.get(inputHash);
    if (cached) {
      // Update per-theme lastKnownGood if this is still the newest request and compile was successful
      if (currentSeq === this.themeSequences.get(themeKey) && cached.result.success && cached.result.css) {
        this.lastKnownGood.set(themeKey, cached.result);
      }
      return {
        ...cached.result,
        sourceGeneration: input.sourceGeneration,
      };
    }

    // 4. In-flight deduplication
    const existingFlight = this.inFlight.get(inputHash);
    if (existingFlight) {
      const flightResult = await existingFlight;
      if (currentSeq === this.themeSequences.get(themeKey) && flightResult.success && flightResult.css) {
        this.lastKnownGood.set(themeKey, flightResult);
      }
      return {
        ...flightResult,
        sourceGeneration: input.sourceGeneration,
      };
    }

    // 5. Launch compilation
    const compilePromise = (async () => {
      try {
        const result = await targetCompiler.compile(input, { inputHash });

        // Store immutable result into raw compiler cache
        this.rawCache.set(inputHash, {
          result,
          timestamp: Date.now(),
          sourceGeneration: input.sourceGeneration,
        });

        // Sequence guard: only update lastKnownGood if this is still the newest request for the theme
        if (currentSeq === this.themeSequences.get(themeKey)) {
          if (result.success && result.css) {
            this.lastKnownGood.set(themeKey, result);
          }
        }

        // If compile failed, attach lastKnownGood CSS if available for visual stability in preview
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
    this.rawCache.clear();
    this.inFlight.clear();
    this.lastKnownGood.clear();
    this.themeSequences.clear();
  }
}

export const themeCompilerManager = new ThemeCompilerManager();
