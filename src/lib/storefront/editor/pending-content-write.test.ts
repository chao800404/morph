import { describe, expect, it, vi } from "vitest";
import {
  commitPendingContent,
  contentUndoSteps,
  sectionContentLanded,
  stageContentFields,
  selectCurrentContentFields,
  acknowledgeContentFields,
  rebaseFieldBasis,
  type PendingContentEntry,
} from "./pending-content-write";
import * as pendingContentWrite from "./pending-content-write";

describe("per-field source recovery", () => {
  const stored = { heading: "Old heading", subheading: "Old subheading" };
  const stage = (
    pending: PendingContentEntry | undefined,
    next: Record<string, unknown>,
    generation: number | null,
  ) =>
    stageContentFields({
      pending,
      sectionId: "hero",
      stored,
      next,
      sourceForPath: () => generation,
    })!;

  it("unchanged snapshot props are not confirmed and a new input upgrades only its field", () => {
    const first = stage(
      undefined,
      { heading: "Draft heading", subheading: stored.subheading },
      1,
    );
    expect(Object.keys(first.fields!)).toEqual(["heading"]);
    const both = stage(
      first,
      { heading: "Draft heading", subheading: "Draft subheading" },
      1,
    );
    const confirmed = stage(
      both,
      { heading: "New heading", subheading: "Draft subheading" },
      2,
    );
    const sent = selectCurrentContentFields(confirmed, 2, stored);
    expect(sent.expectedSourceGeneration).toBe(2);
    expect(sent.props).toEqual({ heading: "New heading" });
    expect(confirmed.fields!.subheading!.sourceGeneration).toBe(1);
    expect(stage(confirmed, confirmed.props, 3)).toBe(confirmed);
  });

  it("ACK removes only the sent fields while stale and concurrently edited fields survive", () => {
    const first = stage(
      undefined,
      { heading: "Draft heading", subheading: "Draft subheading" },
      1,
    );
    const confirmed = stage(first, { heading: "Confirmed heading" }, 2);
    const pending = new Map([["key", confirmed]]);
    const sent = selectCurrentContentFields(confirmed, 2, stored);
    acknowledgeContentFields(pending, "key", sent);
    expect(pending.get("key")!.props).toEqual({
      subheading: "Draft subheading",
    });
    expect(pending.get("key")!.fields!.subheading!.sourceGeneration).toBe(1);
    const next = stage(
      pending.get("key"),
      { subheading: "Confirmed subheading" },
      2,
    );
    pending.set("key", next);
    const inFlight = selectCurrentContentFields(next, 2, stored);
    pending.set("key", stage(next, { subheading: "Typed during save" }, 2));
    acknowledgeContentFields(pending, "key", inFlight);
    expect(pending.get("key")!.props.subheading).toBe("Typed during save");
    expect(inFlight.props.subheading).toBe("Confirmed subheading");
  });

  it("nested fields compose on stored data without another row's held draft", () => {
    const base = { items: [{ title: "A" }, { title: "B" }] };
    const first = stageContentFields({
      sectionId: "hero",
      stored: base,
      next: { items: [{ title: "Draft A" }, { title: "B" }] },
      sourceForPath: () => 1,
    })!;
    const next = stageContentFields({
      pending: first,
      sectionId: "hero",
      stored: base,
      next: { items: [{ title: "Draft A" }, { title: "New B" }] },
      sourceForPath: () => 2,
    })!;
    expect(selectCurrentContentFields(next, 2, base).props).toEqual({
      items: [{ title: "A" }, { title: "New B" }],
    });
    expect(next.fields!["items.0.title"]!.sourceGeneration).toBe(1);
  });

  it("a stale history edit or missing baseline never falls back to the current version", () => {
    expect(() =>
      selectCurrentContentFields(
        stage(undefined, { heading: "History" }, 1),
        2,
        stored,
      ),
    ).toThrow("Select the field again");
    const missing = stage(undefined, { heading: "Kept" }, null);
    expect(missing.fields!.heading!.sourceGeneration).toBeNull();
    expect(() => selectCurrentContentFields(missing, 2, stored)).toThrow(
      "Select the field again",
    );
    expect(() => selectCurrentContentFields(missing, 0, stored)).toThrow(
      "Select the field again",
    );
  });

  it("an older structural parent cannot be included in a newly confirmed child", () => {
    const base = { items: [{ title: "A" }] };
    const first = stageContentFields({
      sectionId: "hero",
      stored: base,
      next: { items: [{ title: "A" }, { title: "B" }] },
      sourceForPath: () => 1,
    })!;
    const child = stageContentFields({
      pending: first,
      sectionId: "hero",
      stored: base,
      next: { items: [{ title: "New A" }, { title: "B" }] },
      sourceForPath: () => 2,
    })!;
    expect(() => selectCurrentContentFields(child, 2, base)).toThrow(
      "Select the field again",
    );
  });

  it("preserves untouched default rows on the first explicitly edited nested field", () => {
    const entry = stageContentFields({
      sectionId: "hero",
      stored: {},
      next: { items: [{ title: "New A" }, { title: "B" }] },
      inputPath: "items.0.title",
      sourceForPath: () => 2,
    })!;
    expect(Object.keys(entry.fields!)).toEqual(["items.0.title"]);
    expect(selectCurrentContentFields(entry, 2, {}).props).toEqual({
      items: [{ title: "New A" }, { title: "B" }],
    });
    const mixed = stageContentFields({
      pending: entry,
      sectionId: "hero",
      stored: {},
      next: { items: [{ title: "New A" }, { title: "Old draft B" }] },
      inputPath: "items.1.title",
      sourceForPath: () => 1,
    })!;
    expect(() => selectCurrentContentFields(mixed, 2, {})).toThrow(
      "Select the field again",
    );
  });

  it("an answered source refusal holds exactly the sent snapshots until new input", async () => {
    const entry = stage(undefined, { heading: "Rejected heading" }, 1);
    const pending = new Map([["key", entry]]);
    const save = vi.fn(async () => ({
      success: false,
      error: "SELECTION_SOURCE_CONFLICT",
    }));
    await expect(
      commitPendingContent({
        key: "key",
        pending,
        baselines: new Map(),
        save,
        select: (held) => selectCurrentContentFields(held, 1, stored),
        failureCode: (result) => result.error,
      }),
    ).rejects.toMatchObject({ code: "SELECTION_SOURCE_CONFLICT" });
    expect(() =>
      selectCurrentContentFields(pending.get("key")!, 1, stored),
    ).toThrow("Select the field again");
    const stillOld = stage(
      pending.get("key"),
      { heading: "Retyped before source refreshed" },
      1,
    );
    expect(() => selectCurrentContentFields(stillOld, 1, stored)).toThrow(
      "Select the field again",
    );
    const noInput = stage(
      pending.get("key"),
      { heading: "Rejected heading" },
      2,
    );
    expect(noInput).toBe(pending.get("key"));
    expect(() => selectCurrentContentFields(noInput, 2, stored)).toThrow(
      "Select the field again",
    );
    const confirmed = stage(noInput, { heading: "Confirmed heading" }, 2);
    expect(selectCurrentContentFields(confirmed, 2, stored).props).toEqual({
      heading: "Confirmed heading",
    });
    expect(save).toHaveBeenCalledOnce();
  });
});

