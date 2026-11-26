// Part of the visual-editor-shell-route-document-writes tests; the fixture, mocks
// and hooks are in visual-editor-shell-route-document-writes.harness.tsx (imported first).
import {
  ROUTE_DOC_ID,
  updateSectionProps,
  getThemeEditor,
  ensureRouteTemplate,
  renameSection,
  publishTemplate,
  prepareInitialDraft,
  promoteText,
  createPreviewBuild,
  promoteOutcome,
  server,
  conflictAnswer,
  applyWrite,
  savedAnswer,
  holdNextWrite,
  holdReads,
  settleMicrotasks,
  host,
  renderEditor,
  flushFrames,
  headingReport,
  secondRowReport,
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
  CONFLICT_HELD,
  calls,
  rename,
  answerNextWrite,
  loseNextEnsureAnswer,
  releaseReadsUntil,
  confirmKeepMine,
  pressTryAgain,
  firstWriteLanded,
  realKeyedRefused,
  type WriteRequest,
} from "./visual-editor-shell-route-document-writes.harness";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { PREVIEW_PRESENTATION_SYNCING_MESSAGE } from "./visual-editor-shell";

describe("B: a lost ensure answer, then the author goes on", () => {
  async function lostEnsureThenTheirs() {
    loseNextEnsureAnswer();
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause(1_500);
    expect(saveStatus()).toBe("Save failed");
    expect(updateSectionProps).not.toHaveBeenCalled();
    // Someone else writes the document this tab created, unread here.
    server.route = { generation: 3, props: { heading: "Theirs" } };
  }

  async function refusedOverTheirs(kept: string) {
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(server.route).toEqual({
      generation: 3,
      props: { heading: "Theirs" },
    });
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();
    await pause(1_500);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);

    await confirmKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 3,
      props: { heading: kept },
    });
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);
    expect(storedHeading()).toBe(kept);
    expect(server.route!.generation).toBe(4);
  }

  it("typing again after an outside change: not written over Theirs, out of date, kept; Keep mine sends once at its generation", async () => {
    await lostEnsureThenTheirs();
    typeInCard(0, "Value 2");
    await pause(1_500);
    await refusedOverTheirs("Value 2");
  });

  it("Try again after an outside change: not written over Theirs, out of date, kept; Keep mine sends once at its generation", async () => {
    await lostEnsureThenTheirs();
    pressTryAgain();
    await pause(1_500);
    await refusedOverTheirs("Value 1");
  });

  // Stage 1 of "refuse a write with no version basis": with the ensure's
  // answer lost, the document is found existing next time, not proven
  // created here; typing again is refused before sending even with no
  // outside change, and Keep mine sends it once at generation 1. (Before,
  // typing again sent it at generation 1 with no basis.)
  it("mirror: with no outside change, typing again is refused for want of a basis; Keep mine sends once at generation 1 and it is stored", async () => {
    loseNextEnsureAnswer();
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause(1_500);
    expect(updateSectionProps).not.toHaveBeenCalled();
    typeInCard(0, "Value 2");
    await pause(1_500);

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);
    expect(updateSectionProps).not.toHaveBeenCalled();
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(server.route).toEqual({ generation: 1, props: null });

    await confirmKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(server.route!.generation).toBe(2);
  });
});

