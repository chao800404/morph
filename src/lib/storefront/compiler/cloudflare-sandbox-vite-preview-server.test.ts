// @vitest-environment node
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isDirtyWorkspaceMarker } from "./theme-workspace-path";
import { THEME_PREVIEW_BRIDGE_CAPABILITIES } from "./theme-preview-bridge-entry";
import { planFencedStart, planFencedWrite } from "./preview-write-fence";
import {
  applyPreviewFenceRequest,
  type PreviewContentRequest,
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
  type PreviewServerProvider,
  type PreviewServerSession,
} from "./cloudflare-sandbox-vite-preview-server";
import {
  checkPreviewStartAttempt,
  claimPreviewStartAttempt,
  endPreviewStartAttempts,
  PREVIEW_START_ATTEMPT_STORAGE_KEY,
} from "./preview-start-attempt-guard";
import {
  START_TOOLCHAIN,
  answerToolchainCommand,
} from "./sandbox-toolchain.test-support";
import { astroThemeFiles } from "../theme-framework/astro-native-prerender.fixtures";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import { enterPreviewStart } from "./preview-server-observation";

type Harness = {
  session: PreviewServerSession;
  written: Map<string, string>;
  encodings: Map<string, string>;
  writePaths: string[];
  deletedPaths: string[];
  /** Dev servers launched: a refused serve gate launches none. */
  commands: string[];
  /** Serve-gated launches the ledger refused (`gatedServeCommand`). */
  gated: string[];
  /** Symlinks the fence made in the container: link path to target. */
  links: Map<string, string>;
  /** Every link the fence was asked to make, in order. */
  linkOps: Array<{ link: string; target: string }>;
  envs: Array<Record<string, string> | undefined>;
  cwds: Array<string | undefined>;
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
  /** The `encoding` each write was given: "base64" for bytes. */
  const encodings = new Map<string, string>();
  const writePaths: string[] = [];
  const deletedPaths: string[] = [];
  const commands: string[] = [];
  const gated: string[] = [];
  const links = new Map<string, string>();
  const linkOps: Array<{ link: string; target: string }> = [];
  const envs: Array<Record<string, string> | undefined> = [];
  const cwds: Array<string | undefined> = [];
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
    replaceLink(target, link) {
      linkOps.push({ link, target });
      links.set(link, target);
    },
  };

  /**
   * One run of the fence script: its request applied under "the lock" by
   * the same dispatch the script runs (`applyPreviewFenceRequest`), and the
   * script and request files removed, as the script removes them.
   */
  const runFenceScript = (scriptPath: string, requestPath: string) => {
    const request = JSON.parse(written.get(requestPath)!) as
      | FencedWriteRequest
      | PreviewContentRequest;
    written.delete(scriptPath);
    written.delete(requestPath);
    return applyPreviewFenceRequest(
      { ...io, renameInto: (from, to) => io.moveFile(from, to) },
      PREVIEW_FENCE_LEDGER_PATH,
      request,
      { planFencedWrite, planFencedStart },
    );
  };

  const session: PreviewServerSession = {
    async mkdir() {},
    async writeFile(path, content, options) {
      writePaths.push(path);
      written.set(path, String(content));
      if (options?.encoding) encodings.set(path, options.encoding);
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
      // A guarded start launches its dev server through the serve gate
      // (`gatedServeCommand`): the shell runs the fence script, and execs
      // the dev server only if the ledger still names this start's claim.
      // A refused gate exits; no dev server runs, so it is not a command.
      const gate = /^sh -c 'node (\S+) (\S+) && exec (.+)'$/.exec(command);
      if (gate) {
        const standing = runFenceScript(gate[1]!, gate[2]!) as {
          ownership?: string;
        };
        if (standing.ownership !== "owner") {
          gated.push(command);
          queueMicrotask(() => options?.onExit?.(75));
          return {
            id: `gated-${gated.length}`,
            waitForPort: async () => {
              throw new Error("Process exited before the port was ready.");
            },
          };
        }
      }
      commands.push(command);
      envs.push(options?.env);
      cwds.push(options?.cwd);
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
      // The image's answer to the toolchain check (theme-toolchains.ts).
      const toolchainAnswer = answerToolchainCommand(command);
      if (toolchainAnswer) return toolchainAnswer;
      const removal = /^rm -rf (\S+)$/.exec(command);
      if (removal) {
        io.removeTree(removal[1]!);
        return { success: true, exitCode: 0, stdout: "", stderr: "" };
      }
      const fenced = /^node (\S+) (\S+)$/.exec(command);
      if (!fenced) throw new Error(`Unexpected command: ${command}`);
      const result = runFenceScript(fenced[1]!, fenced[2]!);
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
    cwds,
    gated,
    links,
    linkOps,
    written,
    encodings,
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
    // A different site from the preview host's: the same site is refused.
    platformHostEnv: { PUBLIC_URL: "https://admin.example.net" },
    ...overrides,
  });
};

