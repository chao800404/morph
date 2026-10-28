import type { PreviewContentWriteResult } from "@/lib/storefront/compiler/preview-content-write";
import type {
  StartPreviewServerInput,
  StartPreviewServerResult,
  ThemePreviewServer,
} from "@/lib/storefront/compiler/theme-preview-server.types";
import {
  LOCAL_PREVIEW_SIDECAR_DIGEST_HEADER,
  LOCAL_PREVIEW_SIDECAR_PREVIEW_ID_HEADER,
  LOCAL_PREVIEW_SIDECAR_REQUEST_ID_HEADER,
  LOCAL_PREVIEW_SIDECAR_SIZE_HEADER,
  LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER,
  localPreviewSidecarPath,
  type LocalPreviewSidecarApplyFilesRequest,
  type LocalPreviewSidecarWriteContentRequest,
  type LocalPreviewSidecarApplyFilesResult,
  type LocalPreviewSidecarOperation,
  type LocalPreviewSidecarOperations,
} from "./local-preview-sidecar.protocol";
import { pickPlatformHostnameEnv } from "./storefront-request-routing";
import {
  parsePreviewServedInstance,
  type PreviewServedInstance,
} from "@/lib/storefront/editor/preview-protocol";

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
  /** Where a failed request is recorded; defaults to `console.error`. */
  log?: (line: string) => void;
}>;

export const LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX = "[sidecar-client]";

/**
 * What a failed request leaves behind: no header, no body, no token, and none
 * of the sidecar's free text, which can name Theme files and workspace paths.
 */
type SidecarRequestFailure = Readonly<{
  requestId: string;
  operation: string;
  previewId: string | null;
  startedAt: number;
  outcome: "unreachable" | "timeout" | "http";
  /** `request` until a status arrived; `response` while reading the body. */
  phase: "request" | "response";
  status: number | null;
  /** The sidecar's leading error code, for a refusal. */
  errorCode?: string | null;
  /** The thrown error, for a request that got no usable answer. */
  error?: unknown;
}>;

/** `LOCAL_PREVIEW_SIDECAR_FOO` out of a refusal body, and nothing after it. */
function leadingErrorCode(detail: string): string | null {
  let text = detail;
  try {
    const parsed = JSON.parse(detail) as { error?: unknown };
    if (typeof parsed?.error === "string") text = parsed.error;
  } catch {
    /* Not JSON: read the text as it is. */
  }
  return /^[A-Z][A-Z0-9_]{2,80}(?![A-Za-z0-9_])/.exec(text.trim())?.[0] ?? null;
}

/**
 * The transport messages a failure record may repeat, as they are.
 *
 * A list of known wordings rather than a filter: a runtime is free to put a
 * URL, a path or a piece of a response into a message, and no pattern that
 * strips those can be shown to catch every spelling of them. Anything else
 * is recorded by its length only.
 */
const SAFE_TRANSPORT_MESSAGES: readonly RegExp[] = [
  /^Network connection lost\.?$/,
  /^fetch failed$/,
  /^socket hang up$/,
  /^other side closed$/,
  /^terminated$/,
  /^(?:The|This) operation was aborted\.?$/,
  /^internal error; reference = [a-z0-9]{1,40}$/,
  /^(?:connect |read |write )?E[A-Z]{2,20} (?:\d{1,3}(?:\.\d{1,3}){3}|::1|\[::1\]):\d{1,5}$/,
  /^(?:connect |read |write )?E[A-Z]{2,20}$/,
];

/** The message if it is one of the known wordings, else null. */
export function safeTransportMessage(message: string): string | null {
  // Bounded before any pattern runs, so a long message costs nothing.
  if (message.length > 120) return null;
  return SAFE_TRANSPORT_MESSAGES.some((pattern) => pattern.test(message))
    ? message
    : null;
}

