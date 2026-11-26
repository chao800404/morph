// Part of the visual-editor-shell-route-document-writes tests; the fixture, mocks
// and hooks are in visual-editor-shell-route-document-writes.harness.tsx (imported first).
import {
  ROUTE_PATH,
  SLOT,
  ROUTE_DOC_ID,
  posted,
  updateSectionProps,
  server,
  applyWrite,
  holdNextWrite,
  holdReads,
  releaseReads,
  settleMicrotasks,
  host,
  renderEditor,
  fromPreview,
  flushFrames,
  headingReport,
  openOn,
  type,
  pause,
  sent,
  waitForPresentationReady,
  expectAdopted,
  cardFields,
  typeInCard,
  holdDebounce,
  releaseDebounce,
  outsideWriteRead,
  storedHeading,
  type WriteRequest,
} from "./visual-editor-shell-route-document-writes.harness";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { disablePresentationAcks, LIVE_FRAME_CAPABILITIES, reloadFrameDocument } from "@/lib/test-utils/preview-frame-handshake";
import { PREVIEW_OTHER_PAGE_PAUSED_MESSAGE, PREVIEW_PRESENTATION_SYNCING_MESSAGE } from "./visual-editor-shell";

describe("frame self-navigation to an unfollowed route while editing the editor's page", () => {
  it("keeps the Inspector field enabled and saves edits after the frame navigates to an unfollowed route", async () => {
    await openOn(headingReport);
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/unfollowed/elsewhere",
      frameNavigationEpoch: 1,
    });
    await flushFrames();

    await type("Default heading", "After nav");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      props: { heading: "After nav" },
    });
  });

  it("holds an edit typed after unfollowed frame navigation once an in-flight route-document creation adopts the document, then saves it after returning to original route and receiving valid ack", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstHeld = false;
    updateSectionProps.mockImplementationOnce(
      async ({ data }: { data: WriteRequest }) => {
        firstHeld = true;
        await firstGate;
        return applyWrite(data);
      },
    );

    await openOn(headingReport);
    await waitFor(() => {
      expect(
        screen.queryAllByText(/Preview syncing\. Content writes are paused/),
      ).toHaveLength(0);
    });
    disablePresentationAcks();

    await type("Default heading", "First");
    await waitFor(() => expect(firstHeld).toBe(true));

    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/unfollowed/elsewhere",
      frameNavigationEpoch: 1,
    });
    await flushFrames();

    const field = (await screen.findAllByDisplayValue("First"))[0]!;
    await waitFor(() => expect(field.matches(":disabled")).toBe(false));
    fireEvent.input(field, { target: { value: "Second" } });
    const postedBeforeRelease = posted.length;
    releaseFirst();
    await expectAdopted();
    await flushFrames();

    // While the frame remains on /unfollowed/elsewhere, no section props/tokens are posted there.
    expect(
      posted
        .slice(postedBeforeRelease)
        .filter((msg) => msg.type === "morph:storefront-preview-update-section-props"),
    ).toHaveLength(0);

    fireEvent.blur(field);
    await pause();

    expect((field as HTMLInputElement).value).toBe("Second");
    // Option A notice (2026-11-17): paused because the frame is on another
    // page, the notice says the draft is kept and to return to the page.
    expect(
      screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE).length,
    ).toBeGreaterThan(0);
    expect(sent()).toHaveLength(1);
    expect(server.route).toMatchObject({
      generation: 2,
      props: { heading: "First" },
    });

    // Returning to the original route emits a fresh presentation request for the newly adopted document.
    const postedBeforeReturn = posted.length;
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ROUTE_PATH,
      frameNavigationEpoch: 2,
    });
    await flushFrames();

    const postReturnTokens = posted
      .slice(postedBeforeReturn)
      .filter(
        (
          msg,
        ): msg is Record<string, unknown> & {
          presentationToken: Record<string, unknown> & { operationId: string };
        } =>
          msg.type === "morph:storefront-preview-update-section-props" &&
          Boolean(msg.presentationToken),
      )
      .map((msg) => msg.presentationToken);
    expect(postReturnTokens.length).toBeGreaterThan(0);

    const fresh = postReturnTokens[postReturnTokens.length - 1]!;
    await fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: fresh.operationId,
      token: fresh,
      status: "applied",
    });
    await flushFrames();
    await pause();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      expectedDraftGeneration: 2,
      props: { heading: "Second" },
    });
    expect(server.route).toMatchObject({
      generation: 3,
      props: { heading: "Second" },
    });
  });

  it("still blocks writes if the frame booted on an unfollowed route and never presented the editor's page", async () => {
    renderEditor();
    await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    await flushFrames();
    await fromPreview({
      type: "morph:storefront-preview-ready",
      capabilities: [
        "selection-field-section",
        "code-default-selection",
        "section-presentation-ack-v1",
      ],
    });
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/unfollowed/elsewhere",
      frameNavigationEpoch: 0,
    });
    await flushFrames();
    expect(screen.queryByDisplayValue("Default heading")).toBeNull();
    expect(sent()).toHaveLength(0);
  });

  it("controlled race: save lands, ack withheld, frame self-navigates to unfollowed route, continue typing and blur", async () => {
    await openOn(headingReport);

    const originalDispatch = window.dispatchEvent.bind(window);
    let withholdAppliedAck = true;
    const dispatchSpy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation((event: Event) => {
        if (
          withholdAppliedAck &&
          event instanceof MessageEvent &&
          event.data?.type ===
            "morph:storefront-preview-section-presentation-ack" &&
          event.data?.status === "applied"
        ) {
          return true;
        }
        return originalDispatch(event);
      });

    try {
      await type("Default heading", "First");
      await pause();
      expect(sent()).toHaveLength(1);
      expect(server.route).toMatchObject({
        generation: 2,
        props: { heading: "First" },
      });

      await fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/unfollowed/elsewhere",
        frameNavigationEpoch: 1,
      });
      await flushFrames();

      const field = (await screen.findAllByDisplayValue("First"))[0]!;
      expect(field.matches(":disabled")).toBe(false);
      fireEvent.input(field, { target: { value: "Second" } });
      fireEvent.blur(field);
      await pause();

      // Option A notice (2026-11-17): paused because the frame is on
      // another page, the notice says the draft is kept and to return.
      const syncingBanners = screen.queryAllByText(
        PREVIEW_OTHER_PAGE_PAUSED_MESSAGE,
      );
      expect({
        fieldValue: (field as HTMLInputElement).value,
        fieldDisabled: field.matches(":disabled"),
        syncingBannerTexts: syncingBanners.map((el) => el.textContent),
        sentCount: sent().length,
        serverRoute: server.route,
      }).toEqual({
        fieldValue: "Second",
        fieldDisabled: false,
        syncingBannerTexts: expect.arrayContaining([
          PREVIEW_OTHER_PAGE_PAUSED_MESSAGE,
        ]),
        sentCount: 1,
        serverRoute: { generation: 2, props: { heading: "First" } },
      });
    } finally {
      withholdAppliedAck = false;
      dispatchSpy.mockRestore();
    }
  });

  it("controlled race (delayed pre-navigation ack): delivering the withheld ack after returning to original route lets Second save once at expectedDraftGeneration 2", async () => {
    await openOn(headingReport);

    const originalDispatch = window.dispatchEvent.bind(window);
    let withholdAppliedAck = true;
    const heldAckEvents: Event[] = [];
    const dispatchSpy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation((event: Event) => {
        if (
          withholdAppliedAck &&
          event instanceof MessageEvent &&
          event.data?.type ===
            "morph:storefront-preview-section-presentation-ack" &&
          event.data?.status === "applied"
        ) {
          heldAckEvents.push(event);
          return true;
        }
        return originalDispatch(event);
      });

    try {
      await type("Default heading", "First");
      await pause();
      expect(sent()).toHaveLength(1);
      expect(server.route).toMatchObject({
        generation: 2,
        props: { heading: "First" },
      });

      // Frame self-navigates to an unfollowed route before ack arrives.
      await fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/unfollowed/elsewhere",
        frameNavigationEpoch: 1,
      });
      await flushFrames();

      const field = (await screen.findAllByDisplayValue("First"))[0]!;
      fireEvent.input(field, { target: { value: "Second" } });
      fireEvent.blur(field);
      await pause();

      expect(sent()).toHaveLength(1);
      expect(server.route).toMatchObject({
        generation: 2,
        props: { heading: "First" },
      });

      // Frame returns to the original route and the withheld valid ack is delivered.
      withholdAppliedAck = false;
      await fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: ROUTE_PATH,
        frameNavigationEpoch: 2,
      });
      act(() => {
        for (const event of heldAckEvents.splice(0)) {
          originalDispatch(event);
        }
      });
      await flushFrames();

      await waitFor(() => {
        expect(
          screen.queryByText(/Preview syncing\. Content writes are paused/),
        ).toBeNull();
      });
      await pause();

      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        expectedDraftGeneration: 2,
        props: { heading: "Second" },
      });
      expect(server.route).toMatchObject({
        generation: 3,
        props: { heading: "Second" },
      });
    } finally {
      withholdAppliedAck = false;
      dispatchSpy.mockRestore();
    }
  });

  it("controlled race real recovery: returning to original route emits a fresh presentation request, replies with new ack, and saves Second once at expectedDraftGeneration 2", async () => {
    await openOn(headingReport);
    disablePresentationAcks();

    const steps: string[] = [];
    const seenTokens: Array<{
      operationId: string;
      token: Record<string, unknown>;
    }> = [];
    let postedBaseline = posted.length;

    const collectNewPosts = () => {
      for (; postedBaseline < posted.length; postedBaseline += 1) {
        const msg = posted[postedBaseline]!;
        if (
          msg.type === "morph:storefront-preview-update-section-props" &&
          msg.presentationToken
        ) {
          const token = msg.presentationToken as Record<string, unknown> & {
            operationId: string;
          };
          seenTokens.push({ operationId: token.operationId, token });
          steps.push(`post:update-section-props:${token.operationId}`);
          if (seenTokens.length > 20) {
            throw new Error(
              `Presentation post cap exceeded: ${steps.join(" -> ")}`,
            );
          }
        } else {
          steps.push(`post:${String(msg.type)}`);
        }
      }
    };

    // 1. Save First; do NOT ack its presentationToken (simulates ack lost before navigation).
    steps.push("action:type-First");
    await type("Default heading", "First");
    await pause();
    collectNewPosts();
    expect(sent()).toHaveLength(1);
    expect(server.route).toMatchObject({
      generation: 2,
      props: { heading: "First" },
    });
    const preNavTokenCount = seenTokens.length;
    expect(preNavTokenCount).toBeGreaterThan(0);

    // 2. Frame self-navigates to an unfollowed route.
    steps.push("frame:nav-unfollowed");
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/unfollowed/elsewhere",
      frameNavigationEpoch: 1,
    });
    await flushFrames();
    collectNewPosts();

    // 3. Author types Second and blurs while on unfollowed route: draft kept, no write sent.
    steps.push("action:type-Second-and-blur");
    const field = (await screen.findAllByDisplayValue("First"))[0]!;
    fireEvent.input(field, { target: { value: "Second" } });
    fireEvent.blur(field);
    await pause();
    collectNewPosts();

    expect((field as HTMLInputElement).value).toBe("Second");
    expect(sent()).toHaveLength(1);
    expect(server.route).toMatchObject({
      generation: 2,
      props: { heading: "First" },
    });

    // 4. Frame returns to the original route. Before any new ack, Second stays held and unsent.
    const beforeReturnTokenCount = seenTokens.length;
    steps.push("frame:nav-back-to-original");
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ROUTE_PATH,
      frameNavigationEpoch: 2,
    });
    await flushFrames();
    collectNewPosts();

    expect((field as HTMLInputElement).value).toBe("Second");
    expect(sent()).toHaveLength(1);

    // 5. Duplicate structure on the same route must not emit another presentation request.
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ROUTE_PATH,
      frameNavigationEpoch: 3,
    });
    await flushFrames();
    collectNewPosts();

    // 6. Observe a single fresh presentation request emitted after returning to original route.
    const postReturnTokens = seenTokens.slice(beforeReturnTokenCount);
    expect(
      postReturnTokens,
      `Expected 1 fresh presentation request after returning to ${ROUTE_PATH}; steps=${steps.join(" -> ")}`,
    ).toHaveLength(1);

    // 7. A late ack for an old pre-navigation / off-page token must be ignored.
    const stale = seenTokens[preNavTokenCount - 1]!;
    steps.push(`ack:stale:${stale.operationId}`);
    await fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: stale.operationId,
      token: stale.token,
      status: "applied",
    });
    await flushFrames();
    await pause();
    expect(sent()).toHaveLength(1);

    // 8. Reply with a fresh applied ack for the new post-return token -> Second saves once at expectedDraftGeneration 2.
    const fresh = postReturnTokens[0]!;
    steps.push(`ack:applied:${fresh.operationId}`);
    await fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: fresh.operationId,
      token: fresh.token,
      status: "applied",
    });
    await flushFrames();
    await pause();
    collectNewPosts();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      expectedDraftGeneration: 2,
      props: { heading: "Second" },
    });
    expect(server.route).toMatchObject({
      generation: 3,
      props: { heading: "Second" },
    });

    // 9. Ack the post-save presentation token for Second so the syncing banner clears.
    const postSaveTokens = seenTokens.slice(beforeReturnTokenCount + 1);
    expect(postSaveTokens.length).toBeGreaterThan(0);
    const postSave = postSaveTokens[postSaveTokens.length - 1]!;
    await fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: postSave.operationId,
      token: postSave.token,
      status: "applied",
    });
    await flushFrames();

    await waitFor(() => {
      expect(
        screen.queryByText(/Preview syncing\. Content writes are paused/),
      ).toBeNull();
    });
    expect(sent()).toHaveLength(2);
  });

  it("controlled race real recovery with external server change: returning to original route and receiving new ack still refuses Second on conflict", async () => {
    await openOn(headingReport);
    disablePresentationAcks();

    const seenTokens: Array<{
      operationId: string;
      token: Record<string, unknown>;
    }> = [];
    let postedBaseline = posted.length;
    const collectNewPosts = () => {
      for (; postedBaseline < posted.length; postedBaseline += 1) {
        const msg = posted[postedBaseline]!;
        if (
          msg.type === "morph:storefront-preview-update-section-props" &&
          msg.presentationToken
        ) {
          const token = msg.presentationToken as Record<string, unknown> & {
            operationId: string;
          };
          seenTokens.push({ operationId: token.operationId, token });
        }
      }
    };

    await type("Default heading", "First");
    await pause();
    collectNewPosts();
    expect(sent()).toHaveLength(1);

    // Frame navigates away; meanwhile another writer advances server generation to 5.
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/unfollowed/elsewhere",
      frameNavigationEpoch: 1,
    });
    await flushFrames();
    server.route = {
      generation: 5,
      props: { heading: "Theirs" },
    };

    const field = (await screen.findAllByDisplayValue("First"))[0]!;
    fireEvent.input(field, { target: { value: "Second" } });
    fireEvent.blur(field);
    await pause();
    collectNewPosts();
    expect(sent()).toHaveLength(1);

    const beforeReturnTokenCount = seenTokens.length;
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ROUTE_PATH,
      frameNavigationEpoch: 2,
    });
    await flushFrames();
    collectNewPosts();

    const postReturnTokens = seenTokens.slice(beforeReturnTokenCount);
    expect(postReturnTokens).toHaveLength(1);

    await fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: postReturnTokens[0]!.operationId,
      token: postReturnTokens[0]!.token,
      status: "applied",
    });
    await flushFrames();
    await pause();

    // Recovery sends Second with its original basis (expectedDraftGeneration: 2) and is
    // refused by the server's generation 5 without overwriting Theirs.
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      expectedDraftGeneration: 2,
      props: { heading: "Second" },
    });
    expect(server.route).toMatchObject({
      generation: 5,
      props: { heading: "Theirs" },
    });
  });

  it("controlled cross-page save after valid pre-navigation ack: typing and blurring while frame stays on unfollowed route does not post section props to unfollowed route or revoke presentationReady, and saves once", async () => {
    await openOn(headingReport);
    // Wait for initial presentation ack to settle so page is confirmed before navigation.
    await waitFor(() => {
      expect(
        screen.queryByText(/Preview syncing\. Content writes are paused/),
      ).toBeNull();
    });
    disablePresentationAcks();

    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/unfollowed/elsewhere",
      frameNavigationEpoch: 1,
    });
    await flushFrames();

    const postedBeforeTyping = posted.length;
    const field = (await screen.findAllByDisplayValue("Default heading"))[0]!;
    fireEvent.input(field, { target: { value: "Typed while elsewhere" } });

    // Simulate real bridge on /unfollowed/elsewhere: any section-props post sent there is section-missing.
    for (const msg of posted.slice(postedBeforeTyping)) {
      if (
        msg.type === "morph:storefront-preview-update-section-props" &&
        msg.presentationToken
      ) {
        const token = msg.presentationToken as Record<string, unknown> & {
          operationId: string;
        };
        await fromPreview({
          type: "morph:storefront-preview-section-presentation-ack",
          operationId: token.operationId,
          token,
          status: "not-applied",
          reason: "section-missing",
        });
      }
    }

    const offPageSectionPosts = posted
      .slice(postedBeforeTyping)
      .filter((msg) => msg.type === "morph:storefront-preview-update-section-props");
    expect(offPageSectionPosts).toHaveLength(0);
    expect(
      screen.queryAllByText(/Preview syncing\. Content writes are paused/),
    ).toHaveLength(0);

    fireEvent.blur(field);
    await pause();

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      expectedDraftGeneration: 1,
      props: { heading: "Typed while elsewhere" },
    });
    expect(server.route).toMatchObject({
      generation: 2,
      props: { heading: "Typed while elsewhere" },
    });
  });

  it("pauses cross-page writes under Option A when pre-navigation ack only proved new-document and route adoption lands after frame navigation, then saves after returning and acking existing doc", async () => {
    await openOn(headingReport);
    await waitFor(() => {
      expect(
        screen.queryByText(/Preview syncing\. Content writes are paused/),
      ).toBeNull();
    });

    holdReads();
    try {
      const postedBeforeFirstSave = posted.length;
      await type("Default heading", "First");
      await pause();

      expect(sent()).toHaveLength(1);
      expect(server.route).toMatchObject({
        generation: 2,
        props: { heading: "First" },
      });
      expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);

      // Wait for pre-navigation presentation ack on ROUTE_PATH while readCreatedDocument is still in-flight.
      await waitFor(() => {
        expect(
          screen.queryByText(/Preview syncing\. Content writes are paused/),
        ).toBeNull();
      });

      const preNavTokens = posted
        .slice(postedBeforeFirstSave)
        .filter(
          (
            msg,
          ): msg is Record<string, unknown> & {
            presentationToken: Record<string, unknown>;
          } =>
            msg.type === "morph:storefront-preview-update-section-props" &&
            Boolean(msg.presentationToken),
        )
        .map((msg) => ({
          sectionId: msg.sectionId,
          templateId: msg.presentationToken.templateId,
          documentBasis: msg.presentationToken.documentBasis,
          routePath: msg.presentationToken.routePath,
        }));
      expect(preNavTokens).toEqual([
        {
          sectionId: SLOT,
          templateId: `route-template:${ROUTE_PATH}`,
          documentBasis: {
            kind: "new-document",
            createEpoch: `route-template:${ROUTE_PATH}`,
          },
          routePath: ROUTE_PATH,
        },
      ]);

      // Frame navigates to an unfollowed route before getStorefrontThemeEditor lands.
      await fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/unfollowed/elsewhere",
        frameNavigationEpoch: 1,
      });
      await flushFrames();

      // Now getStorefrontThemeEditor lands and adopts ROUTE_DOC_ID while the frame is already on /unfollowed/elsewhere.
      await releaseReads();
      await expectAdopted();
      await flushFrames();
    } finally {
      await releaseReads();
    }

    // Under Option A, pre-navigation new-document ack does not authorize existing doc writes; writes pause until returning.
    // Option A notice (2026-11-17): it says the draft is kept and to return.
    expect(
      screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE).length,
    ).toBeGreaterThan(0);

    await type("First", "Second");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route).toMatchObject({
      generation: 2,
      props: { heading: "First" },
    });

    // Returning to the original route re-presents ROUTE_DOC_ID and releases the held write once at generation 2 -> 3.
    const postedBeforeReturn = posted.length;
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ROUTE_PATH,
      frameNavigationEpoch: 2,
    });
    await flushFrames();
    await pause();

    const postReturnTokens = posted
      .slice(postedBeforeReturn)
      .filter(
        (
          msg,
        ): msg is Record<string, unknown> & {
          presentationToken: Record<string, unknown>;
        } =>
          msg.type === "morph:storefront-preview-update-section-props" &&
          Boolean(msg.presentationToken),
      )
      .map((msg) => msg.presentationToken);
    expect(
      postReturnTokens.some(
        (token) =>
          token.templateId === ROUTE_DOC_ID &&
          (token.documentBasis as Record<string, unknown>)?.kind === "existing" &&
          (token.documentBasis as Record<string, unknown>)?.draftGeneration === 2,
      ),
    ).toBe(true);

    await waitFor(() => {
      expect(sent()).toHaveLength(2);
    });
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Second" },
    });
    expect(server.route).toMatchObject({
      generation: 3,
      props: { heading: "Second" },
    });
  });
});

