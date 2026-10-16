import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInstanceContentReplay,
  INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS,
  instanceReplaySection,
  type InstanceReplayFrame,
} from "./preview-instance-content";
import type { ContentSnapshot } from "./content-write-snapshot";
import type {
  PendingContentEntry,
  PendingFieldEdit,
} from "./pending-content-write";

const GEN = 4;

const snapshot = (
  props: Record<string, unknown>,
  options: { draftGeneration?: number; ownSince?: number; enabled?: boolean } = {},
): ContentSnapshot => ({
  draftGeneration: options.draftGeneration ?? 10,
  ownSince: options.ownSince ?? 10,
  sections: [
    {
      id: "hero",
      props,
      ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    },
  ],
});

const field = (
  value: unknown,
  extra: Partial<PendingFieldEdit> = {},
): PendingFieldEdit => ({ value, sourceGeneration: GEN, ...extra });

const pending = (
  fields: Record<string, PendingFieldEdit>,
  props: Record<string, unknown> = {},
): PendingContentEntry => ({
  sectionId: "hero",
  props: {
    ...props,
    ...Object.fromEntries(
      Object.entries(fields)
        .filter(([path]) => !path.includes("."))
        .map(([path, f]) => [path, f.value]),
    ),
  },
  fields,
});

const replay = (args: {
  snapshot?: ContentSnapshot;
  pending?: PendingContentEntry;
  unconfirmed?: PendingContentEntry;
}) =>
  instanceReplaySection({
    snapshot: args.snapshot,
    sectionId: "hero",
    pending: args.pending,
    unconfirmed: args.unconfirmed,
    sourceGeneration: GEN,
  });

describe("instanceReplaySection", () => {
  it("sends the latest accepted section, with its visibility", () => {
    expect(
      replay({ snapshot: snapshot({ heading: "Saved" }, { enabled: false }) }),
    ).toEqual({ props: { heading: "Saved" }, enabled: false });
  });

  it("puts a pending field the write path would send on top", () => {
    expect(
      replay({
        snapshot: snapshot({ heading: "Saved", body: "B" }),
        pending: pending({ heading: field("Typed", { basisDraftGeneration: 10 }) }),
      }),
    ).toEqual({ props: { heading: "Typed", body: "B" } });
  });

  it("leaves a field the source refused to the Inspector", () => {
    expect(
      replay({
        snapshot: snapshot({ heading: "Saved" }),
        pending: pending({ heading: field("Typed", { rejected: true }) }),
      }),
    ).toEqual({ props: { heading: "Saved" } });
  });

  it("does not use a field captured on an older source generation", () => {
    expect(
      replay({
        snapshot: snapshot({ heading: "Saved" }),
        pending: pending({ heading: field("Typed", { sourceGeneration: GEN - 1 }) }),
      }),
    ).toEqual({ props: { heading: "Saved" } });
  });

  it("does not use a field made on a copy someone else has written over since", () => {
    // Made on 8; every step from 10 on was ours, but 8 -> 10 was not.
    expect(
      replay({
        snapshot: snapshot({ heading: "Theirs" }, { draftGeneration: 10, ownSince: 9 }),
        pending: pending({ heading: field("Typed", { basisDraftGeneration: 8 }) }),
      }),
    ).toEqual({ props: { heading: "Theirs" } });
    // The same field made within the own range is used.
    expect(
      replay({
        snapshot: snapshot({ heading: "Ours" }, { draftGeneration: 10, ownSince: 8 }),
        pending: pending({ heading: field("Typed", { basisDraftGeneration: 8 }) }),
      }),
    ).toEqual({ props: { heading: "Typed" } });
  });

  it("does not use a row field whose row is no longer at its path", () => {
    const items = [
      { id: "b", title: "B" },
      { id: "a", title: "A" },
    ];
    const typedInA = field("A typed", {
      rows: [{ rowPath: "items.0", id: "a" }],
    });
    expect(
      replay({
        snapshot: snapshot({ items }),
        pending: pending({ "items.0.title": typedInA }, { items }),
      }),
    ).toEqual({ props: { items } });
    // Where the row still is, the field is used.
    const same = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ];
    expect(
      replay({
        snapshot: snapshot({ items: same }),
        pending: pending({ "items.0.title": typedInA }, { items: same }),
      }),
    ).toEqual({
      props: {
        items: [
          { id: "a", title: "A typed" },
          { id: "b", title: "B" },
        ],
      },
    });
  });

  it("does not use a child field under a parent edit that is not current", () => {
    expect(
      replay({
        snapshot: snapshot({ card: { title: "Saved" } }),
        pending: pending(
          {
            card: field({ title: "Old" }, { sourceGeneration: GEN - 1 }),
            "card.title": field("Typed"),
          },
          { card: { title: "Typed" } },
        ),
      }),
    ).toEqual({ props: { card: { title: "Saved" } } });
  });

  it("lets the server decide the input an unanswered write sent", () => {
    const sentField = field("Sent", { basisDraftGeneration: 10 });
    const sent = pending({ heading: sentField });
    // Not landed, as far as the read says: the accepted value.
    expect(
      replay({
        snapshot: snapshot({ heading: "Saved" }),
        pending: sent,
        unconfirmed: sent,
      }),
    ).toEqual({ props: { heading: "Saved" } });
    // Landed: the read holds it, so the canvas does.
    expect(
      replay({
        snapshot: snapshot({ heading: "Sent" }),
        pending: sent,
        unconfirmed: sent,
      }),
    ).toEqual({ props: { heading: "Sent" } });
    // A field typed after it is ordinary pending input.
    const later = pending({
      heading: sentField,
      body: field("Later", { basisDraftGeneration: 10 }),
    });
    expect(
      replay({
        snapshot: snapshot({ heading: "Saved", body: "B" }),
        pending: later,
        unconfirmed: sent,
      }),
    ).toEqual({ props: { heading: "Saved", body: "Later" } });
  });

  it("sends nothing for a section neither accepted nor pending", () => {
    expect(replay({})).toBeNull();
    expect(
      replay({ pending: pending({ heading: field("Typed", { rejected: true }) }) }),
    ).toBeNull();
  });
});