describe("C: placeholder-keyed content during an outside document change", () => {
  /**
   * The first write lands (generation 2) while the read after it is held, so
   * the page stays on the placeholder and the next input is keyed by it. Its
   * answer is taken only once that read returns (the content mutation's
   * success awaits the Theme read), so the input has no accepted source basis.
   */
  async function landedOnPlaceholder() {
    await openOn(headingReport);
    holdReads();
    await type("Default heading", "Value 1");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route!.generation).toBe(2);
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
  }
  const theirsAt4 = () => {
    server.route = { generation: 4, props: { heading: "Theirs" } };
  };
  function expectUnsentOverTheirs() {
    expect(sent()).toHaveLength(1);
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(server.route).toEqual({
      generation: 4,
      props: { heading: "Theirs" },
    });
  }

  it("does not send placeholder-keyed input after the outside document is read while its preview is syncing", async () => {
    await landedOnPlaceholder();
    holdDebounce();
    typeInCard(0, "Value 2");
    theirsAt4();
    await releaseReadsUntil(4);
    await releaseDebounce();
    expectUnsentOverTheirs();
    expect(saveStatus()).toBe("Unsaved");
    expect(cardFields()[0]?.value).toBe("Value 2");
    await expectAdopted();
    await waitForPresentationReady();
    await pause();
    expectUnsentOverTheirs();
    expect(cardFields()[0]?.value).toBe("Value 2");
  });

  it("stops a pre-step flush for placeholder input whose preview is still syncing", async () => {
    await landedOnPlaceholder();
    holdDebounce();
    typeInCard(0, "Value 2");
    vi.useRealTimers();
    theirsAt4();
    await releaseReadsUntil(4);
    await expectAdopted();

    const outcome = await rename();
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe(PREVIEW_PRESENTATION_SYNCING_MESSAGE);
    await pause();
    expect(renameSection).not.toHaveBeenCalled();
    expectUnsentOverTheirs();
    await waitForPresentationReady();
    await pause();
    expectUnsentOverTheirs();
  });

  it("keeps no-basis placeholder input unsent after a newer document is read", async () => {
    await openOn(headingReport);
    holdReads();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeInCard(0, "Value 2");
    await act(async () => {
      first.release();
      await settleMicrotasks();
    });
    expect(server.route!.generation).toBe(2);
    theirsAt4();
    await releaseReadsUntil(4);
    await releaseDebounce();
    expectUnsentOverTheirs();
    expect(saveStatus()).toBe("Unsaved");
    await expectAdopted();
    await waitForPresentationReady();
    await pause();
    expectUnsentOverTheirs();
  });
});

describe("D: steps that flush first stop on held content", () => {
  it("build: stops on a refused entry; no draft is prepared and no build is created", async () => {
    await realKeyedRefused();
    const before = calls();
    fireEvent.click(screen.getByRole("button", { name: "Build the theme" }));
    await pause();
    expect(calls()).toEqual(before);
    expect(createPreviewBuild).not.toHaveBeenCalled();
    expect(prepareInitialDraft).not.toHaveBeenCalled();
    expect(storedHeading()).toBe("Theirs");
    expect(saveStatus()).toBe("Out of date");
    // Said, with the reason it was held.
    expect(toast.error).toHaveBeenCalledWith(`Cannot build: ${CONFLICT_HELD}`);
    // Kept: the explicit recovery sends the typed text once; the build does
    // not go on by itself.
    await confirmKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 4,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(createPreviewBuild).not.toHaveBeenCalled();
    expect(prepareInitialDraft).not.toHaveBeenCalled();
  });

  it("publish: stops on a refused entry; nothing is prepared or published", async () => {
    await firstWriteLanded();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(document.querySelector("[data-publish-confirm]")).toBeTruthy(),
    );
    holdDebounce();
    typeInCard(0, "Value 2");
    await outsideWriteRead((route) => {
      route.props = { ...route.props, heading: "Theirs" };
      route.generation = 4;
    });
    await releaseDebounce();
    expect(saveStatus()).toBe("Out of date");
    const before = calls();

    const confirm = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        "[data-publish-confirm]",
      );
      expect(button).toBeTruthy();
      expect(button!.disabled).toBe(false);
      return button!;
    });
    fireEvent.click(confirm);
    await pause();
    expect(calls()).toEqual(before);
    expect(publishTemplate).not.toHaveBeenCalled();
    expect(prepareInitialDraft).not.toHaveBeenCalled();
    expect(storedHeading()).toBe("Theirs");
    // Said, with the reason it was held.
    expect(toast.error).toHaveBeenCalledWith(
      `Cannot publish: ${CONFLICT_HELD}`,
    );
    // Kept: the explicit recovery sends the typed text once; the publish
    // does not go on by itself.
    await confirmKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 4,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(publishTemplate).not.toHaveBeenCalled();
    expect(prepareInitialDraft).not.toHaveBeenCalled();
  });

  it("promote: stops on a refused entry with the held message; nothing is promoted", async () => {
    await realKeyedRefused();
    const before = calls();
    fireEvent.click(
      screen.getByRole("button", { name: "Promote the card text" }),
    );
    await waitFor(() => expect(promoteOutcome.settled).toBeDefined());
    await pause();
    expect(promoteOutcome.settled).toEqual({
      status: "failed",
      message: CONFLICT_HELD,
    });
    expect(calls()).toEqual(before);
    expect(promoteText).not.toHaveBeenCalled();
    expect(storedHeading()).toBe("Theirs");
  });
});

