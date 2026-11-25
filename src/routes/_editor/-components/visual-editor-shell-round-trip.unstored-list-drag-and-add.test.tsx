/**
 * Dragging entries of unstored and stored lists, and Add/Remove on a list nothing stores yet (including the first undoing cases).
 *
 * One of the files the former `visual-editor-shell-round-trip.test.tsx` was split into so
 * the test shards can spread it; the shared setup is in `visual-editor-shell-round-trip.harness.tsx`.
 */
import {
  PREVIEW_ORIGIN,
  PREVIEW_SESSION,
  UNANSWERED_DOCUMENT_MOVED,
  baseSearch,
  context,
  flushFrames,
  fromPreview,
  getThemeEditor,
  holdContentDebounce,
  liveFrame,
  postPreviewMessage,
  posted,
  readyQueryClient,
  recordPreviewMessage,
  saveStatus,
  updateSectionProps,
} from "./visual-editor-shell-round-trip.harness";
import { frameEnvelope } from "@/lib/test-utils/preview-frame-handshake";
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
  vi,
} from "vitest";
import type {
  StorefrontThemeEditorDTO,
} from "@/lib/storefront/dto/storefront-theme.dto";
import {
  useThemeWorkspaceStore,
} from "@/lib/storefront/store/theme-workspace-store";
import {
  storefrontThemeFileQueries,
} from "../-queries/storefront-theme-files.queries";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { VisualEditorShell } from "./visual-editor-shell";
import {
  identifyUnstoredListRows,
  normalizeDocumentRowIds,
} from "@/lib/storefront/editor/normalize-row-ids";
import {
  RESELECT_CONTENT_MESSAGE,
} from "@/lib/storefront/editor/pending-content-write";
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

  /**
   * Opens the editor on `props` and selects one title on the canvas. The
   * canvas report is taken first: rendering it replaces the document body.
   */
  async function openTitle(
    props: Record<string, unknown>,
    index: number,
    atGeneration = 1,
  ) {
    const report = await reportTitle(props, index);
    const editor = renderEntries(props, atGeneration);
    await flushFrames();
    fromPreview(report);
    await flushFrames();
    const contentTab = screen.queryByRole("button", { name: /^Content$/ });
    if (contentTab) fireEvent.click(contentTab);
    await flushFrames();
    return { report, ...editor };
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
   * Dragging one entry over another on the canvas swaps the two in the list.
   * On a list nothing stores yet the stored props hold no rows to swap, so the
   * shell refused with "cannot be mapped to a safe array position", rolled the
   * canvas back and wrote nothing. The swap starts from the rows the Inspector
   * draws: the component's declared defaults, with the ids their first edit
   * stores (the ids the row cards are keyed by).
   */
  describe("dragging an entry of a list nothing stores yet on the canvas", () => {
    const drag = (dragged: number, target: number) =>
      fromPreview({
        type: "morph:storefront-preview-commit-array-item-reorder",
        sectionId: "section",
        draggedFieldPath: `items.${dragged}`,
        targetFieldPath: `items.${target}`,
      });
    const notices = () => ({
      warning: vi.spyOn(toast, "warning").mockImplementation(() => ""),
      error: vi.spyOn(toast, "error").mockImplementation(() => ""),
    });

    it("swaps the rows as drawn, with the ids the Inspector keys them by", async () => {
      const { warning, error } = notices();
      const [one, two] = identified();
      await openTitle({}, 1);

      drag(1, 0);
      await settle();

      expect(warning).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(sent()).toHaveLength(1);
      expect(sent()[0]!.expectedDraftGeneration).toBe(1);
      expect(rowsSent(sent()[0]!)).toEqual([
        [two!.id, "Two"],
        [one!.id, "One"],
      ]);
      expect(stored.items).toEqual([
        { id: two!.id, title: "Two" },
        { id: one!.id, title: "One" },
      ]);
      expect(saveStatus()).toBe("Unpublished");
    });

    it("keeps each row's id through the edit that follows, without deriving it again", async () => {
      const { warning } = notices();
      const [one, two] = identified();
      // "Two" selected where the drop left it, once the list is stored.
      // (Taken first: it replaces the body.)
      const moved = await reportTitle({ items: [two, one] }, 0);
      expect(moved).toMatchObject({
        fieldPath: "items.0.title",
        itemId: two!.id,
      });
      const { receive } = await openTitle({}, 1);
      drag(1, 0);
      await settle();
      expect(sent()).toHaveLength(1);
      // The editor reads back what the server now holds.
      act(() => {
        receive(editorAt({ ...stored }, draftGeneration));
      });
      await flushFrames();
      fromPreview(moved);
      await flushFrames();
      const contentTab = screen.queryByRole("button", { name: /^Content$/ });
      if (contentTab) fireEvent.click(contentTab);
      await flushFrames();

      // "Two" now sits at index 0. Derived again from there, it would get
      // another id; it keeps the one it was drawn and moved with.
      await type("Two", "Two edited");
      await settle();

      expect(warning).not.toHaveBeenCalled();
      expect(sent().map((data) => data.expectedDraftGeneration)).toEqual([
        1, 2,
      ]);
      expect(rowsSent(sent()[1]!)).toEqual([
        [two!.id, "Two edited"],
        [one!.id, "One"],
      ]);
    });

    // Undo returns the list to storing nothing, not to its drawn rows written
    // into the Document: those would look the same but pin the component's
    // defaults, so a later change to them in the Theme would never show.
    const undo = async () => {
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await settle();
    };

    it("undoes to storing nothing, so the Theme's defaults show again", async () => {
      const { warning, error } = notices();
      await openTitle({}, 1);
      drag(1, 0);
      await settle();
      expect(sent()).toHaveLength(1);
      expect(stored).toHaveProperty("items");

      await undo();

      expect(warning).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]!).toMatchObject({
        props: {},
        resetProps: ["items"],
        expectedDraftGeneration: 2,
      });
      expect(stored).not.toHaveProperty("items");
    });

    it("redoes the swap after undoing it, under the same ids", async () => {
      const { warning, error } = notices();
      // A reset answers without the document, so the next write reads the
      // server's copy first; this fake server answers with what it holds.
      getThemeEditor.mockImplementation(async () => ({
        success: true,
        message: "ok",
        data: editorAt({ ...stored }, draftGeneration),
      }));
      try {
        const [one, two] = identified();
        await openTitle({}, 1);
        drag(1, 0);
        await settle();
        await undo();
        expect(stored).not.toHaveProperty("items");

        await waitFor(() =>
          expect(
            screen
              .getByRole("button", { name: "Redo" })
              .hasAttribute("disabled"),
          ).toBe(false),
        );
        fireEvent.click(screen.getByRole("button", { name: "Redo" }));
        await settle();

        expect(warning).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(sent()).toHaveLength(3);
        expect(sent()[2]!.expectedDraftGeneration).toBe(3);
        expect(rowsSent(sent()[2]!)).toEqual([
          [two!.id, "Two"],
          [one!.id, "One"],
        ]);
        expect(saveStatus()).toBe("Unpublished");
      } finally {
        getThemeEditor.mockReset();
      }
    });

    /**
     * The first drag's Undo removes the list again and its Redo stores the
     * swapped rows again, each as a history run of its own (#388): one
     * awaited write, checked against the draft generation answered for the
     * step it reverses or re-applies, recording nothing new. Red where the
     * Undo is sent unchecked at whatever generation is held, or the Redo
     * goes through the pending input path (which records a second entry).
     */
    describe("Undo and Redo of the first drag, as history runs of their own", () => {
      const depth = () =>
        document
          .querySelector("[data-editor-undo-depth]")
          ?.getAttribute("data-editor-undo-depth") ?? null;
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
      const errors = (notice: ReturnType<typeof notices>) =>
        notice.error.mock.calls.map((call) => String(call[0]));
      /** The route's read of the Theme: what the fake server holds now. */
      const reread = async (
        receive: (next: StorefrontThemeEditorDTO) => void,
      ) => {
        act(() => receive(editorAt({ ...stored }, draftGeneration)));
        await flushFrames();
      };

      beforeEach(() => {
        // A reset answers without the document, so a later write may read
        // the server's copy first; this fake server answers with what it
        // holds.
        getThemeEditor.mockImplementation(async () => ({
          success: true,
          message: "ok",
          data: editorAt({ ...stored }, draftGeneration),
        }));
      });
      afterEach(() => {
        getThemeEditor.mockReset();
      });

      /** "Two" dropped on "One": one write (draft 1 -> 2), one entry. */
      async function firstDrag() {
        const editor = await openTitle({}, 1);
        drag(1, 0);
        await settle();
        await reread(editor.receive);
        expect(sent()).toHaveLength(1);
        expect(depth()).toBe("1");
        expect(historyButtons()).toEqual({ undo: true, redo: false });
        return editor;
      }

      it("two rounds: Undo removes the list again, Redo stores the swapped rows under the same ids, and nothing else is recorded", async () => {
        const notice = notices();
        const [one, two] = identified();
        const swapped = [
          { id: two!.id, title: "Two" },
          { id: one!.id, title: "One" },
        ];
        const { receive } = await firstDrag();
        expect(stored.items).toEqual(swapped);

        for (const round of [1, 2]) {
          await press("Undo");
          await reread(receive);
          expect(sent(), `round ${round}: undo sent once`).toHaveLength(
            round * 2,
          );
          expect(sent().at(-1)!).toMatchObject({
            props: {},
            resetProps: ["items"],
            expectedDraftGeneration: round * 2,
            expectedSourceGeneration: 1,
          });
          expect(stored, `round ${round}: nothing stored`).not.toHaveProperty(
            "items",
          );
          expect(depth(), `round ${round}: after undo`).toBe("0");
          expect(historyButtons()).toEqual({ undo: false, redo: true });

          await press("Redo");
          await reread(receive);
          expect(sent(), `round ${round}: redo sent once`).toHaveLength(
            round * 2 + 1,
          );
          expect(sent().at(-1)!).toMatchObject({
            expectedDraftGeneration: round * 2 + 1,
            expectedSourceGeneration: 1,
          });
          expect(rowsSent(sent().at(-1)!)).toEqual([
            [two!.id, "Two"],
            [one!.id, "One"],
          ]);
          expect(stored.items, `round ${round}: the swapped rows`).toEqual(
            swapped,
          );
          expect(depth(), `round ${round}: after redo`).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
        }
        expect(notice.warning).not.toHaveBeenCalled();
        expect(notice.error).not.toHaveBeenCalled();
      }, 45_000);

      it("a refused Undo leaves the history, the data and the entries as they were, and says so", async () => {
        const notice = notices();
        await firstDrag();
        const before = structuredClone(stored);
        updateSectionProps.mockImplementationOnce(async () => ({
          success: false,
          error: "REFUSED_BY_MOCK",
          message: "The mock refused the undo.",
        }));

        await press("Undo");

        expect(sent(), "the undo is sent once").toHaveLength(2);
        expect(sent()[1]!).toMatchObject({
          props: {},
          resetProps: ["items"],
          expectedDraftGeneration: 2,
        });
        expect(stored, "the Document is unchanged").toEqual(before);
        expect(depth(), "history did not move").toBe("1");
        expect(historyButtons()).toEqual({ undo: true, redo: false });
        expect(errors(notice)).toContainEqual(
          expect.stringMatching(/^Could not undo/),
        );
        await settle();
        expect(sent(), "nothing is sent after it").toHaveLength(2);
        expect(depth(), "nothing new is recorded").toBe("1");
      });

      for (const direction of ["undo", "redo"] as const) {
        it(`a ${direction} after another tab's change the editor has read: refused before sending, their list kept`, async () => {
          const notice = notices();
          const { receive } = await firstDrag();
          if (direction === "redo") {
            await press("Undo");
            await reread(receive);
            expect(stored).not.toHaveProperty("items");
            expect(historyButtons()).toEqual({ undo: false, redo: true });
          }
          const buttons = historyButtons();
          const depthBefore = depth();
          // Another tab: same source generation, the Document one step on.
          const theirs = { items: [{ id: "theirs-1", title: "Theirs" }] };
          stored = structuredClone(theirs);
          draftGeneration += 1;
          await reread(receive);
          const before = sent().length;

          await press(direction === "undo" ? "Undo" : "Redo");

          expect(
            sent(),
            "nothing is sent over a step that was not this editor's own",
          ).toHaveLength(before);
          expect(stored, "their list is kept").toEqual(theirs);
          expect(depth(), "history did not move").toBe(depthBefore);
          expect(historyButtons()).toEqual(buttons);
          expect(errors(notice)).toContainEqual(
            expect.stringMatching(
              direction === "undo" ? /^Could not undo/ : /^Could not redo/,
            ),
          );
          await settle();
          expect(sent(), "nothing is sent after it").toHaveLength(before);
        });
      }
    });
  });

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
    /** Presses Remove on the card drawn for the row whose title is `title`. */
    const removeRow = async (title: string) => {
      const input = (await screen.findAllByDisplayValue(title))[0]!;
      const card = input.closest<HTMLElement>('[class*="bg-muted/30"]');
      expect(card, `the card drawn for "${title}"`).toBeTruthy();
      const button = Array.from(card!.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === "Remove",
      );
      expect(button, `the Remove button of "${title}"`).toBeTruthy();
      fireEvent.click(button!);
      await settle();
    };
    const THREE = [{ title: "One" }, { title: "Two" }, { title: "Three" }];
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
    /** The write's version fields, as sent. */
    const versionsSent = (data: Record<string, unknown>) => ({
      expectedDraftGeneration: data.expectedDraftGeneration,
      expectedSourceGeneration: data.expectedSourceGeneration,
    });
    const accepted = (notice: ReturnType<typeof notices>) => {
      expect(notice.warning).not.toHaveBeenCalled();
      expect(notice.error).not.toHaveBeenCalled();
      expect(saveStatus()).toBe("Unpublished");
    };

    it("first Add sends the drawn defaults with their ids, in order, plus one new row, at the current generations", async () => {
      const notice = notices();
      const [one, two] = identified();
      const precondition = editorAt({}, 1).templates[0]!.document.sections[0]!;
      expect(precondition.props).not.toHaveProperty("items");
      await openSection({});

      await addEntry();

      expect(sent()).toHaveLength(1);
      const write = sent()[0]!;
      expect(versionsSent(write)).toEqual({
        expectedDraftGeneration: 1,
        expectedSourceGeneration: 1,
      });
      expect(write).not.toHaveProperty("resetProps");
      expect(Object.keys(write.props as object)).toEqual(["items"]);
      const rows = rowsSent(write);
      expect(rows).toHaveLength(3);
      expect(rows.slice(0, 2)).toEqual([
        [one!.id, "One"],
        [two!.id, "Two"],
      ]);
      const added = rows[2]![0] as string;
      expect(added).toMatch(/^morph-/);
      expect(added.startsWith("morph-mig-")).toBe(false);
      expect([one!.id, two!.id]).not.toContain(added);
      accepted(notice);
      expect((stored.items as unknown[]).length).toBe(3);
    });

    it("first Remove of the middle of three drawn rows drops exactly that row and keeps the first and third with their ids", async () => {
      defaults = THREE;
      const notice = notices();
      const [one, two, three] = identified();
      // The ids the panel keys the drawn rows by are the server's.
      expect(
        identifyUnstoredListRows("items", THREE, {
          templateId: context.templates[0]!.id,
          sectionId: "section",
        }),
      ).toEqual([one, two, three]);
      await openSection({});
      expect(panelTitles()).toEqual(["One", "Two", "Three"]);

      await removeRow("Two");

      expect(sent()).toHaveLength(1);
      const write = sent()[0]!;
      expect(versionsSent(write)).toEqual({
        expectedDraftGeneration: 1,
        expectedSourceGeneration: 1,
      });
      expect(write).not.toHaveProperty("resetProps");
      expect(rowsSent(write)).toEqual([
        [one!.id, "One"],
        [three!.id, "Three"],
      ]);
      accepted(notice);
      expect(stored.items).toEqual([
        { id: one!.id, title: "One" },
        { id: three!.id, title: "Three" },
      ]);
      expect(panelTitles()).toEqual(["One", "Three"]);
    });

    // Task 41 R4-1: the copy an unanswered write was composed on is let go
    // when the write ends any way at all. Left behind by a refused resend, it
    // was read later as the basis of the list reset that undid the next Add,
    // and the reset (found landed) was not named as a saved change.
    it("names a list reset found landed by its own basis, not by an earlier refused write's (R4-1)", async () => {
      vi.spyOn(toast, "error").mockImplementation(() => "");
      vi.spyOn(toast, "warning").mockImplementation(() => "");
      getThemeEditor.mockImplementation(async () => ({
        success: true,
        message: "ok",
        data: editorAt({ ...stored }, draftGeneration),
      }));
      const write = updateSectionProps.getMockImplementation()!;
      const tryAgain = async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
        await settle();
      };
      const { receive, client } = await openSection({});

      // The first Add gets no answer, and did not land.
      updateSectionProps.mockImplementationOnce(async () => {
        throw new Error("offline");
      });
      await addEntry();
      expect(saveStatus()).toBe("Save failed");
      // Read back not landed, resent, and refused by an answer.
      updateSectionProps.mockImplementationOnce(
        async () =>
          ({
            success: false,
            error: "CONTENT_INVALID",
            message: "Refused.",
          }) as never,
      );
      await tryAgain();
      expect(stored).not.toHaveProperty("items");
      // Sent once more, and stored.
      await tryAgain();
      expect((stored.items as unknown[]).length).toBe(3);
      await reread(receive);

      // Undo is a reset of the list (it was stored by nothing before). It
      // lands, and its answer is lost.
      updateSectionProps.mockImplementationOnce(async (args) => {
        await write(args);
        throw new Error("offline");
      });
      await undo();
      expect(stored).not.toHaveProperty("items");
      // Read back: landed, a saved change of the list.
      await tryAgain();
      await reread(receive);

      // The next Add meets another writer's list; the author discards it.
      updateSectionProps.mockImplementationOnce(
        async () =>
          ({
            success: false,
            error: "TEMPLATE_DRAFT_CONFLICT",
            message: "Template draft was modified concurrently.",
          }) as never,
      );
      await addEntry();
      stored = { ...stored, items: [{ id: "x", title: "X" }] };
      draftGeneration += 1;
      client.setQueryData(
        storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
        {
          success: true,
          message: "ok",
          data: editorAt({ ...stored }, draftGeneration),
        } as never,
      );
      act(() =>
        screen.getByRole("button", { name: "Load latest, keep mine" }).click(),
      );
      fireEvent.click(
        await screen.findByRole("button", {
          name: /discard unsaved changes to entries/i,
        }),
      );
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent).toMatch(/A saved change is not undone/);
    });

    it("undo of the first Add stores nothing again, and redo writes the added list back with the same ids", async () => {
      const notice = notices();
      const { receive } = await openSection({});
      await addEntry();
      await reread(receive);
      expect(sent()).toHaveLength(1);
      const added = (sent()[0]!.props as { items: unknown[] }).items;
      expect(added).toHaveLength(3);

      await undo();

      expect(sent(), "undo sends one write").toHaveLength(2);
      const reset = sent()[1]!;
      expect(reset).toMatchObject({
        templateId: "template-1",
        sectionId: "section",
        props: {},
        resetProps: ["items"],
        expectedDraftGeneration: 2,
        expectedSourceGeneration: 1,
      });
      expect(reset.props, "no rows are written back").not.toHaveProperty(
        "items",
      );
      expect(stored, "the Document stores no items again").not.toHaveProperty(
        "items",
      );
      accepted(notice);
      await reread(receive);
      expect(historyButtons()).toEqual({ undo: false, redo: true });
      expect(panelTitles()).toEqual(["One", "Two"]);

      await redo();

      expect(sent(), "redo sends one write").toHaveLength(3);
      const again = sent()[2]!;
      expect(again).not.toHaveProperty("resetProps");
      expect(versionsSent(again)).toEqual({
        expectedDraftGeneration: 3,
        expectedSourceGeneration: 1,
      });
      expect((again.props as { items: unknown }).items).toEqual(added);
      expect(stored.items).toEqual(added);
      accepted(notice);
      await reread(receive);
      expect(historyButtons()).toEqual({ undo: true, redo: false });
      expect(panelTitles()).toEqual(["One", "Two", ""]);
    });

    it("undo of the first Remove stores nothing again, and redo writes the shortened list back with the same ids", async () => {
      defaults = THREE;
      const notice = notices();
      const [one, , three] = identified();
      const { receive } = await openSection({});
      await removeRow("Two");
      await reread(receive);
      expect(sent()).toHaveLength(1);

      await undo();

      expect(sent(), "undo sends one write").toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: "template-1",
        sectionId: "section",
        props: {},
        resetProps: ["items"],
        expectedDraftGeneration: 2,
        expectedSourceGeneration: 1,
      });
      expect(stored, "the Document stores no items again").not.toHaveProperty(
        "items",
      );
      accepted(notice);
      await reread(receive);
      expect(historyButtons()).toEqual({ undo: false, redo: true });
      expect(panelTitles()).toEqual(["One", "Two", "Three"]);

      await redo();

      expect(sent(), "redo sends one write").toHaveLength(3);
      const again = sent()[2]!;
      expect(again).not.toHaveProperty("resetProps");
      expect(versionsSent(again)).toEqual({
        expectedDraftGeneration: 3,
        expectedSourceGeneration: 1,
      });
      expect(rowsSent(again)).toEqual([
        [one!.id, "One"],
        [three!.id, "Three"],
      ]);
      expect(stored.items).toEqual([
        { id: one!.id, title: "One" },
        { id: three!.id, title: "Three" },
      ]);
      accepted(notice);
      await reread(receive);
      expect(historyButtons()).toEqual({ undo: true, redo: false });
      expect(panelTitles()).toEqual(["One", "Three"]);
    });

    // The reset is answered with a refusal, or gets no answer: the history
    // must not claim the reversal, and the change stays on screen.
    for (const [label, answerReset] of [
      [
        "refused",
        async () => ({
          success: false,
          error: "REFUSED_BY_MOCK",
          message: "The mock refused the reset.",
        }),
      ],
      [
        "unanswered",
        async () => {
          throw new Error("offline");
        },
      ],
    ] as const) {
      it(`undo of the first Add whose reset is ${label} keeps the entry, the change and says so`, async () => {
        const notice = notices();
        const { receive } = await openSection({});
        await addEntry();
        await reread(receive);
        expect(sent()).toHaveLength(1);
        const added = stored.items;
        const answerWrites = updateSectionProps.getMockImplementation()!;
        updateSectionProps.mockImplementation(async (call) =>
          (call.data.resetProps as string[] | undefined)?.length
            ? answerReset()
            : answerWrites(call),
        );

        await undo();

        expect(sent(), "the reset was sent").toHaveLength(2);
        expect(sent()[1]).toMatchObject({ resetProps: ["items"] });
        expect(stored.items, "the mock store kept the list").toEqual(added);
        expect(historyButtons(), "history did not move").toEqual({
          undo: true,
          redo: false,
        });
        expect(panelTitles(), "the panel still shows the Add").toEqual([
          "One",
          "Two",
          "",
        ]);
        expect(
          notice.error.mock.calls.map((call) => String(call[0])),
        ).toContainEqual(expect.stringMatching(/^Could not undo/));

        // The entry is still there to retry once the store answers again.
        updateSectionProps.mockImplementation(answerWrites);
        if (label === "unanswered") {
          // #388 round 3 (A3) changed this half. An unanswered reset may have
          // landed, so it is read back before anything is sent again: the
          // next Undo is held (the existing unconfirmed hold), and Check and
          // save reads the Document back, finds the list still stored at the
          // generation the reset was sent at (not landed), and sends it once
          // more, as first sent. Before A3 the next Undo resent it at once,
          // with no read-back.
          await undo();
          expect(sent(), "the next Undo is held").toHaveLength(2);
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          getThemeEditor.mockResolvedValue({
            success: true,
            message: "ok",
            data: editorAt({ ...stored }, draftGeneration),
          });
          fireEvent.click(
            await screen.findByRole("button", { name: "Check and save" }),
          );
          await settle();
          expect(sent()).toHaveLength(3);
          expect(sent()[2]).toMatchObject({
            props: {},
            resetProps: ["items"],
            expectedDraftGeneration: 2,
            expectedSourceGeneration: 1,
          });
          expect(stored).not.toHaveProperty("items");
          expect(historyButtons()).toEqual({ undo: false, redo: true });
          return;
        }
        await undo();
        expect(sent()).toHaveLength(3);
        expect(sent()[2]).toMatchObject({
          props: {},
          resetProps: ["items"],
          expectedSourceGeneration: 1,
        });
        expect(stored).not.toHaveProperty("items");
        expect(historyButtons()).toEqual({ undo: false, redo: true });
      });
    }

    it("control: on a stored list, Add appends to the stored rows with their ids unchanged", async () => {
      const notice = notices();
      const [one, two] = identified();
      stored = { items: [one, two] };
      await openSection({ items: [one, two] });

      await addEntry();

      expect(sent()).toHaveLength(1);
      const write = sent()[0]!;
      expect(versionsSent(write)).toEqual({
        expectedDraftGeneration: 1,
        expectedSourceGeneration: 1,
      });
      const rows = rowsSent(write);
      expect(rows.slice(0, 2)).toEqual([
        [one!.id, "One"],
        [two!.id, "Two"],
      ]);
      expect(rows).toHaveLength(3);
      expect(rows[2]![0]).toMatch(/^morph-/);
      expect([one!.id, two!.id]).not.toContain(rows[2]![0]);
      accepted(notice);
    });

    it("marks a server-refused Add as not saved while retaining the list draft", async () => {
      updateSectionProps.mockResolvedValueOnce({
        success: false,
        error: "TEMPLATE_DRAFT_CONFLICT",
        message: "Template draft was modified concurrently.",
      } as never);
      await openSection({});

      await addEntry();

      expect(sent()).toHaveLength(1);
      expect(stored).not.toHaveProperty("items");
      expect(panelTitles()).toHaveLength(3);
      expect(await screen.findByText("Not saved")).toBeTruthy();
      expect(
        screen.getByText(
          "The server did not save this list. Use the recovery controls above to continue.",
        ),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Load latest, keep mine" }),
      ).toBeTruthy();
    });

    it("control: on a stored list, Remove drops the row at the pressed index with the other's id unchanged", async () => {
      const notice = notices();
      const [one, two] = identified();
      stored = { items: [one, two] };
      await openSection({ items: [one, two] });

      await removeRow("Two");

      expect(sent()).toHaveLength(1);
      expect(versionsSent(sent()[0]!)).toEqual({
        expectedDraftGeneration: 1,
        expectedSourceGeneration: 1,
      });
      expect(rowsSent(sent()[0]!)).toEqual([[one!.id, "One"]]);
      accepted(notice);
      expect(stored.items).toEqual([{ id: one!.id, title: "One" }]);
    });

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
       * The heading's debounce runs out before the frame acknowledges the
       * heading's preview: its write leaves alone, on the proof taken at the
       * input. The Add the author presses once the acknowledgement is back
       * is a second write, after the first, on the copy the first answered,
       * with its own history entry. Nothing merges them.
       */
      describe("an Add pressed after the heading's write already left", () => {
        const depth = () =>
          document
            .querySelector("[data-editor-undo-depth]")
            ?.getAttribute("data-editor-undo-depth") ?? null;
        /** The frame acknowledges, after its DOM commit, what it was posted. */
        const acknowledge = (message: Record<string, unknown>) => {
          const token = message.presentationToken as { operationId: string };
          const frame = document.querySelector("iframe");
          act(() => {
            window.dispatchEvent(
              new MessageEvent("message", {
                data: frameEnvelope({
                  type: "morph:storefront-preview-section-presentation-ack",
                  previewSession: PREVIEW_SESSION,
                  operationId: token.operationId,
                  token: message.presentationToken,
                  status: "applied",
                }),
                origin: PREVIEW_ORIGIN,
                source: frame?.contentWindow ?? null,
              }),
            );
          });
        };

        it("is a second write, in order, at the generation the first answered, and a second history entry", async () => {
          stored = { ...STORED };
          await openSection({ ...STORED });
          const heading = (await screen.findAllByDisplayValue("Hello"))[0]!;
          const add = (await screen.findByRole("button", {
            name: "Add entry",
          })) as HTMLButtonElement;
          expect(depth()).toBe("0");
          // The frame receives the section posts but has not acknowledged
          // them yet.
          const withheld: Array<Record<string, unknown>> = [];
          postPreviewMessage.mockImplementation(
            (target: unknown, message: Record<string, unknown>) => {
              if (
                message.type ===
                  "morph:storefront-preview-update-section-props" &&
                message.presentationToken
              ) {
                posted.push(message);
                withheld.push(message);
                return;
              }
              recordPreviewMessage(target, message);
            },
          );
          const debounce = holdContentDebounce();
          try {
            fireEvent.input(heading, { target: { value: "New" } });
            fireEvent.blur(heading);
            await flushFrames();
            expect(withheld.length, "the heading's preview is posted").toBe(1);
            expect(debounce.count()).toBe(1);
            // The debounce runs out first: the heading's write leaves alone.
            await act(async () => {
              debounce.fire();
            });
            await waitFor(() => expect(depth()).toBe("1"));
            expect(sent()).toHaveLength(1);
            expect(sent()[0]).toMatchObject({
              props: { heading: "New" },
              expectedDraftGeneration: 1,
              expectedSourceGeneration: 1,
            });
            expect(Object.keys(sent()[0]!.props as object)).toEqual([
              "heading",
            ]);
            expect(stored).toEqual({ heading: "New" });

            // Then the frame acknowledges what it was posted, and the author
            // presses Add.
            postPreviewMessage.mockImplementation(recordPreviewMessage);
            for (const message of withheld.splice(0)) acknowledge(message);
            await waitFor(() => expect(add.disabled).toBe(false));
            fireEvent.click(add);
            expect(sent(), "the Add waits out its own debounce").toHaveLength(1);
            expect(debounce.count()).toBe(1);
            await act(async () => {
              debounce.fire();
            });
          } finally {
            debounce.restore();
          }
          await waitFor(() => expect(sent()).toHaveLength(2));
          const second = sent()[1]!;
          expect(second).toMatchObject({
            expectedDraftGeneration: 2,
            expectedSourceGeneration: 1,
          });
          expect(
            (second.props as { items?: unknown[] }).items,
            "the Add's entry, with the drawn defaults",
          ).toHaveLength(3);
          await waitFor(() => expect(depth()).toBe("2"));
          await settle();
          expect(sent(), "exactly two writes").toHaveLength(2);
          expect(depth(), "two history entries").toBe("2");
          expect(stored.heading).toBe("New");
          expect(stored.items as unknown[]).toHaveLength(3);
        });
      });
      describe("an unanswered ordinary content write", () => {
        const depth = () =>
          document
            .querySelector("[data-editor-undo-depth]")
            ?.getAttribute("data-editor-undo-depth") ?? null;
        const historyButtons = () => ({
          undo: !screen
            .getByRole("button", { name: "Undo" })
            .hasAttribute("disabled"),
          redo: !screen
            .getByRole("button", { name: "Redo" })
            .hasAttribute("disabled"),
        });

        async function lostOrdinaryWrite() {
          stored = { ...STORED };
          const editor = await openSection({ ...STORED });
          answerNext.push(lost);
          await type("Hello", "New");
          await settle();
          expect(sent()).toHaveLength(1);
          expect(unconfirmedCount()).toBe("1");
          expect(saveStatus()).toBe("Save failed");
          return editor;
        }

        it("resends once at the frozen basis and keeps tracking if that resend gets no answer", async () => {
          await lostOrdinaryWrite();
          serverHolds({ ...STORED }, 1);
          // A same-generation read proves only that the original did not land
          // before this read. The explicit resend can also lose its answer.
          answerNext.push(lost);

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(sent()[1]).toMatchObject({
            props: { heading: "New" },
            expectedDraftGeneration: 1,
            expectedSourceGeneration: 1,
          });
          expect(unconfirmedCount(), "the request is still unresolved").toBe(
            "1",
          );
          expect(saveStatus(), "it is not reported as saved").toBe(
            "Save failed",
          );
          expect(depth(), "no history entry exists yet").toBe("0");
          expect(historyButtons()).toEqual({ undo: false, redo: false });
        });

        it("records a successful same-basis resend once and undoes it from its answer", async () => {
          const { receive } = await lostOrdinaryWrite();
          serverHolds({ ...STORED }, 1);

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(sent()[1]).toMatchObject({
            props: { heading: "New" },
            expectedDraftGeneration: 1,
            expectedSourceGeneration: 1,
          });
          expect(unconfirmedCount()).toBeNull();
          expect(depth(), "the saved edit is recorded once").toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });

          await reread(receive);
          await undo();

          expect(sent()).toHaveLength(3);
          expect(sent()[2]).toMatchObject({
            props: { heading: "Hello" },
            expectedDraftGeneration: 2,
            expectedSourceGeneration: 1,
          });
          expect(stored).toEqual({ heading: "Hello" });
          expect(depth()).toBe("0");
          expect(historyButtons()).toEqual({ undo: false, redo: true });
        });

        it("turns a moved unanswered write into a recoverable conflict", async () => {
          await lostOrdinaryWrite();
          serverHolds({ heading: "Theirs" }, 2);

          await checkAndSave();

          expect(sent(), "the old payload is not resent").toHaveLength(1);
          expect(
            unconfirmedCount(),
            "the moved request no longer holds the session",
          ).toBeNull();
          expect(saveStatus()).toBe("Out of date");
          expect(
            screen.getByRole("button", { name: "Load latest, keep mine" }),
          ).toBeTruthy();
          expect(screen.getAllByDisplayValue("New").length).toBeGreaterThan(0);

          fireEvent.click(
            screen.getByRole("button", { name: "Load latest, keep mine" }),
          );
          await waitFor(() => expect(sent()).toHaveLength(2));
          expect(sent()[1]).toMatchObject({
            props: { heading: "New" },
            expectedDraftGeneration: 2,
            expectedSourceGeneration: 1,
          });
          expect(stored).toEqual({ heading: "New" });
          expect(unconfirmedCount()).toBeNull();
        });

        it("resends a not-landed ordinary write once at its original basis", async () => {
          await lostOrdinaryWrite();
          serverHolds({ ...STORED }, 1);

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(sent()[1]).toMatchObject({
            props: { heading: "New" },
            expectedDraftGeneration: 1,
            expectedSourceGeneration: 1,
          });
          expect(stored).toEqual({ heading: "New" });
          expect(unconfirmedCount()).toBeNull();
          expect(depth()).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
        });

        it("explains that the write is still held when its one resend gets no answer", async () => {
          const notice = notices();
          await lostOrdinaryWrite();
          serverHolds({ ...STORED }, 1);
          answerNext.push(lost);

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(unconfirmedCount()).toBe("1");
          expect(errors(notice)).toContain(
            "An earlier save is still unresolved. Check again before trying other changes.",
          );
        });

        it("confirms a resend refused as out of date when the late original won the compare-and-swap race", async () => {
          // Round 3 R3-3 (the user's rule: landed is confirmed). The resend's
          // refusal proves only that the Document moved; read back once more
          // with the frozen write, one generation on with its content, it is
          // this write's own step: confirmed, recorded once, no conflict.
          // (Before, this took it as moved, said "not sent again" for a
          // write that was sent, and lost the step from history.)
          const notice = notices();
          await lostOrdinaryWrite();
          const original = sent()[0]!;
          serverHolds({ ...STORED }, 1);
          // Every read answers what the server holds when it is read.
          getThemeEditor.mockImplementation(async () => ({
            success: true,
            message: "ok",
            data: editorAt({ ...stored }, draftGeneration),
          }));
          answerNext.push((retry) => {
            const originalAnswer = apply(original);
            expect(originalAnswer).toMatchObject({ success: true });
            return apply(retry);
          });

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(sent()[1]).toMatchObject({
            props: { heading: "New" },
            expectedDraftGeneration: 1,
          });
          expect(stored).toEqual({ heading: "New" });
          expect(draftGeneration).toBe(2);
          expect(unconfirmedCount(), "not held again").toBeNull();
          expect(saveStatus()).not.toBe("Out of date");
          expect(
            screen.queryByRole("button", { name: "Load latest, keep mine" }),
          ).toBeNull();
          expect(errors(notice)).not.toContainEqual(
            expect.stringContaining("changed elsewhere"),
          );
          // Round 4 R4-3(a): the resend's refusal is read back before the
          // author is told anything: no conflict toast for a landed write.
          expect(errors(notice)).not.toContain(
            "Template draft was modified concurrently.",
          );
          expect(depth(), "the landed edit is recorded once").toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          await settle();
          expect(sent(), "and never sent a third time").toHaveLength(2);

          await undo();
          expect(sent()).toHaveLength(3);
          expect(sent()[2]).toMatchObject({
            props: { heading: "Hello" },
            expectedDraftGeneration: 2,
          });
          expect(stored).toEqual({ heading: "Hello" });
          expect(depth()).toBe("0");
        });

        it("reads again after its resend's refusal without cancelling a read already in flight", async () => {
          // Round 5 R5-1: a read of the Theme already out when the refusal
          // comes back was asked before it. The answer that decides is one
          // asked for after the refusal, and the earlier read's own awaiter
          // still gets its answer (it is not cancelled).
          const notice = notices();
          const { client } = await lostOrdinaryWrite();
          const original = sent()[0]!;
          serverHolds({ ...STORED }, 1);
          const live = async () => ({
            success: true,
            message: "ok",
            data: editorAt({ ...stored }, draftGeneration),
          });
          let answerEarlier!: (value: unknown) => void;
          let earlier: Promise<unknown> | undefined;
          answerNext.push((retry) => {
            getThemeEditor.mockImplementation(live);
            getThemeEditor.mockImplementationOnce(
              () =>
                new Promise((resolve) => {
                  answerEarlier = resolve;
                }),
            );
            // Asked before the refusal, as the route's own reads are.
            earlier = client.fetchQuery({
              ...storefrontThemeQueries.detail("storefront-1", "theme-1"),
              staleTime: 0,
            });
            // The late original lands; the resend is refused as out of date.
            expect(apply(original)).toMatchObject({ success: true });
            return apply(retry);
          });

          fireEvent.click(
            await screen.findByRole("button", { name: "Check and save" }),
          );
          await waitFor(() => expect(unconfirmedCount()).toBeNull());
          await settle();

          expect(sent()).toHaveLength(2);
          expect(stored).toEqual({ heading: "New" });
          // Decided by the read after the refusal: landed, recorded once.
          expect(depth(), "confirmed by the newer read").toBe("1");
          expect(saveStatus()).not.toBe("Out of date");
          expect(errors(notice)).not.toContainEqual(
            expect.stringContaining("changed elsewhere"),
          );
          // The earlier read is answered as it was asked: not cancelled (a
          // cancelled read hands its awaiter the cache's older answer, or
          // CancelledError when there is none).
          act(() =>
            answerEarlier({
              success: true,
              message: "earlier read",
              data: editorAt({ ...STORED }, 1),
            }),
          );
          await expect(earlier).resolves.toMatchObject({
            success: true,
            message: "earlier read",
          });
        });

        it("keeps the write held when the read after its resend's refusal gets no answer", async () => {
          // Round 4 R4-5: the refusal proves the Document moved; whether the
          // original landed is still unknown until a read answers.
          const notice = notices();
          await lostOrdinaryWrite();
          serverHolds({ ...STORED }, 1);
          answerNext.push(() => ({
            success: false,
            error: "TEMPLATE_DRAFT_CONFLICT",
            message: "Template draft was modified concurrently.",
          }));
          getThemeEditor
            .mockResolvedValueOnce({
              success: true,
              message: "ok",
              data: editorAt({ ...STORED }, 1),
            })
            .mockRejectedValueOnce(new Error("offline"));

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(unconfirmedCount(), "still unknown: held").toBe("1");
          expect(saveStatus()).toBe("Save failed");
          expect(errors(notice)).toContain(
            "An earlier save is still unresolved. Check again before trying other changes.",
          );
          expect(errors(notice)).not.toContainEqual(
            expect.stringContaining("changed elsewhere"),
          );
          expect(depth()).toBe("0");
        });

        it("does not send in the same press a write read back as moved", async () => {
          // Round 3 R3-1(a): a write the read-back just took as moved (here:
          // the section is not in the Document at its own generation) is out
          // of date; the same Try again does not send its input anyway.
          const notice = notices();
          await lostOrdinaryWrite();
          const read = editorAt({ ...STORED }, 1);
          getThemeEditor.mockResolvedValue({
            success: true,
            message: "ok",
            data: {
              ...read,
              templates: [
                {
                  ...read.templates[0]!,
                  document: { version: 1, sections: [] },
                },
              ],
            } as StorefrontThemeEditorDTO,
          });

          await checkAndSave();

          expect(errors(notice)).toContain(UNANSWERED_DOCUMENT_MOVED);
          expect(sent(), "not sent again, as the message says").toHaveLength(1);
          expect(unconfirmedCount()).toBeNull();
          expect(saveStatus()).toBe("Out of date");
        });

        it("does not hold a resend the server refused for another reason, and says why", async () => {
          const notice = notices();
          await lostOrdinaryWrite();
          serverHolds({ ...STORED }, 1);
          answerNext.push(() => ({
            success: false,
            error: "REFUSED_BY_MOCK",
            message: "The mock refused the resend.",
          }));

          await checkAndSave();

          expect(sent()).toHaveLength(2);
          expect(unconfirmedCount(), "an answer: not held again").toBeNull();
          expect(saveStatus()).toBe("Save failed");
          expect(errors(notice)).toContain("The mock refused the resend.");
          expect(errors(notice)).not.toContain(
            "An earlier save is still unresolved. Check again before trying other changes.",
          );
          expect(stored).toEqual({ ...STORED });

          // Not held forever: the next Try again sends the kept input.
          fireEvent.click(screen.getByRole("button", { name: "Try again" }));
          await settle();
          expect(sent()).toHaveLength(3);
          expect(sent()[2]).toMatchObject({
            props: { heading: "New" },
            expectedDraftGeneration: 1,
          });
          expect(stored).toEqual({ heading: "New" });
          expect(unconfirmedCount()).toBeNull();
          expect(depth(), "recorded once").toBe("1");
        });

        it("two simultaneous recovery actions settle one landed write while newer input remains pending", async () => {
          await lostOrdinaryWrite();
          await type("New", "Newer");
          await settle();
          expect(
            sent(),
            "new input stays behind the unknown write",
          ).toHaveLength(1);
          serverHolds({ heading: "New" }, 2);
          const retry = screen.getByRole("button", { name: "Try again" });
          const checkAndSave = screen.getByRole("button", {
            name: "Check and save",
          });

          act(() => {
            retry.click();
            checkAndSave.click();
          });
          await waitFor(() => expect(sent()).toHaveLength(2));

          expect(sent()[1]).toMatchObject({
            props: { heading: "Newer" },
            expectedDraftGeneration: 2,
          });
          expect(unconfirmedCount()).toBeNull();
          expect(
            depth(),
            "the landed write and newer input are each recorded once",
          ).toBe("2");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
        });

        it("leaves tracking and local state unchanged when readback fails", async () => {
          await lostOrdinaryWrite();
          getThemeEditor.mockRejectedValueOnce(new Error("offline"));
          const before = { ...stored };

          await checkAndSave();

          expect(sent()).toHaveLength(1);
          expect(unconfirmedCount()).toBe("1");
          expect(stored).toEqual(before);
          expect(saveStatus()).toBe("Save failed");
          expect(depth()).toBe("0");
          expect(historyButtons()).toEqual({ undo: false, redo: false });
        });

        it("keeps the answered-write history behavior as a control", async () => {
          stored = { ...STORED };
          await openSection({ ...STORED });

          await type("Hello", "New");
          await settle();

          expect(sent()).toHaveLength(1);
          expect(unconfirmedCount()).toBeNull();
          expect(depth()).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
        });
      });

      /**
       * Replay integrity (red before the fix where the replay records a
       * second "Content" entry): a successful Undo or Redo moves only the
       * entry it ran, records nothing new, and keeps the other direction.
       * Two full rounds, checking the writes sent, the history and the data
       * after every step.
       */
      describe("two rounds of Undo then Redo move only the original entry", () => {
        const depth = () =>
          document
            .querySelector("[data-editor-undo-depth]")
            ?.getAttribute("data-editor-undo-depth") ?? null;
        const step = async (
          press: () => Promise<void>,
          receive: (next: StorefrontThemeEditorDTO) => void,
        ) => {
          await press();
          await reread(receive);
        };

        it("a stored field: Undo writes the old value, Redo the new, nothing else is recorded", async () => {
          stored = { ...STORED };
          const { receive } = await openSection({ ...STORED });
          await type("Hello", "New");
          await settle();
          await reread(receive);
          expect(sent()).toHaveLength(1);
          expect(depth()).toBe("1");

          for (const round of [1, 2]) {
            await step(undo, receive);
            expect(sent(), `round ${round}: undo sent once`).toHaveLength(
              round * 2,
            );
            expect(sent().at(-1)!.props).toEqual({ heading: "Hello" });
            expect(stored).toEqual({ heading: "Hello" });
            expect(depth(), `round ${round}: after undo`).toBe("0");
            expect(historyButtons()).toEqual({ undo: false, redo: true });

            await step(redo, receive);
            expect(sent(), `round ${round}: redo sent once`).toHaveLength(
              round * 2 + 1,
            );
            expect(sent().at(-1)!.props).toEqual({ heading: "New" });
            expect(stored).toEqual({ heading: "New" });
            expect(depth(), `round ${round}: after redo`).toBe("1");
            expect(historyButtons()).toEqual({ undo: true, redo: false });
          }
        });

        it("a first Add: Undo removes the list again, Redo stores the same rows, nothing else is recorded", async () => {
          const { receive } = await resetOnlyWrite();
          const first = (sent()[0]!.props as { items: unknown[] }).items;
          expect(depth()).toBe("1");

          for (const round of [1, 2]) {
            await step(undo, receive);
            expect(sent(), `round ${round}: undo sent once`).toHaveLength(
              round * 2,
            );
            expect(sent().at(-1)!.resetProps).toEqual(["items"]);
            expect(stored).toEqual({ ...STORED });
            expect(depth(), `round ${round}: after undo`).toBe("0");
            expect(historyButtons()).toEqual({ undo: false, redo: true });

            await step(redo, receive);
            expect(sent(), `round ${round}: redo sent once`).toHaveLength(
              round * 2 + 1,
            );
            expect(
              (sent().at(-1)!.props as { items: unknown[] }).items,
            ).toEqual(first);
            expect(stored.items).toEqual(first);
            expect(depth(), `round ${round}: after redo`).toBe("1");
            expect(historyButtons()).toEqual({ undo: true, redo: false });
          }
        });
      });
    });

    /**
     * #388 round 3, B (red before the fix where noted). A row title of the
     * unstored list is selected on the canvas (no row id, so the row is
     * refused with `row-id-missing`), and the list is added to or removed
     * from in the Inspector. The list write takes its source proof from the
     * selection's own key (`items.1.title`), and from nothing else.
     */
    describe("#388 round 3: Add/Remove with a row of the unstored list selected", () => {
      const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
      const reselectNotices = (notice: ReturnType<typeof notices>) =>
        notice.error.mock.calls.filter(
          (call) => call[0] === RESELECT_CONTENT_MESSAGE,
        ).length;

      it("first Add is sent with the defaults and their ids, plus one new row", async () => {
        const notice = notices();
        const [one, two] = identified();
        const { report } = await openTitle({}, 1);
        expect(report).toMatchObject({
          fieldPath: "items.1.title",
          itemId: null,
        });

        await addEntry();

        expect(notice.error.mock.calls, "no refusal notice").toEqual([]);
        expect(sent(), "the first Add is sent").toHaveLength(1);
        expect(versionsSent(sent()[0]!)).toEqual({
          expectedDraftGeneration: 1,
          expectedSourceGeneration: 1,
        });
        const rows = rowsSent(sent()[0]!);
        expect(rows.slice(0, 2)).toEqual([
          [one!.id, "One"],
          [two!.id, "Two"],
        ]);
        expect(rows).toHaveLength(3);
        expect([one!.id, two!.id]).not.toContain(rows[2]![0]);
        accepted(notice);
      });

      it("first Add, then Undo removes the list again and Redo writes it back with the same ids", async () => {
        const notice = notices();
        const { receive } = await openTitle({}, 1);
        await addEntry();
        expect(sent(), "the first Add is sent").toHaveLength(1);
        await reread(receive);
        const added = (sent()[0]!.props as { items: unknown[] }).items;

        await undo();

        expect(sent()).toHaveLength(2);
        expect(sent()[1]).toMatchObject({
          props: {},
          resetProps: ["items"],
          expectedDraftGeneration: 2,
          expectedSourceGeneration: 1,
        });
        expect(stored).not.toHaveProperty("items");
        await reread(receive);

        await redo();

        expect(sent()).toHaveLength(3);
        expect((sent()[2]!.props as { items: unknown }).items).toEqual(added);
        expect(stored.items).toEqual(added);
        accepted(notice);
      });

      it("first Remove of the middle of three keeps the first and third with their ids; Undo and Redo", async () => {
        defaults = THREE;
        const notice = notices();
        const [one, , three] = identified();
        const { receive } = await openTitle({}, 1);

        await removeRow("Two");

        expect(notice.error.mock.calls, "no refusal notice").toEqual([]);
        expect(sent(), "the first Remove is sent").toHaveLength(1);
        expect(rowsSent(sent()[0]!)).toEqual([
          [one!.id, "One"],
          [three!.id, "Three"],
        ]);
        await reread(receive);

        await undo();
        expect(sent()).toHaveLength(2);
        expect(sent()[1]).toMatchObject({ props: {}, resetProps: ["items"] });
        expect(stored).not.toHaveProperty("items");
        await reread(receive);

        await redo();
        expect(sent()).toHaveLength(3);
        expect(rowsSent(sent()[2]!)).toEqual([
          [one!.id, "One"],
          [three!.id, "Three"],
        ]);
        accepted(notice);
      });

      it("refuses the Add when the selection's capture failed (a tombstone at items.1.title)", async () => {
        const notice = notices();
        const report = await reportTitle({}, 1);
        renderEntries({}, 1);
        await flushFrames();
        // Selected while the source was ahead of the copy the editor holds:
        // no generation can be captured for this selection.
        act(() => {
          useThemeWorkspaceStore.setState({
            observedGenerations: { "storefront-1:theme-1": 2 },
          });
        });
        fromPreview(report);
        await flushFrames();
        act(() => {
          useThemeWorkspaceStore.setState({ observedGenerations: {} });
        });
        await flushFrames();
        const contentTab = screen.queryByRole("button", { name: /^Content$/ });
        if (contentTab) fireEvent.click(contentTab);
        await flushFrames();

        await addEntry();

        expect(sent()).toHaveLength(0);
        expect(reselectNotices(notice)).toBeGreaterThan(0);
        expect(historyButtons()).toEqual({ undo: false, redo: false });
      });

      it("refuses the Add once the source generation moved on after the selection", async () => {
        const notice = notices();
        await openTitle({}, 1);
        act(() => {
          useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope);
        });
        await flushFrames();

        await addEntry();

        expect(sent()).toHaveLength(0);
        expect(reselectNotices(notice)).toBeGreaterThan(0);
        expect(historyButtons()).toEqual({ undo: false, redo: false });
      });

      it("refuses the Add while a refused input under items is still held", async () => {
        const notice = notices();
        await openTitle({}, 1);
        const answerWrites = updateSectionProps.getMockImplementation()!;
        updateSectionProps.mockImplementationOnce(async () => ({
          success: false,
          error: "SELECTION_SOURCE_CONFLICT",
          message: RESELECT_CONTENT_MESSAGE,
        }));
        await type("Two", "Two edited");
        await settle();
        expect(sent(), "the input was sent and refused").toHaveLength(1);
        updateSectionProps.mockImplementation(answerWrites);
        notice.error.mockClear();

        await addEntry();

        expect(sent(), "the Add is not sent").toHaveLength(1);
        expect(reselectNotices(notice)).toBeGreaterThan(0);
        expect(stored).not.toHaveProperty("items");
        expect(historyButtons()).toEqual({ undo: false, redo: false });
      });

      it("meets another tab's stored list as a conflict, never an overwrite", async () => {
        notices();
        const [one, two] = identified();
        await openTitle({}, 1);
        // Another tab stored the list (reordered) at draft 2; not read here.
        const theirs = { items: [two, one] };
        stored = { ...theirs };
        draftGeneration = 2;
        updateSectionProps.mockImplementation(async ({ data }) =>
          data.expectedDraftGeneration !== draftGeneration
            ? {
                success: false,
                error: "TEMPLATE_DRAFT_CONFLICT",
                message: "Template draft was modified concurrently.",
              }
            : (() => {
                throw new Error("only the conflict is expected here");
              })(),
        );

        await addEntry();

        expect(stored, "their list stays").toEqual(theirs);
        expect(sent(), "sent at the generation the editor holds").toHaveLength(
          1,
        );
        expect(sent()[0]!.expectedDraftGeneration).toBe(1);
        expect(saveStatus()).toBe("Out of date");
      });

      // The canvas's own inline commit cannot be driven here: a control with
      // a stored, id-bearing row sent nothing either (selection-mode and
      // tree-selection preconditions this harness does not set up), so a
      // "nothing sent" assertion would hold vacuously. What is pinned is the
      // panel's refusal of the row, which the fix must leave as it is.
      it("still refuses the selected row itself (row-id-missing), before and after a list Add", async () => {
        notices();
        await openTitle({}, 1);
        expect(
          screen.getByText(/This entry has no id yet/),
          "the row-id-missing message",
        ).toBeTruthy();

        await addEntry();

        expect(
          screen.getByText(/This entry has no id yet/),
          "still refused after the Add: the selection names no row id",
        ).toBeTruthy();
      });
    });
  });

  /**
   * A list the Document stores, dragged on the canvas. The swap was staged
   * field by field: every leaf of the moved rows recorded the row now at its
   * index, which is the other row in the stored copy, so the write was
   * refused as "changed elsewhere" and nothing was saved. That includes the
   * second drag on a list the first drag had just stored.
   */
  describe("dragging an entry of a stored list on the canvas", () => {
    const drag = (dragged: number, target: number) =>
      fromPreview({
        type: "morph:storefront-preview-commit-array-item-reorder",
        sectionId: "section",
        draggedFieldPath: `items.${dragged}`,
        targetFieldPath: `items.${target}`,
      });
    const notices = () => ({
      warning: vi.spyOn(toast, "warning").mockImplementation(() => ""),
      error: vi.spyOn(toast, "error").mockImplementation(() => ""),
    });

    it("swaps the stored rows and saves the list in its new order", async () => {
      const { warning, error } = notices();
      const [one, two] = identified();
      await openTitle({ items: [one, two] }, 1);

      drag(1, 0);
      await settle();

      expect(warning).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(sent()).toHaveLength(1);
      expect(sent()[0]!.expectedDraftGeneration).toBe(1);
      expect(rowsSent(sent()[0]!)).toEqual([
        [two!.id, "Two"],
        [one!.id, "One"],
      ]);
      expect(saveStatus()).toBe("Unpublished");
    });

    it("swaps again once the first drag has stored a list nothing stored", async () => {
      const { warning, error } = notices();
      const [one, two] = identified();
      // "One", where the first drop left it, selected again on the canvas
      // once the list is stored. (Taken first: it replaces the body.)
      const moved = await reportTitle({ items: [two, one] }, 1);
      expect(moved).toMatchObject({
        fieldPath: "items.1.title",
        itemId: one!.id,
      });
      const { receive } = await openTitle({}, 1);
      drag(1, 0);
      await settle();
      expect(sent()).toHaveLength(1);
      // The editor reads back what the server now holds.
      act(() => {
        receive(editorAt({ ...stored }, draftGeneration));
      });
      await flushFrames();
      fromPreview(moved);
      await flushFrames();

      drag(1, 0);
      await settle();

      expect(warning).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(sent().map((data) => data.expectedDraftGeneration)).toEqual([
        1, 2,
      ]);
      expect(rowsSent(sent()[1]!)).toEqual([
        [one!.id, "One"],
        [two!.id, "Two"],
      ]);
      expect(stored.items).toEqual([
        { id: one!.id, title: "One" },
        { id: two!.id, title: "Two" },
      ]);
    });

    /**
     * Undo replays the swap back once the editor has read the swapped list.
     * Replayed with the handlers of the drag's own render, it staged the swap
     * back on the stored copy from before the drag — already the order undo
     * asks for — and sent nothing. (Redo is not asserted: an undo replayed as
     * a content edit records that edit once it saves, which clears redo for
     * every kind of content undo, not only this one.)
     */
    it("undoes the swap of a stored list once the swapped list is read back", async () => {
      const { warning, error } = notices();
      const [one, two] = identified();
      const { receive } = await openTitle({ items: [one, two] }, 1);
      drag(1, 0);
      await settle();
      expect(sent()).toHaveLength(1);
      // The editor reads back what the server now holds, as after any save.
      act(() => {
        receive(editorAt({ ...stored }, draftGeneration));
      });
      await flushFrames();

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await settle();

      expect(warning).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]!.expectedDraftGeneration).toBe(2);
      expect(rowsSent(sent()[1]!)).toEqual([
        [one!.id, "One"],
        [two!.id, "Two"],
      ]);
      expect(stored.items).toEqual([one, two]);
    });

    /**
     * The swap sent, and no answer: it may have landed, so it is not sent
     * again on its own. "Try again" asks the server first and sends the swap
     * once more only when the server does not hold it.
     */
    describe("when the swap gets no answer", () => {
      afterEach(() => getThemeEditor.mockReset());
      /** What the server function answers when the shell asks what it holds. */
      const readBack = (
        props: Record<string, unknown>,
        atGeneration: number,
      ) => ({
        success: true,
        message: "ok",
        data: editorAt(props, atGeneration),
      });

      const dragWithLostAnswer = async () => {
        const [one, two] = identified();
        await openTitle({ items: [one, two] }, 1);
        updateSectionProps.mockRejectedValueOnce(new Error("offline"));
        drag(1, 0);
        await settle();
        await waitFor(() => expect(saveStatus()).toBe("Save failed"));
        return { one: one!, two: two! };
      };

      it("is not sent again by itself", async () => {
        const { warning, error } = notices();
        await dragWithLostAnswer();

        await new Promise((resolve) => setTimeout(resolve, 1_500));
        expect(sent()).toHaveLength(1);
        expect(warning).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(
          "Failed to update section properties",
        );
        expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
      });

      it("shows a bare whole-list reorder as outcome unknown beside the list", async () => {
        await dragWithLostAnswer();

        const status = document.querySelector<HTMLElement>(
          '[data-list-not-saved="items"]',
        );
        expect(status).not.toBeNull();
        expect(status?.textContent).toMatch(/The result is not confirmed/);
      });

      it("resends once at the original basis and keeps tracking if the resend gets no answer", async () => {
        const { warning } = notices();
        const { one, two } = await dragWithLostAnswer();
        // The server still holds the list in its first order.
        getThemeEditor.mockResolvedValue(readBack({ items: [one, two] }, 1));
        updateSectionProps.mockRejectedValueOnce(new Error("offline"));

        act(() => {
          screen.getByRole("button", { name: "Try again" }).click();
        });

        await new Promise((resolve) => setTimeout(resolve, 1_200));
        expect(sent()).toHaveLength(2);
        expect(sent()[1]).toMatchObject({
          props: { items: [two, one] },
          expectedDraftGeneration: 1,
        });
        expect(saveStatus()).toBe("Save failed");
        expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
        expect(warning).not.toHaveBeenCalled();
      });

      it("control: a refused swap is an answer, rolled back and not kept", async () => {
        notices();
        const [one, two] = identified();
        await openTitle({ items: [one, two] }, 1);
        updateSectionProps.mockResolvedValueOnce({
          success: false,
          message: "Template draft was modified concurrently.",
        } as never);
        drag(1, 0);
        await settle();
        expect(sent()).toHaveLength(1);

        // The next edit is composed on the list as stored, not on the swap.
        await type("Two", "Two edited");
        await settle();
        expect(sent()).toHaveLength(2);
        expect(rowsSent(sent()[1]!)).toEqual([
          [one!.id, "One"],
          [two!.id, "Two edited"],
        ]);
      });

      it("sends nothing again when the swap had landed", async () => {
        notices();
        const { one, two } = await dragWithLostAnswer();
        // The write landed; only its answer was lost.
        getThemeEditor.mockResolvedValue(readBack({ items: [two, one] }, 2));

        act(() => {
          screen.getByRole("button", { name: "Try again" }).click();
        });

        await waitFor(() => expect(saveStatus()).not.toBe("Save failed"));
        expect(sent()).toHaveLength(1);
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      });

      // Task 41 29-B (the user's decision): a reorder confirmed by read-back
      // or by an answered resend records exactly what an answered drag
      // records — its own "Reorder · item" entry, once — and its Undo
      // reverts exactly that swap. (Before, this pinned Undo disabled.)
      const undoDepth = () =>
        document
          .querySelector("[data-editor-undo-depth]")
          ?.getAttribute("data-editor-undo-depth") ?? null;
      const undoEnabled = () =>
        !screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled");
      const redoEnabled = () =>
        !screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled");

      it("records the reorder once when read-back confirms it, and Undo reverts exactly that swap", async () => {
        const { warning, error } = notices();
        const { one, two } = await dragWithLostAnswer();
        expect(undoEnabled()).toBe(false);
        // It landed; only its answer was lost.
        stored = { items: [two, one] };
        draftGeneration = 2;
        getThemeEditor.mockResolvedValue(readBack({ items: [two, one] }, 2));

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));

        await waitFor(() =>
          expect(
            screen.queryByRole("button", { name: "Try again" }),
          ).toBeNull(),
        );
        expect(sent()).toHaveLength(1);
        expect(undoDepth(), "recorded once").toBe("1");
        expect(undoEnabled()).toBe(true);
        await settle();
        expect(undoDepth(), "and only once").toBe("1");

        fireEvent.click(screen.getByRole("button", { name: "Undo" }));
        await settle();

        expect(warning).not.toHaveBeenCalled();
        expect(sent()).toHaveLength(2);
        expect(sent()[1]).toMatchObject({
          props: { items: [one, two] },
          expectedDraftGeneration: 2,
        });
        expect(stored.items).toEqual([one, two]);
        expect(undoDepth()).toBe("0");
        expect(undoEnabled()).toBe(false);
        expect(redoEnabled()).toBe(true);
        expect(error).not.toHaveBeenCalledWith(
          expect.stringContaining("changed elsewhere"),
        );
      });

      // Round 4 R4-1: a reorder resend refused by an answer did not land:
      // its own recorder is dropped, and the kept swap is an ordinary
      // pending edit whose later save records an ordinary Content entry.
      async function refusedReorderResend() {
        notices();
        const rows = await dragWithLostAnswer();
        getThemeEditor.mockResolvedValue(
          readBack({ items: [rows.one, rows.two] }, 1),
        );
        updateSectionProps.mockResolvedValueOnce({
          success: false,
          error: "REFUSED_BY_MOCK",
          message: "The mock refused the resend.",
        } as never);
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await settle();
        expect(sent()).toHaveLength(2);
        expect(saveStatus(), "the swap is still pending").toBe("Save failed");
        expect(undoDepth()).toBe("0");
        return rows;
      }

      it("a refused reorder resend, then Try again: the kept swap is saved as an ordinary edit, one Content entry", async () => {
        const { one, two } = await refusedReorderResend();

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await settle();

        expect(sent()).toHaveLength(3);
        expect(sent()[2]).toMatchObject({ props: { items: [two, one] } });
        expect(undoDepth(), "recorded once").toBe("1");
        expect(
          screen.getByRole("button", { name: "Undo" }).getAttribute("title"),
        ).toBe("Undo Content");
        expect(saveStatus()).not.toBe("Save failed");
      });

      it("a refused reorder resend, then a text edit saved: exactly one Content entry, no Reorder entry", async () => {
        await refusedReorderResend();

        await type("Two", "Two edited");
        await settle();

        expect(sent()).toHaveLength(3);
        expect(undoDepth(), "one entry").toBe("1");
        expect(
          screen.getByRole("button", { name: "Undo" }).getAttribute("title"),
        ).toBe("Undo Content");
      });

      it("a refused reorder resend, then a text edit refused and sent by Try again: one Content entry, nothing of the reorder recorded", async () => {
        // The review's scenario: nothing of the refused reorder is left to
        // record when the section's input is later sent by Try again.
        await refusedReorderResend();
        updateSectionProps.mockResolvedValueOnce({
          success: false,
          error: "REFUSED_BY_MOCK",
          message: "The mock refused the edit.",
        } as never);
        await type("Two", "Two edited");
        await settle();
        expect(sent()).toHaveLength(3);
        expect(saveStatus()).toBe("Save failed");

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await settle();

        expect(sent()).toHaveLength(4);
        expect(undoDepth(), "one entry").toBe("1");
        expect(
          screen.getByRole("button", { name: "Undo" }).getAttribute("title"),
        ).toBe("Undo Content");
      });

      it("a second drag while the first is unanswered retires the section's history: the first, confirmed later, records nothing", async () => {
        // Round 4 R4-4: retired by a real change. The second drag is held
        // behind the unanswered first and rolled back, as a refused drag is;
        // the answered path (first answered and recorded, second refused)
        // ends with the first's entry retired too: depth 0.
        notices();
        const { one, two } = await dragWithLostAnswer();
        drag(1, 0);
        await settle();
        expect(sent(), "the second drag is held").toHaveLength(1);
        getThemeEditor.mockResolvedValue(readBack({ items: [one, two] }, 1));

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await settle();

        expect(sent()).toHaveLength(2);
        expect(sent()[1]).toMatchObject({
          props: { items: [two, one] },
          expectedDraftGeneration: 1,
        });
        expect(undoDepth(), "as the answered path").toBe("0");
      });

      it("records the reorder once when its resend is answered, and Undo reverts exactly that swap", async () => {
        const { warning } = notices();
        const { one, two } = await dragWithLostAnswer();
        // Not landed: the server still holds the first order.
        getThemeEditor.mockResolvedValue(readBack({ items: [one, two] }, 1));

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await settle();

        expect(sent()).toHaveLength(2);
        expect(sent()[1]).toMatchObject({
          props: { items: [two, one] },
          expectedDraftGeneration: 1,
        });
        expect(stored.items).toEqual([two, one]);
        expect(undoDepth(), "recorded once").toBe("1");
        expect(undoEnabled()).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "Undo" }));
        await settle();

        expect(warning).not.toHaveBeenCalled();
        expect(sent()).toHaveLength(3);
        expect(sent()[2]).toMatchObject({
          props: { items: [one, two] },
          expectedDraftGeneration: 2,
        });
        expect(stored.items).toEqual([one, two]);
        expect(undoDepth()).toBe("0");
        expect(redoEnabled()).toBe(true);
      });
    });
  });

});
