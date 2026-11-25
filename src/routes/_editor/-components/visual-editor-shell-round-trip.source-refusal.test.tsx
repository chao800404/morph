/**
 * Source refusal recovery, Style history writes and refusals, and the Style replay read-back confirmation.
 *
 * One of the files the former `visual-editor-shell-round-trip.test.tsx` was split into so
 * the test shards can spread it; the shared setup is in `visual-editor-shell-round-trip.harness.tsx`.
 */
import {
  STYLE_AFTER,
  STYLE_REMOTE,
  STYLE_SOURCE,
  UNANSWERED_SOURCE_MOVED,
  applyStylePatch,
  captureCodeFileSave,
  context,
  controlledThemeFile,
  editorHolding,
  flushFrames,
  fromPreview,
  getThemeEditor,
  liveFrame,
  localThemeFile,
  messagesOfType,
  posted,
  readyQueryClient,
  renderShellWithHero,
  saveStatus,
  selectHeading,
  stylePatchTarget,
  themeFileQueueControl,
  updateSectionProps,
} from "./visual-editor-shell-round-trip.harness";
import { reloadFrameDocument } from "@/lib/test-utils/preview-frame-handshake";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StorefrontThemeEditorDTO,
} from "@/lib/storefront/dto/storefront-theme.dto";
import {
  useThemeWorkspaceStore,
} from "@/lib/storefront/store/theme-workspace-store";
import {
  useEditorWriteGateStore,
} from "@/lib/storefront/store/editor-write-gate-store";
import {
  storefrontThemeFileQueries,
} from "../-queries/storefront-theme-files.queries";

/**
 * Diagnostic contract only: reselecting does not confirm retained input.
 * New input confirms that field, not every pending prop in its section.
 * These are ordinary assertions, never expected failures; do not ship red.
 */
