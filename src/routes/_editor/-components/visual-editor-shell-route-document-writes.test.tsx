// Part of the visual-editor-shell-route-document-writes tests; the fixture, mocks
// and hooks are in visual-editor-shell-route-document-writes.harness.tsx (imported first).
import {
  ROUTE_PATH,
  SLOT,
  ROUTE_DOC_ID,
  PLACEHOLDER,
  updateSectionProps,
  getThemeEditor,
  ensureRouteTemplate,
  renameSection,
  renameOutcome,
  server,
  applyWrite,
  holdNextWrite,
  holdReads,
  releaseReads,
  settleMicrotasks,
  detailQuery,
  host,
  client,
  fromPreview,
  flushFrames,
  headingReport,
  secondRowReport,
  openOn,
  type,
  pause,
  sent,
  saveStatus,
  waitForPresentationReady,
  readWhileOut,
  expectAdopted,
  cardFields,
  typeInCard,
  holdDebounce,
  releaseDebounce,
  outsideWriteRead,
  storedHeading,
  rowsOf,
  liveTyped,
  routeRequests,
  CONFLICT_HELD,
  FAILED_HELD,
  calls,
  rename,
  answerNextWrite,
  loseNextEnsureAnswer,
  pressKeepMine,
  confirmKeepMine,
  pressTryAgain,
  firstWriteLanded,
  realKeyedRefused,
  type WriteRequest,
} from "./visual-editor-shell-route-document-writes.harness";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { heldContentMessage } from "@/lib/storefront/editor/content-rebase";
import { MISSING_BASIS_MESSAGE } from "@/lib/storefront/editor/pending-content-write";
import { UNCONFIRMED_SAVE_HOLD } from "./editor-unconfirmed-saves-notice";
import { PREVIEW_PRESENTATION_SYNCING_MESSAGE } from "./visual-editor-shell";

describe("the fixture", () => {
  it("binds the route placeholder until the first write creates the document", async () => {
    await openOn(headingReport);
    expect(host.search?.routePath).toBe(ROUTE_PATH);
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
    await type("Default heading", "Value 1");
    await pause();
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(ensureRouteTemplate.mock.calls[0]![0].data.routePath).toBe(
      ROUTE_PATH,
    );
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 1" },
    });
    await expectAdopted();
    expect(PLACEHOLDER).toBe(`route-template:${ROUTE_PATH}`);
  });
});

/**
 * Stage 1 of "refuse an existing-Document content write that has no version
 * basis": input made while the route had no document carries no basis, and
 * goes with none only onto a document this editor confirmed creating (the
 * ensure's `createdByThisCall`), at generation 1. A generation-1 document
 * that already existed is not one: generation 1 alone proves nothing.
 */
