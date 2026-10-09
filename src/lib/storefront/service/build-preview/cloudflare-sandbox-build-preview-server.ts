import {
  BuildPreviewInstanceUnavailableError,
  type BuildPreviewInstanceStart,
  type BuildPreviewServer,
} from "./build-preview-server.types";
import { bytesToBase64 } from "./build-preview-wire";
import { SANDBOX_PLATFORM_WRANGLER_BIN } from "@/lib/storefront/theme-framework/theme-toolchains";

/**
 * The container `BuildPreviewServer` transport.
 *
 * One container per capability, under `BuildPreviewSandbox` (never the Live
 * Preview's class or the build class), named `bp-<capability id>`. The build's
 * files are laid out the way the release deployer lays them out and run with
 * the `wrangler` already in the image, so the Worker answers exactly as a
 * deployment of the same files would. Nothing of Morph's environment is
 * passed to the process; the container has no internet, and its one reachable
 * thing — its own content — is answered by its class's outbound policy
 * (`build-preview-egress.ts`). It sleeps after `sleepAfter` without a
 * request, and the next request starts it again through Core.
 */

export const BUILD_PREVIEW_CONTAINER_PORT = 8788;
const ROOT = "/workspace/build-preview";
const READY_MARKER = "Ready on";
const SAFE_PATH = /^[A-Za-z0-9._@/-]+$/;

export function buildPreviewSandboxName(instanceId: string): string {
  return `bp-${instanceId}`.toLowerCase();
}

/** The sandbox surface this transport uses. */
export type BuildPreviewSandboxSession = Readonly<{
  exec(command: string): Promise<{ success: boolean; stderr?: string }>;
  writeFile(
    path: string,
    content: string,
    options?: { encoding?: string },
  ): Promise<unknown>;
  startProcess(
    command: string,
    options?: {
      env?: Record<string, string>;
      onOutput?: (stream: "stdout" | "stderr", data: string) => void;
      onExit?: (code: number | null) => void;
    },
  ): Promise<{
    id?: string;
    /** The SDK's process-aware readiness check, from inside the container. */
    waitForPort?(
      port: number,
      options?: { mode?: "tcp" | "http"; timeout?: number },
    ): Promise<void>;
  }>;
  getProcessLogs?(
    processId: string,
  ): Promise<{ stdout?: string; stderr?: string }>;
  killProcess?(processId: string): Promise<void>;
  listProcesses(): Promise<
    ReadonlyArray<{ id?: string; command?: string; status?: string }>
  >;
  containerFetch(request: Request, port: number): Promise<Response>;
  setSleepAfter?(value: string | number): Promise<void>;
  destroy(): Promise<void>;
}>;

export type BuildPreviewSandboxProvider = Readonly<{
  getSandbox(name: string): Promise<BuildPreviewSandboxSession>;
}>;

function safePath(path: string): string {
  const relative = path.replace(/^\/+/, "");
  if (
    !SAFE_PATH.test(relative) ||
    relative.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`BUILD_PREVIEW_PATH_UNSAFE: "${path}"`);
  }
  return relative;
}

function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

// The platform's Wrangler, by its absolute path: never a Theme toolchain's,
// and not whatever `wrangler` the PATH would find.
export const BUILD_PREVIEW_CONTAINER_COMMAND = `${SANDBOX_PLATFORM_WRANGLER_BIN} dev --config ${ROOT}/server/wrangler.json --ip 0.0.0.0 --port ${BUILD_PREVIEW_CONTAINER_PORT} --show-interactive-dev-session=false`;

export class CloudflareSandboxBuildPreviewServer implements BuildPreviewServer {
  readonly kind = "cloudflare-sandbox" as const;

  constructor(
    private readonly options: Readonly<{
      provider: BuildPreviewSandboxProvider;
      readyTimeoutMs?: number;
      sleepAfter?: string;
      /** Before asking a container that failed to start a second time. */
      startRetryDelayMs?: number;
    }>,
  ) {}

  private session(instanceId: string) {
    return this.options.provider.getSandbox(
      buildPreviewSandboxName(instanceId),
    );
  }