/**
 * The blur release of a placeholder-keyed draft while the frame is not on
 * the editor's page may use only a proof that is still current: acknowledged
 * in this ready round, by this document, and still the latest presentation
 * of the section. A token applied in an earlier ready round, or one a newer
 * presentation of the section has superseded, is not a proof of what the
 * frame shows now: the draft is kept and nothing is written.
 */
describe("the off-page blur release uses only a still-current proof", () => {
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
  /**
   * Value 2 is typed while the first write is unanswered, so it is held
   * under the route placeholder; the first write then answers and the page
   * takes up the document this editor created, its presentation confirmed.
   */
  async function placeholderDraftAfterAdoption() {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeInCard(0, "Value 2");
    expect(sent()).toHaveLength(1);
    await act(async () => {
      first.release();
      await settleMicrotasks();
    });
    await releaseDebounce();
    await expectAdopted();
    await waitForPresentationReady();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
  }
  const blurCard = async () => {
    await act(async () => {
      fireEvent.focus(cardFields()[0]!);
      fireEvent.blur(cardFields()[0]!);
    });
    await pause();
  };

  it("control: on the editor's page, with the presentation confirmed, the blur saves the held draft once", async () => {
    await placeholderDraftAfterAdoption();
    await blurCard();
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
  });

  it("an applied token from an earlier ready round is no proof in a frame that reloaded and moved elsewhere", async () => {
    await placeholderDraftAfterAdoption();
    disablePresentationAcks();
    // The frame reloads: a new document, a new ready round, which never
    // acknowledges the editor's page before the author moves it away.
    reloadFrameDocument();
    await fromPreview({
      type: "morph:storefront-preview-ready",
      capabilities: [...LIVE_FRAME_CAPABILITIES],
    });
    await flushFrames();
    await moveFrameElsewhere(1);

    await blurCard();

    expect(cardFields()[0]!.value).toBe("Value 2");
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
  });

  it("a new-document acknowledgement from before the page took up the created document is no proof for the next write while the frame is elsewhere; returning and a fresh acknowledgement save it once", async () => {
    await openOn(headingReport);
    await waitForPresentationReady();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeInCard(0, "Value 2");
    // The frame leaves while the first write is out; the page takes up the
    // created document while it is elsewhere.
    await moveFrameElsewhere(1);
    await act(async () => {
      first.release();
      await settleMicrotasks();
    });
    await releaseDebounce();
    await expectAdopted();
    await flushFrames();

    await blurCard();

    expect(cardFields()[0]!.value).toBe("Value 2");
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
    // The notice says why: the draft is kept, and to return to the page.
    expect(
      screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE).length,
    ).toBeGreaterThan(0);

    // Back on the editor's page, the created document is presented and
    // acknowledged; the draft the author already left is saved once, on its
    // original basis, with no second blur.
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ROUTE_PATH,
      frameNavigationEpoch: 2,
    });
    await flushFrames();
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE)).toHaveLength(
      0,
    );
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    await pause();
    expect(sent()).toHaveLength(2);
    expect(storedHeading()).toBe("Value 2");
  });

  it("a new-document acknowledgement the frame withdrew is never taken as a proof of the created document", async () => {
    await openOn(headingReport);
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

    // The frame withdraws the route's new-document presentation it had
    // acknowledged before it moved (as it does on arriving back there).
    const newDocument = posted
      .filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.sectionId === SLOT &&
          (
            (message.presentationToken as Record<string, unknown> | undefined)
              ?.documentBasis as Record<string, unknown> | undefined
          )?.kind === "new-document",
      )
      .at(-1)?.presentationToken as { operationId: string } | undefined;
    expect(newDocument).toBeTruthy();
    await fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: newDocument!.operationId,
      token: newDocument,
      status: "not-applied",
      reason: "superseded",
    });
    await flushFrames();

    await blurCard();
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
    expect(cardFields()[0]!.value).toBe("Value 2");

    // Only the created document's own presentation, acknowledged after the
    // return, lets the draft go: once, on the basis it was typed on.
    const postedBeforeReturn = posted.length;
    await fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: ROUTE_PATH,
      frameNavigationEpoch: 2,
    });
    await flushFrames();
    // The draft the author already left goes once that presentation is
    // acknowledged.
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(
      posted
        .slice(postedBeforeReturn)
        .some((message) => {
          const token = message.presentationToken as
            | Record<string, unknown>
            | undefined;
          const basis = token?.documentBasis as
            | Record<string, unknown>
            | undefined;
          return (
            message.type === "morph:storefront-preview-update-section-props" &&
            token?.templateId === ROUTE_DOC_ID &&
            basis?.kind === "existing" &&
            basis.draftGeneration === 2
          );
        }),
    ).toBe(true);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    await pause();
    expect(sent()).toHaveLength(2);
  });
});

