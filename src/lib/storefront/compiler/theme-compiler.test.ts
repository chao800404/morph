import { beforeEach, describe, expect, it } from "vitest";
import { BrowserPreviewThemeCompiler } from "./browser-preview-compiler";
import { computeThemeInputHash } from "./theme-compiler-hasher";
import { ThemeCompilerManager } from "./theme-compiler-manager";
import type { ThemeCompilerFile, ThemeCompilerInput } from "./theme-compiler.types";

describe("Theme Compiler Foundation (Phase 4A)", () => {
  let compiler: BrowserPreviewThemeCompiler;
  let manager: ThemeCompilerManager;

  beforeEach(() => {
    compiler = new BrowserPreviewThemeCompiler();
    manager = new ThemeCompilerManager(compiler);
  });

  describe("Real Tailwind CSS v4 Compilation & Candidate Parity", () => {
    it("compiles virtual files into genuine CSS rules and eliminates @import 'tailwindcss'", async () => {
      const result = await compiler.compile({
        files: [
          {
            path: "src/styles/global.css",
            content: '@import "tailwindcss";\n:root { --custom-color: #123456; }',
          },
          {
            path: "src/Test.tsx",
            content: `
              export default () =>
                <div className="grid text-[64px] hover:bg-stone-800" />
            `,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.css).toBeDefined();
      expect(result.css).toContain(".grid");
      expect(result.css).toContain("64px");
      expect(result.css).toContain("hover");
      expect(result.css).toContain("--custom-color: #123456");
      expect(result.css).not.toContain('@import "tailwindcss"');
    });

    it("verifies all required Tailwind syntax cases including bg-(--var) and arbitrary values", async () => {
      const result = await compiler.compile({
        files: [
          {
            path: "src/styles/global.css",
            content: '@import "tailwindcss";\n:root { --brand-color: #ff0055; --hero-h: 42rem; }',
          },
          {
            path: "src/components/Showcase.tsx",
            content: `
              export default function Showcase() {
                return (
                  <div className="grid flex items-center gap-8 text-[64px] md:text-[80px] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] px-[clamp(1.75rem,6vw,6rem)] hover:bg-stone-800 [&>img]:object-cover supports-[display:grid]:grid bg-[#ff0055] bg-(--brand-color) min-h-(--hero-h) aria-checked:bg-stone-900 data-[state=active]:opacity-100">
                    <img src="/test.jpg" />
                  </div>
                );
              }
            `,
          },
        ],
      });

      expect(result.success).toBe(true);
      const css = result.css!;

      // 1. className="grid"
      expect(css).toContain(".grid");
      // 2. className="flex items-center gap-8"
      expect(css).toContain(".flex");
      expect(css).toContain(".items-center");
      expect(css).toContain("gap: calc(var(--spacing)");
      // 3. className="text-[64px]"
      expect(css).toContain("font-size: 64px");
      // 4. className="md:text-[80px]"
      expect(css).toContain("font-size: 80px");
      expect(css).toContain("@media (width >= 48rem)");
      // 5. className="lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
      expect(css).toContain("grid-template-columns: minmax(0,0.82fr) minmax(0,1.18fr)");
      // 6. className="px-[clamp(1.75rem,6vw,6rem)]"
      expect(css).toContain("padding-inline: clamp(1.75rem, 6vw, 6rem)");
      // 7. className="hover:bg-stone-800"
      expect(css).toContain("hover");
      // 8. className="[&>img]:object-cover"
      expect(css).toContain("object-fit: cover");
      // 9. className="supports-[display:grid]:grid"
      expect(css).toContain("@supports (display:grid)");
      // 10. className="bg-[#ff0055]"
      expect(css).toContain("#ff0055");
      // 11. Tailwind v4 theme variable syntax: bg-(--brand-color) and min-h-(--hero-h)
      expect(css).toContain("background-color: var(--brand-color)");
      expect(css).toContain("min-height: var(--hero-h)");
      // 12. Aria and data attribute variants
      expect(css).toContain("aria-checked");
      expect(css).toContain('data-state="active"');
    });

    it("compiles candidate classes from dynamic React expressions (cn, ternaries, template literals)", async () => {
      const result = await compiler.compile({
        files: [
          {
            path: "src/styles/global.css",
            content: '@import "tailwindcss";',
          },
          {
            path: "src/components/Dynamic.tsx",
            content: `
              import { cn } from "@/lib/utils";

              export default function DynamicComponent({ active, isDark }: { active: boolean; isDark: boolean }) {
                return (
                  <div
                    className={cn(
                      "text-4xl",
                      active && "text-red-500",
                      isDark ? "bg-stone-900" : "bg-stone-100"
                    )}
                  >
                    <span className={\`font-serif leading-tight \${active ? "opacity-100" : "opacity-50"}\`}>
                      Dynamic
                    </span>
                  </div>
                );
              }
            `,
          },
        ],
      });

      expect(result.success).toBe(true);
      const css = result.css!;
      expect(css).toContain("text-4xl");
      expect(css).toContain("text-red-500");
      expect(css).toContain("bg-stone-900");
      expect(css).toContain("bg-stone-100");
      expect(css).toContain("leading-tight");
    });
  });

  describe("Nested Virtual CSS Relative Imports", () => {
    it("resolves multi-level nested relative stylesheet imports across virtual theme filesystem", async () => {
      const result = await compiler.compile({
        files: [
          {
            path: "src/styles/global.css",
            content: `
              @import "tailwindcss";
              @import "./components/hero.css";
            `,
          },
          {
            path: "src/styles/components/hero.css",
            content: `
              @import "../tokens/nested/deep-vars.css";
              .hero-card {
                background: var(--hero-bg);
                border: 1px solid var(--hero-border);
              }
            `,
          },
          {
            path: "src/styles/tokens/nested/deep-vars.css",
            content: `
              :root {
                --hero-bg: #f5f5f4;
                --hero-border: #e7e5e4;
              }
            `,
          },
          {
            path: "src/components/Hero.tsx",
            content: `
              export default function Hero() {
                return <div className="grid hero-card text-[40px]">Hero</div>;
              }
            `,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.diagnostics).toEqual([]);
      const css = result.css!;
      expect(css).toContain("--hero-bg: #f5f5f4");
      expect(css).toContain("--hero-border: #e7e5e4");
      expect(css).toContain(".hero-card");
      expect(css).toContain("font-size: 40px");
      expect(css).not.toContain('@import "./components/hero.css"');
      expect(css).not.toContain('@import "../tokens/nested/deep-vars.css"');
    });
  });

  describe("Single Identity Hasher & Cache Contracts", () => {
    it("ensures Manager cache key and result.inputHash are 100% unified and deterministic SHA-256", async () => {
      const input: ThemeCompilerInput = {
        themeId: "theme-alpha",
        files: [
          { path: "src/styles/global.css", content: '@import "tailwindcss";' },
          { path: "src/components/Hero.tsx", content: '<div className="grid">Hero</div>' },
        ],
      };

      const expectedHash = computeThemeInputHash(input, {
        id: compiler.id,
        version: compiler.version,
      });

      const result = await manager.compile(input);

      expect(result.inputHash).toBe(expectedHash);
      expect(result.inputHash.length).toBe(64); // SHA-256 hex string
    });

    it("accurately updates caller sourceGeneration metadata and updates per-theme lastKnownGood on cache hits", async () => {
      const files: ThemeCompilerFile[] = [
        { path: "src/components/Header.tsx", content: '<header className="h-16">Header</header>' },
      ];

      // 1. First compile at generation 10
      const result1 = await manager.compile({
        themeId: "theme-beta",
        sourceGeneration: 10,
        files,
      });
      expect(result1.sourceGeneration).toBe(10);
      expect(manager.getLastKnownGood("theme-beta")?.css).toBe(result1.css);

      // 2. Cache hit at generation 20 with identical file content
      const result2 = await manager.compile({
        themeId: "theme-beta",
        sourceGeneration: 20,
        files,
      });
      expect(result2.sourceGeneration).toBe(20);
      expect(result2.inputHash).toBe(result1.inputHash);
      expect(manager.getLastKnownGood("theme-beta")?.css).toBe(result2.css);
    });
  });

  describe("Raw Compiler Cache & Per-Theme Fallback Strict Isolation (P1 Regressions)", () => {
    it("never pollutes raw compiler cache or leaks Theme A fallback to Theme B on cache hit", async () => {
      const themeA = "theme-isolation-A";
      const themeB = "theme-isolation-B";

      // 1. Theme A compiles valid source -> lastKnownGood(A) = A.css
      const resA = await manager.compile({
        themeId: themeA,
        files: [
          { path: "src/styles/global.css", content: '@import "tailwindcss";\nbody { color: #aaaaaa; }' },
          { path: "src/Hero.tsx", content: '<div className="p-4">Theme A</div>' },
        ],
      });
      expect(resA.success).toBe(true);
      expect(resA.css).toContain("color: #aaaaaa");
      expect(manager.getLastKnownGood(themeA)?.css).toBe(resA.css);

      // 2. Theme B compiles valid source -> lastKnownGood(B) = B.css
      const resB = await manager.compile({
        themeId: themeB,
        files: [
          { path: "src/styles/global.css", content: '@import "tailwindcss";\nbody { color: #bbbbbb; }' },
          { path: "src/Hero.tsx", content: '<div className="p-4">Theme B</div>' },
        ],
      });
      expect(resB.success).toBe(true);
      expect(resB.css).toContain("color: #bbbbbb");
      expect(manager.getLastKnownGood(themeB)?.css).toBe(resB.css);

      // 3. Theme A compiles Broken Source X
      const brokenFiles: ThemeCompilerFile[] = [
        { path: "src/Hero.tsx", content: 'export default () => <div BROKEN_SYNTAX_X' },
      ];

      const brokenResultA = await manager.compile({
        themeId: themeA,
        files: brokenFiles,
      });
      expect(brokenResultA.success).toBe(false);
      // Theme A receives Theme A's fallback CSS
      expect(brokenResultA.css).toContain("color: #aaaaaa");

      // 4. Theme B compiles the EXACT same Broken Source X (triggers raw cache hit)
      const brokenResultB = await manager.compile({
        themeId: themeB,
        files: brokenFiles,
      });
      expect(brokenResultB.success).toBe(false);
      // Theme B MUST receive Theme B's fallback CSS and NEVER Theme A's CSS!
      expect(brokenResultB.css).toBe(resB.css);
      expect(brokenResultB.css).toContain("color: #bbbbbb");
      expect(brokenResultB.css).not.toContain("color: #aaaaaa");
    });

    it("never leaks fallbacks between concurrent Theme A and Theme B requests during in-flight deduplication", async () => {
      const themeA = "theme-flight-A";
      const themeB = "theme-flight-B";

      let resolveSlowBrokenJob: (res: any) => void;
      const slowBrokenPromise = new Promise<any>((resolve) => {
        resolveSlowBrokenJob = resolve;
      });

      const mockCompiler = {
        id: "mock-compiler",
        version: "4.1.17",
        compile: async (input: ThemeCompilerInput) => {
          if (input.files[0]?.content.includes("GOOD_A")) {
            return { success: true, inputHash: "hash-A", css: "/* Theme A Good CSS */", diagnostics: [], compiledAt: "" };
          }
          if (input.files[0]?.content.includes("GOOD_B")) {
            return { success: true, inputHash: "hash-B", css: "/* Theme B Good CSS */", diagnostics: [], compiledAt: "" };
          }
          // Slow broken job shared across inputHash
          return slowBrokenPromise;
        },
      };

      const flightManager = new ThemeCompilerManager(mockCompiler as any);

      // 1. Seed lastKnownGood for Theme A and Theme B
      await flightManager.compile({ themeId: themeA, files: [{ path: "1.tsx", content: "GOOD_A" }] });
      await flightManager.compile({ themeId: themeB, files: [{ path: "1.tsx", content: "GOOD_B" }] });

      expect(flightManager.getLastKnownGood(themeA)?.css).toBe("/* Theme A Good CSS */");
      expect(flightManager.getLastKnownGood(themeB)?.css).toBe("/* Theme B Good CSS */");

      // 2. Both Theme A and Theme B concurrently request identical Broken Source
      const brokenInputA: ThemeCompilerInput = {
        themeId: themeA,
        files: [{ path: "broken.tsx", content: "IDENTICAL_BROKEN_CODE" }],
      };
      const brokenInputB: ThemeCompilerInput = {
        themeId: themeB,
        files: [{ path: "broken.tsx", content: "IDENTICAL_BROKEN_CODE" }],
      };

      const promiseA = flightManager.compile(brokenInputA);
      const promiseB = flightManager.compile(brokenInputB);

      // 3. Resolve the in-flight compiler job with a pure failure (css: undefined)
      resolveSlowBrokenJob!({
        success: false,
        inputHash: "hash-broken-identical",
        css: undefined,
        diagnostics: [{ level: "error", message: "Compilation failed" }],
        compiledAt: new Date().toISOString(),
      });

      const [resA, resB] = await Promise.all([promiseA, promiseB]);

      expect(resA.success).toBe(false);
      expect(resA.css).toBe("/* Theme A Good CSS */");

      expect(resB.success).toBe(false);
      expect(resB.css).toBe("/* Theme B Good CSS */");
    });
  });

  describe("Out-of-Order Race Protection for lastKnownGood", () => {
    it("prevents slower, superseded compilation jobs from overwriting newer lastKnownGood CSS", async () => {
      const themeId = "theme-race";

      let resolveSlowJob: (result: any) => void;
      const slowPromise = new Promise<any>((resolve) => {
        resolveSlowJob = resolve;
      });

      const slowCompiler = {
        id: "slow-compiler",
        version: "4.1.17",
        compile: async (input: ThemeCompilerInput) => {
          if (input.sourceGeneration === 1) {
            return slowPromise;
          }
          return {
            success: true,
            inputHash: "hash-gen-2",
            css: "/* Gen 2 Fast CSS */ .gen2 { color: blue; }",
            diagnostics: [],
            compiledAt: new Date().toISOString(),
          };
        },
      };

      const raceManager = new ThemeCompilerManager(slowCompiler as any);

      // Start Job 1 (Gen 1 - slow)
      const job1Promise = raceManager.compile({
        themeId,
        sourceGeneration: 1,
        files: [{ path: "src/1.tsx", content: "gen1" }],
      });

      // Start Job 2 (Gen 2 - fast)
      const job2Promise = raceManager.compile({
        themeId,
        sourceGeneration: 2,
        files: [{ path: "src/2.tsx", content: "gen2" }],
      });

      // Job 2 completes first
      await job2Promise;
      expect(raceManager.getLastKnownGood(themeId)?.css).toContain("Gen 2 Fast CSS");

      // Now Job 1 finishes late
      resolveSlowJob!({
        success: true,
        inputHash: "hash-gen-1",
        css: "/* Gen 1 Stale CSS */ .gen1 { color: red; }",
        diagnostics: [],
        compiledAt: new Date().toISOString(),
      });
      await job1Promise;

      // lastKnownGood MUST remain Gen 2!
      expect(raceManager.getLastKnownGood(themeId)?.css).toContain("Gen 2 Fast CSS");
      expect(raceManager.getLastKnownGood(themeId)?.css).not.toContain("Gen 1 Stale CSS");
    });

    it("emits syntax error diagnostics and preserves lastKnownGood CSS on failure", async () => {
      const themeId = "theme-diag";

      // 1. Successful baseline compile
      const okResult = await manager.compile({
        themeId,
        files: [
          { path: "src/styles/global.css", content: '@import "tailwindcss";\nbody { margin: 0; }' },
          { path: "src/components/Hero.tsx", content: 'export default () => <div className="p-4">OK</div>' },
        ],
      });
      expect(okResult.success).toBe(true);
      expect(okResult.css).toContain("margin: 0");

      // 2. Compile with malformed TSX syntax
      const failResult = await manager.compile({
        themeId,
        files: [
          { path: "src/components/Hero.tsx", content: 'export default () => <div className="p-4" BROKEN_SYNTAX' },
        ],
      });

      expect(failResult.success).toBe(false);
      expect(failResult.diagnostics.length).toBeGreaterThan(0);
      expect(failResult.diagnostics[0].level).toBe("error");
      expect(failResult.diagnostics[0].filePath).toBe("src/components/Hero.tsx");

      // Fallback CSS is preserved
      expect(failResult.css).toBe(okResult.css);
      expect(manager.getLastKnownGood(themeId)?.css).toBe(okResult.css);
    });
  });
});
