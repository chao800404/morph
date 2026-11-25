/**
 * The selection round trip, the content save and its failures, the list both writers changed, and the canvas reveal.
 *
 * One of the files the former `visual-editor-shell-round-trip.test.tsx` was split into so
 * the test shards can spread it; the shared setup is in `visual-editor-shell-round-trip.harness.tsx`.
 */
import {
  ReportingResizeObserver,
  UNANSWERED_RESEND_REFUSED,
  applyStylePatch,
  baseSearch,
  bridgeWithoutPresentationAck,
  canvasY,
  commitInlineText,
  context,
  editorHolding,
  flushFrames,
  fromPreview,
  getThemeEditor,
  heroNode,
  holdContentDebounce,
  liveFrame,
  messagesOfType,
  posted,
  promoteText,
  readyQueryClient,
  renderShell,
  renderShellWithHero,
  saveStatus,
  selectHeading,
  sendInlineCommit,
  stylePatchTarget,
  updateSectionProps,
} from "./visual-editor-shell-round-trip.harness";
import { reloadFrameDocument } from "@/lib/test-utils/preview-frame-handshake";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StorefrontThemeEditorDTO,
} from "@/lib/storefront/dto/storefront-theme.dto";
import {
  useThemeWorkspaceStore,
} from "@/lib/storefront/store/theme-workspace-store";
import type {
  StorefrontThemeEditorSearch,
} from "@/lib/validations/storefront-theme";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import {
  PREVIEW_PRESENTATION_UNCONFIRMABLE_AFTER_MS,
  PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";

describe("the selection round trip", () => {
  it("asks the frame to select a section chosen from the tree", () => {
    const onSearchChange = vi.fn();
    // This test is about selection routing, which predates presentation acks.
    // Keep the frame on the legacy path so the ack-model adapter does not
    // replace the message observer this assertion is measuring.
    renderShell(undefined, bridgeWithoutPresentationAck, onSearchChange);
    posted.length = 0;
    const sectionRow = screen.getByTitle("Select hero; drag to reorder");
    fireEvent.click(sectionRow);
    expect(onSearchChange).toHaveBeenCalledWith({ section: "hero" });
    expect(
      messagesOfType("morph:storefront-preview-set-selection-mode"),
    ).toContainEqual(
      expect.objectContaining({
        enabled: true,
        restoreTarget: expect.objectContaining({
          sectionId: "hero",
          isSection: true,
        }),
      }),
    );
  });

  it("keeps a section change quiet while there is no frame to address", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = renderShell(client);
    posted.length = 0;

    rerender(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={context}
          search={{ ...baseSearch, section: "hero" }}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(posted).toEqual([]);
  });

  it("asks for a selection at a new revision, then re-asserts at that same revision", async () => {
    renderShell();

    // The preview reports what it can select. The panel shows these as rows,
    // named by tag rather than by label — `h1`, not `Heading`.
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
    });

    const row = await screen.findByText("h1");
    // Observed from the click onwards: the mount sync that precedes it carries
    // the revision in hand, which is not what this is about.
    posted.length = 0;
    act(() => {
      row.closest("button")?.click();
    });

    const revisions = messagesOfType(
      "morph:storefront-preview-set-selection-mode",
    ).map((message) => message.selectionRevision);

    // The click is a new selection request, so it mints a number. The second
    // message is the re-assertion that follows it; requiring it keeps this from
    // passing on a run where nothing re-asserted at all. Measured sequence:
    // [1, 1].
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    expect(revisions[0]).toBeGreaterThan(0);

    // Turning selection mode on re-runs the sync effect. It re-asserts the
    // selection in hand and must carry that same number: minting one here
    // outranks the request just made, and the preview's answer to it is
    // discarded as stale — the first tree click of every session failing to
    // move the canvas.
    for (const revision of revisions.slice(1)) {
      expect(revision).toBe(revisions[0]);
    }
  });
});

/**
 * A failed content save has to reach the author.
 *
 * The write is debounced and fired from a timer whose rejection is swallowed on
 * purpose: the mutation reports it, and the shared queue keeps the input for the
 * next attempt. Nothing demonstrated that, so the failure read as silent to
 * anyone looking at the catch — this pins both shapes it arrives in.
 */
