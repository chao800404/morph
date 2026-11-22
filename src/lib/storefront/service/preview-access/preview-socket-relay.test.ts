import { describe, expect, it } from "vitest";
import {
  PREVIEW_SOCKET_LEASE_MS,
  type PreviewSocketVerification,
  type PreviewSocketVerifiedEvent,
} from "./preview-socket-lease";
import {
  PREVIEW_SOCKET_RENEW_MARGIN_MS,
  PREVIEW_SOCKET_TICK_MS,
  previewSocketRenewAheadMs,
  type RelaySocket,
  relayPreviewSocket,
} from "./preview-socket-relay";

type Listener = (event: {
  data?: unknown;
  code?: number;
  reason?: string;
}) => void;

function fakeSocket(name: string) {
  const listeners: Record<string, Listener[]> = {};
  const sent: unknown[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const socket: RelaySocket = {
    send: (data) => {
      sent.push(data);
    },
    close: (code, reason) => {
      closes.push({ code, reason });
    },
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener as Listener);
    },
  };
  return {
    name,
    socket,
    sent,
    closes,
    emit: (type: string, event: Parameters<Listener>[0] = {}) =>
      (listeners[type] ?? []).forEach((l) => l(event)),
  };
}

function relayHarness(
  onVerified?: (event: PreviewSocketVerifiedEvent) => void,
) {
  let clock = 0;
  const answers: Array<(v: PreviewSocketVerification) => Promise<void>> = [];
  const browser = fakeSocket("browser");
  const container = fakeSocket("container");
  const timers: Array<{ cb: () => void; cleared: boolean }> = [];
  let ended = 0;
  const relay = relayPreviewSocket({
    browser: browser.socket,
    container: container.socket,
    now: () => clock,
    verify: () =>
      new Promise((resolve) => {
        answers.push(async (v) => {
          resolve(v);
          await Promise.resolve();
          await Promise.resolve();
        });
      }),
    onEnd: () => {
      ended += 1;
    },
    ...(onVerified ? { onVerified } : {}),
    leaseMs: 1000,
    setInterval: (cb) => {
      const t = { cb, cleared: false };
      timers.push(t);
      return t;
    },
    clearInterval: (t) => {
      (t as { cleared: boolean }).cleared = true;
    },
  });
  return {
    relay,
    browser,
    container,
    answers,
    timers,
    advance: (ms: number) => (clock += ms),
    get ended() {
      return ended;
    },
  };
}

