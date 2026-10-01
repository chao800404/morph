import { describe, expect, it, vi } from "vitest";
import {
  commitPendingContent,
  sectionContentLanded,
} from "./pending-content-write";

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