describe("a content save that fails", () => {
  it("keeps Document edits unsaved when the bridge cannot acknowledge presentation", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "");
    renderShell(readyQueryClient(), bridgeWithoutPresentationAck);
    await selectHeading();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const field = await screen.findByDisplayValue("Welcome");
    fireEvent.input(field, { target: { value: "Held without ack" } });
    fireEvent.blur(field);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE,
      expect.anything(),
    );
    expect(screen.getByDisplayValue("Held without ack")).toBeTruthy();
    expect(saveStatus()).not.toBe("Saved");

    expect(saveStatus()).toBe("Unsaved");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Held without ack")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("says, after a bounded wait, that a frame which cannot acknowledge pauses content edits", async () => {
    vi.spyOn(toast, "warning").mockImplementation(() => "");
    renderShell(readyQueryClient(), bridgeWithoutPresentationAck);
    await selectHeading();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const field = await screen.findByDisplayValue("Welcome");

    await waitFor(
      () =>
        expect(
          screen.getByTestId("preview-presentation-unconfirmable").textContent,
        ).toContain(PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE),
      { timeout: PREVIEW_PRESENTATION_UNCONFIRMABLE_AFTER_MS + 3_000 },
    );
    // The panels say the same true reason, never "syncing".
    expect(screen.queryByText(/Preview syncing/)).toBeNull();
    expect(
      screen.getAllByText(PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE).length,
    ).toBeGreaterThan(1);

    // Still fail closed: an input is kept and nothing is written.
    fireEvent.input(field, { target: { value: "Held, unconfirmable" } });
    fireEvent.blur(field);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Held, unconfirmable")).toBeTruthy();
  }, 15_000);

  it("re-presents a section whose acknowledgement the frame withdrew", async () => {
    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 2, droppedProps: [] },
    } as never);
    renderShell();
    await selectHeading();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const field = await screen.findByDisplayValue("Welcome");
    await flushFrames();
    const acked = messagesOfType(
      "morph:storefront-preview-update-section-props",
    )
      .filter((message) => message.sectionId === "hero")
      .at(-1)?.presentationToken as { operationId: string } | undefined;
    expect(acked).toBeTruthy();
    const before = posted.length;

    // The frame's document was reset to the server copy: it withdraws what
    // it acknowledged for the content it no longer shows.
    fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: acked!.operationId,
      token: acked,
      status: "not-applied",
      reason: "superseded",
    });
    await flushFrames();

    const reposted = posted
      .slice(before)
      .filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.sectionId === "hero" &&
          message.presentationToken,
      );
    expect(reposted.length, "the section is presented again").toBeGreaterThan(
      0,
    );
    await flushFrames();
    fireEvent.input(field, { target: { value: "After the withdrawal" } });
    fireEvent.blur(field);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(updateSectionProps.mock.calls[0]![0].data.props).toEqual({
      heading: "After the withdrawal",
    });
  });

  it("keeps the proof an input was made with when the frame later withdraws what it shows", async () => {
    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 2, droppedProps: [] },
    } as never);
    renderShell();
    await selectHeading();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const field = await screen.findByDisplayValue("Welcome");
    await flushFrames();

    // Typed while the page is presented and acknowledged: the write's basis
    // is the proof taken at this input.
    fireEvent.input(field, { target: { value: "Typed while presented" } });
    fireEvent.blur(field);
    await flushFrames();
    const shown = messagesOfType("morph:storefront-preview-update-section-props")
      .filter((message) => message.sectionId === "hero")
      .at(-1)?.presentationToken as { operationId: string } | undefined;
    expect(shown).toBeTruthy();
    expect(updateSectionProps).not.toHaveBeenCalled();

    // Before the input's debounce runs out, the frame says it no longer
    // shows that presentation (as it does when it navigates back to the
    // page). That is about what is on screen now, not about the basis the
    // author typed on.
    fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: shown!.operationId,
      token: shown,
      status: "not-applied",
      reason: "superseded",
    });

    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(updateSectionProps.mock.calls[0]![0].data.props).toEqual({
      heading: "Typed while presented",
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("says so when the server refuses the write", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
    } as never);
    renderShell();

    await commitInlineText();

    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    expect(error).toHaveBeenCalledWith(
      "Template draft was modified concurrently.",
    );
  });

  it("is not sent again by itself when the request gets no answer", async () => {
    updateSectionProps.mockRejectedValue(new Error("offline"));
    renderShell();
    await commitInlineText();

    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    // No answer is not "it did not land": it may have, so nothing goes again
    // on its own — not this write, and not the next edit either.
    await commitInlineText("Hello again", "Hello");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("releases other section writes after a moved unanswered write becomes a conflict", async () => {
    const secondNode = {
      ...heroNode,
      id: "second:node:heading",
      sectionId: "second",
      target: {
        ...heroNode.target,
        sectionId: "second",
        nodeId: "second:node:heading",
      },
    };
    const twoSectionContext = {
      ...context,
      templates: [
        {
          ...context.templates[0]!,
          document: {
            version: 1,
            sections: [
              ...context.templates[0]!.document.sections,
              {
                id: "second",
                type: "hero",
                enabled: true,
                props: { heading: "Second" },
              },
            ],
          },
        },
      ],
    } as StorefrontThemeEditorDTO;
    const movedRead = {
      ...twoSectionContext,
      templates: [
        {
          ...twoSectionContext.templates[0]!,
          draftGeneration: 2,
          document: {
            version: 1,
            sections: [
              {
                id: "hero",
                type: "hero",
                enabled: true,
                props: { heading: "Theirs" },
              },
              {
                id: "second",
                type: "hero",
                enabled: true,
                props: { heading: "Second" },
              },
            ],
          },
        },
      ],
    } as StorefrontThemeEditorDTO;
    updateSectionProps
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        success: true,
        data: { draftGeneration: 3, droppedProps: [] },
      } as never);
    getThemeEditor.mockResolvedValue({
      success: true,
      message: "ok",
      data: movedRead,
    });
    renderShell(readyQueryClient(), twoSectionContext);

    await commitInlineText("Mine", "Welcome");
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();

    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [secondNode],
    });
    const row = await screen.findByText("h1");
    act(() => row.closest("button")?.click());
    sendInlineCommit("Second edited", "Second", undefined, "second");

    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(updateSectionProps.mock.calls[1]![0].data).toMatchObject({
      sectionId: "second",
      props: { heading: "Second edited" },
      expectedDraftGeneration: 2,
    });
  });

  it("resends an unanswered write once, at its frozen basis, when the readback does not show it", async () => {
    updateSectionProps
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        success: true,
        data: { draftGeneration: 2, droppedProps: [] },
      } as never);
    // The server still holds the section as it was, at the same generation.
    getThemeEditor.mockResolvedValue(editorHolding({}, 1));
    renderShell();
    await commitInlineText();
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    const first = updateSectionProps.mock.calls[0]![0].data;
    getThemeEditor.mockClear();

    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });

    // Not landed at its own generation: sent once more, exactly as first
    // sent (Task 35 rule), and only once the read has answered.
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(getThemeEditor).toHaveBeenCalled();
    const resent = updateSectionProps.mock.calls[1]![0].data;
    expect(resent).toMatchObject({
      sectionId: first.sectionId,
      props: first.props,
      expectedDraftGeneration: first.expectedDraftGeneration,
      expectedSourceGeneration: first.expectedSourceGeneration,
    });
    expect(first.expectedDraftGeneration).toBe(1);
    await waitFor(() => expect(saveStatus()).not.toBe("Save failed"));
    expect(
      document
        .querySelector("[data-editor-unconfirmed-saves]")
        ?.getAttribute("data-editor-unconfirmed-saves") ?? null,
    ).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps, "and never a third time").toHaveBeenCalledTimes(
      2,
    );
  });

  it("resends an unanswered write once, at its frozen basis, after the frame reloaded", async () => {
    // The write was sent with the proof of the old ready round. A reload
    // ends that round, but the resend is the same write the server may
    // already hold, sent as first sent and guarded by CAS at its original
    // generations: it is sent, never dropped for want of a fresh proof.
    updateSectionProps
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        success: true,
        data: { draftGeneration: 2, droppedProps: [] },
      } as never);
    getThemeEditor.mockResolvedValue(editorHolding({}, 1));
    renderShell();
    await commitInlineText();
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    const first = updateSectionProps.mock.calls[0]![0].data;

    reloadFrameDocument();
    liveFrame.ready();
    await flushFrames();
    await new Promise((resolve) => setTimeout(resolve, 100));

    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });

    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    const resent = updateSectionProps.mock.calls[1]![0].data;
    expect(resent).toMatchObject({
      sectionId: first.sectionId,
      props: first.props,
      expectedDraftGeneration: 1,
      expectedSourceGeneration: first.expectedSourceGeneration,
    });
    await waitFor(() => expect(saveStatus()).not.toBe("Save failed"));
    expect(
      document.querySelector("[data-editor-unconfirmed-saves]"),
      "answered: no longer tracked",
    ).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps, "and never a third time").toHaveBeenCalledTimes(
      2,
    );
  });

  it("releases the hold and keeps the input as out of date when the resend is refused as moved", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const secondNode = {
      ...heroNode,
      id: "second:node:heading",
      sectionId: "second",
      target: {
        ...heroNode.target,
        sectionId: "second",
        nodeId: "second:node:heading",
      },
    };
    const twoSectionContext = {
      ...context,
      templates: [
        {
          ...context.templates[0]!,
          draftGeneration: 1,
          document: {
            version: 1,
            sections: [
              ...context.templates[0]!.document.sections,
              {
                id: "second",
                type: "hero",
                enabled: true,
                props: { heading: "Second" },
              },
            ],
          },
        },
      ],
    } as StorefrontThemeEditorDTO;
    updateSectionProps
      .mockRejectedValueOnce(new Error("offline"))
      // The resend at the frozen basis: the document moved after the read.
      .mockResolvedValueOnce({
        success: false,
        error: "TEMPLATE_DRAFT_CONFLICT",
        message: "Template draft was modified concurrently.",
      } as never)
      .mockResolvedValue({
        success: true,
        data: { draftGeneration: 3, droppedProps: [] },
      } as never);
    // The read shows the write not landed, at the generation it was sent at.
    getThemeEditor.mockResolvedValue({
      success: true,
      message: "ok",
      data: twoSectionContext,
    });
    renderShell(readyQueryClient(), twoSectionContext);

    await commitInlineText("Mine", "Welcome");
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    const before = error.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    // Round 4 R4-3(a): exactly one message for the press, after read-back.
    expect(
      error.mock.calls.slice(before).map((call) => String(call[0])),
    ).toEqual([UNANSWERED_RESEND_REFUSED]);
    expect(updateSectionProps).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector("[data-editor-unconfirmed-saves]"),
      "the refusal proves the original can no longer land: not held again",
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();
    const said = error.mock.calls.map((call) => String(call[0]));
    // Round 3 R3-3: it was sent again, and refused; read back once more it
    // is not this write's step. The message says what happened.
    expect(said).toContain(UNANSWERED_RESEND_REFUSED);
    expect(said).not.toContainEqual(expect.stringContaining("not sent again"));
    expect(said).not.toContain(
      "An earlier save is still unresolved. Check again before trying other changes.",
    );

    // Other sections are not held behind it.
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [secondNode],
    });
    const row = await screen.findByText("h1");
    act(() => row.closest("button")?.click());
    sendInlineCommit("Second edited", "Second", undefined, "second");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(3));
    expect(updateSectionProps.mock.calls[2]![0].data).toMatchObject({
      sectionId: "second",
      props: { heading: "Second edited" },
    });
  });

  it("does not send again a write that landed when its answer was lost", async () => {
    updateSectionProps.mockRejectedValue(new Error("offline"));
    // The server made the write; only the answer was lost on the way back.
    getThemeEditor.mockResolvedValue(editorHolding({ heading: "Hello" }, 2));
    renderShell();
    await commitInlineText();
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));

    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });

    await waitFor(() => expect(saveStatus()).not.toBe("Save failed"));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("decides nothing when the server cannot be asked", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockRejectedValue(new Error("offline"));
    getThemeEditor.mockRejectedValue(new Error("offline"));
    renderShell();
    await commitInlineText();
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));

    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });

    await waitFor(() => expect(getThemeEditor).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(saveStatus()).toBe("Save failed");
  });

  it("says so when the request never lands", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockRejectedValue(new Error("offline"));
    renderShell();

    await commitInlineText();

    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    expect(error).toHaveBeenCalledWith("Failed to update section properties");
  });
});

/**
 * A write the document moved out from under.
 *
 * The OCC guard refusing the write is the protection, not the problem: the
 * author's edit is still valid, but the document it was written against has
 * moved, so the answer is to rebase it rather than to send it again. Sending it
 * again is what lands one author's stale copy on another's work.
 */
describe("a content save the document moved under", () => {
  it("offers the update, and not a retry that would resend the stale payload", async () => {
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    } as never);
    renderShell();

    await commitInlineText();

    // The status names what happened to the edit, and the control beside it
    // names the action: load the latest, keep the author's changes.
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();
  });

  it("resends rebased onto the latest document, at the generation it reports", async () => {
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    } as never);

    // The document as someone else left it: they changed `heading` and added
    // `cta`, and the draft generation is ahead of this session's.
    const client = readyQueryClient();
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      {
        success: true,
        data: {
          ...context,
          templates: [
            {
              ...context.templates[0],
              draftGeneration: 7,
              document: {
                version: 1,
                sections: [
                  {
                    id: "hero",
                    type: "hero",
                    props: { heading: "Theirs", cta: "New" },
                  },
                ],
              },
            },
          ],
        },
      } as never,
    );
    renderShell(client);

    await commitInlineText("Mine");
    // The write is debounced, so the refusal arrives on its own schedule.
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));

    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 8, droppedProps: [] },
    } as never);
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });
    await waitFor(() =>
      expect(
        messagesOfType("morph:storefront-preview-update-section-props").some(
          (message) => {
            const token = message.presentationToken as
              { documentBasis?: { draftGeneration?: number } } | undefined;
            return token?.documentBasis?.draftGeneration === 7;
          },
        ),
      ).toBe(true),
    );
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    await flushFrames();
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });

    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    const resend = updateSectionProps.mock.calls[1]![0] as {
      data: { props: Record<string, unknown>; expectedDraftGeneration: number };
    };

    // Only the author's changed field is sent. The server's partial merge
    // preserves cta; sending a remote field back is no longer confirmation.
    expect(resend.data.props).toEqual({ heading: "Mine" });
    // The generation comes from the document as it is now. Reusing this
    // session's observed one would be refused for the same reason.
    expect(resend.data.expectedDraftGeneration).toBe(7);
  });
});

