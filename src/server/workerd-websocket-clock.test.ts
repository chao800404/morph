// @vitest-environment node
/**
 * Measures the clock a Durable Object sees while it handles WebSocket
 * messages, in the workerd that `wrangler dev` runs.
 *
 * The P4 relay lease (preview access design addendum, A5 "time base") reads
 * `Date.now()` on each socket message event and before each verification
 * query, and assumes that clock advances at every message event while staying
 * frozen inside synchronous code. This file measures both instead of assuming
 * them. It tests no Morph code: the Worker below is the smallest Durable
 * Object that accepts a socket the way `PreviewSandbox` would.
 *
 * Measured result: the local runtime advances at every message event, but it
 * does not freeze the clock inside synchronous code. Cloudflare documents the
 * freeze for deployed Workers only (runtime-apis/performance), so that half
 * can only be shown by the cloud check, and nothing tested locally may rely
 * on it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

const WORKER_SOURCE = `
import { DurableObject } from "cloudflare:workers";

export class Clock extends DurableObject {
  async fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.addEventListener("message", async (event) => {
      const message = JSON.parse(event.data);
      const atEvent = Date.now();
      // Synchronous work whose real duration the client measures.
      let x = 0;
      for (let i = 0; i < message.spin; i++) x = (x * 31 + i) | 0;
      const afterSpin = Date.now();
      let afterTimer = null;
      let afterFetch = null;
      if (message.timerMs) {
        await new Promise((resolve) => setTimeout(resolve, message.timerMs));
        afterTimer = Date.now();
      }
      if (message.fetchUrl) {
        await (await fetch(message.fetchUrl)).text();
        afterFetch = Date.now();
      }
      server.send(
        JSON.stringify({ seq: message.seq, atEvent, afterSpin, afterTimer, afterFetch, x }),
      );
    });
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  fetch(request, env) {
    return env.CLOCK.get(env.CLOCK.idFromName("clock")).fetch(request);
  },
};
`;

const WORKER_CONFIG = {
  name: "workerd-websocket-clock",
  main: "index.js",
  // The app's own compatibility date (wrangler.jsonc).
  compatibility_date: "2026-03-24",
  durable_objects: { bindings: [{ name: "CLOCK", class_name: "Clock" }] },
  migrations: [{ tag: "v1", new_sqlite_classes: ["Clock"] }],
};

type Reply = {
  seq: number;
  atEvent: number;
  afterSpin: number;
  afterTimer: number | null;
  afterFetch: number | null;
};

/** Pause the client takes between sends, on the Node clock. */
const PAUSE_MS = 250;
/** Iterations of the synchronous loop; long enough to take real time. */
const SPIN = 50_000_000;
const TIMER_MS = 80;
const SLOW_FETCH_MS = 120;

