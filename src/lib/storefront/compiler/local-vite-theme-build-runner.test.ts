// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";

describe("LocalViteThemeBuildRunner (Phase 4B-5)", { timeout: 20_000 }, () => {
  const createInput = (
    files: Array<{ path: string; content: string | Uint8Array; isEntry?: boolean }>,
    overrides?: Partial<ThemeBuildRunnerInput>,
  ): ThemeBuildRunnerInput => ({
    buildId: "test-build-1",
    storefrontId: "storefront-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    revisionNumber: 1,
    entry: "src/pages/index.tsx",
    inputHash: "a".repeat(64),
    compilerId: "tailwind-v4-build",
    compilerVersion: "4.1.17",
    files: files as any,
    ...overrides,
  });

  it("builds starter theme successfully into dist index.html, js, and css bundles with Tailwind v4 utilities", async () => {
    const runner = new LocalViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: `@import "tailwindcss";
:root {
  --color-brand: #3b82f6;
  --brand: #3b82f6;
}`,
      },
      {
        path: "src/components/Hero.tsx",
        content: `export default function Hero() {
  return (
    <section className="grid md:text-[80px] bg-(--brand) [&>img]:object-cover">
      <h1>Hero Title</h1>
      <img src="/hero.png" alt="Hero" />
    </section>
  );
}`,
      },
      {
        path: "src/pages/index.tsx",
        content: `import Hero from "../components/Hero";
export default function HomePage() {
  return (
    <main className="min-h-screen">
      <Hero />
    </main>
  );
}`,
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.artifacts.length).toBeGreaterThanOrEqual(3);

      const htmlArtifact = result.artifacts.find((a) => a.path === "index.html");
      expect(htmlArtifact).toBeDefined();
      expect(htmlArtifact?.mimeType).toBe("text/html");

      const jsArtifact = result.artifacts.find((a) =>
        a.path.startsWith("assets/") && a.path.endsWith(".js"),
      );
      expect(jsArtifact).toBeDefined();
      expect(jsArtifact?.mimeType).toBe("application/javascript");

      const cssArtifact = result.artifacts.find((a) =>
        a.path.startsWith("assets/") && a.path.endsWith(".css"),
      );
      expect(cssArtifact).toBeDefined();
      expect(cssArtifact?.mimeType).toBe("text/css");

      // Verify real Tailwind v4 compilation in the output CSS
      const cssContent = String(cssArtifact?.content);
      expect(cssContent).toContain("grid");
      expect(cssContent).toContain("80px");
      expect(cssContent).toMatch(/var\(--brand\)/);
      expect(cssContent).toMatch(/object-cover/);

      expect(result.manifestJson.entry).toBe("src/pages/index.tsx");
      expect(result.manifestJson.cssChunks?.length).toBeGreaterThan(0);
      expect(result.manifestJson.jsChunks?.length).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
    }
  });

  it("preserves binary artifacts intact as Uint8Array without utf-8 corruption", async () => {
    const runner = new LocalViteThemeBuildRunner();

    // 4-byte PNG signature header: 0x89, 0x50, 0x4E, 0x47
    const mockPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "public/test-image.png",
        content: mockPngBytes,
      },
      {
        path: "src/pages/index.tsx",
        content: `export default function Page() {
  return <div><img src="/test-image.png" alt="Test" /></div>;
}`,
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(true);
    if (result.success) {
      const pngArtifact = result.artifacts.find((a) => a.path === "test-image.png");
      expect(pngArtifact).toBeDefined();
      expect(pngArtifact?.mimeType).toBe("image/png");
      expect(pngArtifact?.content instanceof Uint8Array).toBe(true);
      if (pngArtifact?.content instanceof Uint8Array) {
        expect(Array.from(pngArtifact.content.slice(0, 4))).toEqual([
          0x89, 0x50, 0x4e, 0x47,
        ]);
      }
    }
  });

  it("blocks path traversal escape attempts in relative imports", async () => {
    const runner = new LocalViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "src/pages/index.tsx",
        content: `import escape from "../../../../package.json";
export default function Page() {
  return <div>{String(escape)}</div>;
}`,
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("WORKSPACE_PATH_ESCAPE");
    }
  });

  it("blocks path traversal escape in virtual file paths", async () => {
    const runner = new LocalViteThemeBuildRunner();

    const input = createInput([
      {
        path: "../../etc/passwd",
        content: "malicious file",
      },
      {
        path: "src/pages/index.tsx",
        content: "export default () => <div>Hello</div>;",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("WORKSPACE_PATH_ESCAPE");
    }
  });

  it("rejects compiler identity mismatch", async () => {
    const runner = new LocalViteThemeBuildRunner();

    const input = createInput(
      [
        {
          path: "src/pages/index.tsx",
          content: "export default () => <div>Hello</div>;",
          isEntry: true,
        },
      ],
      {
        compilerVersion: "4.2.0-different",
      },
    );

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("COMPILER_IDENTITY_MISMATCH");
    }
  });

  it("handles TSX syntax errors cleanly by returning failure result with diagnostics", async () => {
    const runner = new LocalViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "src/pages/index.tsx",
        content: `export default function Broken() {
  return (
    <div>
      <h1>Unclosed tag
    </div>
  );
}`,
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toBeDefined();
      expect(result.diagnosticsJson?.errors?.length).toBeGreaterThan(0);
      expect(result.logs?.some((l) => l.level === "error")).toBe(true);
    }
  });

  it("blocks unapproved dependencies with a clean security diagnostic", async () => {
    const runner = new LocalViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "src/pages/index.tsx",
        content: `import axios from "axios";
export default function Page() {
  return <div>{typeof axios}</div>;
}`,
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("UNAPPROVED_DEPENDENCY");
      expect(result.errorMessage).toContain("axios");
    }
  });

  it("blocks direct relative filesystem imports from node_modules with UNAPPROVED_DEPENDENCY_PATH", async () => {
    const runner = new LocalViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "src/pages/index.tsx",
        content: `import { clsx } from "../../node_modules/clsx/dist/clsx.mjs";
export default function Page() {
  return <div>{typeof clsx}</div>;
}`,
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("UNAPPROVED_DEPENDENCY_PATH");
      expect(result.errorMessage).toContain("node_modules");
    }
  });

  it("blocks web-root filesystem imports from /node_modules with UNAPPROVED_DEPENDENCY_PATH", async () => {
    const runner = new LocalViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "src/pages/index.tsx",
        content: `import { clsx } from "/node_modules/clsx/dist/clsx.mjs";
export default function Page() {
  return <div>{typeof clsx}</div>;
}`,
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("UNAPPROVED_DEPENDENCY_PATH");
    }
  });


  it("enforces max source files limit", async () => {
    const runner = new LocalViteThemeBuildRunner({
      maxSourceFiles: 2,
    });

    const input = createInput([
      { path: "src/1.tsx", content: "export default () => 1;" },
      { path: "src/2.tsx", content: "export default () => 2;" },
      { path: "src/3.tsx", content: "export default () => 3;" },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("LIMIT_EXCEEDED");
      expect(result.errorMessage).toContain("max source files limit");
    }
  });

  it("enforces max source size limit", async () => {
    const runner = new LocalViteThemeBuildRunner({
      maxSourceSizeBytes: 50,
    });

    const input = createInput([
      {
        path: "src/pages/index.tsx",
        content: "export default function Home() { return <div>" + "x".repeat(100) + "</div>; }",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("LIMIT_EXCEEDED");
      expect(result.errorMessage).toContain("total source size");
    }
  });

  it("blocks theme virtual files located inside node_modules before write", async () => {
    const runner = new LocalViteThemeBuildRunner();

    const attackPaths = [
      "node_modules/vite/x.js",
      "src/node_modules/evil.ts",
      "node_modules/.bin/vite",
    ];

    for (const attackPath of attackPaths) {
      const input = createInput([
        {
          path: attackPath,
          content: "malicious code",
        },
      ]);

      const result = await runner.run(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorMessage).toContain("RESERVED_THEME_PATH");
      }
    }
  });

  it("enforces maxOutputSizeBytes preflight limit", async () => {
    const runner = new LocalViteThemeBuildRunner({
      maxOutputSizeBytes: 10, // 10 bytes limit
    });

    const input = createInput([
      {
        path: "src/pages/index.tsx",
        content: "export default function Home() { return <div>Normal size</div>; }",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("LIMIT_EXCEEDED");
      expect(result.errorMessage).toContain("Theme dist output");
    }
  });

  it("enforces maxOutputFiles preflight limit", async () => {
    const runner = new LocalViteThemeBuildRunner({
      maxOutputFiles: 1, // Only 1 file allowed, but Vite build produces index.html + js + css (>= 2)
    });

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: "@import \"tailwindcss\";",
      },
      {
        path: "src/pages/index.tsx",
        content: "export default function Home() { return <div>Home</div>; }",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("LIMIT_EXCEEDED");
      expect(result.errorMessage).toContain("file count");
    }
  });
});