describe("the route-document exception to the version basis", () => {
  it("control: the document this editor's ensure created takes the first write once, at generation 1", async () => {
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
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

  it("an existing generation-1 document the ensure found (not created by it): no write, the input kept as not saved", async () => {
    await openOn(headingReport);
    // Another editor created the route's document after this one opened.
    server.route = { generation: 1, props: null };
    await type("Default heading", "Value 1");
    await pause(1_500);

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps, "no content write").not.toHaveBeenCalled();
    expect(server.route, "their document unchanged").toEqual({
      generation: 1,
      props: null,
    });
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getAllByDisplayValue("Value 1").length).toBeGreaterThan(0);
    expect(
      vi.mocked(toast.error).mock.calls.map((call) => String(call[0])),
    ).toContain(MISSING_BASIS_MESSAGE);
    // Nothing goes on its own afterwards either.
    await pause(1_500);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  // The stage-1 refusal is reached with a valid presentation
  // proof (the route acknowledged as having no document yet) and no basis,
  // from each entry that can be used on such a route.
  const missingBasisSaid = () =>
    vi
      .mocked(toast.error)
      .mock.calls.map((call) => String(call[0]))
      .includes(MISSING_BASIS_MESSAGE);

  it("Show / Hide, the ensure finding an existing generation-1 document: no write, the stage-1 refusal said", async () => {
    await openOn(headingReport);
    await waitForPresentationReady();
    server.route = { generation: 1, props: null };
    fireEvent.click(
      screen.getAllByRole("button", { name: `Hide section ${SLOT}` })[0]!,
    );
    await pause(1_500);

    expect(updateSectionProps, "no content write").not.toHaveBeenCalled();
    expect(server.route).toEqual({ generation: 1, props: null });
    expect(missingBasisSaid()).toBe(true);
    expect(saveStatus()).toBe("Out of date");
  });

  it("a canvas reorder, the ensure finding an existing generation-1 document: no write, the stage-1 refusal said", async () => {
    await openOn(secondRowReport);
    await waitForPresentationReady();
    server.route = { generation: 1, props: null };
    await fromPreview({
      type: "morph:storefront-preview-commit-array-item-reorder",
      sectionId: SLOT,
      draggedFieldPath: "items.1",
      targetFieldPath: "items.0",
    });
    await pause(1_500);

    expect(updateSectionProps, "no content write").not.toHaveBeenCalled();
    expect(server.route).toEqual({ generation: 1, props: null });
    expect(missingBasisSaid()).toBe(true);
  });
});

describe("the selection when the page takes up the route document it created", () => {
  it("stays: typing on, with nothing selected again, reaches the canvas and the new document", async () => {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(liveTyped("Value 1")).toHaveLength(1);
    await readWhileOut();
    await expectAdopted();
    await waitForPresentationReady();

    // No click, no Inspector reopened: the author goes on typing.
    typeInCard(0, "Value 2");
    expect(liveTyped("Value 2")).toHaveLength(1);
    expect(liveTyped("Value 2")[0]).toMatchObject({ sectionId: SLOT });

    await act(async () => {
      first.release();
    });
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      sectionId: SLOT,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
  });

  it("is let go on a real change of page, after the route document was taken up", async () => {
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    await expectAdopted();
    expect(cardFields().length).toBeGreaterThan(0);

    // Another page: the selection and the Inspector it fed are let go.
    act(() => {
      host.go!({ routePath: "/", templateId: undefined });
    });
    await waitFor(() => expect(cardFields()).toHaveLength(0));
    expect(liveTyped("Value 2")).toHaveLength(0);
  });

  it("never disables or blurs the focused Inspector input while the page takes up its route document and the author keeps typing", async () => {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "first");
    await waitFor(() => expect(sent()).toHaveLength(1));

    const field = cardFields()[0]!;
    act(() => {
      field.focus();
    });
    expect(document.activeElement).toBe(field);

    let disabledCount = 0;
    const observer = new MutationObserver(() => {
      if (field.disabled) {
        disabledCount += 1;
        field.blur();
      }
    });
    observer.observe(field, { attributes: true, attributeFilter: ["disabled"] });

    try {
      act(() => {
        fireEvent.input(field, { target: { value: "first still typing" } });
      });
      await readWhileOut();
      await expectAdopted();

      expect(disabledCount).toBe(0);
      expect(field.disabled).toBe(false);
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe("first still typing");

      act(() => {
        fireEvent.input(field, {
          target: { value: "first still typing more" },
        });
      });
      expect(disabledCount).toBe(0);
      expect(field.disabled).toBe(false);
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe("first still typing more");
      expect(liveTyped("first still typing more")).toHaveLength(1);

      await act(async () => {
        first.release();
      });
      await waitForPresentationReady();
      expect(disabledCount).toBe(0);
      expect(field.disabled).toBe(false);
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe("first still typing more");

      act(() => {
        fireEvent.blur(field);
      });
      await pause();
      await waitFor(() => expect(sent()).toHaveLength(2));
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        sectionId: SLOT,
        expectedDraftGeneration: 2,
        props: { heading: "first still typing more" },
      });
      expect(disabledCount).toBe(0);
    } finally {
      observer.disconnect();
    }
  });
});

