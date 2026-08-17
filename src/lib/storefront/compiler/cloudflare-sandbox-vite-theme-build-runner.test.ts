// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CloudflareSandboxViteThemeBuildRunner,
  type CloudflareSandboxFileInfo,
  type CloudflareSandboxProvider,
  type CloudflareSandboxSession,
} from "./cloudflare-sandbox-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";

describe("CloudflareSandboxViteThemeBuildRunner (Phase 4B-5)", () => {
  const createMockSandbox = (overrides?: Partial<CloudflareSandboxSession>): {
    session: CloudflareSandboxSession;
    writtenFiles: Map<string, string | Uint8Array>;
    destroyed: boolean;
    processKilled: boolean;
  } => {
    const writtenFiles = new Map<string, string | Uint8Array>();
    let destroyed = false;
    let processKilled = false;

    const session: CloudflareSandboxSession = {
      writeFile: vi.fn(async (filePath: string, content: string | Uint8Array) => {
        writtenFiles.set(filePath, content);
      }),
      mkdir: vi.fn(async () => {}),
      readFile: vi.fn(async (filePath: string, _encoding?: "utf8" | "binary" | { encoding?: "utf8" | "binary" }) => {
        if (filePath.endsWith(".html")) {
          return { content: "<!DOCTYPE html><html><body><div id='root'></div></body></html>" };
        }
        if (filePath.endsWith(".js")) {
          return { content: 'console.log("compiled bundle");' };
        }
        if (filePath.endsWith(".css")) {
          return { content: "/* compiled tailwind v4 */\n.grid { display: grid; }" };
        }
        if (filePath.endsWith(".png")) {
          return { content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
        }
        return { content: "file content" };
      }) as any,
      listFiles: vi.fn(async (dirPath: string): Promise<CloudflareSandboxFileInfo[]> => {
        return [
          { path: `${dirPath}/index.html`, isDirectory: false, sizeBytes: 56 },
          { path: `${dirPath}/assets/index.js`, isDirectory: false, sizeBytes: 1024 },
          { path: `${dirPath}/assets/index.css`, isDirectory: false, sizeBytes: 512 },
          { path: `${dirPath}/assets/logo.png`, isDirectory: false, sizeBytes: 4 },
        ];
      }),
      exec: vi.fn(async () => ({
        exitCode: 0,
        success: true,
        stdout: "vite build complete in 1.2s",
        stderr: "",
      })),
      killProcess: vi.fn(async () => {
        processKilled = true;
      }),
      destroy: vi.fn(async () => {
        destroyed = true;
      }),
      ...overrides,
    };

    return {
      session,
      writtenFiles,
      get destroyed() {
        return destroyed;
      },
      get processKilled() {
        return processKilled;
      },
    };
  };

  const createInput = (
    files: Array<{ path: string; content: string | Uint8Array; isEntry?: boolean }>,
    overrides?: Partial<ThemeBuildRunnerInput>,
  ): ThemeBuildRunnerInput => ({
    buildId: "sandbox-build-123",
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

  it("orchestrates build inside isolated Cloudflare Sandbox container with pinned toolchain & dependency enforcer", async () => {
    const mock = createMockSandbox();
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };

    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
      sandboxBinding: { name: "SANDBOX_DO" },
    });

    const input = createInput([
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
      },
      {
        path: "src/pages/index.tsx",
        content: "export default () => <h1>Home</h1>;",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(true);
    expect(provider.getSandbox).toHaveBeenCalledWith({ name: "SANDBOX_DO" }, "sandbox-build-123");

    // Verify container package.json has pinned exact toolchain dependencies
    const writtenPkg = JSON.parse(String(mock.writtenFiles.get("/workspace/package.json")));
    expect(writtenPkg.dependencies["react"]).toBe("19.2.1");
    expect(writtenPkg.dependencies["tailwindcss"]).toBe("4.1.17");
    expect(writtenPkg.dependencies["@tailwindcss/vite"]).toBe("4.1.17");
    expect(writtenPkg.dependencies["@vitejs/plugin-react"]).toBe("5.2.0");

    // Verify container vite.config.ts has injected dependency enforcer
    const writtenViteConfig = String(mock.writtenFiles.get("/workspace/vite.config.ts"));
    expect(writtenViteConfig).toContain("morph-dependency-enforcer");
    expect(writtenViteConfig).toContain("UNAPPROVED_DEPENDENCY");

    // Verify exec command invocation
    expect(mock.session.exec).toHaveBeenCalledWith(
      "npx vite build --config /workspace/vite.config.ts",
      expect.objectContaining({
        timeout: 30_000,
        env: { NODE_ENV: "production" },
      }),
    );
    expect(mock.session.destroy).toHaveBeenCalled();

    if (result.success) {
      expect(result.artifacts).toHaveLength(4);

      const html = result.artifacts.find((a) => a.path === "index.html");
      expect(html?.mimeType).toBe("text/html");
      expect(typeof html?.content).toBe("string");

      const png = result.artifacts.find((a) => a.path === "assets/logo.png");
      expect(png?.mimeType).toBe("image/png");
      expect(png?.content instanceof Uint8Array).toBe(true);
    }
  });

  it("blocks path traversal escape before files are sent to sandbox", async () => {
    const mock = createMockSandbox();
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };

    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const input = createInput([
      {
        path: "../../../../etc/shadow",
        content: "malicious file",
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("WORKSPACE_PATH_ESCAPE");
    }
    // Sandbox container was never even spun up
    expect(provider.getSandbox).not.toHaveBeenCalled();
  });

  it("rejects compiler identity mismatch", async () => {
    const mock = createMockSandbox();
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };

    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const input = createInput(
      [
        {
          path: "src/pages/index.tsx",
          content: "export default () => <div>Hello</div>;",
          isEntry: true,
        },
      ],
      {
        compilerVersion: "5.0.0-unsupported",
      },
    );

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("COMPILER_IDENTITY_MISMATCH");
    }
  });

  it("handles Vite compilation error inside container and destroys sandbox", async () => {
    const mock = createMockSandbox({
      exec: vi.fn(async () => ({
        exitCode: 1,
        success: false,
        stdout: "",
        stderr: "SyntaxError: Unexpected token in /workspace/src/pages/index.tsx (10:4)",
      })),
    });

    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };

    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const input = createInput([
      {
        path: "src/pages/index.tsx",
        content: "export default () => <broken jsx",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("SyntaxError");
      expect(result.diagnosticsJson?.errors).toBeDefined();
    }
    expect(mock.session.destroy).toHaveBeenCalled();
  });

  it("kills process and destroys container when sandbox execution times out", async () => {
    const mock = createMockSandbox({
      exec: vi.fn(async () => {
        throw new Error("TIMEOUT: Container execution exceeded 30000ms limit");
      }),
    });

    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };

    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const input = createInput([
      {
        path: "src/pages/index.tsx",
        content: "export default () => <div>Infinite</div>",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("TIMEOUT");
    }
    expect(mock.session.killProcess).toHaveBeenCalled();
    expect(mock.session.destroy).toHaveBeenCalled();
  });

  it("fails cleanly when Cloudflare Sandbox provider is not available", async () => {
    const runner = new CloudflareSandboxViteThemeBuildRunner();

    const input = createInput([
      {
        path: "src/pages/index.tsx",
        content: "export default () => <div>Hello</div>;",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("SANDBOX_UNAVAILABLE");
    }
  });
});
