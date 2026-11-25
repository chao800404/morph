/**
 * Undo and Redo of writes to a list nothing stores yet: Content replays, mixed and reset-only undos, and the read-back cases.
 *
 * One of the files the former `visual-editor-shell-round-trip.test.tsx` was split into so
 * the test shards can spread it; the shared setup is in `visual-editor-shell-round-trip.harness.tsx`.
 */
import {
  baseSearch,
  bridgeWithoutPresentationAck,
  context,
  flushFrames,
  fromPreview,
  getThemeEditor,
  holdContentDebounce,
  liveFrame,
  readyQueryClient,
  saveStatus,
  updateSectionProps,
} from "./visual-editor-shell-round-trip.harness";
import { reloadFrameDocument } from "@/lib/test-utils/preview-frame-handshake";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type {
  StorefrontThemeEditorDTO,
} from "@/lib/storefront/dto/storefront-theme.dto";
import {
  storefrontThemeFileQueries,
} from "../-queries/storefront-theme-files.queries";
import {
  HISTORY_NEWER_EDIT_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";
import {
  normalizeDocumentRowIds,
} from "@/lib/storefront/editor/normalize-row-ids";
import {
  resolveSelectable as objposResolveSelectable,
  selectionMetadata as objposSelectionMetadata,
} from "@/lib/storefront/editor/preview-dom";
import {
  livePreviewPlatformFiles as objposPlatformFiles,
  mountLivePreview as objposMount,
  renderLivePreviewRoute as objposRenderRoute,
} from "@/lib/test-utils/live-preview-render";

describe("a list nothing stores yet, edited for the first time", () => {
  // The rows on screen are the component's own defaults, without ids. The
  // first edit gives them the ids the server would (normalizeRowIds), before
  // the edit touches them; after that the list is the author's copy and the
  // row identity guard applies to it like to any stored list.
  const ENTRIES_PATH = "src/components/Entries.tsx";
  const DEFAULTS = [{ title: "One" }, { title: "Two" }];
  /** The rows the component declares; a test may declare others. */
  let defaults: ReadonlyArray<{ title: string }> = DEFAULTS;
  /**
   * Whether the component also declares a top-level `heading` (#388 round 3:
   * a write over a stored key and an unstored list at once). Off, the source
   * is exactly what it was without it.
   */
  let headingField = false;
  const entries = (storedProps?: Record<string, unknown>) => ({
    path: ENTRIES_PATH,
    type: "entries",
    props: storedProps ?? {},
    source: `export const contentFields = {${
      headingField
        ? `
  heading: { type: "text", label: "Heading", maxLength: 150 },`
        : ""
    }
  items: {
    type: "array",
    label: "Entries",
    fields: { title: { type: "text", label: "Title", maxLength: 150 } },
  },
} as const;
export default function Entries({ ${headingField ? `heading = "Default heading", ` : ""}items = ${JSON.stringify(defaults)} }: { ${headingField ? "heading?: string; " : ""}items?: { id?: string; title?: string }[] }) {
  return <section>${headingField ? "<h2>{heading}</h2>" : ""}{items.map((item, index) => <h3 key={item.id ?? index}>{item.title}</h3>)}</section>;
}`,
  });
  /** The ids the server would give the default rows of this section. */
  const identified = () =>
    normalizeDocumentRowIds(
      {
        version: 1,
        sections: [{ id: "section", props: { items: defaults } }],
      },
      context.templates[0]!.id,
    ).value.sections[0]!.props.items as Array<{ id: string; title: string }>;
  const sent = () =>
    updateSectionProps.mock.calls.map(
      (call) => call[0].data as Record<string, unknown>,
    );
  const rowsSent = (data: Record<string, unknown>) =>
    (
      (data.props as { items?: Array<Record<string, unknown>> }).items ?? []
    ).map((row) => [row.id, row.title]);

  beforeAll(() => {
    // Every browser this runs in has CSS.escape; this jsdom does not.
    if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
      (globalThis as { CSS?: unknown }).CSS = {
        escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
      };
    }
  });
  let draftGeneration = 1;
  let stored: Record<string, unknown> = {};
  beforeEach(() => {
    defaults = DEFAULTS;
    headingField = false;
    draftGeneration = 1;
    stored = {};
    updateSectionProps.mockReset();
    updateSectionProps.mockImplementation(async ({ data }) => {
      stored = { ...stored, ...(data.props as Record<string, unknown>) };
      // A reset removes the stored value, as the server does.
      for (const key of (data.resetProps as string[] | undefined) ?? []) {
        delete stored[key];
      }
      draftGeneration = data.expectedDraftGeneration + 1;
      return {
        success: true,
        data: {
          draftGeneration,
          droppedProps: [],
          document: {
            version: 1,
            sections: [
              {
                id: "section",
                type: "entries",
                componentRef: ENTRIES_PATH,
                enabled: true,
                props: stored,
              },
            ],
          },
        },
      };
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function reportTitle(
    props: Record<string, unknown>,
    index: number,
    /** The element clicked; by default the `index`th title. */
    pick: (root: HTMLElement) => Element | null = (root) =>
      root.querySelectorAll("h3")[index] ?? null,
  ) {
    const fixture = entries(props);
    const route = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Section from "../components/Entries";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><Section {...content("section")} /></main>;
}`;
    const { html } = await objposRenderRoute({
      files: [
        ...objposPlatformFiles(),
        { path: fixture.path, content: fixture.source },
        { path: "src/routes/index.tsx", content: route },
      ],
      documents: {
        index: {
          version: 1,
          sections: [{ id: "section", type: "entries", enabled: true, props }],
        } as never,
      },
    });
    const root = objposMount(html);
    const item = objposResolveSelectable(pick(root) as HTMLElement | null);
    document.body.replaceChildren();
    expect(item).toBeTruthy();
    return {
      type: "morph:storefront-preview-select-section",
      sectionId: item!.sectionId,
      componentType: item!.type,
      sourceLocation: item!.element.dataset.morphLoc ?? null,
      nodeId: item!.element.getAttribute("data-morph-node") || undefined,
      elementKey: item!.elementKey,
      fieldKey: item!.fieldKey,
      field:
        item!.descendantFields.length > 0
          ? null
          : (item!.fieldKey ?? item!.elementKey),
      descendantFields: item!.descendantFields,
      itemId: item!.itemId,
      contentUnavailable: item!.contentUnavailable,
      ...objposSelectionMetadata(item!),
      styleRevision: 0,
      selectionRevision: 1,
      className: item!.element.getAttribute("class") ?? "",
      isSection: item!.element === item!.section,
      inspectorOverride: item!.element.dataset.morphInspector ?? null,
      computedStyle: null,
      parentComputedStyle: null,
      sectionComputedStyle: null,
      documentRect: { top: 0, height: 100 },
    };
  }

  function renderEntries(props: Record<string, unknown>, atGeneration = 1) {
    const fixture = entries(props);
    const editorContext = editorAt(props, atGeneration);
    const client = readyQueryClient();
    client.setQueryData(
      storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
      {
        files: [
          {
            id: "file-section",
            storefrontId: "storefront-1",
            themeId: "theme-1",
            path: fixture.path,
            content: fixture.source,
            mimeType: "text/typescript",
            isEntry: false,
            version: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ],
        tree: [],
        sourceGeneration: 1,
        latestPublishedRevision: null,
      } as never,
    );
    const shell = (current: StorefrontThemeEditorDTO) => (
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={current}
          search={{ ...baseSearch, section: "section" }}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(shell(editorContext));
    if (document.querySelector("iframe")) liveFrame.ready();
    return {
      client,
      receive: (next: StorefrontThemeEditorDTO) => rerender(shell(next)),
    };
  }

  function editorAt(props: Record<string, unknown>, atGeneration: number) {
    return {
      ...context,
      templates: [
        {
          ...context.templates[0]!,
          draftGeneration: atGeneration,
          document: {
            version: 1,
            sections: [
              {
                id: "section",
                type: "entries",
                componentRef: ENTRIES_PATH,
                enabled: true,
                props,
              },
            ],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;
  }

  const type = async (shown: string, value: string) => {
    const field = (await screen.findAllByDisplayValue(shown))[0]!;
    fireEvent.input(field, { target: { value } });
    fireEvent.blur(field);
  };
  // Past the content write's 300 ms debounce and its answer. Real time
  // only: a test that controls the debounce holds that timer alone
  // (`holdContentDebounce`) and fires it itself.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 1_200));

  /**
   * The Inspector's "Add entry" and "Remove" on a list nothing stores yet,
   * seen from the shell: what the write sends and whether the shell takes
   * the answer. The Inspector's own tests only see the props it hands the
   * shell; staging and the send happen here.
   *
   * The server is the mock above, extended to drop `resetProps` keys as the
   * server does. A mocked success taken by the shell shows the shell accepts
   * it, not that the real data layer would.
   *
   * The section itself is selected on the canvas, which is where the panel
   * offers "Add entry": a selected entry scopes the panel to that one row.
   */
  describe("adding and removing entries of a list nothing stores yet, from the Inspector", () => {
    /**
     * Opens the editor on `props` with the section selected on the canvas.
     * The canvas report is taken first: rendering it replaces the body.
     */
    async function openSection(props: Record<string, unknown>) {
      const report = await reportTitle(props, 0, (root) =>
        root.querySelector("[data-storefront-section-id],[data-morph-section]"),
      );
      expect(report).toMatchObject({ isSection: true, itemId: null });
      const editor = renderEntries(props, 1);
      await flushFrames();
      fromPreview(report);
      await flushFrames();
      const contentTab = screen.queryByRole("button", { name: /^Content$/ });
      if (contentTab) fireEvent.click(contentTab);
      await flushFrames();
      return editor;
    }
    /**
     * The route's read of the Theme after a removal: the shell does not take
     * the document from a reset's answer, it invalidates the read, and the
     * route hands it the new one. Modeled by giving the editor what the mock
     * store now holds, as editor.tsx would once that read comes back.
     */
    const reread = async (
      receive: (next: StorefrontThemeEditorDTO) => void,
    ) => {
      act(() => receive(editorAt(stored, draftGeneration)));
      await flushFrames();
    };

    beforeEach(() => {
      updateSectionProps.mockImplementation(async ({ data }) => {
        stored = { ...stored, ...(data.props as Record<string, unknown>) };
        for (const key of (data.resetProps as string[] | undefined) ?? []) {
          delete stored[key];
        }
        draftGeneration = data.expectedDraftGeneration + 1;
        return {
          success: true,
          data: {
            draftGeneration,
            droppedProps: [],
            document: {
              version: 1,
              sections: [
                {
                  id: "section",
                  type: "entries",
                  componentRef: ENTRIES_PATH,
                  enabled: true,
                  props: stored,
                },
              ],
            },
          },
        };
      });
    });

    const notices = () => ({
      warning: vi.spyOn(toast, "warning").mockImplementation(() => ""),
      error: vi.spyOn(toast, "error").mockImplementation(() => ""),
    });
    const addEntry = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Add entry" }));
      await settle();
    };
    /** The titles of the row cards the panel draws, in order. */
    const panelTitles = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[class*="bg-muted/30"]'),
      ).map(
        (card) => card.querySelector<HTMLInputElement>("input")?.value ?? null,
      );
    /** Whether Undo and Redo can be pressed. */
    const historyButtons = () => ({
      undo: !screen
        .getByRole("button", { name: "Undo" })
        .hasAttribute("disabled"),
      redo: !screen
        .getByRole("button", { name: "Redo" })
        .hasAttribute("disabled"),
    });
    const press = async (name: "Undo" | "Redo") => {
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name }).hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name }));
      await settle();
    };
    const undo = () => press("Undo");
    const redo = () => press("Redo");
    const accepted = (notice: ReturnType<typeof notices>) => {
      expect(notice.warning).not.toHaveBeenCalled();
      expect(notice.error).not.toHaveBeenCalled();
      expect(saveStatus()).toBe("Unpublished");
    };

    /**
     * #388 round 3, A2/A3 (red before the fix where noted; see
     * handoff/2026-11-07/pr388-round3-tests/SUMMARY.md).
     *
     * The component also declares `heading`, stored as "Hello". One write
     * over both `heading` and the unstored `items` is undone by restoring the
     * one and removing the other, in ONE awaited write. A reset or mixed
     * write that gets no answer is held as unconfirmed, and its read-back is
     * decided version first, then content.
     *
     * The server here checks the draft generation as the DAL does, and drops
     * `resetProps` keys.
     */
    describe("#388 round 3: undoing a write that also removes keys", () => {
      const STORED = { heading: "Hello" } as const;
      /** One-off answers, in order, before the server's own. */
      let answerNext: Array<(data: Record<string, unknown>) => unknown> = [];
      const conflictAnswer = {
        success: false,
        error: "TEMPLATE_DRAFT_CONFLICT",
        message: "Template draft was modified concurrently.",
      };
      const apply = (data: Record<string, unknown>) => {
        if (data.expectedDraftGeneration !== draftGeneration) {
          return conflictAnswer;
        }
        stored = { ...stored, ...(data.props as Record<string, unknown>) };
        for (const key of (data.resetProps as string[] | undefined) ?? []) {
          delete stored[key];
        }
        draftGeneration += 1;
        return {
          success: true,
          data: {
            draftGeneration,
            droppedProps: [],
            document: {
              version: 1,
              sections: [
                {
                  id: "section",
                  type: "entries",
                  componentRef: ENTRIES_PATH,
                  enabled: true,
                  props: stored,
                },
              ],
            },
          },
        };
      };
      /** The request is sent and no answer comes back. */
      const lost = () => {
        throw new Error("offline");
      };
      /** What the server holds now, and what reading it answers. */
      const serverHolds = (
        props: Record<string, unknown>,
        generation: number,
      ) => {
        stored = { ...props };
        draftGeneration = generation;
        getThemeEditor.mockResolvedValue({
          success: true,
          message: "ok",
          data: editorAt({ ...props }, generation),
        });
      };
      const unconfirmedCount = () =>
        document
          .querySelector("[data-editor-unconfirmed-saves]")
          ?.getAttribute("data-editor-unconfirmed-saves") ?? null;
      const checkAndSave = async () => {
        fireEvent.click(
          await screen.findByRole("button", { name: "Check and save" }),
        );
        await settle();
      };
      const errors = (notice: ReturnType<typeof notices>) =>
        notice.error.mock.calls.map((call) => String(call[0]));

      beforeEach(() => {
        headingField = true;
        answerNext = [];
        getThemeEditor.mockReset();
        updateSectionProps.mockImplementation(async ({ data }) => {
          const override = answerNext.shift();
          return override ? override(data) : apply(data);
        });
      });

      /**
       * `heading` typed and an entry added inside one debounce: the Add waits
       * for the heading's preview commit acknowledgement, then joins the same
       * pending write and history entry.
       */
      async function mixedWrite() {
        stored = { ...STORED };
        const editor = await openSection({ ...STORED });
        const heading = (await screen.findAllByDisplayValue("Hello"))[0]!;
        const add = (await screen.findByRole("button", {
          name: "Add entry",
        })) as HTMLButtonElement;
        // The preview update temporarily pauses Content controls. The 300 ms
        // save debounce is held while its DOM-commit acknowledgement comes
        // back, so the list action joins the same pending entry; only that
        // timer is held, and it is run here, once.
        const debounce = holdContentDebounce();
        try {
          fireEvent.input(heading, { target: { value: "New" } });
          fireEvent.blur(heading);
          await flushFrames();
          await waitFor(() => expect(add.disabled).toBe(false));
          fireEvent.click(add);
          expect(sent(), "nothing leaves inside the debounce").toHaveLength(0);
          expect(debounce.count(), "one debounce, for the section").toBe(1);
          await act(async () => {
            debounce.fire();
          });
        } finally {
          debounce.restore();
        }
        await waitFor(() => expect(sent()).toHaveLength(1));
        await settle();
        expect(sent(), "one write for both keys").toHaveLength(1);
        expect(Object.keys(sent()[0]!.props as object).sort()).toEqual([
          "heading",
          "items",
        ]);
        await reread(editor.receive);
        const added = (sent()[0]!.props as { items: unknown[] }).items;
        expect(added).toHaveLength(3);
        return { ...editor, added };
      }
      /** An entry added to the unstored list: one write, one history entry. */
      async function resetOnlyWrite() {
        stored = { ...STORED };
        const editor = await openSection({ ...STORED });
        await addEntry();
        expect(sent()).toHaveLength(1);
        await reread(editor.receive);
        return editor;
      }

      /**
       * #388 round 5 (red before the fix): a history replay is its own
       * awaited write, sent with no debounce and recording nothing. History
       * moves only once that write is answered; a refusal or a lost answer
       * leaves it where it was, and a lost one is held, read back, and
       * completes its own run exactly once.
       */
      describe("a Content replay is its own awaited write", () => {
        const depth = () =>
          document
            .querySelector("[data-editor-undo-depth]")
            ?.getAttribute("data-editor-undo-depth") ?? null;
        /** `heading` Hello -> New: one write (draft 1 -> 2), one entry. */
        async function storedFieldEdit() {
          stored = { ...STORED };
          const editor = await openSection({ ...STORED });
          await type("Hello", "New");
          await settle();
          await reread(editor.receive);
          expect(sent()).toHaveLength(1);
          expect(stored).toEqual({ heading: "New" });
          expect(depth()).toBe("1");
          return editor;
        }

        for (const [label, prepare] of [
          [
            "answered with a refusal",
            () => {
              answerNext.push(() => ({
                success: false,
                error: "REFUSED_BY_MOCK",
                message: "The mock refused the undo.",
              }));
            },
          ],
          [
            "refused as out of date (another tab moved the Document)",
            () => {
              stored = { heading: "Theirs" };
              draftGeneration = 3;
            },
          ],
        ] as const) {
          it(`an Undo ${label}: history, data and entries unchanged, and says so`, async () => {
            const notice = notices();
            await storedFieldEdit();
            prepare();
            const before = { ...stored };

            await undo();

            expect(sent(), "the undo is sent once").toHaveLength(2);
            expect(sent()[1]!.props).toEqual({ heading: "Hello" });
            expect(sent()[1]).toMatchObject({
              expectedDraftGeneration: 2,
              expectedSourceGeneration: 1,
            });
            expect(stored, "the Document is unchanged").toEqual(before);
            expect(depth(), "history did not move").toBe("1");
            expect(historyButtons()).toEqual({ undo: true, redo: false });
            expect(errors(notice)).toContainEqual(
              expect.stringMatching(/^Could not undo/),
            );
            expect(unconfirmedCount()).toBeNull();
            await settle();
            expect(sent(), "nothing is sent after it").toHaveLength(2);
            expect(depth(), "nothing new is recorded").toBe("1");
          });
        }

        /**
         * Types into the field showing `shown` and presses Undo in the same
         * task, so the input is still inside the 300 ms debounce when the
         * Undo runs (awaiting between them can let it leave first).
         */
        async function typeThenUndo(shown: string, value: string) {
          const field = (await screen.findAllByDisplayValue(shown))[0]!;
          const button = screen.getByRole("button", { name: "Undo" });
          expect(button.hasAttribute("disabled")).toBe(false);
          fireEvent.input(field, { target: { value } });
          fireEvent.blur(field);
          fireEvent.click(button);
          await settle();
        }

        /** Its undo sent at draft 2, and no answer comes back. */
        async function lostUndo() {
          const notice = notices();
          const editor = await storedFieldEdit();
          answerNext.push(lost);

          await undo();

          expect(sent()).toHaveLength(2);
          expect(sent()[1]).toMatchObject({
            props: { heading: "Hello" },
            expectedDraftGeneration: 2,
            expectedSourceGeneration: 1,
          });
          expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
          expect(depth(), "history did not move").toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(errors(notice)).toContainEqual(
            expect.stringMatching(/^Could not undo/),
          );
          return { ...editor, notice };
        }

        it("an Undo with no answer, read back as landed: history moves once, nothing is sent again, Redo still there", async () => {
          const { receive } = await lostUndo();
          serverHolds({ heading: "Hello" }, 3);

          await checkAndSave();

          expect(sent(), "nothing is sent again").toHaveLength(2);
          expect(unconfirmedCount()).toBeNull();
          expect(depth(), "moved once").toBe("0");
          expect(historyButtons()).toEqual({ undo: false, redo: true });

          await reread(receive);
          await redo();

          expect(sent()).toHaveLength(3);
          expect(sent()[2]).toMatchObject({
            props: { heading: "New" },
            expectedDraftGeneration: 3,
            expectedSourceGeneration: 1,
          });
          expect(stored).toEqual({ heading: "New" });
          expect(depth()).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
        });

        it("an Undo with no answer, read back as not landed: sent once, as first sent, only on Check and save; history moves once", async () => {
          const { receive } = await lostUndo();
          serverHolds({ heading: "New" }, 2);
          await settle();
          expect(sent(), "nothing is sent by itself").toHaveLength(2);
          expect(depth()).toBe("1");

          await checkAndSave();

          expect(sent(), "sent once more").toHaveLength(3);
          expect(sent()[2]).toMatchObject({
            props: { heading: "Hello" },
            expectedDraftGeneration: 2,
            expectedSourceGeneration: 1,
          });
          expect(sent()[2]).not.toHaveProperty("resetProps");
          expect(stored).toEqual({ heading: "Hello" });
          expect(unconfirmedCount()).toBeNull();
          expect(depth(), "moved once, nothing new recorded").toBe("0");
          expect(historyButtons()).toEqual({ undo: false, redo: true });
          await settle();
          expect(sent(), "and nothing after it").toHaveLength(3);

          await reread(receive);
          await redo();

          expect(sent()).toHaveLength(4);
          expect(sent()[3]!.props).toEqual({ heading: "New" });
          expect(depth()).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
        });

        /**
         * The section's own input is still pending when Undo is pressed. It
         * is sent first, as its own write, and records its own entry on top
         * of the one Undo was pressed for. That Undo then does not run over
         * it: nothing is sent for the older entry, history keeps both, in
         * order, and says so. The next Undo is the input's, the one after it
         * the older entry's, and Redo puts them back in the same order.
         *
         * `heading` is the input: its edits wait out the 300 ms debounce
         * (a row title of the unstored list is saved at once, so it would
         * be recorded before Undo is pressed).
         */
        it("input of the section still pending when Undo is pressed is saved first, as its own entry; that Undo then refuses", async () => {
          const notice = notices();
          // A controlled clock instead of real 1200 ms sleeps: only setTimeout
          // and clearTimeout are faked (frames, React and the mock keep
          // running) and the clock follows real time so `waitFor` works.
          // `quiet` first waits for the signals that the write path is idle
          // (the expected write was sent and its answer taken), then runs the
          // same 1200 ms window `settle` slept through on the fake clock, so
          // a write still due inside that window is sent by this run and
          // fails the count assertion that follows.
          vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout"],
            shouldAdvanceTime: true,
          });
          onTestFinished(() => {
            vi.useRealTimers();
          });
          const quiet = async (writes: number) => {
            await waitFor(() => expect(sent()).toHaveLength(writes), {
              timeout: 10_000,
            });
            await act(async () => {
              await Promise.allSettled(
                updateSectionProps.mock.results.map((r) => r.value),
              );
              await vi.advanceTimersByTimeAsync(1_200);
            });
          };
          const press = async (name: "Undo" | "Redo", writes: number) => {
            await waitFor(() =>
              expect(
                screen.getByRole("button", { name }).hasAttribute("disabled"),
              ).toBe(false),
            );
            fireEvent.click(screen.getByRole("button", { name }));
            await quiet(writes);
          };

          stored = { ...STORED };
          const { receive } = await openSection({ ...STORED });
          // `heading` Hello -> New: one write, one entry.
          await type("Hello", "New");
          await quiet(1);
          await reread(receive);
          expect(sent()).toHaveLength(1);
          expect(stored).toEqual({ heading: "New" });
          expect(depth()).toBe("1");

          // Typed (blur stages it; the 300 ms debounce timer is on the
          // controlled clock, so it cannot leave), the frame acknowledges its
          // preview (`flushFrames`: the default post mock acknowledges after a
          // microtask), and Undo is pressed with the input still pending. Undo
          // then captures a confirmed presentation proof, which the run
          // needs to get past the "preview is still syncing" gate and reach
          // the newer-edit guard. Pressed before that acknowledgement, the old
          // test was refused on the syncing gate, not on the newer edit.
          const field = (await screen.findAllByDisplayValue("New"))[0]!;
          const undoButton = screen.getByRole("button", { name: "Undo" });
          expect(undoButton.hasAttribute("disabled")).toBe(false);
          fireEvent.input(field, { target: { value: "Newer" } });
          fireEvent.blur(field);
          await flushFrames();
          expect(sent(), "the input is still pending").toHaveLength(1);
          fireEvent.click(undoButton);
          await quiet(2);

          expect(sent(), "the input only, no undo after it").toHaveLength(2);
          expect(sent()[1]!.props).toEqual({ heading: "Newer" });
          expect(sent()[1]).toMatchObject({ expectedDraftGeneration: 2 });
          expect(stored, "the older entry is not undone").toEqual({
            heading: "Newer",
          });
          expect(depth(), "both entries kept").toBe("2");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(errors(notice)).toContainEqual(
            `Could not undo: ${HISTORY_NEWER_EDIT_MESSAGE}`,
          );
          expect(unconfirmedCount()).toBeNull();
          await quiet(2);
          expect(sent(), "nothing sent after it").toHaveLength(2);

          // The input's entry is on top: its undo puts back "New".
          await reread(receive);
          await press("Undo", 3);
          expect(sent()).toHaveLength(3);
          expect(sent()[2]).toMatchObject({
            props: { heading: "New" },
            expectedDraftGeneration: 3,
          });
          expect(stored).toEqual({ heading: "New" });
          expect(depth()).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: true });

          // Then the older entry, under it: "Hello".
          await reread(receive);
          await press("Undo", 4);
          expect(sent()).toHaveLength(4);
          expect(sent()[3]!.props).toEqual({ heading: "Hello" });
          expect(stored).toEqual({ heading: "Hello" });
          expect(depth()).toBe("0");
          expect(historyButtons()).toEqual({ undo: false, redo: true });

          // Redo in the same order: the older entry, then the input.
          await reread(receive);
          await press("Redo", 5);
          expect(sent()).toHaveLength(5);
          expect(sent()[4]!.props).toEqual({ heading: "New" });
          expect(depth()).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: true });
          await reread(receive);
          await press("Redo", 6);
          expect(sent()).toHaveLength(6);
          expect(sent()[5]!.props).toEqual({ heading: "Newer" });
          expect(stored).toEqual({ heading: "Newer" });
          expect(depth()).toBe("2");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(
            sent().every((data) => data.expectedSourceGeneration === 1),
          ).toBe(true);
        });

        // The same rule on the reset path (the undo of a first Add).
        it("input pending when the undo of a first Add is pressed is saved first; that undo then refuses", async () => {
          const notice = notices();
          const { receive } = await resetOnlyWrite();
          expect(depth()).toBe("1");
          await typeThenUndo("Hello", "Hi");

          expect(sent(), "the input only, no reset after it").toHaveLength(2);
          expect(sent()[1]!.props).toEqual({ heading: "Hi" });
          expect(sent()[1]).not.toHaveProperty("resetProps");
          expect(stored.heading).toBe("Hi");
          expect(stored).toHaveProperty("items");
          expect(depth(), "both entries kept").toBe("2");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(errors(notice)).toContainEqual(
            expect.stringMatching(/^Could not undo/),
          );

          // The input's entry first, then the Add's.
          await reread(receive);
          await undo();
          expect(sent()).toHaveLength(3);
          expect(sent()[2]!.props).toEqual({ heading: "Hello" });
          expect(sent()[2]).not.toHaveProperty("resetProps");
          expect(depth()).toBe("1");
          await reread(receive);
          await undo();
          expect(sent()).toHaveLength(4);
          expect(sent()[3]).toMatchObject({ props: {}, resetProps: ["items"] });
          expect(stored).toEqual({ ...STORED });
          expect(depth()).toBe("0");
          expect(historyButtons()).toEqual({ undo: false, redo: true });
        });

        /**
         * The same rule on the reset path, with the preview's presentation
         * acknowledged before Undo is pressed (as the test above does for a
         * plain content undo): the undo of a first Add runs through
         * `handleResetContentFields` with a history attempt, which first
         * sends the section's pending input (`flushTemplatePendingProps`),
         * and then checks the attempt's entry is still on top
         * (`history.isOnTop`). The input recorded its own entry above it, so
         * the reset is not sent and the newer-edit message is shown. The old
         * test above presses Undo before the acknowledgement and asserts
         * only /^Could not undo/, so it does not tell these guards apart
         * from the "preview is still syncing" refusal.
         */
        it("input pending when the undo of a first Add is pressed, preview acknowledged: sent first as its own entry; the reset then refuses with the newer-edit message", async () => {
          const notice = notices();
          vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout"],
            shouldAdvanceTime: true,
          });
          onTestFinished(() => {
            vi.useRealTimers();
          });
          const quiet = async (writes: number) => {
            await waitFor(() => expect(sent()).toHaveLength(writes), {
              timeout: 10_000,
            });
            await act(async () => {
              await Promise.allSettled(
                updateSectionProps.mock.results.map((r) => r.value),
              );
              await vi.advanceTimersByTimeAsync(1_200);
            });
          };

          const { receive } = await resetOnlyWrite();
          expect(sent()).toHaveLength(1);
          expect(sent()[0]).not.toHaveProperty("resetProps");
          expect(depth()).toBe("1");

          const field = (await screen.findAllByDisplayValue("Hello"))[0]!;
          const undoButton = screen.getByRole("button", { name: "Undo" });
          expect(undoButton.hasAttribute("disabled")).toBe(false);
          fireEvent.input(field, { target: { value: "Hi" } });
          fireEvent.blur(field);
          await flushFrames();
          expect(sent(), "the input is still pending").toHaveLength(1);
          fireEvent.click(undoButton);
          await quiet(2);

          expect(sent(), "the input only, no reset after it").toHaveLength(2);
          expect(sent()[1]!.props).toEqual({ heading: "Hi" });
          expect(sent()[1]).not.toHaveProperty("resetProps");
          expect(sent()[1]).toMatchObject({ expectedSourceGeneration: 1 });
          expect(stored.heading).toBe("Hi");
          expect(stored, "the Add is not undone").toHaveProperty("items");
          expect(depth(), "both entries kept").toBe("2");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(errors(notice)).toContainEqual(
            `Could not undo: ${HISTORY_NEWER_EDIT_MESSAGE}`,
          );
          expect(unconfirmedCount()).toBeNull();
          await quiet(2);
          expect(sent(), "nothing sent after it").toHaveLength(2);
          void receive;
        });
      });

      /** A write as sent, by the fields an undo is decided by. */
      const shape = (data: Record<string, unknown>) => ({
        templateId: data.templateId,
        sectionId: data.sectionId,
        props: data.props,
        resetProps: data.resetProps,
        expectedDraftGeneration: data.expectedDraftGeneration,
        expectedSourceGeneration: data.expectedSourceGeneration,
      });
      /** The combined undo of `mixedWrite`, as it must be sent. */
      const mixedUndo = (draft: number) => ({
        templateId: "template-1",
        sectionId: "section",
        props: { heading: "Hello" },
        resetProps: ["items"],
        expectedDraftGeneration: draft,
        expectedSourceGeneration: 1,
      });
      const resetUndo = (draft: number) => ({
        templateId: "template-1",
        sectionId: "section",
        props: {},
        resetProps: ["items"],
        expectedDraftGeneration: draft,
        expectedSourceGeneration: 1,
      });

      describe("A2: a mixed undo is one awaited write", () => {
        it("sends one write carrying both the restore and the reset; redo round-trips", async () => {
          const notice = notices();
          const { receive, added } = await mixedWrite();

          await undo();
          await settle();

          expect(sent(), "undo sends exactly one write").toHaveLength(2);
          expect(shape(sent()[1]!)).toEqual(mixedUndo(2));
          expect(stored).toEqual({ heading: "Hello" });
          accepted(notice);
          await reread(receive);
          expect(historyButtons()).toEqual({ undo: false, redo: true });
          expect(panelTitles()).toEqual(["One", "Two"]);

          await redo();

          expect(sent(), "redo sends one write").toHaveLength(3);
          const again = sent()[2]!;
          expect(again).not.toHaveProperty("resetProps");
          expect(again.props).toEqual({ heading: "New", items: added });
          expect(stored).toEqual({ heading: "New", items: added });
          accepted(notice);
          await reread(receive);
          expect(historyButtons()).toEqual({ undo: true, redo: false });
        });

        for (const [label, answer] of [
          [
            "refused",
            () => ({
              success: false,
              error: "REFUSED_BY_MOCK",
              message: "The mock refused the undo.",
            }),
          ],
          ["thrown", lost],
        ] as const) {
          it(`a ${label} combined write changes nothing, keeps history, says so, and sends no restore after`, async () => {
            const notice = notices();
            const { added } = await mixedWrite();
            const before = { ...stored };
            answerNext.push(answer);

            await undo();
            await settle();

            expect(sent(), "one undo write, and nothing after it").toHaveLength(
              2,
            );
            expect(shape(sent()[1]!)).toEqual(mixedUndo(2));
            expect(stored).toEqual(before);
            expect(stored).toEqual({ heading: "New", items: added });
            expect(historyButtons(), "history did not move").toEqual({
              undo: true,
              redo: false,
            });
            expect(errors(notice)).toContainEqual(
              expect.stringMatching(/^Could not undo/),
            );
          });
        }

        it("refuses by the draft generation when someone else changed the Document and the editor has not read it", async () => {
          const notice = notices();
          const { added } = await mixedWrite();
          // Another tab: same source generation, the Document moved to 3.
          stored = { ...stored, heading: "Theirs" };
          draftGeneration = 3;

          await undo();

          expect(sent(), "at most the one refused undo").toHaveLength(2);
          expect(sent()[1]!.expectedDraftGeneration).toBe(2);
          expect(stored).toEqual({ heading: "Theirs", items: added });
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(errors(notice).length).toBeGreaterThan(0);
        });

        it("refuses before sending when someone else changed the Document and the editor already read it", async () => {
          const notice = notices();
          const { receive, added } = await mixedWrite();
          stored = { ...stored, heading: "Theirs" };
          draftGeneration = 3;
          act(() => receive(editorAt({ ...stored }, 3)));
          await flushFrames();

          await undo();

          expect(
            sent(),
            "nothing is sent over a step that was not this editor's own",
          ).toHaveLength(1);
          expect(stored).toEqual({ heading: "Theirs", items: added });
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(errors(notice).length).toBeGreaterThan(0);
        });
      });

      describe("A3: an undo that removes keys and gets no answer", () => {
        it("reset-only: keeps history, counts one unconfirmed save, and holds the next edit", async () => {
          notices();
          await resetOnlyWrite();
          answerNext.push(lost);

          await undo();

          expect(sent()).toHaveLength(2);
          expect(shape(sent()[1]!)).toEqual(resetUndo(2));
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
          await type("Two", "Two edited");
          await settle();
          expect(sent(), "the next edit is held").toHaveLength(2);
          expect(unconfirmedCount()).toBe("1");
        });

        it("mixed: keeps history, counts one unconfirmed save, and holds the next edit", async () => {
          notices();
          await mixedWrite();
          answerNext.push(lost);

          await undo();

          expect(sent()).toHaveLength(2);
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
          expect(shape(sent()[1]!)).toEqual(mixedUndo(2));
          await type("Two", "Two edited");
          await settle();
          expect(sent(), "the next edit is held").toHaveLength(2);
        });
      });

      describe("A3: reading back a reset-only undo that got no answer", () => {
        /** Add (draft 1 -> 2), then its undo sent at 2 with no answer. */
        async function lostResetUndo() {
          const notice = notices();
          const editor = await resetOnlyWrite();
          const added = stored.items;
          answerNext.push(lost);
          await undo();
          expect(sent()).toHaveLength(2);
          expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
          return { ...editor, notice, added };
        }

        it("same generation, key still held: not landed; sent once, as first sent, only on Check and save", async () => {
          const { added } = await lostResetUndo();
          serverHolds({ ...STORED, items: added }, 2);
          await settle();
          expect(sent(), "nothing is sent by itself").toHaveLength(2);

          await checkAndSave();

          expect(sent(), "sent once more").toHaveLength(3);
          expect(shape(sent()[2]!)).toEqual(resetUndo(2));
          expect(stored).toEqual({ ...STORED });
          expect(unconfirmedCount()).toBeNull();
          expect(historyButtons()).toEqual({ undo: false, redo: true });
        });

        it("same generation, after the frame reloaded: sent once, as first sent, on Check and save", async () => {
          // The reset's resend is the frozen write at its original
          // generations, CAS-guarded: a reload's new ready round does not
          // drop it, even when the new frame cannot acknowledge anything.
          const { added } = await lostResetUndo();
          serverHolds({ ...STORED, items: added }, 2);
          reloadFrameDocument();
          bridgeWithoutPresentationAck.ready();
          await settle();
          expect(sent(), "nothing is sent by itself").toHaveLength(2);

          await checkAndSave();

          expect(sent(), "sent once more").toHaveLength(3);
          expect(shape(sent()[2]!)).toEqual(resetUndo(2));
          expect(stored).toEqual({ ...STORED });
          expect(unconfirmedCount()).toBeNull();
          expect(historyButtons()).toEqual({ undo: false, redo: true });
        });

        it("one generation on, key gone: landed; confirmed once, nothing sent, and Undo then undoes the entry before it", async () => {
          notices();
          stored = { ...STORED };
          const { receive } = await openSection({ ...STORED });
          await type("Hello", "New");
          await settle();
          await reread(receive);
          await addEntry();
          await reread(receive);
          expect(sent()).toHaveLength(2);
          answerNext.push(lost);
          await undo();
          expect(shape(sent()[2]!)).toEqual(resetUndo(3));
          expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
          serverHolds({ heading: "New" }, 4);

          await checkAndSave();

          expect(sent(), "nothing is sent again").toHaveLength(3);
          expect(unconfirmedCount()).toBeNull();
          expect(historyButtons(), "the Add's undo is confirmed").toEqual({
            undo: true,
            redo: true,
          });

          await undo();

          expect(sent()).toHaveLength(4);
          expect(sent()[3]).not.toHaveProperty("resetProps");
          expect(sent()[3]!.props).toEqual({ heading: "Hello" });
        });

        for (const [label, held] of [
          ["one generation on, key still held", 3],
          ["two generations on, key gone", 4],
        ] as const) {
          it(`${label}: moved; never resent, on settle or on a later Undo`, async () => {
            const { added } = await lostResetUndo();
            const now =
              held === 3 ? { ...STORED, items: added } : { ...STORED };
            serverHolds(now, held);

            await checkAndSave();

            expect(sent(), "nothing on settle").toHaveLength(2);
            expect(saveStatus()).toBe("Out of date");
            await undo();
            expect(sent(), "nothing on a later Undo").toHaveLength(2);
            expect(stored).toEqual(now);
          });
        }

        it("not landed, its resend refused for another reason: the run fails with the reason and stays, nothing reads as Save failed, Undo runs it afresh", async () => {
          // Round 4 R4-1 (R3-6 kept: the reset branch's refusal is handled as
          // an ordinary resend's is). Refused by an answer, it did not land:
          // nothing is kept to resend, its entry stays to run again.
          const { added } = await lostResetUndo();
          serverHolds({ ...STORED, items: added }, 2);
          answerNext.push(() => ({
            success: false,
            error: "REFUSED_BY_MOCK",
            message: "The mock refused the resend.",
          }));

          await checkAndSave();

          expect(sent()).toHaveLength(3);
          expect(shape(sent()[2]!)).toEqual(resetUndo(2));
          expect(unconfirmedCount(), "an answer: not held").toBeNull();
          expect(saveStatus(), "nothing is pending").not.toBe("Save failed");
          expect(historyButtons(), "the run has not moved").toEqual({
            undo: true,
            redo: false,
          });
          await settle();
          expect(sent(), "nothing is sent by itself").toHaveLength(3);

          await undo();

          expect(sent(), "a fresh attempt").toHaveLength(4);
          expect(shape(sent()[3]!)).toEqual(resetUndo(2));
          expect(stored).toEqual({ ...STORED });
          expect(historyButtons(), "the run completed once").toEqual({
            undo: false,
            redo: true,
          });
        });

        it("a run's resend refused for another reason does not hold back input typed meanwhile in the same section", async () => {
          // Round 5 R5-2: the refused write is the run's, not the input's.
          // Input typed while the run was unanswered is the author's own and
          // goes in the same press; nothing reads as a failed save of it.
          const { added } = await lostResetUndo();
          await type("Hello", "Typed later");
          await settle();
          expect(sent(), "the input is held behind the run").toHaveLength(2);
          serverHolds({ ...STORED, items: added }, 2);
          answerNext.push(() => ({
            success: false,
            error: "REFUSED_BY_MOCK",
            message: "The mock refused the resend.",
          }));

          await checkAndSave();

          expect(sent()).toHaveLength(4);
          expect(shape(sent()[2]!)).toEqual(resetUndo(2));
          expect(sent()[3]!.props).toEqual({ heading: "Typed later" });
          expect(stored).toMatchObject({ heading: "Typed later" });
          expect(unconfirmedCount()).toBeNull();
          expect(saveStatus()).not.toBe("Save failed");
        });

        it("read failed: nothing sent, the record and the history unchanged", async () => {
          await lostResetUndo();
          getThemeEditor.mockRejectedValue(new Error("offline"));

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(unconfirmedCount()).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
        });
      });

      // Added with the implementation (user decision 2): what was sent stays
      // as sent. Input typed into the same section while the reset is held
      // is held under the section's pending entry; it never rewrites the
      // unconfirmed record, and the resend carries exactly the first write.
      it("input typed while a reset is held does not change what is sent again", async () => {
        notices();
        await resetOnlyWrite();
        answerNext.push(lost);
        await undo();
        expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
        await type("Hello", "Typed later");
        await settle();
        expect(sent(), "the input is held").toHaveLength(2);
        serverHolds({ ...stored }, 2);

        await checkAndSave();

        expect(sent().length).toBeGreaterThanOrEqual(3);
        expect(shape(sent()[2]!), "resent exactly as first sent").toEqual(
          resetUndo(2),
        );
        expect(sent()[2]!.props).not.toHaveProperty("heading");
      });

      describe("A3: reading back a mixed undo that got no answer", () => {
        async function lostMixedUndo() {
          const notice = notices();
          const editor = await mixedWrite();
          answerNext.push(lost);
          await undo();
          expect(sent()).toHaveLength(2);
          expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
          expect(shape(sent()[1]!)).toEqual(mixedUndo(2));
          return { ...editor, notice };
        }

        it("same generation, nothing applied: not landed; sent once, as first sent, only on Check and save", async () => {
          const { added } = await lostMixedUndo();
          serverHolds({ heading: "New", items: added }, 2);
          await settle();
          expect(sent(), "nothing is sent by itself").toHaveLength(2);

          await checkAndSave();

          expect(sent(), "sent once more").toHaveLength(3);
          expect(shape(sent()[2]!)).toEqual(mixedUndo(2));
          expect(stored).toEqual({ heading: "Hello" });
          expect(historyButtons()).toEqual({ undo: false, redo: true });
        });

        it("one generation on, value restored and key gone: landed; confirmed once, nothing sent", async () => {
          await lostMixedUndo();
          serverHolds({ heading: "Hello" }, 3);

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(unconfirmedCount()).toBeNull();
          expect(historyButtons()).toEqual({ undo: false, redo: true });
        });

        for (const [label, holds] of [
          [
            "one generation on, a value wrong and the key gone",
            (_added: unknown) => [{ heading: "Theirs" }, 3] as const,
          ],
          [
            "one generation on, values right and the key still held",
            (added: unknown) =>
              [{ heading: "Hello", items: added }, 3] as const,
          ],
          [
            "two generations on, everything applied",
            (_added: unknown) => [{ heading: "Hello" }, 4] as const,
          ],
        ] as const) {
          it(`${label}: moved; never resent, on settle or on a later Undo`, async () => {
            const { added } = await lostMixedUndo();
            const [now, generation] = holds(added);
            serverHolds(now, generation);

            await checkAndSave();

            expect(sent(), "nothing on settle").toHaveLength(2);
            expect(saveStatus()).toBe("Out of date");
            await undo();
            expect(sent(), "nothing on a later Undo").toHaveLength(2);
            expect(stored).toEqual(now);
          });
        }

        it("read failed: nothing sent, the record and the history unchanged", async () => {
          await lostMixedUndo();
          getThemeEditor.mockRejectedValue(new Error("offline"));

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(unconfirmedCount()).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
        });
      });

      describe('A3: the "Use code default" button with no answer', () => {
        async function lostCodeDefault() {
          const notice = notices();
          stored = { ...STORED };
          const editor = await openSection({ ...STORED });
          answerNext.push(lost);
          fireEvent.click(
            await screen.findByRole("button", { name: "Use code default" }),
          );
          await settle();
          expect(sent()).toHaveLength(1);
          expect(sent()[0]).toMatchObject({
            props: {},
            resetProps: ["heading"],
            expectedDraftGeneration: 1,
            expectedSourceGeneration: 1,
          });
          return { ...editor, notice };
        }

        it("is held as unconfirmed, and the next edit is held", async () => {
          await lostCodeDefault();

          expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
          await type("Two", "Two edited");
          await settle();
          expect(sent(), "the next edit is held").toHaveLength(1);
        });

        it("landed on read-back: its history entry is recorded once, and nothing is sent", async () => {
          const { receive } = await lostCodeDefault();
          expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
          serverHolds({}, 2);

          await checkAndSave();

          expect(sent(), "nothing is sent again").toHaveLength(1);
          expect(unconfirmedCount()).toBeNull();
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          // The route hands the shell the Theme the read-back fetched, as
          // editor.tsx does once its query updates (see `reread`). Without
          // it this harness keeps the pre-reset context, and the Undo below
          // would compare against `heading: "Hello"` still being stored.
          await reread(receive);
          await undo();
          expect(sent()).toHaveLength(2);
          expect(sent()[1]!.props).toEqual({ heading: "Hello" });
          expect(historyButtons(), "recorded once").toEqual({
            undo: false,
            redo: true,
          });
        });

        it("not landed on read-back: sent once more, as first sent, only on Check and save", async () => {
          await lostCodeDefault();
          expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
          serverHolds({ ...STORED }, 1);
          await settle();
          expect(sent(), "nothing is sent by itself").toHaveLength(1);

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(sent()[1]).toMatchObject({
            props: {},
            resetProps: ["heading"],
            expectedDraftGeneration: 1,
            expectedSourceGeneration: 1,
          });
          expect(stored).toEqual({});
        });
      });

      /**
       * #388 round 7 (red before the fix where noted): a replay that only
       * puts values back (a Content Undo with nothing to remove, a Redo, the
       * Undo of "Use code default", the Redo of a first Add, a list reorder's
       * Undo and Redo) is checked as the mixed undo is: the copy it goes onto
       * must be within this editor's own range since the draft generation
       * answered for the step it reverses or re-applies
       * (`basisWithinOwnRange`), never just the copy held now. Someone
       * else's change is refused, read by the editor or not; the editor's own
       * steps stay in range.
       *
       * A reorder of a stored list is not covered here: its first write is
       * already refused before sending by the row guard (`rowsStillMatch`
       * sees the reordered rows at their old paths), so neither its Undo nor
       * its Redo can be reached in this harness.
       */
      describe("round 7: a restore-only replay is checked against its own step", () => {
        const depth = () =>
          document
            .querySelector("[data-editor-undo-depth]")
            ?.getAttribute("data-editor-undo-depth") ?? null;
        const THEIRS = { heading: "Theirs" } as const;
        /** Another tab writes `props` at the next draft generation. */
        const theyWrite = (props: Record<string, unknown>) => {
          stored = { ...props };
          draftGeneration += 1;
        };
        /** The editor reads what the server holds now. */
        const editorReads = async (
          receive: (next: StorefrontThemeEditorDTO) => void,
        ) => {
          act(() => receive(editorAt({ ...stored }, draftGeneration)));
          await flushFrames();
        };
        /** `heading` Hello -> New: one write (draft 1 -> 2), one entry. */
        async function storedFieldEdit() {
          stored = { ...STORED };
          const editor = await openSection({ ...STORED });
          await type("Hello", "New");
          await settle();
          await reread(editor.receive);
          expect(sent()).toHaveLength(1);
          expect(stored).toEqual({ heading: "New" });
          expect(depth()).toBe("1");
          return editor;
        }

        for (const direction of ["undo", "redo"] as const) {
          for (const read of [false, true]) {
            const label = read
              ? "already read by the editor: refused before sending (basisWithinOwnRange)"
              : "not read by the editor yet: refused by the draft generation";
            it(`a Content ${direction} after someone else's change, ${label}`, async () => {
              const notice = notices();
              const { receive } = await storedFieldEdit();
              // The step's own basis: the draft generation answered for the
              // write it reverses (2) or for the undo it re-applies (3).
              let basis = 2;
              if (direction === "redo") {
                await undo();
                await reread(receive);
                expect(stored).toEqual({ ...STORED });
                expect(depth()).toBe("0");
                basis = 3;
              }
              const buttons = historyButtons();
              const depthBefore = depth();
              theyWrite(THEIRS);
              if (read) await editorReads(receive);
              const before = sent().length;

              await press(direction === "undo" ? "Undo" : "Redo");

              if (read) {
                expect(
                  sent(),
                  "nothing is sent over a step that was not this editor's own",
                ).toHaveLength(before);
              } else {
                expect(sent(), "the one refused replay").toHaveLength(
                  before + 1,
                );
                expect(sent().at(-1)!.expectedDraftGeneration).toBe(basis);
              }
              expect(stored, "their change is kept").toEqual({ ...THEIRS });
              expect(depth(), "history did not move").toBe(depthBefore);
              expect(historyButtons()).toEqual(buttons);
              expect(errors(notice)).toContainEqual(
                expect.stringMatching(
                  direction === "undo" ? /^Could not undo/ : /^Could not redo/,
                ),
              );
              expect(unconfirmedCount()).toBeNull();
              await settle();
              expect(sent(), "nothing is sent after it").toHaveLength(
                read ? before : before + 1,
              );
              expect(stored).toEqual({ ...THEIRS });
            });
          }
        }

        it("the Redo of a first Add, after someone else's change the editor read: refused before sending", async () => {
          const notice = notices();
          const { receive } = await resetOnlyWrite();
          await undo();
          await reread(receive);
          expect(stored).toEqual({ ...STORED });
          expect(historyButtons()).toEqual({ undo: false, redo: true });
          theyWrite(THEIRS);
          await editorReads(receive);

          await redo();

          expect(sent(), "the Add and its undo only").toHaveLength(2);
          expect(stored).toEqual({ ...THEIRS });
          expect(historyButtons()).toEqual({ undo: false, redo: true });
          expect(errors(notice)).toContainEqual(
            expect.stringMatching(/^Could not redo/),
          );
        });

        it('the Undo of "Use code default", after someone else\'s change the editor read: refused before sending', async () => {
          const notice = notices();
          stored = { ...STORED };
          const { receive } = await openSection({ ...STORED });
          fireEvent.click(
            await screen.findByRole("button", { name: "Use code default" }),
          );
          await settle();
          expect(sent()).toHaveLength(1);
          expect(stored).toEqual({});
          await reread(receive);
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          theyWrite(THEIRS);
          await editorReads(receive);

          await undo();

          expect(sent(), "the reset only").toHaveLength(1);
          expect(stored).toEqual({ ...THEIRS });
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(errors(notice)).toContainEqual(
            expect.stringMatching(/^Could not undo/),
          );
        });

        it("control: two rounds of Undo/Undo/Redo/Redo over two own edits, each at the generation the last answer returned", async () => {
          const notice = notices();
          const { receive } = await storedFieldEdit();
          await type("New", "Newer");
          await settle();
          await reread(receive);
          expect(sent()).toHaveLength(2);
          expect(stored).toEqual({ heading: "Newer" });
          expect(depth()).toBe("2");

          const steps = [
            [undo, "New", "1", { undo: true, redo: true }],
            [undo, "Hello", "0", { undo: false, redo: true }],
            [redo, "New", "1", { undo: true, redo: true }],
            [redo, "Newer", "2", { undo: true, redo: false }],
          ] as const;
          for (const round of [1, 2]) {
            for (const [run, heading, after, buttons] of steps) {
              const generation = draftGeneration;
              const before = sent().length;
              await run();
              await reread(receive);
              expect(sent(), `round ${round}: one write`).toHaveLength(
                before + 1,
              );
              expect(sent().at(-1)).toMatchObject({
                props: { heading },
                expectedDraftGeneration: generation,
                expectedSourceGeneration: 1,
              });
              expect(stored).toEqual({ heading });
              expect(depth(), `round ${round}`).toBe(after);
              expect(historyButtons()).toEqual(buttons);
            }
          }
          accepted(notice);
          // Ten saved steps, each past the 1.2 s settle: about 19 s alone,
          // over the 20 s default on a busy machine. The wait is the
          // harness's fixed settle, not a slow write.
        }, 45_000);

        /**
         * #390: the canvas reorder of a stored list is one change to the list,
         * and its Undo and Redo are history runs of their own, as #388's
         * content replays are: one awaited write each, checked against the
         * draft generation answered for the step it reverses or re-applies,
         * recording nothing new. (Drafted for #388, which could not send the
         * reorder's first write; red before the fix where noted.)
         */
        describe('"Reorder · item" on a stored list', () => {
          const reorderMessage = {
            type: "morph:storefront-preview-commit-array-item-reorder",
            sectionId: "section",
            draggedFieldPath: "items.0",
            targetFieldPath: "items.1",
          };
          /** A stored list of two, reordered (draft 1 -> 2): one entry. */
          async function reordered() {
            const [one, two] = identified();
            stored = { items: [one, two] };
            const editor = await openSection({ items: [one, two] });
            fromPreview(reorderMessage);
            await settle();
            expect(sent()).toHaveLength(1);
            expect(sent()[0]).toMatchObject({ expectedDraftGeneration: 1 });
            expect(rowsSent(sent()[0]!)).toEqual([
              [two!.id, "Two"],
              [one!.id, "One"],
            ]);
            await reread(editor.receive);
            expect(depth()).toBe("1");
            expect(historyButtons()).toEqual({ undo: true, redo: false });
            return { ...editor, one: one!, two: two! };
          }
          const order = () =>
            ((stored.items as Array<{ id: string }> | undefined) ?? []).map(
              (row) => row.id,
            );
          /** The next write waits for `release` before it is answered. */
          const heldAnswer = () => {
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            answerNext.push(async (data) => {
              await gate;
              return apply(data);
            });
            return release;
          };

          it("Undo and Redo each move history only once their own write is answered, and record nothing", async () => {
            const notice = notices();
            const { receive, one, two } = await reordered();

            const releaseUndo = heldAnswer();
            fireEvent.click(screen.getByRole("button", { name: "Undo" }));
            await settle();
            expect(sent(), "the undo is out").toHaveLength(2);
            expect(sent()[1]).toMatchObject({ expectedDraftGeneration: 2 });
            expect(depth(), "not moved before its answer").toBe("1");
            expect(historyButtons().redo).toBe(false);
            releaseUndo();
            await settle();
            await reread(receive);
            expect(order()).toEqual([one.id, two.id]);
            expect(depth()).toBe("0");
            expect(historyButtons()).toEqual({ undo: false, redo: true });

            const releaseRedo = heldAnswer();
            fireEvent.click(screen.getByRole("button", { name: "Redo" }));
            await settle();
            expect(sent(), "the redo is out").toHaveLength(3);
            expect(sent()[2]).toMatchObject({ expectedDraftGeneration: 3 });
            expect(depth(), "not moved before its answer").toBe("0");
            expect(historyButtons().undo).toBe(false);
            releaseRedo();
            await settle();
            await reread(receive);
            expect(order()).toEqual([two.id, one.id]);
            expect(depth()).toBe("1");
            expect(historyButtons()).toEqual({ undo: true, redo: false });
            accepted(notice);
          });

          it("a refused Undo, then a refused Redo, leave history and the order as they were", async () => {
            const notice = notices();
            const { receive, one, two } = await reordered();
            const refusal = () => ({
              success: false,
              error: "REFUSED_BY_MOCK",
              message: "The mock refused the replay.",
            });

            answerNext.push(refusal);
            await undo();
            expect(sent()).toHaveLength(2);
            expect(order()).toEqual([two.id, one.id]);
            expect(depth()).toBe("1");
            expect(historyButtons()).toEqual({ undo: true, redo: false });
            expect(errors(notice)).toContainEqual(
              expect.stringMatching(/^Could not undo/),
            );
            expect(unconfirmedCount()).toBeNull();
            await settle();
            expect(sent(), "nothing is sent after it").toHaveLength(2);
            expect(depth(), "nothing new is recorded").toBe("1");

            await undo();
            await reread(receive);
            expect(sent()).toHaveLength(3);
            expect(order()).toEqual([one.id, two.id]);
            expect(depth()).toBe("0");

            answerNext.push(refusal);
            await redo();
            expect(sent()).toHaveLength(4);
            expect(order()).toEqual([one.id, two.id]);
            expect(depth()).toBe("0");
            expect(historyButtons()).toEqual({ undo: false, redo: true });
            expect(errors(notice)).toContainEqual(
              expect.stringMatching(/^Could not redo/),
            );
          });

          it("two rounds of Undo then Redo: one write each, and only the reorder's entry moves", async () => {
            const notice = notices();
            const { receive, one, two } = await reordered();
            for (const round of [1, 2]) {
              await undo();
              await reread(receive);
              expect(sent(), `round ${round}: undo`).toHaveLength(round * 2);
              expect(sent().at(-1)).toMatchObject({
                expectedDraftGeneration: round * 2,
              });
              expect(order()).toEqual([one.id, two.id]);
              expect(depth(), `round ${round}: after undo`).toBe("0");
              expect(historyButtons()).toEqual({ undo: false, redo: true });

              await redo();
              await reread(receive);
              expect(sent(), `round ${round}: redo`).toHaveLength(
                round * 2 + 1,
              );
              expect(sent().at(-1)).toMatchObject({
                expectedDraftGeneration: round * 2 + 1,
              });
              expect(order()).toEqual([two.id, one.id]);
              expect(depth(), `round ${round}: after redo`).toBe("1");
              expect(historyButtons()).toEqual({ undo: true, redo: false });
            }
            accepted(notice);
          }, 45_000);

          for (const direction of ["undo", "redo"] as const) {
            it(`its ${direction}, after someone else's change to the list the editor read: refused before sending, their list kept`, async () => {
              const notice = notices();
              const { receive, one, two } = await reordered();
              if (direction === "redo") {
                await undo();
                await reread(receive);
                expect(order()).toEqual([one.id, two.id]);
              }
              const buttons = historyButtons();
              const depthBefore = depth();
              const theirs = [two, { ...one, title: "Theirs" }];
              theyWrite({ items: theirs });
              await editorReads(receive);
              const before = sent().length;

              await press(direction === "undo" ? "Undo" : "Redo");

              expect(sent(), "nothing is sent").toHaveLength(before);
              expect(stored).toEqual({ items: theirs });
              expect(depth()).toBe(depthBefore);
              expect(historyButtons()).toEqual(buttons);
              expect(errors(notice)).toContainEqual(
                expect.stringMatching(
                  direction === "undo" ? /^Could not undo/ : /^Could not redo/,
                ),
              );
            });
          }

          /** Its undo sent at draft 2, and no answer comes back. */
          async function lostReorderUndo() {
            const notice = notices();
            const editor = await reordered();
            answerNext.push(lost);

            await undo();

            expect(sent()).toHaveLength(2);
            expect(sent()[1]).toMatchObject({ expectedDraftGeneration: 2 });
            expect(rowsSent(sent()[1]!)).toEqual([
              [editor.one.id, "One"],
              [editor.two.id, "Two"],
            ]);
            expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
            expect(depth(), "history did not move").toBe("1");
            expect(historyButtons()).toEqual({ undo: true, redo: false });
            expect(errors(notice)).toContainEqual(
              expect.stringMatching(/^Could not undo/),
            );
            await settle();
            expect(sent(), "nothing is sent by itself").toHaveLength(2);
            return editor;
          }

          it("an Undo with no answer, read back as landed: history moves once, nothing is sent again, Redo still there", async () => {
            const { receive, one, two } = await lostReorderUndo();
            serverHolds({ items: [one, two] }, 3);

            await checkAndSave();

            expect(sent(), "nothing is sent again").toHaveLength(2);
            expect(unconfirmedCount()).toBeNull();
            expect(depth(), "moved once").toBe("0");
            expect(historyButtons()).toEqual({ undo: false, redo: true });

            await reread(receive);
            await redo();

            expect(sent()).toHaveLength(3);
            expect(sent()[2]).toMatchObject({ expectedDraftGeneration: 3 });
            expect(order()).toEqual([two.id, one.id]);
            expect(depth()).toBe("1");
            expect(historyButtons()).toEqual({ undo: true, redo: false });
          });

          it("an Undo with no answer, read back as not landed: sent once more, as first sent, only on Check and save", async () => {
            const { one, two } = await lostReorderUndo();
            serverHolds({ items: [two, one] }, 2);
            await settle();
            expect(sent(), "nothing is sent by itself").toHaveLength(2);

            await checkAndSave();

            expect(sent(), "sent once more").toHaveLength(3);
            expect(sent()[2]).toMatchObject({ expectedDraftGeneration: 2 });
            expect(rowsSent(sent()[2]!)).toEqual(rowsSent(sent()[1]!));
            expect(order()).toEqual([one.id, two.id]);
            expect(unconfirmedCount()).toBeNull();
            expect(depth(), "moved once, nothing new recorded").toBe("0");
            expect(historyButtons()).toEqual({ undo: false, redo: true });
            await settle();
            expect(sent(), "and nothing after it").toHaveLength(3);
          });

          /**
           * Codex review of #389/#390 (§5): another tab writes the same list
           * while the drag's write is on its way. The write goes at the draft
           * generation the editor composed it on, and the server's check
           * refuses it: their list is kept and nothing is recorded.
           */
          for (const when of [
            "before the drag, unread by the editor",
            "after the drag, before its write lands",
          ] as const) {
            it(`the drag, when another tab writes the same list ${when}: refused by the draft generation, their list kept`, async () => {
              notices();
              const [one, two] = identified();
              stored = { items: [one, two] };
              await openSection({ items: [one, two] });
              const theirs = [{ ...one!, title: "Theirs" }, two!];
              if (when === "before the drag, unread by the editor") {
                theyWrite({ items: theirs });
              } else {
                answerNext.push((data) => {
                  theyWrite({ items: theirs });
                  return apply(data);
                });
              }

              fromPreview(reorderMessage);
              await settle();

              expect(sent(), "the one refused write").toHaveLength(1);
              expect(sent()[0]).toMatchObject({ expectedDraftGeneration: 1 });
              expect(stored, "their list is kept").toEqual({ items: theirs });
              expect(draftGeneration).toBe(2);
              expect(depth(), "nothing recorded").toBe("0");
              expect(historyButtons()).toEqual({ undo: false, redo: false });
              expect(unconfirmedCount()).toBeNull();
              await settle();
              expect(sent(), "not sent again by itself").toHaveLength(1);
            });
          }
        });
      });
    });
  });

});