describe("the frame's route when the page takes up the route document it created", () => {
  it("is not sent again when the editor takes up the document its own first write created", async () => {
    await openOn(headingReport);
    // On the route with the borrowed shared document, the frame told once.
    expect(host.search?.templateId).toBe("template-1");
    const before = routeRequests().length;
    expect(before).toBeGreaterThan(0);
    expect(routeRequests().at(-1)).toMatchObject({
      templateId: "template-1",
      routePath: ROUTE_PATH,
    });

    // The first write creates the route document, is answered, and the
    // editor's own read after it moves the page onto the new id.
    await type("Default heading", "Value 1");
    await pause();
    await expectAdopted();
    await flushFrames();
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");

    // Same page: the frame is asked for nothing, so one that moved away by
    // itself meanwhile is not taken back.
    expect(routeRequests()).toHaveLength(before);
  });

  it("control: is sent again when the route's document changes to one this editor did not create", async () => {
    await openOn(headingReport);
    expect(host.search?.templateId).toBe("template-1");
    const before = routeRequests().length;
    expect(before).toBeGreaterThan(0);

    // Another tab created the route document; this editor only reads it.
    server.route = { generation: 1, props: null };
    await readWhileOut();
    await expectAdopted();
    await flushFrames();
    expect(ensureRouteTemplate).not.toHaveBeenCalled();

    await waitFor(() => expect(routeRequests().length).toBeGreaterThan(before));
    expect(routeRequests().at(-1)).toMatchObject({
      templateId: ROUTE_DOC_ID,
      routePath: ROUTE_PATH,
    });
  });
});

describe("the second edit on a route document this editor just created", () => {
  it("C1: waits for the first write's answer, then goes to the real id at the generation it returned", async () => {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
    });
    // The read after ensure moved the page onto the real id: the second
    // edit is staged and queued under it, not under the placeholder.
    await readWhileOut();
    await expectAdopted();
    await waitForPresentationReady();

    typeInCard(0, "Value 2");
    await pause();
    // Queued behind the unanswered first write.
    expect(sent()).toHaveLength(1);

    await act(async () => {
      first.release();
    });
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      sectionId: SLOT,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(storedHeading()).toBe("Value 2");
    expect(server.route!.generation).toBe(3);
    expect(saveStatus()).toBe("Unpublished");
  });

  it("placeholder-keyed edit typed while the first save is unanswered is saved on blur after route adoption", async () => {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));

    // Type while the first write is still unanswered and the editor is still on the placeholder.
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

    await act(async () => {
      fireEvent.focus(cardFields()[0]!);
      fireEvent.blur(cardFields()[0]!);
    });
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      sectionId: SLOT,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
  });
});

describe("G1: someone else's change to the new document", () => {
  async function firstWriteLanded() {
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route!.generation).toBe(2);
    await expectAdopted();
    await waitForPresentationReady();
  }

  it("refuses the second edit when an outside change at generation 4 is read before it leaves", async () => {
    await firstWriteLanded();
    holdDebounce();
    typeInCard(0, "Value 2");
    await outsideWriteRead((route) => {
      route.props = { ...route.props, heading: "Theirs" };
      route.generation = 4;
    });
    await releaseDebounce();

    // Never sent as fine at the newer generation on the older copy; in
    // fact not sent at all.
    for (const write of sent().slice(1)) {
      expect(write.expectedDraftGeneration).toBeLessThan(4);
    }
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Theirs");
    expect(saveStatus()).toBe("Out of date");
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();
    expect(screen.getAllByDisplayValue("Value 2").length).toBeGreaterThan(0);
  });

  it("mirror: with no outside change the second edit goes at generation 2", async () => {
    await firstWriteLanded();
    holdDebounce();
    typeInCard(0, "Value 2");
    await releaseDebounce();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
  });

  it("refuses a second edit queued behind the unanswered first once an outside change is read, and ignores the late answer", async () => {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await readWhileOut();
    await expectAdopted();
    await waitForPresentationReady();
    typeInCard(0, "Value 2");
    await pause();
    expect(sent()).toHaveLength(1);

    // The first write landed (generation 2), someone else wrote on top of
    // it, and the editor reads that before the first answer arrives.
    await outsideWriteRead((route) => {
      route.props = { heading: "Theirs" };
      route.generation = 5;
    });
    // The first write's answer, late: the document as it left it, at 2.
    await act(async () => {
      first.release({
        success: true,
        message: "ok",
        data: {
          draftGeneration: 2,
          droppedProps: [],
          document: {
            version: 1,
            sections: [
              {
                id: SLOT,
                type: "AboutCard",
                enabled: true,
                props: { heading: "Value 1" },
              },
            ],
          },
        },
      });
    });
    await pause();

    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Theirs");
    expect(server.route!.generation).toBe(5);
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getAllByDisplayValue("Value 2").length).toBeGreaterThan(0);
  });
});

