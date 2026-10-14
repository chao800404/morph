import { describe, expect, it, vi } from "vitest";
import {
  commitPendingContent,
  sectionContentLanded,
  stageContentFields,
  selectCurrentContentFields,
  acknowledgeContentFields,
  rebaseFieldBasis,
  type PendingContentEntry,
} from "./pending-content-write";

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
