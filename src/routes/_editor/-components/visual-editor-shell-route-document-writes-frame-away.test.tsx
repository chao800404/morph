// Part of the visual-editor-shell-route-document-writes tests; the fixture, mocks
// and hooks are in visual-editor-shell-route-document-writes.harness.tsx (imported first).
import {
  PREVIEW_ORIGIN,
  FRAME,
  ROUTE_PATH,
  SLOT,
  ROUTE_DOC_ID,
  posted,
  updateSectionProps,
  getThemeEditor,
  startPreviewServer,
  server,
  conflictAnswer,
  holdNextWrite,
  settleMicrotasks,
  host,
  frameUp,
  fromPreview,
  flushFrames,
  headingReport,
  secondRowReport,
  firstRowReport,
  countReport,
  openOn,
  select,
  type,
  pause,
  sent,
  saveStatus,
  waitForPresentationReady,
  expectAdopted,
  cardFields,
  typeInCard,
  holdDebounce,
  releaseDebounce,
  outsideWriteRead,
  storedHeading,
  rowsOf,
  routeRequests,
  pressTryAgain,
} from "./visual-editor-shell-route-document-writes.harness";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { answerLatestRouteRequest, disablePresentationAcks, LIVE_FRAME_CAPABILITIES, reloadFrameDocument, sendFrameReady } from "@/lib/test-utils/preview-frame-handshake";
import { PREVIEW_OTHER_PAGE_PAUSED_MESSAGE } from "./visual-editor-shell";

/**
 * Leaving a field commits what is in it. While the frame shows another page
 * the commit is held (Option A): the draft is kept and nothing is written.
 * The commit is remembered, bound to the very field edits that were left and
 * to the document they were typed for. The next valid acknowledgement after
 * the frame is back sends it once, through the same checks a blur runs, with
 * no second blur. Anything else stays unsent: input that was never left, a
 * field typed into again, a sibling field never left, a document changed
 * elsewhere, a source that changed, an acknowledgement of an old round, the
 * editor on another document. A refused or failed send keeps the draft, and
 * leaving the field again still works.
 */
