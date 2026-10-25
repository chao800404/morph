import { describe, expect, it, vi } from "vitest";
import { themePreviewContentModuleSource } from "@/lib/storefront/compiler/theme-preview-content";
import { applyPreviewSectionProps } from "./preview-protocol";
import {
  newestAcceptedCopy,
  snapshotSectionProps,
  type ContentSnapshot,
} from "./content-write-snapshot";
import {
  compactSectionUpdates,
  flushDeferredQueue,
  initialDeferralState,
  rebuildCommittedSections,
  stepDeferral,
  type DeferralEvent,
  type DeferralState,
  type PreviewUpdateEntry,
  type RebuildSource,
  type SectionUpdateEntry,
} from "./preview-update-queue";

// ---------------------------------------------------------------------------
// Receivers
// ---------------------------------------------------------------------------

type BridgeContent = {
  slots: Record<string, Record<string, unknown>>;
  hiddenSlots: string[];
};
type BridgeUpdate = (
  sectionId: string,
  props: unknown,
  enabled: unknown,
  resetKeys: unknown,
) => void;

const UPDATE_START = "export function updatePreviewContent";
const UPDATE_END = "\n// Below `updatePreviewContent`";

/** `updatePreviewContent` exactly as Morph emits it into a preview page now. */
function emittedUpdateSource(): string {
  const source = themePreviewContentModuleSource();
  const start = source.indexOf(UPDATE_START);
  const end = source.indexOf(UPDATE_END);
  if (start < 0 || end <= start) {
    throw new Error("the preview content module no longer has updatePreviewContent where this test reads it");
  }
  return source.slice(start, end).replace(UPDATE_START, "function updatePreviewContent");
}

/**
 * The receiver a preview workspace written before #257 still runs: the same
 * emitted text without #257's one branch, which ignores a post with
 * `enabled` undefined to a hidden slot. Built from the real text, so the rest
 * of the function cannot drift from what Morph emits.
 */
const HIDDEN_BRANCH =
  /  \} else if \(content\.hiddenSlots\.includes\(sectionId\)\) \{\n(?:    \/\/[^\n]*\n)*    return;\n  \}\n/;
function pre257UpdateSource(): string {
  const source = emittedUpdateSource();
  if (source.split(HIDDEN_BRANCH).length !== 2) {
    throw new Error("#257's hidden-slot branch is not in the emitted updatePreviewContent exactly once");
  }
  return source.replace(HIDDEN_BRANCH, "  }\n");
}

function bridgeReceiver(source: string, content: BridgeContent): BridgeUpdate {
  return new Function(
    "currentPreviewContent",
    `${source}\nreturn updatePreviewContent;`,
  )(() => content) as BridgeUpdate;
}

/** The section the bridge's selection-field post writes to (its `selectedItem`). */
const SELECTED = "s1";

function applyToBridge(
  source: string,
  initial: BridgeContent,
  entries: readonly PreviewUpdateEntry[],
): BridgeContent {
  const content: BridgeContent = structuredClone(initial);
  const update = bridgeReceiver(source, content);
  for (const entry of entries) {
    if (entry.kind === "section") {
      update(entry.sectionId, entry.props, entry.enabled, entry.resetKeys);
    } else {
      // theme-preview-bridge-entry.ts, the update-selection-field handler:
      // the named slot's values with the field set, through
      // updatePreviewContent (the generator names the selected section).
      // Keys in this test are top-level, so the field path is the key.
      update(
        entry.sectionId,
        {
          ...(content.slots[entry.sectionId] ?? {}),
          [entry.fieldPath ?? entry.fieldKey]: entry.value,
        },
        undefined,
        undefined,
      );
    }
  }
  return content;
}

type BuiltInDocument = {
  sections: { id: string; enabled?: boolean; props?: Record<string, unknown> | null }[];
};

function applyToBuiltIn(
  initial: BuiltInDocument,
  entries: readonly PreviewUpdateEntry[],
): BuiltInDocument {
  let document = structuredClone(initial);
  for (const entry of entries) {
    // The built-in route applies a selection-field post to the element, not
    // to its document: nothing to model here.
    if (entry.kind !== "section") continue;
    document = applyPreviewSectionProps(document, {
      sectionId: entry.sectionId,
      props: entry.props as Record<string, never> | undefined,
      enabled: entry.enabled,
      resetKeys: entry.resetKeys,
    }).document;
  }
  return document;
}

// ---------------------------------------------------------------------------
// Seeded generator (no dependency: mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ["a", "b", "c", "d"] as const;
const SECTIONS = ["s1", "s2", "s3"] as const;

