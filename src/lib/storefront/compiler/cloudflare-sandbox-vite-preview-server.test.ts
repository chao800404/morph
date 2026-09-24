// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CloudflareSandboxVitePreviewServer,
  THEME_PREVIEW_SERVER_PORT,
  THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
  THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
  type PreviewServerSession,
} from "./cloudflare-sandbox-vite-preview-server";

type Harness = {
  session: PreviewServerSession;
  written: Map<string, string>;
  writePaths: string[];
  deletedPaths: string[];
  commands: string[];
  envs: Array<Record<string, string> | undefined>;
  exposed: Array<{ port: number; hostname: string }>;
  unexposed: number[];
  killed: Array<string | undefined>;
  destroyed: number;
  sleepAfter: Array<string | number>;
  waitedPorts: Array<{ port: number; path?: string }>;
  emit: (line: string) => void;
  exit: () => void;
};

const createSession = (
  behaviour: "ready" | "log-ready" | "silent" | "exit" = "ready",
): Harness => {
  const written = new Map<string, string>();
  const writePaths: string[] = [];
  const deletedPaths: string[] = [];
  const commands: string[] = [];
  const envs: Array<Record<string, string> | undefined> = [];
  const exposed: Array<{ port: number; hostname: string }> = [];
  const unexposed: number[] = [];
  const killed: Array<string | undefined> = [];
  const sleepAfter: Array<string | number> = [];
  const waitedPorts: Array<{ port: number; path?: string }> = [];
  let destroyed = 0;
  let onOutput: ((s: "stdout" | "stderr", d: string) => void) | undefined;
  let onExit: ((code: number | null) => void) | undefined;

  const session: PreviewServerSession = {
    async mkdir() {},
    async writeFile(path, content) {
      writePaths.push(path);
      written.set(path, String(content));
    },
    async readFile(path) {
      if (!written.has(path)) throw new Error("ENOENT");
      return { content: written.get(path)! };
    },
    async listFiles() {
      return {
        success: true,
        files: Array.from(written.keys(), (absolutePath) => ({
          absolutePath,
          type: "file" as const,
        })),
      };
    },
    async deleteFile(path) {
      deletedPaths.push(path);
      written.delete(path);
    },
    async startProcess(command, options) {
      commands.push(command);
      envs.push(options?.env);
      onOutput = options?.onOutput;
      onExit = options?.onExit;
      if (behaviour === "log-ready") {
        queueMicrotask(() =>
          onOutput?.("stdout", "  VITE v7.3.5  ready in 3118 ms\n"),
        );
      }
      if (behaviour === "exit") {
        queueMicrotask(() => onExit?.(1));
      }
      return {
        id: "proc-1",
        ...(behaviour === "log-ready"
          ? {}
          : {
              waitForPort: async (
                port: number,
                options?: { path?: string },
              ) => {
                waitedPorts.push({ port, path: options?.path });
                if (behaviour === "ready") return;
                if (behaviour === "exit") {
                  throw new Error("Process exited before the port was ready.");
                }
                await new Promise(() => {});
              },
            }),
      };
    },
    async exposePort(port, options) {
      exposed.push({ port, hostname: options.hostname });
      return { url: `https://${port}-sbx-tok.${options.hostname}` };
    },
    async unexposePort(port) {
      unexposed.push(port);
    },
    async killProcess(id) {
      killed.push(id);
    },
    async setSleepAfter(value) {
      sleepAfter.push(value);
    },
    async destroy() {
      destroyed += 1;
    },
  };

  return {
    session,
    written,
    writePaths,
    deletedPaths,
    commands,
    envs,
    exposed,
    unexposed,
    killed,
    sleepAfter,
    waitedPorts,
    get destroyed() {
      return destroyed;
    },
    emit: (line) => onOutput?.("stdout", line),
    exit: () => onExit?.(1),
  } as Harness;
};

