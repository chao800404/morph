import {
  prepareThemeSandboxWorkspace,
  type ThemeWorkspaceFile,
  type ThemeWorkspaceWriter,
} from "./theme-sandbox-workspace";
import {
  SANDBOX_TOOLCHAIN_ROOT,
  THEME_PREVIEW_SERVER_BASE_PATH,
} from "./theme-preview-dev-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { resolveThemePreviewServerHost } from "@/lib/storefront/service/theme-preview-server-origin";

/**
 * Runs a Theme's Live Preview as a real Vite dev server inside a sandbox
 * container, instead of compiling it to an artifact.
 *
 * A build answers "what will ship". A preview answers "what am I editing",
 * and it has to answer that repeatedly, in the time between keystrokes. The
 * same container that produces the artifact can hold a dev server open
 * instead: dependencies are already baked into the image, so there is no
 * install step, and Vite transpiles Theme source on demand and pushes later
 * edits over HMR rather than rebuilding.
 *
 * The server is the untrusted side of the isolation contract. It executes
 * Theme JavaScript, so it is reachable only on its own origin, it is given no
 * Morph credential of any kind, and the port it listens on is fixed so the
 * exposed URL cannot end up pointing at nothing.
 */

/** Port the dev server listens on inside the container. */
export const THEME_PREVIEW_SERVER_PORT = 5173;

const VITE_BIN = `${SANDBOX_TOOLCHAIN_ROOT}/node_modules/.bin/vite`;

/** Line Vite prints once it can serve requests. Kept as a compatibility path. */
const READY_MARKER = "ready in";

export type PreviewServerProcess = Readonly<{
  id?: string;
  /**
   * Cloudflare Sandbox's process-aware readiness check.
   *
   * It checks the port from inside the container and stops waiting if this
   * process exits. Older providers may not expose it, so log readiness remains
   * as a compatibility path rather than a second source of truth.
   */
  waitForPort?(
    port: number,
    options?: { path?: string; statusMin?: number; statusMax?: number },
  ): Promise<void>;
}>;

function withReadyTimeout(
  ready: Promise<"ready" | "exited">,
  timeoutMs: number,
): Promise<"ready" | "exited" | "timeout"> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: "ready" | "exited" | "timeout") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    void ready.then(finish, () => finish("exited"));
  });
}

function withPreviewServerBase(exposedUrl: string): string {
  const url = new URL(exposedUrl);
  url.pathname = THEME_PREVIEW_SERVER_BASE_PATH;
  return url.toString();
}

/**
 * The sandbox surface a preview server needs, beyond writing its workspace.
 */
export type PreviewServerSession = ThemeWorkspaceWriter &
  Readonly<{
    startProcess(
      command: string,
      options?: {
        env?: Record<string, string>;
        onOutput?: (stream: "stdout" | "stderr", data: string) => void;
        onExit?: (code: number | null) => void;
      },
    ): Promise<PreviewServerProcess>;
    exposePort(
      port: number,
      options: { hostname: string; name?: string; token?: string },
    ): Promise<{ url: string }>;
    /** Processes already running in this container, if it can say. */
    listProcesses?(): Promise<
      ReadonlyArray<{ id?: string; command?: string; status?: string }>
    >;
    killProcess?(id?: string): Promise<void>;
    unexposePort?(port: number): Promise<void>;
    setSleepAfter?(value: string | number): Promise<void>;
    destroy(): Promise<void>;
  }>;

export type PreviewServerProvider = Readonly<{
  getSandbox(
    binding: unknown,
    sandboxId: string,
  ): Promise<PreviewServerSession>;
}>;

export type StartPreviewServerInput = Readonly<{
  /** Identifies the container, and so the preview URL, for this Theme. */
  previewId: string;
  files: readonly ThemeWorkspaceFile[];
  entry: string;
  dependencies?: Readonly<Record<string, string>>;
  /** Host the preview URL is built on. Must not be platform surface. */
  previewHostname: string;
  /** Worker vars, so every platform hostname can be refused, not just one. */
  env: Record<string, unknown> | undefined;
}>;