describe("a draft the author left while the frame was elsewhere", () => {
  const ELSEWHERE = "/unfollowed/elsewhere";
  const moveFrameElsewhere = async (epoch: number) => {
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ELSEWHERE,
      frameNavigationEpoch: epoch,
    });
    await flushFrames();
  };
  const leaveField = async (index = 0) => {
    await act(async () => {
      fireEvent.focus(cardFields()[index]!);
      fireEvent.blur(cardFields()[index]!);
    });
    await pause();
  };
  /**
   * Value 2 is typed while the first write is out, the frame leaves, and
   * the page takes up the document this editor created while it is away.
   * With `leave`, the author then leaves the field: held, nothing written.
   */
  async function draftWhileElsewhere(
    leave: boolean,
    report: Record<string, unknown> = headingReport,
  ) {
    await openOn(report);
    await waitForPresentationReady();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeInCard(0, "Value 2");
    await moveFrameElsewhere(1);
    await act(async () => {
      first.release();
      await settleMicrotasks();
    });
    await releaseDebounce();
    await expectAdopted();
    await flushFrames();
    if (leave) await leaveField();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
    expect(cardFields()[0]!.value).toBe("Value 2");
    expect(
      screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE).length,
    ).toBeGreaterThan(0);
  }
  /**
   * The frame is back on the page and its presentation is acknowledged;
   * unless `sends`, nothing is written, so the page settles ready.
   */
  async function frameReturns(sends = false) {
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ROUTE_PATH,
      frameNavigationEpoch: 2,
    });
    await flushFrames();
    if (sends) {
      await waitFor(() => expect(sent()).toHaveLength(2));
      return;
    }
    await waitForPresentationReady();
    await pause();
  }
  const latestSlotToken = () =>
    posted
      .filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.sectionId === SLOT &&
          message.presentationToken,
      )
      .at(-1)?.presentationToken as { operationId: string } | undefined;
  const savedOnce = (heading: string) => {
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading },
    });
  };

  it("is saved once by the acknowledgement after the return, with no second blur; a repeated acknowledgement writes nothing more", async () => {
    await draftWhileElsewhere(true);
    await frameReturns(true);
    savedOnce("Value 2");
    await waitFor(() => expect(storedHeading()).toBe("Value 2"));

    const token = latestSlotToken();
    expect(token).toBeTruthy();
    await fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: token!.operationId,
      token,
      status: "applied",
    });
    await flushFrames();
    await pause();
    expect(sent()).toHaveLength(2);
  });

  describe("across the one refresh of a frame that cannot acknowledge", () => {
    /**
     * The frame's page reloads onto a bridge older than the acknowledgement
     * (its ready names none, and no instance); the service answers that it
     * now serves one that acknowledges. The editor refreshes the frame once.
     */
    async function oldBridgeThenRefresh(during?: () => void) {
      startPreviewServer.mockReset();
      startPreviewServer.mockResolvedValue({
        success: true,
        message: "Live Preview server ready",
        data: {
          url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
          servingBridge: {
            bridge: {
              buildId: "e".repeat(64),
              capabilities: [...LIVE_FRAME_CAPABILITIES],
            },
            instance: null,
          },
          bridgeCapabilities: [...LIVE_FRAME_CAPABILITIES],
        },
      });
      const before = document.querySelector("iframe");
      act(() => {
        reloadFrameDocument();
      });
      sendFrameReady(FRAME, ["selection-field-section"]);
      await flushFrames();
      during?.();
      await pause();
      expect(sent(), "nothing is written while the old frame is up").toHaveLength(1);
      await waitFor(() =>
        expect(document.querySelector("iframe")).not.toBe(before),
      );
      expect(startPreviewServer).toHaveBeenCalledTimes(1);
    }
    /** The refreshed frame comes up on the editor's page and acknowledges. */
    async function refreshedFrameAcknowledges(sends: boolean) {
      await frameUp();
      if (sends) {
        await waitFor(() => expect(sent()).toHaveLength(2));
      } else {
        await waitForPresentationReady();
      }
      await pause();
    }

    it("a field left before it is kept, not sent while the old frame is up, and saved once by the new frame's acknowledgement, on its original basis", async () => {
      await draftWhileElsewhere(true);
      await oldBridgeThenRefresh();
      await refreshedFrameAcknowledges(true);
      savedOnce("Value 2");
      expect(startPreviewServer).toHaveBeenCalledTimes(1);
    });

    it("input during it ends that commit: nothing is sent after the new frame acknowledges, and the draft is kept", async () => {
      await draftWhileElsewhere(true);
      await oldBridgeThenRefresh(() => typeInCard(0, "Value 3"));
      await refreshedFrameAcknowledges(false);
      expect(sent()).toHaveLength(1);
      expect(storedHeading()).toBe("Value 1");
      expect(cardFields()[0]!.value).toBe("Value 3");
    });

    it("input never left stays a draft: nothing is sent after the new frame acknowledges", async () => {
      await draftWhileElsewhere(false);
      await oldBridgeThenRefresh();
      await refreshedFrameAcknowledges(false);
      expect(sent()).toHaveLength(1);
      expect(storedHeading()).toBe("Value 1");
      expect(cardFields()[0]!.value).toBe("Value 2");
    });

    it("a write with no answer before it is not sent again by the refresh or the new frame's acknowledgement; Try again reads it back first and resends it once at the generation it was sent at", async () => {
      await openOn(headingReport);
      await waitForPresentationReady();
      const first = holdNextWrite();
      await type("Default heading", "Value 1");
      await waitFor(() => expect(sent()).toHaveLength(1));
      await act(async () => {
        first.lose();
        await settleMicrotasks();
      });
      await pause();
      const unconfirmed = () =>
        document
          .querySelector("[data-editor-unconfirmed-saves]")
          ?.getAttribute("data-editor-unconfirmed-saves");
      expect(saveStatus()).toBe("Save failed");
      expect(unconfirmed()).toBe("1");

      await oldBridgeThenRefresh();
      await refreshedFrameAcknowledges(false);
      // Still the one request, still unconfirmed: neither the refresh nor
      // the new frame's acknowledgement sent it again.
      expect(sent()).toHaveLength(1);
      expect(saveStatus()).toBe("Save failed");
      expect(unconfirmed()).toBe("1");

      // Not landed: the created document is still at the generation it was
      // sent at (as in G2c), so the read-back decides by generation.
      expect(server.route).toEqual({ generation: 1, props: null });
      server.route = { generation: 1, props: {} };
      const readsBefore = getThemeEditor.mock.calls.length;
      pressTryAgain();
      await waitFor(() =>
        expect(getThemeEditor.mock.calls.length).toBeGreaterThan(readsBefore),
      );
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: sent()[0]!.expectedDraftGeneration,
        props: { heading: "Value 1" },
      });
      // Read back before it was sent again.
      const readOrder = getThemeEditor.mock.invocationCallOrder[readsBefore]!;
      const resendOrder = updateSectionProps.mock.invocationCallOrder[1]!;
      expect(readOrder).toBeLessThan(resendOrder);
      expect(storedHeading()).toBe("Value 1");
    });
  });

  it("input that was never left is not sent on the return; leaving it then saves it", async () => {
    await draftWhileElsewhere(false);
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(cardFields()[0]!.value).toBe("Value 2");

    await leaveField();
    await waitFor(() => expect(sent()).toHaveLength(2));
    savedOnce("Value 2");
  });

  it("the field typed into again after it was left is not sent on the return", async () => {
    await draftWhileElsewhere(true);
    typeInCard(0, "Value 3");
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
    expect(cardFields()[0]!.value).toBe("Value 3");

    await leaveField();
    await waitFor(() => expect(sent()).toHaveLength(2));
    savedOnce("Value 3");
  });

  it("a document changed elsewhere while away is not written over", async () => {
    await draftWhileElsewhere(true);
    await outsideWriteRead((route) => {
      route.props = { ...(route.props ?? {}), heading: "Theirs" };
      route.generation += 1;
    });
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Theirs");
    expect(cardFields()[0]!.value).toBe("Value 2");
  });

  it("a source that changed since the input is not written", async () => {
    await draftWhileElsewhere(true);
    act(() => {
      useThemeWorkspaceStore.getState().setBaseSourceGeneration(2, {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      });
    });
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
    expect(cardFields()[0]!.value).toBe("Value 2");
  });

  it("an acknowledgement from an earlier ready round sends nothing", async () => {
    await draftWhileElsewhere(true);
    const before = latestSlotToken();
    expect(before).toBeTruthy();
    disablePresentationAcks();
    reloadFrameDocument();
    await fromPreview({
      type: "morph:storefront-preview-ready",
      capabilities: [...LIVE_FRAME_CAPABILITIES],
    });
    await flushFrames();
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ROUTE_PATH,
      frameNavigationEpoch: 0,
    });
    await flushFrames();
    await fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: before!.operationId,
      token: before,
      status: "applied",
    });
    await flushFrames();
    await pause();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
    expect(cardFields()[0]!.value).toBe("Value 2");
  });

  it("the editor on another document drops the commit; back on the page, the return sends nothing", async () => {
    await draftWhileElsewhere(true);
    act(() => host.go?.({ routePath: "/", templateId: undefined }));
    await flushFrames();
    await pause();
    act(() => host.go?.({ routePath: ROUTE_PATH, templateId: ROUTE_DOC_ID }));
    await flushFrames();
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
  });

  it("a continued write that gets no answer is not sent again by a later acknowledgement", async () => {
    await draftWhileElsewhere(true);
    const lost = holdNextWrite();
    await frameReturns(true);
    await act(async () => {
      lost.lose();
      await settleMicrotasks();
    });
    await pause();
    const token = latestSlotToken();
    await fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: token!.operationId,
      token,
      status: "applied",
    });
    await flushFrames();
    await pause();
    expect(sent()).toHaveLength(2);
    expect(cardFields()[0]!.value).toBe("Value 2");
  });

  // The blur commits the section's draft as it is then: a sibling typed
  // before the blur goes with it; input after the blur does not.
  const typeWithoutLeaving = (index: number, value: string) => {
    const field = cardFields()[index];
    if (!field) throw new Error(`typeWithoutLeaving: no card field ${index}`);
    fireEvent.input(field, { target: { value } });
  };
  /** What the author is shown about the held draft. */
  const heldState = () => ({
    status: saveStatus(),
    errors: vi.mocked(toast.error).mock.calls.map((call) => String(call[0])),
    loadLatest: screen.queryAllByRole("button", {
      name: "Load latest, keep mine",
    }).length,
    tryAgain: screen.queryAllByRole("button", { name: "Try again" }).length,
  });
  /**
   * Row b's title is typed, not left, while the first write is out; row a
   * is then selected, so its title is read from the source too. The frame
   * leaves and the page takes up its document while away; with `before`,
   * row a's title is typed into there, not left. The author then leaves
   * row b's title.
   */
  async function rowDraftWhileElsewhere(before?: string) {
    await openOn(secondRowReport);
    await waitForPresentationReady();
    const first = holdNextWrite();
    await type("Two", "Two v1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeWithoutLeaving(1, "Two v2");
    await select(firstRowReport);
    await moveFrameElsewhere(1);
    await act(async () => {
      first.release();
      await settleMicrotasks();
    });
    await releaseDebounce();
    await expectAdopted();
    await flushFrames();
    if (before !== undefined) typeWithoutLeaving(0, before);
    await leaveField(1);
    expect(sent()).toHaveLength(1);
  }

  it("a sibling typed before the blur, never left itself, is saved with it by the return", async () => {
    await rowDraftWhileElsewhere("One typed");
    await frameReturns(true);
    await pause();
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
    });
    expect(rowsOf(sent()[1]!).map(([, title]) => title)).toEqual([
      "One typed",
      "Two v2",
    ]);
  });

  it("a sibling typed after the blur is not sent on the return; the whole draft is kept and the next blur sends it", async () => {
    await rowDraftWhileElsewhere();
    typeWithoutLeaving(0, "One typed");
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(cardFields().map((field) => field.value)).toEqual([
      "One typed",
      "Two v2",
    ]);

    await leaveField(0);
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
    });
    expect(rowsOf(sent()[1]!).map(([, title]) => title)).toEqual([
      "One typed",
      "Two v2",
    ]);
  });

  // Only the return's own source check stops this one before the write
  // path: without it the write path refuses later, as a failed save.
  it("source changed: the return refuses before any write; the draft is kept and Try again is left", async () => {
    await draftWhileElsewhere(true);
    act(() => {
      useThemeWorkspaceStore.getState().setBaseSourceGeneration(2, {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      });
    });
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(cardFields()[0]!.value).toBe("Value 2");
    expect(heldState()).toEqual({
      status: "Unsaved",
      errors: [],
      loadLatest: 0,
      tryAgain: 1,
    });
  });

  // Only the return's own check of the document's range stops this one
  // before the write path: without it the write path refuses later, as a
  // conflict.
  it("document changed elsewhere (basis): the return refuses before any write; the draft is kept and Try again is left", async () => {
    await draftWhileElsewhere(true);
    await outsideWriteRead((route) => {
      route.props = { ...(route.props ?? {}), heading: "Theirs" };
      route.generation += 1;
    });
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Theirs");
    expect(cardFields()[0]!.value).toBe("Value 2");
    expect(heldState()).toEqual({
      status: "Unsaved",
      errors: [],
      loadLatest: 0,
      tryAgain: 1,
    });
  });

  it("conflict: the return sends nothing; the draft is kept and the conflict's Load latest, keep mine is left", async () => {
    await openOn(headingReport);
    await waitForPresentationReady();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeInCard(0, "Value 2");
    await moveFrameElsewhere(1);
    await act(async () => {
      first.release(conflictAnswer());
      await settleMicrotasks();
    });
    await releaseDebounce();
    await flushFrames();
    await leaveField();
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(cardFields()[0]!.value).toBe("Value 2");
    expect(heldState()).toMatchObject({ status: "Out of date", loadLatest: 1 });
  });

  // The write path refuses this one by itself too (an earlier unanswered
  // save holds every later one), so it pins the outcome, not which check.
  it("unconfirmed: an earlier write with no answer holds the return; nothing is sent, the draft is kept and Try again is left", async () => {
    await openOn(headingReport);
    await waitForPresentationReady();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeInCard(0, "Value 2");
    await moveFrameElsewhere(1);
    await act(async () => {
      first.lose();
      await settleMicrotasks();
    });
    await releaseDebounce();
    await flushFrames();
    await leaveField();
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(cardFields()[0]!.value).toBe("Value 2");
    expect(heldState()).toMatchObject({ status: "Save failed", tryAgain: 1 });
  });

  it("the editor on another document and back: the return sends nothing, and leaving the field then saves the kept draft once", async () => {
    await draftWhileElsewhere(true);
    act(() => host.go?.({ routePath: "/", templateId: undefined }));
    await flushFrames();
    await pause();
    act(() => host.go?.({ routePath: ROUTE_PATH, templateId: ROUTE_DOC_ID }));
    await flushFrames();
    await frameReturns();
    expect(sent()).toHaveLength(1);
    expect(heldState()).toMatchObject({ status: "Unsaved", tryAgain: 1 });

    await leaveField();
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    savedOnce("Value 2");
  });

  /**
   * The frame withdraws every acknowledgement it gave, as the bridge does
   * when it cannot tell which page it arrived at: the page left loses its
   * acknowledgement too. Recovery is the return and a new acknowledgement.
   */
  const withdrawEveryAck = async () => {
    const tokens = posted
      .filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.presentationToken,
      )
      .map(
        (message) => message.presentationToken as { operationId: string },
      );
    for (const token of tokens) {
      await fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "not-applied",
        reason: "superseded",
      });
    }
    await flushFrames();
  };

  it("after the frame withdraws every acknowledgement while away, the left draft is kept and unsent; the return's new acknowledgement saves it once on its original basis", async () => {
    await draftWhileElsewhere(true);
    await withdrawEveryAck();
    await pause();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
    expect(cardFields()[0]!.value).toBe("Value 2");
    expect(
      screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE).length,
    ).toBeGreaterThan(0);

    await frameReturns(true);
    savedOnce("Value 2");
    await pause();
    expect(sent()).toHaveLength(2);
    expect(storedHeading()).toBe("Value 2");
  });

  const pickPage = async (routePath: string) => {
    act(() => {
      screen.getByTitle(`Preview ${routePath}`).click();
    });
    await flushFrames();
  };
  /** The page switch asks about the kept draft; the author keeps it and switches. */
  const switchKeepingDraft = async () => {
    const keep = await screen.findByRole("button", {
      name: "Switch, keep draft unsaved",
    });
    act(() => keep.click());
    await flushFrames();
  };
  /** The frame answers the editor's latest set-route and reports that page. */
  const frameAnswersFrom = async (routePath: string, epoch: number) => {
    act(() => {
      answerLatestRouteRequest(FRAME);
    });
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath,
      frameNavigationEpoch: epoch,
    });
    await flushFrames();
  };

  it("a re-pick while the frame has not answered the earlier pick sends nothing; picking another page and then this one, keeping the draft, brings the frame back with the draft kept and nothing written over", async () => {
    host.guarded = true;
    await draftWhileElsewhere(true);

    // The author picks the page the editor shows: the frame is sent back.
    const before = routeRequests().length;
    await pickPage(ROUTE_PATH);
    expect(routeRequests().slice(before)).toHaveLength(1);
    expect(routeRequests().at(-1)).toMatchObject({
      routePath: ROUTE_PATH,
      navigationIntent: "author",
    });
    // Before answering, the frame moves on by itself; picking the shown page
    // again sends nothing (the known limit).
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/unfollowed/other",
      frameNavigationEpoch: 2,
    });
    await flushFrames();
    await pickPage(ROUTE_PATH);
    expect(routeRequests().slice(before)).toHaveLength(1);
    expect(sent()).toHaveLength(1);

    // The recovery: another page, then this one again.
    await pickPage("/");
    await switchKeepingDraft();
    await waitFor(() => expect(host.search?.routePath ?? "/").toBe("/"));
    expect(routeRequests().at(-1)?.routePath ?? "/").toBe("/");
    await frameAnswersFrom("/", 3);
    await pause();
    expect(sent()).toHaveLength(1);

    await pickPage(ROUTE_PATH);
    await switchKeepingDraft();
    await waitFor(() => expect(host.search?.routePath).toBe(ROUTE_PATH));
    expect(routeRequests().at(-1)?.routePath).toBe(ROUTE_PATH);
    await frameAnswersFrom(ROUTE_PATH, 4);
    await waitForPresentationReady();
    await pause();

    // Back on the page, presented and acknowledged: nothing was written for
    // the kept draft on the way, and the commit made before the switch is
    // over (the editor was on another document).
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
    expect(saveStatus()).toBe("Unsaved");

    // The kept draft is what the canvas shows. (The Inspector field, opened
    // again on the selection, shows the stored value: a display gap that is
    // reported, not pinned here.)
    const canvasHeading = () =>
      (
        posted
          .filter(
            (message) =>
              message.type === "morph:storefront-preview-update-section-props" &&
              message.sectionId === SLOT,
          )
          .at(-1)?.props as Record<string, unknown> | undefined
      )?.heading;
    await select(headingReport);
    expect(canvasHeading()).toBe("Value 2");
    expect(saveStatus()).toBe("Unsaved");

    // Leaving the field again saves the kept draft once, on its basis.
    await leaveField();
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    savedOnce("Value 2");
    expect(storedHeading()).toBe("Value 2");
  });

  /** The card's heading as the canvas was last told it. */
  const canvasHeadingNow = () =>
    (
      posted
        .filter(
          (message) =>
            message.type === "morph:storefront-preview-update-section-props" &&
            message.sectionId === SLOT,
        )
        .at(-1)?.props as Record<string, unknown> | undefined
    )?.heading;
  /**
   * Value 1 is saved and confirmed; Value 2 is left in the field while the
   * frame is elsewhere, and held. The author switches to another page keeping
   * the draft, comes back, and the frame presents the page again. Returns the
   * number of writes sent before the heading is selected again.
   */
  async function backOnThePageWithTheDraft() {
    host.guarded = true;
    await draftWhileElsewhere(true);
    expect(server.route).toMatchObject({
      generation: 2,
      props: { heading: "Value 1" },
    });
    expect(sent()[0]).toMatchObject({ props: { heading: "Value 1" } });

    await pickPage("/");
    await switchKeepingDraft();
    await waitFor(() => expect(host.search?.routePath ?? "/").toBe("/"));
    await frameAnswersFrom("/", 2);
    await pause();
    expect(sent()).toHaveLength(1);

    await pickPage(ROUTE_PATH);
    await switchKeepingDraft();
    await waitFor(() => expect(host.search?.routePath).toBe(ROUTE_PATH));
    await frameAnswersFrom(ROUTE_PATH, 3);
    await waitForPresentationReady();
    await pause();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
    return sent().length;
  }

  it("back on the page and the heading selected again, the Inspector shows the kept draft; leaving the field without typing saves it once, on its original basis", async () => {
    const before = await backOnThePageWithTheDraft();

    await select(headingReport);
    await pause();
    expect(cardFields()[0]!.value).toBe("Value 2");
    expect(canvasHeadingNow()).toBe("Value 2");
    expect(storedHeading()).toBe("Value 1");
    expect(saveStatus()).toBe("Unsaved");
    expect(sent(), "selecting again sends nothing").toHaveLength(before);

    // Into the field and out again, nothing typed.
    await leaveField();
    await waitFor(() => expect(sent()).toHaveLength(before + 1));
    await pause();
    expect(sent()).toHaveLength(before + 1);
    expect(sent().at(-1)).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
  });
});