describe("source refusal recovery contract", () => {
  const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
  const message =
    "The source code has changed. Select the field again. Your changes are kept.";
  const source = `export const contentFields = {
    heading: { type: "text", label: "Heading" },
    subheading: { type: "text", label: "Subheading" }
  };
  export function Hero({ heading = "Welcome", subheading = "Summary" }) {
    return <section><h1>{heading}</h1><p>{subheading}</p></section>;
  }`;
  const editorContext: StorefrontThemeEditorDTO = {
    ...context,
    templates: [
      {
        ...context.templates[0]!,
        document: {
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              enabled: true,
              props: { heading: "Welcome", subheading: "Summary" },
            },
          ],
        },
      },
    ],
  };
  const refused = {
    success: false,
    error: "SELECTION_SOURCE_CONFLICT",
    message,
  };
  const request = (index: number) =>
    updateSectionProps.mock.calls[index]![0].data as {
      expectedSourceGeneration: number;
      props: Record<string, unknown>;
    };
  let canvasRevision = 0;

  // Only the save debounce (a 300 ms `setTimeout`) is faked. It runs on its own
  // here, so `waitFor` and the debounce behave as they do with a real clock,
  // but every timer stays under the test's control: see `afterEach`, and
  // `holdSaveDebounce` for the tests that decide when a save leaves.
  const FAKED: { toFake: Array<"setTimeout" | "clearTimeout"> } = {
    toFake: ["setTimeout", "clearTimeout"],
  };

  beforeEach(() => {
    vi.useFakeTimers({ ...FAKED, shouldAdvanceTime: true });
    canvasRevision = 0;
    useThemeWorkspaceStore.setState({ workspaces: {} });
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
    updateSectionProps.mockImplementation(async ({ data }) =>
      data.expectedSourceGeneration === 2
        ? { success: true, data: { draftGeneration: 2, droppedProps: [] } }
        : refused,
    );
  });

  // A debounced save outlives an unmount: the shell does not cancel its timer.
  // So each test ends by unmounting, letting every reply it was sent settle,
  // and proving no save is still waiting to leave; the clock is restored in
  // `finally`, so a test that fails midway cannot send a save into the next
  // test's mock either.
  afterEach(async () => {
    try {
      cleanup();
      await act(async () => {
        await Promise.allSettled(
          updateSectionProps.mock.results.map((result) => result.value),
        );
      });
      const sent = updateSectionProps.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(
        updateSectionProps,
        "no save may leave after the editor is gone",
      ).toHaveBeenCalledTimes(sent);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  /** From here on, a debounced save leaves only on `releaseSaveDebounce`. */
  function holdSaveDebounce() {
    vi.useFakeTimers(FAKED);
  }

  async function releaseSaveDebounce() {
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
  }

  async function openFields() {
    renderShellWithHero(source, "hero", editorContext);
    await selectHeading();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await screen.findByDisplayValue("Welcome");
  }

  function input(value: string, next: string) {
    const field = screen.getByDisplayValue(value);
    fireEvent.input(field, { target: { value: next } });
    fireEvent.blur(field);
  }

  async function reselect(field: "heading" | "subheading" = "heading") {
    const revision =
      Math.max(
        canvasRevision,
        ...posted.map((m) =>
          typeof m.selectionRevision === "number" ? m.selectionRevision : 0,
        ),
      ) + 1;
    canvasRevision = revision;
    fromPreview({
      type: "morph:storefront-preview-select-section",
      sectionId: "hero",
      componentType: "hero",
      kind: "heading",
      nodeId: `hero:node:${field}`,
      sourceFilePath: "src/components/Hero.tsx",
      sourceLocation: null,
      elementKey: field,
      fieldKey: field,
      field,
      fieldPath: field,
      descendantFields: [],
      tagName: field === "heading" ? "h1" : "p",
      role: null,
      inputType: null,
      styleRevision: Math.max(
        0,
        ...posted.map((m) =>
          typeof m.styleRevision === "number" ? m.styleRevision : 0,
        ),
      ),
      className: "",
      isSection: false,
      inspectorOverride: null,
      computedStyle: null,
      parentComputedStyle: null,
      sectionComputedStyle: null,
      selectionRevision: revision,
    });
    await flushFrames();
  }

  async function refuseHeading() {
    await openFields();
    // The server has moved but this tab has not observed it yet: the first
    // refusal is genuine. Once observed, old fields must be held client-side.
    input("Welcome", "Kept old heading");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(request(0).expectedSourceGeneration).toBe(1);
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );
    expect(screen.getByDisplayValue("Kept old heading")).toBeTruthy();
  }

  it("saves new input at a fresh selection when no older edit is pending", async () => {
    await openFields();
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );
    await reselect();
    input("Welcome", "Fresh heading");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(request(0).expectedSourceGeneration).toBe(2);
    // Stored content is still unpublished; assert saving, not publishing.
    await waitFor(() =>
      expect(
        document
          .querySelector("[data-editor-save-status]")
          ?.getAttribute("data-save-state"),
      ).toBe("saved"),
    );
  });

  it("recovers at an observed, preview-confirmed generation without accepting it for Code", async () => {
    const client = readyQueryClient();
    renderShellWithHero(source, "hero", editorContext, client);
    await selectHeading();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await screen.findByDisplayValue("Welcome");
    input("Welcome", "Kept old heading");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    const query = storefrontThemeFileQueries.tree(
      scope.storefrontId,
      scope.themeId,
    );
    const tree = client.getQueryData(query.queryKey)!;
    act(() =>
      client.setQueryData(query.queryKey, {
        ...tree,
        sourceGeneration: 2,
        files: tree.files.map((file) => ({
          ...file,
          content: `${source}\n// external source update`,
          version: 2,
        })),
      }),
    );
    await waitFor(() =>
      expect(
        useThemeWorkspaceStore.getState().getObservedSourceGeneration(scope),
      ).toBe(2),
    );
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(1);
    await reselect();
    input("Kept old heading", "Awaiting source confirmation");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    // The new frame's existing full-source handshake confirms the snapshot.
    // This controlled bridge event is not a browser/HMR acceptance test.
    getThemeEditor.mockResolvedValueOnce(
      editorHolding({ heading: "Welcome", subheading: "Summary" }, 1),
    );
    reloadFrameDocument();
    liveFrame.ready();
    await waitFor(() =>
      expect(
        messagesOfType("morph:storefront-preview-update-theme-files").length,
      ).toBeGreaterThan(0),
    );
    const revision = Math.max(
      ...posted.map((m) =>
        typeof m.styleRevision === "number" ? m.styleRevision : 0,
      ),
    );
    fromPreview({
      type: "morph:storefront-preview-theme-files-applied",
      styleRevision: revision,
    });
    await flushFrames();
    await reselect();
    input("Awaiting source confirmation", "Confirmed new heading");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(request(1).expectedSourceGeneration).toBe(2);
    expect(request(1).props).toEqual({ heading: "Confirmed new heading" });
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(1);
  });

  it("recovers a refused field only after reselection and new input in that field", async () => {
    await refuseHeading();
    await reselect();
    input("Kept old heading", "Confirmed new heading");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(request(1).expectedSourceGeneration).toBe(2);
    expect(request(1).props.heading).toBe("Confirmed new heading");
    await waitFor(() =>
      expect(
        document
          .querySelector("[data-editor-save-status]")
          ?.getAttribute("data-save-state"),
      ).toBe("saved"),
    );
  });

  // Two refused fields reach the server in either of two legal orders: both
  // typed before the debounce ends (one request), or the heading leaving
  // before the subheading is typed (two requests). Each order is driven
  // explicitly; in both, each field keeps the generation it was typed under
  // and only the field confirmed by new input takes the newer one.

  /** After both fields were refused: confirm the heading only. */
  async function confirmHeadingOnly(requestsSoFar: number) {
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );
    await reselect();
    await screen.findByDisplayValue("Kept old heading");
    input("Kept old heading", "Confirmed new heading");
    await releaseSaveDebounce();
    await waitFor(() =>
      expect(updateSectionProps).toHaveBeenCalledTimes(requestsSoFar + 1),
    );
    const confirmed = request(requestsSoFar);
    expect(confirmed.expectedSourceGeneration).toBe(2);
    expect(confirmed.props).toEqual({ heading: "Confirmed new heading" });
    // The subheading was not confirmed: it is still here, unsent.
    await reselect("subheading");
    expect(screen.getByDisplayValue("Kept old subheading")).toBeTruthy();
    await releaseSaveDebounce();
    expect(updateSectionProps).toHaveBeenCalledTimes(requestsSoFar + 1);
    expect(saveStatus()).not.toBe("Saved");
  }

  it.each([
    ["refused", () => refused],
    [
      "saved",
      () => ({
        success: true,
        data: { draftGeneration: 2, droppedProps: [] },
      }),
    ],
  ])(
    "a reply (%s) that arrives after the editor is gone sends nothing more",
    async (_kind, answer) => {
      holdSaveDebounce();
      let deliver!: (value: unknown) => void;
      updateSectionProps.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            deliver = resolve;
          }),
      );
      await openFields();
      act(() =>
        useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
      );
      await reselect();
      input("Welcome", "In flight");
      await releaseSaveDebounce();
      await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
      expect(request(0).props).toEqual({ heading: "In flight" });
      // The editor goes while the request is still unanswered.
      cleanup();
      await act(async () => {
        deliver(answer());
      });
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(updateSectionProps).toHaveBeenCalledTimes(1);
    },
  );

  it("two fields typed inside one debounce leave together, refused at their own generation; confirming one sends only it", async () => {
    holdSaveDebounce();
    await openFields();
    input("Welcome", "Kept old heading");
    await reselect("subheading");
    await screen.findByDisplayValue("Summary");
    input("Summary", "Kept old subheading");
    // Nothing has left yet: both edits are inside the same debounce.
    expect(updateSectionProps).not.toHaveBeenCalled();
    await releaseSaveDebounce();
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    expect(request(0).expectedSourceGeneration).toBe(1);
    expect(request(0).props).toEqual({
      heading: "Kept old heading",
      subheading: "Kept old subheading",
    });
    await confirmHeadingOnly(1);
  });

  it("a heading that left before the subheading was typed is refused on its own; each field keeps its own generation", async () => {
    holdSaveDebounce();
    await openFields();
    input("Welcome", "Kept old heading");
    await releaseSaveDebounce();
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    expect(request(0).expectedSourceGeneration).toBe(1);
    expect(request(0).props).toEqual({ heading: "Kept old heading" });
    await reselect("subheading");
    await screen.findByDisplayValue("Summary");
    input("Summary", "Kept old subheading");
    await releaseSaveDebounce();
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    // The refused heading does not ride along with the subheading.
    expect(request(1).expectedSourceGeneration).toBe(1);
    expect(request(1).props).toEqual({ subheading: "Kept old subheading" });
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    await confirmHeadingOnly(2);
  });

  it("new input in another field does not confirm a previously refused heading", async () => {
    await refuseHeading();
    await reselect("subheading");
    await screen.findByDisplayValue("Summary");
    input("Summary", "Confirmed new subheading");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(request(1).props).toEqual({
      subheading: "Confirmed new subheading",
    });
    expect(request(1).expectedSourceGeneration).toBe(2);
    await reselect();
    expect(screen.getByDisplayValue("Kept old heading")).toBeTruthy();
    expect(saveStatus()).not.toBe("Saved");
  });

  it("reselection alone or Retry never upgrades a refused payload baseline", async () => {
    await refuseHeading();
    await reselect();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    // New policy: retry is not confirmation, so no stale resend at all.
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(request(0).expectedSourceGeneration).toBe(1);
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    expect(screen.getByDisplayValue("Kept old heading")).toBeTruthy();
  });

  it("reads back an unanswered write first and never upgrades or resends its stale baseline", async () => {
    let answer!: (value: unknown) => void;
    updateSectionProps.mockRejectedValueOnce(new Error("offline"));
    getThemeEditor.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await openFields();
    input("Welcome", "Unanswered heading");
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    expect(request(0).expectedSourceGeneration).toBe(1);
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );
    await reselect();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getThemeEditor).toHaveBeenCalled());
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    act(() =>
      answer(editorHolding({ heading: "Welcome", subheading: "Summary" })),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(updateSectionProps.mock.invocationCallOrder[0]!).toBeLessThan(
      getThemeEditor.mock.invocationCallOrder[0]!,
    );
    expect(request(0).expectedSourceGeneration).toBe(1);
    expect(screen.getByDisplayValue("Unanswered heading")).toBeTruthy();
  });

  it("releases an unanswered write when the source moved, sends nothing, and saves once the field is reselected and edited", async () => {
    // Round 3 R3-2: the source moved after the unanswered write was sent
    // (here, as when held Theme files are saved before content). Try again
    // reads it back not landed, sends nothing at the old source, releases
    // the hold and keeps the input pending for reselection, as a first
    // send refused by the source is. Not out of date: "Load latest, keep
    // mine" could not save it. The way out is the reselect one.
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockRejectedValueOnce(new Error("offline"));
    getThemeEditor.mockResolvedValue(
      editorHolding({ heading: "Welcome", subheading: "Summary" }, 1),
    );
    await openFields();
    input("Welcome", "Unanswered heading");
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    expect(request(0).expectedSourceGeneration).toBe(1);
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getThemeEditor).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(
      updateSectionProps,
      "nothing sent at the old source",
    ).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector("[data-editor-unconfirmed-saves]"),
      "the hold is released",
    ).toBeNull();
    const said = error.mock.calls.map((call) => String(call[0]));
    expect(said).toContain(UNANSWERED_SOURCE_MOVED);
    expect(saveStatus()).not.toBe("Out of date");
    expect(
      screen.queryByRole("button", { name: "Load latest, keep mine" }),
    ).toBeNull();
    expect(screen.getByDisplayValue("Unanswered heading")).toBeTruthy();

    // The author's way out: reselect the field and make the change again.
    await reselect();
    input("Unanswered heading", "Confirmed heading");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(request(1).expectedSourceGeneration).toBe(2);
    expect(request(1).props).toEqual({ heading: "Confirmed heading" });
    await waitFor(() =>
      expect(
        document
          .querySelector("[data-editor-save-status]")
          ?.getAttribute("data-save-state"),
      ).toBe("saved"),
    );
  });

  it("uses a preview-confirmed source even if Code has not accepted it", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    renderShellWithHero(source, "hero", editorContext);
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await screen.findByDisplayValue("Welcome");
    // The preview has confirmed the current Theme source even though this
    // workspace still has no accepted source generation.
    act(() =>
      useThemeWorkspaceStore.getState().setBaseSourceGeneration(0, scope),
    );
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(0);
    await reselect();
    input("Welcome", "No baseline heading");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(request(0).expectedSourceGeneration).toBe(1);
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(message, {
        id: "selection-source-conflict",
      }),
    );
    expect(screen.getByDisplayValue("No baseline heading")).toBeTruthy();
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(0);
  });

  it("keeps an old undo record blocked even after the field is freshly selected", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 2, droppedProps: [] },
    });
    await openFields();
    input("Welcome", "Saved heading");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );
    await reselect();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(`Could not undo: ${message}`),
    );
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("does not upgrade an old redo record when the field is freshly selected", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 2, droppedProps: [] },
    });
    await openFields();
    input("Welcome", "Saved heading");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    // #388 round 5: the Undo now waits for its own write's answer before the
    // history moves (before, it moved at once, the write still out). That
    // write is composed on a read of the Document, which the answer above
    // (no document in it) leaves this editor needing, and which this harness
    // never answered, so the Undo stayed out and Redo never came. The read
    // is answered here as the server would: the saved heading, at draft 2.
    getThemeEditor.mockResolvedValue(
      editorHolding({ heading: "Saved heading", subheading: "Summary" }, 2),
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    // A replay keeps the source generation it was recorded at (round 5: it no
    // longer debounces like ordinary content). It must never borrow gen2.
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );
    await reselect();
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(`Could not redo: ${message}`),
    );
    expect(
      screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(
      updateSectionProps.mock.calls.every(
        (call) => call[0].data.expectedSourceGeneration === 1,
      ),
    ).toBe(true);
  });
});

