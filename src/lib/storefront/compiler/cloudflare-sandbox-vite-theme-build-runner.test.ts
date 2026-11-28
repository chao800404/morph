// @vitest-environment node
import { posix as posixPath } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TAILWIND_VERSION } from "./tailwind-builtin-stylesheets";
import { withThemeManagedStartBuildIdentity } from "./theme-morph-sdk";
import {
  CloudflareSandboxViteThemeBuildRunner,
  type CloudflareSandboxProvider,
  type CloudflareSandboxReadFileOptions,
  type CloudflareSandboxSession,
} from "./cloudflare-sandbox-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";
import { THEME_PREVIEW_FS_ALLOW_ROOTS } from "./theme-preview-dev-server";
import {
  START_TOOLCHAIN,
  answerToolchainCommand,
} from "./sandbox-toolchain.test-support";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import {
  PLATFORM_PRERENDER_CONTENT_UNAVAILABLE,
  PLATFORM_PRERENDER_PATH_NOT_SEALED,
} from "./theme-prerender-content";

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
    container: { manifestHash?: string } = {},
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
    // The container answers the toolchain check (theme-toolchains.ts) as the
    // image would; every other command is the test's own.
    const ownExec = session.exec;
    session.exec = vi.fn(
      async (command: string, options?: any) =>
        answerToolchainCommand(command, container.manifestHash) ??
        ownExec(command, options),
    ) as any;

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
    compilerVersion: withThemeManagedStartBuildIdentity(TAILWIND_VERSION),
    toolchainId: START_TOOLCHAIN.id,
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

    // Verify exact pinned vite binary execution.
    //
    // The timeout is pinned deliberately: it is the container build's kill
    // threshold, so changing the default has to be an edit someone makes here on
    // purpose rather than a number that drifts. `120_000` is a hang detector, not
    // a performance bound — see the default in the runner for the measurement
    // behind it.
    expect(mock.session.exec).toHaveBeenCalledWith(
      `${START_TOOLCHAIN.root}/node_modules/.bin/vite build --config /workspace/vite.config.ts`,
      expect.objectContaining({
        timeout: 120_000,
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
      `${START_TOOLCHAIN.root}/node_modules/.bin/vite build --config /workspace/vite.config.ts`,
      expect.objectContaining({
        env: {
          NODE_ENV: "production",
          MORPH_THEME_BUILD_TARGET: "runtime",
          NODE_OPTIONS: "--unhandled-rejections=strict",
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

  describe("a platform Start build whose prerender read unsealed content", () => {
    const refusedRecordPath =
      "/workspace/.morph/prerender-refused-reads.ndjson";
    const startOutput =
      "Error: Failed to fetch /landing: Internal Server Error";
    const ssgInput = () =>
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
          {
            path: "src/routes/landing.tsx",
            content: 'export const Route = createFileRoute("/landing")({});',
          },
        ],
        {
          entry: "src/routes/index.tsx",
          contentSnapshot: {
            publicationId: "pub",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            documents: [
              {
                item: {
                  id: "item",
                  publicationId: "pub",
                  itemType: "template",
                  contentId: "page",
                  revisionId: "revision",
                  metadata: { routePath: "/landing" },
                },
                document: {
                  version: 1,
                  sections: [],
                  renderPolicy: { mode: "ssg" },
                },
              },
            ],
          },
        },
      );
    const failingStartSandbox = (
      record: string | undefined,
      buildExit: 0 | 1 = 1,
      statSize?: number,
    ) =>
      createMockSandbox({
        exec: vi.fn(async (command: string) => {
          if (command.includes("find /workspace/dist")) {
            return {
              exitCode: 0,
              success: true,
              stdout:
                "200 /workspace/dist/runtime/server/index.js\n" +
                "80 /workspace/dist/runtime/client/landing/index.html\n" +
                "80 /workspace/dist/preview/index.html\n",
              stderr: "",
            };
          }
          if (command.startsWith("stat -c %s ")) {
            return command.endsWith(refusedRecordPath) && record !== undefined
              ? {
                  exitCode: 0,
                  success: true,
                  stdout: `${statSize ?? new TextEncoder().encode(record).byteLength}\n`,
                  stderr: "",
                }
              : {
                  exitCode: 1,
                  success: false,
                  stdout: "",
                  stderr: "stat: cannot statx: No such file or directory",
                };
          }
          if (command.includes("vite build")) {
            return buildExit === 0
              ? {
                  exitCode: 0,
                  success: true,
                  stdout: "vite build complete",
                  stderr: "",
                }
              : {
                  exitCode: 1,
                  success: false,
                  stdout: "",
                  stderr: startOutput,
                };
          }
          return { exitCode: 0, success: true, stdout: "", stderr: "" };
        }),
        readFile: vi.fn(async (filePath: string) => {
          if (filePath === refusedRecordPath && record !== undefined) {
            return { content: record };
          }
          if (filePath.startsWith("/workspace/dist/")) {
            return { content: "<html></html>" };
          }
          throw new Error(`unexpected read of ${filePath}`);
        }) as any,
      });
    const viteBuilds = (exec: unknown) =>
      (exec as { mock: { calls: [string][] } }).mock.calls.filter(([command]) =>
        command.includes("vite build"),
      ).length;

    it("fails a Start build that exited 0 when its prerender recorded a refused read, before any artifact is read", async () => {
      // The Theme caught the refused read and rendered its defaults: the
      // build succeeded, and its HTML holds defaults, not the author's content.
      const record =
        JSON.stringify({
          path: "/elsewhere",
          reason: PLATFORM_PRERENDER_PATH_NOT_SEALED,
        }) + "\n";
      const mock = failingStartSandbox(record, 0);
      const runner = new CloudflareSandboxViteThemeBuildRunner({
        sandboxProvider: { getSandbox: vi.fn(async () => mock.session) },
      });

      const result = await runner.run(ssgInput());

      expect(result.success).toBe(false);
      if (result.success) return;
      expect("artifacts" in result).toBe(false);
      expect(result.errorMessage).toMatch(
        /^PLATFORM_PRERENDER_CONTENT_UNAVAILABLE: prerendering read Morph content this build has not sealed: \/elsewhere \(PLATFORM_PRERENDER_PATH_NOT_SEALED: /,
      );
      expect(result.diagnosticsJson).toEqual({
        stage: "sandbox-start-compiler",
        errors: [
          {
            severity: "error",
            message: result.errorMessage,
            code: PLATFORM_PRERENDER_CONTENT_UNAVAILABLE,
          },
        ],
        refusedReads: [
          { path: "/elsewhere", reason: PLATFORM_PRERENDER_PATH_NOT_SEALED },
        ],
      });
      // Stopped at the Start build: no preview build, no dist scan, no reads
      // of build output.
      expect(viteBuilds(mock.session.exec)).toBe(1);
      expect(mock.session.exec).not.toHaveBeenCalledWith(
        expect.stringContaining("find /workspace/dist"),
        expect.anything(),
      );
      expect(mock.session.readFile).toHaveBeenCalledTimes(1);
      expect(mock.session.readFile).toHaveBeenCalledWith(
        refusedRecordPath,
        expect.anything(),
      );
      expect(mock.session.destroy).toHaveBeenCalled();
    });

    it("fails a Start build that exited 0 when its record is too large to read, without reading it", async () => {
      const mock = failingStartSandbox("x", 0, 2 * 1024 * 1024);
      const runner = new CloudflareSandboxViteThemeBuildRunner({
        sandboxProvider: { getSandbox: vi.fn(async () => mock.session) },
      });

      const result = await runner.run(ssgInput());

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorMessage).toMatch(
        /^PLATFORM_PRERENDER_CONTENT_UNAVAILABLE: prerendering read Morph content this build has not sealed: paths unknown/,
      );
      expect(result.diagnosticsJson?.stage).toBe("sandbox-start-compiler");
      expect(result.diagnosticsJson?.refusedReads).toEqual([]);
      expect(mock.session.readFile).not.toHaveBeenCalled();
      expect(viteBuilds(mock.session.exec)).toBe(1);
    });

    it.each([
      ["no record", undefined],
      ["an empty record", ""],
    ])(
      "succeeds as before when a prerendering build left %s",
      async (_label, record) => {
        const mock = failingStartSandbox(record, 0);
        const runner = new CloudflareSandboxViteThemeBuildRunner({
          sandboxProvider: { getSandbox: vi.fn(async () => mock.session) },
        });

        const result = await runner.run(ssgInput());

        if (!result.success) throw new Error(result.errorMessage);
        expect(viteBuilds(mock.session.exec)).toBe(2);
        expect(result.contentDependency).toBe("dependent");
      },
    );

    it("names the refused path in the build's error and diagnostics, keeping the build's output and stage", async () => {
      const record =
        JSON.stringify({
          path: "/elsewhere",
          reason: PLATFORM_PRERENDER_PATH_NOT_SEALED,
        }) + "\n";
      const mock = failingStartSandbox(record);
      const runner = new CloudflareSandboxViteThemeBuildRunner({
        sandboxProvider: { getSandbox: vi.fn(async () => mock.session) },
      });

      const result = await runner.run(ssgInput());

      // The generated config's content endpoint is the one that records.
      expect(
        String(mock.writtenFiles.get("/workspace/vite.config.ts")),
      ).toContain(PLATFORM_PRERENDER_PATH_NOT_SEALED);
      // A record the Theme's files carried is gone before the build runs.
      expect(mock.session.exec).toHaveBeenCalledWith(
        `rm -f ${refusedRecordPath}`,
        expect.anything(),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorMessage).toMatch(
        /^PLATFORM_PRERENDER_CONTENT_UNAVAILABLE: prerendering read Morph content this build has not sealed: \/elsewhere \(PLATFORM_PRERENDER_PATH_NOT_SEALED: /,
      );
      expect(result.errorMessage).toContain(startOutput);
      expect(result.diagnosticsJson).toEqual({
        stage: "sandbox-start-compiler",
        errors: [
          {
            severity: "error",
            message: result.errorMessage,
            code: PLATFORM_PRERENDER_CONTENT_UNAVAILABLE,
          },
        ],
        refusedReads: [
          { path: "/elsewhere", reason: PLATFORM_PRERENDER_PATH_NOT_SEALED },
        ],
      });
      expect(
        result.logs?.some(
          (log) => log.level === "error" && log.message.includes("/elsewhere"),
        ),
      ).toBe(true);
      expect(mock.session.destroy).toHaveBeenCalled();
    });

    it("keeps the build's own error when no content read was refused", async () => {
      const mock = failingStartSandbox(undefined);
      const runner = new CloudflareSandboxViteThemeBuildRunner({
        sandboxProvider: { getSandbox: vi.fn(async () => mock.session) },
      });

      const result = await runner.run(ssgInput());

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errorMessage).toBe(startOutput);
      expect(result.diagnosticsJson).toEqual({
        stage: "sandbox-start-compiler",
        errors: [{ severity: "error", message: startOutput }],
      });
      expect(mock.session.readFile).not.toHaveBeenCalled();
    });
  });

  const startupFailure = () =>
    Object.assign(new Error("Container failed to start"), {
      code: "INTERNAL_ERROR",
      context: { phase: "startup", error: "Container failed to start" },
    });

  it("starts the container again when it failed to start, and builds once in the one that did", async () => {
    const failed = createMockSandbox({
      exec: vi.fn(async () => {
        throw startupFailure();
      }),
    });
    const started = createMockSandbox();
    const order: string[] = [];
    vi.mocked(failed.session.destroy).mockImplementation(async () => {
      order.push("destroy failed");
    });
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi
        .fn()
        .mockImplementationOnce(async () => {
          order.push("acquire 1");
          return failed.session;
        })
        .mockImplementationOnce(async () => {
          order.push("acquire 2");
          return started.session;
        }),
    };
    const stillRunning = vi.fn(async () => true);
    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const result = await runner.run(
      createInput(
        [
          {
            path: "src/pages/index.tsx",
            content: "export default () => <h1>Home</h1>;",
            isEntry: true,
          },
        ],
        { stillRunning },
      ),
    );

    expect(result.success).toBe(true);
    // The same build and Sandbox id, the failed attempt destroyed first.
    expect(provider.getSandbox).toHaveBeenNthCalledWith(
      2,
      undefined,
      "sandbox-build-123",
    );
    expect(order).toEqual(["acquire 1", "destroy failed", "acquire 2"]);
    // The retried start came out of the start phase's own budget; the build
    // after it still has its full bound.
    const buildTimeout = vi
      .mocked(started.session.exec)
      .mock.calls.find(([command]) => command.includes("vite build"))![1]!
      .timeout!;
    expect(buildTimeout).toBe(120_000);
    // After the wait, and again once the container answered.
    expect(stillRunning).toHaveBeenCalledTimes(2);
    // Nothing of the Theme reached the container that did not start; the one
    // that did was built in once, and this run reports one result.
    expect(failed.session.exec).toHaveBeenCalledTimes(1);
    expect(failed.writtenFiles.size).toBe(0);
    expect(started.writtenFiles.size).toBeGreaterThan(0);
    if (result.success) {
      expect(new Set(result.artifacts.map((file) => file.path)).size).toBe(
        result.artifacts.length,
      );
    }
    expect(
      result.logs?.some((log) =>
        log.message.includes("attempt 2 of at most 3"),
      ),
    ).toBe(true);
  });

  it("starts the container again when the Durable Object's probe reports a failed start", async () => {
    // What a real session does: the probe runs inside the Durable Object and
    // answers with a value, because a thrown SDK error reaches the caller
    // with its message only. The answer is cloned as RPC would.
    const failed = createMockSandbox({
      probeStart: vi.fn(async () =>
        structuredClone({
          ok: false as const,
          name: "SandboxError",
          message: "Container failed to start: Container failed to start",
          code: "INTERNAL_ERROR",
          context: { phase: "startup" },
        }),
      ),
    });
    const started = createMockSandbox({
      probeStart: vi.fn(async () => ({ ok: true as const })),
    });
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi
        .fn()
        .mockResolvedValueOnce(failed.session)
        .mockResolvedValueOnce(started.session),
    };
    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const result = await runner.run(
      createInput([
        {
          path: "src/pages/index.tsx",
          content: "export default () => <h1>Home</h1>;",
          isEntry: true,
        },
      ]),
    );

    expect(result.success).toBe(true);
    expect(provider.getSandbox).toHaveBeenCalledTimes(2);
    expect(failed.session.destroy).toHaveBeenCalledTimes(1);
    // The probe is the Durable Object's, not an `exec` from here.
    expect(failed.session.exec).not.toHaveBeenCalled();
    expect(failed.writtenFiles.size).toBe(0);
    expect(vi.mocked(started.session.probeStart!).mock.calls[0]![0]).toBe(
      60_000,
    );
    expect(
      vi
        .mocked(started.session.exec)
        .mock.calls.some(([command]) => command === "true"),
    ).toBe(false);
    expect(
      result.logs?.some((log) =>
        log.message.includes(
          "Attempt 1 failed to start the container (startup)",
        ),
      ),
    ).toBe(true);
  });

  it("does not start again when the Durable Object's probe reports some other failure", async () => {
    const mock = createMockSandbox({
      probeStart: vi.fn(async () => ({
        ok: false as const,
        name: "Error",
        message: "Command failed",
        code: null,
        context: {},
      })),
    });
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };
    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const result = await runner.run(
      createInput([
        {
          path: "src/pages/index.tsx",
          content: "export default () => <h1>Home</h1>;",
          isEntry: true,
        },
      ]),
    );

    expect(result.success).toBe(false);
    expect(provider.getSandbox).toHaveBeenCalledTimes(1);
    expect(mock.session.destroy).toHaveBeenCalledTimes(1);
    expect(mock.writtenFiles.size).toBe(0);
  });

  it("does not start again once the container answered, even for a start-coded error", async () => {
    // The probe answered, so the workspace write that fails may have taken
    // effect: this is no longer the start phase, and nothing is retried.
    const mock = createMockSandbox({
      writeFile: vi.fn(async () => {
        throw startupFailure();
      }),
    });
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };
    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const result = await runner.run(
      createInput([
        {
          path: "src/pages/index.tsx",
          content: "export default () => <h1>Home</h1>;",
          isEntry: true,
        },
      ]),
    );

    expect(result.success).toBe(false);
    expect(provider.getSandbox).toHaveBeenCalledTimes(1);
    expect(mock.session.destroy).toHaveBeenCalledTimes(1);
  });

  describe("a start that never answers", () => {
    const entry = [
      {
        path: "src/pages/index.tsx",
        content: "export default () => <h1>Home</h1>;",
        isEntry: true,
      },
    ];
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-23T00:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** The run's result once the start budget has elapsed, or "pending". */
    async function afterBudget(work: Promise<unknown>) {
      const outcome = work.then((value) => ({ value }));
      await vi.advanceTimersByTimeAsync(90_000);
      // The destroy after a timeout has its own 30 s bound.
      await vi.advanceTimersByTimeAsync(30_000);
      return Promise.race([outcome, Promise.resolve("pending" as const)]);
    }

    it("fails the build with the start's diagnostics when the probe never answers", async () => {
      let lateProbe!: (value: { ok: true }) => void;
      const mock = createMockSandbox({
        probeStart: vi.fn(
          () =>
            new Promise<{ ok: true }>((done) => {
              lateProbe = done;
            }),
        ),
      });
      const provider: CloudflareSandboxProvider = {
        getSandbox: vi.fn(async () => mock.session),
      };
      const runner = new CloudflareSandboxViteThemeBuildRunner({
        sandboxProvider: provider,
      });

      const outcome = await afterBudget(runner.run(createInput(entry)));
      expect(outcome).not.toBe("pending");
      const result = (outcome as { value: any }).value;
      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/^SANDBOX_START_TIMEOUT: /);
      expect(result.diagnosticsJson).toMatchObject({
        stage: "sandbox-start",
        startStage: "probe",
        attempt: 1,
        elapsedMs: 90_000,
        boundMs: 90_000,
        destroyConfirmed: true,
        reason: expect.stringContaining("SANDBOX_START_TIMEOUT"),
      });
      expect(provider.getSandbox).toHaveBeenCalledTimes(1);
      expect(mock.session.destroy).toHaveBeenCalledTimes(1);

      // The container answering afterwards changes nothing: no workspace is
      // written and no build command runs in it.
      lateProbe({ ok: true });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mock.writtenFiles.size).toBe(0);
      expect(
        vi
          .mocked(mock.session.exec)
          .mock.calls.some(([command]) => String(command).includes("vite")),
      ).toBe(false);
    });

    it("fails the build with the start's diagnostics when the Sandbox is never handed over", async () => {
      const provider: CloudflareSandboxProvider = {
        getSandbox: vi.fn(() => new Promise<CloudflareSandboxSession>(() => {})),
      };
      const runner = new CloudflareSandboxViteThemeBuildRunner({
        sandboxProvider: provider,
      });

      const outcome = await afterBudget(runner.run(createInput(entry)));
      expect(outcome).not.toBe("pending");
      const result = (outcome as { value: any }).value;
      expect(result.success).toBe(false);
      expect(result.diagnosticsJson).toMatchObject({
        stage: "sandbox-start",
        startStage: "acquire",
        attempt: 1,
        elapsedMs: 90_000,
        reason: expect.stringContaining("SANDBOX_START_TIMEOUT"),
      });
      expect(provider.getSandbox).toHaveBeenCalledTimes(1);
    });
  });

  describe("the toolchain the build records", () => {
    const source = [
      {
        path: "src/pages/index.tsx",
        content: "export default () => <h1>Home</h1>;",
        isEntry: true,
      },
    ];

    it.each([
      ["THEME_TOOLCHAIN_MISSING", undefined],
      ["THEME_TOOLCHAIN_UNKNOWN", "0".repeat(64)],
      [
        "THEME_TOOLCHAIN_FRAMEWORK_MISMATCH",
        themeToolchainForFramework("astro").id,
      ],
    ])(
      "is refused with %s before any container is started",
      async (code, toolchainId) => {
        const provider: CloudflareSandboxProvider = { getSandbox: vi.fn() };
        const runner = new CloudflareSandboxViteThemeBuildRunner({
          sandboxProvider: provider,
        });

        const result = await runner.run(createInput(source, { toolchainId }));

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.errorMessage).toContain(code);
          expect(result.diagnosticsJson?.stage).toBe("toolchain");
        }
        expect(provider.getSandbox).not.toHaveBeenCalled();
      },
    );

    it("is not built with a container whose manifest is another toolchain's, and nothing of the Theme is written", async () => {
      const mock = createMockSandbox(undefined, {
        manifestHash: "e".repeat(64),
      });
      const runner = new CloudflareSandboxViteThemeBuildRunner({
        sandboxProvider: { getSandbox: vi.fn(async () => mock.session) },
      });

      const result = await runner.run(createInput(source));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorMessage).toContain("THEME_TOOLCHAIN_MISMATCH");
      }
      expect(mock.writtenFiles.size).toBe(0);
      const commands = vi
        .mocked(mock.session.exec)
        .mock.calls.map(([command]) => command);
      expect(commands.some((command) => command.includes("vite build"))).toBe(
        false,
      );
      expect(commands.some((command) => command.includes("ln -s"))).toBe(false);
      expect(mock.session.destroy).toHaveBeenCalled();
    });

    it("links this build's workspace to the recorded toolchain and builds with its Vite", async () => {
      const mock = createMockSandbox();
      const runner = new CloudflareSandboxViteThemeBuildRunner({
        sandboxProvider: { getSandbox: vi.fn(async () => mock.session) },
      });

      const result = await runner.run(createInput(source));

      expect(result.success).toBe(true);
      const commands = vi
        .mocked(mock.session.exec)
        .mock.calls.map(([command]) => command);
      const checked = commands.indexOf(
        `sha256sum ${START_TOOLCHAIN.manifestPath}`,
      );
      const linked = commands.findIndex((command) =>
        command.includes(
          `ln -s ${START_TOOLCHAIN.root}/node_modules /workspace/node_modules`,
        ),
      );
      const built = commands.findIndex((command) =>
        command.startsWith(
          `${START_TOOLCHAIN.root}/node_modules/.bin/vite build`,
        ),
      );
      expect(checked).toBeGreaterThanOrEqual(0);
      expect(linked).toBeGreaterThan(checked);
      expect(built).toBeGreaterThan(linked);
    });
  });

  it("kills process and destroys container when sandbox execution times out", async () => {
    const mock = createMockSandbox({
      exec: vi.fn(async (command: string) => {
        // The container starts; the build in it is what runs out of time.
        if (command === "true") {
          return { exitCode: 0, success: true, stdout: "", stderr: "" };
        }
        // Says 120000 because that is the threshold now. The string is
        // fabricated and asserts nothing, which is exactly why it was still
        // claiming 30000 after the default moved — a number nothing checks is a
        // number that drifts, and a reader has no reason to disbelieve it.
        throw new Error("TIMEOUT: Container execution exceeded 120000ms limit");
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
    // Timed out is not finished: nothing of the build was collected.
    expect(mock.session.readFile).not.toHaveBeenCalled();
  });

  it("records a teardown it could not confirm, rather than reporting it done", async () => {
    const mock = createMockSandbox({
      destroy: vi.fn(async () => {
        throw new Error("destroy refused");
      }),
    });
    const provider: CloudflareSandboxProvider = {
      getSandbox: vi.fn(async () => mock.session),
    };
    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: provider,
    });

    const result = await runner.run(
      createInput([
        {
          path: "src/pages/index.tsx",
          content: "export default () => <h1>Home</h1>;",
          isEntry: true,
        },
      ]),
    );

    expect(
      result.logs?.some(
        (log) =>
          log.level === "warn" &&
          log.message.includes("teardown could not be confirmed"),
      ),
    ).toBe(true);
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

  /**
   * Runs the enforcer the runner actually writes into the container, rather
   * than matching its text. A string assertion would still pass if the gate
   * were inverted, and this plugin is the containment boundary.
   */
  const loadGeneratedEnforcer = async (command: "build" | "serve") => {
    const mock = createMockSandbox();
    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: { getSandbox: async () => mock.session },
      sandboxBinding: {},
    });
    await runner.run(
      createInput([
        {
          path: "src/pages/index.tsx",
          content: "export default () => null;",
          isEntry: true,
        },
      ]),
    );
    const config = String(mock.writtenFiles.get("/workspace/vite.config.ts"));
    const start = config.indexOf("const approvedSet");
    const end = config.indexOf("export default defineConfig(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const factory = new Function(
      "path",
      "fs",
      `${config.slice(start, end)}
       dependencyEnforcerPlugin.configResolved({ command: ${JSON.stringify(command)} });
       return dependencyEnforcerPlugin;`,
    );
    // The generated config runs in the Linux sandbox. Use POSIX path
    // semantics here even when the test suite itself runs on Windows.
    return factory(posixPath, await import("node:fs"));
  };

  const VITE_DEV_CLIENT = `/@fs${START_TOOLCHAIN.root}/node_modules/vite/dist/client/client.mjs`;

  it("serves Vite's own dev client so the Live Preview can run at all", async () => {
    const enforcer = await loadGeneratedEnforcer("serve");
    expect(enforcer.resolveId(VITE_DEV_CLIENT, "/workspace/index.html")).toBe(
      null,
    );
  });

  it("keeps refusing that same path during a build", async () => {
    const enforcer = await loadGeneratedEnforcer("build");
    expect(() =>
      enforcer.resolveId(VITE_DEV_CLIENT, "/workspace/index.html"),
    ).toThrow("UNAPPROVED_DEPENDENCY_PATH");
  });

  it("bounds what a dev server may read off disk to the workspace and the toolchain", async () => {
    // `/@fs/` is a dev-server URL, so the enforcer is the wrong layer to judge
    // it: the real question is which files Vite will read. Vite answers that
    // with server.fs, and left unset it guesses a root. The config states it.
    const mock = createMockSandbox();
    const runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: { getSandbox: async () => mock.session },
      sandboxBinding: {},
    });
    await runner.run(
      createInput([
        {
          path: "src/pages/index.tsx",
          content: "export default () => null;",
          isEntry: true,
        },
      ]),
    );
    const config = String(mock.writtenFiles.get("/workspace/vite.config.ts"));
    expect(config).toContain("strict: true");
    expect(config).toContain(
      `allow: ${JSON.stringify(THEME_PREVIEW_FS_ALLOW_ROOTS)}`,
    );
    expect(THEME_PREVIEW_FS_ALLOW_ROOTS).toEqual([
      "/workspace",
      `${START_TOOLCHAIN.root}/node_modules`,
    ]);
  });
});
