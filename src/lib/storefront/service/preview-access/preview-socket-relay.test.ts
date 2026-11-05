import { describe, expect, it } from "vitest";
import type { PreviewSocketVerification } from "./preview-socket-lease";
import { type RelaySocket, relayPreviewSocket } from "./preview-socket-relay";

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

function relayHarness() {
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
});