function generator(seed: number) {
  const random = mulberry32(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const chance = (p: number) => random() < p;
  const someKeys = () => KEYS.filter(() => chance(0.4));
  const someProps = () =>
    Object.fromEntries(someKeys().map((key) => [key, Math.floor(random() * 4)]));

  const entry = (): PreviewUpdateEntry => {
    if (chance(0.12)) {
      return {
        kind: "field",
        sectionId: SELECTED,
        fieldKey: pick(KEYS),
        fieldPath: chance(0.5) ? pick(KEYS) : null,
        value: `v${Math.floor(random() * 3)}`,
      };
    }
    const enabledRoll = random();
    return {
      kind: "section",
      // Mostly one section, so runs to merge are common.
      sectionId: chance(0.7) ? "s1" : pick(SECTIONS),
      ...(chance(0.75) ? { props: someProps() } : {}),
      ...(enabledRoll < 0.15 ? { enabled: false } : enabledRoll < 0.3 ? { enabled: true } : {}),
      ...(chance(0.45) ? { resetKeys: someKeys() } : {}),
      ...(chance(0.05) ? { stillCurrent: () => true } : {}),
    };
  };
  const sequence = () => Array.from({ length: 1 + Math.floor(random() * 10) }, entry);

  const bridgeContent = (): BridgeContent => {
    const slots: BridgeContent["slots"] = {};
    for (const id of SECTIONS) if (chance(0.7)) slots[id] = someProps();
    return { slots, hiddenSlots: SECTIONS.filter((id) => !slots[id] && chance(0.5)) };
  };
  const builtInDocument = (): BuiltInDocument => ({
    sections: SECTIONS.map((id) => ({
      id,
      ...(chance(0.8) ? { enabled: chance(0.7) } : {}),
      props: chance(0.15) ? null : someProps(),
    })),
  });
  return { sequence, bridgeContent, builtInDocument };
}

const CASES = 4000;

// ---------------------------------------------------------------------------
// P1: M2 is exact under both receivers
// ---------------------------------------------------------------------------

describe("compactSectionUpdates (M2)", () => {
  it("evaluates the bridge's real emitted function, and the pre-#257 variant differs only by its branch", () => {
    const emitted = emittedUpdateSource();
    expect(emitted).toContain("function updatePreviewContent(sectionId, props, enabled, resetKeys)");
    const pre257 = pre257UpdateSource();
    expect(pre257.length).toBeLessThan(emitted.length);
    // The emitted one really does ignore a post to a hidden slot; the older one does not.
    const content: BridgeContent = { slots: {}, hiddenSlots: ["s1"] };
    bridgeReceiver(emitted, content)("s1", { a: 1 }, undefined, undefined);
    expect(content.slots).toEqual({});
    bridgeReceiver(pre257, content)("s1", { a: 1 }, undefined, undefined);
    expect(content.slots).toEqual({ s1: { a: 1 } });
  });

  it("design §2 example 1: reset then set ends with the set", () => {
    const entries: PreviewUpdateEntry[] = [
      { kind: "section", sectionId: "s1", props: { a: 1 } },
      { kind: "section", sectionId: "s1", resetKeys: ["a"] },
      { kind: "section", sectionId: "s1", props: { a: 2 } },
    ];
    const compacted = compactSectionUpdates(entries);
    expect(compacted).toHaveLength(1);
    expect(applyToBuiltIn({ sections: [{ id: "s1", props: {} }] }, compacted)).toEqual(
      applyToBuiltIn({ sections: [{ id: "s1", props: {} }] }, entries),
    );
    expect(
      applyToBridge(emittedUpdateSource(), { slots: {}, hiddenSlots: [] }, compacted).slots.s1,
    ).toEqual({ a: 2 });
  });

  it("design §2 example 2: an entry with enabled defined is a barrier", () => {
    const entries: PreviewUpdateEntry[] = [
      { kind: "section", sectionId: "s1", enabled: false },
      { kind: "section", sectionId: "s1", enabled: true, props: { b: 1 } },
    ];
    expect(compactSectionUpdates(entries)).toEqual(entries);
    expect(
      applyToBridge(emittedUpdateSource(), { slots: { s1: { a: 0 } }, hiddenSlots: [] }, entries)
        .slots.s1,
    ).toEqual({ b: 1 });
  });

  it("never merges across a section change, a selection-field post or a signed repost", () => {
    const repost: SectionUpdateEntry = { kind: "section", sectionId: "s1", props: { a: 3 }, stillCurrent: () => true };
    const field: PreviewUpdateEntry = { kind: "field", sectionId: "s1", fieldKey: "a", fieldPath: null, value: "x" };
    const entries: PreviewUpdateEntry[] = [
      { kind: "section", sectionId: "s1", props: { a: 1 } },
      { kind: "section", sectionId: "s2", props: { a: 1 } },
      { kind: "section", sectionId: "s1", props: { a: 2 } },
      field,
      { kind: "section", sectionId: "s1", props: { b: 2 } },
      repost,
      { kind: "section", sectionId: "s1", props: { c: 2 } },
    ];
    expect(compactSectionUpdates(entries)).toEqual(entries);
  });

  it(`applying the compacted list equals applying the original, under both receivers (${CASES} seeded cases)`, () => {
    const emitted = emittedUpdateSource();
    const pre257 = pre257UpdateSource();
    let merged = 0;
    for (let seed = 1; seed <= CASES; seed += 1) {
      const gen = generator(seed);
      const entries = gen.sequence();
      const compacted = compactSectionUpdates(entries);
      merged += entries.length - compacted.length;
      const document = gen.builtInDocument();
      const content = gen.bridgeContent();
      const context = { seed, entries, compacted };
      expect(applyToBuiltIn(document, compacted), JSON.stringify(context)).toEqual(
        applyToBuiltIn(document, entries),
      );
      expect(applyToBridge(emitted, content, compacted), JSON.stringify(context)).toEqual(
        applyToBridge(emitted, content, entries),
      );
      expect(applyToBridge(pre257, content, compacted), JSON.stringify(context)).toEqual(
        applyToBridge(pre257, content, entries),
      );
    }
    // The generator has to exercise merging for the property to mean anything.
    expect(merged).toBeGreaterThan(CASES);
  });
});

// ---------------------------------------------------------------------------
// P2: the queue state machine
// ---------------------------------------------------------------------------

const section = (
  sectionId: string,
  props?: Record<string, unknown>,
  extra: Partial<SectionUpdateEntry> = {},
): SectionUpdateEntry => ({ kind: "section", sectionId, ...(props ? { props } : {}), ...extra });

function run(events: readonly DeferralEvent[], key: string | null = "k1") {
  let state: DeferralState = initialDeferralState(key);
  const posts: PreviewUpdateEntry[] = [];
  const ended: boolean[] = [];
  const steps: { posts: readonly PreviewUpdateEntry[]; ended?: boolean }[] = [];
  for (const event of events) {
    const result = stepDeferral(state, event);
    state = result.state;
    posts.push(...result.output.posts);
    if (result.output.editEnded) ended.push(result.output.editEnded.finished);
    steps.push({ posts: result.output.posts, ended: result.output.editEnded?.finished });
  }
  return { state, posts, ended, steps };
}

const open: DeferralEvent = { type: "editing", editing: true };
const close: DeferralEvent = { type: "editing", editing: false };
const post = (entry: PreviewUpdateEntry): DeferralEvent => ({ type: "post", entry });

describe("the deferral state machine", () => {
  it("sends a post at once when no edit is open", () => {
    const a = section("s1", { a: 1 });
    expect(run([post(a)]).steps[0]!.posts).toEqual([a]);
  });

  it("holds every post while an edit is open, and sends nothing until it ends", () => {
    const { steps } = run([open, post(section("s1", { a: 1 })), post(section("s2", { b: 1 }))]);
    expect(steps.flatMap((step) => step.posts)).toEqual([]);
  });

  it("M1: replays in the original global order on editing:false, across sections and selection-field posts", () => {
    const entries: PreviewUpdateEntry[] = [
      section("s1", { a: 1 }),
      { kind: "field", sectionId: "s1", fieldKey: "a", fieldPath: "a", value: "x" },
      section("s2", undefined, { enabled: false }),
      section("s1", undefined, { resetKeys: ["a"] }),
      { kind: "field", sectionId: "s1", fieldKey: "b", fieldPath: null, value: "y" },
      section("s2", { c: 1 }, { enabled: true }),
    ];
    const { steps, ended } = run([open, ...entries.map(post), close]);
    expect(steps.at(-1)!.posts).toEqual(entries);
    expect(ended).toEqual([true]);
  });

  it("E1, E2: ready mid-edit ends the edit as lost and discards the queue", () => {
    const { steps, state } = run([open, post(section("s1", { a: 1 })), { type: "ready", verified: true }]);
    expect(steps.at(-1)).toEqual({ posts: [], ended: false });
    expect(state.open).toBeNull();
    expect(state.queue).toEqual([]);
  });

  it("E3, E4: editing:false after a ready posts nothing and ends nothing", () => {
    const { steps } = run([open, post(section("s1", { a: 1 })), { type: "ready", verified: true }, close]);
    expect(steps.at(-1)).toEqual({ posts: [], ended: undefined });
  });

  it("E3: a flush under a tag that is no longer the open edit's posts nothing", () => {
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    state = stepDeferral(state, post(section("s1", { a: 1 }))).state;
    const tag = state.open!;
    const queue = state.queue;
    expect(flushDeferredQueue(state, tag, queue)).toHaveLength(1);
    // A ready ends it; a new edit then opens in the new round.
    const afterReady = stepDeferral(state, { type: "ready", verified: true }).state;
    expect(flushDeferredQueue(afterReady, tag, queue)).toEqual([]);
    const reopened = stepDeferral(afterReady, open).state;
    expect(reopened.open).not.toEqual(tag);
    expect(flushDeferredQueue(reopened, tag, queue)).toEqual([]);
  });

  it("E3: a commit after a ready is not held for the lost edit", () => {
    const echo = section("s1", { a: 2 });
    const { steps } = run([open, { type: "ready", verified: true }, { type: "commit", sectionId: "s1", echo }, close]);
    expect(steps[2]!.posts).toEqual([echo]);
    expect(steps[3]).toEqual({ posts: [], ended: undefined });
  });

  it("a key change mid-edit ends it as lost and discards the queue, as the shell does today", () => {
    const { steps, state } = run([
      open,
      post(section("s1", { a: 1 })),
      { type: "key-change", previewKey: "k2" },
      close,
    ]);
    expect(steps[2]).toEqual({ posts: [], ended: false });
    expect(steps[3]).toEqual({ posts: [], ended: undefined });
    expect(state.previewKey).toBe("k2");
  });

  it("E4: a second editing:false is a no-op", () => {
    const a = section("s1", { a: 1 });
    const { steps } = run([open, post(a), close, close]);
    expect(steps[2]).toEqual({ posts: [a], ended: true });
    expect(steps[3]).toEqual({ posts: [], ended: undefined });
  });

  it("E4: editing:false with no edit ever opened is a no-op", () => {
    expect(run([close]).steps[0]).toEqual({ posts: [], ended: undefined });
  });

  it("E4: editing:true while one is open keeps the same queue and the same editSeq", () => {
    const a = section("s1", { a: 1 });
    const b = section("s1", { b: 1 });
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    state = stepDeferral(state, post(a)).state;
    const before = state;
    state = stepDeferral(state, open).state;
    expect(state).toBe(before);
    state = stepDeferral(state, post(b)).state;
    expect(stepDeferral(state, close).output.posts).toEqual([a, b]);
  });

  it("E5: holds indefinitely; nothing but an event releases it", () => {
    // No timers: the state after N unrelated steps is still holding.
    const { state } = run([open, post(section("s1", { a: 1 }))]);
    expect(state.open).not.toBeNull();
    expect(state.queue).toHaveLength(1);
  });

  it("M3: a signed repost keeps its place and its revision check is asked at flush", () => {
    let revision = 1;
    const asked: number[] = [];
    const repostFor = (own: number) =>
      section("s1", { image: `signed-${own}` }, {
        stillCurrent: () => {
          asked.push(own);
          return revision === own;
        },
      });
    const before = section("s1", { a: 1 });
    const stale = repostFor(1);
    const after = section("s2", { b: 1 });
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    for (const entry of [before, stale, after]) {
      state = stepDeferral(state, post(entry)).state;
    }
    // Not asked while held.
    expect(asked).toEqual([]);
    // A later edit to the section moves its revision before the flush.
    revision = 2;
    const flushed = stepDeferral(state, close).output.posts;
    expect(asked).toEqual([1]);
    expect(flushed).toEqual([before, after]);
  });

  it("M3: a signed repost still current at flush is sent in its place", () => {
    const repost = section("s1", { image: "signed" }, { stillCurrent: () => true });
    const a = section("s1", { a: 1 });
    const b = section("s1", { b: 1 });
    const { steps } = run([open, post(a), post(repost), post(b), close]);
    expect(steps.at(-1)!.posts).toEqual([a, repost, b]);
  });

  it("M2 at flush (opt-in) keeps the receiver's end state", () => {
    const entries: PreviewUpdateEntry[] = [
      section("s1", { a: 1 }),
      section("s1", undefined, { resetKeys: ["a"] }),
      section("s1", { a: 2 }),
    ];
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    for (const entry of entries) state = stepDeferral(state, post(entry)).state;
    const posts = stepDeferral(state, close, { compact: true }).output.posts;
    expect(posts).toHaveLength(1);
    const doc = { sections: [{ id: "s1", props: { a: 0 } }] };
    expect(applyToBuiltIn(doc, posts)).toEqual(applyToBuiltIn(doc, entries));
  });
});

// ---------------------------------------------------------------------------
// Scope: what a held post was made for
// ---------------------------------------------------------------------------

describe("the page a held post was made for (scope)", () => {
  it("is a barrier to merging: posts made for different pages never merge", () => {
    const entries: PreviewUpdateEntry[] = [
      section("s1", { a: 1 }, { scope: "page-a" }),
      section("s1", { a: 2 }, { scope: "page-b" }),
    ];
    expect(compactSectionUpdates(entries)).toEqual(entries);
    // The same page merges as before.
    expect(
      compactSectionUpdates([
        section("s1", { a: 1 }, { scope: "page-a" }),
        section("s1", { b: 2 }, { scope: "page-a" }),
      ]),
    ).toEqual([{ kind: "section", sectionId: "s1", props: { a: 1, b: 2 }, scope: "page-a" }]);
  });

  it("a flush sends only posts made for the page on screen, in order", () => {
    const onA = section("s1", { a: 1 }, { scope: "page-a" });
    const onB = section("s2", { b: 1 }, { scope: "page-b" });
    const fieldOnA: PreviewUpdateEntry = {
      kind: "field",
      sectionId: "s1",
      fieldKey: "a",
      fieldPath: "a",
      value: "x",
      scope: "page-a",
    };
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    for (const entry of [onA, fieldOnA, onB]) state = stepDeferral(state, post(entry)).state;
    const posts = stepDeferral(state, close, { inScope: (scope) => scope === "page-b" })
      .output.posts;
    expect(posts).toEqual([onB]);
  });

  it("a commit made on another page is not rebuilt on this one", () => {
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    state = stepDeferral(state, {
      type: "commit",
      sectionId: "s1",
      scope: "page-a",
      echo: section("s1", { a: 1 }, { scope: "page-a" }),
    }).state;
    const storedCopy = vi.fn(() => ({ a: 9 }));
    const posts = stepDeferral(state, close, {
      inScope: (scope) => scope === "page-b",
      rebuildFrom: { storedCopy, pendingProps: () => undefined },
    }).output.posts;
    expect(posts).toEqual([]);
    expect(storedCopy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The committed-section rebuild at flush
// ---------------------------------------------------------------------------

/** A rebuild source whose stored copy is `stored(id)` and nothing is pending. */
const storedOnly = (stored: (id: string) => Record<string, unknown> | undefined): RebuildSource => ({
  storedCopy: stored,
  pendingProps: () => undefined,
});

/** A post the flush rebuilt from what the editor holds, not one it held. */
const rebuilt = (
  sectionId: string,
  props: Record<string, unknown>,
  extra: Partial<SectionUpdateEntry> = {},
): SectionUpdateEntry => ({ kind: "section", sectionId, props, ...extra, rebuilt: true });

describe("rebuildCommittedSections", () => {
  const field: PreviewUpdateEntry = {
    kind: "field",
    sectionId: "s1",
    fieldKey: "a",
    fieldPath: null,
    value: "x",
  };

  it("puts one post rebuilt from the source at the section's last position; others keep their order", () => {
    const queue: PreviewUpdateEntry[] = [
      section("s1", { a: 1 }),
      section("s2", { b: 1 }),
      field,
      section("s1", { a: 2 }, { resetKeys: ["c", "a"] }),
      section("s2", { b: 2 }),
    ];
    expect(rebuildCommittedSections(queue, ["s1"], storedOnly(() => ({ a: 9 })))).toEqual([
      section("s2", { b: 1 }),
      field,
      // Reset `c` is kept; `a` is set again, so it is not reset.
      rebuilt("s1", { a: 9 }, { resetKeys: ["c"] }),
      section("s2", { b: 2 }),
    ]);
  });

  it("puts pending on top of the stored copy, as the commit handler composes it", () => {
    const queue: PreviewUpdateEntry[] = [section("s1", { a: 1 })];
    const source: RebuildSource = {
      storedCopy: () => ({ a: "stored", b: "stored" }),
      pendingProps: () => ({ b: "pending" }),
    };
    expect(rebuildCommittedSections(queue, ["s1"], source)).toEqual([
      rebuilt("s1", { a: "stored", b: "pending" }),
    ]);
  });

  it("carries the last enabled the section's posts defined, and replaces its signed reposts", () => {
    const queue: PreviewUpdateEntry[] = [
      section("s1", undefined, { enabled: false }),
      section("s1", { a: 1 }, { stillCurrent: () => true }),
      section("s1", undefined, { enabled: true }),
      section("s1", { a: 2 }),
    ];
    expect(rebuildCommittedSections(queue, ["s1"], storedOnly(() => ({ a: 3 })))).toEqual([
      rebuilt("s1", { a: 3 }, { enabled: true }),
    ]);
  });

  it("leaves a section the editor holds no copy of as it was, and adds one a commit held no post for", () => {
    const queue: PreviewUpdateEntry[] = [section("s1", { a: 1 })];
    expect(rebuildCommittedSections(queue, ["s1"], storedOnly(() => undefined))).toEqual(queue);
    expect(rebuildCommittedSections(queue, ["s2"], storedOnly(() => ({ b: 1 })))).toEqual([
      ...queue,
      rebuilt("s2", { b: 1 }),
    ]);
  });

  it("only reads: asks each committed section once, at flush, and changes nothing it was given", () => {
    const stored = Object.freeze({ a: "stored" });
    const pending = Object.freeze({ b: "pending" });
    const storedCopy = vi.fn(() => stored);
    const pendingProps = vi.fn(() => pending);
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    state = stepDeferral(state, { type: "commit", sectionId: "s1", echo: section("s1", { a: 1 }) }).state;
    state = stepDeferral(state, { type: "commit", sectionId: "s1", echo: section("s1", { a: 2 }) }).state;
    // Nothing is read while the edit is open.
    expect(storedCopy).not.toHaveBeenCalled();
    const posts = stepDeferral(state, close, { rebuildFrom: { storedCopy, pendingProps } }).output.posts;
    expect(storedCopy.mock.calls).toEqual([["s1"]]);
    expect(pendingProps.mock.calls).toEqual([["s1"]]);
    expect(posts).toEqual([rebuilt("s1", { a: "stored", b: "pending" })]);
    // A flush posts once: a second editing:false sends nothing and reads nothing.
    expect(stepDeferral(stepDeferral(state, close).state, close, { rebuildFrom: { storedCopy, pendingProps } }).output.posts).toEqual([]);
    expect(storedCopy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds only sections a commit landed on during this edit", () => {
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    state = stepDeferral(state, post(section("s1", { a: 1 }))).state;
    state = stepDeferral(state, post(section("s2", { b: 1 }))).state;
    state = stepDeferral(state, { type: "commit", sectionId: "s2", echo: section("s2", { b: 2 }) }).state;
    const posts = stepDeferral(state, close, { rebuildFrom: storedOnly((id) => ({ [id]: "now" })) }).output.posts;
    expect(posts).toEqual([section("s1", { a: 1 }), rebuilt("s2", { s2: "now" })]);
  });

  it("is never merged with a held post, whatever the order", () => {
    const posts = compactSectionUpdates([
      section("s1", { a: 1 }),
      rebuilt("s1", { b: 1 }),
      section("s1", { c: 1 }),
    ]);
    expect(posts).toHaveLength(3);
  });

  it("V(S) still applies at flush through the poster: a hidden section's rebuilt post is stripped", () => {
    // The shell's poster (postPreviewSectionProps): a section held as hidden
    // is told it is hidden and nothing else.
    const hidden = new Set(["s1"]);
    const poster = (entry: PreviewUpdateEntry): PreviewUpdateEntry =>
      entry.kind === "section" && hidden.has(entry.sectionId)
        ? { kind: "section", sectionId: entry.sectionId, enabled: false }
        : entry;
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    state = stepDeferral(state, { type: "commit", sectionId: "s1", echo: section("s1", { a: 1 }) }).state;
    const sent = stepDeferral(state, close, { rebuildFrom: storedOnly(() => ({ a: 2 })) }).output.posts.map(poster);
    expect(sent).toEqual([{ kind: "section", sectionId: "s1", enabled: false }]);
    for (const source of [emittedUpdateSource(), pre257UpdateSource()]) {
      expect(applyToBridge(source, { slots: { s1: { a: 0 } }, hiddenSlots: [] }, sent)).toEqual({
        slots: {},
        hiddenSlots: ["s1"],
      });
    }
  });
});

// ---------------------------------------------------------------------------
// V4: the commit echo, replayed in order with the rebuild (design §4)
// ---------------------------------------------------------------------------

/**
 * Inputs, as the shell composes them (visual-editor-shell.tsx):
 * - an Inspector edit posts the section's full next props
 *   (`handleSectionPropsChange` -> `syncPreviewSectionProps`);
 * - the inline commit's echo is `setFieldPathValue(base, path, value)` where
 *   `base = sectionPropsSnapshot(section) ⊕ pending.props`, posted through
 *   the same path.
 * The rebuild reads the stored copy through the editor's own decision,
 * `newestAcceptedCopy` (content-write-snapshot.ts), the way the commit
 * handler reads it: the real function is called here on modelled snapshots
 * and context generations. The commit flow itself is unchanged: same echo,
 * same event; only what the flush posts differs.
 */
describe("the commit echo replayed through M1 with the rebuild (V4)", () => {
  const receiverEnd = (initial: Record<string, unknown>, entries: readonly PreviewUpdateEntry[]) => ({
    builtIn: applyToBuiltIn({ sections: [{ id: "s1", props: initial }] }, entries).sections[0]!.props,
    bridge: applyToBridge(emittedUpdateSource(), { slots: { s1: initial }, hiddenSlots: [] }, entries).slots.s1,
    pre257: applyToBridge(pre257UpdateSource(), { slots: { s1: initial }, hiddenSlots: [] }, entries).slots.s1,
  });
  const allEqual = (end: ReturnType<typeof receiverEnd>, expected: Record<string, unknown>) => {
    expect(end.builtIn).toEqual(expected);
    expect(end.bridge).toEqual(expected);
    expect(end.pre257).toEqual(expected);
  };

  /** The editor's copies of template `t1`, which holds section `s1`. */
  type Copies = Readonly<{
    context: { draftGeneration: number; props: Record<string, unknown> };
    snapshot?: { draftGeneration: number; props: Record<string, unknown> };
    pending?: Record<string, unknown>;
  }>;

  /** `storedCopy` as the shell reads it: `newestAcceptedCopy` decides. */
  function sourceFor(copies: Copies): RebuildSource {
    const snapshots = new Map<string, ContentSnapshot>(
      copies.snapshot
        ? [["t1", {
            draftGeneration: copies.snapshot.draftGeneration,
            ownSince: copies.snapshot.draftGeneration,
            sections: [{ id: "s1", props: copies.snapshot.props }],
          }]]
        : [],
    );
    return {
      storedCopy: (sectionId) => {
        if (sectionId !== "s1") return undefined;
        const newest = newestAcceptedCopy({
          templateId: "t1",
          snapshots,
          contextTemplates: [{ id: "t1", draftGeneration: copies.context.draftGeneration }],
        });
        return newest.from === "snapshot"
          ? snapshotSectionProps(newest.snapshot, sectionId)
          : copies.context.props;
      },
      pendingProps: (sectionId) => (sectionId === "s1" ? copies.pending : undefined),
    };
  }

  function flushed(args: {
    held: readonly SectionUpdateEntry[];
    echoBase: Record<string, unknown>;
    after?: readonly SectionUpdateEntry[];
    copies: Copies;
  }) {
    const echo = section("s1", { ...args.echoBase, heading: "Typed" });
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    for (const entry of args.held) state = stepDeferral(state, post(entry)).state;
    state = stepDeferral(state, { type: "commit", sectionId: "s1", echo }).state;
    for (const entry of args.after ?? []) state = stepDeferral(state, post(entry)).state;
    return stepDeferral(state, close, { rebuildFrom: sourceFor(args.copies) }).output.posts;
  }

  const rendered = { heading: "Saved", body: "B0" };

  it("ends at stored+pending when the echo is composed from the current copy", () => {
    // The `body` edit is still pending; the commit is pending too.
    const posts = flushed({
      held: [section("s1", { ...rendered, body: "B1" })],
      echoBase: { ...rendered, body: "B1" },
      copies: { context: { draftGeneration: 10, props: rendered }, pending: { body: "B1", heading: "Typed" } },
    });
    allEqual(receiverEnd(rendered, posts), { heading: "Typed", body: "B1" });
  });

  it("stale echo base: a held edit answered before the context re-rendered still ends at stored+pending", () => {
    // The `body` edit was written and answered while the inline edit was open:
    // its answer reached the snapshot (generation 11) and the pending entry is
    // gone, while the context still holds generation 10 with B0. The echo was
    // composed from the context: B0. The decision reads the snapshot, because
    // its generation is strictly higher.
    const posts = flushed({
      held: [section("s1", { ...rendered, body: "B1" })],
      echoBase: rendered,
      copies: {
        context: { draftGeneration: 10, props: rendered },
        snapshot: { draftGeneration: 11, props: { ...rendered, body: "B1" } },
        pending: { heading: "Typed" },
      },
    });
    allEqual(receiverEnd(rendered, posts), { heading: "Typed", body: "B1" });
  });

  it("stale echo base: a held reset is not undone by an echo from a copy that still has the key", () => {
    // "Use code default" posts `{props:{}, resetKeys}` after its write
    // succeeds; its answer is in the snapshot, the context still has `body`.
    // The folded reset is kept, so the frame's old `body` goes too.
    const posts = flushed({
      held: [section("s1", {}, { resetKeys: ["body"] })],
      echoBase: rendered,
      copies: {
        context: { draftGeneration: 10, props: rendered },
        snapshot: { draftGeneration: 11, props: { heading: "Saved" } },
        pending: { heading: "Typed" },
      },
    });
    allEqual(receiverEnd(rendered, posts), { heading: "Typed" });
  });

  it("on a tie the decision reads the context, and the rebuild follows it", () => {
    // Same generation: one stored document, so the context is the later
    // arrival. The rebuild does not pick.
    const posts = flushed({
      held: [],
      echoBase: rendered,
      copies: {
        context: { draftGeneration: 11, props: { ...rendered, body: "C" } },
        snapshot: { draftGeneration: 11, props: { ...rendered, body: "S" } },
        pending: { heading: "Typed" },
      },
    });
    allEqual(receiverEnd(rendered, posts), { heading: "Typed", body: "C" });
  });

  it("a later post for the section after the echo: the rebuild wins, which is that post when it came from the same state", () => {
    // After the commit, while the edit is still open, the Inspector changed
    // `body` again: staged as pending and posted with the section's full
    // props. The rebuild takes that post's position and is composed from the
    // same state, so it carries the same values.
    const storedPlusPending = { heading: "Typed", body: "B2" };
    const posts = flushed({
      held: [],
      echoBase: rendered,
      after: [section("s1", storedPlusPending)],
      copies: { context: { draftGeneration: 10, props: rendered }, pending: { heading: "Typed", body: "B2" } },
    });
    expect(posts).toEqual([rebuilt("s1", storedPlusPending)]);
    allEqual(receiverEnd(rendered, posts), storedPlusPending);
  });

  it("KNOWN LIMIT: a later post from a state neither accepted copy holds yet is overridden by the rebuild", () => {
    // Promoting code content to a field posts the server's saved document.
    // That answer is not put into the content snapshots on this base
    // (fix/editor-promote-answer-into-snapshot is not merged), so until the
    // refetch reaches the context, neither copy has `promoted`. Whatever
    // newestAcceptedCopy decides, the rebuild, placed last, is older than
    // the post it replaced.
    const saved = { heading: "Typed", body: "B0", promoted: "P" };
    const posts = flushed({
      held: [],
      echoBase: rendered,
      after: [section("s1", saved)],
      copies: {
        context: { draftGeneration: 10, props: rendered },
        snapshot: { draftGeneration: 10, props: rendered },
        pending: { heading: "Typed" },
      },
    });
    allEqual(receiverEnd(rendered, posts), { heading: "Typed", body: "B0" });
    // Once the refetch reaches the context (or a copy holds it), the decision
    // reads it and the rebuild ends with the promoted value.
    const accepted = flushed({
      held: [],
      echoBase: rendered,
      after: [section("s1", saved)],
      copies: {
        context: { draftGeneration: 11, props: { ...rendered, promoted: "P" } },
        snapshot: { draftGeneration: 10, props: rendered },
        pending: { heading: "Typed" },
      },
    });
    allEqual(receiverEnd(rendered, accepted), saved);
  });
});

// ---------------------------------------------------------------------------
// Ready: the replay arm, and the notice while identity is unverified
// ---------------------------------------------------------------------------

describe("ready, the replay arm and the notice", () => {
  const verified: DeferralEvent = { type: "ready", verified: true };
  const unverified: DeferralEvent = { type: "ready", verified: false };
  const settled: DeferralEvent = { type: "replay-settled" };

  function outputs(events: readonly DeferralEvent[]) {
    let state = initialDeferralState("k1");
    return events.map((event) => {
      const result = stepDeferral(state, event);
      state = result.state;
      return result.output;
    });
  }

  for (const [name, ready] of [
    ["a new document", verified],
    ["an id-less ready", unverified],
  ] as const) {
    it(`${name} that ends an open edit asks for the replay to be armed, with no notice`, () => {
      const [, , atReady] = outputs([open, post(section("s1", { a: 1 })), ready]);
      expect(atReady).toEqual({ posts: [], editEnded: { finished: false }, armReplay: true });
    });

    it(`${name} with no edit open and nothing armed asks for nothing`, () => {
      expect(outputs([ready])[0]).toEqual({ posts: [] });
    });

    it(`${name} that ends a new open edit re-arms instead of telling`, () => {
      const out = outputs([open, ready, open, ready]);
      expect(out[3]).toEqual({ posts: [], editEnded: { finished: false }, armReplay: true });
    });

    it(`after ${name}, no notice once the replay settled (replayed or gave up with its own notice)`, () => {
      const out = outputs([open, ready, settled, ready]);
      expect(out[3]).toEqual({ posts: [] });
    });
  }

  it("a new document while that replay is unsettled re-arms it for the new document", () => {
    // The identity says it is another document: the discarded content is on
    // neither, so the same replay is armed again, for the frame now on screen.
    const out = outputs([open, verified, verified, settled, verified]);
    expect(out[2]).toEqual({ posts: [], armReplay: true });
    expect(out[4]).toEqual({ posts: [] });
  });

  it("an id-less ready while that replay is unsettled gives the existing onUnconfirmed notice, once", () => {
    // Without an id a duplicate cannot be told from a new document, so
    // nothing is re-armed on its word: the author is told instead.
    const out = outputs([open, unverified, unverified, unverified]);
    expect(out[2]).toEqual({ posts: [], notice: "replay-unconfirmed" });
    expect(out[3]).toEqual({ posts: [] });
  });

  it("an id-less ready is transitional only: after the notice, nothing replays and nothing is sent", () => {
    const out = outputs([open, post(section("s1", { a: 1 })), unverified, unverified, close]);
    expect(out.flatMap((step) => step.posts)).toEqual([]);
    expect(out.filter((step) => step.armReplay)).toHaveLength(1);
  });

  it("a key change forgets a replay armed for the old frame", () => {
    const out = outputs([open, verified, { type: "key-change", previewKey: "k2" }, unverified]);
    expect(out[3]).toEqual({ posts: [] });
  });
});

describe("an edit lost for another reason", () => {
  it("ends the open edit as lost and discards what it held, without a replay or a notice", () => {
    let state = initialDeferralState("k1");
    state = stepDeferral(state, open).state;
    state = stepDeferral(state, post(section("s1", { a: 1 }))).state;
    const lost = stepDeferral(state, { type: "lost" });
    expect(lost.output).toEqual({ posts: [], editEnded: { finished: false } });
    expect(lost.state.open).toBeNull();
    expect(lost.state.queue).toEqual([]);
    // Then an editing:false posts nothing.
    expect(stepDeferral(lost.state, close).output).toEqual({ posts: [] });
  });

  it("is a no-op with no edit open", () => {
    const state = initialDeferralState("k1");
    expect(stepDeferral(state, { type: "lost" })).toEqual({ state, output: { posts: [] } });
  });
});
