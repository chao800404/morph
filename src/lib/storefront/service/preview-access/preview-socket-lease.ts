/**
 * The lease that bounds a relayed Live Preview WebSocket (#214 P4;
 * handoff/2026-10-28/preview-access-design-addendum-p2-p4.md A5, A6; time
 * base D51).
 *
 * A socket was verified at its handshake, but a socket outlives that request,
 * so the bound is kept where data moves: a frame, in either direction, is
 * forwarded only while `now < V + L`, where `V` is the time the latest
 * successful verification's D1 query was **sent** (read before its `await`),
 * never the time its result came back.
 *
 * - A result never moves `V` back, and a result whose query was sent before
 *   the lapse cannot release what the lapse held. So a late "valid" cannot
 *   extend an expired lease.
 * - A pushed revocation notice closes the socket at once, so no result,
 *   however late, can undo it. That is stronger than A5's `V > noticeAt`
 *   rule, which it makes unnecessary here. A notice that arrives before a
 *   socket is registered is the DO's to keep (a tombstone, A6): such a
 *   socket is refused before a lease is made.
 * - Once the lease has lapsed, frames in both directions are held, and only
 *   a verification sent after the lapse began may release them, in order.
 * - A revoked grant closes the socket with 4401; a D1 error or a failed
 *   renewal closes it with 4503; so does a held buffer over its cap. Nothing
 *   held is forwarded after a close.
 * - A pushed notice closes at once. Without one, the lease still ends
 *   forwarding by R + L + ε (R: the revocation's commit; ε: one handler's
 *   synchronous run since its last I/O, the frozen-clock slack of D51).
 *   That is a bound to be verified on the container transport and in the
 *   cloud (A5 §12), not something this module or its tests establish.
 *
 * The socket starts with no verification of its own: the handshake's was made
 * on another instance's clock. It verifies once at registration (A6), and
 * frames wait until that succeeds.
 *
 * Pure: the clock, the verification and the two sockets are passed in.
 */

export const PREVIEW_SOCKET_LEASE_MS = 30_000;
export const PREVIEW_SOCKET_MAX_HELD_FRAMES = 64;
export const PREVIEW_SOCKET_MAX_HELD_BYTES = 1024 * 1024;
/** The grant no longer holds: revoked, expired, its session or user gone. */
export const PREVIEW_SOCKET_CLOSE_REVOKED = 4401;
/** Access could not be checked, or the socket held more than it may. */
export const PREVIEW_SOCKET_CLOSE_UNAVAILABLE = 4503;

export type PreviewSocketDirection = "to-container" | "to-browser";
export type PreviewSocketVerification = "valid" | "revoked" | "unavailable";
export type PreviewSocketFrame = string | ArrayBuffer;

export type PreviewSocketLeaseOptions = Readonly<{
  /** The DO instance's clock, read at each event (D51). */
  now: () => number;
  /**
   * Checks the grant against D1 now. Rejecting counts as "unavailable".
   * The lease reads the clock just before calling this; that is `V`.
   */
  verify: () => Promise<PreviewSocketVerification>;
  forward: (
    direction: PreviewSocketDirection,
    frame: PreviewSocketFrame,
  ) => void;
  /** Called once, when the lease ends the socket. */
  close: (code: number, reason: string) => void;
  leaseMs?: number;
  maxHeldFrames?: number;
  maxHeldBytes?: number;
}>;

export type PreviewSocketLease = Readonly<{
  /** A frame arrived from one side, to go to the other. */
  frame: (direction: PreviewSocketDirection, data: PreviewSocketFrame) => void;
  /** A pushed revocation for this socket's grant: closes now. */
  notice: () => void;
  /** A timer tick while the socket is open: verifies a lapsed lease. */
  tick: () => void;
  /** The socket closed on its own; nothing more is forwarded. */
  dispose: () => void;
  readonly closed: boolean;
}>;

const encoder = new TextEncoder();
function frameBytes(data: PreviewSocketFrame): number {
  return typeof data === "string"
    ? encoder.encode(data).byteLength
    : data.byteLength;
}

