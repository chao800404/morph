import {
  LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER,
  localPreviewSidecarPath,
  type LocalPreviewSidecarOperation,
} from "../local-preview-sidecar.protocol";
import type {
  BuildPreviewInstanceStart,
  BuildPreviewServer,
} from "./build-preview-server.types";
import {
  BUILD_PREVIEW_EXECUTOR_ANSWERED,
  BUILD_PREVIEW_EXECUTOR_HEADER,
  BUILD_PREVIEW_EXECUTOR_NOT_RUNNING,
  bytesToBase64,
  encodeBuildPreviewStart,
  isHopHeader,
  type BuildPreviewFetchWire,
} from "./build-preview-wire";

/**
 * The local `BuildPreviewServer` transport, from the Worker's side: every
 * operation is a request to the operator-started helper process, which runs
 * the instances (`local-build-preview-executor.ts`). The same process, origin
 * and token as the Live Preview's local transport.
 */
export class LocalBuildPreviewServerClient implements BuildPreviewServer {
  readonly kind = "local-sidecar" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: Readonly<{
      origin: string;
      token: string;
      fetchImpl?: typeof fetch;
      startTimeoutMs?: number;
      fetchTimeoutMs?: number;
    }>,
  ) {
    // Bound for the same reason as the Live Preview client: workerd's fetch
    // throws "Illegal invocation" when called on another receiver.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async post(
    operation: LocalPreviewSidecarOperation,
    body: unknown,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(
        `${this.options.origin}${localPreviewSidecarPath(operation)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: this.options.token,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async expectOk(response: Response, operation: string) {
    if (response.ok) return;
    const detail = await response.text().catch(() => "");
    throw new Error(
      `BUILD_PREVIEW_EXECUTOR_${response.status}: ${operation} failed${
        detail ? `: ${detail.slice(0, 400)}` : ""
      }`,
    );
  }

  async start(input: BuildPreviewInstanceStart): Promise<void> {
    const response = await this.post(
      "buildPreviewStart",
      encodeBuildPreviewStart(input),
      this.options.startTimeoutMs ?? 60_000,
    );
    await this.expectOk(response, "start");
  }

  async fetch(instanceId: string, request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const wire: BuildPreviewFetchWire = {
      instanceId,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: [...request.headers].filter(([name]) => !isHopHeader(name)),
      body: hasBody
        ? bytesToBase64(new Uint8Array(await request.arrayBuffer()))
        : null,
    };
    const response = await this.post(
      "buildPreviewFetch",
      wire,
      this.options.fetchTimeoutMs ?? 30_000,
    );
    const marker = response.headers.get(BUILD_PREVIEW_EXECUTOR_HEADER);
    if (marker === BUILD_PREVIEW_EXECUTOR_NOT_RUNNING) {
      await response.body?.cancel();
      return null;
    }
    if (marker !== BUILD_PREVIEW_EXECUTOR_ANSWERED) {
      // The helper itself refused (token, size, a crash), not the instance.
      await this.expectOk(response, "fetch");
      throw new Error(
        "BUILD_PREVIEW_EXECUTOR_UNMARKED: fetch answer had no marker.",
      );
    }
    const headers = new Headers();
    response.headers.forEach((value, name) => {
      if (name === "set-cookie" || isHopHeader(name)) return;
      if (name === BUILD_PREVIEW_EXECUTOR_HEADER) return;
      headers.append(name, value);
    });
    for (const cookie of response.headers.getSetCookie()) {
      headers.append("set-cookie", cookie);
    }
    const nullBody = [101, 204, 205, 304].includes(response.status);
    return new Response(nullBody ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  async stop(instanceId: string): Promise<void> {
    const response = await this.post(
      "buildPreviewStop",
      { instanceId },
      this.options.fetchTimeoutMs ?? 30_000,
    );
    await this.expectOk(response, "stop");
  }
}
