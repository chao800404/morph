// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CloudflareSandboxVitePreviewServer,
  THEME_PREVIEW_SERVER_PORT,
  type PreviewServerSession,
} from "./cloudflare-sandbox-vite-preview-server";

type Harness = {
  session: PreviewServerSession;
  written: Map<string, string>;
  commands: string[];
  envs: Array<Record<string, string> | undefined>;
  exposed: Array<{ port: number; hostname: string }>;
  unexposed: number[];
  killed: Array<string | undefined>;
  destroyed: number;
  sleepAfter: Array<string | number>;
  emit: (line: string) => void;
  exit: () => void;
};

const createSession = (
  behaviour: "ready" | "silent" | "exit" = "ready",
): Harness => {
  const written = new Map<string, string>();
  const commands: string[] = [];
  const envs: Array<Record<string, string> | undefined> = [];
  const exposed: Array<{ port: number; hostname: string }> = [];
  const unexposed: number[] = [];
  const killed: Array<string | undefined> = [];
  const sleepAfter: Array<string | number> = [];
  let destroyed = 0;
  let onOutput: ((s: "stdout" | "stderr", d: string) => void) | undefined;
  let onExit: ((code: number | null) => void) | undefined;

  const session: PreviewServerSession = {
    async mkdir() {},
    async writeFile(path, content) {
      written.set(path, String(content));
    },
    async startProcess(command, options) {
      commands.push(command);
      envs.push(options?.env);
      onOutput = options?.onOutput;
      onExit = options?.onExit;
      if (behaviour === "ready") {
        queueMicrotask(() =>
          onOutput?.("stdout", "  VITE v7.3.5  ready in 3118 ms\n"),
        );
      }
      if (behaviour === "exit") {
        queueMicrotask(() => onExit?.(1));
      }
      return { id: "proc-1" };
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
    commands,
    envs,
    exposed,
    unexposed,
    killed,
    sleepAfter,
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
      `https://${THEME_PREVIEW_SERVER_PORT}-sbx-tok.preview.example.com`,
    );
    expect(harness.exposed).toEqual([
      { port: THEME_PREVIEW_SERVER_PORT, hostname: "preview.example.com" },
    ]);
    expect(harness.destroyed).toBe(0);
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

  it("tears the container down when Vite never becomes ready", async () => {
    const harness = createSession("silent");
    const result = await startWith(harness, {}, { readyTimeoutMs: 20 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("PREVIEW_SERVER_TIMEOUT");
    expect(harness.killed).toEqual(["proc-1"]);
    expect(harness.destroyed).toBe(1);
  });

  it("reports an exit before readiness rather than waiting out the timeout", async () => {
    const harness = createSession("exit");
    const result = await startWith(harness, {}, { readyTimeoutMs: 10_000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("PREVIEW_SERVER_EXITED");
    expect(harness.destroyed).toBe(1);
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

describe("asking twice for the same preview", () => {
  const withRunningVite = (harness: Harness) => {
    (harness.session as { listProcesses?: unknown }).listProcesses =
      async () => [
        {
          id: "already-running",
          command:
            "/opt/morph-toolchain/node_modules/.bin/vite --config /workspace/vite.config.ts",
          status: "running",
        },
      ];
    return harness;
  };

  it("reuses the server already running rather than starting a second", async () => {
    // The port is pinned, so a second one cannot bind it: it would sit there
    // until the timeout, and tearing down on that timeout would take the
    // working one with it.
    const harness = withRunningVite(createSession("silent"));
    const result = await startWith(harness, {}, { readyTimeoutMs: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.processId).toBe("already-running");
    expect(harness.commands).toEqual([]);
    expect(harness.destroyed).toBe(0);
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