function replayHarness(options: { confirmTimeoutMs?: number } = {}) {
  let current: InstanceReplayFrame | null = {
    key: "frame-0",
    round: 1,
    routePath: "/",
  };
  const reads: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  const replays: Array<{
    frame: InstanceReplayFrame;
    isCurrent: () => boolean;
  }> = [];
  const logs: string[] = [];
  let readFailures = 0;
  let unconfirmed = 0;
  let nextRequest = 0;
  const replay = createInstanceContentReplay({
    readLatest: () =>
      new Promise<void>((resolve, reject) => reads.push({ resolve, reject })),
    replay: (frame, isCurrent) => replays.push({ frame, isCurrent }),
    onReadFailed: () => {
      readFailures += 1;
    },
    onUnconfirmed: () => {
      unconfirmed += 1;
    },
    current: () => current,
    log: (line) => logs.push(line),
    ...options,
  });
  return {
    replay,
    reads,
    replays,
    logs,
    readFailures: () => readFailures,
    unconfirmed: () => unconfirmed,
    givenUp: () =>
      logs.filter((line) => line.startsWith("[preview-instance] content replay given up")),
    set(next: Partial<InstanceReplayFrame> | null) {
      current = next === null ? null : { ...current!, ...next };
    },
    /** The reloaded frame comes up as ready round 2. */
    ready() {
      this.set({ round: 2 });
      replay.frameReady("frame-0", 2);
    },
    /** The editor sends that frame `routePath`; returns the request id. */
    sendRoute(routePath = "/") {
      this.set({ routePath });
      nextRequest += 1;
      replay.routeSent("frame-0", 2, routePath, nextRequest);
      return nextRequest;
    },
    /** The route is sent, and the frame confirms it is there. */
    onRoute(routePath = "/") {
      const request = this.sendRoute(routePath);
      replay.routeApplied("frame-0", 2, request, routePath);
      return request;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createInstanceContentReplay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads once the reloaded frame is up, not when the reload is decided", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    expect(h.reads).toHaveLength(0);
    h.ready();
    expect(h.reads).toHaveLength(1);
    // More ready rounds or route reports read nothing more.
    h.replay.structure("frame-0", 2, "/");
    const request = h.onRoute();
    h.replay.routeApplied("frame-0", 2, request, "/");
    expect(h.reads).toHaveLength(1);
  });

  it("replays once when the read lands before the frame is on its route", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    h.reads[0]!.resolve();
    await settle();
    expect(h.replays).toHaveLength(0);
    const request = h.onRoute();
    expect(h.replays.map((r) => r.frame)).toEqual([
      { key: "frame-0", round: 2, routePath: "/" },
    ]);
    // More confirmations, and more reports, send nothing more.
    h.replay.routeApplied("frame-0", 2, request, "/");
    h.replay.structure("frame-0", 2, "/");
    expect(h.replays).toHaveLength(1);
  });

  it("replays once when the frame is on its route before the read lands", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    const request = h.onRoute();
    expect(h.replays).toHaveLength(0);
    h.reads[0]!.resolve();
    await settle();
    expect(h.replays).toHaveLength(1);
    h.replay.routeApplied("frame-0", 2, request, "/");
    expect(h.replays).toHaveLength(1);
  });

  it("sends nothing and says so when the read fails", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    const request = h.onRoute();
    h.reads[0]!.reject(new Error("offline"));
    await settle();
    expect(h.replays).toHaveLength(0);
    expect(h.readFailures()).toBe(1);
    h.replay.routeApplied("frame-0", 2, request, "/");
    expect(h.replays).toHaveLength(0);
    expect(h.readFailures()).toBe(1);
  });

  it("waits for the reloaded frame, not a report from the one it replaces", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    // The old frame, still round 1, sent its route and confirming it.
    h.replay.routeSent("frame-0", 1, "/", 1);
    h.replay.routeApplied("frame-0", 1, 1, "/");
    h.replay.structure("frame-0", 1, "/");
    expect(h.reads).toHaveLength(0);
    expect(h.replays).toHaveLength(0);
  });

  it("is dropped when the frame comes up on another route", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    h.reads[0]!.resolve();
    await settle();
    h.onRoute("/about");
    expect(h.replays).toHaveLength(0);
    // Back on the original route in the same frame: still nothing.
    h.onRoute("/");
    expect(h.replays).toHaveLength(0);
  });

  it("is dropped when the route changes before the read lands", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    h.onRoute();
    h.set({ routePath: "/about" });
    h.reads[0]!.resolve();
    await settle();
    expect(h.replays).toHaveLength(0);
  });

  it("is dropped when another frame comes up first", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    // Replaced again, for another reason, before confirming its route.
    h.set({ round: 3 });
    h.replay.frameReady("frame-0", 3);
    h.replay.routeSent("frame-0", 3, "/", 1);
    h.replay.routeApplied("frame-0", 3, 1, "/");
    h.reads[0]!.resolve();
    await settle();
    expect(h.replays).toHaveLength(0);
  });

  it("is dropped when the frame comes up under another key", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.set({ key: "frame-1", round: 2 });
    h.replay.frameReady("frame-1", 2);
    h.replay.routeSent("frame-1", 2, "/", 1);
    h.replay.routeApplied("frame-1", 2, 1, "/");
    expect(h.reads).toHaveLength(0);
    expect(h.replays).toHaveLength(0);
  });

  it("tells a late post that its frame, round or route is gone", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    h.reads[0]!.resolve();
    await settle();
    h.onRoute();
    const { isCurrent } = h.replays[0]!;
    expect(isCurrent()).toBe(true);
    h.set({ routePath: "/about" });
    expect(isCurrent()).toBe(false);
    h.set({ routePath: "/", round: 3 });
    expect(isCurrent()).toBe(false);
    h.set({ round: 2, key: "frame-1" });
    expect(isCurrent()).toBe(false);
    h.set({ key: "frame-0" });
    expect(isCurrent()).toBe(true);
    h.replay.dispose();
    expect(isCurrent()).toBe(false);
  });

  it("does nothing after it is disposed", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    h.replay.dispose();
    h.onRoute();
    h.reads[0]!.resolve();
    await settle();
    expect(h.replays).toHaveLength(0);
  });

  it("does nothing for a frame no reload armed it for", () => {
    const h = replayHarness();
    h.ready();
    h.onRoute();
    expect(h.replays).toHaveLength(0);
    expect(h.reads).toHaveLength(0);
  });

  describe("only the frame's own confirmation of the route releases it", () => {
    /** Reloaded on `routePath`, frame up, read landed: only the route is missing. */
    async function waitingForRoute(routePath: string, options = {}) {
      const h = replayHarness(options);
      h.replay.frameReloaded("frame-0", 1, routePath);
      h.ready();
      h.reads[0]!.resolve();
      await settle();
      return h;
    }

    it("is not released by set-route having been sent", async () => {
      const h = await waitingForRoute("/inline-reload-defer");
      h.sendRoute("/inline-reload-defer");
      expect(h.replays).toHaveLength(0);
    });

    it("is not released by a report that names no route", async () => {
      const h = await waitingForRoute("/inline-reload-defer");
      h.replay.structure("frame-0", 2, undefined);
      h.sendRoute("/inline-reload-defer");
      h.replay.structure("frame-0", 2, undefined);
      expect(h.replays).toHaveLength(0);
    });

    it("is not released by a structure report, even one naming the route", async () => {
      // Sent before the route was set, a report names the page the frame booted
      // on; after, it is still not an answer to the request.
      const h = await waitingForRoute("/");
      h.replay.structure("frame-0", 2, "/");
      expect(h.replays).toHaveLength(0);
      h.sendRoute("/");
      h.replay.structure("frame-0", 2, "/");
      expect(h.replays).toHaveLength(0);
      expect(h.givenUp()).toEqual([]);
    });

    it("waits through a slow navigation, then replays exactly once", async () => {
      const h = await waitingForRoute("/inline-reload-defer");
      const request = h.sendRoute("/inline-reload-defer");
      // The boot page reports on the way: neither releases nor gives up.
      h.replay.structure("frame-0", 2, "/");
      await settle();
      expect(h.replays).toHaveLength(0);
      h.replay.routeApplied("frame-0", 2, request, "/inline-reload-defer");
      expect(h.replays.map((r) => r.frame)).toEqual([
        { key: "frame-0", round: 2, routePath: "/inline-reload-defer" },
      ]);
      h.replay.routeApplied("frame-0", 2, request, "/inline-reload-defer");
      expect(h.replays).toHaveLength(1);
    });

    it("compares route patterns the way the router spells them", async () => {
      const h = await waitingForRoute("/products");
      const request = h.sendRoute("/products");
      h.replay.routeApplied("frame-0", 2, request, "/products/");
      expect(h.replays).toHaveLength(1);
    });

    it("ignores an answer to an older request, and to none", async () => {
      const h = await waitingForRoute("/inline-reload-defer");
      // Answers before any request this round.
      h.replay.routeApplied("frame-0", 2, 0, "/inline-reload-defer");
      const older = h.sendRoute("/inline-reload-defer");
      const latest = h.sendRoute("/inline-reload-defer");
      h.replay.routeApplied("frame-0", 2, older, "/inline-reload-defer");
      expect(h.replays).toHaveLength(0);
      h.replay.routeApplied("frame-0", 2, latest, "/inline-reload-defer");
      expect(h.replays).toHaveLength(1);
    });

    it("waits for the answer to the latest request after one was confirmed", async () => {
      const h = replayHarness();
      h.replay.frameReloaded("frame-0", 1, "/");
      h.ready();
      const first = h.onRoute();
      // The route is sent again before the read lands.
      const second = h.sendRoute("/");
      h.reads[0]!.resolve();
      await settle();
      expect(h.replays).toHaveLength(0);
      h.replay.routeApplied("frame-0", 2, first, "/");
      expect(h.replays).toHaveLength(0);
      h.replay.routeApplied("frame-0", 2, second, "/");
      expect(h.replays).toHaveLength(1);
    });

    it("ignores an answer from an earlier ready round or another frame", async () => {
      const h = await waitingForRoute("/inline-reload-defer");
      const request = h.sendRoute("/inline-reload-defer");
      h.replay.routeApplied("frame-0", 1, request, "/inline-reload-defer");
      h.replay.routeApplied("frame-1", 2, request, "/inline-reload-defer");
      expect(h.replays).toHaveLength(0);
      expect(h.givenUp()).toEqual([]);
    });

    it("gives up, and says so, when the frame confirms another route", async () => {
      const h = await waitingForRoute("/inline-reload-defer");
      const request = h.sendRoute("/inline-reload-defer");
      h.replay.routeApplied("frame-0", 2, request, "/");
      expect(h.replays).toHaveLength(0);
      expect(h.givenUp()).toHaveLength(1);
      expect(h.unconfirmed()).toBe(1);
      h.replay.routeApplied("frame-0", 2, request, "/inline-reload-defer");
      expect(h.replays).toHaveLength(0);
      expect(h.unconfirmed()).toBe(1);
    });

    describe("an answer of null: the frame has no router", () => {
      it("releases a frame that never named a route", async () => {
        const h = await waitingForRoute("/");
        h.replay.structure("frame-0", 2, undefined);
        const request = h.sendRoute("/");
        h.replay.routeApplied("frame-0", 2, request, null);
        expect(h.replays).toHaveLength(1);
      });

      it("does not confirm the target of a frame that named a route", async () => {
        const h = await waitingForRoute("/inline-reload-defer");
        // A router frame: its boot page named a route.
        h.replay.structure("frame-0", 2, "/");
        const request = h.sendRoute("/inline-reload-defer");
        h.replay.routeApplied("frame-0", 2, request, null);
        expect(h.replays).toHaveLength(0);
        expect(h.givenUp()).toHaveLength(1);
        expect(h.unconfirmed()).toBe(1);
      });

      it("does not confirm the target of a frame that confirmed a route before", async () => {
        const h = replayHarness();
        h.replay.frameReloaded("frame-0", 1, "/");
        h.ready();
        h.onRoute("/");
        const again = h.sendRoute("/");
        h.replay.routeApplied("frame-0", 2, again, null);
        h.reads[0]!.resolve();
        await settle();
        expect(h.replays).toHaveLength(0);
        expect(h.unconfirmed()).toBe(1);
      });
    });

    describe("when no confirmation comes", () => {
      it("gives up once, with a notice, after the wait (a frame on an older bridge)", async () => {
        vi.useFakeTimers();
        const h = replayHarness({ confirmTimeoutMs: 1_000 });
        h.replay.frameReloaded("frame-0", 1, "/inline-reload-defer");
        h.ready();
        h.reads[0]!.resolve();
        await vi.advanceTimersByTimeAsync(0);
        const request = h.sendRoute("/inline-reload-defer");
        await vi.advanceTimersByTimeAsync(999);
        expect(h.unconfirmed()).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.replays).toHaveLength(0);
        expect(h.givenUp()).toEqual([
          "[preview-instance] content replay given up | the frame did not confirm its route in time",
        ]);
        expect(h.unconfirmed()).toBe(1);
        expect(h.readFailures()).toBe(0);
        // A late answer changes nothing; nor does more time.
        h.replay.routeApplied("frame-0", 2, request, "/inline-reload-defer");
        await vi.advanceTimersByTimeAsync(10_000);
        expect(h.replays).toHaveLength(0);
        expect(h.unconfirmed()).toBe(1);
      });

      it("counts the wait from when the frame came up, with or without a route sent", async () => {
        vi.useFakeTimers();
        const h = replayHarness({ confirmTimeoutMs: 1_000 });
        h.replay.frameReloaded("frame-0", 1, "/");
        await vi.advanceTimersByTimeAsync(5_000);
        expect(h.unconfirmed()).toBe(0);
        h.ready();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(h.unconfirmed()).toBe(1);
      });

      it("says nothing once it replayed, was dropped, or was disposed", async () => {
        vi.useFakeTimers();
        const replayed = replayHarness({ confirmTimeoutMs: 1_000 });
        replayed.replay.frameReloaded("frame-0", 1, "/");
        replayed.ready();
        replayed.onRoute();
        replayed.reads[0]!.resolve();
        const dropped = replayHarness({ confirmTimeoutMs: 1_000 });
        dropped.replay.frameReloaded("frame-0", 1, "/");
        dropped.ready();
        dropped.replay.frameReady("frame-0", 3);
        const disposed = replayHarness({ confirmTimeoutMs: 1_000 });
        disposed.replay.frameReloaded("frame-0", 1, "/");
        disposed.ready();
        disposed.replay.dispose();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(replayed.replays).toHaveLength(1);
        for (const h of [replayed, dropped, disposed]) {
          expect(h.unconfirmed()).toBe(0);
          expect(h.givenUp()).toEqual([]);
        }
      });

      it("waits by default for the exported time", async () => {
        vi.useFakeTimers();
        const h = replayHarness();
        h.replay.frameReloaded("frame-0", 1, "/");
        h.ready();
        await vi.advanceTimersByTimeAsync(INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS - 1);
        expect(h.unconfirmed()).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.unconfirmed()).toBe(1);
      });
    });
  });
});