const THEME = [
  {
    path: "src/routes/__root.tsx",
    content: `import { createRootRoute, Outlet } from "@tanstack/react-router";\nexport const Route = createRootRoute({ component: () => <Outlet /> });\n`,
  },
  {
    path: "src/components/Hero.tsx",
    content: `export const contentFields = { heading: { type: "text" } } as const;\nexport default function Hero({ heading }: { heading?: string }) { return <h1>{heading}</h1>; }\n`,
  },
  {
    path: "src/pages/index.tsx",
    content: `import Hero from "../components/Hero";\nexport default () => <Hero heading="Hi" />;\n`,
  },
];

const startWith = (
  harness: Harness,
  overrides: Partial<
    Parameters<CloudflareSandboxVitePreviewServer["start"]>[0]
  > = {},
  options: ConstructorParameters<
    typeof CloudflareSandboxVitePreviewServer
  >[0] = {},
) => {
  const server = new CloudflareSandboxVitePreviewServer({
    sandboxProvider: { getSandbox: async () => harness.session },
    sandboxBinding: {},
    ...options,
  });
  return server.start({
    previewId: "preview-1",
    files: THEME,
    entry: "src/pages/index.tsx",
    previewHostname: "preview.example.com",
    env: { PUBLIC_URL: "https://admin.example.com" },
    ...overrides,
  });
};

describe("CloudflareSandboxVitePreviewServer", () => {
  it("serves the Theme from its own origin once Vite reports itself ready", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe(
      `https://${THEME_PREVIEW_SERVER_PORT}-sbx-tok.preview.example.com/__morph-theme-preview__/`,
    );
    expect(harness.exposed).toEqual([
      { port: THEME_PREVIEW_SERVER_PORT, hostname: "preview.example.com" },
    ]);
    expect(harness.destroyed).toBe(0);
    expect(harness.waitedPorts).toEqual([
      {
        port: THEME_PREVIEW_SERVER_PORT,
        path: "/__morph-theme-preview__/",
      },
    ]);
    expect(result.timings).toMatchObject({
      reusedProcess: false,
      mkdirCalls: expect.any(Number),
      writeCalls: expect.any(Number),
      viteReadyMs: expect.any(Number),
    });
  });

  it("falls back to the Vite log marker for providers without a port check", async () => {
    const harness = createSession("log-ready");

    expect((await startWith(harness)).ok).toBe(true);
    expect(harness.waitedPorts).toEqual([]);
  });

  it("pins the port so the exposed URL cannot point at nothing", async () => {
    const harness = createSession("ready");
    await startWith(harness);

    expect(harness.commands[0]).toContain(
      `--port ${THEME_PREVIEW_SERVER_PORT} --strictPort`,
    );
    expect(harness.commands[0]).toContain(
      "/vite --config /workspace/vite.config.ts",
    );
  });

  it("hands the Theme's own process no Morph credential", async () => {
    const harness = createSession("ready");
    await startWith(harness);

    expect(harness.envs[0]).toEqual({ NODE_ENV: "development" });
  });

  it("refuses to serve user code from any Morph host, however it is written", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness, {
      previewHostname: "Admin.Example.com.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("PLATFORM_PREVIEW_HOST");
    expect(harness.commands).toEqual([]);
  });

  it("fails closed when no preview host is configured", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness, { previewHostname: "  " });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("MISSING_PREVIEW_HOST");
    expect(harness.commands).toEqual([]);
  });

  it("lifts contentFields out of the served copy so edits keep component state", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hoistedContentFields).toContain("src/components/Hero.tsx");
    const served = harness.written.get("/workspace/src/components/Hero.tsx");
    expect(served).not.toContain("export const contentFields");
    expect(served).toContain("const contentFields");
  });

  it("removes a source file left by an older preview plan", async () => {
    const harness = createSession("ready");
    harness.written.set(
      "/workspace/src/routes/deleted.tsx",
      "export default function Deleted() {}",
    );

    expect((await startWith(harness)).ok).toBe(true);
    expect(harness.deletedPaths).toContain("/workspace/src/routes/deleted.tsx");
    expect(harness.written.has("/workspace/src/routes/deleted.tsx")).toBe(
      false,
    );
  });

  it("stops only its own Vite when it never becomes ready, and leaves the shared sandbox", async () => {
    const harness = createSession("silent");
    const result = await startWith(harness, {}, { readyTimeoutMs: 20 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("PREVIEW_SERVER_TIMEOUT");
    // The process this start launched, by its id — nothing else.
    expect(harness.killed).toEqual(["proc-1"]);
    // Other tabs share this sandbox; it is not this start's to destroy.
    expect(harness.destroyed).toBe(0);
    // The next start must not trust what this one left.
    expect(harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH)).toBe(
      "dirty",
    );
  });

  it("reports an exit before readiness rather than waiting out the timeout", async () => {
    const harness = createSession("exit");
    const result = await startWith(harness, {}, { readyTimeoutMs: 10_000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("PREVIEW_SERVER_EXITED");
    expect(harness.destroyed).toBe(0);
    expect(harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH)).toBe(
      "dirty",
    );
  });

  it("lets an idle container be reclaimed", async () => {
    const harness = createSession("ready");
    await startWith(harness, {}, { sleepAfter: "5m" });

    expect(harness.sleepAfter).toEqual(["5m"]);
  });

  it("revokes the URL before it stops supervising the process", async () => {
    const harness = createSession("ready");
    const server = new CloudflareSandboxVitePreviewServer({
      sandboxProvider: { getSandbox: async () => harness.session },
      sandboxBinding: {},
    });

    const order: string[] = [];
    vi.spyOn(harness.session, "unexposePort" as never).mockImplementation(
      (async () => {
        order.push("unexpose");
      }) as never,
    );
    vi.spyOn(harness.session, "killProcess" as never).mockImplementation(
      (async () => {
        order.push("kill");
      }) as never,
    );

    await server.stop("preview-1", "proc-1");

    expect(order).toEqual(["unexpose", "kill"]);
    expect(harness.destroyed).toBe(1);
  });
});