/** The error a call rejected with, whether or not it has a code. */
async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { message?: string; code?: string };
  }
  throw new Error("expected the call to reject");
}

describe("content acknowledgement boundary", () => {
  /** These results carry no code: what is under test here is retention. */
  const noCode = () => undefined;

  const fixture = () => ({
    key: "template:section",
    pending: new Map([
      [
        "template:section",
        { sectionId: "section", props: { heading: "edited" } },
      ],
    ]),
    baselines: new Map([["template:section", { heading: "original" }]]),
  });
  it("rejects domain failure and retains the payload for retry", async () => {
    const state = fixture();
    await expect(
      commitPendingContent({
        ...state,
        failureCode: noCode,
        save: async () => ({ success: false, message: "conflict" }),
      }),
    ).rejects.toThrow("conflict");
    expect(state.pending.size).toBe(1);
    expect(state.baselines.size).toBe(1);
    await commitPendingContent({
      ...state,
      failureCode: noCode,
      save: async () => ({ success: true }),
    });
    expect(state.pending.size).toBe(0);
  });
  it("retains pending on a network exception", async () => {
    const state = fixture();
    await expect(
      commitPendingContent({
        ...state,
        failureCode: noCode,
        save: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
    expect(state.pending.size).toBe(1);
  });
  it("carries the server's code so a conflict is not read as a dropped request", async () => {
    const state = fixture();

    const conflict = await rejectionOf(
      commitPendingContent({
        ...state,
        save: async () => ({
          success: false,
          message: "Template draft was modified concurrently.",
          error: "TEMPLATE_DRAFT_CONFLICT",
        }),
        failureCode: (result) => result.error,
      }),
    );

    expect(conflict).toMatchObject({
      message: "Template draft was modified concurrently.",
      code: "TEMPLATE_DRAFT_CONFLICT",
    });
    // The payload survives, which is what a rebase needs to resend it.
    expect(state.pending.size).toBe(1);

    // A write the server refused without a code is not a conflict, and the
    // caller must be able to tell.
    const uncoded = await rejectionOf(
      commitPendingContent({
        ...state,
        save: async (): Promise<{
          success: boolean;
          message?: string;
          error?: string;
        }> => ({ success: false, message: "offline" }),
        failureCode: (result) => result.error,
      }),
    );

    expect(uncoded.message).toBe("offline");
    expect(uncoded.code).toBeUndefined();
  });

  it("does not discard an edit arriving while saving and advances its undo baseline", async () => {
    const state = fixture();
    const onSaved = vi.fn();
    await commitPendingContent({
      ...state,
      failureCode: noCode,
      onSaved,
      save: async () => {
        state.pending.set(state.key, {
          sectionId: "section",
          props: { heading: "newer" },
        });
        return { success: true };
      },
    });
    expect(state.pending.get(state.key)?.props.heading).toBe("newer");
    expect(state.baselines.get(state.key)?.heading).toBe("edited");
    expect(onSaved).toHaveBeenCalledOnce();
  });
});

describe("sectionContentLanded", () => {
  const sent = (props: Record<string, unknown>) => ({
    sectionId: "hero",
    props,
  });

  it("answers by content: every sent value is held, whatever else is", () => {
    expect(
      sectionContentLanded(
        sent({ heading: "New", links: [{ label: "A", href: "/a" }] }),
        {
          props: {
            // Same values, another key order, and fields the write left alone.
            links: [{ href: "/a", label: "A" }],
            heading: "New",
            subheading: "kept",
          },
        },
      ),
    ).toBe(true);
  });

  it("answers no for a value that differs, is missing, or a section that is gone", () => {
    expect(
      sectionContentLanded(sent({ heading: "New" }), {
        props: { heading: "Old" },
      }),
    ).toBe(false);
    expect(sectionContentLanded(sent({ heading: "New" }), { props: {} })).toBe(
      false,
    );
    expect(
      sectionContentLanded(sent({ links: [{ label: "A" }] }), {
        props: { links: [{ label: "A" }, { label: "B" }] },
      }),
    ).toBe(false);
    expect(sectionContentLanded(sent({ heading: "New" }), undefined)).toBe(
      false,
    );
  });

  it("reads `enabled` from the section, where the server stores it", () => {
    expect(
      sectionContentLanded(sent({ enabled: false }), {
        enabled: false,
        props: {},
      }),
    ).toBe(true);
    expect(sectionContentLanded(sent({ enabled: false }), { props: {} })).toBe(
      false,
    );
    expect(sectionContentLanded(sent({ enabled: true }), { props: {} })).toBe(
      true,
    );
  });
});
describe("a content write composed on one snapshot", () => {
  const rows = () => [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ];
  const snapshot = (draftGeneration: number, ownSince = draftGeneration) => ({
    draftGeneration,
    ownSince,
    sections: [],
  });
  const typed = (
    stored: Record<string, unknown>,
    next: Record<string, unknown>,
    inputPath: string,
    basisDraftGeneration: number,
  ) =>
    stageContentFields({
      sectionId: "hero",
      stored,
      next,
      inputPath,
      sourceForPath: () => 1,
      basisDraftGeneration,
    })!;

  it("takes the snapshot's draft generation with what it composed", () => {
    const stored = { heading: "Old", items: rows() };
    const entry = typed(stored, { heading: "New" }, "heading", 4);
    const sent = selectCurrentContentFields(entry, 1, stored, snapshot(4));
    expect(sent.props).toEqual({ heading: "New" });
    expect(sent.expectedDraftGeneration).toBe(4);
  });

  it("composes an input onto a copy our own writes moved on", () => {
    const stored = { heading: "Old" };
    const entry = typed(stored, { heading: "New" }, "heading", 4);
    expect(
      selectCurrentContentFields(entry, 1, stored, snapshot(6, 3))
        .expectedDraftGeneration,
    ).toBe(6);
  });

  it("refuses, as out of date, an input older than someone else's change", () => {
    const stored = { heading: "Theirs" };
    const entry = typed(stored, { heading: "Mine" }, "heading", 4);
    expect(() =>
      selectCurrentContentFields(entry, 1, stored, snapshot(6, 6)),
    ).toThrow(expect.objectContaining({ code: "TEMPLATE_DRAFT_CONFLICT" }));
  });

  it("keeps a field on the copy its first pending input was made on while it is typed into again", () => {
    const stored = { heading: "Old", items: rows() };
    const first = typed(stored, { heading: "Mine" }, "heading", 4);
    // Typed again after the editor read someone else's change at 6.
    const again = stageContentFields({
      pending: first,
      sectionId: "hero",
      stored,
      next: { heading: "Mine again" },
      inputPath: "heading",
      sourceForPath: () => 1,
      basisDraftGeneration: 6,
    })!;
    expect(again.fields!.heading!.basisDraftGeneration).toBe(4);
    expect(again.fields!.heading!.value).toBe("Mine again");
    expect(() =>
      selectCurrentContentFields(again, 1, stored, snapshot(6, 6)),
    ).toThrow(expect.objectContaining({ code: "TEMPLATE_DRAFT_CONFLICT" }));
    // Not only after a refusal: it holds from the first pending input.
    expect(first.fields!.heading!.rejected).toBeUndefined();
  });

  it("gives a structural change the oldest copy of the inputs it replaces", () => {
    const stored = { items: rows() };
    const titled = typed(
      stored,
      {
        items: [
          { id: "a", title: "A" },
          { id: "b", title: "B edited" },
        ],
      },
      "items.1.title",
      3,
    );
    const reordered = stageContentFields({
      pending: titled,
      sectionId: "hero",
      stored,
      next: {
        items: [
          { id: "b", title: "B edited" },
          { id: "a", title: "A" },
        ],
      },
      inputPath: "items",
      sourceForPath: () => 1,
      basisDraftGeneration: 7,
    })!;
    expect(Object.keys(reordered.fields!)).toEqual(["items"]);
    expect(reordered.fields!.items!.basisDraftGeneration).toBe(3);
  });

  it("moves a field's copy only when it leaves the pending set or the author keeps it", () => {
    const stored = { heading: "Old" };
    const first = typed(stored, { heading: "Mine" }, "heading", 4);
    // Answered and acknowledged: a new input starts from the copy it is on.
    const fresh = typed(stored, { heading: "Next" }, "heading", 6);
    expect(fresh.fields!.heading!.basisDraftGeneration).toBe(6);
    // Kept by the author on the latest copy.
    expect(
      rebaseFieldBasis(first, 6).fields!.heading!.basisDraftGeneration,
    ).toBe(6);
  });

  it("refuses a row field whose row is no longer at its path", () => {
    const madeOn = { items: rows() };
    const next = {
      items: [
        { id: "a", title: "A" },
        { id: "b", title: "B edited" },
      ],
    };
    const entry = typed(madeOn, next, "items.1.title", 4);
    const reordered = { items: [rows()[1], rows()[0]] };
    expect(() =>
      selectCurrentContentFields(entry, 1, reordered, snapshot(4)),
    ).toThrow(expect.objectContaining({ code: "TEMPLATE_DRAFT_CONFLICT" }));
    // In place, it is written to that row.
    expect(
      selectCurrentContentFields(entry, 1, madeOn, snapshot(4)).props,
    ).toEqual({ items: next.items });
  });

  it("checks a list nothing stores yet against the author's own copy of it", () => {
    const next = {
      items: [
        { id: "a", title: "A" },
        { id: "b", title: "B edited" },
      ],
    };
    const entry = typed({}, next, "items.1.title", 4);
    expect(selectCurrentContentFields(entry, 1, {}, snapshot(4)).props).toEqual(
      { items: next.items },
    );
  });

  it("is prepared when sent, so input typed meanwhile goes with it", async () => {
    const pending = new Map<string, PendingContentEntry>();
    const baselines = new Map<string, Record<string, unknown>>();
    const stored = { heading: "Old", subheading: "Old" };
    pending.set("key", typed(stored, { heading: "New" }, "heading", 1));
    let release!: () => void;
    const queued = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: PendingContentEntry[] = [];
    const commit = commitPendingContent({
      key: "key",
      pending,
      baselines,
      failureCode: () => undefined,
      select: (entry) =>
        selectCurrentContentFields(entry, 1, stored, snapshot(1)),
      saveWhenSent: async (prepare) => {
        await queued;
        sent.push(prepare());
        return { success: true };
      },
    });
    // Typed while the write waits behind another.
    pending.set(
      "key",
      stageContentFields({
        pending: pending.get("key"),
        sectionId: "hero",
        stored,
        next: { subheading: "Newer" },
        inputPath: "subheading",
        sourceForPath: () => 1,
        basisDraftGeneration: 1,
      })!,
    );
    release();
    await commit;
    expect(sent[0]!.props).toEqual({ heading: "New", subheading: "Newer" });
    expect(pending.has("key")).toBe(false);
  });

  it("keeps input typed after it was prepared when its answer comes", async () => {
    const pending = new Map<string, PendingContentEntry>();
    const baselines = new Map<string, Record<string, unknown>>();
    const stored = { heading: "Old" };
    pending.set("key", typed(stored, { heading: "First" }, "heading", 1));
    let answer!: (value: { success: boolean }) => void;
    const commit = commitPendingContent({
      key: "key",
      pending,
      baselines,
      failureCode: () => undefined,
      select: (entry) =>
        selectCurrentContentFields(entry, 1, stored, snapshot(1)),
      saveWhenSent: (prepare) => {
        prepare();
        return new Promise<{ success: boolean }>((resolve) => {
          answer = resolve;
        });
      },
    });
    // Typed again after the first was sent, before it was answered.
    pending.set(
      "key",
      stageContentFields({
        pending: pending.get("key"),
        sectionId: "hero",
        stored,
        next: { heading: "Second" },
        inputPath: "heading",
        sourceForPath: () => 1,
        basisDraftGeneration: 1,
      })!,
    );
    answer({ success: true });
    await commit;
    expect(pending.get("key")?.fields?.heading?.value).toBe("Second");
  });
});

/**
 * A canvas reorder swaps two rows of one list. It is staged as one change to
 * that list (`inputPath` is the list), not leaf by leaf: staged per leaf,
 * every field of a moved row recorded the row now at its index, which in the
 * stored copy is the other row, and the write was refused as out of date.
 */
describe("a reorder staged as one change to its list", () => {
  const snapshot = { draftGeneration: 3, ownSince: 3, sections: [] };
  const swap = (
    stored: Record<string, unknown>,
    next: Record<string, unknown>,
    inputPath: string,
  ) =>
    stageContentFields({
      sectionId: "hero",
      stored,
      next,
      inputPath,
      sourceForPath: () => 1,
      basisDraftGeneration: 3,
    })!;

  it("sends a stored list in its new order", () => {
    const stored = {
      items: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    };
    const swapped = {
      items: [
        { id: "b", title: "B" },
        { id: "a", title: "A" },
      ],
    };
    const entry = swap(stored, swapped, "items");
    expect(Object.keys(entry.fields!)).toEqual(["items"]);
    const sent = selectCurrentContentFields(entry, 1, stored, snapshot);
    expect(sent.props).toEqual(swapped);
    expect(sent.expectedDraftGeneration).toBe(3);
  });

  it("control: the same swap staged leaf by leaf is refused", () => {
    const stored = {
      items: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    };
    const entry = stageContentFields({
      sectionId: "hero",
      stored,
      next: {
        items: [
          { id: "b", title: "B" },
          { id: "a", title: "A" },
        ],
      },
      sourceForPath: () => 1,
      basisDraftGeneration: 3,
    })!;
    expect(() =>
      selectCurrentContentFields(entry, 1, stored, snapshot),
    ).toThrow(expect.objectContaining({ code: "TEMPLATE_DRAFT_CONFLICT" }));
  });

  it("still refuses a nested list whose parent row is no longer at its index", () => {
    const parent = (id: string, children: string[]) => ({
      id,
      children: children.map((child) => ({ id: child, title: child })),
    });
    const seen = { items: [parent("p", ["x", "y"]), parent("q", ["z"])] };
    const entry = swap(
      seen,
      { items: [parent("p", ["y", "x"]), parent("q", ["z"])] },
      "items.0.children",
    );
    expect(Object.keys(entry.fields!)).toEqual(["items.0.children"]);
    // Someone else moved the parent rows before the write left.
    const now = { items: [parent("q", ["z"]), parent("p", ["x", "y"])] };
    expect(() => selectCurrentContentFields(entry, 1, now, snapshot)).toThrow(
      expect.objectContaining({ code: "TEMPLATE_DRAFT_CONFLICT" }),
    );
    // With the parent where it was, only that nested list is sent.
    const sent = selectCurrentContentFields(entry, 1, seen, snapshot);
    expect(sent.props).toEqual({
      items: [parent("p", ["y", "x"]), parent("q", ["z"])],
    });
  });

  /**
   * Codex review of #389/#390 (§5). A root list has no row above it, so the
   * basis is what refuses a swap composed before another writer's step the
   * editor has since read. With no basis recorded (no copy of the document
   * held when the drag was staged), nothing here refuses it: it is sent at the
   * snapshot's own draft generation, and only the server's check of that
   * generation stands between it and the other writer's list.
   */
  describe("a root list swap over another writer's step the editor has read", () => {
    const stored = {
      items: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    };
    const swapped = {
      items: [
        { id: "b", title: "B" },
        { id: "a", title: "A" },
      ],
    };
    // Another writer's step 3 -> 4, read by the editor: its own range now
    // starts at 4.
    const theirs = { draftGeneration: 4, ownSince: 4, sections: [] };
    const staged = (basisDraftGeneration: number | undefined) =>
      stageContentFields({
        sectionId: "hero",
        stored,
        next: swapped,
        inputPath: "items",
        sourceForPath: () => 1,
        basisDraftGeneration,
      })!;

    it("with the basis it was made on (3): refused before it is sent", () => {
      expect(() =>
        selectCurrentContentFields(staged(3), 1, stored, theirs),
      ).toThrow(expect.objectContaining({ code: "TEMPLATE_DRAFT_CONFLICT" }));
    });

    it("with no basis recorded: not refused here, sent at the snapshot's generation", () => {
      const entry = staged(undefined);
      expect(entry.fields!.items!.basisDraftGeneration).toBeUndefined();
      const sent = selectCurrentContentFields(entry, 1, stored, theirs);
      expect(sent.props).toEqual(swapped);
      expect(sent.expectedDraftGeneration).toBe(4);
    });
  });
});

describe("what undoing a saved content write puts back", () => {
  const rows = [{ id: "morph-a", title: "One" }];

  it("removes a key the section did not store before the write", () => {
    expect(contentUndoSteps({ heading: "Hi" }, { items: rows })).toEqual({
      restore: {},
      reset: ["items"],
    });
  });

  it("writes a stored null back as null, never as a removal", () => {
    expect(contentUndoSteps({ items: null }, { items: rows })).toEqual({
      restore: { items: null },
      reset: [],
    });
  });

  it("writes a stored value back, and splits a write over stored and unstored keys", () => {
    expect(
      contentUndoSteps(
        { heading: "Old", subheading: "" },
        { heading: "New", items: rows, subheading: "Sub" },
      ),
    ).toEqual({
      restore: { heading: "Old", subheading: "" },
      reset: ["items"],
    });
  });

  it("puts visibility back as before: it is not a field to reset", () => {
    expect(contentUndoSteps({}, { enabled: false })).toEqual({
      restore: { enabled: undefined },
      reset: [],
    });
  });
});

/**
 * #388 round 3 (red before the fix). A content write that also removes keys
 * (`resetProps`, the "Use code default" removal) carries them on its entry,
 * so a read-back can tell whether it landed.
 *
 * Assumed (not on b4a18c0):
 * - `PendingContentEntry.resetProps?: readonly string[]`;
 * - `sectionContentLanded` also requires every `resetProps` key to be absent
 *   (`!hasOwnProperty`) from the section's props;
 * - `classifyUnconfirmedContent(sent, read)` with
 *   `read: { ok: false } | { ok: true; template?: { draftGeneration?: number;
 *   section?: { props?: unknown; enabled?: boolean } } }`
 *   answers `"landed" | "not-landed" | "moved" | "undecided"` per the plan's
 *   Revision 3 table: version first, then content.
 */
type WithReset = PendingContentEntry & { resetProps?: readonly string[] };

describe("sectionContentLanded for a write that also removes keys", () => {
  const rows = [{ id: "morph-a", title: "One" }];
  const resetOnly: WithReset = {
    sectionId: "section",
    props: {},
    resetProps: ["items"],
  };
  const mixed: WithReset = {
    sectionId: "section",
    props: { heading: "Hello" },
    resetProps: ["items"],
  };

  it("answers no while a removed key is still held: `props: {}` alone never landed", () => {
    expect(sectionContentLanded(resetOnly, { props: { items: rows } })).toBe(
      false,
    );
  });

  it("answers yes once every removed key is gone", () => {
    expect(sectionContentLanded(resetOnly, { props: { heading: "x" } })).toBe(
      true,
    );
  });

  it("answers no when the values match but a removed key is still held", () => {
    expect(
      sectionContentLanded(mixed, {
        props: { heading: "Hello", items: rows },
      }),
    ).toBe(false);
    // A present `undefined` is still a key the section holds.
    expect(
      sectionContentLanded(mixed, {
        props: { heading: "Hello", items: undefined },
      }),
    ).toBe(false);
  });
});

describe("classifyUnconfirmedContent: version first, then content", () => {
  const rows = [{ id: "morph-a", title: "One" }];
  const SENT_AT = 4;
  const resetOnly: WithReset = {
    sectionId: "section",
    props: {},
    resetProps: ["items"],
    expectedDraftGeneration: SENT_AT,
    expectedSourceGeneration: 1,
  };
  const mixed: WithReset = {
    sectionId: "section",
    props: { heading: "Hello" },
    resetProps: ["items"],
    expectedDraftGeneration: SENT_AT,
    expectedSourceGeneration: 1,
  };
  const read = (draftGeneration: number, props: Record<string, unknown>) => ({
    ok: true as const,
    template: { draftGeneration, section: { props } },
  });
  const classify = (
    sent: WithReset,
    readBack:
      | { ok: false }
      | {
          ok: true;
          template?: {
            draftGeneration?: number;
            section?: { props?: unknown; enabled?: boolean };
          };
        },
  ) => {
    const fn = (
      pendingContentWrite as unknown as {
        classifyUnconfirmedContent?: (
          sent: WithReset,
          read: typeof readBack,
        ) => string;
      }
    ).classifyUnconfirmedContent;
    expect(typeof fn, "classifyUnconfirmedContent exists").toBe("function");
    return fn!(sent, readBack);
  };

  describe("a reset-only write", () => {
    it("unchanged generation, key still held: not landed", () => {
      expect(classify(resetOnly, read(SENT_AT, { items: rows }))).toBe(
        "not-landed",
      );
    });
    it("one generation on, key gone: landed", () => {
      expect(classify(resetOnly, read(SENT_AT + 1, { heading: "x" }))).toBe(
        "landed",
      );
    });
    it("one generation on, key still held: moved, never resent", () => {
      expect(classify(resetOnly, read(SENT_AT + 1, { items: rows }))).toBe(
        "moved",
      );
    });
    it("two generations on, key gone: moved", () => {
      expect(classify(resetOnly, read(SENT_AT + 2, {}))).toBe("moved");
    });
    it("a generation behind the one sent: moved", () => {
      expect(classify(resetOnly, read(SENT_AT - 1, { items: rows }))).toBe(
        "moved",
      );
    });
    it("template or section missing: moved", () => {
      expect(classify(resetOnly, { ok: true })).toBe("moved");
      expect(
        classify(resetOnly, {
          ok: true,
          template: { draftGeneration: SENT_AT },
        }),
      ).toBe("moved");
    });
    it("read failed: undecided", () => {
      expect(classify(resetOnly, { ok: false })).toBe("undecided");
    });
  });

  describe("a mixed write (restored values and removed keys)", () => {
    it("unchanged generation, nothing applied: not landed", () => {
      expect(
        classify(mixed, read(SENT_AT, { heading: "New", items: rows })),
      ).toBe("not-landed");
    });
    it("one generation on, value restored and key gone: landed", () => {
      expect(classify(mixed, read(SENT_AT + 1, { heading: "Hello" }))).toBe(
        "landed",
      );
    });
    it("one generation on, a value wrong and the key gone: moved", () => {
      expect(classify(mixed, read(SENT_AT + 1, { heading: "Theirs" }))).toBe(
        "moved",
      );
    });
    it("one generation on, values right and the key still held: moved", () => {
      expect(
        classify(mixed, read(SENT_AT + 1, { heading: "Hello", items: rows })),
      ).toBe("moved");
    });
    it("two generations on, everything applied: moved", () => {
      expect(classify(mixed, read(SENT_AT + 2, { heading: "Hello" }))).toBe(
        "moved",
      );
    });
    it("read failed: undecided", () => {
      expect(classify(mixed, { ok: false })).toBe("undecided");
    });
  });

  // Added with the implementation (user decision 3): the generation did not
  // move, yet everything the write sent is already there. It cannot be shown
  // that this request did it, so it is never resent.
  describe("unchanged generation with everything already there", () => {
    it("a reset-only write whose key is already gone: moved", () => {
      expect(classify(resetOnly, read(SENT_AT, { heading: "x" }))).toBe(
        "moved",
      );
    });
    it("a mixed write whose value is restored and key gone: moved", () => {
      expect(classify(mixed, read(SENT_AT, { heading: "Hello" }))).toBe(
        "moved",
      );
    });
  });

  it("a write with no recorded draft generation: moved, never resent", () => {
    const { expectedDraftGeneration: _unset, ...unrecorded } = resetOnly;
    expect(classify(unrecorded, read(SENT_AT, { items: rows }))).toBe("moved");
  });
});

describe("sentContentWrite: what was sent stays as sent", () => {
  it("is not changed by later changes to the entry it was made from", () => {
    const props: Record<string, unknown> = { heading: "Hello" };
    const resetProps = ["items"];
    const entry: PendingContentEntry = {
      sectionId: "section",
      props,
      resetProps,
      expectedDraftGeneration: 4,
      expectedSourceGeneration: 1,
    };
    const sent = pendingContentWrite.sentContentWrite(entry);
    // Later input reuses and rewrites the objects it came from.
    props.heading = "Typed later";
    props.extra = "x";
    resetProps.push("heading");
    entry.expectedDraftGeneration = 9;

    expect(sent).toEqual({
      sectionId: "section",
      props: { heading: "Hello" },
      resetProps: ["items"],
      expectedDraftGeneration: 4,
      expectedSourceGeneration: 1,
    });
  });

  it("cannot be rewritten in place", () => {
    const sent = pendingContentWrite.sentContentWrite({
      sectionId: "section",
      props: { heading: "Hello" },
      resetProps: ["items"],
      expectedDraftGeneration: 4,
    });
    expect(Object.isFrozen(sent)).toBe(true);
    expect(Object.isFrozen(sent.props)).toBe(true);
    expect(Object.isFrozen(sent.resetProps)).toBe(true);
    expect(() => {
      (sent.props as Record<string, unknown>).heading = "x";
    }).toThrow(TypeError);
    expect(() => {
      (sent.resetProps as string[]).push("x");
    }).toThrow(TypeError);
    expect(() => {
      (sent as { expectedDraftGeneration?: number }).expectedDraftGeneration =
        5;
    }).toThrow(TypeError);
  });
});