describe("CloudflareSandboxVitePreviewServer", () => {
  it("writes a binary file kept under src/ into the workspace as its bytes", async () => {
    // docs/astro-theme-plan.md 5.2.5: the same by-reference path as public/.
    const harness = createSession("ready");
    const hero = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 250, 251]);
    const digest = "e".repeat(64);
    const result = await startWith(harness, {
      files: [
        ...THEME,
        { path: "src/assets/hero.png", binary: { digest, sizeBytes: hero.byteLength } },
      ] as never,
      loadBinary: async (ref) => {
        if (ref.digest !== digest) throw new Error("unknown blob");
        return hero;
      },
    });
    expect(result.ok).toBe(true);
    // Staged, then moved into place by the fenced start; it arrives as the
    // base64 of its bytes, never as text.
    expect(harness.written.get("/workspace/src/assets/hero.png")).toBe(
      Buffer.from(hero).toString("base64"),
    );
    const stagedAs = [...harness.encodings.entries()].filter(([, encoding]) => encoding === "base64");
    expect(stagedAs.length).toBeGreaterThan(0);
  });

  it("puts no Morph credential into the container, even if handed one", async () => {
    const harness = createSession("ready");
    const secrets = {
      BETTER_AUTH_SECRET: "better-auth-secret-value",
      THEME_PREVIEW_SECRET: "theme-preview-secret-value",
    };
    const result = await startWith(harness, {
      // A caller that hands over the whole env rather than the host vars.
      platformHostEnv: {
        PUBLIC_URL: "https://admin.example.net",
        ...secrets,
      } as never,
    });

    expect(result.ok).toBe(true);
    const crossed = JSON.stringify({
      written: [...harness.written.entries()],
      commands: harness.commands,
      envs: harness.envs,
    });
    for (const [key, value] of Object.entries(secrets)) {
      expect(crossed).not.toContain(key);
      expect(crossed).not.toContain(value);
    }
    // The processes it starts get only what they are given here.
    for (const env of harness.envs) {
      expect(Object.keys(env ?? {}).sort()).toEqual(["NODE_ENV"]);
    }
  });

  it("does not start a preview in a container whose toolchain manifest is another one's", async () => {
    const harness = createSession("ready");
    const ownExec = harness.session.exec.bind(harness.session);
    (harness.session as { exec: typeof ownExec }).exec = async (command) =>
      answerToolchainCommand(command, "e".repeat(64)) ?? ownExec(command);

    const result = await startWith(harness);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("preview-toolchain");
      expect(result.errorMessage).toContain("THEME_TOOLCHAIN_MISMATCH");
    }
    // Nothing of the Theme reached the container, and no Vite was started.
    expect(workspaceWrites(harness)).toEqual([]);
    expect(
      harness.commands.some((command) => command.includes("/.bin/vite")),
    ).toBe(false);
  });

  it("starts an Astro site's own dev server, stamped, in its workspace (A6c)", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness, {
      framework: "astro",
      astroThemes: true,
      files: astroThemeFiles(),
      entry: "",
      previewContent: { templates: {}, pages: {}, contentTicket: 3 },
    });
    expect(result.ok, !result.ok ? result.errorMessage : "").toBe(true);
    const astro = themeToolchainForFramework("astro");
    expect(harness.commands).toContain(
      `${astro.root}/node_modules/.bin/astro dev --config .morph/astro.preview.config.mjs --host 0.0.0.0 --port ${THEME_PREVIEW_SERVER_PORT}`,
    );
    expect(harness.cwds.at(-1)).toBe("/workspace");
    expect(harness.envs.at(-1)).toMatchObject({
      NODE_ENV: "development",
      CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: ".morph/wrangler.preview.json",
      ASTRO_TELEMETRY_DISABLED: "1",
    });
    // Ready when the Worker answers its probe, not a page path.
    expect(harness.waitedPorts).toEqual([
      { port: THEME_PREVIEW_SERVER_PORT, path: "/_morph/preview-health" },
    ]);
    // Stamped before it started: the instance beside the lock, and on the
    // content file the Worker reads.
    const instance = harness.written.get("/tmp/morph-preview-instance");
    expect(instance).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      JSON.parse(harness.written.get("/workspace/.morph-preview-content.json")!),
    ).toMatchObject({ contentTicket: 3, previewInstance: instance });
  });

  it("stamps a full Start preview's server too, so a content sync can be written and confirmed", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness, {
      previewRuntime: "start",
      previewContent: { templates: {}, pages: {}, contentTicket: 3 },
    });
    expect(result.ok, !result.ok ? result.errorMessage : "").toBe(true);
    const instance = harness.written.get("/tmp/morph-preview-instance");
    expect(instance).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      JSON.parse(harness.written.get("/workspace/.morph-preview-content.json")!),
    ).toMatchObject({ contentTicket: 3, previewInstance: instance });
  });

  it("stamps nothing for the client-only preview, which reads no snapshot on a server", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness, {
      previewContent: { templates: {}, pages: {}, contentTicket: 3 },
    });
    expect(result.ok, !result.ok ? result.errorMessage : "").toBe(true);
    expect(harness.written.has("/tmp/morph-preview-instance")).toBe(false);
    expect(
      JSON.parse(harness.written.get("/workspace/.morph-preview-content.json")!),
    ).not.toHaveProperty("previewInstance");
  });

  it("starts the preview with its framework's toolchain from the registry", async () => {
    const harness = createSession("ready");
    expect((await startWith(harness)).ok).toBe(true);
    expect(
      harness.commands.some((command) =>
        command.startsWith(
          `${START_TOOLCHAIN.root}/node_modules/.bin/vite --config /workspace/`,
        ),
      ),
    ).toBe(true);
  });

  it("checks the platform health endpoint for Start readiness", async () => {
    const harness = createSession("ready");
    expect((await startWith(harness, { previewRuntime: "start" })).ok).toBe(
      true,
    );
    expect(harness.waitedPorts).toEqual([
      { port: THEME_PREVIEW_SERVER_PORT, path: "/_morph/preview-health" },
    ]);
  });
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

  it("turns the container-side request record on only when asked to", async () => {
    const harness = createSession("ready");
    await startWith(harness, {}, { requestTrace: true });

    // A switch, never a credential: the record writes no header or body.
    expect(harness.envs[0]).toEqual({
      NODE_ENV: "development",
      MORPH_PREVIEW_REQUEST_TRACE: "1",
    });
  });

  it("says in its start record whether the request record was handed to Vite", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      logged.push(String(line));
    });
    try {
      await startWith(createSession("ready"), {}, { requestTrace: true });
      await startWith(createSession("ready"));
    } finally {
      spy.mockRestore();
    }
    const starts = logged
      .filter((line) => line.startsWith("[preview-observe] start "))
      .map((line) => JSON.parse(line.slice("[preview-observe] start ".length)));
    expect(starts).toHaveLength(2);
    expect(starts[0].vite.requestTrace).toBe(true);
    // Off: the field is absent, so a deployment's log reads as before.
    expect("requestTrace" in starts[1].vite).toBe(false);
    // The harness's Vite writes no state file: read back as missing, and
    // only when the record was turned on.
    expect(starts[0].requestTraceStatus).toBe("missing");
    expect(starts[0].requestTraceRecord).toBe("missing");
    expect("requestTraceStatus" in starts[1]).toBe(false);
    expect("requestTraceRecord" in starts[1]).toBe(false);
  });

  it("reads back only the record's own state fields", async () => {
    const harness = createSession("ready");
    await harness.session.writeFile(
      "/tmp/morph-preview-request-trace.json",
      JSON.stringify({ pid: 7, httpServer: true, writeError: "EACCES", extra: "x" }),
    );
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      logged.push(String(line));
    });
    try {
      await startWith(harness, {}, { requestTrace: true });
    } finally {
      spy.mockRestore();
    }
    const start = logged
      .filter((line) => line.startsWith("[preview-observe] start "))
      .map((line) => JSON.parse(line.slice("[preview-observe] start ".length)))[0];
    expect(start.requestTraceStatus).toEqual({
      pid: 7,
      httpServer: true,
      writeError: "EACCES",
      capped: null,
    });
  });

  it("writes the container's request record to its log once per line, keeping only the record's fields", async () => {
    const harness = createSession("ready");
    const recordPath = "/tmp/morph-preview-request-trace.txt";
    const line = (fields: Record<string, unknown>) =>
      `MORPH_PREVIEW_REQUEST_TRACE ${JSON.stringify(fields)}\n`;
    const first =
      line({ t: "a", pid: 9, n: 1, ev: "trace-start" }) +
      line({
        t: "b",
        pid: 9,
        n: 2,
        ev: "req",
        seq: 1,
        path: "/src/a.ts?previewSession=secret",
        cookie: "session=hunter2",
      });
    await harness.session.writeFile(recordPath, first);
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((value) => {
      logged.push(String(value));
    });
    try {
      // A previewId of its own: what this isolate already logged is kept
      // per preview and process.
      await startWith(
        harness,
        { previewId: "trace-record" },
        { requestTrace: true },
      );
      await harness.session.writeFile(
        recordPath,
        first +
          line({
            t: "c",
            pid: 9,
            n: 3,
            ev: "res",
            seq: 1,
            deliveredBytes: "5",
          }),
      );
      await startWith(
        harness,
        { previewId: "trace-record" },
        { requestTrace: true },
      );
    } finally {
      spy.mockRestore();
    }
    const parse = (prefix: string) =>
      logged
        .filter((value) => value.startsWith(prefix))
        .map((value) => JSON.parse(value.slice(prefix.length)));
    const traces = parse("[preview-observe] request-trace ");
    expect(traces.map((trace) => trace.records)).toEqual([
      [
        { t: "a", pid: 9, n: 1, ev: "trace-start" },
        { t: "b", pid: 9, n: 2, ev: "req", seq: 1, path: "/src/a.ts" },
      ],
      [{ t: "c", pid: 9, n: 3, ev: "res", seq: 1 }],
    ]);
    expect(traces[0]).toMatchObject({
      previewId: "trace-record",
      part: 1,
      parts: 1,
    });
    const starts = parse("[preview-observe] start ");
    expect(traces[0].attemptId).toBe(starts[0].attemptId);
    expect(starts.map((start) => start.requestTraceRecord)).toEqual([
      expect.objectContaining({ records: 2, logged: 2, invalid: 0 }),
      expect.objectContaining({ records: 3, logged: 1, invalid: 0 }),
    ]);
    const all = logged.join("\n");
    for (const secret of ["previewSession", "hunter2", "cookie"]) {
      expect(all).not.toContain(secret);
    }
  });

  it("refuses to serve user code from any Morph host, however it is written", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness, {
      previewHostname: "Admin.Example.net.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("PLATFORM_PREVIEW_HOST");
    expect(harness.commands).toEqual([]);
  });

  it("refuses a host on a Morph host's site before touching the container", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness, {
      previewHostname: "preview.example.net",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorMessage).toContain("SAME_SITE_PREVIEW_HOST");
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
    command: `${START_TOOLCHAIN.root}/node_modules/.bin/vite --config /workspace/vite.config.ts`,
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
                command: `${START_TOOLCHAIN.root}/node_modules/.bin/vite --config /workspace/vite.config.ts`,
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
    // The marker, and the fence ledger that vouches for it (user, 11-24).
    expect(second.timings.readCalls).toBe(2);
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
            command: `${START_TOOLCHAIN.root}/node_modules/.bin/vite --config /workspace/vite.config.ts`,
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
                command: `${START_TOOLCHAIN.root}/node_modules/.bin/vite --config /workspace/vite.config.ts`,
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
                command: `${START_TOOLCHAIN.root}/node_modules/.bin/vite --config /workspace/vite.config.ts`,
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

  it("reports the bridge of a committed workspace, with the instance unknown", async () => {
    const harness = createSession("ready");
    const result = await startWith(harness);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serving).toEqual({
      bridge: {
        buildId: expect.stringMatching(/^[0-9a-f]{64}$/),
        capabilities: [...THEME_PREVIEW_BRIDGE_CAPABILITIES],
      },
      // A container's Vite names no instance on its responses.
      instance: null,
    });
  });

  it("reports the same bridge for a matching workspace it reused", async () => {
    const harness = createSession("ready");
    const first = await startWith(harness);
    withRunningVite(harness);
    const again = await startWith(harness);
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.timings.workspaceReused).toBe(true);
    expect(again.serving).toEqual(first.serving);
    expect(again.serving?.instance).toBeNull();
  });

  it("reports no serving for a workspace it could not commit", async () => {
    const harness = createSession("ready");
    await startWith(harness);
    withRunningVite(harness);
    harness.written.set(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      "dirty:sync0005",
    );
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
    const result = await startWith(harness);
    const start = lastStart(log.events());
    log.restore();
    expect(start.workspace.committed).toBe(false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only that the workspace was written would say which bridge is there.
    expect(result.serving ?? null).toBeNull();
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

  /**
   * Workspace ownership (user, 2026-11-24): the next start may reuse a
   * workspace only if it can prove it was fully committed — a committed
   * marker, and a fence ledger that vouches for that same commit. Otherwise
   * it lays the workspace out again (and so restarts Vite), whatever the
   * marker and manifest say.
   */
  const ledgerVouchingFor = (
    harness: Harness,
    change: "missing" | "another" | "nothing",
  ) => {
    if (change === "missing") {
      harness.written.delete(PREVIEW_FENCE_LEDGER_PATH);
      return;
    }
    const ledger = JSON.parse(harness.written.get(PREVIEW_FENCE_LEDGER_PATH)!);
    if (change === "another") ledger.committed = "another-fingerprint";
    else delete ledger.committed;
    harness.written.set(PREVIEW_FENCE_LEDGER_PATH, JSON.stringify(ledger));
  };

  it("records in the fence ledger the commit a start made", async () => {
    const harness = createSession("ready");
    expect((await startWith(harness)).ok).toBe(true);
    expect(
      JSON.parse(harness.written.get(PREVIEW_FENCE_LEDGER_PATH)!).committed,
    ).toBe(harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH));
  });

  it.each([
    ["is missing", "missing"],
    ["vouches for another commit", "another"],
    ["vouches for no commit", "nothing"],
  ] as const)(
    "does not reuse a committed marker when the fence ledger %s: lays the workspace out again and restarts Vite",
    async (_label, change) => {
      const harness = createSession("ready");
      expect((await startWith(harness)).ok).toBe(true);
      withRunningVite(harness);
      ledgerVouchingFor(harness, change);
      harness.writePaths.length = 0;

      const log = observe();
      const result = await startWith(harness);
      const start = lastStart(log.events());
      log.restore();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.timings.workspaceReused).toBe(false);
      expect(start.workspace.update).toBe("full");
      expect(start.vite.action).toBe("restarted");
      expect(harness.killed).toEqual(["already-running"]);
      expect(harness.writePaths).toContain("/workspace/src/pages/index.tsx");
    },
  );

  it("does not take a content-only update from a manifest the fence ledger does not vouch for", async () => {
    const harness = createSession("ready");
    await startWith(harness, { previewContent: contentFor("one") });
    withRunningVite(harness);
    ledgerVouchingFor(harness, "nothing");

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
      readAt: Record<string, number>;
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

  // A file deleted and made again starts over at version 1. With version 2
  // laid out, comparing versions alone refused every later start until the
  // container restarted; the start was read after the file was made again.
  it("lays out a file deleted and made again at a lower version, once read after it", async () => {
    const harness = createSession("ready");
    await startWith(harness, {
      fileVersions: { [HERO]: 1 },
      sourceGeneration: 4,
    });
    await runFencedWriteInSandbox(harness.session as unknown as FenceSandbox, {
      op: "write",
      root: "/workspace",
      files: [{ path: NEW, content: "export default () => 'v2';\n", fence: 2 }],
      generation: 5,
    });

    // Deleted (generation 6), then made again (generation 7) as version 1.
    const result = await startWith(harness, {
      files: [
        ...THEME,
        { path: NEW, content: "export default () => 'again';\n" },
      ],
      fileVersions: { [HERO]: 1, [NEW]: 1 },
      sourceGeneration: 7,
    });

    expect(result.ok).toBe(true);
    expect(harness.written.get(NEW_PATH)).toBe(
      "export default () => 'again';\n",
    );
    expect(ledger(harness).files[NEW]).toBe(1);
    expect(ledger(harness).generation).toBe(7);
  });

  it("raises nothing when its staging fails", async () => {
    const harness = createSession("ready");
    await startWith(harness, {
      fileVersions: { [HERO]: 1 },
      sourceGeneration: 4,
    });
    // What the first start committed, which the ledger vouches for (user,
    // 2026-11-24); a start that fails before its fence changes none of it.
    const firstCommit = harness.written.get(
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
    );
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
    expect(ledger(harness)).toEqual({
      files: { [HERO]: 1 },
      readAt: { [HERO]: 4 },
      generation: 4,
      committed: firstCommit,
    });
  });
});

/**
 * One automatic retry of a whole start after a sandbox interruption
 * (handoff/2026-11-23/preview-autoretry-design-v2.md, approved with
 * conditions on 2026-11-23/24).
 *
 * - Retried only on the one allow-listed sentence, "Sandbox operation <op>
 *   was interrupted while the runtime connection was closing", matched as
 *   the whole message after Durable Object RPC folded the SDK's class name
 *   in front of it, and only when the start's own container steps threw it
 *   (staging and materializing, or the fence script). "Container failed to
 *   start" is deliberately not on the list (user, 11-24).
 * - At most one retry. The 500 ms pause counts inside the 30 s window, and
 *   both are checked again after it.
 * - One server-side deadline for the request, shared by both attempts.
 * - The preview's Durable Object names the current start; a stopped,
 *   superseded or expired one is never sent again and its late success is
 *   never answered as ready.
 *
 * The error is the one PR #434's CI run met, in the form it reaches the
 * Worker (job log, 15:41:17.436).
 */
describe("an interrupted start: one automatic retry (design v2)", () => {
  const INTERRUPTED_MKDIR =
    "OperationInterruptedError: Sandbox operation files.mkdir was interrupted while the runtime connection was closing";
  const INTERRUPTED_FENCE =
    "OperationInterruptedError: Sandbox operation sandbox.exec was interrupted while the runtime connection was closing";

  type GuardStatus = "current" | "superseded" | "stopped" | "expired";

  /**
   * The preview Durable Object's current-start record, as the session
   * reaches it over RPC. A stand-in with the contract the transport relies
   * on; the Durable Object's own logic is tested in preview-sandbox.test.ts.
   */
  const withStartGuard = (harness: Harness, now: () => number) => {
    const guard = {
      attemptId: null as string | null,
      deadlineAt: null as number | null,
      stopped: false,
      /** The Durable Object's claim number (user, 11-24): each claim and stop raise it. */
      seq: 0,
      claims: [] as string[],
      checks: [] as Array<{ attemptId: string; next?: string }>,
    };
    const session = harness.session as unknown as Record<string, unknown>;
    session.claimPreviewStart = async (input: {
      attemptId: string;
      deadlineAt: number;
    }) => {
      guard.claims.push(input.attemptId);
      guard.attemptId = input.attemptId;
      guard.deadlineAt = input.deadlineAt;
      guard.stopped = false;
      guard.seq += 1;
      return { seq: guard.seq };
    };
    session.checkPreviewStart = async (input: {
      attemptId: string;
      next?: string;
    }): Promise<GuardStatus> => {
      guard.checks.push(input);
      if (guard.stopped) return "stopped";
      if (guard.attemptId !== input.attemptId) return "superseded";
      if (guard.deadlineAt !== null && now() >= guard.deadlineAt) {
        return "expired";
      }
      if (input.next) guard.attemptId = input.next;
      return "current";
    };
    session.endPreviewStarts = async () => {
      guard.stopped = true;
      guard.attemptId = null;
      guard.seq += 1;
    };
    return {
      guard,
      /** A newer start request for the same preview. */
      supersede: () =>
        (
          session.claimPreviewStart as (input: {
            attemptId: string;
            deadlineAt: number;
          }) => Promise<{ seq: number }>
        )({ attemptId: "newer-request", deadlineAt: now() + 180_000 }),
    };
  };

  /** Options the retry adds; cast so this block reads the same before it exists. */
  const retryOptions = (options: Record<string, unknown>) =>
    options as NonNullable<
      ConstructorParameters<typeof CloudflareSandboxVitePreviewServer>[0]
    >;

  const override = (harness: Harness, name: string, value: unknown) => {
    (harness.session as unknown as Record<string, unknown>)[name] = value;
  };

  type Setup = {
    harness: Harness;
    time: { now: () => number; advance: (ms: number) => void };
    guarded: ReturnType<typeof withStartGuard> | null;
    server: CloudflareSandboxVitePreviewServer;
  };

  const setup = (
    options: {
      /** How many of the first mkdir calls throw `message`. */
      failures?: number;
      message?: string;
      behaviour?: Parameters<typeof createSession>[0];
      guarded?: boolean;
      beforeFailure?: (ctx: Setup) => void;
      /** Its result is awaited and ignored (a claim answers `{ seq }`). */
      onPause?: (ctx: Setup) => Promise<unknown> | void;
      server?: Record<string, unknown>;
    } = {},
  ) => {
    const harness = createSession(options.behaviour ?? "ready");
    let t = 1_000_000;
    const time = { now: () => t, advance: (ms: number) => void (t += ms) };
    const guarded =
      options.guarded === false ? null : withStartGuard(harness, time.now);
    const pauses: number[] = [];
    let mkdirCalls = 0;
    const ctx = { harness, time, guarded } as Setup;
    override(harness, "mkdir", async () => {
      mkdirCalls += 1;
      if (mkdirCalls <= (options.failures ?? 0)) {
        options.beforeFailure?.(ctx);
        throw new Error(options.message ?? INTERRUPTED_MKDIR);
      }
    });
    ctx.server = new CloudflareSandboxVitePreviewServer({
      sandboxProvider: { getSandbox: async () => harness.session },
      sandboxBinding: {},
      ...retryOptions({
        now: time.now,
        pause: async (ms: number) => {
          pauses.push(ms);
          await options.onPause?.(ctx);
        },
        ...options.server,
      }),
    });
    const start = (
      overrides: Partial<
        Parameters<CloudflareSandboxVitePreviewServer["start"]>[0]
      > = {},
    ) =>
      ctx.server.start({
        previewId: "preview-1",
        files: THEME,
        entry: "src/pages/index.tsx",
        previewHostname: "preview.example.com",
        platformHostEnv: { PUBLIC_URL: "https://admin.example.net" },
        ...overrides,
      });
    return {
      ...ctx,
      pauses,
      start,
      get mkdirCalls() {
        return mkdirCalls;
      },
    };
  };

  /**
   * Runs `hook` when the dev server is about to report itself ready. Its
   * result is awaited and ignored (a claim answers `{ seq }`).
   */
  const beforeReady = (
    harness: Harness,
    hook: () => Promise<unknown> | void,
  ) => {
    const startProcess = harness.session.startProcess.bind(harness.session);
    override(
      harness,
      "startProcess",
      async (...args: Parameters<PreviewServerSession["startProcess"]>) => {
        const process = await startProcess(...args);
        return {
          ...process,
          waitForPort: async (port: number, options?: { path?: string }) => {
            await hook();
            return process.waitForPort?.(port, options);
          },
        };
      },
    );
  };

  const records = async (run: () => Promise<unknown>) => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      logged.push(String(line));
    });
    let result: unknown;
    try {
      result = await run();
    } finally {
      spy.mockRestore();
    }
    const events = (event: string) =>
      logged
        .filter((line) => line.startsWith(`[preview-observe] ${event} `))
        .map(
          (line) =>
            JSON.parse(
              line.slice(`[preview-observe] ${event} `.length),
            ) as Record<string, unknown>,
        );
    return {
      result: result as Awaited<ReturnType<typeof startWith>> & {
        recoveredFrom?: Record<string, unknown>;
        retryOf?: string;
      },
      starts: events("start"),
      retries: events("start-retry"),
      events,
    };
  };

  describe("what is retried", () => {
    it("runs the whole start once more when the runtime connection closed while it was staging, after a 500 ms pause", async () => {
      const s = setup({ failures: 1 });
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(true);
      // Two attempts, each with its own record, and no third.
      expect(starts.map((start) => start.outcome)).toEqual(["failed", "ready"]);
      expect(starts[0]!.attemptId).not.toBe(starts[1]!.attemptId);
      expect(s.pauses).toEqual([500]);
      expect(s.harness.commands).toHaveLength(1);
    });

    it("runs it once more, too, when the fence script's run was interrupted the same way", async () => {
      const s = setup();
      const exec = s.harness.session.exec.bind(s.harness.session);
      let fenced = 0;
      override(s.harness, "exec", async (command: string) => {
        if (command.startsWith("node ") && ++fenced === 1) {
          throw new Error(INTERRUPTED_FENCE);
        }
        return exec(command);
      });
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(true);
      expect(starts).toHaveLength(2);
      expect(result.recoveredFrom?.step).toBe("fence");
    });

    it("records the retry: the answer names the failed first attempt, and each start line names the other", async () => {
      const s = setup({ failures: 1 });
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [first, second] = starts;
      // The answer is the second attempt's, and says it recovered from the
      // first: acceptance evidence can tell a retried start from a clean one.
      expect(result.attemptId).toBe(second!.attemptId);
      expect(result.recoveredFrom).toEqual({
        attemptId: first!.attemptId,
        stage: "preview-server-start",
        reason: "sandbox-interrupted",
        signal: "runtime-connection-closing",
        step: "stage",
        attempts: 2,
        errorMessage: INTERRUPTED_MKDIR,
      });
      expect(first!.retry).toBe("scheduled");
      expect(second!.retryOf).toBe(first!.attemptId);
      expect(second!.attempt).toBe(2);
      // The Durable Object handed "current" from the first to the second.
      expect(s.guarded!.guard.attemptId).toBe(second!.attemptId);
    });

    it("surfaces the error when the retry is interrupted as well, without a third attempt", async () => {
      const s = setup({ failures: Number.POSITIVE_INFINITY });
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-server-start");
      expect(result.errorMessage).toBe(INTERRUPTED_MKDIR);
      expect(starts.map((start) => start.outcome)).toEqual(["failed", "failed"]);
      expect(starts[0]!.retry).toBe("scheduled");
      expect(starts[1]!.retryOf).toBe(starts[0]!.attemptId);
      expect(starts[1]!.retry).toBeUndefined();
      // The final failure names the attempt it retried, and claims no recovery.
      expect(result.retryOf).toBe(starts[0]!.attemptId);
      expect(result.recoveredFrom).toBeUndefined();
      expect(s.pauses).toEqual([500]);
      // Nothing was started in a container that never held a workspace.
      expect(s.harness.commands).toHaveLength(0);
    });
  });

  describe("what is never retried", () => {
    it.each([
      [
        "the container stopped while an operation was pending (not seen on the start path yet)",
        "OperationInterruptedError: The sandbox container stopped while the operation was pending.",
      ],
      [
        "the sandbox was destroyed while the start was pending",
        "OperationInterruptedError: The sandbox was destroyed while the operation was pending.",
      ],
      [
        "the platform was updating the sandbox runtime",
        "OperationInterruptedError: Sandbox operation files.mkdir was interrupted while the platform was updating the sandbox runtime",
      ],
      [
        "the runtime connection closed unexpectedly",
        "OperationInterruptedError: Sandbox operation files.mkdir was interrupted while the runtime connection closed unexpectedly",
      ],
      ["the container failed to start (user, 11-24)", "Container failed to start."],
      [
        "the platform had no container instance for the object (user, 11-24)",
        "ContainerUnavailableError: there is no container instance that can be provided to this durable object",
      ],
      [
        "the platform's running-instance limit (user, 11-24)",
        "ContainerUnavailableError: maximum number of running container instances exceeded",
      ],
      [
        "a start timeout",
        "SANDBOX_START_TIMEOUT: the sandbox did not start within 90000 ms",
      ],
      [
        "an operation that did not finish in time",
        "Sandbox operation files.mkdir did not finish within 30000 ms",
      ],
      [
        "the sentence anywhere but at the start",
        `Theme build said: ${INTERRUPTED_MKDIR}`,
      ],
      ["the sentence with more after it", `${INTERRUPTED_MKDIR}; retry later`],
      ["the sentence without the class name", INTERRUPTED_MKDIR.slice("OperationInterruptedError: ".length)],
      ["an error that is not an interruption", "EACCES: permission denied, mkdir"],
    ])("%s", async (_name, message) => {
      const s = setup({ failures: 1, message });
      const { result, starts, retries } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorMessage).toBe(message);
      expect(starts).toHaveLength(1);
      expect(starts[0]!.retry).toBeUndefined();
      expect(retries).toEqual([]);
      expect(s.pauses).toEqual([]);
      expect(s.mkdirCalls).toBe(1);
    });

    it("does not retry the allow-listed sentence from a step that is not the start's own staging or fence", async () => {
      const s = setup();
      override(s.harness, "exposePort", async () => {
        throw new Error(
          "OperationInterruptedError: Sandbox operation ports.expose was interrupted while the runtime connection was closing",
        );
      });
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      expect(starts).toHaveLength(1);
      expect(s.pauses).toEqual([]);
    });

    it("does not retry an interruption that reached the dev server's readiness check", async () => {
      // Folded into PREVIEW_SERVER_EXITED, which a real crash also is.
      const s = setup();
      beforeReady(s.harness, () => {
        throw new Error(
          "OperationInterruptedError: Sandbox operation process.waitForPort was interrupted while the runtime connection was closing",
        );
      });
      const { result, starts } = await records(() =>
        s.start(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorMessage).toContain("PREVIEW_SERVER_EXITED");
      expect(starts).toHaveLength(1);
      expect(s.pauses).toEqual([]);
    });

    it("does not retry a dev server that exited before it was ready", async () => {
      const s = setup({ behaviour: "exit", server: { readyTimeoutMs: 10_000 } });
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      expect(starts).toHaveLength(1);
      expect(s.harness.commands).toHaveLength(1);
    });

    it("does not retry without the Durable Object's current-start record to check against", async () => {
      // Unknown is not "still current": the retry could restart a preview
      // someone stopped.
      const s = setup({ failures: 1, guarded: false });
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      expect(starts).toHaveLength(1);
      expect(s.pauses).toEqual([]);
      expect(s.mkdirCalls).toBe(1);
    });

    it("ends with the refusal when the retry is refused as stale: a newer save stays", async () => {
      const HERO = "src/components/Hero.tsx";
      // The newer save lands while the start pauses.
      const s = setup({
        onPause: async (ctx) => {
          await runFencedWriteInSandbox(
            ctx.harness.session as unknown as FenceSandbox,
            {
              op: "write",
              root: "/workspace",
              files: [
                { path: HERO, content: "export default () => 'v2';\n", fence: 2 },
              ],
              generation: 5,
              marker: {
                path: THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
                content: "dirty:sync",
              },
            },
          );
        },
      });
      expect(
        (await s.start({ fileVersions: { [HERO]: 1 }, sourceGeneration: 4 }))
          .ok,
      ).toBe(true);
      let mkdirCalls = 0;
      override(s.harness, "mkdir", async () => {
        if (++mkdirCalls === 1) throw new Error(INTERRUPTED_MKDIR);
      });

      const { result, starts } = await records(() =>
        s.start({
          files: THEME.map((file) =>
            file.path === HERO ? { ...file, content: `${file.content}// older\n` } : file,
          ),
          fileVersions: { [HERO]: 1 },
          sourceGeneration: 4,
        }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-stale");
      expect(starts).toHaveLength(2);
      expect(s.harness.written.get(`/workspace/${HERO}`)).toBe(
        "export default () => 'v2';\n",
      );
    });
  });

  describe("a stopped or superseded start", () => {
    it("is not sent again when the author stops the preview during the pause, and starts no container", async () => {
      let afterStop = { writes: 0, commands: 0, execs: 0 };
      let execs = 0;
      const s = setup({
        failures: 1,
        onPause: async (ctx) => {
          await ctx.server.stop("preview-1");
          afterStop = {
            writes: ctx.harness.writePaths.length,
            commands: ctx.harness.commands.length,
            execs,
          };
        },
      });
      const exec = s.harness.session.exec.bind(s.harness.session);
      override(s.harness, "exec", async (command: string) => {
        execs += 1;
        return exec(command);
      });
      const { result, starts, retries } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-stopped");
      expect(starts).toHaveLength(1);
      expect(retries).toEqual([
        expect.objectContaining({
          retryOf: starts[0]!.attemptId,
          outcome: "cancelled",
          reason: "stopped",
        }),
      ]);
      // Nothing touched the container after the stop.
      expect(s.mkdirCalls).toBe(1);
      expect(s.harness.writePaths).toHaveLength(afterStop.writes);
      expect(s.harness.commands).toHaveLength(afterStop.commands);
      expect(execs).toBe(afterStop.execs);
      expect(s.harness.destroyed).toBe(1);
    });

    it("is not sent again when a newer start for the same preview supersedes it during the pause", async () => {
      const s = setup({
        failures: 1,
        onPause: (ctx) => ctx.guarded!.supersede(),
      });
      const { result, starts, retries } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-superseded");
      expect(starts).toHaveLength(1);
      expect(retries[0]).toMatchObject({ outcome: "cancelled", reason: "superseded" });
      expect(s.mkdirCalls).toBe(1);
      expect(s.harness.commands).toHaveLength(0);
      // The newer request stays the current one.
      expect(s.guarded!.guard.attemptId).toBe("newer-request");
    });

    it("never answers ready for a start superseded while its dev server was starting", async () => {
      const s = setup();
      beforeReady(s.harness, () => s.guarded!.supersede());
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-superseded");
      expect(result.recoveredFrom).toBeUndefined();
      expect(starts).toHaveLength(1);
      expect(starts[0]!.outcome).toBe("failed");
      expect(s.guarded!.guard.attemptId).toBe("newer-request");
    });

    it("never answers ready for a start stopped while its dev server was starting", async () => {
      const s = setup();
      beforeReady(s.harness, () => s.server.stop("preview-1"));
      const { result } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-stopped");
    });

    it("never answers ready for a retried attempt that a newer start superseded", async () => {
      const s = setup({ failures: 1 });
      beforeReady(s.harness, () => s.guarded!.supersede());
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-superseded");
      expect(result.recoveredFrom).toBeUndefined();
      expect(result.retryOf).toBe(starts[0]!.attemptId);
      expect(starts).toHaveLength(2);
    });
  });

  describe("the shared deadline and the 30 s window", () => {
    it("sends nothing when the first attempt fails at 29.7 s and the pause takes it past 30 s", async () => {
      const s = setup({
        failures: 1,
        beforeFailure: (ctx) => ctx.time.advance(29_700),
        onPause: (ctx) => ctx.time.advance(500),
      });
      const { result, starts, retries } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The first attempt's own failure, as if no retry existed.
      expect(result.stage).toBe("preview-server-start");
      expect(result.errorMessage).toBe(INTERRUPTED_MKDIR);
      expect(s.pauses).toEqual([500]);
      expect(starts).toHaveLength(1);
      expect(retries[0]).toMatchObject({ outcome: "cancelled", reason: "retry-window" });
      expect(s.mkdirCalls).toBe(1);
      // The Durable Object was not asked to hand over to a second attempt.
      expect(s.guarded!.guard.checks.some((check) => check.next)).toBe(false);
    });

    it("schedules no retry at all once the 30 s window has passed", async () => {
      const s = setup({
        failures: 1,
        beforeFailure: (ctx) => ctx.time.advance(30_001),
      });
      const { starts } = await records(() => s.start());

      expect(starts).toHaveLength(1);
      expect(starts[0]!.retry).toBeUndefined();
      expect(s.pauses).toEqual([]);
    });

    it("sends nothing when the pause takes the request past its own deadline", async () => {
      const s = setup({
        failures: 1,
        server: { startDeadlineMs: 10_000 },
        beforeFailure: (ctx) => ctx.time.advance(9_800),
        onPause: (ctx) => ctx.time.advance(500),
      });
      const { result, starts, retries } = await records(() => s.start());

      expect(result.ok).toBe(false);
      expect(starts).toHaveLength(1);
      expect(retries[0]).toMatchObject({ outcome: "cancelled", reason: "deadline" });
      expect(s.mkdirCalls).toBe(1);
    });

    it("gives the second attempt only what is left of the deadline, never a full ready timeout", async () => {
      const s = setup({
        behaviour: "silent",
        failures: 1,
        server: { startDeadlineMs: 400, readyTimeoutMs: 180_000 },
        beforeFailure: (ctx) => ctx.time.advance(300),
      });
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorMessage).toContain("PREVIEW_SERVER_TIMEOUT");
      expect(result.errorMessage).toContain("within 100ms");
      expect(starts).toHaveLength(2);
    });

    it("never answers ready for a success that came back after the deadline", async () => {
      const s = setup({ server: { startDeadlineMs: 10_000 } });
      beforeReady(s.harness, () => s.time.advance(10_001));
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-deadline");
      expect(starts[0]!.outcome).toBe("failed");
    });

    it("keeps the retry inside the one start slot it entered with", async () => {
      let seen: number | null = null;
      const s = setup({
        failures: 1,
        onPause: () => {
          const other = enterPreviewStart("preview-1");
          seen = other.concurrentAtEntry;
          other.leave();
        },
      });
      const { starts } = await records(() => s.start());

      expect(seen).toBe(1);
      expect(starts.map((start) => start.concurrentAtEntry)).toEqual([0, 0]);
      const after = enterPreviewStart("preview-1");
      expect(after.concurrentAtEntry).toBe(0);
      after.leave();
    });
  });

  /**
   * Superseding is per previewId (user, 11-24): one container, and so one
   * Durable Object, per storefront + Theme + user
   * (`theme-preview-session-id.ts`). A second tab of the same author starts
   * the same previewId; another Theme or another author is another previewId.
   *
   * These run over the real current-start record
   * (`preview-start-attempt-guard.ts`), wired to the session the way
   * `PreviewSandbox` wires it to its storage, rather than over the stand-in
   * above: what is under test is that record and the start path together.
   */
  describe("another tab starts the same preview (real current-start record)", () => {
    type Stored = Map<string, unknown>;

    /** One preview's Durable Object storage, and the session's RPC methods over it. */
    const withRealStartGuard = (harness: Harness, now: () => number) => {
      const stored: Stored = new Map();
      const storage = {
        get: async (key: string) => stored.get(key),
        put: async (key: string, value: unknown) => {
          stored.set(key, value);
        },
      };
      const checks: Array<{ attemptId: string; next?: string }> = [];
      override(
        harness,
        "claimPreviewStart",
        (input: { attemptId: string; deadlineAt: number }) =>
          claimPreviewStartAttempt(storage, input),
      );
      override(
        harness,
        "checkPreviewStart",
        (input: { attemptId: string; next?: string }) => {
          checks.push(input);
          return checkPreviewStartAttempt(storage, input, now());
        },
      );
      override(harness, "endPreviewStarts", () =>
        endPreviewStartAttempts(storage),
      );
      return {
        checks,
        /** The Durable Object's storage lost: its record, and its number, gone. */
        forget: () => stored.clear(),
        /** What the Durable Object holds now. */
        record: () =>
          stored.get(PREVIEW_START_ATTEMPT_STORAGE_KEY) as
            | { attemptId: string | null; deadlineAt: number | null; stopped: boolean }
            | undefined,
        /** The Durable Object's own answer for `attemptId`, now. */
        statusOf: (attemptId: string) =>
          checkPreviewStartAttempt(storage, { attemptId }, now()),
      };
    };

    type StartResult = Awaited<
      ReturnType<CloudflareSandboxVitePreviewServer["start"]>
    >;

    /** The other tab: its own request, maybe in another isolate, same container. */
    const otherTab = (
      ctx: Setup,
      getSandbox: PreviewServerProvider["getSandbox"] = async () =>
        ctx.harness.session,
    ) =>
      new CloudflareSandboxVitePreviewServer({
        sandboxProvider: { getSandbox },
        sandboxBinding: {},
        ...retryOptions({ now: ctx.time.now, pause: async () => {} }),
      });

    const startInput = (previewId = "preview-1") => ({
      previewId,
      files: THEME,
      entry: "src/pages/index.tsx",
      previewHostname: "preview.example.com",
      platformHostEnv: { PUBLIC_URL: "https://admin.example.net" },
    });

    /** What the container saw up to now, to show nothing touched it later. */
    const containerSnapshot = (harness: Harness) => ({
      writes: harness.writePaths.length,
      deletes: harness.deletedPaths.length,
      commands: harness.commands.length,
      killed: harness.killed.length,
      destroyed: harness.destroyed,
      unexposed: harness.unexposed.length,
    });

    it("A in its 500 ms pause, B starts the same previewId: A sends no retry, answers superseded, and B's preview stays ready", async () => {
      let b = null as StartResult | null;
      let afterB = null as ReturnType<typeof containerSnapshot> | null;
      let mkdirAfterB = 0;
      const s = setup({
        failures: 1,
        guarded: false,
        onPause: async (ctx) => {
          b = await otherTab(ctx).start(startInput());
          afterB = containerSnapshot(ctx.harness);
          mkdirAfterB = s.mkdirCalls;
        },
      });
      const real = withRealStartGuard(s.harness, s.time.now);
      const { result: a, starts, retries } = await records(() => s.start());

      // B claimed the preview and came up.
      expect(b).not.toBeNull();
      const bResult = b!;
      expect(bResult.ok).toBe(true);
      const bAttempt = bResult.attemptId!;
      expect(bAttempt).toEqual(expect.any(String));

      // A's late answer: superseded, never ready, never recovered.
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.stage).toBe("preview-start-superseded");
      expect(a.recoveredFrom).toBeUndefined();
      const aStarts = starts.filter((start) => start.attemptId !== bAttempt);
      expect(aStarts).toHaveLength(1);
      expect(a.attemptId).toBe(aStarts[0]!.attemptId);
      expect(retries).toEqual([
        expect.objectContaining({
          retryOf: aStarts[0]!.attemptId,
          outcome: "cancelled",
          reason: "superseded",
        }),
      ]);
      // A asked to hand over to its retry once, and was refused.
      expect(real.checks.filter((check) => check.next)).toHaveLength(1);

      // A did nothing in the container after B claimed it.
      expect(s.mkdirCalls).toBe(mkdirAfterB);
      expect(containerSnapshot(s.harness)).toEqual(afterB);
      expect(s.harness.killed).toEqual([]);
      expect(s.harness.destroyed).toBe(0);

      // B is still the current start, under its own deadline.
      expect(real.record()).toMatchObject({
        attemptId: bAttempt,
        stopped: false,
      });
      expect(await real.statusOf(bAttempt)).toBe("current");
      expect(await real.statusOf(a.attemptId!)).toBe("superseded");
    });

    it("A's retry is running, B starts the same previewId: A's late success answers superseded, no third attempt, and B's preview stays ready", async () => {
      let b = null as StartResult | null;
      let afterB = null as ReturnType<typeof containerSnapshot> | null;
      let mkdirAfterB = 0;
      const s = setup({ failures: 1, guarded: false });
      const real = withRealStartGuard(s.harness, s.time.now);
      let claimedDuringRetry = false;
      // The first attempt fails while staging, before any dev server: the
      // first dev server to wait for its port is the retry's.
      beforeReady(s.harness, async () => {
        if (claimedDuringRetry) return;
        claimedDuringRetry = true;
        b = await otherTab(s).start(startInput());
        afterB = containerSnapshot(s.harness);
        mkdirAfterB = s.mkdirCalls;
      });
      const { result: a, starts, retries } = await records(() => s.start());

      expect(claimedDuringRetry).toBe(true);
      const bResult = b!;
      expect(bResult.ok).toBe(true);
      const bAttempt = bResult.attemptId!;

      // A's retry came back after B claimed: superseded, never ready.
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.stage).toBe("preview-start-superseded");
      expect(a.recoveredFrom).toBeUndefined();
      const aStarts = starts.filter((start) => start.attemptId !== bAttempt);
      // The first attempt and its one retry; nothing after B claimed.
      expect(aStarts).toHaveLength(2);
      expect(aStarts[1]!.retryOf).toBe(aStarts[0]!.attemptId);
      expect(aStarts[1]!.outcome).toBe("failed");
      expect(a.retryOf).toBe(aStarts[0]!.attemptId);
      expect(retries.filter((retry) => retry.outcome === "sent")).toHaveLength(1);

      // A's late answer stopped nothing and wrote nothing in B's container.
      expect(s.mkdirCalls).toBe(mkdirAfterB);
      expect(containerSnapshot(s.harness)).toEqual(afterB);
      expect(s.harness.killed).toEqual([]);
      expect(s.harness.destroyed).toBe(0);

      expect(real.record()).toMatchObject({ attemptId: bAttempt, stopped: false });
      expect(await real.statusOf(bAttempt)).toBe("current");
      expect(await real.statusOf(a.attemptId!)).toBe("superseded");
    });

    it("keeps the request's original deadline across the retry: the Durable Object's record is not renewed, and a retry ready after it is not answered", async () => {
      const t0 = 1_000_000;
      const s = setup({
        failures: 1,
        guarded: false,
        server: { startDeadlineMs: 10_000 },
        beforeFailure: (ctx) => ctx.time.advance(4_000),
      });
      const real = withRealStartGuard(s.harness, s.time.now);
      // Ready 6.5 s into the retry: inside a deadline renewed at the retry
      // (4 s + 10 s), past the request's own (10 s).
      beforeReady(s.harness, () => s.time.advance(6_500));
      const { result, starts } = await records(() => s.start());

      expect(starts).toHaveLength(2);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-deadline");
      expect(result.recoveredFrom).toBeUndefined();
      // The hand-over named the retry current under the first claim's deadline.
      expect(real.record()).toMatchObject({
        attemptId: starts[1]!.attemptId,
        deadlineAt: t0 + 10_000,
      });
      expect(await real.statusOf(starts[1]!.attemptId as string)).toBe(
        "expired",
      );
    });

    it("a start of another previewId during A's pause neither supersedes A nor is touched by A's retry", async () => {
      const other = createSession("ready");
      let b = null as StartResult | null;
      let otherAfterB = null as ReturnType<typeof containerSnapshot> | null;
      const s = setup({
        failures: 1,
        guarded: false,
        onPause: async (ctx) => {
          b = await otherTab(ctx, async (_binding, id) =>
            id === "preview-2" ? other.session : ctx.harness.session,
          ).start(startInput("preview-2"));
          otherAfterB = containerSnapshot(other);
        },
      });
      const realA = withRealStartGuard(s.harness, s.time.now);
      const realB = withRealStartGuard(other, s.time.now);
      const { result: a, starts, retries } = await records(() => s.start());

      const bResult = b!;
      expect(bResult.ok).toBe(true);
      const bAttempt = bResult.attemptId!;

      // A's retry was sent and A recovered, as if B did not exist.
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      expect(a.recoveredFrom).toMatchObject({ attempts: 2 });
      const aStarts = starts.filter((start) => start.previewId === "preview-1");
      expect(aStarts).toHaveLength(2);
      expect(retries[0]).toMatchObject({ outcome: "sent" });
      expect(realA.record()).toMatchObject({ attemptId: a.attemptId });

      // B's own record and container are its own.
      expect(realB.record()).toMatchObject({ attemptId: bAttempt });
      expect(await realB.statusOf(bAttempt)).toBe("current");
      expect(containerSnapshot(other)).toEqual(otherAfterB);
      expect(other.killed).toEqual([]);
      expect(other.destroyed).toBe(0);
    });

    it("a stop of another previewId during A's pause does not stop A", async () => {
      const other = createSession("ready");
      const s = setup({
        failures: 1,
        guarded: false,
        onPause: async (ctx) => {
          await otherTab(ctx, async (_binding, id) =>
            id === "preview-2" ? other.session : ctx.harness.session,
          ).stop("preview-2");
        },
      });
      const realA = withRealStartGuard(s.harness, s.time.now);
      const realB = withRealStartGuard(other, s.time.now);
      const { result: a, retries } = await records(() => s.start());

      expect(a.ok).toBe(true);
      expect(retries[0]).toMatchObject({ outcome: "sent" });
      expect(realA.record()).toMatchObject({ stopped: false });
      expect(realB.record()).toMatchObject({ stopped: true });
      expect(s.harness.destroyed).toBe(0);
      expect(other.destroyed).toBe(1);
    });

    /**
     * The other tab's Theme differs from A's in one file, and neither start
     * carries versions: the fence's "equal versions pass, the later write
     * wins" would let A's late layout replace B's. Only the current-start
     * record can stop it.
     */
    const THEME_B = THEME.map((file) =>
      file.path === "src/components/Hero.tsx"
        ? { ...file, content: file.content.replace("<h1>", '<h1 data-tab="b">') }
        : file,
    );

    /** What one clean start of `files` lays out, read from a fresh container. */
    const cleanStartOf = async (files: typeof THEME) => {
      const probe = createSession("ready");
      const result = await startWith(probe, { files });
      expect(result.ok).toBe(true);
      return {
        stagingWrites: probe.writePaths.filter((file) =>
          file.startsWith(PREVIEW_START_STAGING_PREFIX),
        ).length,
        sources: new Map(
          files.map((file) => [
            `/workspace/${file.path}`,
            probe.written.get(`/workspace/${file.path}`),
          ]),
        ),
      };
    };

    it.each([
      ["between two of its staging writes", "staging"],
      ["just before its fence", "fence"],
      ["just before its startProcess", "startProcess"],
    ] as const)(
      "B claims the same previewId while A's retry is %s: A stops before its next container step, writes nothing after B's claim, answers superseded, and the workspace holds B's bytes",
      async (_label, point) => {
        const cleanA = await cleanStartOf(THEME);
        const cleanB = await cleanStartOf(THEME_B);
        // There is a staging write after the first one, and a last one.
        expect(cleanA.stagingWrites).toBeGreaterThan(1);
        expect(cleanB.sources.get("/workspace/src/components/Hero.tsx")).toContain(
          'data-tab="b"',
        );

        let retrying = false;
        let claimed = false;
        let execs = 0;
        let b = null as StartResult | null;
        const s = setup({
          failures: 1,
          guarded: false,
          onPause: () => {
            retrying = true;
          },
        });
        const real = withRealStartGuard(s.harness, s.time.now);
        /**
         * Everything the container holds or was asked to do, so far, apart
         * from A's own staging: since the workspace-ownership decision
         * (user, 2026-11-24) a superseded attempt clears its own /tmp
         * staging, and only that, so that one removal is left out here and
         * checked on its own below.
         */
        const container = () => ({
          written: new Map(
            [...s.harness.written].filter(
              ([file]) => !file.startsWith(PREVIEW_START_STAGING_PREFIX),
            ),
          ),
          writes: s.harness.writePaths.length,
          deletes: s.harness.deletedPaths.length,
          mkdirs: s.mkdirCalls,
          execs,
          commands: s.harness.commands.length,
          exposed: s.harness.exposed.length,
          unexposed: s.harness.unexposed.length,
          sleepAfter: s.harness.sleepAfter.length,
          killed: s.harness.killed.length,
          destroyed: s.harness.destroyed,
        });
        let afterB = null as ReturnType<typeof container> | null;
        const claimByB = async () => {
          claimed = true;
          b = await otherTab(s).start({ ...startInput(), files: THEME_B });
          afterB = container();
        };

        const exec = s.harness.session.exec.bind(s.harness.session);
        const ownStagingRemovals: string[] = [];
        override(
          s.harness,
          "exec",
          async (...args: Parameters<PreviewServerSession["exec"]>) => {
            if (
              claimed &&
              String(args[0]).startsWith(`rm -rf ${PREVIEW_START_STAGING_PREFIX}`)
            ) {
              ownStagingRemovals.push(String(args[0]));
            } else {
              execs += 1;
            }
            return exec(...args);
          },
        );
        const writeFile = s.harness.session.writeFile.bind(s.harness.session);
        let retryStagingWrites = 0;
        override(
          s.harness,
          "writeFile",
          async (...args: Parameters<PreviewServerSession["writeFile"]>) => {
            await writeFile(...args);
            if (
              !retrying ||
              claimed ||
              !String(args[0]).startsWith(PREVIEW_START_STAGING_PREFIX)
            ) {
              return;
            }
            retryStagingWrites += 1;
            if (
              (point === "staging" && retryStagingWrites === 1) ||
              (point === "fence" &&
                retryStagingWrites === cleanA.stagingWrites)
            ) {
              await claimByB();
            }
          },
        );
        const setSleepAfter = s.harness.session.setSleepAfter!.bind(
          s.harness.session,
        );
        // The last container step before the dev server is started (no
        // running server to replace, no content stamp for this runtime).
        override(s.harness, "setSleepAfter", async (value: string | number) => {
          await setSleepAfter(value);
          if (point === "startProcess" && retrying && !claimed) {
            await claimByB();
          }
        });

        const { result: a, starts } = await records(() => s.start());

        expect(claimed).toBe(true);
        const bResult = b!;
        expect(bResult.ok).toBe(true);
        const bAttempt = bResult.attemptId!;

        // A answers superseded: never ready, never recovered, no third try.
        expect(a.ok).toBe(false);
        if (a.ok) return;
        expect(a.stage).toBe("preview-start-superseded");
        expect(a.recoveredFrom).toBeUndefined();
        const aStarts = starts.filter((start) => start.attemptId !== bAttempt);
        expect(aStarts).toHaveLength(2);
        expect(a.retryOf).toBe(aStarts[0]!.attemptId);

        // Nothing at all reached the container from A after B's claim, but
        // the removal of its own staging.
        expect(container()).toEqual(afterB);
        expect(ownStagingRemovals).toHaveLength(point === "startProcess" ? 0 : 1);
        expect(
          [...s.harness.written.keys()].filter((file) =>
            file.startsWith(PREVIEW_START_STAGING_PREFIX),
          ),
        ).toEqual([]);
        // B's Theme files are laid out exactly as a clean start of B's.
        for (const [file, bytes] of cleanB.sources) {
          expect(s.harness.written.get(file)).toBe(bytes);
        }
        expect(real.record()).toMatchObject({
          attemptId: bAttempt,
          stopped: false,
        });
      },
    );

    /**
     * Two tabs, first attempts only: nothing fails and nothing is retried.
     * A claims and begins; B claims the same previewId, lays out THEME_B
     * and comes up; only then does A go on. Neither start carries versions,
     * so A's fence passes as "equal versions, the later write wins" and
     * lands after B's. The current-start record is the only thing that can
     * keep A's late layout out of the workspace B is serving.
     *
     * A is held inside one of its own container calls while B runs, so
     * every later step of A (fence, expose, lifecycle, dev server) comes
     * after B's ready answer: the snapshot taken there is "everything after
     * B's claim" for /workspace and for processes.
     *
     * Committed red (user, 11-24); green since the workspace-ownership
     * decision (user, 2026-11-24): B's claim is registered in the fence
     * ledger, so A's fence is refused under the lock and writes nothing,
     * and A's dev server launch is refused by the serve gate. `commands`
     * counts dev servers launched; a launch the gate refused is in
     * `gated`.
     */
    it.each([
      ["between two of its staging writes", "staging"],
      ["just before its fence", "fence"],
      ["just before its startProcess", "startProcess"],
    ] as const)(
      "first attempts only: B claims the same previewId while A is %s, B is ready first, and A's late completion changes nothing in the workspace B serves and answers superseded",
      async (_label, point) => {
        const cleanA = await cleanStartOf(THEME);
        const cleanB = await cleanStartOf(THEME_B);
        expect(cleanA.stagingWrites).toBeGreaterThan(1);
        // The one file the two Themes differ in, as each lays it out.
        const HERO_FILE = "/workspace/src/components/Hero.tsx";
        expect(cleanB.sources.get(HERO_FILE)).toContain('data-tab="b"');
        expect(cleanA.sources.get(HERO_FILE)).not.toBe(
          cleanB.sources.get(HERO_FILE),
        );

        let claimed = false;
        let b = null as StartResult | null;
        // No failures: neither start throws, neither is retried.
        const s = setup({ failures: 0, guarded: false });
        const real = withRealStartGuard(s.harness, s.time.now);
        /**
         * What B is serving: the workspace with its marker and manifest, and
         * the container's processes, address and lifecycle. Deliberately not
         * A's own /tmp files or its fence exec: a fix that refuses A inside
         * the fence still runs that exec (see the handoff note).
         */
        const container = () => ({
          workspace: new Map(
            [...s.harness.written].filter(
              ([file]) =>
                file.startsWith("/workspace/") ||
                file === THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH ||
                file === THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
            ),
          ),
          commands: s.harness.commands.length,
          exposed: s.harness.exposed.length,
          unexposed: s.harness.unexposed.length,
          sleepAfter: s.harness.sleepAfter.length,
          killed: s.harness.killed.length,
          destroyed: s.harness.destroyed,
        });
        let afterB = null as ReturnType<typeof container> | null;
        let writePathsAtB = 0;
        let deletedPathsAtB = 0;
        const claimByB = async () => {
          claimed = true;
          b = await otherTab(s).start({ ...startInput(), files: THEME_B });
          afterB = container();
          writePathsAtB = s.harness.writePaths.length;
          deletedPathsAtB = s.harness.deletedPaths.length;
        };

        const writeFile = s.harness.session.writeFile.bind(s.harness.session);
        let aStagingWrites = 0;
        override(
          s.harness,
          "writeFile",
          async (...args: Parameters<PreviewServerSession["writeFile"]>) => {
            await writeFile(...args);
            // Before B's claim, every call is A's.
            if (
              claimed ||
              !String(args[0]).startsWith(PREVIEW_START_STAGING_PREFIX)
            ) {
              return;
            }
            aStagingWrites += 1;
            if (
              (point === "staging" && aStagingWrites === 1) ||
              (point === "fence" && aStagingWrites === cleanA.stagingWrites)
            ) {
              await claimByB();
            }
          },
        );
        const setSleepAfter = s.harness.session.setSleepAfter!.bind(
          s.harness.session,
        );
        // A's last container step before its dev server (fresh container:
        // no running server to replace, no content stamp for this runtime).
        override(s.harness, "setSleepAfter", async (value: string | number) => {
          await setSleepAfter(value);
          if (point === "startProcess" && !claimed) await claimByB();
        });

        const { result: a, starts, retries } = await records(() => s.start());

        expect(claimed).toBe(true);
        const bResult = b!;
        expect(bResult.ok).toBe(true);
        const bAttempt = bResult.attemptId!;

        // First attempts only: one start line each, no retry at all.
        expect(retries).toEqual([]);
        const aStarts = starts.filter((start) => start.attemptId !== bAttempt);
        expect(aStarts).toHaveLength(1);
        expect(a.attemptId).toBe(aStarts[0]!.attemptId);
        expect(aStarts[0]!.retryOf).toBeUndefined();

        // A answers superseded: never ready, never recovered.
        expect(a.ok).toBe(false);
        if (a.ok) return;
        expect(a.stage).toBe("preview-start-superseded");
        expect(a.recoveredFrom).toBeUndefined();

        // A wrote and deleted nothing in /workspace after B's claim, and
        // started no process.
        expect(
          s.harness.writePaths
            .slice(writePathsAtB)
            .filter((file) => file.startsWith("/workspace/")),
        ).toEqual([]);
        expect(
          s.harness.deletedPaths
            .slice(deletedPathsAtB)
            .filter((file) => file.startsWith("/workspace/")),
        ).toEqual([]);
        expect(s.harness.commands.length).toBe(afterB!.commands);
        // A reached its launch only in the last case, and the gate refused it.
        expect(s.harness.gated).toHaveLength(point === "startProcess" ? 1 : 0);
        // What B serves is as B left it: workspace, marker, manifest,
        // processes, address, lifecycle.
        expect(container()).toEqual(afterB);
        // Every Theme file in /workspace holds exactly B's bytes.
        for (const [file, bytes] of cleanB.sources) {
          expect(s.harness.written.get(file)).toBe(bytes);
        }
        expect(real.record()).toMatchObject({
          attemptId: bAttempt,
          stopped: false,
        });
        expect(await real.statusOf(bAttempt)).toBe("current");
        expect(await real.statusOf(a.attemptId!)).toBe("superseded");
      },
    );

    /**
     * The must-test case (user, 2026-11-24): B has taken over — its claim
     * is registered in the fence ledger — but has not committed its files
     * yet, and A fails at that moment. A must not mark B's workspace dirty
     * and must write nothing under /workspace; B then commits and serves its
     * own bytes.
     *
     * A has laid out and committed its own Theme and launched its dev
     * server while it still owned the workspace. B is then held inside its
     * first staging write: its claim is in the ledger by then (registered
     * before its first workspace step), and none of its files are in
     * /workspace. A fails there; only after A has answered does B go on.
     */
    it.each([
      ["its dev server exits", "vite-exit"],
      ["one of its container steps throws", "step-throws"],
    ] as const)(
      "B has taken over in the ledger but not committed, and A fails then (%s): A marks nothing, writes nothing under /workspace, and B commits and serves its own bytes",
      async (_label, how) => {
        const cleanA = await cleanStartOf(THEME);
        const cleanB = await cleanStartOf(THEME_B);
        const HERO_FILE = "/workspace/src/components/Hero.tsx";
        const s = setup({ failures: 0, guarded: false });
        const real = withRealStartGuard(s.harness, s.time.now);

        let bStarted = false;
        let bHeld = false;
        let releaseB!: () => void;
        const bRelease = new Promise<void>((resolve) => {
          releaseB = resolve;
        });
        let bAtStaging!: () => void;
        const bStaging = new Promise<void>((resolve) => {
          bAtStaging = resolve;
        });
        let bStart = null as Promise<StartResult> | null;

        const writeFile = s.harness.session.writeFile.bind(s.harness.session);
        override(
          s.harness,
          "writeFile",
          async (...args: Parameters<PreviewServerSession["writeFile"]>) => {
            if (
              bStarted &&
              !bHeld &&
              String(args[0]).startsWith(PREVIEW_START_STAGING_PREFIX)
            ) {
              bHeld = true;
              bAtStaging();
              await bRelease;
            }
            return writeFile(...args);
          },
        );

        /** What is shared: /workspace (marker and manifest included), the ledger, processes. */
        const shared = () => ({
          workspace: new Map(
            [...s.harness.written].filter(([file]) =>
              file.startsWith("/workspace/"),
            ),
          ),
          workspaceWrites: workspaceWrites(s.harness).length,
          workspaceDeletes: s.harness.deletedPaths.filter((file) =>
            file.startsWith("/workspace/"),
          ).length,
          ledger: s.harness.written.get(PREVIEW_FENCE_LEDGER_PATH),
          killed: s.harness.killed.length,
        });
        let atFailure = null as ReturnType<typeof shared> | null;
        const takeOver = async () => {
          bStarted = true;
          bStart = otherTab(s).start({ ...startInput(), files: THEME_B });
          await bStaging;
          atFailure = shared();
        };

        if (how === "vite-exit") {
          const startProcess = s.harness.session.startProcess.bind(
            s.harness.session,
          );
          let launches = 0;
          override(
            s.harness,
            "startProcess",
            async (...args: Parameters<PreviewServerSession["startProcess"]>) => {
              const process = await startProcess(...args);
              if (++launches > 1) return process;
              return {
                ...process,
                waitForPort: async () => {
                  await takeOver();
                  throw new Error("Process exited before the port was ready.");
                },
              };
            },
          );
        } else {
          const setSleepAfter = s.harness.session.setSleepAfter!.bind(
            s.harness.session,
          );
          let calls = 0;
          override(s.harness, "setSleepAfter", async (value: string | number) => {
            if (++calls > 1) return setSleepAfter(value);
            await takeOver();
            throw new Error("setSleepAfter failed: the container did not answer");
          });
        }

        let afterA = null as ReturnType<typeof shared> | null;
        let b = null as StartResult | null;
        const { result: a, starts, retries } = await records(async () => {
          const answer = await s.start();
          afterA = shared();
          // Only now does B go on.
          releaseB();
          b = await bStart!;
          return answer;
        });

        expect(atFailure).not.toBeNull();
        const at = atFailure!;
        // A owned and committed the workspace before B took over.
        expect(at.workspace.get(HERO_FILE)).toBe(cleanA.sources.get(HERO_FILE));
        const aMarker = at.workspace.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH);
        expect(aMarker).toBeDefined();
        expect(isDirtyWorkspaceMarker(aMarker ?? null)).toBe(false);
        // B's claim is in the ledger, and none of B's files are in /workspace.
        expect(JSON.parse(at.ledger!).owner).toMatchObject({
          attemptId: (real.record() as { attemptId: string }).attemptId,
        });

        // A failed while B held the ledger: no dirty marker, nothing under
        // /workspace, no ledger change, and it stopped no process.
        expect(afterA).toEqual(at);

        // A answers superseded: never ready, never retried.
        expect(a.ok).toBe(false);
        if (a.ok) return;
        expect(a.stage).toBe("preview-start-superseded");
        expect(retries).toEqual([]);

        // B then committed and serves its own bytes.
        const bResult = b!;
        expect(bResult.ok).toBe(true);
        const bAttempt = bResult.attemptId!;
        const bLine = starts.find((start) => start.attemptId === bAttempt)!;
        expect(bLine.workspace).toMatchObject({ committed: true });
        for (const [file, bytes] of cleanB.sources) {
          expect(s.harness.written.get(file)).toBe(bytes);
        }
        const bMarker = s.harness.written.get(
          THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
        );
        expect(isDirtyWorkspaceMarker(bMarker ?? null)).toBe(false);
        expect(bMarker).not.toBe(aMarker);
        expect(real.record()).toMatchObject({ attemptId: bAttempt, stopped: false });
        expect(await real.statusOf(a.attemptId!)).toBe("superseded");
      },
    );

    /** Everything shared the container holds or runs, to show a refused start changed none of it. */
    const sharedState = (harness: Harness) => ({
      written: new Map(harness.written),
      links: new Map(harness.links),
      commands: harness.commands.length,
      killed: harness.killed.length,
      exposed: harness.exposed.length,
      unexposed: harness.unexposed.length,
      sleepAfter: harness.sleepAfter.length,
      destroyed: harness.destroyed,
    });

    /**
     * Durable Object outages (follow-up, user 2026-11-24: "DO unreachable:
     * refuse the new start, and keep the existing workspace and processes
     * untouched"). Two separate cases.
     */
    it("a brief Durable Object outage refuses the start in it, touches nothing, and the next start after it succeeds", async () => {
      const s = setup({ failures: 0, guarded: false });
      withRealStartGuard(s.harness, s.time.now);
      expect((await s.start()).ok).toBe(true);
      const before = sharedState(s.harness);

      const claim = (s.harness.session as unknown as Record<string, unknown>)
        .claimPreviewStart as (input: unknown) => Promise<{ seq: number }>;
      let down = true;
      override(s.harness, "claimPreviewStart", async (input: unknown) => {
        if (down) throw new Error("Durable Object unreachable");
        return claim(input);
      });
      const { result: during, starts } = await records(() => s.start());

      expect(during.ok).toBe(false);
      if (during.ok) return;
      expect(during.stage).toBe("preview-start-unconfirmed");
      expect(starts[0]!.guarded).toBe(false);
      // The workspace, its ledger, its link and its processes, as they were.
      expect(sharedState(s.harness)).toEqual(before);

      down = false;
      const after = await s.start();
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      // The workspace the outage left alone is still the committed one.
      expect(after.timings.workspaceReused).toBe(true);
    });

    it("a lost Durable Object record (numbers restart) is refused by the live container's higher owner, untouched, until the stop and rebuild recover", async () => {
      const s = setup({ failures: 0, guarded: false });
      const real = withRealStartGuard(s.harness, s.time.now);
      // The container's ledger reaches seq 3.
      for (let round = 0; round < 3; round += 1) {
        expect((await s.start()).ok).toBe(true);
      }
      const ledgerOwner = () =>
        JSON.parse(s.harness.written.get(PREVIEW_FENCE_LEDGER_PATH)!).owner as {
          seq: number;
        };
      expect(ledgerOwner().seq).toBe(3);

      // The Durable Object's storage is lost: its numbers start again at 1.
      real.forget();
      const before = sharedState(s.harness);
      for (const expectedSeq of [1, 2]) {
        const refused = await s.start();
        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        // A lower number than the live container's owner: refused at its
        // registration, before any workspace step.
        expect(refused.stage).toBe("preview-start-superseded");
        expect(ledgerOwner().seq).toBe(3);
        expect(sharedState(s.harness)).toEqual(before);
        expect((real.record() as unknown as { seq: number }).seq).toBe(expectedSeq);
      }

      // The existing stop: the Durable Object takes a number, and the
      // container is destroyed (a replacement holds no ledger).
      const destroy = s.harness.session.destroy.bind(s.harness.session);
      override(s.harness, "destroy", async () => {
        await destroy();
        s.harness.written.clear();
        s.harness.links.clear();
      });
      await s.server.stop("preview-1");

      // The rebuild: laid out whole in the new container, and ready.
      const rebuilt = await s.start();
      expect(rebuilt.ok).toBe(true);
      if (!rebuilt.ok) return;
      expect(rebuilt.timings.workspaceReused).toBe(false);
      expect(ledgerOwner().seq).toBe(4);
    });

    /**
     * Read-back pairs (follow-up, user 2026-11-24: a dirty marker keeps the
     * disk read-back, but the read-back only decides HOW to update; it never
     * decides that a start may skip its fence, its ownership or its commit).
     */
    const HERO_PATH = "src/components/Hero.tsx";
    const HERO_ON_DISK = `/workspace/${HERO_PATH}`;
    /** One dev server the container lists as running. */
    const withListedVite = (harness: Harness) => {
      let running = true;
      override(harness, "listProcesses", async () =>
        running
          ? [
              {
                id: "already-running",
                command: `${START_TOOLCHAIN.root}/node_modules/.bin/vite --config /workspace/vite.config.ts`,
                status: "running",
              },
            ]
          : [],
      );
      const kill = harness.session.killProcess!.bind(harness.session);
      override(harness, "killProcess", async (id?: string) => {
        await kill(id);
        if (id === "already-running") running = false;
      });
    };
    /** A Code Save's incremental sync, as the server function sends it. */
    const syncFile = (harness: Harness, file: string, content: string) =>
      runFencedWriteInSandbox(harness.session as unknown as FenceSandbox, {
        op: "write",
        root: "/workspace",
        files: [{ path: file, content, fence: 2 }],
        marker: {
          path: THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
          content: "dirty:sync",
        },
      });
    const THEME_HERO_2 = THEME.map((file) =>
      file.path === HERO_PATH
        ? { ...file, content: file.content.replace("<h1>", "<h1 data-v=\"2\">") }
        : file,
    );

    it("after a normal incremental sync, the read-back finds the disk as planned: files and dev server are reused, and the commit is made", async () => {
      const s = setup({ failures: 0, guarded: false });
      withRealStartGuard(s.harness, s.time.now);
      expect((await s.start()).ok).toBe(true);
      withListedVite(s.harness);
      // The save's sync lays the saved Hero out exactly as a start would.
      const laid = (await cleanStartOf(THEME_HERO_2)).sources.get(HERO_ON_DISK)!;
      await syncFile(s.harness, HERO_PATH, laid);
      expect(
        isDirtyWorkspaceMarker(
          s.harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ?? null,
        ),
      ).toBe(true);
      const writesBefore = workspaceWrites(s.harness).length;

      const { result, starts } = await records(() =>
        s.start({ files: THEME_HERO_2 }),
      );

      expect(result.ok).toBe(true);
      expect(starts[0]!.workspace).toMatchObject({
        previous: "dirty",
        update: "none",
        committed: true,
      });
      expect(
        (starts[0]!.workspace as { verification: { read: number } }).verification
          .read,
      ).toBeGreaterThan(0);
      expect((starts[0]!.vite as { action: string }).action).toBe("reused");
      expect(s.harness.killed).toEqual([]);
      // Only the manifest, then the marker: no Theme file rewritten.
      expect(workspaceWrites(s.harness).slice(writesBefore)).toEqual([
        THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
        THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      ]);
    });

    it.each([
      ["a half-written workspace", "half-written"],
      ["files the plan does not have", "leftover"],
      ["a read-back that fails", "read-back-fails"],
    ] as const)(
      "a dirty marker over %s forces a full rebuild and a dev server restart",
      async (_label, how) => {
        const s = setup({ failures: 0, guarded: false });
        withRealStartGuard(s.harness, s.time.now);
        expect((await s.start()).ok).toBe(true);
        withListedVite(s.harness);
        const LEFTOVER = "/workspace/src/components/Leftover.tsx";
        s.harness.written.set(
          THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
          "dirty:start-halfway",
        );
        if (how === "half-written") {
          // A start stopped mid-way: one file cut short, one not there yet.
          const hero = s.harness.written.get(HERO_ON_DISK)!;
          s.harness.written.set(HERO_ON_DISK, hero.slice(0, hero.length >> 1));
          s.harness.written.delete("/workspace/src/pages/index.tsx");
        } else if (how === "leftover") {
          s.harness.written.set(LEFTOVER, "export default () => null;\n");
        } else {
          // The read-back's own listing fails; the later prune listing works.
          const list = s.harness.session.listFiles!.bind(s.harness.session);
          let listings = 0;
          override(
            s.harness,
            "listFiles",
            async (...args: Parameters<NonNullable<PreviewServerSession["listFiles"]>>) => {
              if (++listings === 1) throw new Error("listing failed");
              return list(...args);
            },
          );
        }

        const { result, starts } = await records(() => s.start());

        expect(result.ok).toBe(true);
        expect(starts[0]!.workspace).toMatchObject({
          previous: "dirty",
          update: "full",
          committed: true,
        });
        if (how === "read-back-fails") {
          expect(
            (starts[0]!.workspace as { verification: unknown }).verification,
          ).toEqual({ failed: "unlistable" });
        }
        expect((starts[0]!.vite as { action: string }).action).toBe("restarted");
        expect(s.harness.killed).toEqual(["already-running"]);
        const clean = await cleanStartOf(THEME);
        for (const [file, bytes] of clean.sources) {
          expect(s.harness.written.get(file)).toBe(bytes);
        }
        expect(s.harness.written.has(LEFTOVER)).toBe(false);
      },
    );

    it("B takes over after A's read-back began: although A's read-back matches, A commits nothing, reuses no process and is not answered ready", async () => {
      const s = setup({ failures: 0, guarded: false });
      const real = withRealStartGuard(s.harness, s.time.now);
      expect((await s.start()).ok).toBe(true);
      withListedVite(s.harness);
      // What a sync leaves after writing what the plan already has: a dirty
      // marker over a disk that matches.
      s.harness.written.set(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH, "dirty:sync");

      let armed = true;
      let b = null as StartResult | null;
      let afterB = null as ReturnType<typeof sharedState> | null;
      const read = s.harness.session.readFile!.bind(s.harness.session);
      override(
        s.harness,
        "readFile",
        async (...args: Parameters<NonNullable<PreviewServerSession["readFile"]>>) => {
          // A's read-back reads its first planned file: B claims, lays out
          // (its own read-back finds the same disk) and is ready, first.
          if (armed && String(args[0]).startsWith("/workspace/src/")) {
            armed = false;
            b = await otherTab(s).start(startInput());
            afterB = sharedState(s.harness);
          }
          return read(...args);
        },
      );
      const { result: a, starts } = await records(() => s.start());

      const bResult = b!;
      expect(bResult.ok).toBe(true);
      const aLine = starts.find((start) => start.attemptId === a.attemptId)!;
      // A's read-back matched: it would have updated nothing...
      expect(aLine.workspace).toMatchObject({ previous: "dirty", update: "none" });
      // ...and still A commits nothing, reuses no process, is not ready.
      expect((aLine.workspace as { committed?: boolean }).committed).not.toBe(true);
      expect(aLine.vite).toBeNull();
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.stage).toBe("preview-start-superseded");
      expect(sharedState(s.harness)).toEqual(afterB);
      expect(
        JSON.parse(s.harness.written.get(PREVIEW_FENCE_LEDGER_PATH)!).owner,
      ).toMatchObject({ attemptId: bResult.attemptId });
      expect(real.record()).toMatchObject({ attemptId: bResult.attemptId });
    });

    /**
     * The serve gate's gap (follow-up, user 2026-11-24): the gate releases
     * the fence lock before its shell execs the dev server, so B can take
     * over in between. Modelled here with the container's processes: the
     * gate's shell is listed as running from the moment it is started, a
     * kill ends it (and reports its exit), and only a shell still alive
     * after the gap execs its dev server. The real-container half of this
     * check (how the sandbox lists and stops that shell) is the lead's to
     * run in the container E2E.
     */
    it("B takes over in the gap between A's serve gate and its exec: B's dev server serves B's bytes, and A's cleanup kills nothing of B's", async () => {
      const cleanB = await cleanStartOf(THEME_B);
      const s = setup({ failures: 0, guarded: false });
      const real = withRealStartGuard(s.harness, s.time.now);
      type Proc = {
        id: string;
        command: string;
        onExit?: (code: number | null) => void;
        running: boolean;
      };
      const procs: Proc[] = [];
      const exec = s.harness.session.exec.bind(s.harness.session);
      override(s.harness, "listProcesses", async () =>
        procs
          .filter((proc) => proc.running)
          .map((proc) => ({ id: proc.id, command: proc.command, status: "running" })),
      );
      override(s.harness, "killProcess", async (id?: string) => {
        s.harness.killed.push(id);
        const proc = procs.find((entry) => entry.id === id && entry.running);
        if (proc) {
          proc.running = false;
          queueMicrotask(() => proc.onExit?.(143));
        }
      });
      const exited = (id: string) => ({
        id,
        waitForPort: async () => {
          throw new Error("Process exited before the port was ready.");
        },
      });
      let gap = null as (() => Promise<void>) | null;
      override(
        s.harness,
        "startProcess",
        async (
          command: string,
          options?: { onExit?: (code: number | null) => void },
        ) => {
          // The shell exists, and is listed, from here on.
          const proc: Proc = {
            id: `proc-${procs.length + 1}`,
            command,
            onExit: options?.onExit,
            running: true,
          };
          procs.push(proc);
          const gate = /^sh -c 'node (\S+) (\S+) && exec (.+)'$/.exec(command);
          if (gate) {
            const run = await exec(`node ${gate[1]} ${gate[2]}`);
            if (JSON.parse(run.stdout).ownership !== "owner") {
              proc.running = false;
              queueMicrotask(() => options?.onExit?.(75));
              return exited(proc.id);
            }
            // The gate passed and released the lock; no exec yet.
            const inGap = gap;
            gap = null;
            if (inGap) await inGap();
          }
          if (!proc.running) return exited(proc.id);
          s.harness.commands.push(command);
          return {
            id: proc.id,
            waitForPort: async () => {
              if (!proc.running) {
                throw new Error("Process exited before the port was ready.");
              }
            },
          };
        },
      );
      let b = null as StartResult | null;
      gap = async () => {
        b = await otherTab(s).start({ ...startInput(), files: THEME_B });
      };

      const { result: a } = await records(() => s.start());

      const bResult = b!;
      expect(bResult.ok).toBe(true);
      if (!bResult.ok) return;
      // B found A's shell running, replaced it, and serves its own bytes.
      expect(bResult.processId).toBe("proc-2");
      expect(procs.filter((proc) => proc.running).map((proc) => proc.id)).toEqual([
        "proc-2",
      ]);
      expect(s.harness.commands).toEqual([procs[1]!.command]);
      for (const [file, bytes] of cleanB.sources) {
        expect(s.harness.written.get(file)).toBe(bytes);
      }
      // A: superseded, and its cleanup stopped nothing (only B's kill of A's shell).
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.stage).toBe("preview-start-superseded");
      expect(s.harness.killed).toEqual(["proc-1"]);
      expect(real.record()).toMatchObject({ attemptId: bResult.attemptId });
    });

    /**
     * The toolchain link (follow-up fix, user 2026-11-24): the workspace's
     * node_modules symlink (rm + ln) is made inside the fence, so a start
     * that no longer owns the workspace never touches it. A registers, then
     * B claims, lays out and is ready before A's next step.
     */
    it("B owns the workspace: A's toolchain link step neither runs nor removes B's link", async () => {
      const s = setup({ failures: 0, guarded: false });
      withRealStartGuard(s.harness, s.time.now);
      const LINK = "/workspace/node_modules";
      const exec = s.harness.session.exec.bind(s.harness.session);
      let claims = 0;
      let bDone = false;
      let b = null as StartResult | null;
      let linkOpsAtB = 0;
      const linkCommandsAfterB: string[] = [];
      override(s.harness, "exec", async (command: string) => {
        if (bDone && command.includes(LINK)) linkCommandsAfterB.push(command);
        const fenced = /^node (\S+) (\S+)$/.exec(command);
        const op = fenced
          ? (JSON.parse(s.harness.written.get(fenced[2]!) ?? "{}") as { op?: string }).op
          : undefined;
        const answer = await exec(command);
        if (op === "claim" && ++claims === 1) {
          b = await otherTab(s).start({ ...startInput(), files: THEME_B });
          bDone = true;
          linkOpsAtB = s.harness.linkOps.length;
        }
        return answer;
      });

      const { result: a } = await records(() => s.start());

      expect(b!.ok).toBe(true);
      expect(a.ok).toBe(false);
      if (a.ok) return;
      expect(a.stage).toBe("preview-start-superseded");
      // B's start linked the workspace, inside its fence.
      expect(linkOpsAtB).toBeGreaterThan(0);
      expect(s.harness.links.get(LINK)).toBe(`${START_TOOLCHAIN.root}/node_modules`);
      // A neither sent a link command nor had the fence link anything.
      expect(linkCommandsAfterB).toEqual([]);
      expect(s.harness.linkOps).toHaveLength(linkOpsAtB);
    });
  });

  /**
   * Review 2026-11-24, findings 1 and 6. The fail-closed marker is left
   * alone only when another start owns the workspace (superseded) or the
   * preview was stopped. A retry that ran out of time, or that cannot reach
   * the Durable Object, still owns it: dirty is the safe direction, so the
   * next start rebuilds instead of trusting what this one left. Since the
   * workspace-ownership decision (user, 2026-11-24) "still owns it" is the
   * fence ledger's answer, not the refusal's kind: these retries are the
   * ledger's registered owner, so their marker goes through.
   */
  describe("the fail-closed marker, and a Durable Object that cannot be reached", () => {
    /** The workspace marker, null when none was written. */
    const marker = (harness: Harness) =>
      harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ?? null;

    /** The session's check, made to throw once `broken()` is true. */
    const breakCheck = (harness: Harness, broken: () => boolean) => {
      const session = harness.session as unknown as Record<string, unknown>;
      const check = session.checkPreviewStart as (input: {
        attemptId: string;
        next?: string;
      }) => Promise<string>;
      override(
        harness,
        "checkPreviewStart",
        async (input: { attemptId: string; next?: string }) => {
          if (broken()) throw new Error("Durable Object unreachable");
          return check(input);
        },
      );
    };

    it("a retry whose dev server times out at the request's deadline leaves the workspace marked untrusted", async () => {
      const s = setup({
        behaviour: "silent",
        failures: 1,
        server: { startDeadlineMs: 10_000, readyTimeoutMs: 50 },
      });
      // The retry's dev server never answers; by the time its wait ends,
      // the request's deadline has passed.
      beforeReady(s.harness, () => s.time.advance(10_000));
      const { result, starts } = await records(() => s.start());

      expect(starts).toHaveLength(2);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorMessage).toContain("PREVIEW_SERVER_TIMEOUT");
      // The retry's fence committed its marker; the timeout must undo that.
      expect(isDirtyWorkspaceMarker(marker(s.harness))).toBe(true);
    });

    it("a retry whose dev server exits while the Durable Object cannot be reached leaves the workspace marked untrusted", async () => {
      let unreachable = false;
      const s = setup({ behaviour: "exit", failures: 1 });
      breakCheck(s.harness, () => unreachable);
      beforeReady(s.harness, () => {
        unreachable = true;
      });
      const { result, starts } = await records(() => s.start());

      expect(starts).toHaveLength(2);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorMessage).toContain("PREVIEW_SERVER_EXITED");
      expect(isDirtyWorkspaceMarker(marker(s.harness))).toBe(true);
    });

    it("a retry stopped at a later step by its deadline leaves the workspace marked untrusted, and starts nothing", async () => {
      let retrying = false;
      const s = setup({
        failures: 1,
        server: { startDeadlineMs: 10_000 },
        onPause: () => {
          retrying = true;
        },
      });
      // Past the deadline once the retry has fenced and exposed its port:
      // its next step is refused by the deadline, not by another start.
      const exposePort = s.harness.session.exposePort.bind(s.harness.session);
      override(
        s.harness,
        "exposePort",
        async (...args: Parameters<PreviewServerSession["exposePort"]>) => {
          const exposed = await exposePort(...args);
          if (retrying) s.time.advance(10_000);
          return exposed;
        },
      );
      const { result, starts } = await records(() => s.start());

      expect(starts).toHaveLength(2);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-deadline");
      expect(s.harness.commands).toHaveLength(0);
      expect(isDirtyWorkspaceMarker(marker(s.harness))).toBe(true);
    });

    it("a check that throws before the retry sends no retry, and the first failure stands", async () => {
      const s = setup({ failures: 1 });
      breakCheck(s.harness, () => true);
      const { result, starts, retries } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-server-start");
      expect(result.errorMessage).toBe(INTERRUPTED_MKDIR);
      expect(result.recoveredFrom).toBeUndefined();
      expect(starts).toHaveLength(1);
      expect(retries).toEqual([
        expect.objectContaining({
          retryOf: starts[0]!.attemptId,
          outcome: "cancelled",
          reason: "unconfirmed",
        }),
      ]);
      expect(s.pauses).toEqual([500]);
      expect(s.mkdirCalls).toBe(1);
      expect(s.harness.commands).toHaveLength(0);
    });

    /**
     * Workspace ownership (user, 2026-11-24): a claim that cannot be made
     * leaves the start without a number to register, so its ownership can
     * never be proven and it writes nothing shared. It is refused before
     * any container step, logged guarded:false, and never retried. (Before
     * that decision it ran unguarded and answered ready.)
     */
    it.each([
      ["throws", "throws"],
      ["returns no number", "no-seq"],
    ] as const)(
      "a claim that %s answers preview-start-unconfirmed and touches no container: logged guarded:false, never retried",
      async (_label, how) => {
        const s = setup({ failures: 1 });
        let execs = 0;
        const exec = s.harness.session.exec.bind(s.harness.session);
        override(s.harness, "exec", async (command: string) => {
          execs += 1;
          return exec(command);
        });
        override(s.harness, "claimPreviewStart", async () => {
          if (how === "throws") throw new Error("Durable Object unreachable");
          return undefined;
        });
        const { result, starts, retries } = await records(() => s.start());

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.stage).toBe("preview-start-unconfirmed");
        expect(starts).toHaveLength(1);
        expect(starts[0]!.guarded).toBe(false);
        expect(starts[0]!.retry).toBeUndefined();
        expect(retries).toEqual([]);
        expect(s.pauses).toEqual([]);
        expect(s.guarded!.guard.checks).toEqual([]);
        // Nothing reached the container.
        expect(s.mkdirCalls).toBe(0);
        expect(execs).toBe(0);
        expect(s.harness.writePaths).toEqual([]);
        expect(s.harness.commands).toEqual([]);
      },
    );

    it("a first attempt whose success cannot be confirmed answers preview-start-unconfirmed, never ready", async () => {
      const s = setup();
      breakCheck(s.harness, () => true);
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-unconfirmed");
      expect(result.recoveredFrom).toBeUndefined();
      expect(starts).toHaveLength(1);
      expect(starts[0]!.outcome).toBe("failed");
      expect(s.harness.commands).toHaveLength(1);
    });
  });

  /**
   * Round 3, formal 1c (handoff/2026-11-24/r3-1c-second-start-attribution.md).
   * A start that fails with "Container failed to start" has lost its
   * connection with it. The SDK's next call opens a new connection, and
   * opening one starts the container (`startContainerForRPC`). The
   * fail-closed marker write after the failure was that call: it started a
   * second container that never got a workspace or a dev server, that
   * nobody adopted or stopped, and Morph's answer waited for it (~1.36 s).
   *
   * The fence ledger already refuses to trust a workspace without a proven
   * commit, and this request's own staging went with the container, so
   * after a container-start failure the request makes no container call at
   * all, and logs that it skipped them. Still never retried (user, 11-24).
   */
  describe("after the container failed to start", () => {
    const FAILED_TO_START =
      "SandboxError: Container failed to start: Container failed to start";
    /** Every session method that reaches the container (not the Durable Object's guard). */
    const CONTAINER_CALLS = [
      "mkdir",
      "writeFile",
      "readFile",
      "listFiles",
      "deleteFile",
      "startProcess",
      "exposePort",
      "unexposePort",
      "getExposedPorts",
      "listProcesses",
      "killProcess",
      "setSleepAfter",
      "exec",
      "destroy",
    ] as const;
    type ContainerCall = (typeof CONTAINER_CALLS)[number];

    /**
     * The SDK's control connection, modelled: a container call with no live
     * connection opens one, and opening one starts the container. The first
     * call `failsHere` matches finds the container gone: the start its new
     * connection makes fails with "Container failed to start", the
     * connection is destroyed, and any later call opens another one, which
     * starts a container again.
     */
    const withContainerStarts = (
      harness: Harness,
      failsHere: (name: ContainerCall, args: unknown[]) => boolean,
      /** What the failing call throws. */
      message: string = FAILED_TO_START,
    ) => {
      const counted = { starts: 0, afterFailure: [] as string[] };
      let live = false;
      let failed = false;
      const session = harness.session as unknown as Record<string, unknown>;
      for (const name of CONTAINER_CALLS) {
        const original = session[name];
        if (typeof original !== "function") continue;
        session[name] = async (...args: unknown[]) => {
          if (failed) {
            counted.afterFailure.push(name);
          } else if (failsHere(name, args)) {
            failed = true;
            live = false;
            counted.starts += 1;
            throw new Error(message);
          }
          if (!live) {
            counted.starts += 1;
            live = true;
          }
          return (original as (...a: unknown[]) => unknown).apply(
            harness.session,
            args,
          );
        };
      }
      return counted;
    };

    /** The fence run whose request is `op`, read from the request file it was given. */
    const fenceRun =
      (harness: Harness, op: string) =>
      (name: ContainerCall, args: unknown[]) => {
        if (name !== "exec") return false;
        const fenced = /^node (\S+) (\S+)$/.exec(String(args[0]));
        if (!fenced) return false;
        const request = harness.written.get(fenced[2]!);
        return request !== undefined && JSON.parse(request).op === op;
      };

    it.each([
      {
        name: "on its first container call, the claim's fence run (round 3's shape)",
        guarded: true,
        failsHere: () => () => true,
        starts: 1,
      },
      {
        name: "on its first container call, unguarded",
        guarded: false,
        failsHere: () => () => true,
        starts: 1,
      },
      {
        name: "while it was staging (its own staging went with the container)",
        guarded: true,
        failsHere: () => (name: ContainerCall) => name === "mkdir",
        starts: 2,
      },
      {
        name: "on the fence run that lays the workspace out",
        guarded: true,
        failsHere: (harness: Harness) => fenceRun(harness, "start"),
        starts: 2,
      },
    ])(
      "$name: no later container call starts a container, and the skip is logged with the attemptId",
      async ({ guarded, failsHere, starts: expectedStarts }) => {
        const s = setup({ guarded });
        const counted = withContainerStarts(s.harness, failsHere(s.harness));
        const { result, starts, retries, events } = await records(() =>
          s.start(),
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.stage).toBe("preview-server-start");
        expect(result.errorMessage).toBe(FAILED_TO_START);
        // Not retried: "Container failed to start" stays off the allow-list.
        expect(starts).toHaveLength(1);
        expect(starts[0]!.retry).toBeUndefined();
        expect(retries).toEqual([]);
        expect(s.pauses).toEqual([]);
        // The known hazard: nothing after the failure reaches the container,
        // so the only container starts are the ones the start itself made.
        expect(counted.afterFailure).toEqual([]);
        expect(counted.starts).toBe(expectedStarts);
        expect(s.harness.commands).toEqual([]);
        // Observable, not swallowed: one line, for this attempt.
        expect(events("post-failure-container-call-skipped")).toEqual([
          expect.objectContaining({
            attemptId: starts[0]!.attemptId,
            previewId: "preview-1",
            reason: "container-failed-to-start",
          }),
        ]);
        expect(events("fail-closed-marker")).toEqual([]);
      },
    );

    it("another failure still marks the workspace untrusted, and logs the marker's result with the attemptId", async () => {
      // Pins the other side: only a container-start failure skips the call.
      const s = setup({ failures: 1, message: "EACCES: permission denied, mkdir" });
      const { result, starts, events } = await records(() => s.start());

      expect(result.ok).toBe(false);
      expect(starts).toHaveLength(1);
      expect(events("post-failure-container-call-skipped")).toEqual([]);
      expect(events("fail-closed-marker")).toEqual([
        expect.objectContaining({
          attemptId: starts[0]!.attemptId,
          previewId: "preview-1",
          result: "marked",
        }),
      ]);
      expect(
        isDirtyWorkspaceMarker(
          s.harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ??
            null,
        ),
      ).toBe(true);
    });

    /**
     * The platform's admission refusals (handoff/2026-11-24/
     * container-unavailable-classification.md). The SDK (0.12.7-0.12.14,
     * CONTAINER_UNAVAILABLE_SIGNATURES) keeps the platform's text verbatim
     * as the message of a ContainerUnavailableError; over Durable Object RPC
     * only the message arrives, with the class name folded in front. Same
     * hazard as "Container failed to start": the failed connection is
     * destroyed and the next call opens one that starts a container. Only
     * these two whole messages are covered (user, 2026-11-24), only to skip
     * the calls after them: they are never retried.
     */
    describe("the platform refused a container (two exact admission messages)", () => {
      const NO_INSTANCE =
        "there is no container instance that can be provided to this durable object";
      const MAX_INSTANCES =
        "maximum number of running container instances exceeded";
      const REFUSALS = [
        { label: "no instance, as the SDK keeps it", message: NO_INSTANCE },
        {
          label: "no instance, the class name in front",
          message: `ContainerUnavailableError: ${NO_INSTANCE}`,
        },
        { label: "too many instances, as the SDK keeps it", message: MAX_INSTANCES },
        {
          label: "too many instances, the class name in front, capitalised",
          message:
            "ContainerUnavailableError: Maximum number of running container instances exceeded",
        },
      ];
      const POINTS = [
        {
          point: "on its first container call, guarded",
          guarded: true,
          failsHere: (_harness: Harness) => () => true,
          starts: 1,
        },
        {
          point: "on its first container call, unguarded",
          guarded: false,
          failsHere: (_harness: Harness) => () => true,
          starts: 1,
        },
        {
          point: "while it was staging",
          guarded: true,
          failsHere: (_harness: Harness) => (name: ContainerCall) =>
            name === "mkdir",
          starts: 2,
        },
        {
          point: "on the fence run that lays the workspace out",
          guarded: true,
          failsHere: (harness: Harness) => fenceRun(harness, "start"),
          starts: 2,
        },
      ];

      it.each(
        REFUSALS.flatMap((refusal) =>
          POINTS.map((point) => ({ ...refusal, ...point })),
        ),
      )(
        "$label, $point: no later container call starts a container, it is not retried, and the skip is logged",
        async ({ message, guarded, failsHere, starts: expectedStarts }) => {
          const s = setup({ guarded });
          const counted = withContainerStarts(
            s.harness,
            failsHere(s.harness),
            message,
          );
          const { result, starts, retries, events } = await records(() =>
            s.start(),
          );

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.stage).toBe("preview-server-start");
          expect(result.errorMessage).toBe(message);
          // Never retried (user, 2026-11-24): the allow-list is unchanged.
          expect(starts).toHaveLength(1);
          expect(starts[0]!.retry).toBeUndefined();
          expect(retries).toEqual([]);
          expect(s.pauses).toEqual([]);
          // No writeFile, exec or marker write after the refusal: each would
          // open a new connection, and that starts a container.
          expect(counted.afterFailure).toEqual([]);
          expect(counted.starts).toBe(expectedStarts);
          expect(s.harness.commands).toEqual([]);
          expect(events("post-failure-container-call-skipped")).toEqual([
            expect.objectContaining({
              attemptId: starts[0]!.attemptId,
              previewId: "preview-1",
              reason: "container-admission-refused",
              skipped: ["own-staging-clean-up", "fail-closed-marker"],
            }),
          ]);
          expect(events("fail-closed-marker")).toEqual([]);
        },
      );

      it.each([
        { label: "no instance", message: NO_INSTANCE },
        {
          label: "too many instances, the class name in front",
          message: `ContainerUnavailableError: ${MAX_INSTANCES}`,
        },
      ])(
        "$label, after its fence moved files but before it committed: nothing marks the workspace, and the next start does not reuse it",
        async ({ message }) => {
          const s = setup();
          expect((await s.start()).ok).toBe(true);
          const HERO_ON_DISK = "/workspace/src/components/Hero.tsx";
          const committedHero = s.harness.written.get(HERO_ON_DISK);
          const THEME_HERO_2 = THEME.map((file) =>
            file.path === "src/components/Hero.tsx"
              ? { ...file, content: file.content.replace("<h1>", '<h1 data-v="2">') }
              : file,
          );

          // The second start's fence is cut after it dirtied the marker and
          // moved its files, before its ledger write and its commit; the
          // container is then gone and the platform refuses a new one. The
          // harness keeps the disk, the worst case: a restarted container
          // would hold an empty /workspace.
          const exec = s.harness.session.exec!.bind(s.harness.session);
          const isStartFence = fenceRun(s.harness, "start");
          let cut = false;
          const set = s.harness.written.set.bind(s.harness.written);
          s.harness.written.set = (key: string, value: string) => {
            if (cut && key === PREVIEW_FENCE_LEDGER_PATH) {
              cut = false;
              throw new Error("the container went away inside the fence");
            }
            return set(key, value);
          };
          const counted = withContainerStarts(
            s.harness,
            (name, args) => {
              if (!isStartFence(name, args)) return false;
              // The fence runs synchronously up to the cut (the harness's
              // exec has no await before it), then the call is refused.
              cut = true;
              void exec(String(args[0])).catch(() => {});
              return true;
            },
            message,
          );

          const failed = await records(() => s.start({ files: THEME_HERO_2 }));
          expect(failed.result.ok).toBe(false);
          if (failed.result.ok) return;
          expect(failed.result.errorMessage).toBe(message);
          expect(counted.afterFailure).toEqual([]);
          expect(failed.events("fail-closed-marker")).toEqual([]);
          // What the refused attempt left, unfinished: its fence's own dirty
          // marker over a workspace it half updated.
          expect(
            isDirtyWorkspaceMarker(
              s.harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ??
                null,
            ),
          ).toBe(true);
          expect(s.harness.written.get(HERO_ON_DISK)).not.toBe(committedHero);

          // Capacity again: the next start of the committed Theme.
          const { result: next, starts } = await records(() => s.start());
          expect(next.ok).toBe(true);
          if (!next.ok) return;
          expect(next.timings.workspaceReused).toBe(false);
          expect(starts[0]!.workspace).toMatchObject({
            reused: false,
            previous: "dirty",
            committed: true,
          });
          expect((starts[0]!.workspace as { update?: string }).update).not.toBe(
            "none",
          );
          // Every Theme file is a clean start's bytes.
          const probe = createSession("ready");
          expect((await startWith(probe)).ok).toBe(true);
          for (const file of THEME) {
            const onDisk = `/workspace/${file.path}`;
            expect(s.harness.written.get(onDisk)).toBe(probe.written.get(onDisk));
          }
        },
      );

      it.each([
        [
          "the HTTP-path signature, deliberately not covered",
          "there is no container instance available at this time",
        ],
        [
          "the SDK's teardown message under the same code",
          "ContainerUnavailableError: The sandbox container was unavailable: the connection was torn down before it became reachable. Retry the operation.",
        ],
        [
          "the SDK's upgrade-budget message under the same code",
          "ContainerUnavailableError: Container was unavailable after exhausting upgrade retry budget (status 503)",
        ],
        [
          "a start timeout",
          "SANDBOX_START_TIMEOUT: the sandbox did not start within 90000 ms",
        ],
        ["the sentence inside another message", `Theme build said: ${NO_INSTANCE}`],
        ["the sentence with more after it", `${MAX_INSTANCES}; retry later`],
        ["another class name in front", `SandboxError: ${NO_INSTANCE}`],
      ])(
        "%s still marks the workspace untrusted and skips nothing",
        async (_name, message) => {
          const s = setup({ failures: 1, message });
          const { result, starts, retries, events } = await records(() =>
            s.start(),
          );

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.errorMessage).toBe(message);
          expect(starts).toHaveLength(1);
          expect(retries).toEqual([]);
          expect(events("post-failure-container-call-skipped")).toEqual([]);
          expect(events("fail-closed-marker")).toEqual([
            expect.objectContaining({
              attemptId: starts[0]!.attemptId,
              result: "marked",
            }),
          ]);
          expect(
            isDirtyWorkspaceMarker(
              s.harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ??
                null,
            ),
          ).toBe(true);
        },
      );
    });
  });

  /**
   * Two-tab race, run 1 (2026-11-24): B took over the workspace while A's
   * freshly launched dev server was still booting, reused it, and answered
   * ready at once. B's frame got "Container is not listening to port 5173".
   * Reuse means the listed server serves, not that it exists.
   */
  describe("a start that reuses a dev server listed in the container", () => {
    type PortCheck = (
      port: number,
      options?: { path?: string },
    ) => Promise<void>;

    /**
     * The container lists the first start's dev server (proc-1) as
     * `status`; `getProcess` hands back its process with `waitForPort`, or
     * nothing when `handle` is "gone".
     */
    const withListedServer = (
      harness: Harness,
      status: "starting" | "running",
      handle: PortCheck | "gone",
    ) => {
      const asked: string[] = [];
      const launched = harness.commands[0]!;
      override(harness, "listProcesses", async () => [
        { id: "proc-1", command: launched, status },
      ]);
      override(harness, "getProcess", async (id: string) => {
        asked.push(id);
        return handle === "gone" ? null : { id, waitForPort: handle };
      });
      return asked;
    };

    it.each([
      { runtime: "the standalone preview", overrides: {} },
      { runtime: "a full Start preview", overrides: { previewRuntime: "start" as const } },
    ])(
      "$runtime: a server still starting is not answered ready until its port check passes, with the launch path's check, and the wait is recorded",
      async ({ overrides }) => {
        const s = setup();
        expect((await s.start(overrides)).ok).toBe(true);
        expect(s.harness.waitedPorts).toHaveLength(1);
        const waited: Array<{ port: number; path?: string }> = [];
        let open!: () => void;
        const portOpen = new Promise<void>((resolve) => {
          open = resolve;
        });
        let asked!: () => void;
        const portAsked = new Promise<void>((resolve) => {
          asked = resolve;
        });
        const getProcessIds = withListedServer(
          s.harness,
          "starting",
          async (port, options) => {
            waited.push({ port, path: options?.path });
            asked();
            await portOpen;
          },
        );

        let settled = false;
        const second = s.start(overrides).then((result) => {
          settled = true;
          return result;
        });
        await Promise.race([portAsked, second]);
        await new Promise((resolve) => setTimeout(resolve, 20));
        // Still waiting on the listed server's port.
        expect(settled).toBe(false);
        open();
        const result = await second;

        expect(result.ok, !result.ok ? result.errorMessage : "").toBe(true);
        if (!result.ok) return;
        expect(result.processId).toBe("proc-1");
        expect(result.timings.reusedProcess).toBe(true);
        expect(result.timings.viteReadyMs).toBeGreaterThan(0);
        expect(result.readyMs).toBe(result.timings.viteReadyMs);
        expect(getProcessIds).toEqual(["proc-1"]);
        // The same port and probe path the launch path waited on.
        expect(waited).toEqual(s.harness.waitedPorts);
        expect(s.harness.commands).toHaveLength(1);
        expect(s.harness.killed).toEqual([]);
      },
    );

    it.each([
      {
        name: "its port check fails",
        handle: (async () => {
          throw new Error("Process exited before the port was ready.");
        }) as PortCheck,
        server: {},
        reason: "vite-exited",
        code: "PREVIEW_SERVER_EXITED:",
      },
      {
        name: "the container no longer has the process",
        handle: "gone" as const,
        server: {},
        reason: "vite-exited",
        code: "PREVIEW_SERVER_EXITED:",
      },
      {
        name: "its port check does not pass within the readiness limit",
        handle: (() => new Promise<void>(() => {})) as PortCheck,
        server: { readyTimeoutMs: 50 },
        reason: "vite-timeout",
        code: "PREVIEW_SERVER_TIMEOUT:",
      },
    ])(
      "$name: not answered ready, failed closed as a launch would be, and the listed server is neither killed nor launched again",
      async ({ handle, server, reason, code }) => {
        const s = setup({ server });
        expect((await s.start()).ok).toBe(true);
        withListedServer(s.harness, "starting", handle);
        const { result, starts } = await records(() => s.start());

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.stage).toBe("preview-server-start");
        expect(result.errorMessage.startsWith(code)).toBe(true);
        expect(starts).toHaveLength(1);
        expect(starts[0]!.failedClosed).toBe(reason);
        expect((starts[0]!.vite as { action: string }).action).toBe("reused");
        expect(
          isDirtyWorkspaceMarker(
            s.harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH) ??
              null,
          ),
        ).toBe(true);
        expect(s.harness.commands).toHaveLength(1);
        expect(s.harness.killed).toEqual([]);
      },
    );

    it("a newer start claims the preview while this one waits on the listed server: answered superseded, nothing killed or launched", async () => {
      const s = setup();
      expect((await s.start()).ok).toBe(true);
      const marker = s.harness.written.get(
        THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
      );
      withListedServer(s.harness, "starting", async () => {
        await s.guarded!.supersede();
      });
      const { result, starts } = await records(() => s.start());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("preview-start-superseded");
      expect(starts).toHaveLength(1);
      expect((starts[0]!.vite as { action: string }).action).toBe("reused");
      expect(s.harness.written.get(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH)).toBe(
        marker,
      );
      expect(s.harness.commands).toHaveLength(1);
      expect(s.harness.killed).toEqual([]);
    });

    it("a server running and serving is still reused: answered ready without a second launch", async () => {
      const s = setup();
      expect((await s.start()).ok).toBe(true);
      withListedServer(s.harness, "running", async () => {});
      const result = await s.start();

      expect(result.ok, !result.ok ? result.errorMessage : "").toBe(true);
      if (!result.ok) return;
      expect(result.processId).toBe("proc-1");
      expect(result.timings.reusedProcess).toBe(true);
      expect(s.harness.commands).toHaveLength(1);
      expect(s.harness.killed).toEqual([]);
    });
  });
});