describe("workerd Date.now() at WebSocket message events", () => {
  let dir = "";
  let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;
  let slowServer: Server | null = null;
  let slowUrl = "";
  let socket: WebSocket | null = null;
  const replies = new Map<number, (reply: Reply) => void>();

  const send = (message: Record<string, unknown> & { seq: number }) =>
    new Promise<Reply>((resolve) => {
      replies.set(message.seq, resolve);
      socket!.send(JSON.stringify(message));
    });

  beforeAll(async () => {
    slowServer = createServer((_request, response) => {
      setTimeout(() => response.end("ok"), SLOW_FETCH_MS);
    });
    await new Promise<void>((resolve) =>
      slowServer!.listen(0, "127.0.0.1", resolve),
    );
    slowUrl = `http://127.0.0.1:${(slowServer.address() as AddressInfo).port}/`;

    dir = mkdtempSync(join(tmpdir(), "workerd-websocket-clock-"));
    writeFileSync(join(dir, "index.js"), WORKER_SOURCE);
    writeFileSync(join(dir, "wrangler.json"), JSON.stringify(WORKER_CONFIG));
    worker = await unstable_startWorker({
      config: join(dir, "wrangler.json"),
      dev: {
        server: { hostname: "127.0.0.1", port: 0 },
        inspector: false,
        logLevel: "error",
      },
    });
    await worker.ready;
    const url = new URL(await worker.url);
    url.protocol = "ws:";
    socket = new WebSocket(url);
    socket.addEventListener("message", (event) => {
      const reply = JSON.parse(String(event.data)) as Reply;
      replies.get(reply.seq)?.(reply);
      replies.delete(reply.seq);
    });
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), { once: true });
      socket!.addEventListener("error", () => reject(new Error("ws error")), {
        once: true,
      });
    });
  }, 60_000);

  afterAll(async () => {
    socket?.close();
    await worker?.dispose();
    await new Promise<void>((resolve) =>
      slowServer ? slowServer.close(() => resolve()) : resolve(),
    );
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("advances between message events by at least the client's pause", async () => {
    const events: number[] = [];
    const sentAt: number[] = [];
    for (let seq = 0; seq < 4; seq++) {
      if (seq > 0) await sleep(PAUSE_MS);
      sentAt.push(performance.now());
      events.push((await send({ seq, spin: 0 })).atEvent);
    }
    const gaps = events.slice(1).map((at, i) => at - events[i]!);
    const clientGaps = sentAt.slice(1).map((at, i) => at - sentAt[i]!);
    console.info(
      "[workerd-clock] between events",
      JSON.stringify({ gaps, clientGaps: clientGaps.map(Math.round) }),
    );
    for (const gap of gaps) {
      // 1 ms of slack for the two clocks' millisecond rounding.
      expect(gap).toBeGreaterThanOrEqual(PAUSE_MS - 1);
    }
  });

  it("is not frozen in synchronous code locally, and advances across awaited I/O", async () => {
    const baselineStart = performance.now();
    await send({ seq: 100, spin: 0 });
    const baselineMs = performance.now() - baselineStart;
    const spinStart = performance.now();
    const reply = await send({
      seq: 101,
      spin: SPIN,
      timerMs: TIMER_MS,
      fetchUrl: slowUrl,
    });
    const spinRoundTripMs = performance.now() - spinStart;
    const realSpinMs = spinRoundTripMs - baselineMs - TIMER_MS - SLOW_FETCH_MS;
    console.info(
      "[workerd-clock] within one event",
      JSON.stringify({
        realSpinMsApprox: Math.round(realSpinMs),
        spinRoundTripMs: Math.round(spinRoundTripMs),
        clockDuringSpin: reply.afterSpin - reply.atEvent,
        clockAcrossTimer: reply.afterTimer! - reply.afterSpin,
        clockAcrossFetch: reply.afterFetch! - reply.afterTimer!,
      }),
    );
    // The loop took real time; without that, the clock reading proves nothing.
    expect(realSpinMs).toBeGreaterThan(50);
    // Locally the clock follows that real time, not the last I/O event.
    expect(reply.afterSpin - reply.atEvent).toBeGreaterThan(50);
    // Awaiting a timer or a fetch is an I/O event: the clock moves to at
    // least the real time that passed, which includes the loop before it.
    expect(reply.afterTimer! - reply.atEvent).toBeGreaterThanOrEqual(
      TIMER_MS + 50,
    );
    expect(reply.afterFetch! - reply.afterTimer!).toBeGreaterThanOrEqual(
      SLOW_FETCH_MS - 1,
    );
  });

  it("gives a message queued behind a blocking handler a time after the block", async () => {
    const blocking = send({ seq: 200, spin: SPIN });
    const queued = send({ seq: 201, spin: 0 });
    const [first, second] = await Promise.all([blocking, queued]);
    console.info(
      "[workerd-clock] queued behind block",
      JSON.stringify({
        firstClockDuringSpin: first.afterSpin - first.atEvent,
        queuedEventMinusFirstEvent: second.atEvent - first.atEvent,
      }),
    );
    expect(first.afterSpin - first.atEvent).toBeGreaterThan(50);
    // The second event is delivered only after the loop ends, and its clock
    // reads that later time rather than the first event's.
    expect(second.atEvent).toBeGreaterThanOrEqual(first.afterSpin);
  });
});
