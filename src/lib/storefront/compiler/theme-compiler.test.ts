import { beforeEach, describe, expect, it } from "vitest";
import { BrowserPreviewThemeCompiler } from "./browser-preview-compiler";
import { computeThemeInputHash } from "./theme-compiler-hasher";
import { ThemeCompilerManager } from "./theme-compiler-manager";
import { scanThemeVirtualFilesystem } from "./theme-compiler-scanner";
import type { ThemeCompilerFile, ThemeCompilerInput } from "./theme-compiler.types";

describe("Theme Compiler Foundation (Phase 4A)", () => {
  let compiler: BrowserPreviewThemeCompiler;
  let manager: ThemeCompilerManager;

  beforeEach(() => {
    compiler = new BrowserPreviewThemeCompiler();
    manager = new ThemeCompilerManager(compiler);
  });

  describe("Deterministic Input Hasher", () => {
    it("produces identical input hash regardless of file ordering", () => {
      const file1: ThemeCompilerFile = {
        path: "src/components/Hero.tsx",
        content: "export default function Hero() { return <div className='grid'>Hero</div>; }",
      };
      const file2: ThemeCompilerFile = {
        path: "src/styles/global.css",
        content: "@import 'tailwindcss';",
      };

      const inputA: ThemeCompilerInput = {
        files: [file1, file2],
        entry: "src/pages/index.tsx",
      };
      const inputB: ThemeCompilerInput = {
        files: [file2, file1],
        entry: "src/pages/index.tsx",
      };

      const hashA = computeThemeInputHash(inputA);
      const hashB = computeThemeInputHash(inputB);

      expect(hashA).toBe(hashB);
      expect(typeof hashA).toBe("string");
      expect(hashA.length).toBe(8);
    });

    it("produces different hash when file content changes", () => {
      const inputA: ThemeCompilerInput = {
        files: [{ path: "src/components/Hero.tsx", content: "console.log(1);" }],
      };
      const inputB: ThemeCompilerInput = {
        files: [{ path: "src/components/Hero.tsx", content: "console.log(2);" }],
      };

      expect(computeThemeInputHash(inputA)).not.toBe(computeThemeInputHash(inputB));
    });
  });

  describe("Virtual Filesystem Scanner & Tailwind Token Extraction", () => {
    it("scans and extracts all required Tailwind classes and arbitrary syntax", () => {
      const testSource = `
        import { cn } from "@/lib/utils";

        export default function TestComponent({ active }: { active: boolean }) {
          return (
            <section className="grid">
              <div className="flex items-center gap-8">
                <h1 className="text-[64px] md:text-[80px]">Heading</h1>
                <div className="lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]" />
                <div className="px-[clamp(1.75rem,6vw,6rem)]" />
                <button className="hover:bg-stone-800">Button</button>
                <div className="[&>img]:object-cover" />
                <div className="supports-[display:grid]:grid" />
                <div className="bg-[#ff0055]" />
              </div>
            </section>
          );
        }
      `;

      const files: ThemeCompilerFile[] = [
        { path: "src/components/TestComponent.tsx", content: testSource },
        { path: "src/styles/global.css", content: "@import 'tailwindcss'; :root { --brand: #000; }" },
        { path: "morph.theme.json", content: JSON.stringify({ name: "Test Theme" }) },
      ];

      const scanResult = scanThemeVirtualFilesystem(files);

      expect(scanResult.diagnostics).toEqual([]);
      expect(scanResult.cssFiles.length).toBe(1);

      // Verify all required Tailwind test cases are extracted
      expect(scanResult.classes.has("grid")).toBe(true);
      expect(scanResult.classes.has("flex")).toBe(true);
      expect(scanResult.classes.has("items-center")).toBe(true);
      expect(scanResult.classes.has("gap-8")).toBe(true);
      expect(scanResult.classes.has("text-[64px]")).toBe(true);
      expect(scanResult.classes.has("md:text-[80px]")).toBe(true);
      expect(
        scanResult.classes.has(
          "lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]",
        ),
      ).toBe(true);
      expect(scanResult.classes.has("px-[clamp(1.75rem,6vw,6rem)]")).toBe(true);
      expect(scanResult.classes.has("hover:bg-stone-800")).toBe(true);
      expect(scanResult.classes.has("[&>img]:object-cover")).toBe(true);
      expect(scanResult.classes.has("supports-[display:grid]:grid")).toBe(true);
      expect(scanResult.classes.has("bg-[#ff0055]")).toBe(true);
    });

    it("correctly extracts classes from dynamic React expressions (cn, ternaries, template literals)", () => {
      const dynamicSource = `
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
      `;

      const files: ThemeCompilerFile[] = [
        { path: "src/components/Dynamic.tsx", content: dynamicSource },
      ];

      const scanResult = scanThemeVirtualFilesystem(files);

      expect(scanResult.diagnostics).toEqual([]);
      expect(scanResult.classes.has("text-4xl")).toBe(true);
      expect(scanResult.classes.has("text-red-500")).toBe(true);
      expect(scanResult.classes.has("bg-stone-900")).toBe(true);
      expect(scanResult.classes.has("bg-stone-100")).toBe(true);
      expect(scanResult.classes.has("font-serif")).toBe(true);
      expect(scanResult.classes.has("leading-tight")).toBe(true);
      expect(scanResult.classes.has("opacity-100")).toBe(true);
      expect(scanResult.classes.has("opacity-50")).toBe(true);
    });

    it("emits diagnostics on syntax errors without crashing", () => {
      const brokenSource = `
        export default function Broken() {
          return <div className="p-4"
        // missing closing tags and syntax error
      `;

      const files: ThemeCompilerFile[] = [
        { path: "src/components/Broken.tsx", content: brokenSource },
      ];

      const scanResult = scanThemeVirtualFilesystem(files);

      expect(scanResult.diagnostics.length).toBeGreaterThan(0);
      expect(scanResult.diagnostics[0].level).toBe("error");
      expect(scanResult.diagnostics[0].filePath).toBe("src/components/Broken.tsx");
      expect(typeof scanResult.diagnostics[0].line).toBe("number");
    });
  });

  describe("ThemeCompiler Execution & Cache Management", () => {
    it("compiles valid virtual filesystem and returns ThemeCompilerResult", async () => {
      const input: ThemeCompilerInput = {
        themeId: "theme-dawn",
        storefrontId: "storefront-1",
        sourceGeneration: 10,
        files: [
          {
            path: "src/styles/global.css",
            content: "@import 'tailwindcss';\n:root { --brand: #1c1917; }",
          },
          {
            path: "src/components/Hero.tsx",
            content: "export default function Hero() { return <div className='grid min-h-[42rem]'>Hero</div>; }",
          },
        ],
      };

      const result = await manager.compile(input);

      expect(result.success).toBe(true);
      expect(result.inputHash).toBeDefined();
      expect(result.css).toContain(":root { --brand: #1c1917; }");
      expect(result.tokensCount).toBeGreaterThan(0);
      expect(result.sourceGeneration).toBe(10);
      expect(result.diagnostics).toEqual([]);
    });

    it("uses in-memory cache for repeated compilations of identical inputHash", async () => {
      const input: ThemeCompilerInput = {
        themeId: "theme-dawn",
        files: [
          {
            path: "src/components/Header.tsx",
            content: "export default function Header() { return <header className='h-16'>Header</header>; }",
          },
        ],
      };

      const result1 = await manager.compile(input);
      const result2 = await manager.compile(input);

      expect(result1.inputHash).toBe(result2.inputHash);
      expect(result1.compiledAt).toBe(result2.compiledAt);
    });

    it("preserves last-known-good CSS when compilation fails", async () => {
      const themeId = "theme-test";

      // 1. Initial successful compile
      const goodInput: ThemeCompilerInput = {
        themeId,
        files: [
          {
            path: "src/styles/global.css",
            content: "body { background: #fafaf9; }",
          },
          {
            path: "src/components/Hero.tsx",
            content: "export default function Hero() { return <div className='p-6'>Good</div>; }",
          },
        ],
      };

      const goodResult = await manager.compile(goodInput);
      expect(goodResult.success).toBe(true);
      expect(goodResult.css).toContain("body { background: #fafaf9; }");

      // 2. Subsequent compile with fatal syntax error
      const badInput: ThemeCompilerInput = {
        themeId,
        files: [
          {
            path: "src/components/Hero.tsx",
            content: "export default function Hero() { return <div className='p-6' INVALID_SYNTAX",
          },
        ],
      };

      const badResult = await manager.compile(badInput);

      expect(badResult.success).toBe(false);
      expect(badResult.diagnostics.length).toBeGreaterThan(0);
      // Fallback CSS is preserved from last-known-good
      expect(badResult.css).toBe(goodResult.css);
      expect(manager.getLastKnownGood(themeId)?.css).toBe(goodResult.css);
    });
  });
});