describe("checking on a preview someone is watching", () => {
  const viteProcess = (status: string) => ({
    id: "vite",
    command:
      "/opt/morph-toolchain/node_modules/.bin/vite --config /workspace/vite.config.ts",
    status,
  });

  it("reports a preview whose dev server is still up", async () => {
    const harness = createSession("silent");
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => [viteProcess("running")];
    (harness.session as { getExposedPorts?: unknown }).getExposedPorts =
      async () => [
        {
          url: `https://${THEME_PREVIEW_SERVER_PORT}-sbx-tok.preview.example.com`,
          port: THEME_PREVIEW_SERVER_PORT,
          status: "active",
        },
      ];
    const server = new CloudflareSandboxVitePreviewServer({
      sandboxProvider: { getSandbox: async () => harness.session },
    });

    await expect(
      server.isServing({
        previewId: "preview-1",
        previewHostname: "preview.example.com",
      }),
    ).resolves.toBe(true);
  });

  it("does not call a preview gone just because no address is listed", async () => {
    // Measured against a local sandbox whose preview URL answered 200
    // throughout: the runtime lists no forwardable ports at all. Reading that
    // as unreachable reconnected a working preview once per renewal — worse
    // than the stale frame the check exists for.
    const harness = createSession("silent");
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => [viteProcess("running")];
    (harness.session as { getExposedPorts?: unknown }).getExposedPorts =
      async () => [];
    const server = new CloudflareSandboxVitePreviewServer({
      sandboxProvider: { getSandbox: async () => harness.session },
    });

    await expect(
      server.isServing({
        previewId: "preview-1",
        previewHostname: "preview.localhost",
        expectedOrigin: `http://${THEME_PREVIEW_SERVER_PORT}-sbx-tok.preview.localhost:3000`,
      }),
    ).resolves.toBe(true);
  });

  it("reports a preview reachable at an address the editor is not framing", async () => {
    // Re-exposing mints a new address. A port is active again, but the URL the
    // author's iframe holds is dead, and only the editor knows which it has.
    const harness = createSession("silent");
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => [viteProcess("running")];
    (harness.session as { getExposedPorts?: unknown }).getExposedPorts =
      async () => [
        {
          url: `https://${THEME_PREVIEW_SERVER_PORT}-fresh-token.preview.example.com`,
          port: THEME_PREVIEW_SERVER_PORT,
          status: "active",
        },
      ];
    const server = new CloudflareSandboxVitePreviewServer({
      sandboxProvider: { getSandbox: async () => harness.session },
    });

    await expect(
      server.isServing({
        previewId: "preview-1",
        previewHostname: "preview.example.com",
        expectedOrigin: `https://${THEME_PREVIEW_SERVER_PORT}-stale-token.preview.example.com`,
      }),
    ).resolves.toBe(false);

    await expect(
      server.isServing({
        previewId: "preview-1",
        previewHostname: "preview.example.com",
        expectedOrigin: `https://${THEME_PREVIEW_SERVER_PORT}-fresh-token.preview.example.com`,
      }),
    ).resolves.toBe(true);
  });

  it("reports a container that answers but no longer serves the Theme", async () => {
    // The sandbox can outlive the dev server inside it, and a preview with no
    // Vite is as gone as one with no container.
    const harness = createSession("silent");
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => [viteProcess("exited")];
    const server = new CloudflareSandboxVitePreviewServer({
      sandboxProvider: { getSandbox: async () => harness.session },
    });

    await expect(
      server.isServing({
        previewId: "preview-1",
        previewHostname: "preview.example.com",
      }),
    ).resolves.toBe(false);
  });

  it("reports a sandbox that cannot be reached at all", async () => {
    // This is the case the editor cannot see for itself: the preview page is
    // still loaded in the browser and still answering its heartbeat.
    const harness = createSession("silent");
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => {
        throw new Error("container is gone");
      };
    const server = new CloudflareSandboxVitePreviewServer({
      sandboxProvider: { getSandbox: async () => harness.session },
    });

    await expect(
      server.isServing({
        previewId: "preview-1",
        previewHostname: "preview.example.com",
      }),
    ).resolves.toBe(false);
  });
});

