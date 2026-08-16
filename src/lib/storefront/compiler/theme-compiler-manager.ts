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
 * Coordinates theme compilation jobs with strict separation between:
 * 1. Raw content-addressed compiler cache (`rawCache` keyed by inputHash)
 *    - Stores pure, immutable compiler results.
 *    - Never mutated with theme-specific fallbacks.
 * 2. In-flight deduplication (`inFlight` keyed by inputHash)
 *    - Stores promises resolving to pure, immutable compiler results.
 * 3. Per-theme last-known-good fallback (`lastKnownGood` keyed by themeKey)
 *    - Tracks latest successful CSS per theme.
 *
 * Every compile request (Cache Hit, In-Flight deduplicated, or New Compile)
 * advances the per-theme request sequence and constructs an isolated response object.
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

    // 3. Cache hit check (pure immutable raw cache)
    const cached = this.rawCache.get(inputHash);
    if (cached) {
      return this.buildThemeResponse(
        cached.result,
        themeKey,
        currentSeq,
        input.sourceGeneration,
      );
    }

    // 4. In-flight deduplication (pure immutable in-flight promise)
    const existingFlight = this.inFlight.get(inputHash);
    if (existingFlight) {
      const rawResult = await existingFlight;
      return this.buildThemeResponse(
        rawResult,
        themeKey,
        currentSeq,
        input.sourceGeneration,
      );
    }

    // 5. Launch new compilation
    const rawPromise = (async () => {
      try {
        const rawResult = await targetCompiler.compile(input, { inputHash });

        // Store pure immutable result into raw compiler cache
        this.rawCache.set(inputHash, {
          result: rawResult,
          timestamp: Date.now(),
          sourceGeneration: input.sourceGeneration,
        });

        return rawResult;
      } finally {
        this.inFlight.delete(inputHash);
      }
    })();

    this.inFlight.set(inputHash, rawPromise);
    const rawResult = await rawPromise;

    return this.buildThemeResponse(
      rawResult,
      themeKey,
      currentSeq,
      input.sourceGeneration,
    );
  }

  /**
   * Constructs an isolated response for a specific theme request without mutating rawResult.
   * Updates lastKnownGood if sequence is current, and attaches theme-specific fallback if failed.
   */
  private buildThemeResponse(
    rawResult: ThemeCompilerResult,
    themeKey: string,
    requestSeq: number,
    sourceGeneration?: number,
  ): ThemeCompilerResult {
    // Sequence guard: only update lastKnownGood if this is still the newest request for the theme
    if (requestSeq === this.themeSequences.get(themeKey)) {
      if (rawResult.success && rawResult.css) {
        this.lastKnownGood.set(themeKey, rawResult);
      }
    }

    // Resolve theme-specific fallback without mutating rawResult
    const fallback = rawResult.success ? undefined : this.lastKnownGood.get(themeKey);

    return {
      ...rawResult,
      sourceGeneration,
      css: rawResult.css ?? fallback?.css,
    };
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