export type StartPreviewServerResult =
  | Readonly<{
      ok: true;
      url: string;
      processId: string | undefined;
      readyMs: number;
      timings: PreviewServerTimings;
      /** Modules whose `contentFields` export was lifted for Fast Refresh. */
      hoistedContentFields: readonly string[];
      /** Preview behaviour that will differ from the build, and why. */
      warnings: ReadonlyArray<{ path: string; message: string }>;
      logs: readonly string[];
    }>
  | Readonly<{
      ok: false;
      stage: string;
      errorMessage: string;
      logs: readonly string[];
    }>;

export type PreviewServerTimings = Readonly<{
  /** Entire server start request, including lazy container startup. */
  totalMs: number;
  /** Getting the Durable Object handle only; this does not start the container. */
  sandboxHandleMs: number;
  /** Wall time spent transforming and laying out the workspace. */
  workspaceMs: number;
  /** First filesystem call, where a sleeping container normally starts lazily. */
  firstFilesystemCallMs: number;
  mkdirCalls: number;
  /** Sum of individual mkdir durations; may exceed wall time when calls overlap. */
  mkdirCumulativeMs: number;
  writeCalls: number;
  /** Sum of individual write durations; may exceed wall time when calls overlap. */
  writeCumulativeMs: number;
  exposePortMs: number;
  configureLifecycleMs: number;
  processLookupMs: number;
  viteReadyMs: number;
  reusedProcess: boolean;
}>;

export type CloudflareSandboxVitePreviewServerOptions = Readonly<{
  sandboxBinding?: unknown;
  sandboxProvider?: PreviewServerProvider;
  approvedDependencies?: readonly string[];
  /**
   * How long to wait for Vite to report itself ready.
   *
   * The container starts lazily on the first filesystem operation, then the
   * workspace is materialized and Vite becomes ready. Keep room for slow-tail
   * starts rather than tearing down a server that was about to answer; the
   * returned stage timings make local and deployed latency measurable.
   */
  readyTimeoutMs?: number;
  /** Idle time after which the container may be reclaimed. */
  sleepAfter?: string | number;
  maxLogLines?: number;
}>;

export class CloudflareSandboxVitePreviewServer {
  private readonly sandboxBinding?: unknown;
  private readonly sandboxProvider?: PreviewServerProvider;
  private readonly approvedDependencies: ReadonlySet<string>;
  private readonly readyTimeoutMs: number;
  private readonly sleepAfter: string | number;
  private readonly maxLogLines: number;

  constructor(options: CloudflareSandboxVitePreviewServerOptions = {}) {
    this.sandboxBinding = options.sandboxBinding;
    this.sandboxProvider = options.sandboxProvider;
    this.approvedDependencies = new Set(
      options.approvedDependencies ?? DEFAULT_APPROVED_DEPENDENCIES,
    );
    this.readyTimeoutMs = options.readyTimeoutMs ?? 180_000;
    this.sleepAfter = options.sleepAfter ?? "10m";
    this.maxLogLines = options.maxLogLines ?? 200;
  }

  private async acquire(previewId: string): Promise<PreviewServerSession> {
    if (this.sandboxProvider) {
      return this.sandboxProvider.getSandbox(this.sandboxBinding, previewId);
    }
    if (this.sandboxBinding) {
      const { getSandbox } = await import("@cloudflare/sandbox");
      return getSandbox(this.sandboxBinding as any, previewId) as any;
    }
    throw new Error(
      "SANDBOX_UNAVAILABLE: Cloudflare Sandbox binding or provider is not configured in current environment",
    );
  }