/**
 * A declared number field with a held draft. The number input stages its
 * typed value on blur and has no commit of its own: the section's blur
 * commits the held draft as it is. Leaving the field again without typing
 * must not re-emit the displayed number (it may be older than the held
 * one): nothing new is written, the notice stays, the draft stays, and the
 * acknowledgement then sends the typed number once on the original basis.
 */
describe("a declared number field's held draft", () => {
  const ELSEWHERE = "/unfollowed/elsewhere";
  const ACK = "morph:storefront-preview-section-presentation-ack";
  const moveFrame = async (routePath: string, epoch: number) => {
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath,
      frameNavigationEpoch: epoch,
    });
    await flushFrames();
  };
  const withdrawEveryAck = async () => {
    const tokens = posted
      .filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.presentationToken,
      )
      .map((message) => message.presentationToken as { operationId: string });
    for (const token of tokens) {
      await fromPreview({
        type: ACK,
        operationId: token.operationId,
        token,
        status: "not-applied",
        reason: "superseded",
      });
    }
    await flushFrames();
  };
  const countInput = () => {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    ).filter((element) => !element.getAttribute("aria-label"));
    expect(inputs).toHaveLength(1);
    return inputs[0]!;
  };
  /** The author clicks into the number and types there, not leaving it. */
  const typeNumber = (value: string) => {
    const input = countInput();
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value } });
  };
  /** The author leaves the number; with no typing first, it is untouched. */
  const leaveNumber = async (focusFirst: boolean) => {
    const input = countInput();
    await act(async () => {
      if (focusFirst) fireEvent.focus(input);
      fireEvent.blur(input);
    });
    await pause();
  };
  const otherPageNotices = () =>
    screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE).length;
  const writes = () =>
    sent().map((write) => ({
      templateId: write.templateId,
      expectedDraftGeneration: write.expectedDraftGeneration,
      expectedSourceGeneration: write.expectedSourceGeneration,
      props: write.props,
    }));

  /**
   * The route's document exists at generation 3 and the frame acknowledged
   * its page, then left; it withdraws every acknowledgement, so a number
   * typed and left now is held, not written.
   */
  async function heldNumberWhileAway() {
    server.route = { generation: 3, props: { count: 3 } };
    await openOn(countReport);
    await waitForPresentationReady();
    expect(host.search?.templateId).toBe(ROUTE_DOC_ID);
    expect(countInput().value).toBe("3");
    await moveFrame(ELSEWHERE, 1);
    await withdrawEveryAck();
    typeNumber("7");
    await leaveNumber(false);
    expect(sent()).toHaveLength(0);
    expect(countInput().value).toBe("7");
    expect(saveStatus()).toBe("Unsaved");
    expect(otherPageNotices()).toBeGreaterThan(0);
  }

  it("an untouched blur while the draft is held writes nothing and keeps the notice and the draft; the acknowledgement then sends the typed number once on the original basis", async () => {
    await heldNumberWhileAway();

    // Back into the field and out again, nothing typed.
    await leaveNumber(true);
    expect(sent()).toHaveLength(0);
    expect(countInput().value).toBe("7");
    expect(saveStatus()).toBe("Unsaved");
    expect(otherPageNotices()).toBeGreaterThan(0);
    expect(server.route).toMatchObject({ generation: 3, props: { count: 3 } });

    // The return's acknowledgement arrives.
    await moveFrame(ROUTE_PATH, 2);
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(writes()).toEqual([
      {
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
        expectedSourceGeneration: 1,
        props: { count: 7 },
      },
    ]);
    expect(typeof sent()[0]!.props.count).toBe("number");
    expect(server.route).toMatchObject({ generation: 4, props: { count: 7 } });
    expect(otherPageNotices()).toBe(0);
  });

  it("reopened, the field shows the held number and an untouched blur sends nothing; the acknowledgement then sends it once", async () => {
    await heldNumberWhileAway();

    await select(headingReport);
    await select(countReport);
    await pause();
    expect(countInput().value).toBe("7");

    await leaveNumber(true);
    expect(sent()).toHaveLength(0);
    expect(countInput().value).toBe("7");
    expect(saveStatus()).toBe("Unsaved");
    expect(server.route).toMatchObject({ generation: 3, props: { count: 3 } });

    await moveFrame(ROUTE_PATH, 2);
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(writes()).toEqual([
      {
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
        expectedSourceGeneration: 1,
        props: { count: 7 },
      },
    ]);
  });
});