  /**
   * The first call to reach the container, so the one that starts it. The
   * platform's start can fail transiently — a local run saw "Container failed
   * to start" three seconds in, and the very next request started the same
   * container without trouble — so it is asked once more before the request
   * is told the instance is unavailable. Listing is a read; asking twice
   * changes nothing.
   */
  private async listProcesses(session: BuildPreviewSandboxSession) {
    try {
      return await session.listProcesses();
    } catch {
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.startRetryDelayMs ?? 1_000),
      );
    }
    try {
      return await session.listProcesses();
    } catch (error) {
      throw new BuildPreviewInstanceUnavailableError(
        `BUILD_PREVIEW_CONTAINER_UNAVAILABLE: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }

  private async running(session: BuildPreviewSandboxSession) {
    const processes = await this.listProcesses(session);
    return processes.some(
      (process) =>
        process.command === BUILD_PREVIEW_CONTAINER_COMMAND &&
        (process.status === "running" || process.status === "starting"),
    );
  }

  async start(input: BuildPreviewInstanceStart): Promise<void> {
    const session = await this.session(input.instanceId);
    if (await this.running(session)) return;

    const files = [
      ...input.artifact.modules.map((file) => ({
        path: `server/${safePath(file.path)}`,
        base64: bytesToBase64(file.bytes),
      })),
      {
        path: "server/wrangler.json",
        base64: bytesToBase64(
          new TextEncoder().encode(
            `${JSON.stringify(input.artifact.workerConfig, null, 2)}\n`,
          ),
        ),
      },
      ...input.artifact.assets.map((file) => ({
        path: `client/${safePath(file.path)}`,
        base64: bytesToBase64(file.bytes),
      })),
      {
        path: "client/_headers",
        base64: bytesToBase64(
          new TextEncoder().encode(input.artifact.headersFile),
        ),
      },
    ];
    const directories = [
      ...new Set(files.map((file) => `${ROOT}/${dirname(file.path)}`)),
    ];
    const prepared = await session.exec(
      `rm -rf ${ROOT} && mkdir -p ${directories.map((dir) => `'${dir}'`).join(" ")}`,
    );
    if (!prepared.success) {
      throw new Error(
        `BUILD_PREVIEW_CONTAINER_PREPARE: ${prepared.stderr ?? "mkdir failed"}`,
      );
    }
    for (const file of files) {
      await session.writeFile(`${ROOT}/${file.path}`, file.base64, {
        encoding: "base64",
      });
    }

    let output = "";
    let settle!: (outcome: "ready" | Error) => void;
    const outcome = new Promise<"ready" | Error>((resolve) => {
      settle = resolve;
    });
    const timeoutMs = this.options.readyTimeoutMs ?? 60_000;
    const timer = setTimeout(
      () => settle(new Error("BUILD_PREVIEW_CONTAINER_TIMEOUT")),
      timeoutMs,
    );
    let processId: string | undefined;
    try {
      const process = await session.startProcess(
        BUILD_PREVIEW_CONTAINER_COMMAND,
        {
          // Nothing of Morph's environment: no credential, no binding.
          env: { WRANGLER_SEND_METRICS: "false", NODE_ENV: "production" },
          onOutput: (_stream, data) => {
            output = `${output}${data}`.slice(-4_000);
            if (output.includes(READY_MARKER)) settle("ready");
          },
          onExit: (code) =>
            settle(new Error(`BUILD_PREVIEW_CONTAINER_EXITED: ${code}`)),
        },
      );
      processId = process.id;
      // Readiness by the port, not by the log: a real container does not
      // promise to deliver a background process's output while this request
      // waits (the Live Preview transport found the same), so the first real
      // run waited out its timeout with an empty log. TCP only — an HTTP
      // probe would run the Theme's own code.
      void process
        .waitForPort?.(BUILD_PREVIEW_CONTAINER_PORT, {
          mode: "tcp",
          timeout: timeoutMs,
        })
        .then(
          () => settle("ready"),
          (error: unknown) =>
            settle(
              error instanceof Error
                ? error
                : new Error("BUILD_PREVIEW_CONTAINER_PORT"),
            ),
        );
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }
    const result = await outcome;
    clearTimeout(timer);
    if (result !== "ready") {
      // What the process itself said, read back rather than relied on from
      // the callback, so a failure here names its cause.
      const logs = processId
        ? await session.getProcessLogs?.(processId).catch(() => null)
        : null;
      const said =
        `${logs?.stdout ?? ""}${logs?.stderr ?? ""}`.trim() || output.trim();
      if (processId) await session.killProcess?.(processId).catch(() => {});
      throw new Error(
        `${result.message}${said ? `: ${said.slice(-600)}` : ""}`,
      );
    }
    await session.setSleepAfter?.(this.options.sleepAfter ?? "10m");
  }

  async fetch(instanceId: string, request: Request): Promise<Response | null> {
    const session = await this.session(instanceId);
    if (!(await this.running(session))) return null;
    return session.containerFetch(request, BUILD_PREVIEW_CONTAINER_PORT);
  }

  async stop(instanceId: string): Promise<void> {
    const session = await this.session(instanceId);
    await session.destroy();
  }
}