describe("a list both writers changed", () => {
  it("stops rather than writing the author's copy of the list over theirs", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const rows = (...titles: string[]) =>
      titles.map((title) => ({ id: title.toLowerCase(), title }));
    const listContext = {
      ...context,
      templates: [
        {
          ...context.templates[0],
          document: {
            version: 1,
            sections: [
              {
                id: "hero",
                name: "Featured",
                type: "hero",
                componentRef: stylePatchTarget.filePath,
                props: {
                  heading: "Welcome",
                  items: rows("A", "B"),
                },
              },
              {
                id: "other",
                name: "Other",
                type: "hero",
                componentRef: stylePatchTarget.filePath,
                props: {
                  heading: "Other",
                  items: rows("X"),
                },
              },
            ],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    } as never);

    // The document as the other writer left it: a row added in front.
    const client = readyQueryClient();
    const remote = {
      success: true,
      data: {
        ...listContext,
        templates: [
          {
            ...listContext.templates[0],
            draftGeneration: 7,
            document: {
              version: 1,
              sections: [
                {
                  id: "hero",
                  name: "Featured",
                  type: "hero",
                  props: {
                    heading: "Welcome",
                    items: rows("C", "A", "B"),
                  },
                },
                {
                  id: "other",
                  name: "Other",
                  type: "hero",
                  props: {
                    heading: "Other",
                    items: rows("X"),
                  },
                },
              ],
            },
          },
        ],
      },
    };
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      remote as never,
    );
    renderShellWithHero(
      `export const contentFields = {
        heading: { type: "text", label: "Heading" },
        items: { type: "array", label: "Items", fields: { title: { type: "text", label: "Title" } } },
      } as const;
      export function Hero({ heading = "Welcome", items = [] }) {
        return <section><h1>{heading}</h1>{items.map((item) => <p key={item.id}>{item.title}</p>)}</section>;
      }`,
      "hero",
      listContext,
      client,
    );
    if (document.querySelector("iframe")) liveFrame.ready();

    // The author edits B's title on the canvas.
    const rowNode = {
      ...heroNode,
      id: "hero:node:row-title",
      label: "Title",
      target: {
        sectionId: "hero",
        nodeId: "hero:node:row-title",
        fieldKey: "title",
        fieldPath: "items.1.title",
        itemId: "b",
        isSection: false,
      },
    };
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [rowNode],
    });
    const row = await screen.findByText("h1");
    act(() => {
      row.closest("button")?.click();
    });
    sendInlineCommit("B edited", "B", {
      fieldKey: "title",
      fieldPath: "items.1.title",
    });
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));

    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 8, droppedProps: [] },
    } as never);
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });

    // Nothing is sent: the author's array would remove C and put the edit
    // where C now sits. The author is told why, and the section stays out of
    // date with their edit kept.
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/items also changed elsewhere/),
      ),
    );
    // `items` is a declared list of a section on this page, so its own
    // discard control is the way out, and the message names it without a
    // hedge (Task 41 31-B). No generic Discard mine is offered for it.
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Select Featured and use "Discard unsaved changes to Items" beside the list in the Content panel',
      ),
    );
    expect(error).not.toHaveBeenCalledWith(
      expect.stringContaining("if the Inspector exposes one"),
    );
    expect(screen.queryByRole("button", { name: "Discard mine…" })).toBeNull();
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(saveStatus()).toBe("Out of date");

    // The list itself names the unsaved conflict and opens a list-only
    // confirmation. A toolbar action that discards the whole section can
    // also erase unrelated fields the author still has pending.
    // A row selection only exposes the row's own fields. The list controls
    // belong to the section entry, selected through the real Sections panel.
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: "Featured" }));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await flushFrames();
    expect(await screen.findByText("Not saved")).toBeTruthy();

    act(() => {
      screen
        .getByRole("button", { name: /discard unsaved changes to items/i })
        .click();
    });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Discard changes to .*items/);
    expect(dialog.textContent).toMatch(
      /only your unsaved changes to this list/,
    );
    expect(dialog.textContent).toMatch(/Other fields and lists will stay/);

    // Declined, nothing changes: the draft is still there to decide about.
    act(() => {
      screen.getByRole("button", { name: "Keep my changes" }).click();
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(saveStatus()).toBe("Out of date");
    expect(
      screen.getByRole("button", {
        name: /discard unsaved changes to items/i,
      }),
    ).toBeTruthy();

    // Confirmed while the latest version cannot be read: nothing is
    // discarded, since dropping the draft would leave the author with neither.
    getThemeEditor.mockRejectedValueOnce(new Error("offline"));
    act(() => {
      screen
        .getByRole("button", {
          name: /discard unsaved changes to items/i,
        })
        .click();
    });
    act(() => {
      screen
        .getByRole("button", {
          name: "Discard list changes and load latest",
        })
        .click();
    });
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/nothing was discarded/),
      ),
    );
    expect(saveStatus()).toBe("Out of date");

    // Confirmed, but the author edits the section again while the latest
    // version is loading. That edit is not part of what they confirmed, so
    // nothing is discarded; meanwhile no second discard can be started.
    // The server still refuses the stale document, as OCC does.
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    } as never);
    let release!: (value: unknown) => void;
    getThemeEditor.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    act(() => {
      screen
        .getByRole("button", {
          name: /discard unsaved changes to items/i,
        })
        .click();
    });
    act(() => {
      screen
        .getByRole("button", {
          name: "Discard list changes and load latest",
        })
        .click();
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Discard list changes and load latest",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    const sentBeforeEdit = updateSectionProps.mock.calls.length;
    sendInlineCommit("B edited again", "B edited", {
      fieldKey: "title",
      fieldPath: "items.1.title",
    });
    act(() => release(remote));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/while the latest version was loading/),
      ),
    );
    expect(saveStatus()).toBe("Out of date");
    // The newer edit is refused before it is sent: it was typed into B at
    // index 1, and the latest version has A there. Sending it would have
    // been refused as out of date at best, and at worst written A's title.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).toHaveBeenCalledTimes(sentBeforeEdit);
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    const sentBeforeDiscard = updateSectionProps.mock.calls.length;

    // Confirmed with the latest version readable and nothing typed meanwhile,
    // the section's draft is dropped and the conflict with it. Nothing is
    // written: the latest version is what the editor now holds.
    getThemeEditor.mockResolvedValue(remote);
    act(() => {
      screen
        .getByRole("button", {
          name: /discard unsaved changes to items/i,
        })
        .click();
    });
    act(() => {
      screen
        .getByRole("button", {
          name: "Discard list changes and load latest",
        })
        .click();
    });
    await waitFor(() => expect(saveStatus()).not.toBe("Out of date"));
    expect(
      screen.queryByRole("button", {
        name: /discard unsaved changes to items/i,
      }),
    ).toBeNull();
    expect(updateSectionProps).toHaveBeenCalledTimes(sentBeforeDiscard);

    // Discard's reset is a one-shot value. A later real Add followed by
    // deselecting and reselecting this section must keep the newer row rather
    // than applying the old discarded list again on Inspector remount.
    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 8, droppedProps: [] },
    } as never);
    updateSectionProps.mockImplementation(async ({ data }) => {
      // Model the successful Add reaching the document returned on the next
      // section selection. Otherwise this test would only observe the stale
      // loader fixture, not whether an old discard reset overwrote the save.
      const persistedSection = listContext.templates[0]!.document.sections.find(
        (candidate) => candidate.id === data.sectionId,
      );
      if (persistedSection) {
        Object.assign(persistedSection.props, data.props);
      }
      return {
        success: true,
        data: { draftGeneration: 8, droppedProps: [] },
      };
    });
    const removeButtons = () =>
      screen.getAllByRole("button", { name: "Remove" });
    expect(removeButtons()).toHaveLength(3);
    const beforeAdd = updateSectionProps.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(removeButtons()).toHaveLength(4));
    await waitFor(() =>
      expect(updateSectionProps).toHaveBeenCalledTimes(beforeAdd + 1),
    );
    expect(
      (
        listContext.templates[0]!.document.sections[0]!.props as {
          items: unknown[];
        }
      ).items,
    ).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: "Featured" }));
    await flushFrames();
    expect(removeButtons()).toHaveLength(4);
  });

  it("keeps a sibling-list and another section's conflict marker when discarding one list", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const rows = (...titles: string[]) =>
      titles.map((title) => ({ id: title.toLowerCase(), title }));
    const listContext = {
      ...context,
      templates: [
        {
          ...context.templates[0],
          document: {
            version: 1,
            sections: [
              {
                id: "hero",
                name: "Featured",
                type: "hero",
                componentRef: stylePatchTarget.filePath,
                props: {
                  heading: "Welcome",
                  items: rows("A", "B"),
                  related: rows("R"),
                },
              },
              {
                id: "other",
                name: "Other",
                type: "hero",
                componentRef: stylePatchTarget.filePath,
                props: {
                  heading: "Other",
                  items: rows("X"),
                  related: rows("R"),
                },
              },
            ],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;
    const remote = {
      success: true,
      data: {
        ...listContext,
        templates: [
          {
            ...listContext.templates[0],
            draftGeneration: 7,
            document: {
              version: 1,
              sections: [
                {
                  id: "hero",
                  name: "Featured",
                  type: "hero",
                  props: {
                    heading: "Welcome",
                    items: rows("C", "A", "B"),
                    related: rows("S", "R"),
                  },
                },
                {
                  id: "other",
                  name: "Other",
                  type: "hero",
                  props: {
                    heading: "Other",
                    items: rows("X"),
                    related: rows("R"),
                  },
                },
              ],
            },
          },
        ],
      },
    };
    const client = readyQueryClient();
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      remote as never,
    );
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    } as never);
    renderShellWithHero(
      `export const contentFields = {
        heading: { type: "text", label: "Heading" },
        items: { type: "array", label: "Items", fields: { title: { type: "text", label: "Title" } } },
        related: { type: "array", label: "Related", fields: { title: { type: "text", label: "Title" } } },
      } as const;
      export function Hero({ heading = "Welcome", items = [], related = [] }) {
        return <section><h1>{heading}</h1>{items.map((item) => <p key={item.id}>{item.title}</p>)}{related.map((item) => <p key={item.id}>{item.title}</p>)}</section>;
      }`,
      "hero",
      listContext,
      client,
    );

    // Both lists on Featured are changed locally before the one section write.
    // The server then returns two independent list conflicts in that entry.
    fireEvent.click(screen.getByRole("button", { name: "Featured" }));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await flushFrames();
    const addEntries = () =>
      screen.getAllByRole("button", { name: "Add entry" });
    expect(addEntries()).toHaveLength(2);
    fireEvent.click(addEntries()[0]!);
    await flushFrames();
    fireEvent.click(addEntries()[1]!);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));

    updateSectionProps.mockResolvedValueOnce({
      success: true,
      data: { draftGeneration: 8, droppedProps: [] },
    } as never);
    act(() =>
      screen.getByRole("button", { name: "Load latest, keep mine" }).click(),
    );
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/items, related also changed elsewhere/),
      ),
    );
    expect(
      screen.getByRole("button", {
        name: /discard unsaved changes to related/i,
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await flushFrames();
    const remoteOtherChanged = {
      ...remote,
      data: {
        ...remote.data,
        templates: [
          {
            ...remote.data.templates[0],
            draftGeneration: 9,
            document: {
              version: 1,
              sections: [
                {
                  id: "hero",
                  name: "Featured",
                  type: "hero",
                  props: {
                    heading: "Welcome",
                    items: rows("C", "A", "B"),
                    related: rows("S", "R"),
                  },
                },
                {
                  id: "other",
                  name: "Other",
                  type: "hero",
                  props: {
                    heading: "Other",
                    items: rows("X"),
                    related: rows("S"),
                  },
                },
              ],
            },
          },
        ],
      },
    } as never;
    updateSectionProps.mockReset();
    let refuseOtherWrite!: (value: unknown) => void;
    updateSectionProps.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          refuseOtherWrite = resolve;
        }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Add entry" })[1]!);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(updateSectionProps.mock.calls[0]![0].data.sectionId).toBe("other");
    act(() => {
      client.setQueryData(
        storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
        remoteOtherChanged,
      );
      refuseOtherWrite({
        success: false,
        message: "Template draft was modified concurrently.",
        error: "TEMPLATE_DRAFT_CONFLICT",
      });
    });
    expect(updateSectionProps.mock.calls).toHaveLength(1);
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    getThemeEditor.mockResolvedValueOnce(remoteOtherChanged);
    act(() =>
      screen.getByRole("button", { name: "Load latest, keep mine" }).click(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: /discard unsaved changes to related/i,
        }),
      ).toBeTruthy(),
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/related also changed elsewhere/),
    );
    expect(
      screen.getByRole("button", {
        name: /discard unsaved changes to related/i,
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Featured" }));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await flushFrames();
    act(() =>
      screen
        .getByRole("button", {
          name: /discard unsaved changes to items/i,
        })
        .click(),
    );
    await screen.findByRole("alertdialog");
    getThemeEditor.mockResolvedValueOnce(remoteOtherChanged);
    act(() =>
      screen
        .getByRole("button", {
          name: "Discard list changes and load latest",
        })
        .click(),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(
      document.querySelector('[data-list-not-saved="related"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: /discard unsaved changes to related/i,
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await flushFrames();
    expect(
      document.querySelector('[data-list-not-saved="related"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: /discard unsaved changes to related/i,
      }),
    ).toBeTruthy();
  });

  /**
   * Task 41 (31-A, 31-C): one declared list, a second section to move the
   * Inspector to, and a hidden one whose Content the panel refuses, which
   * unmounts the Inspector.
   */
  function declaredListFixture() {
    const rows = (...titles: string[]) =>
      titles.map((title) => ({ id: title.toLowerCase(), title }));
    const template = (items: unknown, generation: number) => ({
      ...context.templates[0],
      draftGeneration: generation,
      document: {
        version: 1,
        sections: [
          {
            id: "hero",
            name: "Featured",
            type: "hero",
            enabled: true,
            componentRef: stylePatchTarget.filePath,
            props: { heading: "Welcome", items },
          },
          {
            id: "other",
            name: "Other",
            type: "hero",
            enabled: true,
            componentRef: stylePatchTarget.filePath,
            props: { heading: "Other", items: rows("X") },
          },
          {
            id: "gone",
            name: "Gone",
            type: "hero",
            enabled: false,
            componentRef: stylePatchTarget.filePath,
            props: { heading: "Gone", items: rows("G") },
          },
        ],
      },
    });
    const listContext = {
      ...context,
      templates: [template(rows("A", "B"), 1)],
    } as unknown as StorefrontThemeEditorDTO;
    const remoteWith = (items: unknown, generation: number) => ({
      success: true,
      message: "ok",
      data: { ...listContext, templates: [template(items, generation)] },
    });
    const source = `export const contentFields = {
        heading: { type: "text", label: "Heading" },
        items: { type: "array", label: "Items", fields: { title: { type: "text", label: "Title" } } },
      } as const;
      export function Hero({ heading = "Welcome", items = [] }) {
        return <section><h1>{heading}</h1>{items.map((item) => <p key={item.id}>{item.title}</p>)}</section>;
      }`;
    return { rows, listContext, remoteWith, client: readyQueryClient(), source };
  }

  async function openSection(name: string | RegExp) {
    fireEvent.click(screen.getByRole("button", { name }));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await flushFrames();
  }

  /** Add, refused as moved, then Load latest, keep mine: a list conflict. */
  async function conflictOnAdd(
    client: QueryClient,
    remote: unknown,
    sentBefore: number,
  ) {
    updateSectionProps.mockResolvedValueOnce({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    } as never);
    getThemeEditor.mockResolvedValue(remote as never);
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      remote as never,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() =>
      expect(updateSectionProps).toHaveBeenCalledTimes(sentBefore + 1),
    );
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    act(() =>
      screen.getByRole("button", { name: "Load latest, keep mine" }).click(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: /discard unsaved changes to items/i,
        }),
      ).toBeTruthy(),
    );
  }

  /** Discards the items list through its own control; returns the dialog text. */
  async function discardItems() {
    act(() =>
      screen
        .getByRole("button", { name: /discard unsaved changes to items/i })
        .click(),
    );
    const dialog = await screen.findByRole("alertdialog");
    const text = dialog.textContent ?? "";
    act(() =>
      screen
        .getByRole("button", { name: "Discard list changes and load latest" })
        .click(),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    return text;
  }

  const removeButtons = () =>
    screen.queryAllByRole("button", { name: "Remove" });

  it("applies a second discard in the same session, with the Inspector mounted throughout", async () => {
    const { rows, listContext, remoteWith, client, source } =
      declaredListFixture();
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const view = renderShellWithHero(source, "hero", listContext, client);
    await openSection("Featured");
    expect(removeButtons()).toHaveLength(2);

    // First conflict: the other writer added C in front.
    await conflictOnAdd(client, remoteWith(rows("C", "A", "B"), 7), 0);
    await discardItems();
    await waitFor(() => expect(removeButtons()).toHaveLength(3));

    // Second conflict on the same list: the other writer left only Z.
    const sent = updateSectionProps.mock.calls.length;
    const latest = remoteWith(rows("Z"), 9);
    await conflictOnAdd(client, latest, sent);
    await discardItems();
    // The panel shows the latest list, not the author's discarded rows.
    await waitFor(() => expect(removeButtons()).toHaveLength(1));
    const inspectorAdd = screen.getByRole("button", { name: "Add entry" });

    // The route's data catches up with the read, as its loader does after a
    // refetch (this harness holds `context` fixed otherwise). The Inspector
    // stays mounted through it.
    view.rerender(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={latest.data as unknown as StorefrontThemeEditorDTO}
          search={{ ...baseSearch, section: "hero" }}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await flushFrames();
    expect(screen.getByRole("button", { name: "Add entry" })).toBe(inspectorAdd);
    expect(removeButtons()).toHaveLength(1);

    // And the next edit is made on it: Z plus the new row, never C, A, B.
    updateSectionProps.mockResolvedValueOnce({
      success: true,
      data: { draftGeneration: 10, droppedProps: [] },
    } as never);
    const before = updateSectionProps.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() =>
      expect(updateSectionProps).toHaveBeenCalledTimes(before + 1),
    );
    const last = updateSectionProps.mock.calls.at(-1)![0].data;
    const items = last.props.items as Array<{ id?: string; title?: string }>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "z", title: "Z" });
    expect(last).toMatchObject({ expectedDraftGeneration: 9 });
  });

  it("keeps a row added after a discard across a real Inspector unmount and remount", async () => {
    const { rows, listContext, remoteWith, client, source } =
      declaredListFixture();
    vi.spyOn(toast, "error").mockImplementation(() => "");
    renderShellWithHero(source, "hero", listContext, client);
    await openSection("Featured");
    await conflictOnAdd(client, remoteWith(rows("C", "A", "B"), 7), 0);
    await discardItems();
    await waitFor(() => expect(removeButtons()).toHaveLength(3));

    // The Add lands, and the editor's document (what a fresh Inspector mount
    // reads) holds it, as the route's data does once it is refetched.
    updateSectionProps.mockImplementationOnce(async ({ data }) => {
      const stored = listContext.templates[0]!.document.sections.find(
        (candidate) => candidate.id === data.sectionId,
      );
      if (stored) Object.assign(stored.props, data.props);
      return { success: true, data: { draftGeneration: 8, droppedProps: [] } };
    });
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(removeButtons()).toHaveLength(4));
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(saveStatus()).toMatch(/^(Unpublished|Published)$/),
    );

    // A hidden section opens no Content: the Inspector is unmounted.
    const addBefore = screen.getByRole("button", { name: "Add entry" });
    await openSection(/^Gone/);
    expect(screen.queryByRole("button", { name: "Add entry" })).toBeNull();
    await openSection("Featured");
    const addAfter = screen.getByRole("button", { name: "Add entry" });
    expect(addAfter, "a fresh mount").not.toBe(addBefore);
    expect(removeButtons()).toHaveLength(4);
  });

  // Task 41 R2-3 (the brief's rule): only a list write whose outcome was
  // unknown and was later confirmed landed is named; an ordinary answered
  // write is just saved, and the dialog says nothing about it. This replaces
  // the round-1 test that expected the line after an answered write.
  it("says nothing of a saved change after an ordinary answered list write", async () => {
    const { rows, listContext, remoteWith, client, source } =
      declaredListFixture();
    vi.spyOn(toast, "error").mockImplementation(() => "");
    renderShellWithHero(source, "hero", listContext, client);
    await openSection("Featured");

    // The first Add is answered, as the server answers, with the document
    // it now holds: it landed and is saved.
    updateSectionProps.mockImplementationOnce(async ({ data }) => ({
      success: true,
      data: {
        draftGeneration: data.expectedDraftGeneration + 1,
        droppedProps: [],
        document: {
          version: 1,
          sections: listContext.templates[0]!.document.sections.map(
            (section) =>
              section.id === data.sectionId
                ? { ...section, props: { ...section.props, ...data.props } }
                : section,
          ),
        },
      },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(saveStatus()).toMatch(/^(Unpublished|Published)$/),
    );

    // The second Add meets the other writer's change to the same list.
    await conflictOnAdd(client, remoteWith(rows("C", "A", "B", "N"), 7), 1);
    const text = await discardItems();
    expect(text).not.toMatch(/A saved change is not undone/);
    expect(updateSectionProps).toHaveBeenCalledTimes(2);
  });

  it("says a saved change is not undone when an unanswered list write was later found landed", async () => {
    const { rows, listContext, remoteWith, client, source } =
      declaredListFixture();
    vi.spyOn(toast, "error").mockImplementation(() => "");
    renderShellWithHero(source, "hero", listContext, client);
    await openSection("Featured");

    // The first Add gets no answer: its outcome is unknown.
    updateSectionProps.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    const sentItems = updateSectionProps.mock.calls[0]![0].data.props.items;

    // The read-back finds it stored, one generation on: it landed.
    getThemeEditor.mockResolvedValue(remoteWith(sentItems, 2) as never);
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      remoteWith(sentItems, 2) as never,
    );
    act(() => screen.getByRole("button", { name: "Try again" }).click());
    await waitFor(() =>
      expect(
        document.querySelector("[data-editor-unconfirmed-saves]"),
      ).toBeNull(),
    );
    await waitFor(() => expect(saveStatus()).not.toBe("Save failed"));
    expect(updateSectionProps, "landed: not sent again").toHaveBeenCalledTimes(
      1,
    );

    // The next Add meets the other writer's change to the same list.
    await conflictOnAdd(client, remoteWith(rows("C", "A", "B", "N"), 7), 1);
    const text = await discardItems();
    expect(text).toMatch(/A saved change is not undone/);
    // Only the unsaved change was dropped; nothing was written to undo the
    // saved one.
    expect(updateSectionProps).toHaveBeenCalledTimes(2);
  });

  // Task 41 R2-1: section ids are unique only within a document. Two pages
  // each with a "hero" whose items both writers changed: discarding on one
  // page discards that page's list only, and never pours the other page's
  // latest rows into the Inspector.
  it("discards the list of the page it is pressed on, not a same-id section's on another page", async () => {
    const rows = (...titles: string[]) =>
      titles.map((title) => ({ id: title.toLowerCase(), title }));
    const page = (
      id: string,
      type: string,
      name: string,
      items: unknown,
      generation: number,
    ) => ({
      ...context.templates[0],
      id,
      type,
      name,
      draftGeneration: generation,
      document: {
        version: 1,
        sections: [
          {
            id: "hero",
            name: "Featured",
            type: "hero",
            enabled: true,
            componentRef: stylePatchTarget.filePath,
            props: { heading: "Welcome", items },
          },
        ],
      },
    });
    const pages = (
      home: unknown,
      homeGeneration: number,
      about: unknown,
      aboutGeneration: number,
    ) =>
      ({
        ...context,
        templates: [
          page("template-1", "index", "Home", home, homeGeneration),
          page("template-2", "page", "About", about, aboutGeneration),
        ],
      }) as unknown as StorefrontThemeEditorDTO;
    const { source } = declaredListFixture();
    const client = readyQueryClient();
    const start = pages(rows("A", "B"), 1, rows("A", "B"), 1);
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const refuse = () =>
      updateSectionProps.mockResolvedValueOnce({
        success: false,
        message: "Template draft was modified concurrently.",
        error: "TEMPLATE_DRAFT_CONFLICT",
      } as never);
    const view = renderShellWithHero(source, "hero", start, client);
    const show = (search: StorefrontThemeEditorSearch) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <VisualEditorShell
            context={start}
            search={search}
            onSearchChange={vi.fn()}
          />
        </QueryClientProvider>,
      );
    const home = { ...baseSearch, section: "hero" };
    const about = {
      ...baseSearch,
      template: "page",
      templateId: "template-2",
      section: "hero",
    } as StorefrontThemeEditorSearch;

    // Home's Add, refused: home's draft is held.
    await openSection("Featured");
    refuse();
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(updateSectionProps.mock.calls[0]![0].data.templateId).toBe(
      "template-1",
    );

    // About's Add, refused: about's draft is held too.
    show(about);
    await flushFrames();
    await openSection("Featured");
    refuse();
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(updateSectionProps.mock.calls[1]![0].data.templateId).toBe(
      "template-2",
    );

    // Both pages' lists were changed elsewhere: home put C first, about Q.
    const latest = {
      success: true,
      message: "ok",
      data: pages(rows("C", "A", "B"), 7, rows("Q", "A", "B"), 5),
    };
    getThemeEditor.mockResolvedValue(latest as never);
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      latest as never,
    );
    act(() =>
      screen.getByRole("button", { name: "Load latest, keep mine" }).click(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: /discard unsaved changes to items/i,
        }),
      ).toBeTruthy(),
    );

    // Discarded on About: About's list is the latest About list.
    await discardItems();
    await waitFor(() => expect(screen.getByDisplayValue("Q")).toBeTruthy());
    expect(screen.queryByDisplayValue("C")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /discard unsaved changes to items/i }),
    ).toBeNull();

    // Home's draft and its way out are still there.
    show(home);
    await flushFrames();
    await openSection("Featured");
    expect(
      screen.getByRole("button", { name: /discard unsaved changes to items/i }),
    ).toBeTruthy();
    expect(updateSectionProps).toHaveBeenCalledTimes(2);
  });

  // The Inspector opening a section while the editor keeps an unsaved draft
  // of it shows that draft, as the canvas does, and only there: never in a
  // same-id section of another document, another section, a sibling field,
  // or after the draft was discarded.
  describe("a kept draft when the Inspector opens a section again", () => {
    const section = (
      id: string,
      name: string,
      heading: string,
      subheading: string,
    ) => ({
      id,
      name,
      type: "hero",
      enabled: true,
      componentRef: stylePatchTarget.filePath,
      props: { heading, subheading },
    });
    const pages = {
      ...context,
      templates: [
        {
          ...context.templates[0],
          id: "template-1",
          type: "index",
          name: "Home",
          draftGeneration: 1,
          document: {
            version: 1,
            sections: [
              section("hero", "Featured", "Home heading", "Home sub"),
              section("other", "Other", "Other heading", "Other sub"),
            ],
          },
        },
        {
          ...context.templates[0],
          id: "template-2",
          type: "page",
          name: "About",
          draftGeneration: 1,
          document: {
            version: 1,
            sections: [section("hero", "Featured", "About heading", "About sub")],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;
    const source = `export const contentFields = {
        heading: { type: "text", label: "Heading" },
        subheading: { type: "text", label: "Subheading" },
      } as const;
      export function Hero({ heading = "Default heading", subheading = "Default sub" }) {
        return <section><h1>{heading}</h1><p>{subheading}</p></section>;
      }`;
    const about = {
      ...baseSearch,
      template: "page",
      templateId: "template-2",
      section: "hero",
    } as StorefrontThemeEditorSearch;

    /**
     * Home's hero heading is typed and left; its write is refused as moved,
     * so the draft is kept, unsaved, under Home's hero.
     */
    async function keepHomeHeadingDraft() {
      vi.spyOn(toast, "error").mockImplementation(() => "");
      const client = readyQueryClient();
      const view = renderShellWithHero(source, "hero", pages, client);
      const show = (search: StorefrontThemeEditorSearch) =>
        view.rerender(
          <QueryClientProvider client={client}>
            <VisualEditorShell
              context={pages}
              search={search}
              onSearchChange={vi.fn()}
            />
          </QueryClientProvider>,
        );
      await openSection("Featured");
      updateSectionProps.mockResolvedValueOnce({
        success: false,
        message: "Template draft was modified concurrently.",
        error: "TEMPLATE_DRAFT_CONFLICT",
      } as never);
      const field = await screen.findByDisplayValue("Home heading");
      fireEvent.input(field, { target: { value: "Kept draft" } });
      fireEvent.blur(field);
      await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(saveStatus()).toBe("Out of date"));
      expect(updateSectionProps.mock.calls[0]![0].data).toMatchObject({
        templateId: "template-1",
        sectionId: "hero",
        props: { heading: "Kept draft" },
      });
      expect(screen.getByDisplayValue("Kept draft")).toBeTruthy();
      return { show };
    }

    it("the section opened again on its own page shows the kept draft, and nothing is sent", async () => {
      await keepHomeHeadingDraft();
      await openSection("Other");
      expect(screen.getByDisplayValue("Other heading")).toBeTruthy();
      await openSection("Featured");
      expect(screen.getByDisplayValue("Kept draft")).toBeTruthy();
      expect(screen.queryByDisplayValue("Home heading")).toBeNull();
      expect(saveStatus()).toBe("Out of date");
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(updateSectionProps).toHaveBeenCalledTimes(1);
    });

    it("another document's section of the same id and fields never shows it", async () => {
      const { show } = await keepHomeHeadingDraft();
      show(about);
      await flushFrames();
      await openSection("Featured");
      expect(screen.getByDisplayValue("About heading")).toBeTruthy();
      expect(screen.getByDisplayValue("About sub")).toBeTruthy();
      expect(screen.queryByDisplayValue("Kept draft")).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(updateSectionProps).toHaveBeenCalledTimes(1);
    });

    it("another section of the same document never shows it", async () => {
      await keepHomeHeadingDraft();
      await openSection("Other");
      expect(screen.getByDisplayValue("Other heading")).toBeTruthy();
      expect(screen.getByDisplayValue("Other sub")).toBeTruthy();
      expect(screen.queryByDisplayValue("Kept draft")).toBeNull();
    });

    it("a sibling field of the section shows its own value", async () => {
      await keepHomeHeadingDraft();
      await openSection("Other");
      await openSection("Featured");
      expect(screen.getByDisplayValue("Home sub")).toBeTruthy();
      expect(screen.queryByDisplayValue("Default sub")).toBeNull();
      // At most the heading's own field shows the draft.
      expect(
        screen.queryAllByDisplayValue("Kept draft").length,
      ).toBeLessThanOrEqual(1);
    });

    it("after the draft is discarded, the section opened again shows the stored copy, with no notice and nothing sent", async () => {
      const { rows, listContext, remoteWith, client, source } =
        declaredListFixture();
      vi.spyOn(toast, "error").mockImplementation(() => "");
      renderShellWithHero(source, "hero", listContext, client);
      await openSection("Featured");
      await conflictOnAdd(client, remoteWith(rows("C", "A", "B"), 7), 0);
      await discardItems();
      await waitFor(() => expect(removeButtons()).toHaveLength(3));
      const sentAfterDiscard = updateSectionProps.mock.calls.length;
      // The editor's document now holds the latest copy the discard loaded,
      // as the route's data does once it is refetched.
      const stored = listContext.templates[0]!.document.sections.find(
        (candidate) => candidate.id === "hero",
      )!;
      Object.assign(stored.props, { items: rows("C", "A", "B") });

      await openSection("Other");
      await openSection("Featured");
      expect(removeButtons()).toHaveLength(3);
      expect(
        ["C", "A", "B"].map((title) => screen.queryAllByDisplayValue(title).length),
      ).toEqual([1, 1, 1]);
      expect(document.querySelector("[data-list-not-saved]")).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: /discard unsaved changes to items/i,
        }),
      ).toBeNull();
      expect(saveStatus()).not.toBe("Out of date");
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(updateSectionProps).toHaveBeenCalledTimes(sentAfterDiscard);
    });
  });

  // Task 41 R3-1: "Discard mine…" acts only on this page's documents. A list
  // held on another page is discarded from that page, by its own control.
  it("does not offer another page's held list in this page's Discard mine", async () => {
    const rows = (...titles: string[]) =>
      titles.map((title) => ({ id: title.toLowerCase(), title }));
    const page = (
      id: string,
      type: string,
      name: string,
      items: unknown,
      generation: number,
    ) => ({
      ...context.templates[0],
      id,
      type,
      name,
      draftGeneration: generation,
      document: {
        version: 1,
        sections: [
          {
            id: "hero",
            name: "Featured",
            type: "hero",
            enabled: true,
            componentRef: stylePatchTarget.filePath,
            props: { heading: "Welcome", items },
          },
        ],
      },
    });
    const pages = (home: unknown, homeGeneration: number) =>
      ({
        ...context,
        templates: [
          page("template-1", "index", "Home", home, homeGeneration),
          page("template-2", "page", "About", rows("A", "B"), 1),
        ],
      }) as unknown as StorefrontThemeEditorDTO;
    const { source } = declaredListFixture();
    const client = readyQueryClient();
    const start = pages(rows("A", "B"), 1);
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const view = renderShellWithHero(source, "hero", start, client);
    const show = (search: StorefrontThemeEditorSearch) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <VisualEditorShell
            context={start}
            search={search}
            onSearchChange={vi.fn()}
          />
        </QueryClientProvider>,
      );

    // Home's Add, refused, then read against Home's latest: a list conflict.
    await openSection("Featured");
    updateSectionProps.mockResolvedValueOnce({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    } as never);
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    const latest = {
      success: true,
      message: "ok",
      data: pages(rows("C", "A", "B"), 7),
    };
    getThemeEditor.mockResolvedValue(latest as never);
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      latest as never,
    );
    act(() =>
      screen.getByRole("button", { name: "Load latest, keep mine" }).click(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /discard unsaved changes to items/i }),
      ).toBeTruthy(),
    );

    // On About, with a hero of its own: nothing of Home's is offered here.
    show({
      ...baseSearch,
      template: "page",
      templateId: "template-2",
      section: "hero",
    } as StorefrontThemeEditorSearch);
    await flushFrames();
    await openSection("Featured");
    expect(screen.queryByRole("button", { name: "Discard mine…" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /discard unsaved changes to items/i }),
    ).toBeNull();

    // Back on Home, its own discard is the way out, and nothing was sent.
    show({ ...baseSearch, section: "hero" });
    await flushFrames();
    await openSection("Featured");
    expect(
      screen.getByRole("button", { name: /discard unsaved changes to items/i }),
    ).toBeTruthy();
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  // Task 41 R3-2: a hidden section's held list has exactly one exit.
  it("offers only Discard mine for a held list of a section that is hidden now", async () => {
    const { rows, listContext, remoteWith, client, source } =
      declaredListFixture();
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const view = renderShellWithHero(source, "hero", listContext, client);
    await openSection("Featured");
    const latest = remoteWith(rows("C", "A", "B"), 7);
    latest.data.templates[0]!.document.sections[0]!.enabled = false;
    await conflictOnAdd(client, latest, 0);

    // The route's data catches up: the section is hidden now.
    view.rerender(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={latest.data as unknown as StorefrontThemeEditorDTO}
          search={{ ...baseSearch, section: "hero" }}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await flushFrames();
    expect(screen.getByRole("button", { name: "Discard mine…" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /discard unsaved changes to/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Styles$/ }));
    await flushFrames();
    expect(
      screen.queryByRole("button", { name: /discard unsaved changes to/i }),
    ).toBeNull();
  });

  // Task 41 R3-5: an answered history step of the list is newer than the
  // landed write it reverts; the discard no longer claims it as saved.
  it("does not say a saved change is not undone once its step was undone", async () => {
    const { rows, listContext, remoteWith, client, source } =
      declaredListFixture();
    vi.spyOn(toast, "error").mockImplementation(() => "");
    renderShellWithHero(source, "hero", listContext, client);
    await openSection("Featured");

    updateSectionProps.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    const sentItems = updateSectionProps.mock.calls[0]![0].data.props.items;
    getThemeEditor.mockResolvedValue(remoteWith(sentItems, 2) as never);
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      remoteWith(sentItems, 2) as never,
    );
    act(() => screen.getByRole("button", { name: "Try again" }).click());
    await waitFor(() => expect(saveStatus()).not.toBe("Save failed"));
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    await waitFor(() => expect(undo.disabled).toBe(false));

    // Undone, and answered: the list is back as it was.
    updateSectionProps.mockImplementationOnce(async ({ data }) => ({
      success: true,
      data: {
        draftGeneration: data.expectedDraftGeneration + 1,
        droppedProps: [],
        document: {
          version: 1,
          sections: listContext.templates[0]!.document.sections.map(
            (section) =>
              section.id === data.sectionId
                ? { ...section, props: { ...section.props, ...data.props } }
                : section,
          ),
        },
      },
    }));
    fireEvent.click(undo);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(saveStatus()).toMatch(/^(Unpublished|Published)$/),
    );
    // The panel shows the list as the undo left it (its answer is the
    // accepted copy; `InspectorHistoryAnswered`), so the Add below is made
    // on that one.
    const rowTitles = () =>
      (screen.queryAllByRole("textbox") as HTMLInputElement[])
        .map((input) => input.value)
        .filter((value) => value !== "Welcome");
    await waitFor(() =>
      expect(rowTitles(), "the accepted, undone list").toEqual(["A", "B"]),
    );
    expect(updateSectionProps).toHaveBeenCalledTimes(2);

    await conflictOnAdd(client, remoteWith(rows("C", "A", "B"), 7), 2);
    const text = await discardItems();
    expect(text).not.toMatch(/A saved change is not undone/);
  });

  it("does not say a saved change is not undone when nothing of the list was saved", async () => {
    const { rows, listContext, remoteWith, client, source } =
      declaredListFixture();
    vi.spyOn(toast, "error").mockImplementation(() => "");
    renderShellWithHero(source, "hero", listContext, client);
    await openSection("Featured");
    await conflictOnAdd(client, remoteWith(rows("C", "A", "B"), 7), 0);
    const text = await discardItems();
    expect(text).not.toMatch(/A saved change is not undone/);
  });

  describe("the Content panel after the Undo of a list change is answered", () => {
    /** Answers a write, as the server does, with the document it now holds. */
    const answerWithDocument =
      (listContext: StorefrontThemeEditorDTO) =>
      async ({
        data,
      }: {
        data: {
          sectionId: string;
          props: Record<string, unknown>;
          expectedDraftGeneration: number;
        };
      }) => ({
        success: true,
        data: {
          draftGeneration: data.expectedDraftGeneration + 1,
          droppedProps: [],
          document: {
            version: 1,
            sections: listContext.templates[0]!.document.sections.map(
              (section) =>
                section.id === data.sectionId
                  ? { ...section, props: { ...section.props, ...data.props } }
                  : section,
            ),
          },
        },
      });
    const rowTitles = () =>
      (screen.queryAllByRole("textbox") as HTMLInputElement[])
        .map((input) => input.value)
        .filter((value) => !/heading/i.test(value) && value !== "Welcome");

    /**
     * An Add entry, answered and saved, then Undo pressed. The Undo's own
     * write is held until `answerUndo()`, so the author can act meanwhile.
     */
    async function addThenUndo() {
      const { listContext, client, source } = declaredListFixture();
      vi.spyOn(toast, "error").mockImplementation(() => "");
      renderShellWithHero(source, "hero", listContext, client);
      await openSection("Featured");
      const answer = answerWithDocument(listContext);

      updateSectionProps.mockImplementationOnce(answer as never);
      fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
      await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(saveStatus()).toMatch(/^(Unpublished|Published)$/),
      );
      expect(rowTitles(), "the added row").toEqual(["A", "B", ""]);
      const undo = screen.getByRole("button", {
        name: "Undo",
      }) as HTMLButtonElement;
      await waitFor(() => expect(undo.disabled).toBe(false));

      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      updateSectionProps.mockImplementationOnce((async (call: never) => {
        await released;
        return answer(call);
      }) as never);
      fireEvent.click(undo);
      await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
      expect(
        (
          updateSectionProps.mock.calls[1]![0].data.props.items as {
            title: string;
          }[]
        ).map((row) => row.title),
        "the undo writes the list back",
      ).toEqual(["A", "B"]);
      return {
        answerUndo: async () => {
          await act(async () => {
            release();
            await released;
          });
          await flushFrames();
        },
      };
    }

    it("shows the list as the undo left it", async () => {
      const { answerUndo } = await addThenUndo();
      await answerUndo();
      await waitFor(() =>
        expect(saveStatus()).toMatch(/^(Unpublished|Published)$/),
      );
      await waitFor(() =>
        expect(rowTitles(), "the undone row is gone").toEqual(["A", "B"]),
      );
      expect(removeButtons()).toHaveLength(2);
    });

    it("keeps another field's unsaved draft of the same section as it is", async () => {
      const { answerUndo } = await addThenUndo();
      const debounce = holdContentDebounce();
      try {
        // Typed while the Undo is out: held, not sent, when it is answered.
        const heading = screen.getByDisplayValue("Welcome");
        act(() => heading.focus());
        fireEvent.input(heading, { target: { value: "Typed heading" } });
        act(() => heading.blur());
        await flushFrames();
        expect(updateSectionProps, "the draft is not sent").toHaveBeenCalledTimes(
          2,
        );
        await answerUndo();
        await waitFor(() =>
          expect(rowTitles(), "the undone row is gone").toEqual(["A", "B"]),
        );
        expect(screen.getByDisplayValue("Typed heading")).toBeTruthy();
        expect(screen.queryByDisplayValue("Welcome")).toBeNull();
      } finally {
        debounce.restore();
      }
    });

    it("does not overwrite the author's own unanswered edit of that list", async () => {
      const { answerUndo } = await addThenUndo();
      const debounce = holdContentDebounce();
      try {
        fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
        await flushFrames();
        expect(removeButtons(), "the author's own Add").toHaveLength(4);
        await answerUndo();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await flushFrames();
        expect(removeButtons(), "the author's list is kept").toHaveLength(4);
      } finally {
        debounce.restore();
      }
    });

    describe("and of a text field", () => {
      /**
       * The heading typed, answered and saved, then Undo pressed. The
       * document context never moves here (nothing refetches it), as when a
       * refetch returns the copy the editor already held. The Undo's own
       * write is held until `answerUndo()`.
       */
      async function typeThenUndo() {
        const { listContext, client, source } = declaredListFixture();
        vi.spyOn(toast, "error").mockImplementation(() => "");
        renderShellWithHero(source, "hero", listContext, client);
        await openSection("Featured");
        const answer = answerWithDocument(listContext);

        updateSectionProps.mockImplementationOnce(answer as never);
        const heading = screen.getByDisplayValue("Welcome");
        act(() => heading.focus());
        fireEvent.input(heading, { target: { value: "X" } });
        act(() => heading.blur());
        await waitFor(() =>
          expect(updateSectionProps).toHaveBeenCalledTimes(1),
        );
        expect(updateSectionProps.mock.calls[0]![0].data.props.heading).toBe(
          "X",
        );
        await waitFor(() =>
          expect(saveStatus()).toMatch(/^(Unpublished|Published)$/),
        );
        expect(screen.getByDisplayValue("X")).toBeTruthy();
        const undo = screen.getByRole("button", {
          name: "Undo",
        }) as HTMLButtonElement;
        await waitFor(() => expect(undo.disabled).toBe(false));

        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        updateSectionProps.mockImplementationOnce((async (call: never) => {
          await released;
          return answer(call);
        }) as never);
        fireEvent.click(undo);
        await waitFor(() =>
          expect(updateSectionProps).toHaveBeenCalledTimes(2),
        );
        expect(
          updateSectionProps.mock.calls[1]![0].data.props.heading,
          "the undo writes the heading back",
        ).toBe("Welcome");
        return {
          answerUndo: async () => {
            await act(async () => {
              release();
              await released;
            });
            await flushFrames();
          },
        };
      }

      it("shows the text as the undo left it", async () => {
        const { answerUndo } = await typeThenUndo();
        await answerUndo();
        await waitFor(() =>
          expect(saveStatus()).toMatch(/^(Unpublished|Published)$/),
        );
        await waitFor(() =>
          expect(
            screen.queryByDisplayValue("Welcome"),
            "the original heading",
          ).toBeTruthy(),
        );
        expect(screen.queryByDisplayValue("X")).toBeNull();
      });

      it("keeps another field's unsaved draft of the same section as it is", async () => {
        const { answerUndo } = await typeThenUndo();
        const debounce = holdContentDebounce();
        try {
          // A row title typed while the Undo is out: held, not sent.
          const row = screen.getByDisplayValue("A");
          act(() => row.focus());
          fireEvent.input(row, { target: { value: "A typed" } });
          act(() => row.blur());
          await flushFrames();
          expect(
            updateSectionProps,
            "the draft is not sent",
          ).toHaveBeenCalledTimes(2);
          await answerUndo();
          await waitFor(() =>
            expect(
              screen.queryByDisplayValue("Welcome"),
              "the original heading",
            ).toBeTruthy(),
          );
          expect(screen.getByDisplayValue("A typed")).toBeTruthy();
          expect(rowTitles()).toEqual(["A typed", "B"]);
        } finally {
          debounce.restore();
        }
      });

      it("does not overwrite the author's own unanswered input to that text", async () => {
        const { answerUndo } = await typeThenUndo();
        const debounce = holdContentDebounce();
        try {
          const heading = screen.getByDisplayValue("X");
          act(() => heading.focus());
          fireEvent.input(heading, { target: { value: "Y" } });
          act(() => heading.blur());
          await flushFrames();
          expect(
            updateSectionProps,
            "the input is not sent",
          ).toHaveBeenCalledTimes(2);
          await answerUndo();
          await new Promise((resolve) => setTimeout(resolve, 50));
          await flushFrames();
          expect(
            screen.getByDisplayValue("Y"),
            "the author's text is kept",
          ).toBeTruthy();
          expect(screen.queryByDisplayValue("Welcome")).toBeNull();
        } finally {
          debounce.restore();
        }
      });

      it("leaves the text the author is in as it is, and shows the undo's once they leave it", async () => {
        const { answerUndo } = await typeThenUndo();
        // In the heading, nothing typed: no unanswered input of theirs.
        const heading = screen.getByDisplayValue("X") as HTMLInputElement;
        act(() => heading.focus());
        await answerUndo();
        await waitFor(() =>
          expect(saveStatus()).toMatch(/^(Unpublished|Published)$/),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        await flushFrames();
        expect(heading.isConnected, "the input is not remounted").toBe(true);
        expect(document.activeElement, "it keeps its focus").toBe(heading);
        expect(heading.value, "its text is not replaced").toBe("X");

        act(() => heading.blur());
        await waitFor(() =>
          expect(
            screen.queryByDisplayValue("Welcome"),
            "the undo's text, once the author left the input",
          ).toBeTruthy(),
        );
        expect(screen.queryByDisplayValue("X")).toBeNull();
        expect(
          updateSectionProps,
          "nothing is written for it",
        ).toHaveBeenCalledTimes(2);
      });
    });
  });
});

