import {
  PREVIEW_SOCKET_LEASE_MS,
  type PreviewSocketFrame,
  type PreviewSocketLeaseOptions,
  registerPreviewSocketLease,
} from "./preview-socket-lease";

/**
 * Relays one Live Preview WebSocket between the browser and the container
 * through its lease (#214 P4, addendum A5). Every frame, either way, goes
 * through the lease; nothing is sent around it.
 *
 * - The lease's close ends both sides: the browser with the lease's code
 *   (4401 or 4503), the container with a normal close.
 * - Either side closing or failing ends the other and the lease.
 * - While open, a timer ticks the lease so an idle socket whose grant was
 *   revoked is still closed promptly (A5 "idle sockets"; no DO alarm, A8).
 *   The bound does not rest on the timer: a frame is only ever forwarded
 *   under the lease.
 */

/**
 * Set by the Worker, after verifying a `pv-` WebSocket upgrade, on the
 * request it forwards to the preview's Durable Object: the grant the socket
 * was opened with and the host it is for. Any client-sent copy is removed
 * first, and the DO removes both before the container sees the request.
 */
export const PREVIEW_SOCKET_GRANT_HEADER = "x-morph-preview-grant";
export const PREVIEW_SOCKET_HOST_HEADER = "x-morph-preview-host";

/** A request to a preview container without the relay's headers. */
export function withoutPreviewSocketHeaders(request: Request): Request {
  if (
    !request.headers.has(PREVIEW_SOCKET_GRANT_HEADER) &&
    !request.headers.has(PREVIEW_SOCKET_HOST_HEADER)
  ) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.delete(PREVIEW_SOCKET_GRANT_HEADER);
  headers.delete(PREVIEW_SOCKET_HOST_HEADER);
  return new Request(request, { headers });
}

/** What the relay needs of a Workers WebSocket, accepted already. */
export type RelaySocket = {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message" | "close" | "error",
    listener: (event: {
      data?: unknown;
      code?: number;
      reason?: string;
    }) => void,
  ): void;
};

export type PreviewSocketRelay = Readonly<{
  /** A pushed revocation for this socket's grant. */
  notice: () => void;
  readonly closed: boolean;
}>;

/** The tick period: a lapsed idle socket is checked within this. */
export const PREVIEW_SOCKET_TICK_MS = 5_000;

/** A close code a peer may be sent: 1005/1006 are reported, never sent. */
function sendableCode(code: number | undefined): number {
  return code === undefined || code === 1005 || code === 1006 ? 1000 : code;
}

function frameOf(data: unknown): PreviewSocketFrame | null {
  if (typeof data === "string" || data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
  }
  return null;
}

export function relayPreviewSocket(args: {
  browser: RelaySocket;
  container: RelaySocket;
  now: PreviewSocketLeaseOptions["now"];
  verify: PreviewSocketLeaseOptions["verify"];
  /** Called once, when the relay has ended. */
  onEnd?: () => void;
  leaseMs?: number;
  tickMs?: number;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}): PreviewSocketRelay {
  const startTimer = args.setInterval ?? ((cb, ms) => setInterval(cb, ms));
  const stopTimer =
    args.clearInterval ??
    ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  let ended = false;
  let timer: unknown = null;

  const finish = () => {
    if (ended) return;
    ended = true;
    if (timer !== null) stopTimer(timer);
    timer = null;
    args.onEnd?.();
  };

  const lease = registerPreviewSocketLease({
    now: args.now,
    verify: args.verify,
    leaseMs: args.leaseMs ?? PREVIEW_SOCKET_LEASE_MS,
    forward: (direction, frame) => {
      const target =
        direction === "to-container" ? args.container : args.browser;
      try {
        target.send(frame);
      } catch {
        endBoth(1011, "Preview socket could not forward.");
      }
    },
    close: (code, reason) => {
      try {
        args.browser.close(code, reason);
      } catch {}
      try {
        args.container.close(1000, "Preview access ended.");
      } catch {}
      finish();
    },
  });

  function endBoth(code: number, reason: string) {
    lease.dispose();
    try {
      args.browser.close(code, reason);
    } catch {}
    try {
      args.container.close(code, reason);
    } catch {}
    finish();
  }

  const relayFrom = (
    from: RelaySocket,
    direction: "to-container" | "to-browser",
  ) => {
    from.addEventListener("message", (event) => {
      const frame = frameOf(event.data);
      if (frame === null) {
        endBoth(1003, "Unsupported preview socket frame.");
        return;
      }
      lease.frame(direction, frame);
    });
  };
  relayFrom(args.browser, "to-container");
  relayFrom(args.container, "to-browser");

  args.browser.addEventListener("close", (event) => {
    lease.dispose();
    try {
      args.container.close(sendableCode(event.code), event.reason);
    } catch {}
    finish();
  });
  args.container.addEventListener("close", (event) => {
    lease.dispose();
    try {
      args.browser.close(sendableCode(event.code), event.reason);
    } catch {}
    finish();
  });
  args.browser.addEventListener("error", () =>
    endBoth(1011, "Browser preview socket error."),
  );
  args.container.addEventListener("error", () =>
    endBoth(1011, "Container preview socket error."),
  );

  if (!lease.closed) {
    timer = startTimer(
      () => lease.tick(),
      args.tickMs ?? PREVIEW_SOCKET_TICK_MS,
    );
  } else {
    finish();
  }

  return {
    notice: () => lease.notice(),
    get closed() {
      return ended;
    },
  };
}
