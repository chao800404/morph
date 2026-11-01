import { describe, expect, it } from "vitest";
import {
  PREVIEW_SOCKET_CLOSE_REVOKED,
  PREVIEW_SOCKET_CLOSE_UNAVAILABLE,
  PREVIEW_SOCKET_LEASE_MS as L,
  type PreviewSocketDirection,
  type PreviewSocketFrame,
  type PreviewSocketVerification,
  createPreviewSocketLease,
  registerPreviewSocketLease,
} from "./preview-socket-lease";

/**
 * A fake clock and a D1 stand-in whose answers the test releases, one query
 * at a time, so every race in A5/A6 can be played in a chosen order.
 */
function harness(
  options: {
    register?: boolean;
    maxHeldFrames?: number;
    maxHeldBytes?: number;
  } = {},
) {
  let clock = 1_000_000;
  const queries: Array<{
    sentAt: number;
    answer: (outcome: PreviewSocketVerification | Error) => Promise<void>;
  }> = [];
  const forwarded: Array<{
    at: number;
    direction: PreviewSocketDirection;
    data: PreviewSocketFrame;
  }> = [];
  const closes: Array<{ at: number; code: number }> = [];
  const lease = (
    options.register === false
      ? createPreviewSocketLease
      : registerPreviewSocketLease
  )({
    now: () => clock,
    verify: () =>
      new Promise<PreviewSocketVerification>((resolve, reject) => {
        queries.push({
          sentAt: clock,
          answer: async (outcome) => {
            if (outcome instanceof Error) reject(outcome);
            else resolve(outcome);
            // Let the lease's then() run.
            await Promise.resolve();
            await Promise.resolve();
          },
        });
      }),
    forward: (direction, data) =>
      forwarded.push({ at: clock, direction, data }),
    close: (code) => closes.push({ at: clock, code }),
    ...(options.maxHeldFrames ? { maxHeldFrames: options.maxHeldFrames } : {}),
    ...(options.maxHeldBytes ? { maxHeldBytes: options.maxHeldBytes } : {}),
  });
  return {
    lease,
    queries,
    forwarded,
    closes,
    advance: (ms: number) => (clock += ms),
    get now() {
      return clock;
    },
    data: () => forwarded.map((f) => f.data),
  };
}

/** Registered, and its first verification answered "valid". */
async function verifiedHarness(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  await h.queries[0]!.answer("valid");
  return h;
}