describe("G2: a result that is not known", () => {
  it("G2a: holds the second edit, queued under the real id, when the first write gets no answer", async () => {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await readWhileOut();
    await expectAdopted();
    await waitForPresentationReady();
    typeInCard(0, "Value 2");
    await pause();
    expect(sent()).toHaveLength(1);

    // No answer: the write may have landed.
    await act(async () => {
      first.lose();
    });
    await pause(1_500);

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(saveStatus()).toBe("Save failed");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getAllByDisplayValue("Value 2").length).toBeGreaterThan(0);
    // Nothing goes again on its own.
    await pause(1_500);
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("G2c: the first write onto the created document, with no answer and not landed, is resent at the generation it was sent at", async () => {
    // H2 at shell level: the write composed with no copy held is sent at the
    // generation the queue resolved for the created document. That sent
    // generation, frozen with it, is what Try again sends again.
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await act(async () => {
      first.lose();
    });
    await pause();
    expect(saveStatus()).toBe("Save failed");
    expect(
      document
        .querySelector("[data-editor-unconfirmed-saves]")
        ?.getAttribute("data-editor-unconfirmed-saves"),
      "held as unconfirmed, frozen as sent",
    ).toBe("1");
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 1" },
    });
    // Not landed: the created document is still at generation 1. Its slot
    // section is read back present but without the value, so the read-back
    // decides by generation (with no section at all it is taken as moved,
    // the safe side, and nothing would show which generation was frozen).
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
      expectedSourceGeneration: sent()[0]!.expectedSourceGeneration,
      props: { heading: "Value 1" },
    });
    expect(storedHeading()).toBe("Value 1");
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    // The read-back judged it by the generation it was sent at: not landed,
    // so nothing was taken as moved or out of date.
    expect(
      vi.mocked(toast.error).mock.calls.map((call) => String(call[0])),
    ).not.toContainEqual(expect.stringContaining("changed elsewhere"));
    expect(saveStatus()).not.toBe("Out of date");
    expect(
      screen.queryByRole("button", { name: "Load latest, keep mine" }),
    ).toBeNull();
    expect(
      document.querySelector("[data-editor-unconfirmed-saves]"),
    ).toBeNull();
  });

  it("G2d: the first write onto the created document, read back with no section yet at the generation it was sent at, is resent once, never claimed as not sent", async () => {
    // Round 3 R3-1(b): on a document this editor created, still at the
    // generation the write was sent at, a section not there yet is the
    // write not landed (it would have added it). Resent once, as first
    // sent; the author is never told it was not sent when it was.
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await act(async () => {
      first.lose();
    });
    await pause();
    expect(saveStatus()).toBe("Save failed");
    expect(server.route).toEqual({ generation: 1, props: null });

    const readsBefore = getThemeEditor.mock.calls.length;
    pressTryAgain();
    await waitFor(() =>
      expect(getThemeEditor.mock.calls.length).toBeGreaterThan(readsBefore),
    );
    await pause();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 1" },
    });
    expect(storedHeading()).toBe("Value 1");
    const said = vi
      .mocked(toast.error)
      .mock.calls.map((call) => String(call[0]));
    expect(said).not.toContainEqual(expect.stringContaining("not sent"));
    expect(said).not.toContainEqual(
      expect.stringContaining("changed elsewhere"),
    );
    expect(saveStatus()).not.toBe("Out of date");
    expect(
      document.querySelector("[data-editor-unconfirmed-saves]"),
    ).toBeNull();
  });

  it("G2b: after a lost ensure answer (the server created the document), nothing continues on its own", async () => {
    ensureRouteTemplate.mockImplementationOnce(async () => {
      // Created, and the answer never arrives.
      if (!server.route) server.route = { generation: 1, props: null };
      throw new Error("Failed to fetch");
    });
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause(1_500);

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(saveStatus()).toBe("Save failed");
    expect(screen.getAllByDisplayValue("Value 1").length).toBeGreaterThan(0);
    await pause(1_500);
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(server.route).toEqual({ generation: 1, props: null });
  });
});