  async start(
    input: StartPreviewServerInput,
  ): Promise<StartPreviewServerResult> {
    const requestStartedAt = Date.now();
    const logs: string[] = [];
    const addLog = (line: string) => {
      if (logs.length < this.maxLogLines) logs.push(line);
    };

    // One rule, shared with the editor side that later frames the URL. A
    // preview on any platform host would put Theme code in Morph's cookie jar.
    const host = resolveThemePreviewServerHost({
      configuredPreviewHostname: input.previewHostname,
      env: input.env,
    });
    if (!host.enabled) {
      return {
        ok: false,
        stage: "preview-origin",
        errorMessage: `${host.reason}: A Live Preview that runs Theme JavaScript needs its own host, separate from every Morph hostname.`,
        logs,
      };
    }
    const previewHost = host.hostname;

    let session: PreviewServerSession | null = null;
    try {
      const sandboxHandleStartedAt = Date.now();
      session = await this.acquire(input.previewId);
      const sandboxHandleMs = Date.now() - sandboxHandleStartedAt;

      let firstFilesystemCallMs = 0;
      let sawFilesystemCall = false;
      let mkdirCalls = 0;
      let mkdirCumulativeMs = 0;
      let writeCalls = 0;
      let writeCumulativeMs = 0;
      const recordFilesystemCall = async <T>(
        operation: () => Promise<T>,
        kind: "mkdir" | "write",
      ): Promise<T> => {
        const startedAt = Date.now();
        try {
          return await operation();
        } finally {
          const durationMs = Date.now() - startedAt;
          if (!sawFilesystemCall) {
            sawFilesystemCall = true;
            firstFilesystemCallMs = durationMs;
          }
          if (kind === "mkdir") {
            mkdirCalls += 1;
            mkdirCumulativeMs += durationMs;
          } else {
            writeCalls += 1;
            writeCumulativeMs += durationMs;
          }
        }
      };
      const measuredWriter: ThemeWorkspaceWriter = {
        mkdir: (path, options) =>
          recordFilesystemCall(() => session!.mkdir(path, options), "mkdir"),
        writeFile: (path, content) =>
          recordFilesystemCall(
            () => session!.writeFile(path, content),
            "write",
          ),
      };

      const workspaceStartedAt = Date.now();
      const prepared = await prepareThemeSandboxWorkspace({
        session: measuredWriter,
        files: input.files,
        entry: input.entry,
        buildId: input.previewId,
        dependencies: input.dependencies,
        approvedDependencies: this.approvedDependencies,
        mode: "preview-server",
      });
      const workspaceMs = Date.now() - workspaceStartedAt;
      if (!prepared.ok) {
        await session.destroy();
        return {
          ok: false,
          stage: prepared.stage,
          errorMessage: prepared.errorMessage,
          logs,
        };
      }

      // Authorize the URL before the server exists, so a process that becomes
      // ready immediately still has somewhere to be reached.
      const exposePortStartedAt = Date.now();
      const exposed = await session.exposePort(THEME_PREVIEW_SERVER_PORT, {
        hostname: previewHost,
        name: "live-preview",
      });
      const exposePortMs = Date.now() - exposePortStartedAt;
      const previewUrl = withPreviewServerBase(exposed.url);

      const configureLifecycleStartedAt = Date.now();
      if (session.setSleepAfter) {
        await session.setSleepAfter(this.sleepAfter);
      }
      const configureLifecycleMs = Date.now() - configureLifecycleStartedAt;

      // Asking twice for the same preview must not start a second server.
      // The port is pinned, so a second one cannot bind it and would sit there
      // until the timeout — and tearing down on that timeout would take the
      // working one with it, which is how the first end-to-end run lost a
      // container that was serving perfectly well.
      const processLookupStartedAt = Date.now();
      const running = await session.listProcesses?.().catch(() => []);
      const processLookupMs = Date.now() - processLookupStartedAt;
      const alreadyServing = (running ?? []).find(
        (process) =>
          process.command?.includes(VITE_BIN) &&
          (process.status === "running" || process.status === "starting"),
      );
      if (alreadyServing) {
        const totalMs = Date.now() - requestStartedAt;
        return {
          ok: true,
          url: previewUrl,
          processId: alreadyServing.id,
          readyMs: 0,
          timings: {
            totalMs,
            sandboxHandleMs,
            workspaceMs,
            firstFilesystemCallMs,
            mkdirCalls,
            mkdirCumulativeMs,
            writeCalls,
            writeCumulativeMs,
            exposePortMs,
            configureLifecycleMs,
            processLookupMs,
            viteReadyMs: 0,
            reusedProcess: true,
          },
          hoistedContentFields: prepared.hoistedContentFields,
          warnings: prepared.previewWarnings,
          logs,
        };
      }

      const startedAt = Date.now();
      let resolveLogOrExit: (value: "ready" | "exited") => void;
      const logOrExit = new Promise<"ready" | "exited">((resolve) => {
        resolveLogOrExit = resolve;
      });

      const process = await session.startProcess(
        // --strictPort so the server cannot quietly land on another port and
        // leave the exposed URL pointing at nothing.
        `${VITE_BIN} --config ${prepared.workspaceRoot}/vite.config.ts --host 0.0.0.0 --port ${THEME_PREVIEW_SERVER_PORT} --strictPort`,
        {
          // Nothing from Morph's own environment. The preview holds no
          // credential, and its capability is the preview URL alone.
          env: { NODE_ENV: "development" },
          onOutput: (_stream, data) => {
            addLog(data);
            if (data.includes(READY_MARKER)) resolveLogOrExit("ready");
          },
          onExit: () => resolveLogOrExit("exited"),
        },
      );

      // The live Sandbox API does not guarantee that background-process
      // output callbacks are delivered while this Worker request is waiting.
      // The process object does provide a process-aware port check, which is
      // also the thing we actually need to know: can this Vite process serve
      // the page? Keep the output marker only for older providers and tests.
      const portReady = process.waitForPort
        ? process
            .waitForPort(THEME_PREVIEW_SERVER_PORT, {
              path: THEME_PREVIEW_SERVER_BASE_PATH,
            })
            .then(() => "ready" as const)
            .catch((error) => {
              addLog(
                error instanceof Error
                  ? error.message
                  : "Preview server port check failed.",
              );
              return "exited" as const;
            })
        : null;
      const outcome = await withReadyTimeout(
        portReady ? Promise.race([portReady, logOrExit]) : logOrExit,
        this.readyTimeoutMs,
      );
      if (outcome !== "ready") {
        await session.killProcess?.(process.id);
        await session.destroy();
        return {
          ok: false,
          stage: "preview-server-start",
          errorMessage:
            outcome === "timeout"
              ? `PREVIEW_SERVER_TIMEOUT: Vite did not report itself ready within ${this.readyTimeoutMs}ms.`
              : "PREVIEW_SERVER_EXITED: Vite exited before it was ready to serve.",
          logs,
        };
      }

      const viteReadyMs = Date.now() - startedAt;
      return {
        ok: true,
        url: previewUrl,
        processId: process.id,
        readyMs: viteReadyMs,
        timings: {
          totalMs: Date.now() - requestStartedAt,
          sandboxHandleMs,
          workspaceMs,
          firstFilesystemCallMs,
          mkdirCalls,
          mkdirCumulativeMs,
          writeCalls,
          writeCumulativeMs,
          exposePortMs,
          configureLifecycleMs,
          processLookupMs,
          viteReadyMs,
          reusedProcess: false,
        },
        hoistedContentFields: prepared.hoistedContentFields,
        warnings: prepared.previewWarnings,
        logs,
      };
    } catch (error) {
      await session?.destroy().catch(() => {});
      return {
        ok: false,
        stage: "preview-server-start",
        errorMessage:
          error instanceof Error ? error.message : "Failed to start preview",
        logs,
      };
    }
  }

  /**
   * Tears a preview down.
   *
   * Revokes the URL before killing the process, so the window where the URL
   * resolves to something no longer being supervised stays closed.
   */
  async stop(previewId: string, processId?: string): Promise<void> {
    const session = await this.acquire(previewId);
    await session.unexposePort?.(THEME_PREVIEW_SERVER_PORT).catch(() => {});
    await session.killProcess?.(processId).catch(() => {});
    await session.destroy();
  }
}
