import { describe, expect, it, vi } from "vitest";
import type { BuildPreviewArtifact } from "./build-preview-artifact";
import {
  BUILD_PREVIEW_CONTAINER_COMMAND,
  BUILD_PREVIEW_CONTAINER_PORT,
  CloudflareSandboxBuildPreviewServer,
  buildPreviewSandboxName,
  type BuildPreviewSandboxSession,
} from "./cloudflare-sandbox-build-preview-server";

/**
 * The container transport against a stand-in sandbox. What it proves is the
 * transport's side of the contract: the layout, the command, the environment
 * it gives the process, readiness, idempotence and what a request becomes.
 * Whether a real container then runs it is not provable here; that needs a
 * real container run, as the Live Preview's sandbox transport does.
 */

const encoder = new TextEncoder();
const artifact: BuildPreviewArtifact = {
  buildId: "build-1",
  storefrontId: "sf-1",
  themeId: "th-1",
  artifactPrefix: "builds/1/",
  plan: {} as never,
  workerConfig: { main: "index.js", assets: { directory: "../client" } },
  modules: [{ path: "index.js", bytes: encoder.encode("export default {}") }],
  assets: [{ path: "/assets/app.css", bytes: encoder.encode("body{}") }],
  headersFile: "/*\n  X-Test: 1\n",
};

function fakeSession(options: { ready?: boolean; running?: boolean } = {}) {
  let running = options.running ?? false;
  const written = new Map<string, { content: string; encoding?: string }>();
  const commands: string[] = [];
  const session = {
    exec: vi.fn(async (command: string) => {
      commands.push(command);
      return { success: true };
    }),
    writeFile: vi.fn(
      async (path: string, content: string, opts?: { encoding?: string }) => {
        written.set(path, { content, encoding: opts?.encoding });
      },
    ),
    startProcess: vi.fn(
      async (
        command: string,
        opts?: {
          env?: Record<string, string>;
          onOutput?: (stream: "stdout" | "stderr", data: string) => void;
          onExit?: (code: number | null) => void;
        },
      ) => {
        commands.push(command);
        queueMicrotask(() => {
          if (options.ready === false) {
            opts?.onOutput?.("stderr", "✘ [ERROR] could not start");
            opts?.onExit?.(1);
            return;
          }
          running = true;
          opts?.onOutput?.(
            "stdout",
            "[wrangler:info] Ready on http://0.0.0.0:8788",
          );
        });
        return { id: "p1" };
      },
    ),
    listProcesses: vi.fn(async () =>
      running
        ? [
            {
              id: "p1",
              command: BUILD_PREVIEW_CONTAINER_COMMAND,
              status: "running",
            },
          ]
        : [],
    ),
    containerFetch: vi.fn(async () => new Response("from-container")),
    setSleepAfter: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
  return { session, written, commands };
}

function server(session: BuildPreviewSandboxSession) {
  const getSandbox = vi.fn(async () => session);
  return {
    getSandbox,
    server: new CloudflareSandboxBuildPreviewServer({
      provider: { getSandbox },
      readyTimeoutMs: 1_000,
    }),
  };
}

const start = (target: CloudflareSandboxBuildPreviewServer) =>
  target.start({
    instanceId: "Cap-1",
    artifact,
    contentOrigin: "https://bp-x.preview.example.test",
  });

describe("the container Build Preview transport", () => {
  it("runs each capability in a container of its own", async () => {
    const { session } = fakeSession();
    const { server: target, getSandbox } = server(session as never);
    await start(target);
    expect(getSandbox).toHaveBeenCalledWith("bp-cap-1");
    expect(buildPreviewSandboxName("Cap-1")).toBe("bp-cap-1");
  });

  it("lays the build out as a deployment does and runs it with wrangler", async () => {
    const { session, written, commands } = fakeSession();
    const { server: target } = server(session as never);
    await start(target);
    expect([...written.keys()].sort()).toEqual([
      "/workspace/build-preview/client/_headers",
      "/workspace/build-preview/client/assets/app.css",
      "/workspace/build-preview/server/index.js",
      "/workspace/build-preview/server/wrangler.json",
    ]);
    expect(
      [...written.values()].every((file) => file.encoding === "base64"),
    ).toBe(true);
    expect(
      atob(written.get("/workspace/build-preview/server/index.js")!.content),
    ).toBe("export default {}");
    expect(commands.at(-1)).toBe(
      `wrangler dev --config /workspace/build-preview/server/wrangler.json --ip 0.0.0.0 --port ${BUILD_PREVIEW_CONTAINER_PORT} --show-interactive-dev-session=false`,
    );
    expect(session.setSleepAfter).toHaveBeenCalledWith("10m");
  });

  it("gives the process nothing of Morph's environment", async () => {
    const { session } = fakeSession();
    const { server: target } = server(session as never);
    await start(target);
    const env = session.startProcess.mock.calls[0]?.[1]?.env;
    expect(env).toEqual({
      WRANGLER_SEND_METRICS: "false",
      NODE_ENV: "production",
    });
  });

  it("does not start twice", async () => {
    const { session } = fakeSession({ running: true });
    const { server: target } = server(session as never);
    await start(target);
    expect(session.startProcess).not.toHaveBeenCalled();
  });

  it("reports a process that exits before it is ready", async () => {
    const { session } = fakeSession({ ready: false });
    const { server: target } = server(session as never);
    await expect(start(target)).rejects.toThrow(
      /BUILD_PREVIEW_CONTAINER_EXITED: 1: .*could not start/,
    );
  });

  it("refuses a file path that could leave its directory", async () => {
    const { session } = fakeSession();
    const { server: target } = server(session as never);
    await expect(
      target.start({
        instanceId: "cap-1",
        artifact: {
          ...artifact,
          assets: [{ path: "/../../etc/x", bytes: encoder.encode("") }],
        },
        contentOrigin: "https://bp-x.preview.example.test",
      }),
    ).rejects.toThrow("BUILD_PREVIEW_PATH_UNSAFE");
    expect(session.writeFile).not.toHaveBeenCalled();
  });

  it("answers a request from the container only while it runs", async () => {
    const { session } = fakeSession();
    const { server: target } = server(session as never);
    const request = new Request("https://bp-x.preview.example.test/");
    expect(await target.fetch("cap-1", request)).toBeNull();
    await start(target);
    const response = await target.fetch("cap-1", request);
    expect(await response?.text()).toBe("from-container");
    expect(session.containerFetch).toHaveBeenCalledWith(
      request,
      BUILD_PREVIEW_CONTAINER_PORT,
    );
  });

  it("stops by destroying the container", async () => {
    const { session } = fakeSession();
    const { server: target } = server(session as never);
    await target.stop("cap-1");
    expect(session.destroy).toHaveBeenCalled();
  });
});
