import {
  prepareThemeSandboxWorkspace,
  type ThemeWorkspaceFile,
  type ThemeWorkspaceWriter,
} from "./theme-sandbox-workspace";
import { SANDBOX_TOOLCHAIN_ROOT } from "./theme-preview-dev-server";
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

/**
 * Line Vite prints once it can serve requests.
 *
 * Readiness is read from the server's own output rather than by polling the
 * exposed URL: a poll cannot tell "not started yet" apart from "started and
 * broken", and the second needs the logs anyway.
 */
const READY_MARKER = "ready in";

export type PreviewServerProcess = Readonly<{ id?: string }>;

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
      /** Modules whose `contentFields` export was lifted for Fast Refresh. */
      hoistedContentFields: readonly string[];
      logs: readonly string[];
    }>
  | Readonly<{
      ok: false;
      stage: string;
      errorMessage: string;
      logs: readonly string[];
    }>;

export type CloudflareSandboxVitePreviewServerOptions = Readonly<{
  sandboxBinding?: unknown;
  sandboxProvider?: PreviewServerProvider;
  approvedDependencies?: readonly string[];
  /** How long to wait for Vite to report itself ready. */
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
    this.readyTimeoutMs = options.readyTimeoutMs ?? 60_000;
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
      session = await this.acquire(input.previewId);

      const prepared = await prepareThemeSandboxWorkspace({
        session,
        files: input.files,
        entry: input.entry,
        buildId: input.previewId,
        dependencies: input.dependencies,
        approvedDependencies: this.approvedDependencies,
        mode: "preview-server",
      });
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
      const exposed = await session.exposePort(THEME_PREVIEW_SERVER_PORT, {
        hostname: previewHost,
        name: "live-preview",
      });

      if (session.setSleepAfter) {
        await session.setSleepAfter(this.sleepAfter);
      }

      const startedAt = Date.now();
      let resolveReady: (value: "ready" | "exited") => void;
      const ready = new Promise<"ready" | "exited" | "timeout">((resolve) => {
        resolveReady = resolve;
        setTimeout(() => resolve("timeout"), this.readyTimeoutMs);
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
            if (data.includes(READY_MARKER)) resolveReady("ready");
          },
          onExit: () => resolveReady("exited"),
        },
      );

      const outcome = await ready;
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

      return {
        ok: true,
        url: exposed.url,
        processId: process.id,
        readyMs: Date.now() - startedAt,
        hoistedContentFields: prepared.hoistedContentFields,
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