describe("asking twice for the same preview", () => {
  const withRunningVite = (harness: Harness) => {
    let running = true;
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () =>
        running
          ? [
              {
                id: "already-running",
                command:
                  "/opt/morph-toolchain/node_modules/.bin/vite --config /workspace/vite.config.ts",
                status: "running",
              },
            ]
          : [];
    const kill = harness.session.killProcess!.bind(harness.session);
    (
      harness.session as { killProcess: PreviewServerSession["killProcess"] }
    ).killProcess = async (id) => {
      await kill(id);
      if (id === "already-running") running = false;
    };
    return harness;
  };

  it("reuses the server already running rather than starting a second", async () => {
    // The port is pinned, so a second one cannot bind it: it would sit there
    // until the timeout, and tearing down on that timeout would take the
    // working one with it.
    const harness = createSession("ready");
    expect((await startWith(harness)).ok).toBe(true);
    withRunningVite(harness);
    const result = await startWith(harness, {}, { readyTimeoutMs: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.processId).toBe("already-running");
    expect(result.timings.reusedProcess).toBe(true);
    expect(result.timings.viteReadyMs).toBe(0);
    expect(harness.commands).toHaveLength(1);
    expect(harness.destroyed).toBe(0);
  });

  it("reuses an active exposed port rather than calling exposePort again", async () => {
    const harness = createSession("ready");
    expect((await startWith(harness)).ok).toBe(true);
    withRunningVite(harness);
    harness.exposed.length = 0;
    (harness.session as any).getExposedPorts = async () => [
      {
        port: 5173,
        url: "https://5173-existing.preview.localhost",
        status: "active",
      },
    ];
    const result = await startWith(harness, {}, { readyTimeoutMs: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toContain("5173-existing.preview.localhost");
    expect(harness.exposed).toEqual([]);
  });

  it("skips every workspace write when the successful plan fingerprint still matches", async () => {
    const harness = createSession("ready");
    const first = await startWith(harness);
    expect(first.ok).toBe(true);
    expect(harness.writePaths.at(-1)).toBe(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    );

    withRunningVite(harness);
    harness.writePaths.length = 0;
    const second = await startWith(harness);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.timings.workspaceReused).toBe(true);
    expect(second.timings.workspaceMaterializeMs).toBe(0);
    expect(second.timings.writeCalls).toBe(0);
    expect(second.timings.readCalls).toBe(1);
    expect(harness.writePaths).toEqual([]);
    expect(harness.commands).toHaveLength(1);
  });

  it("materializes all files and commits a new marker when any planned byte changes", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    withRunningVite(harness);
    const oldFingerprint = harness.written.get(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    );
    harness.writePaths.length = 0;

    const result = await startWith(harness, {
      files: THEME.map((file) =>
        file.path === "src/components/Hero.tsx"
          ? { ...file, content: `${file.content}\n// changed` }
          : file,
      ),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timings.workspaceReused).toBe(false);
    expect(result.timings.reusedProcess).toBe(false);
    expect(harness.killed).toEqual(["already-running"]);
    expect(harness.commands).toHaveLength(2);
    expect(harness.writePaths).toContain("/workspace/src/components/Hero.tsx");
    expect(harness.writePaths.at(-1)).toBe(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    );
    expect(
      harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH),
    ).not.toBe(oldFingerprint);
  });

  it("starts Vite without rewriting a matching workspace when its process stopped", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    harness.writePaths.length = 0;

    const result = await startWith(harness);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timings.workspaceReused).toBe(true);
    expect(harness.writePaths).toEqual([]);
    expect(harness.commands).toHaveLength(2);
  });

  it("treats an unreadable fingerprint as a cache miss", async () => {
    const harness = withRunningVite(createSession("ready"));
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      "not-a-valid-workspace-fingerprint",
    );

    const result = await startWith(harness);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timings.workspaceReused).toBe(false);
    expect(harness.killed).toEqual(["already-running"]);
    expect(harness.commands).toHaveLength(1);
    expect(harness.writePaths).toContain("/workspace/src/pages/index.tsx");
    expect(harness.writePaths.at(-1)).toBe(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    );
  });

  it("does not trust a generic ready marker from an older platform bridge", async () => {
    const harness = withRunningVite(createSession("ready"));
    harness.written.set(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH, "ready");

    const result = await startWith(harness);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timings.workspaceReused).toBe(false);
    expect(harness.killed).toEqual(["already-running"]);
    expect(harness.commands).toHaveLength(1);
    expect(harness.writePaths).toContain(
      "/workspace/src/morph/preview-bridge.ts",
    );
    expect(harness.writePaths.at(-1)).toBe(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    );
  });

  it("fails closed when the replaced Vite process does not release its port", async () => {
    const harness = withRunningVite(createSession("ready"));
    harness.written.set(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH, "dirty");
    // Model a termination request that returned while the old process was
    // still reported as running. Starting another strict-port Vite here would
    // intermittently exit with the port still occupied.
    (
      harness.session as { killProcess: PreviewServerSession["killProcess"] }
    ).killProcess = async (id) => {
      harness.killed.push(id);
    };

    const result = await startWith(
      harness,
      {},
      { readyTimeoutMs: 50, stopTimeoutMs: 20 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("preview-server-restart");
    expect(result.errorMessage).toContain("PREVIEW_SERVER_STOP_TIMEOUT");
    expect(harness.commands).toEqual([]);
    // Fails closed without taking the shared sandbox down with it.
    expect(harness.destroyed).toBe(0);
    expect(harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH)).toBe(
      "dirty",
    );
  });

  it("leaves a Vite another request just started alone", async () => {
    const harness = withRunningVite(createSession("ready"));
    harness.written.set(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH, "dirty");
    // The first look finds the old server; by the time this start is ready to
    // replace it, another request already has.
    let looks = 0;
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => {
        looks += 1;
        return [
          {
            id: looks === 1 ? "already-running" : "someone-elses",
            command:
              "/opt/morph-toolchain/node_modules/.bin/vite --config /workspace/vite.config.ts",
            status: "running",
          },
        ];
      };

    const result = await startWith(harness, {}, { readyTimeoutMs: 50 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("PREVIEW_SERVER_BUSY");
    expect(harness.killed).toEqual([]);
    expect(harness.commands).toEqual([]);
    expect(harness.destroyed).toBe(0);
    // The other request is finishing the same start; it is not undone.
    expect(
      harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH),
    ).not.toBe("dirty");
  });

  it("does not stop a Vite that already stopped on its own", async () => {
    const harness = withRunningVite(createSession("ready"));
    harness.written.set(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH, "dirty");
    let looks = 0;
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => {
        looks += 1;
        return looks === 1
          ? [
              {
                id: "already-running",
                command:
                  "/opt/morph-toolchain/node_modules/.bin/vite --config /workspace/vite.config.ts",
                status: "running",
              },
            ]
          : [];
      };

    const result = await startWith(harness);

    expect(result.ok).toBe(true);
    expect(harness.killed).toEqual([]);
    expect(harness.commands).toHaveLength(1);
  });

  it("still starts one when the container has none", async () => {
    const harness = createSession("ready");
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => [{ id: "other", command: "sleep 1", status: "running" }];

    const result = await startWith(harness);
    expect(result.ok).toBe(true);
    expect(harness.commands).toHaveLength(1);
  });

  it("starts one when the container cannot say what it is running", async () => {
    // An older container that does not answer must not leave the editor
    // without a preview.
    const harness = createSession("ready");
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => {
        throw new Error("unsupported");
      };

    expect((await startWith(harness)).ok).toBe(true);
    expect(harness.commands).toHaveLength(1);
  });
});