/** An error `code` such as `ECONNRESET`, from the error or its `cause`. */
function errorCodeOf(error: Error): string | null {
  for (const candidate of [
    (error as { code?: unknown }).code,
    (error.cause as { code?: unknown } | undefined)?.code,
  ]) {
    if (typeof candidate === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * A thrown error, as far as it is the transport's own wording: its class
 * name, its code, and its message only when that is a known wording. A body
 * that would not parse never qualifies: the parser's message quotes it.
 */
function describeThrown(error: unknown): {
  name: string;
  code: string | null;
  message: string | null;
  messageLength: number | null;
} {
  if (!(error instanceof Error)) {
    return { name: typeof error, code: null, message: null, messageLength: null };
  }
  const message = error.name === "SyntaxError" ? null : safeTransportMessage(error.message);
  return {
    // A class name, or nothing: a name is as free to hold text as a message.
    name: /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : "Error",
    code: errorCodeOf(error),
    message,
    messageLength: message === null ? error.message.length : null,
  };
}

export class LocalPreviewSidecarClient implements ThemePreviewServer {
  private readonly origin: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (line: string) => void;

  constructor(options: LocalPreviewSidecarClientOptions) {
    this.origin = options.origin.replace(/\/+$/, "");
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 240_000;
    this.log = options.log ?? ((line) => console.error(line));
    // Bound, not just referenced. workerd's `fetch` refuses to run with any
    // other receiver — storing it on an instance and calling it as
    // `this.fetchImpl(...)` throws "Illegal invocation" before a request is
    // ever sent, so the sidecar sees nothing and the editor reports it as
    // unreachable. Node does not care, which is why every test of this class
    // passed while the editor could not start a preview at all.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Records a request that did not get an answer it could use.
   *
   * Observation only: the caller's result is decided before this runs and is
   * the same with or without it. The request id is what the sidecar's own
   * `[sidecar-observe]` lines carry, so the two sides can be put together.
   */
  private recordFailure(failure: SidecarRequestFailure): void {
    // Every failure, `isServing` polls included. A client lives for one
    // server-function call, so there is no run of polls here to fold into
    // one line; a developer without a running sidecar sees a line per poll.
    try {
      const thrown =
        failure.error === undefined ? null : describeThrown(failure.error);
      this.log(
        `${LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX} ${JSON.stringify({
          event: "request-failed",
          requestId: failure.requestId,
          operation: failure.operation,
          previewId: failure.previewId,
          startedAt: new Date(failure.startedAt).toISOString(),
          elapsedMs: Date.now() - failure.startedAt,
          outcome: failure.outcome,
          phase: failure.phase,
          status: failure.status,
          ...(failure.errorCode === undefined
            ? {}
            : { errorCode: failure.errorCode }),
          ...(thrown
            ? {
                errorName: thrown.name,
                errorCode: thrown.code,
                errorMessage: thrown.message,
                ...(thrown.messageLength === null
                  ? {}
                  : { errorMessageLength: thrown.messageLength }),
              }
            : {}),
        })}`,
      );
    } catch {
      /* A log that cannot be written changes nothing about the request. */
    }
  }

  private async call<K extends LocalPreviewSidecarOperation>(
    operation: K,
    body: LocalPreviewSidecarOperations[K]["request"],
  ): Promise<
    | { ok: true; result: LocalPreviewSidecarOperations[K]["response"] }
    | { ok: false; reason: string }
  > {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const previewId =
      typeof (body as { previewId?: unknown }).previewId === "string"
        ? (body as { previewId: string }).previewId
        : null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    // Observation only: which part of the exchange a failure happened in.
    let status: number | null = null;
    try {
      const response = await this.fetchImpl(
        `${this.origin}${localPreviewSidecarPath(operation)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: this.token,
            [LOCAL_PREVIEW_SIDECAR_REQUEST_ID_HEADER]: requestId,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      status = response.status;
      if (!response.ok) {
        // The sidecar's own refusal text is safe to surface: it is platform
        // wording about the request, never Theme source or a filesystem path
        // out of the workspace.
        const detail = await response.text().catch(() => "");
        this.recordFailure({
          requestId,
          operation,
          previewId,
          startedAt,
          outcome: "http",
          phase: "response",
          status,
          errorCode: leadingErrorCode(detail),
        });
        return {
          ok: false,
          reason: `LOCAL_PREVIEW_SIDECAR_${response.status}: ${
            detail.slice(0, 400) || response.statusText
          }`,
        };
      }
      const result =
        (await response.json()) as LocalPreviewSidecarOperations[K]["response"];
      return { ok: true, result };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      this.recordFailure({
        requestId,
        operation,
        previewId,
        startedAt,
        outcome: timedOut ? "timeout" : "unreachable",
        phase: status === null ? "request" : "response",
        status,
        error,
      });
      return {
        ok: false,
        reason: timedOut
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
    // A start travels as JSON, where bytes do not survive and a loader does
    // not exist. Each binary file is staged first — read, sent raw, released
    // — one at a time, so this side holds one file's bytes at most. Only when
    // all of them are staged is the start sent, naming them by reference;
    // the sidecar lays them out from its staging and commits the workspace
    // only once every file is written.
    const binaryFiles = input.files.filter(
      (file): file is Extract<typeof file, { binary: unknown }> =>
        "binary" in file,
    );
    if (binaryFiles.length > 0 && !input.loadBinary) {
      return {
        ok: false,
        stage: "preview-sidecar-binary",
        errorMessage: "BINARY_LOADER_MISSING: nothing can read the Theme's binary files.",
        logs: [],
      };
    }
    for (const file of binaryFiles) {
      const staged = await this.stageBinary(input.previewId, file, () =>
        input.loadBinary!(file.binary, file.path),
      );
      if (!staged.ok) {
        return {
          ok: false,
          stage: "preview-sidecar-binary",
          errorMessage: staged.reason,
          logs: [],
        };
      }
    }
    // The start leaves the Worker here. Its host vars are picked again by
    // key, so a caller that handed over the whole env still sends no secret.
    const { loadBinary: _loadBinary, platformHostEnv, ...serialisable } = input;
    const call = await this.call("start", {
      ...serialisable,
      platformHostEnv: pickPlatformHostnameEnv(platformHostEnv),
    });
    if (call.ok) return call.result;
    return {
      ok: false,
      stage: "preview-sidecar",
      errorMessage: call.reason,
      logs: [],
    };
  }

  /** Sends one binary file's bytes to the sidecar's staging. */
  private async stageBinary(
    previewId: string,
    file: Readonly<{ path: string; binary: { digest: string; sizeBytes: number } }>,
    read: () => Promise<Uint8Array>,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    let bytes: Uint8Array | null;
    try {
      bytes = await read();
    } catch (error) {
      return {
        ok: false,
        reason: `Could not read "${file.path}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.origin}${localPreviewSidecarPath("stageBinary")}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: this.token,
            [LOCAL_PREVIEW_SIDECAR_REQUEST_ID_HEADER]: requestId,
            [LOCAL_PREVIEW_SIDECAR_PREVIEW_ID_HEADER]: previewId,
            [LOCAL_PREVIEW_SIDECAR_DIGEST_HEADER]: file.binary.digest,
            [LOCAL_PREVIEW_SIDECAR_SIZE_HEADER]: String(file.binary.sizeBytes),
          },
          // Read from the blob store into an ordinary ArrayBuffer. Asserted
          // rather than copied: a copy would hold the file twice.
          body: bytes as Uint8Array<ArrayBuffer>,
          signal: controller.signal,
        },
      );
      bytes = null;
      if (!response.ok) {
        const detail = (await response
          .json()
          .catch(() => null)) as { error?: string } | null;
        this.recordFailure({
          requestId,
          operation: "stageBinary",
          previewId,
          startedAt,
          outcome: "http",
          phase: "response",
          status: response.status,
          errorCode: leadingErrorCode(detail?.error ?? ""),
        });
        return {
          ok: false,
          reason: `The local preview refused "${file.path}" (${response.status}${
            detail?.error ? `: ${detail.error}` : ""
          }).`,
        };
      }
      return { ok: true };
    } catch (error) {
      this.recordFailure({
        requestId,
        operation: "stageBinary",
        previewId,
        startedAt,
        outcome:
          error instanceof Error && error.name === "AbortError"
            ? "timeout"
            : "unreachable",
        // `fetch` settles once the status arrives, and nothing is read after.
        phase: "request",
        status: null,
        error,
      });
      return {
        ok: false,
        reason: `Could not send "${file.path}" to the local preview: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async isServing(input: {
    previewId: string;
    previewHostname: string;
    expectedOrigin?: string | null;
  }): Promise<boolean> {
    const call = await this.call("isServing", input);
    return call.ok && call.result.serving;
  }

  /**
   * `isServing`, with the instance serving there: the same request, read for
   * the one more thing it answers.
   */
  async describeServing(input: {
    previewId: string;
    previewHostname: string;
    expectedOrigin?: string | null;
  }): Promise<{
    serving: boolean;
    servedInstance: PreviewServedInstance | null;
  }> {
    const call = await this.call("isServing", input);
    if (!call.ok) return { serving: false, servedInstance: null };
    return {
      serving: call.result.serving,
      servedInstance: call.result.serving
        ? parsePreviewServedInstance(call.result.servedInstance)
        : null,
    };
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

  /** Waits for the Worker to read `ticket` or later, writing nothing. */
  async confirmContent(request: {
    previewId: string;
    ticket: number;
  }): Promise<PreviewContentWriteResult> {
    const call = await this.call("confirmContent", request);
    if (!call.ok) throw new Error(call.reason);
    return call.result;
  }

  /** Writes a newer draft content snapshot and waits for the Worker to read it. */
  async writeContent(
    request: LocalPreviewSidecarWriteContentRequest,
  ): Promise<PreviewContentWriteResult> {
    const call = await this.call("writeContent", request);
    if (!call.ok) throw new Error(call.reason);
    return call.result;
  }
}