describe("G3: row identity on the new document", () => {
  /**
   * Row b's title. Taking up the route document keeps the row element
   * selected, so the Inspector still shows the rows' titles, row b's as
   * saved.
   */
  async function typeInSelectedRow(value: string) {
    expect(cardFields().map((field) => field.value)).toEqual([
      "One",
      "Two edited",
    ]);
    typeInCard(1, value);
  }

  async function firstRowWriteLanded() {
    await openOn(secondRowReport);
    await type("Two", "Two edited");
    await pause();
    expect(sent()).toHaveLength(1);
    // The rows' ids are the ones the first write gave them; the server
    // stored them and its answer carries them back.
    const [one, two] = sent()[0]!.props.items as Array<{ id: string }>;
    expect(typeof one?.id).toBe("string");
    expect(typeof two?.id).toBe("string");
    expect(
      (server.route!.props!.items as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    ).toEqual([one!.id, two!.id]);
    await expectAdopted();
    return { one: one!, two: two! };
  }

  it("refuses an edit to row b when the rows are read back reordered before it leaves", async () => {
    await firstRowWriteLanded();
    holdDebounce();
    await typeInSelectedRow("Two again");
    await outsideWriteRead((route) => {
      const items = route.props!.items as unknown[];
      route.props = { ...route.props, items: [items[1], items[0]] };
      route.generation = 3;
    });
    await releaseDebounce();

    expect(sent()).toHaveLength(1);
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getAllByDisplayValue("Two again").length).toBeGreaterThan(0);
  });

  it("mirror: with the rows unchanged the edit goes to row b, by the answered ids", async () => {
    const { one, two } = await firstRowWriteLanded();
    holdDebounce();
    await typeInSelectedRow("Two again");
    await releaseDebounce();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
    });
    expect(rowsOf(sent()[1]!)).toEqual([
      [one.id, "One"],
      [two.id, "Two again"],
    ]);
  });
});

describe("the pre-step flush across the placeholder and the real id", () => {
  it("does not flush placeholder-keyed content across route adoption before a fresh preview proof", async () => {
    await openOn(headingReport);
    holdReads();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await waitForPresentationReady();
    // Typed while the page is still on the placeholder: kept under it. Its
    // debounce never runs here; only the flush can send it.
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
    holdDebounce();
    typeInCard(0, "Value 2");
    vi.useRealTimers();
    // A read arrives while the first write is out (see `readWhileOut`).
    act(() => {
      void client.invalidateQueries({ queryKey: detailQuery().queryKey });
    });
    await releaseReads();
    await expectAdopted();
    await waitForPresentationReady();

    fireEvent.click(screen.getByRole("button", { name: "Rename the card" }));
    await pause(300);
    // The input was produced while the frame still represented the
    // placeholder document. Route adoption invalidates that presentation
    // proof, so a section action must not flush it under the real id.
    expect(sent()).toHaveLength(1);
    expect(renameSection).not.toHaveBeenCalled();
    await act(async () => {
      first.release();
    });
    await waitFor(() => expect(renameOutcome.settled).toBeDefined());

    expect(renameOutcome.settled).toEqual({
      ok: false,
      message: PREVIEW_PRESENTATION_SYNCING_MESSAGE,
    });
    expect(sent()).toHaveLength(1);
    expect(renameSection).not.toHaveBeenCalled();
    expect(storedHeading()).toBe("Value 1");
    expect(cardFields()[0]?.value).toBe("Value 2");
    await pause();
    // Neither the released answer nor the preview becoming ready retries the
    // stale input on the author's behalf.
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");
  });

  /** The first write, under the placeholder, is refused or fails. */
  async function firstWriteNotStored(answer: "conflict" | "failure") {
    updateSectionProps.mockImplementationOnce(
      async ({ data }: { data: WriteRequest }) => {
        if (answer === "failure") {
          return {
            success: false,
            error: "SECTION_WRITE_FAILED",
            message: "Could not save the section.",
          };
        }
        // Someone else wrote the new document first.
        const route = server.route!;
        route.props = { heading: "Theirs" };
        route.generation = 3;
        return applyWrite(data);
      },
    );
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ expectedDraftGeneration: 1 });
    await expectAdopted();
  }

  it("does not send placeholder-keyed content that was refused, and the step stops", async () => {
    await firstWriteNotStored("conflict");
    expect(saveStatus()).toBe("Out of date");

    fireEvent.click(screen.getByRole("button", { name: "Rename the card" }));
    await waitFor(() => expect(renameOutcome.settled).toBeDefined());
    await pause();

    expect(renameOutcome.settled?.ok).toBe(false);
    expect(renameOutcome.settled?.message).toBe(
      heldContentMessage({ hasListConflict: false }),
    );
    expect(sent()).toHaveLength(1);
    expect(renameSection).not.toHaveBeenCalled();
    expect(storedHeading()).toBe("Theirs");
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();
  });

  it("does not send placeholder-keyed content whose save failed, and the step stops", async () => {
    await firstWriteNotStored("failure");

    fireEvent.click(screen.getByRole("button", { name: "Rename the card" }));
    await waitFor(() => expect(renameOutcome.settled).toBeDefined());
    await pause();

    expect(renameOutcome.settled).toEqual({
      ok: false,
      message: "Content changed while saving. Retry before continuing.",
    });
    expect(sent()).toHaveLength(1);
    expect(renameSection).not.toHaveBeenCalled();
  });

  it("Keep mine on a placeholder-keyed conflict reads the real document and sends once at its generation", async () => {
    await firstWriteNotStored("conflict");
    expect(saveStatus()).toBe("Out of date");

    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      sectionId: SLOT,
      expectedDraftGeneration: 3,
      props: { heading: "Value 1" },
    });
    expect(storedHeading()).toBe("Value 1");
    await waitFor(() => expect(saveStatus()).toBe("Unpublished"));
  });
});

