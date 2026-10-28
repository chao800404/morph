import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { LOCAL_PREVIEW_SIDECAR_REQUEST_ID_HEADER } from "./local-preview-sidecar.protocol";

/**
 * What the sidecar saw of its connections and requests, one JSON line each.
 *
 * Observation only. Nothing here answers, delays or retries a request: it
 * listens to events the server emits anyway and writes a line. It exists
 * because one CI run lost a Worker → sidecar request ("Network connection
 * lost") and nothing on the sidecar's side recorded whether the request
 * arrived, which connection carried it, or how long that connection had been
 * idle.
 *
 * What a line never holds: a header value other than the request id, a body,
 * a query string, or the token. Operations are named by the protocol's own
 * names, not by the path the caller sent.
 */

export const LOCAL_PREVIEW_SIDECAR_OBSERVE_PREFIX = "[sidecar-observe]";

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

/** The request id as sent, or null when it is absent or not an id. */
export function readSidecarRequestId(
  value: string | string[] | undefined,
): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  return id !== undefined && REQUEST_ID.test(id) ? id : null;
}

type SocketState = {
  id: number;
  openedAt: number;
  requests: number;
  lastResponseEndedAt: number | null;
};

export type LocalPreviewSidecarObserver = Readonly<{
  /** Call once the server listens. */
  listening(): void;
  /** Call first thing in the request handler. */
  request(
    operation: string | null,
    request: IncomingMessage,
    response: ServerResponse,
  ): void;
}>;

export function observeLocalPreviewSidecar(
  server: Server,
  write: (line: string) => void,
  now: () => number = Date.now,
): LocalPreviewSidecarObserver {
  const sockets = new WeakMap<Socket, SocketState>();
  let nextSocketId = 1;

  const emit = (event: string, fields: Record<string, unknown>) => {
    // Never into the request it describes: a line that cannot be written is
    // a lost line, not a failed request.
    try {
      write(
        `${LOCAL_PREVIEW_SIDECAR_OBSERVE_PREFIX} ${JSON.stringify({
          event,
          at: new Date(now()).toISOString(),
          ...fields,
        })}`,
      );
    } catch {
      /* Dropped. */
    }
  };

  const idleMs = (state: SocketState) =>
    state.lastResponseEndedAt === null
      ? null
      : now() - state.lastResponseEndedAt;

  server.on("connection", (socket: Socket) => {
    const state: SocketState = {
      id: nextSocketId++,
      openedAt: now(),
      requests: 0,
      lastResponseEndedAt: null,
    };
    sockets.set(socket, state);
    emit("socket-open", {
      socket: state.id,
      remotePort: socket.remotePort ?? null,
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      emit("socket-error", {
        socket: state.id,
        code: error.code ?? null,
        name: error.name,
      });
    });
    socket.on("timeout", () => {
      emit("socket-timeout", { socket: state.id, idleMs: idleMs(state) });
    });
    socket.on("close", (hadError: boolean) => {
      emit("socket-close", {
        socket: state.id,
        lifetimeMs: now() - state.openedAt,
        requests: state.requests,
        idleMs: idleMs(state),
        hadError,
      });
    });
  });

  return {
    listening() {
      emit("listening", {
        pid: process.pid,
        keepAliveTimeoutMs: server.keepAliveTimeout,
        headersTimeoutMs: server.headersTimeout,
        requestTimeoutMs: server.requestTimeout,
      });
    },
    request(operation, request, response) {
      const state = sockets.get(request.socket);
      const requestId = readSidecarRequestId(
        request.headers[LOCAL_PREVIEW_SIDECAR_REQUEST_ID_HEADER],
      );
      const startedAt = now();
      if (state) state.requests += 1;
      emit("request", {
        socket: state?.id ?? null,
        // 1 for a new connection; more means a kept-alive one was reused.
        seq: state?.requests ?? null,
        idleMs: state ? idleMs(state) : null,
        operation: operation ?? "unknown",
        requestId,
      });
      response.on("finish", () => {
        if (state) state.lastResponseEndedAt = now();
        emit("response", {
          socket: state?.id ?? null,
          operation: operation ?? "unknown",
          requestId,
          status: response.statusCode,
          ms: now() - startedAt,
        });
      });
      response.on("close", () => {
        if (response.writableFinished) return;
        emit("response-aborted", {
          socket: state?.id ?? null,
          operation: operation ?? "unknown",
          requestId,
          ms: now() - startedAt,
        });
      });
    },
  };
}