export function createPreviewSocketLease(
  options: PreviewSocketLeaseOptions,
): PreviewSocketLease {
  const leaseMs = options.leaseMs ?? PREVIEW_SOCKET_LEASE_MS;
  const maxFrames = options.maxHeldFrames ?? PREVIEW_SOCKET_MAX_HELD_FRAMES;
  const maxBytes = options.maxHeldBytes ?? PREVIEW_SOCKET_MAX_HELD_BYTES;

  /** Send time of the latest accepted verification; null before the first. */
  let verifiedAt: number | null = null;
  /** Send time of the verification in flight, if any. */
  let inFlightSentAt: number | null = null;
  const createdAt = options.now();
  /**
   * While frames are held: when the lease they wait on lapsed (creation,
   * before any verification). Only a verification sent at or after it may
   * release them. Null while nothing is held.
   */
  let heldSince: number | null = null;
  let held: Array<{
    direction: PreviewSocketDirection;
    data: PreviewSocketFrame;
  }> = [];
  let heldBytes = 0;
  let closed = false;

  const leaseHolds = (now: number) =>
    verifiedAt !== null && now < verifiedAt + leaseMs;

  function end(code: number, reason: string) {
    if (closed) return;
    closed = true;
    held = [];
    heldBytes = 0;
    heldSince = null;
    options.close(code, reason);
  }

  function startVerification() {
    if (closed || inFlightSentAt !== null) return;
    const sentAt = options.now();
    inFlightSentAt = sentAt;
    let result: Promise<PreviewSocketVerification>;
    try {
      result = options.verify();
    } catch {
      result = Promise.resolve("unavailable");
    }
    result.then(
      (outcome) => settle(sentAt, outcome),
      () => settle(sentAt, "unavailable"),
    );
  }

  function settle(sentAt: number, outcome: PreviewSocketVerification) {
    if (inFlightSentAt === sentAt) inFlightSentAt = null;
    if (closed) return;
    if (outcome === "revoked") {
      end(PREVIEW_SOCKET_CLOSE_REVOKED, "Preview access ended.");
      return;
    }
    if (outcome !== "valid") {
      end(
        PREVIEW_SOCKET_CLOSE_UNAVAILABLE,
        "Preview access cannot be checked.",
      );
      return;
    }
    if (verifiedAt === null || sentAt > verifiedAt) verifiedAt = sentAt;

    if (heldSince === null) return;
    const now = options.now();
    // Only a verification sent after the lapse releases what is held, and
    // only while the lease it starts still holds.
    if (sentAt >= heldSince && leaseHolds(now)) {
      const release = held;
      held = [];
      heldBytes = 0;
      heldSince = null;
      for (const { direction, data } of release) {
        if (closed) return;
        options.forward(direction, data);
      }
      return;
    }
    startVerification();
  }

  return {
    frame(direction, data) {
      if (closed) return;
      const now = options.now();
      if (heldSince === null && leaseHolds(now)) {
        options.forward(direction, data);
        // Renew ahead of the lapse, so a busy socket is not held at all.
        if (now >= verifiedAt! + leaseMs / 2) startVerification();
        return;
      }
      if (heldSince === null) {
        heldSince = verifiedAt === null ? createdAt : verifiedAt + leaseMs;
      }
      held.push({ direction, data });
      heldBytes += frameBytes(data);
      if (held.length > maxFrames || heldBytes > maxBytes) {
        end(
          PREVIEW_SOCKET_CLOSE_UNAVAILABLE,
          "Preview socket held too much while access was checked.",
        );
        return;
      }
      // A verification already in flight from before the lapse cannot
      // release these; settle() starts the next one when it returns.
      startVerification();
    },
    notice() {
      end(PREVIEW_SOCKET_CLOSE_REVOKED, "Preview access ended.");
    },
    tick() {
      if (closed) return;
      if (!leaseHolds(options.now())) startVerification();
    },
    dispose() {
      if (closed) return;
      closed = true;
      held = [];
      heldBytes = 0;
      heldSince = null;
    },
    get closed() {
      return closed;
    },
  };
}

/** Starts a lease and its first verification (registration, A6). */
export function registerPreviewSocketLease(
  options: PreviewSocketLeaseOptions,
): PreviewSocketLease {
  const lease = createPreviewSocketLease(options);
  lease.tick();
  return lease;
}
