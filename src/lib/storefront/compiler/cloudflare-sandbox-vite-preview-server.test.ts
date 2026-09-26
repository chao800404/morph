// @vitest-environment node
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isDirtyWorkspaceMarker } from "./theme-workspace-path";
import { planFencedStart, planFencedWrite } from "./preview-write-fence";
import {
  applyFencedRequest,
  PREVIEW_FENCE_LEDGER_PATH,
  PREVIEW_START_STAGING_PREFIX,
  runFencedWriteInSandbox,
  type FenceIo,
  type FenceSandbox,
  type FencedWriteRequest,
} from "./preview-write-fence-sandbox";
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

  // The container's disk, over the same map: `exec` applies a fenced request
  // with `applyFencedRequest` itself, the source the container runs.
  const io: FenceIo = {
    readText: (file) => written.get(file) ?? null,
    writeText(file, content) {
      writePaths.push(file);
      written.set(file, content);
    },
    moveFile(from, to) {
      const content = written.get(from);
      if (content === undefined) throw new Error(`ENOENT: ${from}`);
      written.delete(from);
      writePaths.push(to);
      written.set(to, content);
    },
    removeFile(file) {
      if (written.delete(file)) deletedPaths.push(file);
    },
    removeTree(dir) {
      for (const file of [...written.keys()]) {
        if (file.startsWith(`${dir}/`)) written.delete(file);
      }
    },
    within(root, relative) {
      const resolved = path.posix.resolve(root, relative);
      if (!resolved.startsWith(`${root}/`)) {
        throw new Error(`PREVIEW_FENCE_PATH_ESCAPE: ${relative}`);
      }
      return resolved;
    },
  };

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
    async exec(command) {
      const removal = /^rm -rf (\S+)$/.exec(command);
      if (removal) {
        io.removeTree(removal[1]!);
        return { success: true, exitCode: 0, stdout: "", stderr: "" };
      }
      const fenced = /^node (\S+) (\S+)$/.exec(command);
      if (!fenced) throw new Error(`Unexpected command: ${command}`);
      const request = JSON.parse(
        written.get(fenced[2]!)!,
      ) as FencedWriteRequest;
      written.delete(fenced[1]!);
      written.delete(fenced[2]!);
      const result = applyFencedRequest(
        io,
        PREVIEW_FENCE_LEDGER_PATH,
        request,
        {
          planFencedWrite,
          planFencedStart,
        },
      );
      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify(result),
        stderr: "",
      };
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
    emit: (line: string) => onOutput?.("stdout", line),
    exit: () => onExit?.(1),
  } as Harness;
};

/**
 * What landed in the workspace, in order. The container's own files — the
 * fence script, its request, the ledger, a start's staging — are not the
 * workspace, and the tests below are about the workspace.
 */