describe("recording what a start decided", () => {
  type Observed = { event: string; fields: Record<string, any> };
  const observe = () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    return {
      events: (): Observed[] =>
        spy.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.startsWith("[preview-observe] "))
          .map((line) => {
            const rest = line.slice("[preview-observe] ".length);
            const space = rest.indexOf(" ");
            return {
              event: rest.slice(0, space),
              fields: JSON.parse(rest.slice(space + 1)),
            };
          }),
      restore: () => spy.mockRestore(),
    };
  };
  const lastStart = (events: Observed[]) =>
    events.filter((entry) => entry.event === "start").at(-1)!.fields;

  const withRunningVite = (harness: Harness) => {
    let running = true;
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () =>
        running
          ? [
              {
                id: "already-running",
                command:
                  "/opt/morph-toolchain/node_modules/.bin/vite --config /workspace/vite.config.ts",
                status: "running",
              },
            ]
          : [];
    const kill = harness.session.killProcess!.bind(harness.session);
    (
      harness.session as { killProcess: PreviewServerSession["killProcess"] }
    ).killProcess = async (id) => {
      await kill(id);
      if (id === "already-running") running = false;
    };
  };

  const contentFor = (heading: string) => ({
    templates: {},
    pages: { about: { heading } as never },
  });

  it("names the files a changed start rewrote, and returns its attempt id", async () => {
    const harness = createSession("ready");
    await startWith(harness, { previewContent: contentFor("one") });
    withRunningVite(harness);

    const log = observe();
    const result = await startWith(harness, {
      previewContent: contentFor("two"),
    });
    const start = lastStart(log.events());
    log.restore();

    expect(result.attemptId).toBe(start.attemptId);
    expect(start).toMatchObject({
      previewId: "preview-1",
      outcome: "ready",
      concurrentAtEntry: 0,
      workspace: {
        reused: false,
        // Draft content lives in its snapshot module and the data file the
        // dev server reads; the code and the Vite config do not carry it.
        change: {
          comparable: true,
          byKind: { "preview-content": 2, "theme-source": 0, platform: 0 },
          samplePaths: [
            "/workspace/.morph-preview-content.json",
            "/workspace/src/morph/preview-content-snapshot.ts",
          ],
        },
        update: "content-only",
      },
      // So the running server and every page it serves are left alone.
      vite: { action: "reused", runningProcessId: "already-running" },
      failedClosed: null,
    });
  });

  it("shows when a workspace left dirty by a sync is restarted with nothing changed", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    withRunningVite(harness);
    // What an incremental sync leaves behind after writing a file.
    harness.written.set(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH, "dirty");

    const log = observe();
    await startWith(harness);
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace).toMatchObject({
      reused: false,
      previous: "dirty",
      change: { comparable: true, added: 0, removed: 0, changed: 0 },
    });
    expect(start.vite.action).toBe("restarted");
  });

  it("records why it failed closed", async () => {
    const harness = createSession("silent");
    const log = observe();
    const result = await startWith(harness, {}, { readyTimeoutMs: 20 });
    const events = log.events();
    log.restore();

    expect(result.ok).toBe(false);
    expect(
      events.find((entry) => entry.event === "fail-closed")?.fields,
    ).toMatchObject({ previewId: "preview-1", reason: "vite-timeout" });
    expect(lastStart(events)).toMatchObject({
      outcome: "failed",
      failedClosed: "vite-timeout",
    });
    expect(harness.destroyed).toBe(0);
  });

  it("never writes the preview address into the log", async () => {
    const harness = createSession("ready");
    const log = observe();
    await startWith(harness);
    const events = log.events();
    log.restore();

    expect(
      events.map((entry) => JSON.stringify(entry.fields)).join("\n"),
    ).not.toContain("sbx-tok");
    expect(lastStart(events).address).toMatchObject({ reused: false });
  });

  it("writes only the content snapshot when only content changed, and keeps Vite", async () => {
    const harness = createSession("ready");
    await startWith(harness, { previewContent: contentFor("one") });
    withRunningVite(harness);
    harness.writePaths.length = 0;

    const result = await startWith(harness, {
      previewContent: contentFor("two"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timings.reusedProcess).toBe(true);
    expect(harness.killed).toEqual([]);
    expect(harness.commands).toHaveLength(1);
    expect(harness.writePaths).toEqual([
      "/workspace/src/morph/preview-content-snapshot.ts",
      "/workspace/.morph-preview-content.json",
      THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    ]);
    expect(
      harness.written.get("/workspace/src/morph/preview-content-snapshot.ts"),
    ).toContain("two");
  });

  it("rewrites everything and restarts when the marker says dirty, even for content", async () => {
    const harness = createSession("ready");
    await startWith(harness, { previewContent: contentFor("one") });
    withRunningVite(harness);
    harness.written.set(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH, "dirty");

    const log = observe();
    await startWith(harness, { previewContent: contentFor("two") });
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace.update).toBe("full");
    expect(start.vite.action).toBe("restarted");
  });

  it("does not trust a manifest the marker does not name", async () => {
    const harness = createSession("ready");
    await startWith(harness, { previewContent: contentFor("one") });
    withRunningVite(harness);
    // A start wrote a new manifest and stopped before its marker: the files on
    // disk may be anywhere between the two workspaces.
    const manifest = JSON.parse(
      harness.written.get(THEME_PREVIEW_WORKSPACE_MANIFEST_PATH)!,
    );
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
      JSON.stringify({ ...manifest, fingerprint: "a-later-start" }),
    );

    const log = observe();
    await startWith(harness, { previewContent: contentFor("two") });
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace.update).toBe("full");
    expect(start.vite.action).toBe("restarted");
  });

  it("does not trust a manifest written before fingerprints were recorded", async () => {
    const harness = createSession("ready");
    await startWith(harness, { previewContent: contentFor("one") });
    withRunningVite(harness);
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
      JSON.stringify(
        JSON.parse(harness.written.get(THEME_PREVIEW_WORKSPACE_MANIFEST_PATH)!)
          .files,
      ),
    );

    const log = observe();
    await startWith(harness, { previewContent: contentFor("two") });
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace.update).toBe("full");
  });

  it("restarts when source changed, content or not", async () => {
    const harness = createSession("ready");
    await startWith(harness, { previewContent: contentFor("one") });
    withRunningVite(harness);

    const log = observe();
    await startWith(harness, {
      previewContent: contentFor("two"),
      files: THEME.map((file) =>
        file.path === "src/components/Hero.tsx"
          ? { ...file, content: `${file.content}\n// changed` }
          : file,
      ),
    });
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace.update).toBe("full");
    expect(start.vite.action).toBe("restarted");
  });

  it("keeps the manifest beside the marker across a rewrite", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    expect(harness.written.has(THEME_PREVIEW_WORKSPACE_MANIFEST_PATH)).toBe(
      true,
    );
    withRunningVite(harness);
    await startWith(harness, { previewContent: contentFor("changed") });

    expect(harness.deletedPaths).not.toContain(
      THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
    );
    // The marker is still committed last, after the manifest.
    expect(harness.writePaths.slice(-2)).toEqual([
      THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    ]);
  });
});
