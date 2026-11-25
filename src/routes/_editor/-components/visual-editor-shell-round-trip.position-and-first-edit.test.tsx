/**
 * The object position control, and the first edit of a list nothing stores yet (direct edits, typing, and the version-basis stage).
 *
 * One of the files the former `visual-editor-shell-round-trip.test.tsx` was split into so
 * the test shards can spread it; the shared setup is in `visual-editor-shell-round-trip.harness.tsx`.
 */
import {
  baseSearch,
  context,
  flushFrames,
  fromPreview,
  getThemeEditor,
  liveFrame,
  messagesOfType,
  objposSavedFiles,
  posted,
  readyQueryClient,
  saveStatus,
  updateSectionProps,
} from "./visual-editor-shell-round-trip.harness";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import {
  PREVIEW_PRESENTATION_SYNCING_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";
import {
  STARTER_THEME_FILES as OBJPOS_STARTER_FILES,
} from "@/lib/storefront/starter-theme-files";
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

/**
 * The Inspector's object position control, through the real shell.
 *
 * The control writes one place: the Document field the selected image's inline
 * `objectPosition` provably reads. It used to write that and patch the class
 * too, and the class save moved the selection's source generation under the
 * Document write it had queued, so on the Starter neither landed. The canvas
 * selection here is produced by the real preview pass over the real Starter
 * components, not written by hand.
 */
describe("the object position control", () => {
  const SHOWCASE_PATH = "src/components/CategoryShowcase.tsx";
  const STORY_PATH = "src/components/ImageWithText.tsx";
  const PLAIN_PATH = "src/components/PlainImage.tsx";
  const PLAIN_SOURCE = `export const contentFields = {
  image: { type: "image", label: "Image" },
} as const;
export default function PlainImage({ image }: { image?: { src?: string } }) {
  return <section><img src={image?.src} className="size-full object-cover" /></section>;
}`;
  const starterSource = (path: string) =>
    OBJPOS_STARTER_FILES.find((file) => file.path === path)!.content;
  const rows = () => [
    {
      id: "row-a",
      title: "First",
      image: { src: "/a.png", alt: "A" },
      imagePosition: "30% center",
    },
    { id: "row-b", title: "Second", image: { src: "/b.png", alt: "B" } },
  ];
  const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

  type Fixture = {
    path: string;
    source: string;
    type: string;
    props: Record<string, unknown>;
    /** What the editor's Document holds, when it differs from the canvas's. */
    storedProps?: Record<string, unknown>;
  };

  /** The canvas's report for one element, from the real preview pass. */
  async function reportImage(
    fixture: Fixture,
    imageIndex: number,
    selector = "img",
  ) {
    const route = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Section from "../components/${fixture.path.split("/").pop()!.replace(".tsx", "")}";
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
          sections: [
            {
              id: "section",
              type: fixture.type,
              enabled: true,
              props: fixture.props,
            },
          ],
        } as never,
      },
    });
    const root = objposMount(html);
    const item = objposResolveSelectable(
      root.querySelectorAll(selector)[imageIndex] ?? null,
    );
    document.body.replaceChildren();
    expect(item).toBeTruthy();
    const currentStyleRevision = posted.reduce((latest, message) => {
      const revision = message.styleRevision;
      return typeof revision === "number" ? Math.max(latest, revision) : latest;
    }, 0);
    return {
      type: "morph:storefront-preview-select-section",
      sectionId: item!.sectionId,
      componentType: item!.type,
      // `kind` comes from `selectionMetadata` below, which the bridge spreads
      // over the same key.
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
      styleRevision: currentStyleRevision,
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

  function renderEditor(fixture: Fixture, atDraftGeneration = 1) {
    echo = { fixture, props: { ...(fixture.storedProps ?? fixture.props) } };
    const editorContext = {
      ...context,
      templates: [
        {
          ...context.templates[0]!,
          draftGeneration: atDraftGeneration,
          document: {
            version: 1,
            sections: [
              {
                id: "section",
                type: fixture.type,
                componentRef: fixture.path,
                enabled: true,
                props: fixture.storedProps ?? fixture.props,
              },
            ],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;
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
    const rendered = render(shell(editorContext));
    if (document.querySelector("iframe")) liveFrame.ready();
    const { rerender } = rendered;
    return {
      client,
      editorContext,
      /** The editor handed a newer read of the Theme, as a refetch does. */
      receive: (next: StorefrontThemeEditorDTO) => rerender(shell(next)),
    };
  }

  /** The editor's read of the Theme, holding the section with `props`. */
  function editorWith(
    editorContext: StorefrontThemeEditorDTO,
    fixture: Fixture,
    props: Record<string, unknown>,
    draftGeneration: number,
  ) {
    return {
      success: true,
      message: "ok",
      data: {
        ...editorContext,
        templates: [
          {
            ...editorContext.templates[0]!,
            draftGeneration,
            document: {
              version: 1,
              sections: [
                {
                  id: "section",
                  type: fixture.type,
                  componentRef: fixture.path,
                  enabled: true,
                  props,
                },
              ],
            },
          },
        ],
      },
    };
  }

  async function selectAndOpenStyles(
    report: Awaited<ReturnType<typeof reportImage>>,
  ) {
    await flushFrames();
    fromPreview(report);
    await flushFrames();
    const stylesTab = screen.queryByRole("button", { name: /^Styles$/ });
    if (stylesTab) fireEvent.click(stylesTab);
    await flushFrames();
    return screen.getByRole("combobox", { name: "Object position" });
  }

  async function choose(trigger: HTMLElement, label: string) {
    fireEvent.keyDown(trigger, { key: "Enter" });
    await flushFrames();
    const option = screen.getByRole("option", { name: label });
    fireEvent.keyDown(option, { key: "Enter" });
    fireEvent.click(option);
    // Past the content write's 300 ms debounce and its answer.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }

  /** The toolbar's save state, as the shell renders it. */
  const saveState = () =>
    document
      .querySelector("[data-editor-save-status]")
      ?.getAttribute("data-save-state");

  /**
   * What the caller expects of one content write:
   * - "saved": the server accepted this write, and the shell raised nothing;
   * - `{ refused: code }`: the server refused this write for `code`, and the
   *   shell said so. Any other code, a lost request or a success is not it;
   * - "unconfirmed": the request was sent and no answer came (it rejected),
   *   and the shell said so. Whether it landed is unknown until a read-back.
   */
  type ExpectedWrite = "saved" | "unconfirmed" | { refused: string };

  /**
   * Chooses an option and waits for the one content write it sends to be
   * answered and handled, rather than for a fixed time; then checks that
   * what happened to that write is `expected`, and fails with what did
   * happen if not. Returns the outcome it read: "saved", "unconfirmed" or
   * `refused:<code>`.
   *
   * Only for a choice that is sent: a choice the shell holds back (behind an
   * unanswered write, or a page it could not read) sends nothing, and `choose`
   * above is the one that waits that case out.
   *
   * Waits for, in order:
   * - exactly one more call to the server function. That call is this write:
   *   its payload must carry the option chosen;
   * - that call's own answer to settle (not any earlier one's). Waited for
   *   outside `act`, so a test can hold the answer and look meanwhile;
   * - the toolbar's save state to leave "saving". The shell counts a write as
   *   sending from before it leaves until after its answer has been handled,
   *   and the `act` before this flushes what that queued, so a state left
   *   over from before the click cannot pass for it;
   * - one more pair of frames, for what that render scheduled.
   *
   * "Saved" is bound to this write, not to the toolbar's word (which another
   * field's kept refusal can hold at "failed", and which may be left from
   * before the click): this call's answer is a success, at the draft
   * generation one past the one this call was sent at; the document it
   * returned, when it returned one, holds what this call sent; and the shell
   * raised no error notice since the click. A refusal is bound to this call's
   * own answer code, and to a notice (or the out-of-date state) the shell
   * raised for it. Needs `toast.error` spied, to count the notices.
   */
  async function chooseAndAwaitWrite(
    trigger: HTMLElement,
    label: string,
    expected: ExpectedWrite,
  ): Promise<string> {
    if (!vi.isMockFunction(toast.error)) {
      throw new Error(
        "chooseAndAwaitWrite: spy on toast.error first; refusals and failures are read from the notices the shell raises",
      );
    }
    const notices = () => vi.mocked(toast.error).mock.calls.length;
    const before = updateSectionProps.mock.calls.length;
    const noticesBefore = notices();
    fireEvent.keyDown(trigger, { key: "Enter" });
    await flushFrames();
    const option = screen.getByRole("option", { name: label });
    fireEvent.keyDown(option, { key: "Enter" });
    fireEvent.click(option);
    await waitFor(() => expect(sent()).toHaveLength(before + 1));

    const request = sent()[before]!;
    const chosen = `"imagePosition":"${label.toLowerCase()}"`;
    if (!JSON.stringify(request.props).includes(chosen)) {
      throw new Error(
        `chooseAndAwaitWrite("${label}"): the write sent does not carry the choice: ${JSON.stringify(request.props)}`,
      );
    }
    const own = Promise.resolve(
      updateSectionProps.mock.results[before]!.value as unknown,
    ).then(
      (value) => ({ rejected: false as const, value }),
      () => ({ rejected: true as const, value: undefined }),
    );
    const held: { answer?: Awaited<typeof own> } = {};
    void own.then((settled) => {
      held.answer = settled;
    });
    await waitFor(() => expect(held.answer).toBeDefined());
    await act(async () => {
      await own;
    });
    await waitFor(() =>
      expect(["saved", "unsaved", "out-of-date", "failed"]).toContain(
        saveState(),
      ),
    );
    await flushFrames();

    const settled = held.answer!;
    const raised = notices() - noticesBefore;
    const state = saveState();
    const answer = settled.value as
      | {
          success?: unknown;
          error?: unknown;
          data?: {
            draftGeneration?: unknown;
            document?: {
              sections?: Array<{ id: string; props?: Record<string, unknown> }>;
            };
          };
        }
      | undefined;
    let observed: string;
    if (settled.rejected) {
      observed =
        raised > 0 && state === "failed"
          ? "unconfirmed"
          : `sent and not answered, but the shell raised ${raised} notice(s) with state "${state}"`;
    } else if (answer?.success === true) {
      const sentAt = request.expectedDraftGeneration as number;
      const stored = answer.data?.document?.sections?.find(
        (section) => section.id === request.sectionId,
      );
      const storedAsSent =
        !answer.data?.document ||
        Object.entries(request.props as Record<string, unknown>).every(
          ([key, value]) =>
            JSON.stringify(stored?.props?.[key]) === JSON.stringify(value),
        );
      observed =
        answer.data?.draftGeneration !== sentAt + 1
          ? `answered as saved at draft generation ${String(answer.data?.draftGeneration)}, not the one after the ${sentAt} it was sent at`
          : !storedAsSent
            ? "answered as saved with a document that does not hold what it sent"
            : raised > 0
              ? `answered as saved, but the shell raised ${raised} error notice(s) (state "${state}")`
              : "saved";
    } else {
      const code = String(answer?.error);
      observed =
        raised > 0 || state === "out-of-date"
          ? `refused:${code}`
          : `answered with a refusal (${code}) the shell did not report (state "${state}")`;
    }
    const wanted =
      typeof expected === "string" ? expected : `refused:${expected.refused}`;
    if (observed !== wanted) {
      throw new Error(
        `chooseAndAwaitWrite("${label}"): expected the write to be ${wanted}; it was ${observed}`,
      );
    }
    return observed;
  }

  const note = () =>
    document.querySelector('[data-inspector-note="object-position"]')
      ?.textContent ?? null;
  const sent = () =>
    updateSectionProps.mock.calls.map(
      (call) => call[0].data as Record<string, unknown>,
    );
  const reselectNotices = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((call) =>
      String(call[0]).startsWith("The source code has changed"),
    ).length;

  beforeAll(() => {
    // Every browser this runs in has CSS.escape; this jsdom does not.
    if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
      (globalThis as { CSS?: unknown }).CSS = {
        escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
      };
    }
  });
  let draftGeneration = 1;
  /** The section the server answers for, as it holds it after each write. */
  let echo: { fixture: Fixture; props: Record<string, unknown> } | null = null;
  /**
   * A saved answer as the server gives it: the document it now holds, one
   * generation past the one the write was sent at.
   */
  const savedEcho = (data: {
    props: Record<string, unknown>;
    expectedDraftGeneration: number;
  }) => {
    if (echo) echo.props = { ...echo.props, ...data.props };
    draftGeneration = data.expectedDraftGeneration + 1;
    return {
      success: true,
      data: {
        draftGeneration,
        droppedProps: [],
        ...(echo
          ? {
              document: {
                version: 1,
                sections: [
                  {
                    id: "section",
                    type: echo.fixture.type,
                    componentRef: echo.fixture.path,
                    enabled: true,
                    props: echo.props,
                  },
                ],
              },
            }
          : {}),
      },
    };
  };
  beforeEach(() => {
    draftGeneration = 1;
    echo = null;
    updateSectionProps.mockReset();
    updateSectionProps.mockImplementation(async ({ data }) => savedEcho(data));
    objposSavedFiles.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const showcase = (overrides: Partial<Fixture> = {}): Fixture => ({
    path: SHOWCASE_PATH,
    source: starterSource(SHOWCASE_PATH),
    type: "category-showcase",
    props: { heading: "Collections", items: rows() },
    ...overrides,
  });

  it("writes only the selected Starter row's declared field, at the selection's baseline", async () => {
    const toasts = vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    expect(report).toMatchObject({
      fieldPath: "items.1.image",
      itemId: "row-b",
    });
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);
    expect(trigger.hasAttribute("data-disabled")).toBe(false);
    expect(note()).toBeNull();

    await chooseAndAwaitWrite(trigger, "Top", "saved");

    expect(sent()).toHaveLength(1);
    const items = sent()[0]!.props as { items: Array<Record<string, unknown>> };
    expect(items.items[1]).toMatchObject({ id: "row-b", imagePosition: "top" });
    expect(items.items[0]).toMatchObject({
      id: "row-a",
      imagePosition: "30% center",
    });
    expect(sent()[0]!.expectedSourceGeneration).toBe(1);
    expect(objposSavedFiles).toHaveLength(0);
    expect(reselectNotices(toasts)).toBe(0);
  });

  it("keeps writing at the same baseline across consecutive changes", async () => {
    const toasts = vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);

    await chooseAndAwaitWrite(trigger, "Top", "saved");
    await chooseAndAwaitWrite(trigger, "Bottom", "saved");

    expect(sent()).toHaveLength(2);
    const second = sent()[1]!.props as {
      items: Array<Record<string, unknown>>;
    };
    expect(second.items[1]).toMatchObject({ imagePosition: "bottom" });
    expect(second.items[0]).toMatchObject({ imagePosition: "30% center" });
    expect(sent().map((data) => data.expectedSourceGeneration)).toEqual([1, 1]);
    expect(objposSavedFiles).toHaveLength(0);
    expect(reselectNotices(toasts)).toBe(0);
  });

  it("stops offering the change once the source moves on elsewhere", async () => {
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);
    expect(trigger.hasAttribute("data-disabled")).toBe(false);

    act(() => {
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope);
    });
    await flushFrames();

    const after = screen.getByRole("combobox", { name: "Object position" });
    expect(after.hasAttribute("data-disabled")).toBe(true);
    expect(note()).toContain(
      "The source changed since this image was selected",
    );
    fireEvent.keyDown(after, { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(sent()).toHaveLength(0);
    expect(objposSavedFiles).toHaveLength(0);
  });

  const itemsOf = (data: Record<string, unknown>) =>
    (data.props as { items: Array<Record<string, unknown>> }).items.map(
      (row) => [row.id, row.title, row.imagePosition],
    );

  /** Types into the section heading's own field, the way the author does. */
  async function typeHeading(
    report: Awaited<ReturnType<typeof reportImage>>,
    from: string,
    to: string,
  ) {
    fromPreview(report);
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const field = await screen.findByDisplayValue(from);
    fireEvent.input(field, { target: { value: to } });
    fireEvent.blur(field);
  }

  // The selected row is found again by its id after the rows moved; the
  // write goes to it, at the selection's baseline, and to nothing else.
  it("writes the selected row by its id when the rows moved after the click", async () => {
    const toasts = vi.spyOn(toast, "error").mockImplementation(() => "");
    const [rowA, rowB] = rows();
    // The canvas drew A, B; the Document now holds B, A.
    const fixture = showcase({
      props: { heading: "Collections", items: [rowA, rowB] },
      storedProps: { heading: "Collections", items: [rowB, rowA] },
    });
    const report = await reportImage(fixture, 1);
    expect(report).toMatchObject({
      fieldPath: "items.1.image",
      itemId: "row-b",
    });
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);

    await chooseAndAwaitWrite(trigger, "Top", "saved");

    expect(sent()).toHaveLength(1);
    expect(itemsOf(sent()[0]!)).toEqual([
      ["row-b", "Second", "top"],
      ["row-a", "First", "30% center"],
    ]);
    expect(sent()[0]!.expectedSourceGeneration).toBe(1);
    expect(Object.keys(sent()[0]!.props as object)).toEqual(["items"]);
    expect(reselectNotices(toasts)).toBe(0);
    expect(objposSavedFiles).toHaveLength(0);
  });

  // A refused write recovers only through a fresh selection and a new choice
  // in that field, and that choice confirms that field alone: another field's
  // refused input stays kept, unsent, at its own generation.
  it("recovers a refused choice after reselection and a new choice, and confirms nothing else", async () => {
    const toasts = vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockImplementation(async ({ data }) =>
      data.expectedSourceGeneration === 2
        ? { success: true, data: { draftGeneration: 2, droppedProps: [] } }
        : {
            success: false,
            error: "SELECTION_SOURCE_CONFLICT",
            message:
              "The source code has changed. Select the field again. Your changes are kept.",
          },
    );
    const fixture = showcase();
    const heading = await reportImage(fixture, 0, "h2");
    expect(heading).toMatchObject({ fieldKey: "heading" });
    const image = await reportImage(fixture, 1);
    renderEditor(fixture);
    await flushFrames();

    // Another field's input, refused at the old source and kept.
    await typeHeading(heading, "Collections", "Kept heading");
    await waitFor(() => expect(sent()).toHaveLength(1));
    // The Position choice, refused the same way.
    const trigger = await selectAndOpenStyles({
      ...image,
      selectionRevision: 2,
    });
    await chooseAndAwaitWrite(trigger, "Top", {
      refused: "SELECTION_SOURCE_CONFLICT",
    });
    expect(sent()).toHaveLength(2);
    expect(sent()[1]!.expectedSourceGeneration).toBe(1);

    // The source moves on. The old selection no longer offers a change.
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );
    await flushFrames();
    expect(
      screen
        .getByRole("combobox", { name: "Object position" })
        .hasAttribute("data-disabled"),
    ).toBe(true);

    // A fresh selection and a new choice: that field alone, at the new source.
    const again = await selectAndOpenStyles({ ...image, selectionRevision: 3 });
    expect(again.hasAttribute("data-disabled")).toBe(false);
    // The clock is faked from before this choice, not only for the window
    // below: a resend the shell schedules while it sends or answers this
    // write is then a fake timer the window advances through. Faked only
    // after the answer, such a timer would be a real one the instant window
    // never waits for. `shouldAdvanceTime` keeps the debounce and `waitFor`
    // running on their own until then.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      await chooseAndAwaitWrite(again, "Bottom", "saved");
      expect(sent()).toHaveLength(3);
      expect(sent()[2]!.expectedSourceGeneration).toBe(2);
      expect(Object.keys(sent()[2]!.props as object)).toEqual(["items"]);
      expect(itemsOf(sent()[2]!)).toEqual([
        ["row-a", "First", "30% center"],
        ["row-b", "Second", "bottom"],
      ]);

      // The kept heading was neither sent with it nor sent again afterwards,
      // and it is still the author's, waiting for its own confirmation. The
      // same 1.2 s window as a real wait, with the clock moved instead of
      // waited on; only that far, so the preview's long timers do not fire.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(sent()).toHaveLength(3);
    await typeHeadingKeptCheck(heading);
    expect(reselectNotices(toasts)).toBeGreaterThan(0);
    expect(objposSavedFiles).toHaveLength(0);
  });

  async function typeHeadingKeptCheck(
    report: Awaited<ReturnType<typeof reportImage>>,
  ) {
    fromPreview({ ...report, selectionRevision: 4 });
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    expect(await screen.findByDisplayValue("Kept heading")).toBeTruthy();
  }

  // `chooseAndAwaitWrite` itself: it completes on the write's own answer and
  // nothing earlier, and says what that answer was.

  const REFUSED_AT_OLD_SOURCE = {
    success: false,
    error: "SELECTION_SOURCE_CONFLICT",
    message:
      "The source code has changed. Select the field again. Your changes are kept.",
  };
  const SELECTION_REFUSAL = { refused: "SELECTION_SOURCE_CONFLICT" };

  /** The next write's answer, held until the test releases it. */
  function holdNextAnswer() {
    const held: { release?: (answer: unknown) => void } = {};
    updateSectionProps.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          held.release = resolve;
        }),
    );
    return held;
  }

  /** Whether a promise has settled, and how, readable at any moment. */
  function track<T>(promise: Promise<T>) {
    const state: { done: boolean; value?: T; error?: unknown } = {
      done: false,
    };
    promise.then(
      (value) => {
        state.done = true;
        state.value = value;
      },
      (error: unknown) => {
        state.done = true;
        state.error = error;
      },
    );
    return state;
  }

  /**
   * Polls without `act` or `waitFor`, so it can run beside a helper that is
   * inside either without overlapping it.
   */
  async function until(check: () => boolean, what: string) {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  /** Moves a faked clock exactly `ms`, inside `act`. */
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("completes a chosen write only on its own answer, and reads a held success and a held refusal as what they are", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);

    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      // A success, held: not complete when chosen, when sent, or a second
      // and more later; complete, as saved, once the answer is released.
      const success = holdNextAnswer();
      const first = track(chooseAndAwaitWrite(trigger, "Top", "saved"));
      expect(first.done).toBe(false);
      await until(() => sent().length === 1, "the first write to be sent");
      expect(first.done).toBe(false);
      // Outside `act`: the helper is waiting inside `waitFor`.
      await vi.advanceTimersByTimeAsync(1_200);
      expect(first.done).toBe(false);
      expect(saveState()).toBe("saving");
      success.release!(savedEcho(sent()[0] as never));
      await until(() => first.done, "the first write to complete");
      expect(first.error).toBeUndefined();
      expect(first.value).toBe("saved");

      // A refusal, held the same way: complete only once released, and only
      // as this refusal.
      const refusal = holdNextAnswer();
      const second = track(
        chooseAndAwaitWrite(trigger, "Bottom", SELECTION_REFUSAL),
      );
      await until(() => sent().length === 2, "the second write to be sent");
      expect(second.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_200);
      expect(second.done).toBe(false);
      refusal.release!(REFUSED_AT_OLD_SOURCE);
      await until(() => second.done, "the second write to complete");
      expect(second.error).toBeUndefined();
      expect(second.value).toBe("refused:SELECTION_SOURCE_CONFLICT");
    } finally {
      vi.useRealTimers();
    }
    expect(sent()).toHaveLength(2);
  });

  it("fails a chosen write that came out other than the caller expected", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);

    // Saved, where a refusal was expected.
    await expect(
      chooseAndAwaitWrite(trigger, "Top", SELECTION_REFUSAL),
    ).rejects.toThrow(
      "expected the write to be refused:SELECTION_SOURCE_CONFLICT; it was saved",
    );
    // A server error is not the refusal that was expected.
    updateSectionProps.mockImplementationOnce(async () => ({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Something went wrong",
    }));
    await expect(
      chooseAndAwaitWrite(trigger, "Bottom", SELECTION_REFUSAL),
    ).rejects.toThrow(
      "expected the write to be refused:SELECTION_SOURCE_CONFLICT; it was refused:INTERNAL_ERROR",
    );
    // Refused, where a save was expected.
    updateSectionProps.mockImplementationOnce(
      async () => REFUSED_AT_OLD_SOURCE,
    );
    await expect(chooseAndAwaitWrite(trigger, "Top", "saved")).rejects.toThrow(
      "expected the write to be saved; it was refused:SELECTION_SOURCE_CONFLICT",
    );
    expect(sent()).toHaveLength(3);
  });

  it("does not take a request with no answer for the refusal that was expected", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);

    updateSectionProps.mockRejectedValueOnce(new Error("offline"));
    await expect(
      chooseAndAwaitWrite(trigger, "Top", SELECTION_REFUSAL),
    ).rejects.toThrow(
      "expected the write to be refused:SELECTION_SOURCE_CONFLICT; it was unconfirmed",
    );
    expect(sent()).toHaveLength(1);
  });

  /**
   * Sent, and the connection lost before an answer: the request rejects, so
   * from here it is unknown whether it landed. The server's own state is
   * what the read-back (`getThemeEditor`) returns; `sentWhenRead` records how
   * many requests had gone out when the shell first asked.
   */
  function lostAnswer(
    editorContext: StorefrontThemeEditorDTO,
    fixture: Fixture,
    storedAfter: { items: unknown[]; draftGeneration: number },
  ) {
    const read = { sentWhenRead: null as number | null };
    getThemeEditor.mockImplementation(async () => {
      read.sentWhenRead ??= sent().length;
      return editorWith(
        editorContext,
        fixture,
        { heading: "Collections", items: storedAfter.items },
        storedAfter.draftGeneration,
      );
    });
    updateSectionProps.mockRejectedValueOnce(new Error("offline"));
    return read;
  }

  async function chooseWithLostAnswer(trigger: HTMLElement) {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      expect(await chooseAndAwaitWrite(trigger, "Top", "unconfirmed")).toBe(
        "unconfirmed",
      );
      // Not sent again, and not called saved, on its own.
      await advance(1_200);
    } finally {
      vi.useRealTimers();
    }
    expect(sent()).toHaveLength(1);
    expect(saveState()).toBe("failed");
  }

  // (a) It landed; only the answer was lost. The read-back shows it stored,
  // so nothing is sent again, and the next write composes on what it read.
  it("takes a lost answer's read-back as stored when the write landed, and sends nothing again", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    const { editorContext } = renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);
    const priorRead = getThemeEditor.getMockImplementation();
    try {
      const [rowA, rowB] = rows();
      const read = lostAnswer(editorContext, fixture, {
        items: [rowA, { ...rowB, imagePosition: "top" }],
        draftGeneration: 2,
      });
      await chooseWithLostAnswer(trigger);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(getThemeEditor).toHaveBeenCalled());
      await waitFor(() => expect(saveState()).toBe("saved"));
      expect(read.sentWhenRead).toBe(1);
      expect(
        messagesOfType("morph:storefront-preview-update-section-props").some(
          (message) => {
            const token = message.presentationToken as
              { documentBasis?: { draftGeneration?: number } } | undefined;
            return token?.documentBasis?.draftGeneration === 2;
          },
        ),
      ).toBe(true);
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout"],
        shouldAdvanceTime: true,
      });
      try {
        await advance(1_200);
      } finally {
        vi.useRealTimers();
      }
      expect(sent()).toHaveLength(1);

      // What it read counts: the next write is sent at the generation the
      // read-back returned, on the rows it returned.
      expect(await chooseAndAwaitWrite(trigger, "Bottom", "saved")).toBe(
        "saved",
      );
      expect(sent()[1]!.expectedDraftGeneration).toBe(2);
      expect(itemsOf(sent()[1]!)).toEqual([
        ["row-a", "First", "30% center"],
        ["row-b", "Second", "bottom"],
      ]);
    } finally {
      if (priorRead) getThemeEditor.mockImplementation(priorRead);
      else getThemeEditor.mockReset();
    }
  });

  // (b) A read that does not show the write classifies it as not landed. Per
  // the content recovery rule, retry once at the original generation: CAS
  // ensures the original request and this resend cannot both succeed.
  it("resends a lost answer once at its original generation when read-back does not show it", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    const { editorContext } = renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);
    const priorRead = getThemeEditor.getMockImplementation();
    try {
      const read = lostAnswer(editorContext, fixture, {
        items: rows(),
        draftGeneration: 1,
      });
      await chooseWithLostAnswer(trigger);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(read.sentWhenRead).toBe(1));
      await waitFor(() => expect(sent()).toHaveLength(2));
      await waitFor(() => expect(saveState()).toBe("saved"));
      expect(sent()[1]!.expectedDraftGeneration).toBe(1);
      expect(itemsOf(sent()[1]!)).toEqual([
        ["row-a", "First", "30% center"],
        ["row-b", "Second", "top"],
      ]);
      expect(read.sentWhenRead).toBe(1);
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    } finally {
      if (priorRead) getThemeEditor.mockImplementation(priorRead);
      else getThemeEditor.mockReset();
    }
  });

  // A write whose outcome is unknown (no answer) is not upgraded, cleared or
  // sent again because a Position choice is made beside it. The shell holds
  // every later content write until an unanswered one is read back (#217's
  // existing rule, not this control's); this read-back never answers here, so
  // the choice waits, kept on screen, and the unanswered input is not resent.
  it("does not resend or carry an unanswered input when a position is chosen", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockImplementation(async ({ data }) => {
      if ((data.props as Record<string, unknown>).heading !== undefined) {
        throw new Error("offline");
      }
      return savedEcho(data);
    });
    const fixture = showcase();
    const heading = await reportImage(fixture, 0, "h2");
    const image = await reportImage(fixture, 1);
    renderEditor(fixture);
    await flushFrames();

    await typeHeading(heading, "Collections", "Unanswered heading");
    await waitFor(() => expect(sent()).toHaveLength(1));
    const trigger = await selectAndOpenStyles({
      ...image,
      selectionRevision: 2,
    });
    await choose(trigger, "Top");

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    // Only the one unanswered request, never repeated, and nothing carrying
    // it at a newer baseline.
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.props).toEqual({ heading: "Unanswered heading" });
    expect(sent()[0]!.expectedSourceGeneration).toBe(1);
    // The choice is held, not dropped.
    expect(
      screen.getByRole("combobox", { name: "Object position" }).textContent,
    ).toContain("Top");
    expect(objposSavedFiles).toHaveLength(0);
  });

  it("shows a stored custom position as it is and writes nothing until one is chosen", async () => {
    const fixture = showcase();
    const report = await reportImage(fixture, 0);
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);
    expect(trigger.textContent).toContain("Custom (30% center)");

    fireEvent.keyDown(trigger, { key: "Enter" });
    await flushFrames();
    fireEvent.keyDown(document.activeElement ?? trigger, { key: "Escape" });
    await flushFrames();
    fireEvent.blur(trigger);
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(sent()).toHaveLength(0);
    expect(
      screen.getByRole("combobox", { name: "Object position" }).textContent,
    ).toContain("Custom (30% center)");
  });

  it("leaves the Starter story image's position to Code: it is not a declared field", async () => {
    const fixture: Fixture = {
      path: STORY_PATH,
      source: starterSource(STORY_PATH),
      type: "image-with-text",
      props: {
        heading: "Story",
        image: { src: "/story.png", alt: "Story" },
        imagePosition: "center center",
      },
    };
    const report = await reportImage(fixture, 0);
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);
    expect(trigger.hasAttribute("data-disabled")).toBe(true);
    expect(note()).toContain("set in code, not by an editable field");
    fireEvent.keyDown(trigger, { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(sent()).toHaveLength(0);
    expect(objposSavedFiles).toHaveLength(0);
  });

  it("leaves an image with no inline position alone: a class edit is not proven yet", async () => {
    const fixture: Fixture = {
      path: PLAIN_PATH,
      source: PLAIN_SOURCE,
      type: "plain-image",
      props: { image: { src: "/plain.png" } },
    };
    const report = await reportImage(fixture, 0);
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);
    expect(trigger.hasAttribute("data-disabled")).toBe(true);
    expect(note()).toContain("isn't editable here for this image yet");
    expect(
      screen
        .getByRole("combobox", { name: "Object fit" })
        .hasAttribute("data-disabled"),
    ).toBe(false);
    expect(sent()).toHaveLength(0);
    expect(objposSavedFiles).toHaveLength(0);
  });

  // The control for the held choice: once the unanswered input is read back
  // as stored, it is acknowledged, not sent again, and the held choice leaves
  // on its own, at the selection's baseline, with nothing else in it.
  it("sends a held choice on its own once the unanswered input reads back as stored", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    let headingCalls = 0;
    updateSectionProps.mockImplementation(async ({ data }) => {
      if ((data.props as Record<string, unknown>).heading !== undefined) {
        headingCalls += 1;
        throw new Error("offline");
      }
      return savedEcho(data);
    });
    const fixture = showcase();
    const heading = await reportImage(fixture, 0, "h2");
    const image = await reportImage(fixture, 1);
    const { editorContext } = renderEditor(fixture);
    let answer!: (value: unknown) => void;
    getThemeEditor.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await flushFrames();
    await typeHeading(heading, "Collections", "Unanswered heading");
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    const trigger = await selectAndOpenStyles({
      ...image,
      selectionRevision: 2,
    });
    await choose(trigger, "Top");
    expect(sent()).toHaveLength(1);
    expect(saveStatus()).not.toBe("Saved");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getThemeEditor).toHaveBeenCalled());
    // The heading did land, unanswered: the read-back shows it stored.
    act(() =>
      answer(
        editorWith(
          editorContext,
          fixture,
          { heading: "Unanswered heading", items: rows() },
          2,
        ),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(headingCalls).toBe(1);
    const after = sent().slice(1);
    expect(after).toHaveLength(1);
    expect(Object.keys(after[0]!.props as object)).toEqual(["items"]);
    expect(after[0]!.expectedSourceGeneration).toBe(1);
    expect(itemsOf(after[0]!)).toEqual([
      ["row-a", "First", "30% center"],
      ["row-b", "Second", "top"],
    ]);
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(1);
    expect(objposSavedFiles).toHaveLength(0);
  });

  /**
   * Every write that left keeps row A as stored and, when it carries the
   * choice, puts it on row B, the row that was selected.
   */
  function expectOnlySelectedRowWritten() {
    for (const data of sent()) {
      const items = (data.props as { items?: Array<Record<string, unknown>> })
        .items;
      if (!items) continue;
      const a = items.find((row) => row.id === "row-a");
      const b = items.find((row) => row.id === "row-b");
      expect(a?.imagePosition).toBe("30% center");
      expect(["top", undefined]).toContain(b?.imagePosition);
    }
  }

  /** Chooses an option with the save debounce held, so it stays queued. */
  async function chooseQueued(trigger: HTMLElement, label: string) {
    fireEvent.keyDown(trigger, { key: "Enter" });
    await flushFrames();
    const option = screen.getByRole("option", { name: label });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.keyDown(option, { key: "Enter" });
    fireEvent.click(option);
    expect(sent()).toHaveLength(0);
  }

  async function releaseQueued() {
    try {
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }

  // The editor reads the Theme again while the choice waits in the debounce:
  // the rows it now holds are B, A. What leaves must still be row B's.
  it("keeps a queued choice on its row when the editor reads the rows reordered before it leaves", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [rowA, rowB] = rows();
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    const { editorContext, receive } = renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);

    await chooseQueued(trigger, "Top");
    act(() => {
      receive(
        editorWith(
          editorContext,
          fixture,
          { heading: "Collections", items: [rowB, rowA] },
          2,
        ).data as unknown as StorefrontThemeEditorDTO,
      );
    });
    await releaseQueued();

    expectOnlySelectedRowWritten();
    expect(objposSavedFiles).toHaveLength(0);
  });

  // Another writer reorders the rows on the server while the choice waits:
  // the write is refused as out of date, and taking the latest while keeping
  // the author's change must not move the choice onto row A.
  it("keeps a queued choice on its row when another writer reordered the rows and the latest is loaded", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [rowA, rowB] = rows();
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    const { client, editorContext } = renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    } as never);

    await chooseQueued(trigger, "Top");
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      editorWith(
        editorContext,
        fixture,
        { heading: "Collections", items: [rowB, rowA] },
        7,
      ) as never,
    );
    await releaseQueued();
    expect(sent()).toHaveLength(1);
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));

    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 8, droppedProps: [] },
    } as never);
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expectOnlySelectedRowWritten();
    expect(objposSavedFiles).toHaveLength(0);
  });

  // The same race for an ordinary row field: a row's title typed in the
  // Content panel, queued in the debounce, while the editor reads the rows
  // back reordered. What leaves must still be row B's title, or nothing.
  it("keeps a queued row title on its row when the editor reads the rows reordered before it leaves", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [rowA, rowB] = rows();
    const fixture = showcase();
    const title = await reportImage(fixture, 1, "h3");
    expect(title).toMatchObject({
      fieldPath: "items.1.title",
      itemId: "row-b",
    });
    const { editorContext, receive } = renderEditor(fixture);
    await flushFrames();
    fromPreview(title);
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    // The selected row's own field comes first; the list editor below shows
    // the same row's title again, written through the same pending path.
    const field = (await screen.findAllByDisplayValue("Second"))[0]!;

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.input(field, { target: { value: "Second edited" } });
    fireEvent.blur(field);
    expect(sent()).toHaveLength(0);
    act(() => {
      receive(
        editorWith(
          editorContext,
          fixture,
          { heading: "Collections", items: [rowB, rowA] },
          2,
        ).data as unknown as StorefrontThemeEditorDTO,
      );
    });
    await releaseQueued();

    for (const data of sent()) {
      const items = (data.props as { items?: Array<Record<string, unknown>> })
        .items;
      if (!items) continue;
      expect(items.find((row) => row.id === "row-a")?.title).toBe("First");
      expect(["Second", "Second edited"]).toContain(
        items.find((row) => row.id === "row-b")?.title,
      );
    }
    expect(objposSavedFiles).toHaveLength(0);
  });

  // The composing snapshot, through the shell. Each write is composed on one
  // read of the document and sent with that read's draft generation.

  it("sends consecutive writes at the generations their own answers returned", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    renderEditor(fixture);
    const trigger = await selectAndOpenStyles(report);
    await chooseAndAwaitWrite(trigger, "Top", "saved");
    await chooseAndAwaitWrite(trigger, "Bottom", "saved");
    expect(sent().map((data) => data.expectedDraftGeneration)).toEqual([1, 2]);
    expect(itemsOf(sent()[1]!)).toEqual([
      ["row-a", "First", "30% center"],
      ["row-b", "Second", "bottom"],
    ]);
  });

  it("refuses a write queued behind another once someone else's reorder is read, and ignores the late answer", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [rowA, rowB] = rows();
    const fixture = showcase();
    const heading = await reportImage(fixture, 0, "h2");
    const image = await reportImage(fixture, 1);
    const { editorContext, receive } = renderEditor(fixture);
    let answerHeading!: (value: unknown) => void;
    updateSectionProps.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerHeading = resolve;
        }),
    );
    await flushFrames();
    await typeHeading(heading, "Collections", "Mine");
    await waitFor(() => expect(sent()).toHaveLength(1));
    // Chosen while the heading is still out: it waits behind it.
    const trigger = await selectAndOpenStyles({
      ...image,
      selectionRevision: 2,
    });
    await choose(trigger, "Top");
    expect(sent()).toHaveLength(1);
    // Someone else reorders the rows; the editor reads it.
    act(() => {
      receive(
        editorWith(
          editorContext,
          fixture,
          { heading: "Collections", items: [rowB, rowA] },
          5,
        ).data as unknown as StorefrontThemeEditorDTO,
      );
    });
    // The heading's answer arrives late, for generation 1.
    act(() => answerHeading(savedEcho(sent()[0] as never)));
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    // Nothing reached row A, and the choice was not sent onto the reordered
    // rows: it is out of date, kept for the author to decide.
    expectOnlySelectedRowWritten();
    expect(
      sent().filter(
        (data) => (data.props as Record<string, unknown>).items !== undefined,
      ),
    ).toHaveLength(0);
    expect(saveStatus()).toBe("Out of date");
    expect(
      screen.getByRole("combobox", { name: "Object position" }).textContent,
    ).toContain("Top");
  });

  it("does not write over someone else's change to the same field", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const heading = await reportImage(fixture, 0, "h2");
    const { editorContext, receive } = renderEditor(fixture);
    await flushFrames();
    fromPreview(heading);
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const field = await screen.findByDisplayValue("Collections");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.input(field, { target: { value: "Mine" } });
    fireEvent.blur(field);
    // Someone else changes the heading; the editor reads it.
    act(() => {
      receive(
        editorWith(
          editorContext,
          fixture,
          { heading: "Theirs", items: rows() },
          2,
        ).data as unknown as StorefrontThemeEditorDTO,
      );
    });
    await releaseQueued();

    expect(sent()).toHaveLength(0);
    expect(saveStatus()).toBe("Out of date");
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();
  });

  // The same field typed into again, once someone else's change to it has
  // been read: the new keystrokes are made on the author's own copy, not on
  // the document that was read, so they are not a reason to write over it.

  /** Opens the section heading in Content and returns its field. */
  async function openHeading(fixture: Fixture) {
    const heading = await reportImage(fixture, 0, "h2");
    const editor = renderEditor(fixture);
    await flushFrames();
    fromPreview(heading);
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const field = await screen.findByDisplayValue("Collections");
    return { ...editor, field };
  }
  /** The read a refetch hands the editor: someone else's heading, at 2. */
  const theirsAt2 = (
    editorContext: StorefrontThemeEditorDTO,
    fixture: Fixture,
  ) =>
    editorWith(editorContext, fixture, { heading: "Theirs", items: rows() }, 2)
      .data as unknown as StorefrontThemeEditorDTO;

  it("does not write over someone else's change when the author keeps typing in the field after it was refused", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const { client, editorContext, receive, field } =
      await openHeading(fixture);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.input(field, { target: { value: "Mine" } });
    fireEvent.blur(field);
    act(() => {
      receive(theirsAt2(editorContext, fixture));
    });
    await releaseQueued();
    expect(sent()).toHaveLength(0);
    expect(saveStatus()).toBe("Out of date");

    // The author goes on typing in the same field, conflict shown.
    const again = screen.getByDisplayValue("Mine");
    fireEvent.input(again, { target: { value: "Mine again" } });
    fireEvent.blur(again);
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(sent()).toHaveLength(0);
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getAllByDisplayValue("Mine again").length).toBeGreaterThan(0);

    await keepMineAndExpectSaved(client, editorContext, fixture, "Mine again");
  });

  /**
   * Presses Load latest, keep mine on the document holding "Theirs" at 2:
   * one write, at 2, carrying the author's newest heading, then saved.
   */
  async function keepMineAndExpectSaved(
    client: QueryClient,
    editorContext: StorefrontThemeEditorDTO,
    fixture: Fixture,
    mine: string,
  ) {
    if (echo) echo.props = { heading: "Theirs", items: rows() };
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      editorWith(
        editorContext,
        fixture,
        { heading: "Theirs", items: rows() },
        2,
      ) as never,
    );
    const before = sent().length;
    const keepMine = screen.getByRole("button", {
      name: "Load latest, keep mine",
    });
    act(() => keepMine.click());
    await waitFor(() =>
      expect(
        sent().length === before + 1 ||
          messagesOfType("morph:storefront-preview-update-section-props").some(
            (message) => {
              const token = message.presentationToken as
                { documentBasis?: { draftGeneration?: number } } | undefined;
              return token?.documentBasis?.draftGeneration === 2;
            },
          ),
      ).toBe(true),
    );
    // If the latest generation was not acknowledged before the explicit click,
    // let the presentation commit first and require a second explicit click.
    // When it was already acknowledged, the first click may write immediately.
    if (sent().length === before) {
      await flushFrames();
      if (sent().length === before) {
        act(() => keepMine.click());
      }
    }
    await waitFor(() => expect(sent()).toHaveLength(before + 1));
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(sent()).toHaveLength(before + 1);
    const write = sent()[before]!;
    expect(write.expectedDraftGeneration).toBe(2);
    expect(write.props).toEqual({ heading: mine });
    await waitFor(() => expect(saveStatus()).toBe("Unpublished"));
  }

  it("does not write over someone else's change read while the author's edit waits, when the field is typed into again before it leaves", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const { client, editorContext, receive, field } =
      await openHeading(fixture);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.input(field, { target: { value: "Mine" } });
    fireEvent.blur(field);
    // Read before the edit leaves; nothing has said "out of date" yet.
    act(() => {
      receive(theirsAt2(editorContext, fixture));
    });
    expect(saveStatus()).not.toBe("Out of date");
    const again = screen.getByDisplayValue("Mine");
    fireEvent.input(again, { target: { value: "Mine again" } });
    fireEvent.blur(again);
    // Restores real timers.
    await releaseQueued();

    expect(sent()).toHaveLength(0);
    // Held while the canvas presents the read copy, then
    // released with that round's proof and refused as made on the older
    // copy (out of date), never sent over theirs; keep mine then saves it.
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(sent()).toHaveLength(0);
    expect(screen.getAllByDisplayValue("Mine again").length).toBeGreaterThan(0);

    await keepMineAndExpectSaved(client, editorContext, fixture, "Mine again");
  });

  // The author is in the field when someone else's change to it is read:
  // the input is not replaced under them, and what they type there was
  // typed on the copy they were looking at.

  it("does not replace the field the author is in, and refuses what they typed there on the older copy", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const { client, editorContext, receive, field } =
      await openHeading(fixture);
    act(() => {
      field.focus();
    });
    // Typed, not yet left: a heading is written when the field is left.
    (field as HTMLTextAreaElement).value = "Mine typed";
    act(() => {
      receive(theirsAt2(editorContext, fixture));
    });
    await flushFrames();
    // The same element, with the author's text.
    expect(field.isConnected).toBe(true);
    expect((field as HTMLTextAreaElement).value).toBe("Mine typed");

    act(() => {
      field.blur();
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(sent()).toHaveLength(0);
    // Restored to its keep-mine recovery.
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(screen.getAllByDisplayValue("Mine typed").length).toBeGreaterThan(0);

    await keepMineAndExpectSaved(client, editorContext, fixture, "Mine typed");
  });

  it("writes nothing when the author leaves the field unchanged, and then shows someone else's change", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const { editorContext, receive, field } = await openHeading(fixture);
    act(() => {
      field.focus();
    });
    act(() => {
      receive(theirsAt2(editorContext, fixture));
    });
    await flushFrames();
    expect(field.isConnected).toBe(true);
    expect((field as HTMLTextAreaElement).value).toBe("Collections");

    act(() => {
      field.blur();
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(sent()).toHaveLength(0);
    expect(saveStatus()).not.toBe("Out of date");
    expect(screen.queryByDisplayValue("Collections")).toBeNull();
    expect(await screen.findByDisplayValue("Theirs")).toBeTruthy();
  });

  it("keeps an IME composition in the field going when someone else's change is read", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const { client, editorContext, receive, field } =
      await openHeading(fixture);
    act(() => {
      field.focus();
    });
    fireEvent.compositionStart(field);
    (field as HTMLTextAreaElement).value = "中";
    act(() => {
      receive(theirsAt2(editorContext, fixture));
    });
    await flushFrames();
    // Not remounted mid-composition: the same element, the composing text.
    expect(field.isConnected).toBe(true);
    expect((field as HTMLTextAreaElement).value).toBe("中");
    (field as HTMLTextAreaElement).value = "中文";
    fireEvent.compositionEnd(field, { data: "中文" });
    act(() => {
      field.blur();
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(sent()).toHaveLength(0);
    // Restored to its keep-mine recovery.
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(screen.getAllByDisplayValue("中文").length).toBeGreaterThan(0);
    await keepMineAndExpectSaved(client, editorContext, fixture, "中文");
  });

  it("counts what the author types in another field as made on the older copy while an update is held back", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [rowA, rowB] = rows();
    const fixture = showcase();
    const title = await reportImage(fixture, 1, "h3");
    const { editorContext, receive } = renderEditor(fixture);
    await flushFrames();
    fromPreview(title);
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    // The selected row's own field, then the list editor's field for it.
    const [selectedTitle, listTitle] =
      await screen.findAllByDisplayValue("Second");
    act(() => {
      selectedTitle!.focus();
    });
    // Someone else retitles row B while the author is in its field: the
    // update is held back, so both fields still show "Second".
    act(() => {
      receive(
        editorWith(
          editorContext,
          fixture,
          {
            heading: "Collections",
            items: [rowA, { ...rowB, title: "Second, theirs" }],
          },
          2,
        ).data as unknown as StorefrontThemeEditorDTO,
      );
    });
    await flushFrames();
    const rowTitle = listTitle!;
    expect((rowTitle as HTMLInputElement).value).toBe("Second");
    act(() => {
      rowTitle.focus();
    });
    fireEvent.input(rowTitle, { target: { value: "Second, mine" } });
    act(() => {
      rowTitle.blur();
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    // Typed on the copy that still showed "Second": not sent over theirs.
    expect(sent()).toHaveLength(0);
    expect(saveStatus()).toBe("Out of date");
  });

  it("shows someone else's change to one field without touching what the author holds in another", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const title = await reportImage(fixture, 1, "h3");
    const { client, editorContext, receive } = renderEditor(fixture);
    await flushFrames();
    fromPreview(title);
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const rowTitle = (await screen.findAllByDisplayValue("Second"))[0]!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.input(rowTitle, { target: { value: "Second, mine" } });
    fireEvent.blur(rowTitle);
    // Someone else changes the heading only.
    act(() => {
      receive(theirsAt2(editorContext, fixture));
    });
    await releaseQueued();

    // The row title is still the author's; it was typed on the older copy,
    // so it waits as out of date rather than going out over that read.
    expect(screen.getAllByDisplayValue("Second, mine").length).toBeGreaterThan(
      0,
    );
    expect(sent()).toHaveLength(0);
    expect(saveStatus()).toBe("Out of date");

    if (echo) echo.props = { heading: "Theirs", items: rows() };
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      editorWith(
        editorContext,
        fixture,
        { heading: "Theirs", items: rows() },
        2,
      ) as never,
    );
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });
    await waitFor(() => expect(sent()).toHaveLength(1));
    // Only the author's field: the other writer's heading is not sent back.
    expect(Object.keys(sent()[0]!.props as object)).toEqual(["items"]);
    expect(itemsOf(sent()[0]!).map(([id, title]) => [id, title])).toEqual([
      ["row-a", "First"],
      ["row-b", "Second, mine"],
    ]);
    await waitFor(() => expect(saveStatus()).toBe("Unpublished"));
  });

  it("shows someone else's change to the field once it is read, when the author has nothing waiting", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const { editorContext, receive } = await openHeading(fixture);
    act(() => {
      receive(theirsAt2(editorContext, fixture));
    });
    await flushFrames();
    // What the author types next is typed on what they can see.
    expect(screen.queryByDisplayValue("Collections")).toBeNull();
    const field = await screen.findByDisplayValue("Theirs");
    fireEvent.input(field, { target: { value: "Theirs, edited" } });
    fireEvent.blur(field);
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.expectedDraftGeneration).toBe(2);
    expect((sent()[0]!.props as { heading?: string }).heading).toBe(
      "Theirs, edited",
    );
    expect(saveStatus()).toBe("Unpublished");
  });

  it("saves the author's consecutive edits to the field, each at the generation the last one returned", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const { field } = await openHeading(fixture);
    fireEvent.input(field, { target: { value: "First" } });
    fireEvent.blur(field);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const next = screen.getAllByDisplayValue("First")[0]!;
    fireEvent.input(next, { target: { value: "Second" } });
    fireEvent.blur(next);
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(sent().map((data) => data.expectedDraftGeneration)).toEqual([1, 2]);
    expect(
      sent().map((data) => (data.props as { heading?: string }).heading),
    ).toEqual(["First", "Second"]);
    expect(saveStatus()).toBe("Unpublished");
  });

  it("reads the page first when an answer brought no document, and sends nothing if it cannot", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    const { editorContext } = renderEditor(fixture);
    // The first answer carries no document.
    updateSectionProps.mockImplementationOnce(async ({ data }) => {
      const answered = savedEcho(data);
      return {
        success: true,
        data: {
          draftGeneration: answered.data.draftGeneration,
          droppedProps: [],
        },
      };
    });
    getThemeEditor.mockRejectedValueOnce(new Error("offline"));
    const trigger = await selectAndOpenStyles(report);
    await choose(trigger, "Top");
    expect(sent()).toHaveLength(1);
    await choose(trigger, "Bottom");

    // The page could not be read: the second choice is kept, not sent.
    expect(sent()).toHaveLength(1);
    expect(saveStatus()).toBe("Save failed");
    expect(trigger.textContent).toContain("Bottom");

    // Readable now: it is sent at the generation that read returned.
    getThemeEditor.mockResolvedValue(
      editorWith(
        editorContext,
        fixture,
        {
          heading: "Collections",
          items: [rows()[0], { ...rows()[1], imagePosition: "top" }],
        },
        2,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1]!.expectedDraftGeneration).toBe(2);
    expect(itemsOf(sent()[1]!)).toEqual([
      ["row-a", "First", "30% center"],
      ["row-b", "Second", "bottom"],
    ]);
  });

  it("does not resend an unanswered choice onto rows someone else reordered, found on Try again", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [rowA, rowB] = rows();
    const fixture = showcase();
    const report = await reportImage(fixture, 1);
    const { editorContext } = renderEditor(fixture);
    updateSectionProps.mockRejectedValueOnce(new Error("offline"));
    const trigger = await selectAndOpenStyles(report);
    await choose(trigger, "Top");
    expect(sent()).toHaveLength(1);
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));

    // Read back: it did not land, and someone else reordered the rows.
    getThemeEditor.mockResolvedValue(
      editorWith(
        editorContext,
        fixture,
        { heading: "Collections", items: [rowB, rowA] },
        4,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(sent()).toHaveLength(1);
    expectOnlySelectedRowWritten();
    // The read found a newer document, so the frozen selected-row basis has
    // moved. The original CAS can no longer land; keep the choice as a
    // recoverable conflict instead of holding the whole session unknown.
    expect(saveStatus()).toBe("Out of date");
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();
  });
});

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

  it("gives the default rows their ids before the first edit, and saves the whole list", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [one, two] = identified();
    expect(one!.id.startsWith("morph-mig-")).toBe(true);
    const { report } = await openTitle({}, 1);
    // Nothing stores the rows, so the canvas cannot name the row it clicked.
    expect(report).toMatchObject({ fieldPath: "items.1.title", itemId: null });

    await type("Two", "Two edited");
    await settle();

    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.expectedDraftGeneration).toBe(1);
    expect(rowsSent(sent()[0]!)).toEqual([
      [one!.id, "One"],
      [two!.id, "Two edited"],
    ]);
    expect(saveStatus()).toBe("Unpublished");
  });

  it("stores nothing, and gives no row an id, when the first edit changes nothing", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    await openTitle({}, 1);

    await type("Two", "Two");
    await settle();

    expect(sent()).toHaveLength(0);
    expect(saveStatus()).not.toBe("Out of date");
  });

  it("keeps the same ids through the edits that follow", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [one, two] = identified();
    // The other row is selected on the canvas once the list is stored,
    // which by then names it by its id. (Taken first: it replaces the body.)
    const firstRow = await reportTitle(
      { items: [one, { ...two, title: "Two edited" }] },
      0,
    );
    expect(firstRow).toMatchObject({
      fieldPath: "items.0.title",
      itemId: one!.id,
    });
    await openTitle({}, 1);

    await type("Two", "Two edited");
    await settle();
    await type("Two edited", "Two again");
    await settle();
    fromPreview(firstRow);
    await flushFrames();
    await type("One", "One edited");
    await settle();

    expect(sent().map((data) => data.expectedDraftGeneration)).toEqual([
      1, 2, 3,
    ]);
    expect(sent().map(rowsSent)).toEqual([
      [
        [one!.id, "One"],
        [two!.id, "Two edited"],
      ],
      [
        [one!.id, "One"],
        [two!.id, "Two again"],
      ],
      [
        [one!.id, "One edited"],
        [two!.id, "Two again"],
      ],
    ]);
    expect(saveStatus()).toBe("Unpublished");
  });

  it("addresses the same rows by those ids after a reload", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [one, two] = identified();
    await openTitle({}, 1);
    await type("Two", "Two edited");
    await settle();
    expect(sent()).toHaveLength(1);
    cleanup();

    // The editor opened again on what the server now holds.
    const reloaded = { ...stored };
    const { report } = await openTitle(reloaded, 1, draftGeneration);
    expect(report).toMatchObject({
      fieldPath: "items.1.title",
      itemId: two!.id,
    });
    await type("Two edited", "Two after reload");
    await settle();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]!.expectedDraftGeneration).toBe(2);
    expect(rowsSent(sent()[1]!)).toEqual([
      [one!.id, "One"],
      [two!.id, "Two after reload"],
    ]);
  });

  it("refuses an edit still queued when the list is read back stored in another order", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    const [one, two] = identified();
    const { receive } = await openTitle({}, 1);

    const field = (await screen.findAllByDisplayValue("Two"))[0]!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.input(field, { target: { value: "Two edited" } });
      fireEvent.blur(field);
      expect(sent()).toHaveLength(0);
      // Someone else stored the same rows, reordered, before this one left.
      act(() => {
        receive(editorAt({ items: [two, one] }, 2));
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }
    await settle();

    // Nothing lands on the row now at index 1, and the input is kept.
    expect(sent()).toHaveLength(0);
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getAllByDisplayValue("Two edited").length).toBeGreaterThan(0);
  });

  /**
   * The first keystroke stores the list, which gives its rows their ids. A row
   * card keyed by position until then was replaced at that keystroke, and the
   * input with it: focus went to the body, the caret was gone and the next
   * keys reached nothing (handoff 2026-11-06/row-id-seeding). The cards are
   * now keyed from the first render by the ids that keystroke stores.
   *
   * Keystrokes are synthetic: the value and caret are set the way a browser
   * leaves them, then an input event is fired. A real IME is not exercised.
   */
  describe("typing into a row of a list nothing stores yet", () => {
    /** The card one row is drawn in; keyed by the row's id. */
    const rowCardOf = (input: HTMLElement) =>
      input.closest<HTMLElement>('[class*="bg-muted/30"]');
    /** One key at the caret, as a browser's input event would leave it. */
    const press = (input: HTMLInputElement, key: string) => {
      const caret = input.selectionStart ?? input.value.length;
      const next = input.value.slice(0, caret) + key + input.value.slice(caret);
      act(() => {
        input.value = next;
        input.setSelectionRange(caret + key.length, caret + key.length);
      });
      fireEvent.input(input);
    };
    /** The focused element, which is where a real next key goes. */
    const focused = () => {
      const active = document.activeElement;
      expect(active).toBeInstanceOf(HTMLInputElement);
      return active as HTMLInputElement;
    };
    async function enter(shown: string, caret: number) {
      const input = (
        await screen.findAllByDisplayValue(shown)
      )[0]! as HTMLInputElement;
      act(() => input.focus());
      input.setSelectionRange(caret, caret);
      return input;
    }

    /** Two keys into "Two", checked after each, then left and saved. */
    async function typeTwoKeys() {
      const input = await enter("Two", 3);
      const card = rowCardOf(input);
      expect(card).toBeTruthy();

      press(input, "!");
      await flushFrames();
      expect(input.isConnected, "the same input after key 1").toBe(true);
      expect(card!.isConnected, "the same row card after key 1").toBe(true);
      expect(document.activeElement, "focus after key 1").toBe(input);
      expect(input.selectionStart, "caret after key 1").toBe(4);

      press(focused(), "?");
      await flushFrames();
      expect(input.isConnected, "the same input after key 2").toBe(true);
      expect(document.activeElement, "focus after key 2").toBe(input);
      expect(input.selectionStart, "caret after key 2").toBe(5);
      expect(input.value).toBe("Two!?");

      act(() => input.blur());
      await settle();
      return { input, card: card! };
    }

    it("keeps the input, its focus and caret from the first key, and stores the ids the server derives", async () => {
      vi.spyOn(toast, "error").mockImplementation(() => "");
      const [one, two] = identified();
      await openTitle({}, 1);

      await typeTwoKeys();

      expect(sent()).toHaveLength(1);
      expect(sent()[0]!.expectedDraftGeneration).toBe(1);
      expect(rowsSent(sent()[0]!)).toEqual([
        [one!.id, "One"],
        [two!.id, "Two!?"],
      ]);
      expect(stored.items).toEqual([
        { id: one!.id, title: "One" },
        { id: two!.id, title: "Two!?" },
      ]);
      expect(saveStatus()).toBe("Unpublished");
    });

    it("control: a list stored with ids behaves the same", async () => {
      vi.spyOn(toast, "error").mockImplementation(() => "");
      const [one, two] = identified();
      await openTitle({ items: [one, two] }, 1);

      await typeTwoKeys();

      expect(sent()).toHaveLength(1);
      expect(rowsSent(sent()[0]!)).toEqual([
        [one!.id, "One"],
        [two!.id, "Two!?"],
      ]);
      expect(saveStatus()).toBe("Unpublished");
    });

    it("keeps the ids, the card and the input after the first save, without deriving them again", async () => {
      vi.spyOn(toast, "error").mockImplementation(() => "");
      const [one, two] = identified();
      await openTitle({}, 1);
      const { input, card } = await typeTwoKeys();

      // The server's answer now holds the list; the same card and input stay.
      expect(card.isConnected, "the same row card after the save").toBe(true);
      expect(input.isConnected, "the same input after the save").toBe(true);
      act(() => input.focus());
      input.setSelectionRange(5, 5);
      press(input, ".");
      await flushFrames();
      expect(document.activeElement).toBe(input);
      act(() => input.blur());
      await settle();

      expect(sent().map((data) => data.expectedDraftGeneration)).toEqual([
        1, 2,
      ]);
      // Derived again from "Two!?" the second row would get another id.
      expect(rowsSent(sent()[1]!)).toEqual([
        [one!.id, "One"],
        [two!.id, "Two!?."],
      ]);
    });

    it("changes no other row's id or card when another row is typed in", async () => {
      vi.spyOn(toast, "error").mockImplementation(() => "");
      const [one, two] = identified();
      await openTitle({}, 0);
      const other = (
        await screen.findAllByDisplayValue("Two")
      )[0]! as HTMLInputElement;
      const otherCard = rowCardOf(other);
      expect(otherCard).toBeTruthy();

      const input = await enter("One", 3);
      press(input, "!");
      await flushFrames();
      expect(input.isConnected).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(other.isConnected, "the other row's input").toBe(true);
      expect(otherCard!.isConnected, "the other row's card").toBe(true);
      act(() => input.blur());
      await settle();

      expect(sent()).toHaveLength(1);
      expect(rowsSent(sent()[0]!)).toEqual([
        [one!.id, "One!"],
        [two!.id, "Two"],
      ]);
    });

    it("sends and stores nothing by drawing the list", async () => {
      vi.spyOn(toast, "error").mockImplementation(() => "");
      await openTitle({}, 1);
      expect(screen.getAllByDisplayValue("One").length).toBeGreaterThan(0);
      expect(screen.getAllByDisplayValue("Two").length).toBeGreaterThan(0);
      await settle();

      expect(updateSectionProps).not.toHaveBeenCalled();
      expect(stored).toEqual({});
      expect(saveStatus()).not.toBe("Out of date");
    });

    it("keeps the input through a synthetic composition (jsdom events, not a real IME)", async () => {
      vi.spyOn(toast, "error").mockImplementation(() => "");
      const [one, two] = identified();
      await openTitle({}, 1);
      const input = await enter("Two", 3);

      fireEvent.compositionStart(input);
      press(input, "あ");
      await flushFrames();
      expect(input.isConnected, "the same input during composition").toBe(true);
      expect(document.activeElement).toBe(input);
      act(() => {
        input.value = "Two亜";
        input.setSelectionRange(4, 4);
      });
      fireEvent.input(input);
      fireEvent.compositionEnd(input, { data: "亜" });
      await flushFrames();
      expect(input.isConnected, "the same input after composition").toBe(true);
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(4);
      act(() => input.blur());
      await settle();

      expect(rowsSent(sent().at(-1)!)).toEqual([
        [one!.id, "One"],
        [two!.id, "Two亜"],
      ]);
    });
  });

  /**
   * Stage 1 of "refuse an existing-Document content write that has no version
   * basis". The basis is the latest accepted snapshot generation at the time
   * the author acted. A content write made with none is refused before any
   * request: the input stays (Out of date, "Load latest, keep mine"), the
   * history does not move, nothing reads as saved, and nothing is sent again
   * on its own with a newer basis.
   *
   * How the missing basis is constructed here: every read the editor is
   * given before the other tab's change (its context and the Theme read the
   * preview's instance replay makes) carries no valid draft generation for
   * the document (`NO_GENERATION`), so it holds no snapshot of it when the
   * author acts. That is a state this shell test builds; whether the real
   * editor can reach it for a document already in its context is not shown
   * here.
   */
  describe("stage 1: a content write with no version basis", () => {
    // Not undefined: the helpers default an omitted generation to 1.
    const NO_GENERATION = null as unknown as number;
    const depth = () =>
      document
        .querySelector("[data-editor-undo-depth]")
        ?.getAttribute("data-editor-undo-depth") ?? null;
    const unconfirmedCount = () =>
      document
        .querySelector("[data-editor-unconfirmed-saves]")
        ?.getAttribute("data-editor-unconfirmed-saves") ?? null;
    const notices = () => ({
      warning: vi.spyOn(toast, "warning").mockImplementation(() => ""),
      error: vi.spyOn(toast, "error").mockImplementation(() => ""),
    });
    const conflictAnswer = {
      success: false,
      error: "TEMPLATE_DRAFT_CONFLICT",
      message: "Template draft was modified concurrently.",
    };
    /** The rows another tab stored: the drawn rows, one title changed. */
    const theirRows = () => {
      const [one, two] = identified();
      return [one!, { ...two!, title: "Theirs" }];
    };
    /** Another tab stores `props` at the next draft generation. */
    const theyWrite = (props: Record<string, unknown>) => {
      stored = { ...props };
      draftGeneration += 1;
    };
    /** The last row titles the canvas was told for the section. */
    const canvasRows = () => {
      const last = posted
        .filter(
          (message) =>
            message.type === "morph:storefront-preview-update-section-props" &&
            message.sectionId === "section" &&
            message.props &&
            typeof message.props === "object",
        )
        .at(-1);
      const items = (last?.props as { items?: Array<{ title?: string }> })
        ?.items;
      return items?.map((row) => row.title) ?? null;
    };

    /** Whether a read of the Theme carries the document's draft generation. */
    let readsCarryGeneration = true;
    beforeEach(() => {
      readsCarryGeneration = true;
      // A read of the Theme answers what the server holds.
      getThemeEditor.mockReset();
      getThemeEditor.mockImplementation(async () => ({
        success: true,
        message: "ok",
        data: editorAt(
          { ...stored },
          readsCarryGeneration ? draftGeneration : NO_GENERATION,
        ),
      }));
      // The server checks the draft generation, as the real one does.
      updateSectionProps.mockImplementation(async ({ data }) => {
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
      });
    });

    describe("an Inspector field", () => {
      /**
       * A scalar field. (The same timeline on a list row is already refused
       * before this change by the list guards, without saying why; the
       * scalar is where nothing else refused it.)
       */
      async function openHeading(atGeneration: number) {
        headingField = true;
        stored = { heading: "Hello" };
        const report = await reportTitle({ heading: "Hello" }, 0, (root) =>
          root.querySelector(
            "[data-storefront-section-id],[data-morph-section]",
          ),
        );
        const editor = renderEntries({ heading: "Hello" }, atGeneration);
        await flushFrames();
        fromPreview(report);
        await flushFrames();
        const contentTab = screen.queryByRole("button", {
          name: /^Content$/,
        });
        if (contentTab) fireEvent.click(contentTab);
        await flushFrames();
        return editor;
      }

      it("typed with no basis, then another tab's change read before it leaves: nothing sent, theirs kept, the input kept as not saved", async () => {
        const notice = notices();
        readsCarryGeneration = false;
        const { receive } = await openHeading(NO_GENERATION);
        const field = (await screen.findAllByDisplayValue("Hello"))[0]!;
        expect((field as HTMLInputElement).disabled).toBe(true);
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
          // Direct dispatch bypasses the disabled control to model a late
          // event; a real user cannot type until the presentation is ready.
          fireEvent.input(field, { target: { value: "Mine" } });
          fireEvent.blur(field);
          expect(sent()).toHaveLength(0);
          // Another tab stores its own heading; the editor reads it before
          // the debounced write leaves.
          theyWrite({ heading: "Theirs" });
          act(() => {
            receive(editorAt({ ...stored }, draftGeneration));
          });
          await act(async () => {
            vi.advanceTimersByTime(300);
          });
        } finally {
          vi.useRealTimers();
        }
        await settle();

        expect(sent(), "no request").toHaveLength(0);
        expect(stored, "their heading kept").toEqual({ heading: "Theirs" });
        expect(saveStatus()).toBe("Unsaved");
        expect(screen.getAllByDisplayValue("Mine").length).toBeGreaterThan(0);
        expect(depth(), "history unchanged").toBe("0");
        expect(unconfirmedCount()).toBeNull();
        expect(notice.warning).toHaveBeenCalledWith(
          PREVIEW_PRESENTATION_SYNCING_MESSAGE,
          expect.anything(),
        );
        await settle();
        expect(sent(), "nothing is sent on its own").toHaveLength(0);
      });

      it("keeps Content paused without a basis, then presents the latest read before enabling it", async () => {
        const notice = notices();
        readsCarryGeneration = false;
        const { receive } = await openHeading(NO_GENERATION);
        const field = (
          await screen.findAllByDisplayValue("Hello")
        )[0]! as HTMLInputElement;
        expect(field.disabled).toBe(true);
        expect(
          screen
            .getAllByRole("status")
            .some((status) => status.textContent?.includes("Preview syncing")),
        ).toBe(true);
        theyWrite({ heading: "Theirs" });
        act(() => {
          receive(editorAt({ ...stored }, draftGeneration));
        });
        await flushFrames();
        const currentField = (await screen.findByDisplayValue(
          "Theirs",
        )) as HTMLInputElement;
        await waitFor(() => expect(currentField.disabled).toBe(false));

        expect(sent(), "no request").toHaveLength(0);
        expect(stored).toEqual({ heading: "Theirs" });
        expect(currentField.isConnected).toBe(true);
        expect(depth()).toBe("0");
        expect(unconfirmedCount()).toBeNull();
        expect(notice.error).not.toHaveBeenCalled();
        expect(notice.warning).not.toHaveBeenCalled();
      });

      it("control: focused on generation 1, another tab's change read, then typed: refused as out of date", async () => {
        notices();
        const { receive } = await openHeading(1);
        const field = (
          await screen.findAllByDisplayValue("Hello")
        )[0]! as HTMLInputElement;
        act(() => field.focus());
        theyWrite({ heading: "Theirs" });
        act(() => {
          receive(editorAt({ ...stored }, draftGeneration));
        });
        await flushFrames();
        fireEvent.input(field, { target: { value: "Mine" } });
        fireEvent.blur(field);
        await settle();
        expect(sent()).toHaveLength(0);
        expect(stored).toEqual({ heading: "Theirs" });
        expect(saveStatus()).toBe("Out of date");
      });

      it("control: typed with the basis it was made on, nothing else in between: written once", async () => {
        notices();
        await openTitle({}, 1);
        await type("Two", "Two edited");
        await settle();
        expect(sent()).toHaveLength(1);
        expect(sent()[0]!.expectedDraftGeneration).toBe(1);
        expect(saveStatus()).toBe("Unpublished");
        expect(depth()).toBe("1");
      });

      it("control: typed on generation 1, another tab's change read before it leaves: refused as out of date", async () => {
        notices();
        const { receive } = await openTitle({}, 1);
        const field = (await screen.findAllByDisplayValue("Two"))[0]!;
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
          fireEvent.input(field, { target: { value: "Two edited" } });
          fireEvent.blur(field);
          theyWrite({ items: theirRows() });
          act(() => {
            receive(editorAt({ ...stored }, draftGeneration));
          });
          await act(async () => {
            vi.advanceTimersByTime(300);
          });
        } finally {
          vi.useRealTimers();
        }
        await settle();
        expect(sent()).toHaveLength(0);
        expect(stored).toEqual({ items: theirRows() });
        expect(saveStatus()).toBe("Out of date");
      });
    });

    describe("a canvas reorder", () => {
      const drag = (dragged: number, target: number) =>
        fromPreview({
          type: "morph:storefront-preview-commit-array-item-reorder",
          sectionId: "section",
          draggedFieldPath: `items.${dragged}`,
          targetFieldPath: `items.${target}`,
        });

      it("rejects a drag signal without a presentation basis and keeps the latest server rows", async () => {
        const notice = notices();
        readsCarryGeneration = false;
        await openTitle({}, 1, NO_GENERATION);
        theyWrite({ items: theirRows() });

        // Inject the bridge event directly despite the syncing page; real
        // reorder controls remain unavailable until the page is acknowledged.
        drag(1, 0);
        await settle();

        expect(sent(), "no request").toHaveLength(0);
        expect(stored).toEqual({ items: theirRows() });
        expect(saveStatus()).toBe("Unsaved");
        expect(canvasRows(), "no unacknowledged swap is applied").toBeNull();
        expect(depth(), "history unchanged").toBe("0");
        expect(unconfirmedCount()).toBeNull();
        expect(notice.warning).toHaveBeenCalledWith(
          PREVIEW_PRESENTATION_SYNCING_MESSAGE,
          expect.anything(),
        );
        await settle();
        expect(sent()).toHaveLength(0);
      });

      it("control: dragged with the basis it was made on: written once", async () => {
        notices();
        await openTitle({}, 1);
        drag(1, 0);
        await settle();
        expect(sent()).toHaveLength(1);
        expect(sent()[0]!.expectedDraftGeneration).toBe(1);
        expect(depth()).toBe("1");
      });

      it("control: dragged on generation 1 after another tab's unread change: refused by the draft generation, theirs kept", async () => {
        notices();
        await openTitle({}, 1);
        theyWrite({ items: theirRows() });
        drag(1, 0);
        await settle();
        expect(sent()).toHaveLength(1);
        expect(sent()[0]!.expectedDraftGeneration).toBe(1);
        expect(stored).toEqual({ items: theirRows() });
        expect(depth()).toBe("0");
      });
    });

    describe('"Use code default"', () => {
      async function openSection(
        props: Record<string, unknown>,
        atGeneration = 1,
      ) {
        const report = await reportTitle(props, 0, (root) =>
          root.querySelector(
            "[data-storefront-section-id],[data-morph-section]",
          ),
        );
        const editor = renderEntries(props, atGeneration);
        await flushFrames();
        fromPreview(report);
        await flushFrames();
        const contentTab = screen.queryByRole("button", {
          name: /^Content$/,
        });
        if (contentTab) fireEvent.click(contentTab);
        await flushFrames();
        return editor;
      }
      /** Pressed as a pointer does: down, focus leaves the input, click. */
      const pressReset = async () => {
        const button = await screen.findByRole("button", {
          name: "Use code default",
        });
        fireEvent.pointerDown(button);
        act(() => (document.activeElement as HTMLElement | null)?.blur());
        fireEvent.click(button);
        await settle();
      };
      beforeEach(() => {
        headingField = true;
      });

      it("after a no-basis read, waits for the latest value to be presented before Reset uses it", async () => {
        const notice = notices();
        stored = { heading: "Hello" };
        readsCarryGeneration = false;
        const { receive } = await openSection(
          { heading: "Hello" },
          NO_GENERATION,
        );
        const field = (
          await screen.findAllByDisplayValue("Hello")
        )[0]! as HTMLInputElement;
        expect(field.disabled).toBe(true);
        theyWrite({ heading: "Theirs" });
        act(() => {
          receive(editorAt({ ...stored }, draftGeneration));
        });
        await flushFrames();
        const currentField = (await screen.findByDisplayValue(
          "Theirs",
        )) as HTMLInputElement;
        await waitFor(() => expect(currentField.disabled).toBe(false));
        const reset = await screen.findByRole("button", {
          name: "Use code default",
        });
        expect((reset as HTMLButtonElement).disabled).toBe(false);
        expect(sent(), "reading and presenting does not write").toHaveLength(0);

        await pressReset();

        expect(sent(), "Reset uses the newly presented copy").toHaveLength(1);
        expect(sent()[0]).toMatchObject({
          resetProps: ["heading"],
          expectedDraftGeneration: 2,
          expectedSourceGeneration: 1,
        });
        expect(stored).toEqual({});
        expect(depth()).toBe("1");
        expect(unconfirmedCount()).toBeNull();
        expect(notice.error).not.toHaveBeenCalled();
      });

      it("pressed with no basis, another tab's change on the server: nothing sent, theirs kept", async () => {
        const notice = notices();
        stored = { heading: "Hello" };
        readsCarryGeneration = false;
        await openSection({ heading: "Hello" }, NO_GENERATION);
        theyWrite({ heading: "Theirs" });

        expect(
          screen.queryByRole("button", { name: "Use code default" }),
        ).toBeNull();
        expect(
          screen
            .getAllByRole("status")
            .some((status) => status.textContent?.includes("Preview syncing")),
        ).toBe(true);
        expect(sent(), "no request").toHaveLength(0);
        expect(stored).toEqual({ heading: "Theirs" });
        expect(depth()).toBe("0");
        expect(notice.error).not.toHaveBeenCalled();
        expect(notice.warning).not.toHaveBeenCalled();
      });

      it("control: pressed with the basis it was made on: one removal, recorded once", async () => {
        notices();
        stored = { heading: "Hello" };
        await openSection({ heading: "Hello" });
        await pressReset();
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toMatchObject({
          resetProps: ["heading"],
          expectedDraftGeneration: 1,
        });
        expect(stored).toEqual({});
        expect(depth()).toBe("1");
      });

      it("control: pressed on generation 1 while the field still shows the copy it was focused on, after another tab's change was read: refused before sending, theirs kept", async () => {
        notices();
        stored = { heading: "Hello" };
        const { receive } = await openSection({ heading: "Hello" });
        const field = (
          await screen.findAllByDisplayValue("Hello")
        )[0]! as HTMLInputElement;
        act(() => field.focus());
        theyWrite({ heading: "Theirs" });
        act(() => {
          receive(editorAt({ ...stored }, draftGeneration));
        });
        await flushFrames();
        await pressReset();
        expect(sent()).toHaveLength(0);
        expect(stored).toEqual({ heading: "Theirs" });
        expect(depth()).toBe("0");
      });
    });
  });

});
