import { describe, expect, it } from "vitest";
import {
  createInstanceContentReplay,
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

function replayHarness() {
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
  const replay = createInstanceContentReplay({
    readLatest: () =>
      new Promise<void>((resolve, reject) => reads.push({ resolve, reject })),
    replay: (frame, isCurrent) => replays.push({ frame, isCurrent }),
    onReadFailed: () => {
      readFailures += 1;
    },
    current: () => current,
    log: (line) => logs.push(line),
  });
  return {
    replay,
    reads,
    replays,
    logs,
    readFailures: () => readFailures,
    set(next: Partial<InstanceReplayFrame> | null) {
      current = next === null ? null : { ...current!, ...next };
    },
    /** The reloaded frame comes up as ready round 2. */
    ready() {
      this.set({ round: 2 });
      replay.frameReady("frame-0", 2);
    },
    /** That frame reports being on `routePath`, now the route on screen. */
    onRoute(routePath = "/") {
      this.set({ routePath });
      replay.structure("frame-0", 2, routePath);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createInstanceContentReplay", () => {
  it("reads once the reloaded frame is up, not when the reload is decided", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    expect(h.reads).toHaveLength(0);
    h.ready();
    expect(h.reads).toHaveLength(1);
    // More ready rounds or route reports read nothing more.
    h.replay.structure("frame-0", 2, "/");
    expect(h.reads).toHaveLength(1);
  });

  it("replays once when the read lands before the frame is on its route", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    h.reads[0]!.resolve();
    await settle();
    expect(h.replays).toHaveLength(0);
    h.onRoute();
    expect(h.replays.map((r) => r.frame)).toEqual([
      { key: "frame-0", round: 2, routePath: "/" },
    ]);
    // More reports of the route send nothing more.
    h.replay.structure("frame-0", 2, "/");
    expect(h.replays).toHaveLength(1);
  });

  it("replays once when the frame is on its route before the read lands", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    h.onRoute();
    expect(h.replays).toHaveLength(0);
    h.reads[0]!.resolve();
    await settle();
    expect(h.replays).toHaveLength(1);
    h.replay.structure("frame-0", 2, "/");
    expect(h.replays).toHaveLength(1);
  });

  it("sends nothing and says so when the read fails", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.ready();
    h.onRoute();
    h.reads[0]!.reject(new Error("offline"));
    await settle();
    expect(h.replays).toHaveLength(0);
    expect(h.readFailures()).toBe(1);
    h.replay.structure("frame-0", 2, "/");
    expect(h.replays).toHaveLength(0);
    expect(h.readFailures()).toBe(1);
  });

  it("waits for the reloaded frame, not a report from the one it replaces", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    // The old frame, still round 1, reporting its route.
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
    // Replaced again, for another reason, before reporting its route.
    h.set({ round: 3 });
    h.replay.frameReady("frame-0", 3);
    h.replay.structure("frame-0", 3, "/");
    h.reads[0]!.resolve();
    await settle();
    expect(h.replays).toHaveLength(0);
  });

  it("is dropped when the frame comes up under another key", async () => {
    const h = replayHarness();
    h.replay.frameReloaded("frame-0", 1, "/");
    h.set({ key: "frame-1", round: 2 });
    h.replay.frameReady("frame-1", 2);
    h.replay.structure("frame-1", 2, "/");
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
});