describe("E: generation 1 is not proof this tab created the document", () => {
  // Stage 1 of "refuse a write with no version basis": an existing
  // generation-1 document this editor did not create is no exception. The
  // write is refused before it is sent and kept; Keep mine sends it once.
  // (Before, it went once at generation 1 with no basis.)
  it("E1: another tab created it and left it as created: this tab's write is refused for want of a basis, kept; Keep mine sends once at generation 1", async () => {
    await openOn(headingReport);
    server.route = { generation: 1, props: null };
    await type("Default heading", "Value 1");
    await pause();

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps).not.toHaveBeenCalled();
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(screen.getAllByDisplayValue("Value 1").length).toBeGreaterThan(0);

    await confirmKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 1" },
    });
    expect(server.route).toMatchObject({
      generation: 2,
      props: { heading: "Value 1" },
    });
  });

  it("E2: another tab created and wrote it: refused, not written over Theirs, kept; Keep mine sends once", async () => {
    await openOn(headingReport);
    server.route = { generation: 2, props: { heading: "Theirs" } };
    await type("Default heading", "Value 1");
    await pause(1_500);

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(server.route).toEqual({
      generation: 2,
      props: { heading: "Theirs" },
    });
    expect(saveStatus()).toBe("Out of date");

    await confirmKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 1" },
    });
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(server.route).toMatchObject({
      generation: 3,
      props: { heading: "Value 1" },
    });
  });
});

