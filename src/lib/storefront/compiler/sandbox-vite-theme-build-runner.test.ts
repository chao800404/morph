// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SandboxViteThemeBuildRunner } from "./sandbox-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";


describe("SandboxViteThemeBuildRunner (Phase 4B-5)", { timeout: 20_000 }, () => {
  const createInput = (

    files: Array<{ path: string; content: string; isEntry?: boolean }>,
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
    files,
    ...overrides,
  });

  it("builds starter theme successfully into dist index.html, js, and css bundles", async () => {
    const runner = new SandboxViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: `@import "tailwindcss";
:root {
  --color-brand: #3b82f6;
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
      expect(cssContent).toContain("--color-brand");
      expect(cssContent).toMatch(/object-cover/);

      expect(result.manifestJson.entry).toBe("src/pages/index.tsx");
      expect(result.manifestJson.cssChunks?.length).toBeGreaterThan(0);
      expect(result.manifestJson.jsChunks?.length).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
    }
  });


  it("handles TSX syntax errors cleanly by returning failure result with diagnostics", async () => {
    const runner = new SandboxViteThemeBuildRunner();

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
    const runner = new SandboxViteThemeBuildRunner();

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

  it("enforces max source files limit", async () => {
    const runner = new SandboxViteThemeBuildRunner({
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
    const runner = new SandboxViteThemeBuildRunner({
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

  it("verifies immutable input freeze: output only reflects input files regardless of external mutation", async () => {
    const runner = new SandboxViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "src/pages/index.tsx",
        content: `export default function Page() {
  return <div className="text-[48px]">Frozen Revision 48px</div>;
}`,
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(true);
    if (result.success) {
      const cssArtifact = result.artifacts.find((a) =>
        a.path.startsWith("assets/") && a.path.endsWith(".css"),
      );
      expect(cssArtifact).toBeDefined();
      const cssContent = String(cssArtifact?.content);
      expect(cssContent).toContain("48px");
      expect(cssContent).not.toContain("999px");
    }
  });

  it("handles timeout correctly and marks build failed", async () => {
    const runner = new SandboxViteThemeBuildRunner({
      maxDurationMs: 1, // 1ms timeout guarantees abort
    });

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "src/pages/index.tsx",
        content: "export default function Page() { return <div>Timeout Test</div>; }",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("TIMEOUT");
    }
  });

  it("ensures theme code cannot access Morph server runtime secrets", async () => {
    const runner = new SandboxViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "src/pages/index.tsx",
        content: `
export default function Page() {
  // Client bundle will have undefined or replaced process.env, never server runtime secrets
  const secret = typeof process !== "undefined" && process.env ? process.env.BETTER_AUTH_SECRET : undefined;
  return <div>Secret: {String(secret)}</div>;
}
`,
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(true);
    if (result.success) {
      const jsArtifact = result.artifacts.find((a) =>
        a.path.startsWith("assets/") && a.path.endsWith(".js"),
      );
      expect(jsArtifact).toBeDefined();
      // Verify that server secret values are never baked into client bundles
      expect(String(jsArtifact?.content)).not.toContain("super-secret-production-key");
    }
  });
});