describe("Style history writes and refusals", () => {
  const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

  beforeEach(() => {
    useThemeWorkspaceStore.setState({ workspaces: {} });
    stylePatchTarget.filePath = "src/components/Hero.tsx";
    stylePatchTarget.elementName = "section";
  });

  async function applyAndSaveStyle(server: ReturnType<typeof controlledThemeFile>) {
    renderShellWithHero(STYLE_SOURCE);
    applyStylePatch();
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(localThemeFile()?.saveState).toBe("clean"));
  }

  const historyState = () => ({
    undoAvailable: !screen
      .getByRole("button", { name: "Undo" })
      .hasAttribute("disabled"),
    redoAvailable: !screen
      .getByRole("button", { name: "Redo" })
      .hasAttribute("disabled"),
  });

  async function confirmPausedWriteResume() {
    const gate = useEditorWriteGateStore.getState();
    const epoch = gate.beginVerification(scope);
    if (epoch === null) throw new Error("Expected a paused write gate");
    gate.finishVerification(scope, epoch, "verified");
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Save my changes" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save my changes" }));
  }

  it("records one undo only after a paused Style write lands", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    useEditorWriteGateStore
      .getState()
      .pause(scope, "ACCESS_DENIED", "theme");
    renderShellWithHero(STYLE_SOURCE);

    applyStylePatch();
    await waitFor(() => expect(localThemeFile()?.authPaused).toBe(true));
    expect(historyState()).toEqual({ undoAvailable: false, redoAvailable: false });

    await confirmPausedWriteResume();
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(localThemeFile()?.saveState).toBe("clean"));

    expect(server.file().content).toBe(STYLE_AFTER);
    expect(historyState()).toEqual({ undoAvailable: true, redoAvailable: false });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(server.file().content).toBe(STYLE_SOURCE));
    expect(historyState()).toEqual({ undoAvailable: false, redoAvailable: true });
  });

  it.each(["superseded", "server-refusal"] as const)(
    "does not create paused Style history when resume is %s",
    async (outcome) => {
      const server = controlledThemeFile(STYLE_SOURCE);
      const error = vi.spyOn(toast, "error").mockImplementation(() => "");
      useEditorWriteGateStore
        .getState()
        .pause(scope, "ACCESS_DENIED", "theme");
      renderShellWithHero(STYLE_SOURCE);

      applyStylePatch();
      await waitFor(() => expect(localThemeFile()?.authPaused).toBe(true));
      if (outcome === "superseded") {
        themeFileQueueControl.supersedeNext = true;
      } else {
        server.outcomes.push("server-refusal");
      }

      await confirmPausedWriteResume();
      if (outcome === "superseded") {
        await waitFor(() =>
          expect(themeFileQueueControl.supersededCount).toBe(1),
        );
      } else {
        await waitFor(() => expect(server.save).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(error).toHaveBeenCalled());
      }

      expect(server.file().content).toBe(STYLE_SOURCE);
      expect(historyState()).toEqual({ undoAvailable: false, redoAvailable: false });
    },
  );

  it("keeps a resumed Style write pending until an unanswered save is read back", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    server.outcomes.push("offline-after-landing");
    useEditorWriteGateStore
      .getState()
      .pause(scope, "ACCESS_DENIED", "theme");
    renderShellWithHero(STYLE_SOURCE);

    applyStylePatch();
    await waitFor(() => expect(localThemeFile()?.authPaused).toBe(true));
    expect(historyState()).toEqual({ undoAvailable: false, redoAvailable: false });

    await confirmPausedWriteResume();
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_AFTER),
    );
    expect(server.save).toHaveBeenCalledTimes(1);
    expect(historyState()).toEqual({ undoAvailable: false, redoAvailable: false });

    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
    );
    expect(server.save).toHaveBeenCalledTimes(1);
    expect(historyState()).toEqual({ undoAvailable: true, redoAvailable: false });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(server.file().content).toBe(STYLE_SOURCE));
  });

  it("keeps a landed, unanswered first Style write undoable until read-back", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    server.outcomes.push("offline-after-landing");
    renderShellWithHero(STYLE_SOURCE);

    applyStylePatch();

    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_AFTER),
    );
    const undoWasAvailable = historyState().undoAvailable;
    if (undoWasAvailable) {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
      );
    } else {
      // On the buggy baseline the Style entry has already been discarded.
      // Make an explicit file-save request to prove the existing recovery
      // path still reads the server before deciding whether another write is
      // needed; do not let the missing history hide that independent contract.
      const saveFile = await captureCodeFileSave();
      await act(async () => {
        await saveFile(stylePatchTarget.filePath, STYLE_AFTER, {
          confirmed: true,
        });
      });
      await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
      );
    }

    const sourceUndo = server.events.indexOf("write:" + STYLE_SOURCE);
    const read = server.events.indexOf("read");
    const readBeforeUndoWrite =
      read >= 0 && sourceUndo >= 0 && read < sourceUndo;
    expect({
      undoWasAvailable,
      recoveryReadOccurred: server.read.mock.calls.length === 1,
      unconfirmedCleared: localThemeFile()?.unconfirmedContent === undefined,
      confirmedBeforeUndoWrite: readBeforeUndoWrite,
      finalServerContent: server.file().content,
    }).toEqual({
      undoWasAvailable: true,
      recoveryReadOccurred: true,
      unconfirmedCleared: true,
      confirmedBeforeUndoWrite: true,
      finalServerContent: STYLE_SOURCE,
    });
  });

  it("keeps an ordinary save held while a Style write is unconfirmed", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    server.outcomes.push("offline-after-landing");
    renderShellWithHero(STYLE_SOURCE);

    applyStylePatch();
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_AFTER),
    );
    const saveFile = await captureCodeFileSave();

    await act(async () => {
      await expect(
        saveFile(stylePatchTarget.filePath, STYLE_AFTER),
      ).rejects.toThrow();
    });

    expect({
      reads: server.read.mock.calls.length,
      writes: server.save.mock.calls.length,
      unconfirmed: localThemeFile()?.unconfirmedContent,
      undoAvailable: historyState().undoAvailable,
    }).toEqual({
      reads: 0,
      writes: 1,
      unconfirmed: STYLE_AFTER,
      undoAvailable: true,
    });
  });

  it("turns a changed read-back into a file conflict without sending the replay", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    server.outcomes.push("offline-after-landing");
    renderShellWithHero(STYLE_SOURCE);

    applyStylePatch();
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_AFTER),
    );
    server.externalWrite(STYLE_REMOTE);
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect({
      ...historyState(),
      writeCount: server.save.mock.calls.length,
      serverContent: server.file().content,
      remoteConflict: localThemeFile()?.conflict?.remoteContent,
      unconfirmed: localThemeFile()?.unconfirmedContent,
    }).toEqual({
      undoAvailable: true,
      redoAvailable: false,
      writeCount: 1,
      serverContent: STYLE_REMOTE,
      remoteConflict: STYLE_REMOTE,
      unconfirmed: undefined,
    });
    expect(
      error.mock.calls.some(([message]) =>
        String(message).startsWith("Could not undo:"),
      ),
    ).toBe(true);
  });

  it("refuses recovery when another file advanced the source generation", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    server.outcomes.push("offline");
    renderShellWithHero(STYLE_SOURCE);

    applyStylePatch();
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_AFTER),
    );
    server.externalSourceWrite();
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const snapshotsBeforeRecovery = server.list.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(server.list).toHaveBeenCalledTimes(snapshotsBeforeRecovery + 1),
    );
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect({
      ...historyState(),
      writes: server.save.mock.calls.length,
      sourceConflict: localThemeFile()?.sourceConflict,
      unconfirmed: localThemeFile()?.unconfirmedContent,
      serverContent: server.file().content,
    }).toEqual({
      undoAvailable: true,
      redoAvailable: false,
      writes: 1,
      sourceConflict: true,
      unconfirmed: STYLE_AFTER,
      serverContent: STYLE_SOURCE,
    });
  });

  it("keeps the Style record and sends nothing when recovery read-back fails", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    server.outcomes.push("offline-after-landing");
    renderShellWithHero(STYLE_SOURCE);

    applyStylePatch();
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_AFTER),
    );
    server.list.mockRejectedValueOnce(new Error("Read-back unavailable"));
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const snapshotsBeforeRecovery = server.list.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(server.list).toHaveBeenCalledTimes(snapshotsBeforeRecovery + 1),
    );
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect({
      ...historyState(),
      writeCount: server.save.mock.calls.length,
      unconfirmed: localThemeFile()?.unconfirmedContent,
      conflict: localThemeFile()?.conflict,
    }).toEqual({
      undoAvailable: true,
      redoAvailable: false,
      writeCount: 1,
      unconfirmed: STYLE_AFTER,
      conflict: undefined,
    });
  });

  it.each(["auth-paused", "superseded"] as const)(
    "does not leave an undoable first Style record when %s never lands",
    async (outcome) => {
      const server = controlledThemeFile(STYLE_SOURCE);
      if (outcome === "auth-paused") {
        useEditorWriteGateStore
          .getState()
          .pause(scope, "ACCESS_DENIED", "theme");
      } else {
        themeFileQueueControl.supersedeNext = true;
      }
      renderShellWithHero(STYLE_SOURCE);

      applyStylePatch();

      if (outcome === "auth-paused") {
        await waitFor(() => expect(localThemeFile()?.authPaused).toBe(true));
      } else {
        await waitFor(() =>
          expect(themeFileQueueControl.supersededCount).toBe(1),
        );
        await act(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });
      }

      expect({
        undoAvailable: historyState().undoAvailable,
        localContent: localThemeFile()?.localContent,
        authPaused: localThemeFile()?.authPaused ?? false,
        serverContent: server.file().content,
        serverWriteCount: server.save.mock.calls.length,
      }).toEqual({
        undoAvailable: false,
        localContent: STYLE_AFTER,
        authPaused: outcome === "auth-paused",
        serverContent: STYLE_SOURCE,
        serverWriteCount: 0,
      });
    },
  );

  const styleReplayAttempts = [
    { direction: "undo", outcome: "source-conflict" },
    { direction: "undo", outcome: "auth-paused" },
    { direction: "undo", outcome: "superseded" },
    { direction: "redo", outcome: "source-conflict" },
    { direction: "redo", outcome: "auth-paused" },
    { direction: "redo", outcome: "superseded" },
  ] as const;

  it.each(styleReplayAttempts)(
    "does not advance Style $direction history or hide $outcome refusal",
    async ({ direction, outcome }) => {
      const server = controlledThemeFile(STYLE_SOURCE);
      await applyAndSaveStyle(server);
      if (direction === "redo") {
        fireEvent.click(screen.getByRole("button", { name: "Undo" }));
        await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(historyState().redoAvailable).toBe(true));
        expect(server.file().content).toBe(STYLE_SOURCE);
      }
      const writesBeforeReplay = server.save.mock.calls.length;
      const supersededBeforeReplay = themeFileQueueControl.supersededCount;
      const error = vi.spyOn(toast, "error").mockImplementation(() => "");
      if (outcome === "source-conflict") {
        server.outcomes.push("source-conflict");
      } else if (outcome === "auth-paused") {
        useEditorWriteGateStore
          .getState()
          .pause(scope, "ACCESS_DENIED", "theme");
      } else {
        themeFileQueueControl.supersedeNext = true;
      }

      fireEvent.click(
        screen.getByRole("button", {
          name: direction === "undo" ? "Undo" : "Redo",
        }),
      );

      if (outcome === "source-conflict") {
        await waitFor(() =>
          expect(server.save).toHaveBeenCalledTimes(writesBeforeReplay + 1),
        );
      } else if (outcome === "auth-paused") {
        await waitFor(() => expect(localThemeFile()?.authPaused).toBe(true));
      } else {
        await waitFor(() =>
          expect(themeFileQueueControl.supersededCount).toBe(
            supersededBeforeReplay + 1,
          ),
        );
      }
      await waitFor(() => expect(error).toHaveBeenCalled());

      expect({
        ...historyState(),
        visibleNotice: error.mock.calls.some(([message]) =>
          String(message).startsWith(
            direction === "undo" ? "Could not undo:" : "Could not redo:",
          ),
        ),
      }).toEqual({
        undoAvailable: direction === "undo",
        redoAvailable: direction === "redo",
        visibleNotice: true,
      });
    },
  );

  it("keeps Style Undo history when the replay throws an answered error", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    server.outcomes.push("server-refusal");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(error).toHaveBeenCalled());

    expect(historyState()).toEqual({ undoAvailable: true, redoAvailable: false });
    expect(localThemeFile()?.unconfirmedContent).toBeUndefined();
  });
});