/**
 * Off-page saves, step by step: an existing document whose page the frame
 * never acknowledged, a route document already taken up under its real id
 * when the frame left, and an existing document's acknowledged page after
 * the frame withdraws every acknowledgement it gave.
 *
 * Each case reads at every step the draft in the field, the notice, the
 * writes actually sent, and what each was sent on: the document generation
 * (`expectedDraftGeneration`) and the field's source generation
 * (`expectedSourceGeneration`). The basis an input was typed on is not on
 * the request; a document changed elsewhere while away shows which basis is
 * used: a write on the original basis is refused, one on a basis taken from
 * the later acknowledgement would go through.
 */
describe("off-page saves, step by step", () => {
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
  /** While on, every applied acknowledgement from the frame is lost. */
  let withholding = false;
  const withholdAppliedAcks = () => {
    withholding = true;
    const original = window.dispatchEvent.bind(window);
    vi.spyOn(window, "dispatchEvent").mockImplementation((event: Event) => {
      if (
        withholding &&
        event instanceof MessageEvent &&
        event.data?.type === ACK &&
        event.data?.status === "applied"
      ) {
        return true;
      }
      return original(event);
    });
  };
  const heading = () => cardFields()[0]!;
  /** The author clicks into the heading and types there, not leaving it. */
  const typeInHeading = (value: string) => {
    fireEvent.focus(heading());
    fireEvent.input(heading(), { target: { value } });
  };
  /** The author leaves the heading. */
  const leaveHeading = async () => {
    await act(async () => {
      fireEvent.blur(heading());
    });
    await pause();
  };
  const notice = () => ({
    otherPage: screen.queryAllByText(PREVIEW_OTHER_PAGE_PAUSED_MESSAGE).length,
    syncing: screen.queryAllByText(/Preview syncing\./).length,
    notSavedYet: screen.queryAllByText(PREVIEW_PRESENTATION_SYNCING_MESSAGE)
      .length,
  });
  const writes = () =>
    sent().map((write) => ({
      templateId: write.templateId,
      expectedDraftGeneration: write.expectedDraftGeneration,
      expectedSourceGeneration: write.expectedSourceGeneration,
      props: write.props,
    }));
  const latestSlotToken = () =>
    posted
      .filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.sectionId === SLOT &&
          message.presentationToken,
      )
      .at(-1)?.presentationToken as { operationId: string } | undefined;
  const ackAgain = async () => {
    const token = latestSlotToken();
    expect(token).toBeTruthy();
    await fromPreview({
      type: ACK,
      operationId: token!.operationId,
      token,
      status: "applied",
    });
    await flushFrames();
    await pause();
  };

  describe("an existing document whose page the frame never acknowledged", () => {
    /**
     * The route's document exists at generation 3. The frame comes up on
     * the page, but no applied acknowledgement from it ever arrives; then it
     * moves to a page the editor does not follow.
     */
    async function neverAcknowledgedThenAway() {
      server.route = { generation: 3, props: { heading: "Stored" } };
      withholdAppliedAcks();
      await openOn(headingReport);
      expect(host.search?.templateId).toBe(ROUTE_DOC_ID);
      expect(heading().value).toBe("Stored");
      await moveFrame(ELSEWHERE, 1);
      await pause();
      expect(sent()).toHaveLength(0);
    }
    /** The frame comes back to the page; its acknowledgements arrive now. */
    async function returnAcknowledged() {
      withholding = false;
      await moveFrame(ROUTE_PATH, 2);
      await waitForPresentationReady();
      await pause();
    }

    it("input never left: nothing is sent on the return; the draft stays in the field; leaving it then saves it once on generation 3", async () => {
      await neverAcknowledgedThenAway();
      typeInHeading("Typed away");
      await pause();
      expect(sent()).toHaveLength(0);
      expect(heading().value).toBe("Typed away");

      await returnAcknowledged();
      expect(sent()).toHaveLength(0);
      expect(heading().value).toBe("Typed away");
      expect(server.route).toMatchObject({
        generation: 3,
        props: { heading: "Stored" },
      });

      await leaveHeading();
      await waitFor(() => expect(sent()).toHaveLength(1));
      await pause();
      expect(writes()).toEqual([
        {
          templateId: ROUTE_DOC_ID,
          expectedDraftGeneration: 3,
          expectedSourceGeneration: 1,
          props: { heading: "Typed away" },
        },
      ]);
    });

    it("input left while away: held, kept and said, nothing sent; the return's acknowledgement sends it once on generation 3; a repeated acknowledgement sends nothing more", async () => {
      await neverAcknowledgedThenAway();
      typeInHeading("Typed away");
      await leaveHeading();
      expect(sent()).toHaveLength(0);
      expect(heading().value).toBe("Typed away");
      expect(notice().otherPage).toBeGreaterThan(0);

      await returnAcknowledged();
      expect(writes()).toEqual([
        {
          templateId: ROUTE_DOC_ID,
          expectedDraftGeneration: 3,
          expectedSourceGeneration: 1,
          props: { heading: "Typed away" },
        },
      ]);
      expect(server.route).toMatchObject({
        generation: 4,
        props: { heading: "Typed away" },
      });
      expect(notice()).toMatchObject({ otherPage: 0 });

      await ackAgain();
      expect(sent()).toHaveLength(1);
    });

    it("input left while away, the document changed elsewhere and read meanwhile: the return's acknowledgement writes nothing over it; the draft is kept", async () => {
      await neverAcknowledgedThenAway();
      typeInHeading("Typed away");
      await leaveHeading();
      await outsideWriteRead((route) => {
        route.props = { ...(route.props ?? {}), heading: "Theirs" };
        route.generation += 1;
      });

      await returnAcknowledged();
      expect(sent()).toHaveLength(0);
      expect(server.route).toMatchObject({
        generation: 4,
        props: { heading: "Theirs" },
      });
      expect(heading().value).toBe("Typed away");
    });

    it("input left while away, the document changed elsewhere and not read: the one write goes on generation 3 and is refused; nothing is written over it", async () => {
      await neverAcknowledgedThenAway();
      typeInHeading("Typed away");
      await leaveHeading();
      server.route!.props = { heading: "Theirs" };
      server.route!.generation = 4;

      await returnAcknowledged();
      expect(writes()).toEqual([
        {
          templateId: ROUTE_DOC_ID,
          expectedDraftGeneration: 3,
          expectedSourceGeneration: 1,
          props: { heading: "Typed away" },
        },
      ]);
      expect(server.route).toMatchObject({
        generation: 4,
        props: { heading: "Theirs" },
      });
      expect(heading().value).toBe("Typed away");
    });
  });

  describe("a route document taken up under its real id while the frame is away", () => {
    /**
     * The first write creates the document (generation 2 once stored) and
     * its new-document presentation is acknowledged; the frame leaves before
     * the editor's read of the document lands, and the page takes it up
     * under its real id while the frame is away.
     */
    async function adoptedWhileAway() {
      await openOn(headingReport);
      await waitForPresentationReady();
      holdReads();
      try {
        await type("Default heading", "First");
        await pause();
        expect(sent()).toHaveLength(1);
        await waitForPresentationReady();
        await moveFrame(ELSEWHERE, 1);
        await releaseReads();
        await expectAdopted();
        await flushFrames();
      } finally {
        await releaseReads();
      }
      expect(server.route).toMatchObject({
        generation: 2,
        props: { heading: "First" },
      });
    }

    it("input left while away: held, kept and said, nothing sent; the return's acknowledgement of the document sends it once on generation 2; a repeated acknowledgement sends nothing more", async () => {
      await adoptedWhileAway();
      typeInHeading("Second");
      await leaveHeading();
      expect(sent()).toHaveLength(1);
      expect(heading().value).toBe("Second");
      expect(notice().otherPage).toBeGreaterThan(0);

      await moveFrame(ROUTE_PATH, 2);
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(writes()[1]).toEqual({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
        expectedSourceGeneration: 1,
        props: { heading: "Second" },
      });
      expect(server.route).toMatchObject({
        generation: 3,
        props: { heading: "Second" },
      });
      // What let it go: the document's own presentation, at generation 2.
      expect(
        posted.some((message) => {
          const token = message.presentationToken as
            | Record<string, unknown>
            | undefined;
          const basis = token?.documentBasis as
            | Record<string, unknown>
            | undefined;
          return (
            token?.templateId === ROUTE_DOC_ID &&
            basis?.kind === "existing" &&
            basis.draftGeneration === 2
          );
        }),
      ).toBe(true);

      await ackAgain();
      expect(sent()).toHaveLength(2);
    });

    it("input never left: nothing is sent on the return; leaving it then saves it once on generation 2", async () => {
      await adoptedWhileAway();
      typeInHeading("Second");
      await pause();
      expect(sent()).toHaveLength(1);

      await moveFrame(ROUTE_PATH, 2);
      await waitForPresentationReady();
      await pause();
      expect(sent()).toHaveLength(1);
      expect(heading().value).toBe("Second");

      await leaveHeading();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(writes()[1]).toEqual({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
        expectedSourceGeneration: 1,
        props: { heading: "Second" },
      });
    });

    it("input left while away, the document changed elsewhere and read meanwhile: the return writes nothing over it; the draft is kept", async () => {
      await adoptedWhileAway();
      typeInHeading("Second");
      await leaveHeading();
      await outsideWriteRead((route) => {
        route.props = { ...(route.props ?? {}), heading: "Theirs" };
        route.generation += 1;
      });

      await moveFrame(ROUTE_PATH, 2);
      await waitForPresentationReady();
      await pause();
      expect(sent()).toHaveLength(1);
      expect(server.route).toMatchObject({
        generation: 3,
        props: { heading: "Theirs" },
      });
      expect(heading().value).toBe("Second");
    });
  });

  describe("an existing document acknowledged before the frame left, after the frame withdraws every acknowledgement", () => {
    async function acknowledgedThenAway() {
      server.route = { generation: 3, props: { heading: "Stored" } };
      await openOn(headingReport);
      await waitForPresentationReady();
      expect(host.search?.templateId).toBe(ROUTE_DOC_ID);
      await moveFrame(ELSEWHERE, 1);
    }
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
          type: ACK,
          operationId: token.operationId,
          token,
          status: "not-applied",
          reason: "superseded",
        });
      }
      await flushFrames();
    };

    it("control: with the acknowledgement standing, input left while away saves at once, on generation 3", async () => {
      await acknowledgedThenAway();
      typeInHeading("Typed away");
      await leaveHeading();
      expect(writes()).toEqual([
        {
          templateId: ROUTE_DOC_ID,
          expectedDraftGeneration: 3,
          expectedSourceGeneration: 1,
          props: { heading: "Typed away" },
        },
      ]);
    });

    it("withdrawn: input left while away is held, kept and said, nothing sent; the return's new acknowledgement saves it once on generation 3", async () => {
      await acknowledgedThenAway();
      await withdrawEveryAck();
      typeInHeading("Typed away");
      await leaveHeading();
      expect(sent()).toHaveLength(0);
      expect(heading().value).toBe("Typed away");
      expect(notice().otherPage).toBeGreaterThan(0);

      await moveFrame(ROUTE_PATH, 2);
      await waitFor(() => expect(sent()).toHaveLength(1));
      await pause();
      expect(writes()).toEqual([
        {
          templateId: ROUTE_DOC_ID,
          expectedDraftGeneration: 3,
          expectedSourceGeneration: 1,
          props: { heading: "Typed away" },
        },
      ]);
      expect(server.route).toMatchObject({
        generation: 4,
        props: { heading: "Typed away" },
      });
      await ackAgain();
      expect(sent()).toHaveLength(1);
    });
  });
});