const workspaceWrites = (harness: Harness) =>
  harness.writePaths.filter((file) => file.startsWith("/workspace/"));

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
    expect(
      isDirtyWorkspaceMarker(
        harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ?? null,
      ),
    ).toBe(true);
  });

  it("reports an exit before readiness rather than waiting out the timeout", async () => {
    const harness = createSession("exit");
    const result = await startWith(harness, {}, { readyTimeoutMs: 10_000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("PREVIEW_SERVER_EXITED");
    expect(harness.destroyed).toBe(0);
    expect(
      isDirtyWorkspaceMarker(
        harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ?? null,
      ),
    ).toBe(true);
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
    expect(workspaceWrites(harness)).toEqual([]);
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
    expect(workspaceWrites(harness)).toEqual([]);
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
    expect(
      isDirtyWorkspaceMarker(
        harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ?? null,
      ),
    ).toBe(true);
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
      isDirtyWorkspaceMarker(
        harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ?? null,
      ),
    ).toBe(false);
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

  it("reads back a workspace a sync left dirty, and keeps Vite when the disk matches", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    withRunningVite(harness);
    // What an incremental sync leaves behind after writing a file the plan
    // would write the same way.
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      "dirty:sync0001",
    );
    harness.writePaths.length = 0;

    const log = observe();
    const result = await startWith(harness);
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace).toMatchObject({
      reused: false,
      previous: "dirty",
      change: { comparable: true, added: 0, removed: 0, changed: 0 },
      update: "none",
      committed: true,
    });
    expect(start.workspace.verification.read).toBeGreaterThan(0);
    expect(start.vite.action).toBe("reused");
    expect(result.ok && result.timings.reusedProcess).toBe(true);
    // Nothing rewritten: only the manifest, then the marker, committed clean.
    expect(workspaceWrites(harness)).toEqual([
      THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    ]);
    expect(
      isDirtyWorkspaceMarker(
        harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ?? null,
      ),
    ).toBe(false);
  });

  it("rewrites and restarts when a sync left source the plan does not have", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    withRunningVite(harness);
    // An unsaved edit synced from a tab: on disk, but not in the saved source.
    harness.written.set(
      "/workspace/src/components/Hero.tsx",
      `${harness.written.get("/workspace/src/components/Hero.tsx")}\n// unsaved`,
    );
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      "dirty:sync0002",
    );

    const log = observe();
    await startWith(harness);
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace.update).toBe("full");
    expect(start.workspace.change.byKind["theme-source"]).toBe(1);
    expect(start.vite.action).toBe("restarted");
  });

  it("treats a sync that stopped halfway as a difference, not a match", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    withRunningVite(harness);
    // The sync marked the workspace, then failed before a file was complete.
    harness.written.set("/workspace/src/components/Hero.tsx", "export default");
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      "dirty:sync0003",
    );

    const log = observe();
    await startWith(harness);
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace.update).toBe("full");
    expect(start.vite.action).toBe("restarted");
    expect(harness.written.get("/workspace/src/components/Hero.tsx")).toContain(
      "export default function Hero",
    );
  });

  it("rewrites a dirty workspace that holds a file no plan accounts for", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    withRunningVite(harness);
    harness.written.set("/workspace/src/components/Stray.tsx", "export {};");
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      "dirty:sync0004",
    );

    const log = observe();
    await startWith(harness);
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace.verification).toEqual({ failed: "unplanned-files" });
    expect(start.workspace.update).toBe("full");
    expect(harness.deletedPaths).toContain(
      "/workspace/src/components/Stray.tsx",
    );
  });

  it("does not commit when another writer marks the workspace while it runs", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    withRunningVite(harness);
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      "dirty:sync0005",
    );
    // A sync starts while this start is reading the disk back.
    const read = harness.session.readFile!.bind(harness.session);
    (
      harness.session as { readFile: PreviewServerSession["readFile"] }
    ).readFile = async (path, options) => {
      if (path === "/workspace/src/components/Hero.tsx") {
        harness.written.set(
          THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
          "dirty:sync0006",
        );
      }
      return read(path, options);
    };

    const log = observe();
    await startWith(harness);
    const start = lastStart(log.events());
    log.restore();

    expect(start.workspace.committed).toBe(false);
    // The later sync's marker stands, so the next start reads the disk again.
    expect(harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH)).toBe(
      "dirty:sync0006",
    );
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
    // The marker is withdrawn before the first file changes, then committed.
    expect(workspaceWrites(harness)).toEqual([
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      "/workspace/src/morph/preview-content-snapshot.ts",
      "/workspace/.morph-preview-content.json",
      THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    ]);
    expect(
      harness.written.get("/workspace/src/morph/preview-content-snapshot.ts"),
    ).toContain("two");
  });

  it("after a dirty marker, writes only content when the disk shows only content changed", async () => {
    const harness = createSession("ready");
    await startWith(harness, { previewContent: contentFor("one") });
    withRunningVite(harness);
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      "dirty:sync0007",
    );

    const log = observe();
    await startWith(harness, { previewContent: contentFor("two") });
    const start = lastStart(log.events());
    log.restore();

    // The disk was read back, not trusted from the manifest.
    expect(start.workspace.verification.read).toBeGreaterThan(0);
    expect(start.workspace.update).toBe("content-only");
    expect(start.vite.action).toBe("reused");
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

/**
 * A start and a sync of a newer save, in the two orders that used to rewind
 * the preview. The sync goes through `runFencedWriteInSandbox`, as
 * `applyThemePreviewFiles` sends it; the start through `start`. Both end in
 * the same container request code, under the same lock.
 */
describe("a start and a newer save's sync", () => {
  const HERO = "src/components/Hero.tsx";
  const HERO_PATH = `/workspace/${HERO}`;
  const heroAt = (content: string) =>
    THEME.map((file) => (file.path === HERO ? { ...file, content } : file));

  const sync = (harness: Harness, content: string, fence: number) =>
    runFencedWriteInSandbox(harness.session as unknown as FenceSandbox, {
      op: "write",
      root: "/workspace",
      files: [{ path: HERO, content, fence }],
      marker: {
        path: THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
        content: "dirty:sync",
      },
    });

  const stagingLeft = (harness: Harness) =>
    [...harness.written.keys()].filter((file) =>
      file.startsWith(PREVIEW_START_STAGING_PREFIX),
    );

  it("refuses an older start that arrives after the sync finished, and keeps the newer file", async () => {
    const harness = createSession("ready");
    expect((await startWith(harness, { fileVersions: { [HERO]: 1 } })).ok).toBe(
      true,
    );
    expect(
      (await sync(harness, "export default () => 'v2';\n", 2)).changed,
    ).toEqual([HERO]);

    // Read before the save: the older content, at the older version.
    const result = await startWith(harness, {
      files: heroAt("export default () => 'v1 edited';\n"),
      fileVersions: { [HERO]: 1 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("preview-start-stale");
    expect(harness.written.get(HERO_PATH)).toBe("export default () => 'v2';\n");
    // Refused whole: the marker the sync left stands, nothing is staged.
    expect(harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH)).toBe(
      "dirty:sync",
    );
    expect(stagingLeft(harness)).toEqual([]);
  });

  it("refuses an older start when the sync lands while it is writing, and keeps the newer file", async () => {
    const harness = createSession("ready");
    expect((await startWith(harness, { fileVersions: { [HERO]: 1 } })).ok).toBe(
      true,
    );

    // The newer save syncs as soon as the older start begins laying out.
    const writeFile = harness.session.writeFile.bind(harness.session);
    let synced = false;
    (
      harness.session as { writeFile: PreviewServerSession["writeFile"] }
    ).writeFile = async (file, content, options) => {
      if (!synced && file.startsWith(PREVIEW_START_STAGING_PREFIX)) {
        synced = true;
        await sync(harness, "export default () => 'v2';\n", 2);
      }
      return writeFile(file, content, options);
    };

    const result = await startWith(harness, {
      files: heroAt("export default () => 'v1 edited';\n"),
      fileVersions: { [HERO]: 1 },
    });

    expect(synced).toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("preview-start-stale");
    expect(harness.written.get(HERO_PATH)).toBe("export default () => 'v2';\n");
    expect(stagingLeft(harness)).toEqual([]);
  });

  it("lets a start at the same version through, as before: the later write wins", async () => {
    const harness = createSession("ready");
    await startWith(harness, { fileVersions: { [HERO]: 1 } });
    await sync(harness, "export default () => 'tab A draft';\n", 1);

    const result = await startWith(harness, {
      files: heroAt("export default () => 'tab B draft';\n"),
      fileVersions: { [HERO]: 1 },
    });

    expect(result.ok).toBe(true);
    expect(harness.written.get(HERO_PATH)).toBe(
      "export default () => 'tab B draft';\n",
    );
  });

  it("leaves the workspace untouched when staging fails, and clears what it staged", async () => {
    const harness = createSession("ready");
    await startWith(harness, { fileVersions: { [HERO]: 1 } });
    const before = harness.written.get(HERO_PATH);
    const writeFile = harness.session.writeFile.bind(harness.session);
    let staged = 0;
    (
      harness.session as { writeFile: PreviewServerSession["writeFile"] }
    ).writeFile = async (file, content, options) => {
      if (file.startsWith(PREVIEW_START_STAGING_PREFIX) && ++staged === 2) {
        throw new Error("disk full");
      }
      return writeFile(file, content, options);
    };

    const result = await startWith(harness, {
      files: heroAt("export default () => 'v2';\n"),
      fileVersions: { [HERO]: 2 },
    });

    expect(result.ok).toBe(false);
    expect(harness.written.get(HERO_PATH)).toBe(before);
    expect(stagingLeft(harness)).toEqual([]);
  });
});

/**
 * A newer save that created a file, against a start read before it. The
 * file is not in the older start's plan, so no version names it; the
 * generation the start was read at does, in both orders.
 */
describe("a start read before a save that created a file", () => {
  const NEW = "src/components/New.tsx";
  const NEW_PATH = `/workspace/${NEW}`;
  const HERO = "src/components/Hero.tsx";

  const syncNew = (harness: Harness, generation: number) =>
    runFencedWriteInSandbox(harness.session as unknown as FenceSandbox, {
      op: "write",
      root: "/workspace",
      files: [{ path: NEW, content: "export default () => null;\n", fence: 1 }],
      generation,
      marker: {
        path: THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
        content: "dirty:sync",
      },
    });

  const ledger = (harness: Harness) =>
    JSON.parse(harness.written.get(PREVIEW_FENCE_LEDGER_PATH)!) as {
      files: Record<string, number>;
      generation: number;
    };

  // A plan that changes a file, so the start stages, writes and prunes.
  const olderPlan = () =>
    THEME.map((file) =>
      file.path === HERO
        ? { ...file, content: `${file.content}// older\n` }
        : file,
    );

  it("is refused when the sync already laid the file out, and the file stays", async () => {
    const harness = createSession("ready");
    const first = await startWith(harness, {
      fileVersions: { [HERO]: 1 },
      sourceGeneration: 4,
    });
    expect(first.ok).toBe(true);
    await syncNew(harness, 5);

    const result = await startWith(harness, {
      files: olderPlan(),
      fileVersions: { [HERO]: 1 },
      sourceGeneration: 4,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("preview-start-stale");
    expect(result.errorMessage).toContain("source generation 5");
    expect(harness.written.get(NEW_PATH)).toBe("export default () => null;\n");
    expect(ledger(harness).generation).toBe(5);
  });

  it("is refused when the sync lands while it stages, and the file stays", async () => {
    const harness = createSession("ready");
    await startWith(harness, {
      fileVersions: { [HERO]: 1 },
      sourceGeneration: 4,
    });
    const writeFile = harness.session.writeFile.bind(harness.session);
    let synced = false;
    (
      harness.session as { writeFile: PreviewServerSession["writeFile"] }
    ).writeFile = async (file, content, options) => {
      if (!synced && file.startsWith(PREVIEW_START_STAGING_PREFIX)) {
        synced = true;
        await syncNew(harness, 5);
      }
      return writeFile(file, content, options);
    };

    const result = await startWith(harness, {
      files: olderPlan(),
      fileVersions: { [HERO]: 1 },
      sourceGeneration: 4,
    });

    expect(synced).toBe(true);
    expect(result.ok).toBe(false);
    expect(harness.written.get(NEW_PATH)).toBe("export default () => null;\n");
    expect(
      [...harness.written.keys()].filter((file) =>
        file.startsWith(PREVIEW_START_STAGING_PREFIX),
      ),
    ).toEqual([]);
  });

  it("goes through when read after the save, and records its generation", async () => {
    const harness = createSession("ready");
    await startWith(harness, {
      fileVersions: { [HERO]: 1 },
      sourceGeneration: 4,
    });
    await syncNew(harness, 5);

    const result = await startWith(harness, {
      files: [...THEME, { path: NEW, content: "export default () => null;\n" }],
      fileVersions: { [HERO]: 1, [NEW]: 1 },
      sourceGeneration: 5,
    });

    expect(result.ok).toBe(true);
    expect(ledger(harness).generation).toBe(5);
  });

  it("raises nothing when its staging fails", async () => {
    const harness = createSession("ready");
    await startWith(harness, {
      fileVersions: { [HERO]: 1 },
      sourceGeneration: 4,
    });
    const writeFile = harness.session.writeFile.bind(harness.session);
    (
      harness.session as { writeFile: PreviewServerSession["writeFile"] }
    ).writeFile = async (file, content, options) => {
      if (file.startsWith(PREVIEW_START_STAGING_PREFIX)) {
        throw new Error("disk full");
      }
      return writeFile(file, content, options);
    };

    const result = await startWith(harness, {
      files: olderPlan(),
      fileVersions: { [HERO]: 2 },
      sourceGeneration: 9,
    });

    expect(result.ok).toBe(false);
    expect(ledger(harness)).toEqual({ files: { [HERO]: 1 }, generation: 4 });
  });
});