/**
 * The one part of the round trip that moves what the author is looking at.
 *
 * `preview-reveal-request.test.ts` states when a report may reveal; this is the
 * wiring. It needs a viewport height, which is why it is here and not with the
 * rest of the rules.
 */
describe("bringing the canvas to a selection", () => {
  it("moves for the answer it asked for, and not for a stale one", async () => {
    vi.stubGlobal("ResizeObserver", ReportingResizeObserver);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderShell();

    fromPreview({
      type: "morph:storefront-preview-structure",
      routePath: "/",
      nodes: [heroNode],
    });
    const row = await screen.findByText("h1");
    posted.length = 0;
    act(() => {
      row.closest("button")?.click();
      row.closest("button")?.click();
    });

    const revision = messagesOfType(
      "morph:storefront-preview-set-selection-mode",
    ).at(-1)!.selectionRevision as number;
    expect(revision).toBeGreaterThan(1);

    // Every nullable field is present as an explicit `null`: the protocol reads
    // an omitted key as the wrong shape, not as an absent value.
    const answer = (selectionRevision: number) => ({
      type: "morph:storefront-preview-select-section",
      sectionId: "hero",
      componentType: "hero",
      kind: "heading",
      nodeId: "hero:node:heading",
      sourceFilePath: null,
      sourceLocation: null,
      elementKey: "heading",
      fieldKey: null,
      field: null,
      fieldPath: null,
      descendantFields: [],
      tagName: "h1",
      role: null,
      inputType: null,
      styleRevision: 0,
      className: "text-xl",
      isSection: false,
      inspectorOverride: null,
      computedStyle: null,
      parentComputedStyle: null,
      sectionComputedStyle: null,
      selectionRevision,
      documentRect: { top: 2_000, height: 100 },
    });

    const resting = canvasY();
    expect(resting).not.toBeNull();

    fromPreview(answer(revision - 1), { preserveSelectionRevision: true });
    await flushFrames();
    const afterStale = canvasY();

    fromPreview(answer(revision));
    await flushFrames();

    // Checked before the assertions that depend on it: a message the transport
    // rejects would leave the canvas still, and both would then hold for the
    // wrong reason.
    expect(warn).not.toHaveBeenCalled();
    expect(afterStale).toBe(resting);
    expect(canvasY()).not.toBe(resting);
  });
});