describe("Style replay read-back confirmation", () => {
  beforeEach(() => {
    useThemeWorkspaceStore.setState({ workspaces: {} });
    stylePatchTarget.filePath = "src/components/Hero.tsx";
    stylePatchTarget.elementName = "section";
  });

  async function applyAndSaveStyle(server: ReturnType<typeof controlledThemeFile>) {
    renderShellWithHero(STYLE_SOURCE);
    applyStylePatch();
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(localThemeFile()?.saveState).toBe("clean"));
  }

  const historyState = () => ({
    undoAvailable: !screen
      .getByRole("button", { name: "Undo" })
      .hasAttribute("disabled"),
    redoAvailable: !screen
      .getByRole("button", { name: "Redo" })
      .hasAttribute("disabled"),
  });

  it("confirms an unanswered landed Style Undo once, then starts a fresh Redo", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    server.outcomes.push("offline-after-landing");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    expect(historyState()).toEqual({ undoAvailable: true, redoAvailable: false });

    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
    );

    const undoWrite = server.save.mock.calls[1]?.[0] as
      | { data?: { writeAttemptId?: string } }
      | undefined;
    expect(undoWrite?.data?.writeAttemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(server.file().lastWriteAttemptId).toBe(
      undoWrite?.data?.writeAttemptId,
    );
    expect({
      history: historyState(),
      writes: server.save.mock.calls.length,
      serverContent: server.file().content,
    }).toEqual({
      history: { undoAvailable: false, redoAvailable: true },
      writes: 2,
      serverContent: STYLE_SOURCE,
    });

    // The next run is a new Redo; it must not replay either old Undo attempt.
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(server.file().content).toBe(STYLE_AFTER));
    expect(historyState()).toEqual({ undoAvailable: true, redoAvailable: false });
  });

  it("hides Check and save while confirming an unanswered Style Undo", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    server.outcomes.push("offline-after-landing");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );

    const releaseRead = server.holdNextRead();
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    try {
      await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
      expect(
        screen.queryByRole("button", { name: "Check and save" }),
      ).toBeNull();
    } finally {
      releaseRead();
    }

    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
    );
    await waitFor(() =>
      expect(historyState()).toEqual({
        undoAvailable: false,
        redoAvailable: true,
      }),
    );
    expect(server.read).toHaveBeenCalledTimes(1);
    expect(server.save).toHaveBeenCalledTimes(2);
    expect(server.file().content).toBe(STYLE_SOURCE);
  });

  it("confirms an unanswered landed Style Redo without writing it twice", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await applyAndSaveStyle(server);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(historyState().redoAvailable).toBe(true));
    server.outcomes.push("offline-after-landing");

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_AFTER),
    );
    expect(server.save).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
    );
    const redoWrite = server.save.mock.calls[2]?.[0] as
      | { data?: { writeAttemptId?: string } }
      | undefined;
    expect(redoWrite?.data?.writeAttemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(server.file().lastWriteAttemptId).toBe(
      redoWrite?.data?.writeAttemptId,
    );
    expect({
      history: historyState(),
      writes: server.save.mock.calls.length,
      serverContent: server.file().content,
    }).toEqual({
      history: { undoAvailable: true, redoAvailable: false },
      writes: 3,
      serverContent: STYLE_AFTER,
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(server.file().content).toBe(STYLE_SOURCE));
    expect(historyState()).toEqual({ undoAvailable: false, redoAvailable: true });
  });

  it.each(["file", "source"] as const)(
    "does not resend an unanswered Style Undo after the %s basis moves",
    async (moved) => {
      const server = controlledThemeFile(STYLE_SOURCE);
      await applyAndSaveStyle(server);
      server.outcomes.push("offline");

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() =>
        expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
      );
      if (moved === "file") server.externalWrite(STYLE_REMOTE);
      else server.externalSourceWrite();

      fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
      await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(server.list).toHaveBeenCalledTimes(2));

      expect(server.save).toHaveBeenCalledTimes(2);
      expect(server.file().content).toBe(
        moved === "file" ? STYLE_REMOTE : STYLE_AFTER,
      );
      expect(historyState()).toEqual({ undoAvailable: true, redoAvailable: false });
      if (moved === "file") {
        expect(localThemeFile()?.conflict?.remoteContent).toBe(STYLE_REMOTE);
      } else {
        // Task 39 round 2 (R2-1, the task 29 rule for unknown writes): a
        // moved basis resolves the unknown write. It is no longer confirmable
        // and no longer unconfirmed; the author's text stays as a pending
        // source conflict. Previously it stayed unconfirmed for ever.
        expect(localThemeFile()?.sourceConflict).toBe(true);
        expect(localThemeFile()?.unconfirmedContent).toBeUndefined();
        expect(localThemeFile()?.localContent).toBe(STYLE_SOURCE);
      }
    },
  );

  it.each(["file id", "file version"] as const)(
    "refuses to confirm an unanswered landed Style Undo when its receipt has a different %s",
    async (changed) => {
      const server = controlledThemeFile(STYLE_SOURCE);
      await applyAndSaveStyle(server);
      server.outcomes.push("offline-after-landing");

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() =>
        expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
      );
      const writeAttemptId = server.file().lastWriteAttemptId;
      expect(writeAttemptId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      // Keep the causal receipt and source generation fixed while changing
      // exactly one file identity/version field, isolating that guard.
      if (changed === "file id") server.replaceFileIdKeepingReceipt();
      else server.advanceFileVersionKeepingReceipt();
      const error = vi.spyOn(toast, "error").mockImplementation(() => "");

      fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
      await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(error).toHaveBeenCalled());

      expect({
        writes: server.save.mock.calls.length,
        receipt: server.file().lastWriteAttemptId,
        sourceGeneration: server.file().sourceGeneration,
        history: historyState(),
      }).toEqual({
        writes: 2,
        receipt: writeAttemptId,
        sourceGeneration: 3,
        history: { undoAvailable: true, redoAvailable: false },
      });
      expect(localThemeFile()?.conflict).toBeDefined();
    },
  );

  it("does not confirm an unanswered landed Style Undo after another file advances the source", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    server.outcomes.push("offline-after-landing");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    const writeAttemptId = server.file().lastWriteAttemptId;
    server.externalSourceWrite();
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");

    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(server.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(error).toHaveBeenCalled());

    expect({
      writes: server.save.mock.calls.length,
      file: server.file(),
      history: historyState(),
      sourceConflict: localThemeFile()?.sourceConflict,
      unconfirmed: localThemeFile()?.unconfirmedContent,
    }).toMatchObject({
      writes: 2,
      file: {
        id: "file-hero",
        version: 3,
        sourceGeneration: 4,
        lastWriteAttemptId: writeAttemptId,
        content: STYLE_SOURCE,
      },
      history: { undoAvailable: true, redoAvailable: false },
      sourceConflict: true,
      // Task 39 round 2 (R2-1): the moved replay is resolved, not kept
      // unconfirmed (which looped: every check refused again).
      unconfirmed: undefined,
    });
    expect(localThemeFile()?.conflict).toBeUndefined();

    // The replay record is gone, so nothing can later confirm the history
    // step from it (by receipt or by content). The author's way on is a
    // plain save at the newer basis: no receipt, no history confirmation.
    expect(
      screen.queryByRole("button", { name: "Check and save" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save my changes" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(localThemeFile()?.sourceConflict).toBeUndefined(),
    );
    const plain = (
      server.save.mock.calls[2]?.[0] as {
        data?: Record<string, unknown>;
      }
    ).data;
    expect({
      writeAttemptId: plain?.writeAttemptId,
      expectedVersion: plain?.expectedVersion,
      expectedSourceGeneration: plain?.expectedSourceGeneration,
      history: historyState(),
      file: server.file(),
    }).toMatchObject({
      writeAttemptId: undefined,
      expectedVersion: 3,
      expectedSourceGeneration: 4,
      history: { undoAvailable: true, redoAvailable: false },
      file: { version: 4, lastWriteAttemptId: null, content: STYLE_SOURCE },
    });
    expect(writeAttemptId).not.toBeNull();
  });

  it("does not confirm an unanswered Style Undo from matching content and version deltas without its receipt", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    server.outcomes.push("offline");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    expect(historyState()).toEqual({ undoAvailable: true, redoAvailable: false });

    // Another editor can write the exact intended Undo text and produce the
    // same one-step file/source generation deltas. Only the persisted receipt
    // can attribute that write to this history attempt.
    server.externalWrite(STYLE_SOURCE);
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));

    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(localThemeFile()?.conflict?.remoteContent).toBe(STYLE_SOURCE),
    );
    expect(server.save).toHaveBeenCalledTimes(2);
    expect(server.file()).toMatchObject({
      content: STYLE_SOURCE,
      version: 3,
      sourceGeneration: 3,
      lastWriteAttemptId: null,
    });
    expect(historyState()).toEqual({ undoAvailable: true, redoAvailable: false });
    expect(localThemeFile()?.conflict?.remoteContent).toBe(STYLE_SOURCE);
  });

  it("keeps an unanswered Style replay linked when recovery read-back fails", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    server.outcomes.push("offline-after-landing");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    server.list.mockRejectedValueOnce(new Error("Read-back unavailable"));

    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(server.list).toHaveBeenCalledTimes(2));

    expect({
      writes: server.save.mock.calls.length,
      unconfirmed: localThemeFile()?.unconfirmedContent,
      history: historyState(),
    }).toEqual({
      writes: 2,
      unconfirmed: STYLE_SOURCE,
      history: { undoAvailable: true, redoAvailable: false },
    });
  });
});