describe("F: the creation basis applies only to placeholder-keyed input", () => {
  /** The route has its document at load (generation 3): bound to the real id. */
  async function openOnExisting() {
    server.route = { generation: 3, props: { heading: "Stored" } };
    renderEditor();
    await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    await flushFrames();
    await select(headingReport);
    expect(host.search?.templateId).toBe(ROUTE_DOC_ID);
  }

  it("F1: an existing document's own-step chain still sends, at its generations, with no ensure", async () => {
    await openOnExisting();
    await type("Stored", "Value 1");
    await pause();
    typeInCard(0, "Value 2");
    await pause();

    expect(ensureRouteTemplate).not.toHaveBeenCalled();
    expect(sent().map((write) => write.expectedDraftGeneration)).toEqual([
      3, 4,
    ]);
    expect(sent().map((write) => write.props.heading)).toEqual([
      "Value 1",
      "Value 2",
    ]);
    expect(server.route).toMatchObject({
      generation: 5,
      props: { heading: "Value 2" },
    });
  });

  it("F1: an existing document's outside change is still refused", async () => {
    await openOnExisting();
    await type("Stored", "Value 1");
    await pause();
    holdDebounce();
    typeInCard(0, "Value 2");
    await outsideWriteRead((route) => {
      route.props = { heading: "Theirs" };
      route.generation = 7;
    });
    await releaseDebounce();

    expect(ensureRouteTemplate).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(1);
    expect(server.route).toEqual({
      generation: 7,
      props: { heading: "Theirs" },
    });
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getAllByDisplayValue("Value 2").length).toBeGreaterThan(0);
  });

  it("F2: placeholder-keyed input with a recorded basis (2) keeps it: sent once at 2, not refused as made on 1", async () => {
    await openOn(headingReport);
    // Reads of the Theme fail from here: the page stays on the placeholder,
    // while the first write's answer is still taken (its document, at 2,
    // becomes the copy held, nobody's own range before it).
    getThemeEditor.mockImplementation(async () => {
      throw new Error("Failed to fetch");
    });
    await type("Default heading", "Value 1");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route!.generation).toBe(2);
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
    // Typed on that copy, so its basis is 2. Replaced by 1, it would be
    // outside the own range and refused.
    typeInCard(0, "Value 2");
    await pause();

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(server.route!.generation).toBe(3);
  });

  it("F2b: placeholder-keyed input stays unsent until the accepted route document is presented", async () => {
    // The read the first write's ensure started is slower than the write:
    // the first copy this tab holds is the one the write's answer brought,
    // at 2, and the input is typed on the placeholder before that read
    // arrives. Nobody else wrote the document. (The write itself has been
    // answered here; input typed while it is still unanswered, with the
    // read arriving first, is a separate case, not covered by this test.)
    await openOn(headingReport);
    holdReads();
    await type("Default heading", "Value 1");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route!.generation).toBe(2);
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
    await waitForPresentationReady();
    holdDebounce();
    typeInCard(0, "Value 2");
    // Held by the debounce: the second edit has not left yet.
    expect(sent()).toHaveLength(1);
    expect(server.route).toEqual({
      generation: 2,
      props: { heading: "Value 1" },
    });
    await releaseReadsUntil(2);
    await releaseDebounce();

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(saveStatus()).not.toBe("Out of date");
    await expectAdopted();
    await waitForPresentationReady();
    expect(sent()).toHaveLength(1);
    expect(server.route).toEqual({
      generation: 2,
      props: { heading: "Value 1" },
    });
    await pause();
    expect(sent()).toHaveLength(1);

    // The previous value remains in the input; only a new edit made against
    // the confirmed route Document can be written.
    expect(cardFields()[0]?.value).toBe("Value 2");
    await waitFor(() => expect(cardFields()[0]?.disabled).toBe(false));
    typeInCard(0, "Value 2 confirmed");
    await pause();
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2 confirmed" },
    });
    expect(storedHeading()).toBe("Value 2 confirmed");
    expect(server.route).toEqual({
      generation: 3,
      props: { heading: "Value 2 confirmed" },
    });
  });

  it("F3: no-basis placeholder input stays unsent after a newer copy is presented", async () => {
    await openOn(headingReport);
    holdReads();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeInCard(0, "Value 2");
    await act(async () => {
      first.release();
      await settleMicrotasks();
    });
    server.route = { generation: 4, props: { heading: "Theirs" } };
    await releaseReadsUntil(4);
    await releaseDebounce();
    expect(sent()).toHaveLength(1);
    expect(saveStatus()).toBe("Unsaved");
    expect(server.route).toEqual({
      generation: 4,
      props: { heading: "Theirs" },
    });
    await expectAdopted();
    await waitForPresentationReady();
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route).toEqual({
      generation: 4,
      props: { heading: "Theirs" },
    });
    expect(cardFields()[0]?.value).toBe("Value 2");
    // The source basis was unknown when this draft began. Presenting a newer
    // copy does not silently rebase it or create a new write opportunity.
    await waitFor(() => expect(cardFields()[0]?.disabled).toBe(false));
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route).toEqual({
      generation: 4,
      props: { heading: "Theirs" },
    });
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
  });
});

/**
 * R1: one section has one pending identity across the page taking up its
 * route document. An edit held under the placeholder (failed, refused, or
 * sent with no answer) and a newer edit of the same section made after the
 * page took up the document are one edit of one section, never two, so no
 * recovery can send the older value after the newer one.
 */
