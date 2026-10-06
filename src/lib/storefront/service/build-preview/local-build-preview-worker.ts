import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { unstable_startWorker } from "wrangler";
import type { BuildPreviewArtifact } from "./build-preview-artifact";

/**
 * Runs one build's Worker for Build Preview, on this machine.
 *
 * The local counterpart of the isolated preview container: one instance per
 * build, never the Live Preview's process, started from the files
 * `readBuildPreviewArtifact` verified and laid out the way the release deployer
 * lays them out (`server/` with the plan's Worker config, `client/` with the
 * assets and the platform `_headers`). Node only — workerd cannot spawn it —
 * so it belongs to a local helper process, never to the deployed Worker.
 *
 * What the Worker gets:
 * - no environment of the process that starts it and no Morph credential: the
 *   Worker's env is only what the plan's config declares, which is no binding
 *   and no variable;
 * - no network, except `allowedOrigins` (the Core origin that answers its
 *   frozen content); everything else is answered with 403
 *   `PREVIEW_EGRESS_DENIED` by the runtime's outbound service;
 * - a lifetime: it stops itself after `idleMs` without `touch()`.
 */

export const BUILD_PREVIEW_EGRESS_DENIED = "PREVIEW_EGRESS_DENIED";
const DEFAULT_IDLE_MS = 10 * 60_000;

export type LocalBuildPreviewWorker = Readonly<{
  buildId: string;
  /** `http://127.0.0.1:<port>`; the Worker answers at the root. */
  origin: string;
  /** Keeps the instance alive for another idle period. */
  touch(): void;
  dispose(): Promise<void>;
  /** Resolves once the instance has stopped, for whatever reason. */
  stopped: Promise<void>;
}>;

type OutboundRequest = {
  url: string;
  method: string;
  headers: Iterable<[string, string]>;
  body: ReadableStream<Uint8Array> | null;
};
type OutboundService = (
  request: OutboundRequest,
) => Response | Promise<Response>;

/**
 * Forwards an allowed request. The runtime hands over its own Request class,
 * which this process's `fetch` does not accept, so it is rebuilt from its parts.
 */
function forward(request: OutboundRequest): Promise<Response> {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return fetch(request.url, {
    method: request.method,
    headers: [...request.headers],
    redirect: "manual",
    ...(hasBody && request.body ? { body: request.body, duplex: "half" } : {}),
  } as RequestInit);
}

export function buildPreviewOutboundService(
  allowedOrigins: readonly string[],
): OutboundService {
  const allowed = new Set(
    allowedOrigins.map((origin) => new URL(origin).origin),
  );
  return (request) => {
    let origin: string;
    try {
      origin = new URL(request.url).origin;
    } catch {
      origin = "";
    }
    if (allowed.has(origin)) return forward(request);
    return new Response(
      `${BUILD_PREVIEW_EGRESS_DENIED}: Build Preview does not allow requests to ${origin || "this address"}.`,
      { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  };
}

async function writeFiles(
  root: string,
  files: readonly { path: string; bytes: Uint8Array | string }[],
) {
  for (const file of files) {
    const target = join(root, file.path.replace(/^\/+/, ""));
    if (!target.startsWith(`${root}/`) && target !== root) {
      throw new Error(`BUILD_PREVIEW_PATH_ESCAPE: "${file.path}"`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
}

export async function startLocalBuildPreviewWorker(
  artifact: BuildPreviewArtifact,
  options: {
    /** Origins the Worker may reach, e.g. Core's, for `/_morph/content`. */
    allowedOrigins?: readonly string[];
    idleMs?: number;
  } = {},
): Promise<LocalBuildPreviewWorker> {
  const root = await mkdtemp(
    join(tmpdir(), `build-preview-${artifact.buildId}-`),
  );
  const serverDir = join(root, "server");
  const clientDir = join(root, "client");
  let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;
  try {
    await writeFiles(
      serverDir,
      artifact.modules.map((module) => ({
        path: module.path,
        bytes: module.bytes,
      })),
    );
    await writeFiles(serverDir, [
      {
        path: "wrangler.json",
        bytes: `${JSON.stringify(artifact.workerConfig, null, 2)}\n`,
      },
    ]);
    await writeFiles(clientDir, [
      ...artifact.assets.map((asset) => ({
        path: asset.path,
        bytes: asset.bytes,
      })),
      { path: "_headers", bytes: artifact.headersFile },
    ]);

    worker = await unstable_startWorker({
      config: join(serverDir, "wrangler.json"),
      dev: {
        server: { hostname: "127.0.0.1", port: 0 },
        inspector: false,
        logLevel: "error",
        // Passed through to the runtime; not part of Wrangler's public types.
        outboundService: buildPreviewOutboundService(
          options.allowedOrigins ?? [],
        ),
      },
    } as Parameters<typeof unstable_startWorker>[0]);
    await worker.ready;
  } catch (error) {
    await worker?.dispose().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  const running = worker;
  const origin = new URL(await running.url).origin;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => (resolveStopped = resolve));
  let disposed = false;
  const dispose = async () => {
    if (disposed) return stopped;
    disposed = true;
    clearTimeout(timer);
    try {
      await running.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
      resolveStopped();
    }
  };
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  let timer = setTimeout(() => void dispose(), idleMs);
  timer.unref?.();

  return {
    buildId: artifact.buildId,
    origin,
    touch() {
      if (disposed) return;
      clearTimeout(timer);
      timer = setTimeout(() => void dispose(), idleMs);
      timer.unref?.();
    },
    dispose,
    stopped,
  };
}