describe("the preview socket relay (#214 P4)", () => {
  it("relays both directions only through the lease", async () => {
    const h = relayHarness();
    h.browser.emit("message", { data: "hello" });
    h.container.emit("message", { data: "hmr" });
    expect(h.container.sent).toEqual([]);
    expect(h.browser.sent).toEqual([]);
    await h.answers[0]!("valid");
    expect(h.container.sent).toEqual(["hello"]);
    expect(h.browser.sent).toEqual(["hmr"]);

    const bytes = new Uint8Array([1, 2, 3]);
    h.container.emit("message", { data: bytes });
    expect(new Uint8Array(h.browser.sent[1] as ArrayBuffer)).toEqual(bytes);
  });

  it("a revoked renewal closes the browser with 4401 and the container normally, once", async () => {
    const h = relayHarness();
    await h.answers[0]!("valid");
    h.advance(1000);
    h.browser.emit("message", { data: "late" });
    await h.answers[1]!("revoked");
    expect(h.browser.closes).toEqual([
      { code: 4401, reason: "Preview access ended." },
    ]);
    expect(h.container.closes).toEqual([
      { code: 1000, reason: "Preview access ended." },
    ]);
    expect(h.container.sent).toEqual([]);
    expect(h.timers[0]!.cleared).toBe(true);
    expect(h.ended).toBe(1);
    expect(h.relay.closed).toBe(true);
  });

  it("a pushed notice closes 4401 at once", async () => {
    const h = relayHarness();
    await h.answers[0]!("valid");
    h.relay.notice();
    h.browser.emit("message", { data: "after" });
    expect(h.browser.closes[0]!.code).toBe(4401);
    expect(h.container.sent).toEqual([]);
  });

  it("an idle socket is checked by the timer once its lease lapsed", async () => {
    const h = relayHarness();
    await h.answers[0]!("valid");
    h.advance(1000);
    h.timers[0]!.cb();
    expect(h.answers).toHaveLength(2);
    await h.answers[1]!("unavailable");
    expect(h.browser.closes[0]!.code).toBe(4503);
  });

  it("either side closing ends the other side and the relay; reported-only codes are not sent", async () => {
    const h = relayHarness();
    await h.answers[0]!("valid");
    h.browser.emit("close", { code: 1006, reason: "" });
    expect(h.container.closes).toEqual([{ code: 1000, reason: "" }]);
    h.browser.emit("message", { data: "x" });
    expect(h.container.sent).toEqual([]);
    expect(h.ended).toBe(1);

    const k = relayHarness();
    k.container.emit("close", { code: 4000, reason: "bye" });
    expect(k.browser.closes).toEqual([{ code: 4000, reason: "bye" }]);
    expect(k.timers[0]!.cleared).toBe(true);
  });

  it("an unsupported frame ends both sides", async () => {
    const h = relayHarness();
    await h.answers[0]!("valid");
    h.browser.emit("message", { data: { not: "a frame" } });
    expect(h.browser.closes[0]!.code).toBe(1003);
    expect(h.container.closes[0]!.code).toBe(1003);
    expect(h.ended).toBe(1);
  });

  it("a failed send ends both sides with 1011", async () => {
    const h = relayHarness();
    h.container.socket.send = () => {
      throw new Error("closed");
    };
    await h.answers[0]!("valid");
    h.browser.emit("message", { data: "x" });
    expect(h.browser.closes[0]!.code).toBe(1011);
  });

  it("hands its lease's verification diagnostics through, from the registration's on", async () => {
    const events: PreviewSocketVerifiedEvent[] = [];
    const h = relayHarness((event) => events.push(event));
    await h.answers[0]!("valid");
    h.advance(1000);
    h.timers[0]!.cb();
    await h.answers[1]!("valid");
    expect(events).toEqual([
      { sequence: 1, sentAt: 0, settledAt: 0 },
      { sequence: 2, sentAt: 1000, settledAt: 1000 },
    ]);
    h.advance(1000);
    h.timers[0]!.cb();
    await h.answers[2]!("revoked");
    expect(events).toHaveLength(2);
    expect(h.browser.closes[0]!.code).toBe(4401);
  });
});

/**
 * M1 1c "notice-lost-after-renewal-idle" on a fake clock, with the production
 * lease and tick: the registration verifies at 0, a busy frame at `renewAt`
 * renews V, the grant is revoked in D1 1 ms later (after that query read it),
 * no notice arrives, and the socket then sends nothing. The tick fires every
 * tick period from the relay's start; D1 answers `d1Ms` after each query is
 * sent, "valid" if it was sent before R and "revoked" otherwise.
 */