describe("R1: one section, one pending edit across the page taking up its route document", () => {
  /** Writes sent after `from` that carry `heading`. */
  const sentSince = (from: number, heading: string) =>
    sent()
      .slice(from)
      .filter((write) => write.props.heading === heading);

  /** Presses whichever recovery is offered, if any, and settles. */
  async function recoverIfOffered() {
    if (screen.queryByRole("button", { name: "Try again" })) {
      pressTryAgain();
      await pause();
      if (screen.queryByRole("button", { name: "Try again" })) {
        await waitForPresentationReady();
        if (screen.queryByRole("button", { name: "Try again" })) {
          pressTryAgain();
          await pause();
        }
      }
    }
    if (screen.queryByRole("button", { name: "Load latest, keep mine" })) {
      await confirmKeepMine();
    }
  }

  it("failed under the placeholder, then a newer edit: the newer value is stored and no recovery puts the older one back", async () => {
    answerNextWrite("failure");
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    await expectAdopted();
    expect(saveStatus()).toBe("Save failed");
    expect(server.route).toEqual({ generation: 1, props: null });
    const typedAt = sent().length;

    typeInCard(0, "Value 2");
    await pause();
    await recoverIfOffered();

    expect(sentSince(typedAt, "Value 1")).toHaveLength(0);
    expect(storedHeading()).toBe("Value 2");
    expect(server.route!.generation).toBe(2);
    expect(saveStatus()).not.toBe("Save failed");
    // Nothing more goes on its own.
    const settled = sent().length;
    await pause();
    expect(sent()).toHaveLength(settled);
  });

  it("refused under the placeholder, then a newer edit: Theirs is written over only by the newer value, and only once", async () => {
    answerNextWrite("conflict");
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    await expectAdopted();
    expect(saveStatus()).toBe("Out of date");
    expect(storedHeading()).toBe("Theirs");
    const typedAt = sent().length;

    typeInCard(0, "Value 2");
    await pause();
    await recoverIfOffered();

    expect(sentSince(typedAt, "Value 1")).toHaveLength(0);
    // Every write after the newer edit carries it; one of them landed.
    expect(sent().slice(typedAt).length).toBeGreaterThan(0);
    expect(
      sent()
        .slice(typedAt)
        .every((write) => write.props.heading === "Value 2"),
    ).toBe(true);
    expect(storedHeading()).toBe("Value 2");
    const settled = sent().length;
    await pause();
    expect(sent()).toHaveLength(settled);
  });

  it("landed with no answer, then a newer edit: held; Try again checks the write as it was sent, then sends the newer value once", async () => {
    // The write lands, and its answer never arrives.
    updateSectionProps.mockImplementationOnce(
      async ({ data }: { data: WriteRequest }) => {
        applyWrite(data);
        throw new Error("Failed to fetch");
      },
    );
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause(1_500);
    expect(storedHeading()).toBe("Value 1");
    expect(server.route!.generation).toBe(2);
    expect(saveStatus()).toBe("Save failed");

    typeInCard(0, "Value 2");
    await pause();
    // Held behind the unanswered write: nothing goes on its own.
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");

    await recoverIfOffered();
    await pause();

    expect(sent()).toHaveLength(2);
    // The check found the write as it was sent (Value 1) landed: the newer
    // value goes once, on the document that write produced.
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(server.route!.generation).toBe(3);
  });
});

/**
 * Q3: the Inspector field the author is typing in stays the same input
 * across the page taking up the route document its own first write
 * created: its text, focus, caret and anything typed since are the author's,
 * and an edit that appends builds on what they typed, never on a default the
 * field was rebuilt with. Typing appends to the value shown, as a keyboard
 * does; `fill()`-style replacement would hide a rebuilt field.
 */