describe("the preview socket lease (#214 P4, addendum A5/A6)", () => {
  it("holds frames in both directions until its first verification, then forwards them in order", async () => {
    const h = harness();
    expect(h.queries).toHaveLength(1);
    h.lease.frame("to-container", "a");
    h.lease.frame("to-browser", "b");
    h.lease.frame("to-container", "c");
    expect(h.forwarded).toEqual([]);
    await h.queries[0]!.answer("valid");
    expect(h.forwarded.map((f) => [f.direction, f.data])).toEqual([
      ["to-container", "a"],
      ["to-browser", "b"],
      ["to-container", "c"],
    ]);
  });

  it("forwards both directions only while the lease holds, and holds both once it lapses", async () => {
    const h = await verifiedHarness();
    h.lease.frame("to-container", "up");
    h.lease.frame("to-browser", "down");
    expect(h.data()).toEqual(["up", "down"]);

    h.advance(L);
    h.lease.frame("to-container", "late-up");
    h.lease.frame("to-browser", "late-down");
    expect(h.data()).toEqual(["up", "down"]);
    expect(h.queries).toHaveLength(2);

    await h.queries[1]!.answer("valid");
    expect(h.data()).toEqual(["up", "down", "late-up", "late-down"]);
  });

  it("a late 'valid' for a query sent before the revocation forwards nothing after V + L", async () => {
    const h = await verifiedHarness();
    const V = h.queries[0]!.sentAt;
    // A renewal is sent at V + L/2; the revocation commits right after it.
    h.advance(L / 2);
    h.lease.frame("to-container", "renewing");
    expect(h.queries).toHaveLength(2);
    const renewal = h.queries[1]!;
    // Its "valid" arrives only after V' + L, V' being the renewal's send time.
    h.advance(L);
    h.lease.frame("to-browser", "after-lease");
    await renewal.answer("valid");
    expect(h.forwarded.every((f) => f.at < renewal.sentAt + L)).toBe(true);
    expect(h.data()).not.toContain("after-lease");
    // The next query, sent after the lapse, reads the revocation.
    expect(h.queries).toHaveLength(3);
    await h.queries[2]!.answer("revoked");
    expect(h.closes).toEqual([
      { at: h.now, code: PREVIEW_SOCKET_CLOSE_REVOKED },
    ]);
    expect(h.data()).not.toContain("after-lease");
    expect(h.forwarded.every((f) => f.at < V + L + L / 2)).toBe(true);
  });

  it("a late 'valid' never extends an expired lease, and never moves V back", async () => {
    const h = await verifiedHarness();
    h.advance(L / 2);
    h.lease.frame("to-container", "x"); // starts renewal R1 at V + L/2
    const r1 = h.queries[1]!;
    h.advance(L / 2 + 1); // lapsed
    h.lease.frame("to-container", "held");
    await r1.answer("valid"); // sent before the lapse: releases nothing
    expect(h.data()).toEqual(["x"]);
    expect(h.queries).toHaveLength(3);
    const r2 = h.queries[2]!;
    await r2.answer("valid");
    expect(h.data()).toEqual(["x", "held"]);

    // An older query's "valid" arriving now does not move V back to its time.
    h.advance(L - 1);
    h.lease.frame("to-browser", "still-in-lease");
    expect(h.data()).toContain("still-in-lease");
  });

  it("keeps frames in order: a lease renewed while frames are held does not let newer frames pass them", async () => {
    const h = await verifiedHarness();
    h.advance(L / 2);
    h.lease.frame("to-container", "a"); // renewal R1 sent at V + L/2
    const r1 = h.queries[1]!;
    h.advance(L / 2); // lapsed
    h.lease.frame("to-browser", "b"); // held
    await r1.answer("valid"); // the lease holds again until R1 + L
    h.lease.frame("to-container", "c"); // must wait behind b
    expect(h.data()).toEqual(["a"]);
    await h.queries[2]!.answer("valid");
    expect(h.data()).toEqual(["a", "b", "c"]);
  });

  it("a pushed notice closes at once, and an older 'valid' released after it changes nothing", async () => {
    const h = await verifiedHarness();
    h.advance(L / 2);
    h.lease.frame("to-container", "x");
    const older = h.queries[1]!;
    h.advance(1);
    h.lease.notice();
    expect(h.closes).toEqual([
      { at: h.now, code: PREVIEW_SOCKET_CLOSE_REVOKED },
    ]);
    await older.answer("valid");
    h.lease.frame("to-browser", "after-notice");
    h.lease.frame("to-container", "after-notice");
    expect(h.data()).toEqual(["x"]);
    expect(h.closes).toHaveLength(1);
  });

  it.each([
    ["D1 throws during a renewal", new Error("D1_ERROR")],
    ["the renewal reads unavailable", "unavailable" as const],
  ])(
    "stops forwarding and drops what it holds when %s",
    async (_name, answer) => {
      const h = await verifiedHarness();
      h.advance(L);
      h.lease.frame("to-container", "held-up");
      h.lease.frame("to-browser", "held-down");
      await h.queries[1]!.answer(answer);
      expect(h.closes).toEqual([
        { at: h.now, code: PREVIEW_SOCKET_CLOSE_UNAVAILABLE },
      ]);
      h.lease.frame("to-container", "after");
      expect(h.forwarded).toEqual([]);
    },
  );

  it("a verification that throws before it is sent closes 4503", () => {
    const closes: number[] = [];
    registerPreviewSocketLease({
      now: () => 0,
      verify: () => {
        throw new Error("no binding");
      },
      forward: () => {
        throw new Error("nothing may be forwarded");
      },
      close: (code) => closes.push(code),
    });
    return Promise.resolve().then(() =>
      expect(closes).toEqual([PREVIEW_SOCKET_CLOSE_UNAVAILABLE]),
    );
  });

  it("revoked at the renewal: closes 4401 and forwards none of what it held", async () => {
    const h = await verifiedHarness();
    h.lease.frame("to-container", "ok");
    h.advance(L);
    h.lease.frame("to-container", "held");
    await h.queries[1]!.answer("revoked");
    expect(h.closes.map((c) => c.code)).toEqual([PREVIEW_SOCKET_CLOSE_REVOKED]);
    expect(h.data()).toEqual(["ok"]);
  });

  it("closes 4503 at the held-frame cap and forwards nothing it held", async () => {
    const h = await verifiedHarness({ maxHeldFrames: 3 });
    h.advance(L);
    for (const n of [1, 2, 3, 4]) h.lease.frame("to-browser", `f${n}`);
    expect(h.closes.map((c) => c.code)).toEqual([
      PREVIEW_SOCKET_CLOSE_UNAVAILABLE,
    ]);
    await h.queries[1]!.answer("valid");
    expect(h.forwarded).toEqual([]);
  });

  it("closes 4503 at the held-byte cap, counting binary and text by bytes", async () => {
    const h = await verifiedHarness({ maxHeldBytes: 10 });
    h.advance(L);
    h.lease.frame("to-container", new ArrayBuffer(6));
    expect(h.closes).toEqual([]);
    h.lease.frame("to-container", "é".repeat(3)); // 6 bytes
    expect(h.closes.map((c) => c.code)).toEqual([
      PREVIEW_SOCKET_CLOSE_UNAVAILABLE,
    ]);
    expect(h.forwarded).toEqual([]);
  });

  it("with the notice lost, an idle socket's tick verifies the lapsed lease and closes on revocation", async () => {
    const h = await verifiedHarness();
    h.advance(L - 1);
    h.lease.tick();
    expect(h.queries).toHaveLength(1);
    h.advance(1);
    h.lease.tick();
    expect(h.queries).toHaveLength(2);
    await h.queries[1]!.answer("revoked");
    expect(h.closes.map((c) => c.code)).toEqual([PREVIEW_SOCKET_CLOSE_REVOKED]);
  });

  it("forwards nothing once the socket closed on its own", async () => {
    const h = await verifiedHarness();
    h.lease.dispose();
    h.lease.frame("to-container", "x");
    expect(h.forwarded).toEqual([]);
    expect(h.closes).toEqual([]);
  });

  it("without a first verification it forwards nothing, ever", () => {
    const h = harness({ register: false });
    h.lease.frame("to-container", "x");
    expect(h.forwarded).toEqual([]);
    expect(h.queries).toHaveLength(1);
  });

  /**
   * The bound, with no pushed notice: whatever order frames, ticks and D1
   * answers come in, no frame is forwarded at or after R + L. D1 answers
   * "valid" to a query sent before R and "revoked" to one sent at or after
   * it (assumption 1: reads go to the primary).
   */
  it("never forwards at or after R + L, over seeded random interleavings", async () => {
    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let run = 0; run < 300; run++) {
      const h = harness();
      const R = h.now + Math.floor(random() * 3 * L);
      const answered = new Set<number>();
      for (let step = 0; step < 120 && !h.lease.closed; step++) {
        const roll = random();
        if (roll < 0.4) {
          h.lease.frame(
            random() < 0.5 ? "to-container" : "to-browser",
            `s${step}`,
          );
        } else if (roll < 0.55) {
          h.lease.tick();
        } else if (roll < 0.85) {
          const pending = h.queries
            .map((q, i) => [q, i] as const)
            .filter(([, i]) => !answered.has(i));
          if (pending.length) {
            const [q, i] = pending[Math.floor(random() * pending.length)]!;
            answered.add(i);
            const outcome =
              random() < 0.05
                ? new Error("D1")
                : q.sentAt < R
                  ? "valid"
                  : "revoked";
            await q.answer(outcome);
          }
        }
        h.advance(Math.floor(random() * L * 0.4));
      }
      for (const f of h.forwarded) {
        expect(f.at, `run ${run}`).toBeLessThan(R + L);
      }
    }
  });
});
