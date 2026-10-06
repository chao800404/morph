import type { BuildPreviewInstanceStart } from "./build-preview-server.types";
import { isHopHeader } from "./build-preview-wire";
import {
  startLocalBuildPreviewWorker,
  type LocalBuildPreviewWorker,
} from "./local-build-preview-worker";

/**
 * The Build Preview instances one local helper process runs.
 *
 * The sidecar's half of the local `BuildPreviewServer` transport: it keeps the
 * running instances by id, starts each at most once at a time, forgets one as
 * soon as it stops (idle or disposed), and answers requests for it. Node only,
 * like `local-build-preview-worker.ts`, and guarded out of the deploy artifact
 * the same way (marker `BUILD_PREVIEW_EXECUTOR_BAD_PATH`).
 */

export type LocalBuildPreviewRequest = Readonly<{
  method: string;
  /** Path and query, starting with `/`. */
  path: string;
  headers: readonly (readonly [string, string])[];
  body: Uint8Array | null;
}>;

const PATH = /^\/(?!\/)/;

export class LocalBuildPreviewExecutor {
  private readonly instances = new Map<
    string,
    Promise<LocalBuildPreviewWorker>
  >();

  constructor(private readonly options: Readonly<{ idleMs?: number }> = {}) {}

  async start(input: BuildPreviewInstanceStart): Promise<void> {
    if (this.instances.has(input.instanceId)) {
      await this.instances.get(input.instanceId);
      return;
    }
    const starting = startLocalBuildPreviewWorker(input.artifact, {
      allowedOrigins: [
        input.contentUpstream
          ? { origin: input.contentOrigin, upstream: input.contentUpstream }
          : input.contentOrigin,
      ],
      idleMs: this.options.idleMs,
    });
    this.instances.set(input.instanceId, starting);
    let worker: LocalBuildPreviewWorker;
    try {
      worker = await starting;
    } catch (error) {
      if (this.instances.get(input.instanceId) === starting) {
        this.instances.delete(input.instanceId);
      }
      throw error;
    }
    void worker.stopped.then(() => {
      if (this.instances.get(input.instanceId) === starting) {
        this.instances.delete(input.instanceId);
      }
    });
  }

  /** The instance's response, or null when it has no running instance. */
  async fetch(
    instanceId: string,
    request: LocalBuildPreviewRequest,
  ): Promise<Response | null> {
    if (!PATH.test(request.path)) {
      throw new Error(
        `BUILD_PREVIEW_EXECUTOR_BAD_PATH: "${request.path}" is not a path.`,
      );
    }
    const pending = this.instances.get(instanceId);
    if (!pending) return null;
    let worker: LocalBuildPreviewWorker;
    try {
      worker = await pending;
    } catch {
      return null;
    }
    worker.touch();
    const hasBody =
      request.method !== "GET" && request.method !== "HEAD" && request.body;
    return fetch(new URL(request.path, worker.origin), {
      method: request.method,
      headers: request.headers
        .filter(([name]) => !isHopHeader(name))
        .map(([name, value]) => [name, value]),
      redirect: "manual",
      ...(hasBody ? { body: request.body } : {}),
    } as RequestInit);
  }

  async stop(instanceId: string): Promise<void> {
    const pending = this.instances.get(instanceId);
    this.instances.delete(instanceId);
    const worker = await pending?.catch(() => null);
    await worker?.dispose();
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.instances.keys()].map((instanceId) => this.stop(instanceId)),
    );
  }
}