async function idleAfterRenewal(args: { renewAt: number; d1Ms: number }) {
  let clock = 0;
  let R = Number.POSITIVE_INFINITY;
  const browser = fakeSocket("browser");
  const container = fakeSocket("container");
  const answers: Array<{ at: number; resolve: () => void }> = [];
  let interval: { cb: () => void; ms: number } | null = null;
  let nextTick = Number.POSITIVE_INFINITY;
  const sentToBrowserAt: number[] = [];
  const sentToContainerAt: number[] = [];
  const queriesAt: number[] = [];
  let closedAt: number | null = null;
  browser.socket.send = () => void sentToBrowserAt.push(clock);
  container.socket.send = () => void sentToContainerAt.push(clock);
  browser.socket.close = (code, reason) => {
    closedAt ??= clock;
    browser.closes.push({ code, reason });
  };
  const relay = relayPreviewSocket({
    browser: browser.socket,
    container: container.socket,
    now: () => clock,
    verify: () => {
      const sentAt = clock;
      queriesAt.push(sentAt);
      return new Promise<PreviewSocketVerification>((resolve) => {
        answers.push({
          at: sentAt + args.d1Ms,
          resolve: () => resolve(sentAt < R ? "valid" : "revoked"),
        });
      });
    },
    setInterval: (cb, ms) => {
      interval = { cb, ms };
      nextTick = ms;
      return interval;
    },
    clearInterval: () => {
      interval = null;
      nextTick = Number.POSITIVE_INFINITY;
    },
  });
  /** Runs D1 answers and ticks in time order up to `until`. */
  const runUntil = async (until: number) => {
    while (!relay.closed) {
      answers.sort((a, b) => a.at - b.at);
      const answerAt = answers[0]?.at ?? Number.POSITIVE_INFINITY;
      const next = Math.min(answerAt, nextTick);
      if (next > until) break;
      clock = next;
      if (answerAt === next) {
        answers.shift()!.resolve();
        await Promise.resolve();
        await Promise.resolve();
      } else {
        nextTick += interval!.ms;
        interval!.cb();
      }
    }
    clock = Math.max(clock, until);
  };
  await runUntil(args.renewAt);
  container.emit("message", { data: "busy" });
  const V = queriesAt.at(-1)!;
  R = V + 1;
  await runUntil(V + 3 * PREVIEW_SOCKET_LEASE_MS);
  return {
    V,
    R,
    closedAt,
    code: browser.closes[0]?.code,
    containerCode: container.closes[0]?.code,
    sentToBrowserAt,
    sentToContainerAt,
    queriesAt,
  };
}

describe("an idle socket whose revocation notice was lost (M1 1c)", () => {
  it("renews on the busy frame, so the case starts where 1c starts", async () => {
    const run = await idleAfterRenewal({ renewAt: 15_001, d1Ms: 20 });
    expect(run.V).toBe(15_001);
    expect(run.sentToBrowserAt).toEqual([15_001]);
    expect(run.queriesAt.slice(0, 2)).toEqual([0, 15_001]);
  });

  it("closes 4401 within L of the revocation, wherever the renewal falls in the tick", async () => {
    for (const d1Ms of [20, 4_999]) {
      for (let offset = 0; offset < PREVIEW_SOCKET_TICK_MS; offset += 250) {
        const at = `D ${d1Ms} ms, offset ${offset}`;
        const run = await idleAfterRenewal({
          renewAt: PREVIEW_SOCKET_LEASE_MS / 2 + offset + 1,
          d1Ms,
        });
        expect(run.code, at).toBe(4401);
        expect(run.containerCode, at).toBe(1000);
        expect(run.closedAt! - run.R, at).toBeLessThanOrEqual(
          PREVIEW_SOCKET_LEASE_MS,
        );
        // Nothing moved after the revocation: the only frame is the renewal's.
        expect(run.sentToBrowserAt, at).toEqual([run.V]);
        expect(run.sentToContainerAt, at).toEqual([]);
      }
    }
  });

  it("closes before R + L - margin + D, the bound the renew-ahead guarantees", async () => {
    const ahead = previewSocketRenewAheadMs(PREVIEW_SOCKET_TICK_MS);
    const d1Ms = 20;
    let latest = 0;
    for (let offset = 0; offset < PREVIEW_SOCKET_TICK_MS; offset += 50) {
      const run = await idleAfterRenewal({
        renewAt: PREVIEW_SOCKET_LEASE_MS / 2 + offset + 1,
        d1Ms,
      });
      const afterR = run.closedAt! - run.R;
      expect(afterR, `offset ${offset}`).toBeLessThan(
        PREVIEW_SOCKET_LEASE_MS - PREVIEW_SOCKET_RENEW_MARGIN_MS + d1Ms,
      );
      // The query that read the revocation went out from V + L - ahead on.
      expect(run.queriesAt.at(-1)!, `offset ${offset}`).toBeGreaterThanOrEqual(
        run.V + PREVIEW_SOCKET_LEASE_MS - ahead,
      );
      latest = Math.max(latest, afterR);
    }
    // The sweep reaches the top of the window, so the bound is tight.
    expect(latest).toBeGreaterThan(
      PREVIEW_SOCKET_LEASE_MS - PREVIEW_SOCKET_RENEW_MARGIN_MS - 100,
    );
  });
});