/**
 * A style patch the source cannot answer — the call site, not the transformer.
 *
 * `theme-ast-transformer.test.ts` pins which reason each function returns. What
 * it cannot see is whether the shell says anything about it, and that is where
 * the gap was: this path answered `dynamic-classname` and `parse-error` and
 * returned on everything else, so `not-found` produced no feedback at all. The
 * control moved, the file did not change, and nothing said why — while
 * `swapSiblingMorphNodes` and `removeJsxElement` each answer their whole reason
 * union, which is what makes this a gap rather than a design.
 *
 * All three reasons are pinned rather than only the repaired one, which buys a
 * narrower thing than it looks like: it catches a regression in any of the
 * three — someone rewriting this block and dropping the `parse-error` toast
 * would go red — and it does **not** catch a fourth reason added to
 * `PatchClassNameResult`, because a new member would be answered by none of
 * these cases and still return silently. Closing that needs the type tightened
 * so the missing case fails the build, which is a change to the result type
 * rather than to this file. Said here so the gap is recorded instead of
 * implied away by the coverage.
 */
describe("a text promotion's source baseline", () => {
  const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
  const source =
    'export function Hero() { return <h1 data-morph-node="heading">Welcome</h1>; }';

  beforeEach(() => {
    useThemeWorkspaceStore.setState({ workspaces: {} });
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
    promoteText.mockReset();
  });

  it("advances the same selection after its own acknowledged promotion", async () => {
    promoteText.mockResolvedValue({
      success: true,
      data: {
        sourceGeneration: 2,
        draftGeneration: 2,
        file: {
          path: "src/components/Hero.tsx",
          content: source,
          version: 2,
          updatedAt: "2026-10-12T00:00:00.000Z",
        },
        document: {
          version: 1,
          sections: [
            { id: "hero", type: "hero", props: { heading: "Welcome" } },
          ],
        },
      },
    });
    renderShellWithHero(source);
    await selectHeading();
    fireEvent.click(
      screen.getByRole("button", { name: "Promote the selected text" }),
    );
    await waitFor(() => expect(promoteText).toHaveBeenCalledTimes(1));
    expect(promoteText.mock.calls[0][0].data.expectedSourceGeneration).toBe(1);
    await waitFor(() =>
      expect(
        useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
      ).toBe(2),
    );
    // Same selected target, without a new tree/canvas selection. Ask to
    // promote again so the shell's real callback reads its advanced baseline;
    // this harness does not simulate HMR replacing the rendered element.
    promoteText.mockResolvedValue({
      success: false,
      message: "Already a field",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Promote the selected text" }),
    );
    await waitFor(() => expect(promoteText).toHaveBeenCalledTimes(2));
    expect(promoteText.mock.calls[1][0].data.expectedSourceGeneration).toBe(2);
  });

  it("does not replace a selected promotion baseline with an external Code generation", async () => {
    promoteText.mockResolvedValue({
      success: false,
      error: "SELECTION_SOURCE_CONFLICT",
      message:
        "The source code has changed. Select the field again. Your changes are kept.",
    });
    renderShellWithHero(source);
    await selectHeading();
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Promote the selected text" }),
    );
    await waitFor(() => expect(promoteText).toHaveBeenCalledTimes(1));
    expect(promoteText.mock.calls[0][0].data.expectedSourceGeneration).toBe(1);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });
});