describe("Q3: the field the author types in, across the page taking up its route document", () => {
  /** Row b's title, among the rows' titles the row selection shows. */
  const rowB = () => cardFields()[1] as HTMLInputElement | undefined;

  async function typeKeeping(field: HTMLInputElement, value: string) {
    await waitFor(() => expect(field.disabled).toBe(false));
    act(() => {
      field.focus();
    });
    fireEvent.input(field, { target: { value } });
    field.setSelectionRange(value.length, value.length);
  }

  /**
   * The first input into a list whose rows have no ids gives the rows their
   * ids, and the row inputs are rebuilt then. That happens on any document,
   * not when the page takes up its route document, and is recorded apart
   * (handoff row-id-seeding: input lost, a separate fix). These tests start
   * following the field once the rows have their ids, with focus and caret
   * where the author left them. They show the page taking up its document
   * no longer rebuilds the input; they do not show the first edit of rows
   * without ids keeps it.
   */
  async function beginInRowB(value: string): Promise<HTMLInputElement> {
    await typeKeeping(rowB()!, value);
    const field = rowB()!;
    act(() => {
      field.focus();
    });
    field.setSelectionRange(field.value.length, field.value.length);
    expect(field.value).toBe(value);
    return field;
  }

  function expectSameField(field: HTMLInputElement, value: string) {
    expect(field.isConnected).toBe(true);
    expect(rowB()).toBe(field);
    expect(field.value).toBe(value);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([
      value.length,
      value.length,
    ]);
  }

  it("row b keeps the same input through route adoption, then appends on the confirmed preview", async () => {
    await openOn(secondRowReport);
    const first = holdNextWrite();
    expect(rowB()!.value).toBe("Two");
    const field = await beginInRowB("Two edited");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expectSameField(field, "Two edited");

    await act(async () => {
      first.release();
    });
    await expectAdopted();
    await waitForPresentationReady();
    expectSameField(field, "Two edited");

    await typeKeeping(field, `${field.value} more`);
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();

    expectSameField(field, "Two edited more");
    expect(rowsOf(sent()[1]!).map(([, title]) => title)).toEqual([
      "One",
      "Two edited more",
    ]);
    expect(
      (server.route!.props!.items as Array<{ title: string }>).map(
        (row) => row.title,
      ),
    ).toEqual(["One", "Two edited more"]);
  });

  it("row b after the first answer landed: the same input keeps text, focus and caret; the appended text is stored", async () => {
    await openOn(secondRowReport);
    const field = await beginInRowB("Two edited");
    await pause();
    await expectAdopted();
    expectSameField(field, "Two edited");

    await typeKeeping(field, `${field.value} more`);
    await pause();
    expectSameField(field, "Two edited more");
    expect(
      (server.route!.props!.items as Array<{ title: string }>).map(
        (row) => row.title,
      ),
    ).toEqual(["One", "Two edited more"]);
  });

  it("keeps the heading draft across route adoption, then saves a fresh edit on the confirmed preview", async () => {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    await waitForPresentationReady();
    const field = cardFields()[0] as HTMLTextAreaElement;
    expect(field.value).toBe("Value 1");

    // The author goes back into the field and appends to what is shown.
    await waitFor(() => expect(field.disabled).toBe(false));
    act(() => {
      field.focus();
    });
    fireEvent.input(field, { target: { value: `${field.value} more` } });
    fireEvent.blur(field);
    await act(async () => {
      first.release();
    });
    await expectAdopted();
    // The author left the field (a commit) while the first write was out,
    // and the checks held it then. Once the route Document is presented and
    // acknowledged, that commit goes once, on the generation the first write
    // answered, with no second blur.
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 1 more" },
    });
    expect(field.value).toBe("Value 1 more");
    await pause();
    expect(sent()).toHaveLength(2);
    expect(server.route).toEqual({
      generation: 3,
      props: { heading: "Value 1 more" },
    });

    // A new edit on the presented Document carries a current proof.
    await waitFor(() => expect(field.disabled).toBe(false));
    act(() => {
      field.focus();
    });
    fireEvent.input(field, { target: { value: `${field.value} again` } });
    fireEvent.blur(field);
    await waitFor(() => expect(sent()).toHaveLength(3));
    await pause();
    expect(sent()).toHaveLength(3);

    expect(sent()[2]!.props.heading).toBe("Value 1 more again");
    expect(
      sent().filter((write) =>
        String(write.props.heading).startsWith("Default heading"),
      ),
    ).toHaveLength(0);
    expect(storedHeading()).toBe("Value 1 more again");
    expect((cardFields()[0] as HTMLTextAreaElement).value).toBe(
      "Value 1 more again",
    );
  });

  it("synthetic composition events (jsdom, not a real IME): a composition open across the page taking up the document ends in the same input and is stored", async () => {
    await openOn(secondRowReport);
    const first = holdNextWrite();
    const field = await beginInRowB("Two edited");
    await waitFor(() => expect(sent()).toHaveLength(1));

    fireEvent.compositionStart(field);
    await act(async () => {
      first.release();
    });
    await expectAdopted();
    await waitForPresentationReady();
    expect(field.isConnected).toBe(true);
    expect(rowB()).toBe(field);
    expect(document.activeElement).toBe(field);
    fireEvent.input(field, { target: { value: "Two edited 新年" } });
    fireEvent.compositionEnd(field);
    await pause();

    expect(field.value).toBe("Two edited 新年");
    expect(
      (server.route!.props!.items as Array<{ title: string }>).map(
        (row) => row.title,
      ),
    ).toEqual(["One", "Two edited 新年"]);
  });
});

