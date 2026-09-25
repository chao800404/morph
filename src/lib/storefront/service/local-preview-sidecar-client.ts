import type {
  StartPreviewServerInput,
  StartPreviewServerResult,
  ThemePreviewServer,
} from "@/lib/storefront/compiler/theme-preview-server.types";
import {
  LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER,
  localPreviewSidecarPath,
  type LocalPreviewSidecarApplyFilesRequest,
  type LocalPreviewSidecarApplyFilesResult,
  type LocalPreviewSidecarOperation,
  type LocalPreviewSidecarOperations,
} from "./local-preview-sidecar.protocol";

/**
 * The Worker's half of the local preview sidecar.
 *
 * A second implementation of `ThemePreviewServer` from the Worker's point of
 * view, and the third overall: the sandbox speaks to a container binding, the
 * Node sidecar serves, and this is what reaches it. It carries no logic about
 * Themes — it serializes the operation the caller asked for and hands back what
 * came out, so nothing here can disagree with the sidecar about what a start
 * means.
 *
 * Two things it does decide, both about failing safely:
 *
 * - **A start that cannot be delivered is a failed start**, reported in the same
 *   shape the sandbox transport reports failures in, so no caller has to learn a
 *   second error protocol.
 * - **A question that cannot be answered is `false`.** `isServing` is asked on a
 *   timer while an author is looking at a preview; "the sidecar is gone" and
 *   "I could not ask" are the same answer to the only decision that follows.
 */

export type LocalPreviewSidecarClientOptions = Readonly<{
  /** Loopback origin the sidecar listens on, for example `http://127.0.0.1:5199`. */
  origin: string;
  /** The token the sidecar was started with. */
  token: string;
  /** How long to wait for the sidecar to answer. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}>;

export class LocalPreviewSidecarClient implements ThemePreviewServer {
  private readonly origin: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LocalPreviewSidecarClientOptions) {
    this.origin = options.origin.replace(/\/+$/, "");
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 240_000;
    // Bound, not just referenced. workerd's `fetch` refuses to run with any
    // other receiver — storing it on an instance and calling it as
    // `this.fetchImpl(...)` throws "Illegal invocation" before a request is
    // ever sent, so the sidecar sees nothing and the editor reports it as
    // unreachable. Node does not care, which is why every test of this class
    // passed while the editor could not start a preview at all.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async call<K extends LocalPreviewSidecarOperation>(
    operation: K,
    body: LocalPreviewSidecarOperations[K]["request"],
  ): Promise<
    | { ok: true; result: LocalPreviewSidecarOperations[K]["response"] }
    | { ok: false; reason: string }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.origin}${localPreviewSidecarPath(operation)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: this.token,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        // The sidecar's own refusal text is safe to surface: it is platform
        // wording about the request, never Theme source or a filesystem path
        // out of the workspace.
        const detail = await response.text().catch(() => "");
        return {
          ok: false,
          reason: `LOCAL_PREVIEW_SIDECAR_${response.status}: ${
            detail.slice(0, 400) || response.statusText
          }`,
        };
      }
      return {
        ok: true,
        result: (await response.json()) as LocalPreviewSidecarOperations[K]["response"],
      };
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error && error.name === "AbortError"
            ? `LOCAL_PREVIEW_SIDECAR_TIMEOUT: The local preview sidecar did not answer within ${this.timeoutMs}ms.`
            : `LOCAL_PREVIEW_SIDECAR_UNREACHABLE: ${
                error instanceof Error ? error.message : String(error)
              }`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async start(
    input: StartPreviewServerInput,
  ): Promise<StartPreviewServerResult> {
    // A start is sent as JSON, where bytes do not survive and a loader does
    // not exist. Until the sidecar takes binary files its own way, a Theme
    // holding one is refused here, by name, rather than started without them.
    const binary = input.files.filter((file) => "binary" in file);
    if (binary.length > 0) {
      return {
        ok: false,
        stage: "preview-sidecar",
        errorMessage: `The local preview cannot serve binary files yet (${binary
          .slice(0, 3)
          .map((file) => file.path)
          .join(", ")}${binary.length > 3 ? ", …" : ""}).`,
        logs: [],
      };
    }
    const { loadBinary: _loadBinary, ...serialisable } = input;
    const call = await this.call("start", serialisable);
    if (call.ok) return call.result;
    return {
      ok: false,
      stage: "preview-sidecar",
      errorMessage: call.reason,
      logs: [],
    };
  }

  async isServing(input: {
    previewId: string;
    previewHostname: string;
    expectedOrigin?: string | null;
  }): Promise<boolean> {
    const call = await this.call("isServing", input);
    return call.ok && call.result.serving;
  }

  async stop(previewId: string, processId?: string): Promise<void> {
    const call = await this.call("stop", { previewId, processId });
    // Thrown rather than swallowed: the server function that calls this treats
    // a failed stop as not worth telling the author about, but that decision
    // belongs to the caller, not to the transport.
    if (!call.ok) throw new Error(call.reason);
  }

  /**
   * Writes edited files into the workspace the sidecar is serving.
   *
   * The capability the contract does not carry, and the one place the sandbox
   * path reaches past its transport: there, the server function holds the
   * container binding and writes into it directly. Here the filesystem is on
   * the other side of a process boundary, so it has to be asked.
   */
  async applyFiles(
    request: LocalPreviewSidecarApplyFilesRequest,
  ): Promise<LocalPreviewSidecarApplyFilesResult> {
    const call = await this.call("applyFiles", request);
    if (!call.ok) throw new Error(call.reason);
    return call.result;
  }
}