describe("a style patch the source cannot answer", () => {
  const STATIC_SOURCE =
    'export function Hero() { return <section data-morph-node="section" className="p-4">x</section>; }';

  /**
   * The workspace store outranks the query, and it is not reset between tests.
   *
   * `handleUpdateThemeFileStyle` reads the source it patches as
   * `workspaceFileSnapshot[filePath]?.localContent ?? themeFiles.find(...)`,
   * so a source seeded only into the query is the *fallback*. A patch that
   * succeeds writes through `updateWorkspaceLocal`, which means the test before
   * this one leaves its patched content behind for the next one to read. That
   * is not hypothetical: without this, the `parse-error` case below patched a
   * file it should not have been able to read at all and failed with
   * "Failed to save source file ...: File has an unresolved conflict" — a real
   * failure, reported from a path the fixture never set up.
   *
   * Cleared rather than seeded so the fixture stays the query data alone: it
   * also drops the conflict the leaked write recorded, which is the other half
   * of the same state.
   */
  beforeEach(() => {
    useThemeWorkspaceStore.setState({ workspaces: {} });
  });

  it("says so when the target matches no element", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "");
    stylePatchTarget.elementName = "99:1";
    renderShellWithHero(STATIC_SOURCE);

    applyStylePatch();

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        `Element "99:1" no longer maps to a unique source node in ${stylePatchTarget.filePath}. Refresh the preview or edit in Code mode.`,
      ),
    );
  });

  it("says so when the className is a dynamic expression", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "");
    stylePatchTarget.elementName = "section";
    // `cn` with a *literal* first argument is not dynamic — it is the editable
    // case, which `readEditableCnClassName` patches in place and which
    // `theme-ast-cn-patch.test.ts` exists to cover. Writing
    // `cn("p-4", extra)` here reaches `editable: true` and never this branch;
    // the variable first is what the transformer's own `dynamic-classname` case
    // uses, and what makes the expression unanalysable.
    renderShellWithHero(
      'export function Hero({ base }) { return <section data-morph-node="section" className={cn(base, "text-6xl")}>x</section>; }',
    );

    applyStylePatch();

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        'Element "section" has a dynamic className expression (e.g. cn(...)). Edit in Code mode to preserve component logic.',
      ),
    );
  });

  it("says so when the source does not parse", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    stylePatchTarget.elementName = "section";
    renderShellWithHero(
      'export function Hero() { return <section className="p-4"',
    );

    applyStylePatch();

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        `Cannot modify styles: syntax error in ${stylePatchTarget.filePath}. Fix TSX in Code mode.`,
      ),
    );
  });
});