/**
 * Moved from visual-editor-shell-inline-guard-accepted-copy.test.tsx (R1-R3),
 * where they wrote with no copy held of an existing document. Stage 1 of "no
 * basis -> refuse" sends no such write; the one write still sent with no copy
 * held is onto a route document this editor's ensure created
 * (`createdByThisCall`), so they run on that path here. Their intent is
 * unchanged: only an answered write with a valid document makes the first
 * copy; a refused, document-less or unanswered answer moves no source
 * baseline and makes no first copy.
 */
describe("only an answered write with a valid document makes the first copy", () => {
  const sourceBaseline = () => {
    const state = useThemeWorkspaceStore.getState();
    const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
    return {
      accepted: state.getAcceptedSourceGeneration(scope),
      observed: state.getObservedSourceGeneration(scope),
    };
  };
  /** The first write: sent once, with no copy held, onto the created document. */
  const sentOnceOntoCreatedDocument = () => {
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 1" },
    });
  };

  // Stage 1 of "no basis -> refuse": on a route document this editor created,
  // where the no-copy write is still sent (before: an existing document).
  it("R1 a refused write moves no source baseline", async () => {
    updateSectionProps.mockImplementation(async () => conflictAnswer());
    await openOn(headingReport);
    const before = sourceBaseline();
    await type("Default heading", "Value 1");
    await pause();
    sentOnceOntoCreatedDocument();
    expect(sourceBaseline()).toEqual(before);
  });

  // Stage 1 of "no basis -> refuse": on a route document this editor created
  // (before: an existing document, observed through a canvas commit). Reads
  // of the Theme fail, so no read brings a copy; the only copy there could
  // be is one made from the answer. F2 is the control: the same steps with
  // an answer that carries its document make a copy at 2, and the next edit
  // is sent at 2. Here none is made, so the next edit is not sent.
  it("R2 an answer without a document makes no copy: the answered text is not taken as stored", async () => {
    await openOn(headingReport);
    getThemeEditor.mockImplementation(async () => {
      throw new Error("Failed to fetch");
    });
    updateSectionProps.mockImplementationOnce(
      async ({ data }: { data: WriteRequest }) => {
        const saved = applyWrite(data) as ReturnType<typeof savedAnswer>;
        return {
          ...saved,
          data: {
            draftGeneration: saved.data.draftGeneration,
            droppedProps: [],
          },
        };
      },
    );
    const before = sourceBaseline();
    await type("Default heading", "Value 1");
    await pause();
    sentOnceOntoCreatedDocument();
    expect(server.route).toEqual({
      generation: 2,
      props: { heading: "Value 1" },
    });
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);

    typeInCard(0, "Value 2");
    await pause();
    expect(sent(), "no copy at 2 to send the next edit on").toHaveLength(1);
    expect(server.route).toEqual({
      generation: 2,
      props: { heading: "Value 1" },
    });
    expect(sourceBaseline()).toEqual(before);
  });

  // Stage 1 of "no basis -> refuse": on a route document this editor created,
  // where the no-copy write is still sent (before: an existing document).
  it("R3 an unanswered write moves no source baseline", async () => {
    updateSectionProps.mockImplementation(async () => {
      throw new Error("Failed to fetch");
    });
    await openOn(headingReport);
    const before = sourceBaseline();
    await type("Default heading", "Value 1");
    await pause();
    sentOnceOntoCreatedDocument();
    expect(sourceBaseline()).toEqual(before);
  });
});