describe("A: the pre-step flush holds refused and failed content under every id", () => {
  describe("the step asks by the real id (the page is on the real document)", () => {
    it("refused, placeholder-keyed: nothing is sent, the step stops; Keep mine sends once, then the step runs", async () => {
      answerNextWrite("conflict");
      await openOn(headingReport);
      await type("Default heading", "Value 1");
      await pause();
      await expectAdopted();
      expect(saveStatus()).toBe("Out of date");
      expect(storedHeading()).toBe("Theirs");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: CONFLICT_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Theirs");
      expect(server.route!.generation).toBe(3);

      pressKeepMine();
      await pause();
      if (sent().length === 1) {
        await waitForPresentationReady();
        pressKeepMine();
      }
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
        props: { heading: "Value 1" },
      });
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
      expect(storedHeading()).toBe("Value 1");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 4,
      });
      expect(sent()).toHaveLength(2);
    });

    it("refused, real-keyed: nothing is sent, the step stops; Keep mine sends once, then the step runs", async () => {
      await realKeyedRefused();
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: CONFLICT_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Theirs");
      expect(screen.getAllByDisplayValue("Value 2").length).toBeGreaterThan(0);

      await confirmKeepMine();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 4,
        props: { heading: "Value 2" },
      });
      expect(storedHeading()).toBe("Value 2");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 5,
      });
    });

    it("failed, placeholder-keyed: nothing is sent, the step stops; Try again sends once, then the step runs", async () => {
      answerNextWrite("failure");
      await openOn(headingReport);
      await type("Default heading", "Value 1");
      await pause();
      await expectAdopted();
      expect(saveStatus()).toBe("Save failed");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: FAILED_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(server.route).toEqual({ generation: 1, props: null });

      pressTryAgain();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 1,
        props: { heading: "Value 1" },
      });
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
      expect(storedHeading()).toBe("Value 1");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
      });
    });

    it("failed, real-keyed: nothing is sent, the step stops; Try again sends once, then the step runs", async () => {
      await firstWriteLanded();
      answerNextWrite("failure");
      typeInCard(0, "Value 2");
      await pause();
      expect(sent()).toHaveLength(2);
      expect(saveStatus()).toBe("Save failed");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: FAILED_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Value 1");
      expect(screen.getAllByDisplayValue("Value 2").length).toBeGreaterThan(0);

      pressTryAgain();
      await waitFor(() => expect(sent()).toHaveLength(3));
      await pause();
      expect(sent()).toHaveLength(3);
      expect(sent()[2]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
        props: { heading: "Value 2" },
      });
      expect(storedHeading()).toBe("Value 2");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
      });
    });

    it("failed with no answer, real-keyed: a not-landed write is resent once before the step proceeds", async () => {
      await firstWriteLanded();
      const second = holdNextWrite();
      typeInCard(0, "Value 2");
      await waitFor(() => expect(sent()).toHaveLength(2));
      await act(async () => {
        second.lose();
      });
      await pause();
      expect(saveStatus()).toBe("Save failed");
      const before = calls();

      expect(await rename()).toEqual({
        ok: false,
        message: UNCONFIRMED_SAVE_HOLD,
      });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Value 1");

      const readsBefore = getThemeEditor.mock.calls.length;
      pressTryAgain();
      await waitFor(() =>
        expect(getThemeEditor.mock.calls.length).toBeGreaterThan(readsBefore),
      );
      await pause();
      // Same-generation readback proves it had not landed at that instant;
      // retry sends the exact frozen payload once, at the original basis.
      expect(sent()).toHaveLength(3);
      expect(sent()[2]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
        props: { heading: "Value 2" },
      });
      expect(storedHeading()).toBe("Value 2");
      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
      });
    });
  });

  describe("the step asks by the placeholder (the page is still bound to it)", () => {
    it("refused, before adoption: nothing is sent, the step stops; Keep mine sends once, then the step runs", async () => {
      await openOn(headingReport);
      holdReads();
      answerNextWrite("conflict");
      await type("Default heading", "Value 1");
      await pause();
      // The read after ensure is held: the page is still on the placeholder.
      expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
      expect(saveStatus()).toBe("Out of date");
      expect(storedHeading()).toBe("Theirs");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: CONFLICT_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Theirs");
      expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);

      pressKeepMine();
      await releaseReads();
      await expectAdopted();
      await waitForPresentationReady();
      // The readback moved the page to a newer Document. Keep mine rebases
      // the draft, then waits until that Document is presented before the
      // author confirms the write again.
      if (sent().length === 1) pressKeepMine();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
        props: { heading: "Value 1" },
      });
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
      expect(storedHeading()).toBe("Value 1");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 4,
      });
    });

    it("failed, before adoption: nothing is sent, the step stops; Try again sends once, then the step runs", async () => {
      await openOn(headingReport);
      holdReads();
      answerNextWrite("failure");
      await type("Default heading", "Value 1");
      await pause();
      expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
      expect(saveStatus()).toBe("Save failed");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: FAILED_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(server.route).toEqual({ generation: 1, props: null });

      pressTryAgain();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 1,
        props: { heading: "Value 1" },
      });
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
      expect(storedHeading()).toBe("Value 1");

      await releaseReads();
      await expectAdopted();
      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
      });
    });

    // Stage 1 of "refuse a write with no version basis": after a lost ensure
    // answer, the next ensure finds the document existing, so this editor
    // cannot prove it created it, and generation 1 alone is no proof. Try
    // again no longer sends at generation 1: it is refused before sending,
    // kept, and "Load latest, keep mine" sends it once. (Before, Try again
    // sent it at generation 1 with no basis.)
    it("failed after a lost ensure answer (no mapping): nothing is sent or ensured, the step stops; Try again refuses for want of a basis, Keep mine sends once, then the step runs", async () => {
      loseNextEnsureAnswer();
      await openOn(headingReport);
      await type("Default heading", "Value 1");
      await pause(1_500);
      expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
      expect(saveStatus()).toBe("Save failed");
      const before = calls();
      expect(before).toMatchObject({ ensure: 1, props: 0 });

      expect(await rename()).toEqual({ ok: false, message: FAILED_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(server.route).toEqual({ generation: 1, props: null });

      pressTryAgain();
      await waitFor(() => expect(saveStatus()).toBe("Out of date"));
      await pause();
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);
      expect(updateSectionProps).not.toHaveBeenCalled();
      expect(server.route).toEqual({ generation: 1, props: null });

      await confirmKeepMine();
      await waitFor(() => expect(sent()).toHaveLength(1));
      await pause();
      expect(sent()).toHaveLength(1);
      expect(sent()[0]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 1,
        props: { heading: "Value 1" },
      });
      expect(storedHeading()).toBe("Value 1");

      await expectAdopted();
      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
      });
    });
  });
});
