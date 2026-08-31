// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CloudflareSandboxViteThemeBuildRunner,
  type CloudflareSandboxProvider,
  type CloudflareSandboxReadFileOptions,
  type CloudflareSandboxSession,
} from "./cloudflare-sandbox-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";

describe("CloudflareSandboxViteThemeBuildRunner (Phase 4B-5)", () => {
  it("rejects CMS-selected packages that are not in the pinned sandbox toolchain", () => {
    expect(
      () =>
        new CloudflareSandboxViteThemeBuildRunner({
          approvedDependencies: ["date-fns"],
        }),
    ).toThrow("THEME_DEPENDENCY_VERSION_MISSING: date-fns");
  });

  const createMockSandbox = (
    overrides?: Partial<CloudflareSandboxSession>,
  ): {
    session: CloudflareSandboxSession;
    writtenFiles: Map<string, string | Uint8Array>;
    destroyed: boolean;
    processKilled: boolean;
  } => {
    const writtenFiles = new Map<string, string | Uint8Array>();
    let destroyed = false;
    let processKilled = false;

    const session: CloudflareSandboxSession = {
      writeFile: vi.fn(
        async (filePath: string, content: string | Uint8Array) => {
          writtenFiles.set(filePath, content);
        },
      ),
      mkdir: vi.fn(async () => {}),
      readFile: vi.fn(
        async (
          filePath: string,
          options?: CloudflareSandboxReadFileOptions | "utf8" | "binary",
        ) => {
          const encoding =
            typeof options === "object" ? options.encoding : options;
          if (filePath.endsWith(".html")) {
            return {
              content:
                "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
            };
          }
          if (filePath.endsWith(".js")) {
            return { content: 'console.log("compiled bundle");' };
          }
          if (filePath.endsWith(".css")) {
            return {
              content: "/* compiled tailwind v4 */\n.grid { display: grid; }",
            };
          }
          if (filePath.endsWith(".png")) {
            // Verify binary mode uses { encoding: "none" } and test stream return value
            expect(encoding).toBe("none");
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
                controller.close();
              },
            });
            return { content: stream };
          }
          return { content: "file content" };
        },
      ) as any,
      exec: vi.fn(async (command: string) => {
        if (command.includes("find /workspace/dist")) {
          return {
            exitCode: 0,
            success: true,
            stdout:
              "56 /workspace/dist/index.html\n1024 /workspace/dist/assets/index-A1b2.js\n512 /workspace/dist/assets/index-C3d4.css\n4 /workspace/dist/assets/logo.png\n",
            stderr: "",
          };
        }
        return {
          exitCode: 0,
          success: true,
          stdout: "vite build complete in 1.2s",
          stderr: "",
        };
      }),

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
    files: Array<{
      path: string;
      content: string | Uint8Array;
      isEntry?: boolean;
    }>,
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

  it("orchestrates build inside isolated Cloudflare Sandbox container with pinned toolchain, official readFile contract, and /workspace containment", async () => {
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
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: { paths: { "@/*": ["src/*"] } },
        }),
      },
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
    expect(provider.getSandbox).toHaveBeenCalledWith(
      { name: "SANDBOX_DO" },
      "sandbox-build-123",
    );

    // Verify container package.json has pinned exact toolchain dependencies
    const writtenPkg = JSON.parse(
      String(mock.writtenFiles.get("/workspace/package.json")),
    );
    expect(writtenPkg.dependencies["react"]).toBe("19.2.1");
    expect(writtenPkg.dependencies["tailwindcss"]).toBe("4.1.17");
    expect(writtenPkg.dependencies["@tailwindcss/vite"]).toBe("4.1.17");
    expect(writtenPkg.dependencies["@vitejs/plugin-react"]).toBe("5.2.0");
    expect(writtenPkg.dependencies["@tanstack/react-start"]).toBe("1.168.32");
    expect(writtenPkg.dependencies["@tanstack/react-router"]).toBe("1.170.18");

    // Verify container vite.config.ts has injected dependency enforcer AND path containment
    const writtenViteConfig = String(
      mock.writtenFiles.get("/workspace/vite.config.ts"),
    );
    expect(writtenViteConfig).toContain("morph-dependency-enforcer");
    expect(writtenViteConfig).toContain("UNAPPROVED_DEPENDENCY");
    expect(writtenViteConfig).toContain("UNAPPROVED_DEPENDENCY_PATH");
    expect(writtenViteConfig).toContain("WORKSPACE_PATH_ESCAPE");
    expect(writtenViteConfig).toContain(
      '!normalizedResolved.startsWith("/workspace")',
    );
    expect(writtenViteConfig).toContain('"key":"@"');
    expect(writtenViteConfig).toContain("themeAliases");

    // Verify exact pinned vite binary execution
    expect(mock.session.exec).toHaveBeenCalledWith(
      "/opt/morph-toolchain/node_modules/.bin/vite build --config /workspace/vite.config.ts",
      expect.objectContaining({
        timeout: 30_000,
        env: {
          NODE_ENV: "production",
          MORPH_THEME_BUILD_TARGET: "preview",
        },
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
      expect(png?.sizeBytes).toBe(4);
    }
  });

  it("builds a TanStack Start Worker and the isolated preview adapter in the same immutable artifact set", async () => {
    const mock = createMockSandbox({
      exec: vi.fn(async (command: string) => {
        if (command.includes("find /workspace/dist")) {
          return {
            exitCode: 0,
            success: true,
            stdout:
              "200 /workspace/dist/runtime/server/index.js\n" +
              "120 /workspace/dist/runtime/client/assets/app.js\n" +
              "80 /workspace/dist/preview/index.html\n" +
              "90 /workspace/dist/preview/assets/preview.js\n",
            stderr: "",
          };
        }
        return {
          exitCode: 0,
          success: true,
          stdout: "vite build complete",
          stderr: "",
        };
      }),
    });
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };
    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const result = await runner.run(
      createInput(
        [
          {
            path: "morph.theme.json",
            content: JSON.stringify({
              entry: "src/routes/index.tsx",
              router: { framework: "tanstack-start" },
            }),
          },
          {
            path: "src/router.tsx",
            content:
              "export function getRouter() { return createRouter({ routeTree }); }",
          },
          {
            path: "src/routes/__root.tsx",
            content: "export const Route = createRootRoute({});",
          },
          {
            path: "src/routes/index.tsx",
            content: 'export const Route = createFileRoute("/")({});',
          },
        ],
        { entry: "src/routes/index.tsx" },
      ),
    );

    expect(result.success).toBe(true);
    expect(mock.writtenFiles.has("/workspace/wrangler.json")).toBe(true);
    const generatedConfig = String(
      mock.writtenFiles.get("/workspace/vite.config.ts"),
    );
    expect(generatedConfig).not.toContain("@morph/storefront-runtime");
    // The container builds against this generated config and cannot import
    // Morph's source, so the in-process stub plugin does not apply there.
    // Without it the preview pass fails on `#tanstack-router-entry` and on
    // `node:async_hooks` — a failure the in-process runner never reproduces,
    // which is why it stayed hidden until a real Build Preview ran.
    expect(generatedConfig).toContain("morph-theme-preview-server-stub");
    expect(generatedConfig).toContain("@tanstack/react-start/server");
    expect(generatedConfig).toContain("node:async_hooks");
    expect(mock.session.exec).toHaveBeenCalledWith(
      "/opt/morph-toolchain/node_modules/.bin/vite build --config /workspace/vite.config.ts",
      expect.objectContaining({
        env: {
          NODE_ENV: "production",
          MORPH_THEME_BUILD_TARGET: "runtime",
        },
      }),
    );
    if (result.success) {
      expect(result.manifestJson.artifactEntry).toBe("preview/index.html");
      expect(result.manifestJson.metadata).toEqual(
        expect.objectContaining({
          runtime: "cloudflare-worker",
          workerEntry: "runtime/server/index.js",
        }),
      );
      expect(
        result.artifacts.some(
          (artifact) => artifact.path === "runtime/server/index.js",
        ),
      ).toBe(true);
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

  it("blocks theme virtual files located inside node_modules before sandbox is acquired", async () => {
    const mock = createMockSandbox();
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };

    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

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
      expect(provider.getSandbox).not.toHaveBeenCalled();
      expect(mock.session.writeFile).not.toHaveBeenCalled();
    }
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
        stderr:
          "SyntaxError: Unexpected token in /workspace/src/pages/index.tsx (10:4)",
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

  it("enforces maxOutputFiles preflight limit before reading file bodies", async () => {
    const mock = createMockSandbox({
      exec: vi.fn(async (command: string) => {
        if (command.includes("find /workspace/dist")) {
          return {
            exitCode: 0,
            success: true,
            stdout:
              "100 /workspace/dist/1.js\n100 /workspace/dist/2.js\n100 /workspace/dist/3.js\n",
            stderr: "",
          };
        }
        return { exitCode: 0, success: true, stdout: "", stderr: "" };
      }),
    });

    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };

    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
      maxOutputFiles: 2,
    });

    const input = createInput([
      {
        path: "src/pages/index.tsx",
        content: "export default () => 1;",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("LIMIT_EXCEEDED");
      expect(result.errorMessage).toContain("file count");
    }
    // Preflight prevented reading file bodies
    expect(mock.session.readFile).not.toHaveBeenCalled();
  });

  it("enforces maxOutputSizeBytes preflight limit before reading file bodies", async () => {
    const mock = createMockSandbox({
      exec: vi.fn(async (command: string) => {
        if (command.includes("find /workspace/dist")) {
          return {
            exitCode: 0,
            success: true,
            stdout: "50000000 /workspace/dist/huge-bundle.js\n",
            stderr: "",
          };
        }
        return { exitCode: 0, success: true, stdout: "", stderr: "" };
      }),
    });

    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };

    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
      maxOutputSizeBytes: 1024 * 1024, // 1 MB limit
    });

    const input = createInput([
      {
        path: "src/pages/index.tsx",
        content: "export default () => 1;",
        isEntry: true,
      },
    ]);

    const result = await runner.run(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain("LIMIT_EXCEEDED");
      expect(result.errorMessage).toContain(
        "dist output (50000000 bytes) exceeds limit",
      );
    }
    // Preflight prevented reading file bodies
    expect(mock.session.readFile).not.toHaveBeenCalled();
  });
});
