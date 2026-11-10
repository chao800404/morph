import { createLiveFrame } from "@/lib/test-utils/preview-frame-handshake";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
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
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import {
  INLINE_TEXT_NOT_SAVED_MESSAGE,
  INLINE_TEXT_REFUSED_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";
import { STARTER_THEME_FILES as OBJPOS_STARTER_FILES } from "@/lib/storefront/starter-theme-files";
import {
  identifyUnstoredListRows,
  normalizeDocumentRowIds,
} from "@/lib/storefront/editor/normalize-row-ids";
import {
  MISSING_BASIS_MESSAGE,
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

/**
 * Every Theme file save the shell starts, recorded and then made as usual:
 * the object position tests assert that the control saves no source.
 */
const objposSavedFiles = vi.hoisted((): unknown[] => []);
vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const save = actual.saveStorefrontThemeFile as (
      ...args: unknown[]
    ) => unknown;
    return {
      ...actual,
      saveStorefrontThemeFile: (...args: unknown[]) => {
        objposSavedFiles.push(args[0]);
        return save(...args);
      },
    };
  },
);

/**
 * The selection round trip through the shell, rather than through the rules.
 *
 * `preview-reveal-request.test.ts` already pins what the editor decides about a
 * report — supersession, target matching, which preview it came from. What it
 * cannot see is whether the shell feeds those rules the right numbers, and that
 * is where this round trip has actually broken: a selection-mode re-assertion
 * that minted a fresh revision silently outranked the request the author had
 * just made, so the first tree click of every session was answered and then
 * thrown away.
 *
 * The harness plays the preview. `postEditorToPreviewMessage` is observed
 * instead of driven through a real iframe, because the transport refuses to
 * address a frame that is still same-origin — which is every iframe jsdom can
 * make — and would swallow the messages this is here to watch. Incoming
 * messages are real ones on `window`, so they still pass the transport's origin,
 * source and session checks.
 *
 * The Inspector panel is the real one; see the mock below for what it adds.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
/** The frame comes up and names its page, as a live one does. */
const liveFrame = createLiveFrame({
  origin: PREVIEW_ORIGIN,
  session: PREVIEW_SESSION,
});

const posted: Array<Record<string, unknown>> = [];

beforeEach(() => {
  posted.length = 0;
  // Code acceptance and observed query versions are intentionally distinct.
  // No scenario may inherit the previous test's observed source generation.
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
});

/**
 * The Inspector panel is the real one, with one button beside it.
 *
 * It used to be stubbed out as a jsdom workaround: with it rendered, a failed
 * content write tore the tree down through "Maximum update depth exceeded".
 * That was not jsdom's. The fixture's hero has no `props`, and the Inspector's
 * content hook made a fresh `{}` for it on every render — an effect dependency
 * that set state — so it re-rendered until React gave up. The hook takes
 * `props` as `unknown` and has to survive any of them, so rendering the panel
 * here keeps that path under test.
 *
 * The button reaches `onUpdateThemeFileStyle`, which the real panel hands to
 * `EditorStyleInspector`: the style path is otherwise only reachable through
 * Radix controls jsdom cannot drive.
 */
vi.mock("./editor-assistant-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-assistant-panel")>();
  const RealPanel = actual.EditorAssistantPanel;
  return {
    ...actual,
    EditorAssistantPanel: (props: ComponentProps<typeof RealPanel>) => (
      <>
        <RealPanel {...props} />
        <button
          type="button"
          onClick={() =>
            props.onUpdateThemeFileStyle?.(
              stylePatchTarget.filePath,
              stylePatchTarget.elementName,
              (prevClasses) => `${prevClasses} p-8`,
            )
          }
        >
          Apply a style patch
        </button>
        <button
          type="button"
          onClick={() =>
            void props.onPromoteText?.({
              sectionId: "hero",
              componentSourcePath: "src/components/Hero.tsx",
              targetKey: "heading",
              fieldName: "heading",
              value: "Welcome",
            })
          }
        >
          Promote the selected text
        </button>
      </>
    ),
  };
});

/**
 * The content write an inline-text commit reaches.
 *
 * Mocked so a failure can be produced on demand. The shape decides which
 * callback runs: a refused write resolves with `success: false` — the OCC
 * conflict case — while a request that never lands rejects and goes to
 * `onError`. Both have to reach the author.
 */
const updateSectionProps = vi.hoisted(() => vi.fn());
const promoteText = vi.hoisted(() => vi.fn());

/**
 * The editor's read of the Theme, which is how a write that got no answer is
 * checked before anything is sent again.
 */
const getThemeEditor = vi.hoisted(() => vi.fn());

/**
 * What the stub panel asks the shell to patch.
 *
 * A `line:column` location rather than a marker, because
 * `element-target.test.ts` pins `"99:1"` as the target that matches no element
 * — so this drives the real `not-found` branch instead of a spelling that
 * merely happens to miss.
 */
const stylePatchTarget = vi.hoisted(() => ({
  filePath: "src/components/Hero.tsx",
  elementName: "99:1",
}));

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    promoteStorefrontThemeText: promoteText,
    getStorefrontThemeEditor: getThemeEditor,
  }),
);

vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(
    (_target: unknown, message: Record<string, unknown>) => {
      posted.push(message);
    },
  ),
}));

// The shell's breadcrumb uses `Link`. A real router would make this a test
// about routing.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to?: string;
    children?: React.ReactNode;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const context = {
  previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
  storefront: {
    id: "storefront-1",
    name: "Store",
    domain: null,
    status: "active",
  },
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      document: {
        version: 1,
        sections: [{ id: "hero", type: "hero", props: { heading: "Welcome" } }],
      },
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const baseSearch = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

const heroNode = {
  id: "hero:node:heading",
  parentId: null,
  sectionId: "hero",
  label: "Heading",
  kind: "heading",
  tagName: "h1",
  target: {
    sectionId: "hero",
    nodeId: "hero:node:heading",
    elementKey: "heading",
    // The inline-text guard maps one text box to one persisted field and
    // compares these against the message it is sent.
    fieldKey: "heading",
    fieldPath: "heading",
    isSection: false,
  },
};

/** A preview server that is up, so the shell has something to frame. */
function readyQueryClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    } as never,
  );
  return client;
}

function renderShell(
  client = readyQueryClient(),
  editorContext: StorefrontThemeEditorDTO = context,
) {
  return render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={editorContext}
        search={baseSearch}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/** A message from the framed preview, addressed so the transport accepts it. */
function fromPreview(data: Record<string, unknown>) {
  liveFrame.before(data);
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION },
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
  liveFrame.after(data);
}

const messagesOfType = (type: string) =>
  posted.filter((message) => message.type === type);

/**
 * Selects the one node, then commits text into it the way the canvas does.
 *
 * The preview decides whether an element is an inline-text candidate; the shell
 * re-checks the descriptor it already holds, then writes. So the harness only
 * has to select the node and send the commit.
 */
async function commitInlineText(value = "Hello", originalValue = "Welcome") {
  await selectHeading();
  sendInlineCommit(value, originalValue);
}

async function selectHeading() {
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes: [heroNode],
  });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
}

function sendInlineCommit(
  value: string,
  originalValue: string,
  field: { fieldKey: string; fieldPath: string } = {
    fieldKey: "heading",
    fieldPath: "heading",
  },
  sectionId = "hero",
) {
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId,
    ...field,
    value,
    originalValue,
  });
}

/**
 * The editor's read of the Theme, with the hero holding `props` — at
 * `draftGeneration` when given, otherwise at the fixture's own.
 */
function editorHolding(
  props: Record<string, unknown>,
  draftGeneration?: number,
) {
  return {
    success: true,
    message: "ok",
    data: {
      ...context,
      templates: [
        {
          ...context.templates[0],
          ...(draftGeneration === undefined ? {} : { draftGeneration }),
          document: {
            version: 1,
            sections: [{ id: "hero", type: "hero", props }],
          },
        },
      ],
    },
  };
}

/** The header's own marker, which outlives the toast. */
const saveStatus = () =>
  document
    .querySelector("[data-editor-save-status]")
    ?.getAttribute("aria-label");

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A viewport with a height.
 *
 * The reveal reads the viewport height through the canvas's `ResizeObserver`,
 * and jsdom has no layout: `clientHeight` is 0 and the setup file's observer
 * never fires, so the reveal's `viewportHeight <= 0` guard returns before the
 * canvas is moved. Reporting a height through the observer the shell actually
 * registers is what puts the wiring in range.
 */
const VIEWPORT_HEIGHT = 900;

function isCanvasViewport(target: Element): boolean {
  return (
    target.getAttribute("role") === "region" &&
    (target.getAttribute("aria-label") ?? "").startsWith(
      "Storefront preview canvas",
    )
  );
}

class ReportingResizeObserver {
  private readonly reported = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    if (this.reported.has(target)) return;
    this.reported.add(target);
    // Radix registers one of these per floating element; only the canvas is
    // answered, which is what the setup file's silent stub does for the rest.
    if (!isCanvasViewport(target)) return;
    queueMicrotask(() => {
      this.callback(
        [
          {
            target,
            contentRect: { height: VIEWPORT_HEIGHT },
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    });
  }

  unobserve() {}

  disconnect() {}
}

/** The canvas offset the transform was applied to the DOM with, or null. */
function canvasY(): string | null {
  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>("*"),
  )) {
    const value = element.style.getPropertyValue("--morph-canvas-y");
    if (value) return value;
  }
  return null;
}

/** Lets the reveal's frame, and the transform's own frame, run. */
async function flushFrames() {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
}

describe("the selection round trip", () => {
  it("tells the frame which section the tree moved to", () => {
    const { rerender } = renderShell();
    posted.length = 0;

    rerender(
      <QueryClientProvider client={readyQueryClient()}>
        <VisualEditorShell
          context={context}
          search={{ ...baseSearch, section: "hero" }}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(
      messagesOfType("morph:storefront-preview-set-section"),
    ).toContainEqual(expect.objectContaining({ sectionId: "hero" }));
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
              { id: "second", type: "hero", props: { heading: "Second" } },
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
              { id: "hero", type: "hero", props: { heading: "Theirs" } },
              { id: "second", type: "hero", props: { heading: "Second" } },
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

  it("keeps an unanswered write tracked when the readback does not show it", async () => {
    updateSectionProps
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        success: true,
        data: { draftGeneration: 2, droppedProps: [] },
      } as never);
    getThemeEditor.mockResolvedValue(editorHolding({}));
    renderShell();
    await commitInlineText();
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    getThemeEditor.mockClear();

    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });

    await waitFor(() => expect(getThemeEditor).toHaveBeenCalled());
    // A negative read does not cancel the request that got no answer. Keep it
    // tracked and do not send the frozen payload again.
    expect(getThemeEditor).toHaveBeenCalled();
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(
      document
        .querySelector("[data-editor-unconfirmed-saves]")
        ?.getAttribute("data-editor-unconfirmed-saves"),
    ).toBe("1");
    expect(saveStatus()).toBe("Save failed");
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
                type: "hero",
                componentRef: stylePatchTarget.filePath,
                props: { heading: "Welcome", items: rows("A", "B") },
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
                  type: "hero",
                  props: { heading: "Welcome", items: rows("C", "A", "B") },
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
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(saveStatus()).toBe("Out of date");

    // The list itself names the unsaved conflict and opens a list-only
    // confirmation. A toolbar action that discards the whole section can
    // also erase unrelated fields the author still has pending.
    // A row selection only exposes the row's own fields. The list controls
    // belong to the section entry, selected through the real Sections panel.
    fireEvent.click(screen.getByTitle("Select hero; drag to reorder"));
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await flushFrames();
    expect(await screen.findByText("Not saved")).toBeTruthy();
    act(() => {
      screen.getByRole("button", { name: /discard unsaved changes to items/i }).click();
    });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Discard changes to .*items/);
    expect(dialog.textContent).toMatch(/only your unsaved changes to this list/);
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
      screen.getByRole("button", {
        name: /discard unsaved changes to items/i,
      }).click();
    });
    act(() => {
      screen.getByRole("button", {
        name: "Discard list changes and load latest",
      }).click();
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
      screen.getByRole("button", {
        name: /discard unsaved changes to items/i,
      }).click();
    });
    act(() => {
      screen.getByRole("button", {
        name: "Discard list changes and load latest",
      }).click();
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
      screen.getByRole("button", {
        name: /discard unsaved changes to items/i,
      }).click();
    });
    act(() => {
      screen.getByRole("button", {
        name: "Discard list changes and load latest",
      }).click();
    });
    await waitFor(() => expect(saveStatus()).not.toBe("Out of date"));
    expect(
      screen.queryByRole("button", {
        name: /discard unsaved changes to items/i,
      }),
    ).toBeNull();
    expect(updateSectionProps).toHaveBeenCalledTimes(sentBeforeDiscard);
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
      nodes: [heroNode],
    });
    const row = await screen.findByText("h1");
    posted.length = 0;
    act(() => {
      row.closest("button")?.click();
    });

    const revision = messagesOfType(
      "morph:storefront-preview-set-selection-mode",
    )[0]!.selectionRevision as number;
    expect(revision).toBeGreaterThan(0);

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

    fromPreview(answer(revision - 1));
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
 * The same shell, with the one theme file the style path reads a source from.
 *
 * `handleUpdateThemeFileStyle` takes the current source out of the workspace
 * snapshot or this query and returns before patching when neither holds it, so
 * a shell rendered without a file cannot reach the code under test at all. The
 * tree is written by hand rather than through `buildFileTree` because it only
 * has to render, and importing the DAL would pull the server layer into jsdom.
 */
function renderShellWithHero(
  content: string,
  selectedSection?: string,
  editorContext = context,
  providedClient?: QueryClient,
) {
  const client = providedClient ?? readyQueryClient();
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    {
      files: [
        {
          id: "file-hero",
          storefrontId: "storefront-1",
          themeId: "theme-1",
          path: stylePatchTarget.filePath,
          content,
          mimeType: "text/typescript",
          isEntry: false,
          version: 1,
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
      tree: [
        {
          name: "src",
          path: "src",
          isDirectory: true,
          children: [
            {
              name: "components",
              path: "src/components",
              isDirectory: true,
              children: [
                {
                  name: "Hero.tsx",
                  path: stylePatchTarget.filePath,
                  isDirectory: false,
                },
              ],
            },
          ],
        },
      ],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  return render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={editorContext}
        search={
          selectedSection
            ? { ...baseSearch, section: selectedSection }
            : baseSearch
        }
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

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
    fromPreview({ type: "morph:storefront-preview-ready" });
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

  it("blocks input without a selection baseline before calling the server", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    await openFields();
    // A newly reported selection cannot capture a version from a workspace
    // that has not accepted one; do not substitute the current Theme version.
    act(() =>
      useThemeWorkspaceStore.getState().setBaseSourceGeneration(0, scope),
    );
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(0);
    await reselect();
    input("Welcome", "No baseline heading");
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(message, {
        id: "selection-source-conflict",
      }),
    );
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("No baseline heading")).toBeTruthy();
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

function applyStylePatch() {
  act(() => {
    screen.getByRole("button", { name: "Apply a style patch" }).click();
  });
}

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

/**
 * Typing over text on the canvas is an edit of the field only when the text
 * was the stored value. A Theme's `content()` may change a value on its way to
 * the page; saving the typed text would store it changed, again on each pass.
 */
describe("an inline edit of text the Theme changed", () => {
  // Answered as the server answers: the document it now holds, one
  // generation past the one the write was sent at.
  const saved = () =>
    updateSectionProps.mockImplementation(async ({ data }) => ({
      success: true,
      data: {
        draftGeneration: data.expectedDraftGeneration + 1,
        droppedProps: [],
        document: {
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              props: { heading: "Welcome", ...data.props },
            },
          ],
        },
      },
    }));

  it("is not saved, and the canvas is left to what the Theme rendered", async () => {
    saved();
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    renderShell();
    await selectHeading();
    posted.length = 0;

    sendInlineCommit("TRANSFORMED:WELCOME!", "TRANSFORMED:WELCOME");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    // The preview already put back what the Theme rendered. Pushing the
    // stored value onto the canvas here would show it without content().
    expect(
      messagesOfType("morph:storefront-preview-update-section-props"),
    ).toEqual([]);
    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_NOT_SAVED_MESSAGE,
      expect.anything(),
    );
    const retained = screen.getByRole("textbox", {
      name: "Copy text that was not saved",
    }) as HTMLTextAreaElement;
    expect(retained.value).toBe("TRANSFORMED:WELCOME!");
    expect(screen.getByText("Not saved — reselect then type.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();

    // Reselecting only restores the normal editor selection; it never submits
    // the preserved text. The author must type it again explicitly.
    await selectHeading();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(retained.value).toBe("TRANSFORMED:WELCOME!");
  });

  it("is saved when the text was the stored value", async () => {
    saved();
    renderShell();

    await commitInlineText("Welcome home", "Welcome");

    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const sent = updateSectionProps.mock.calls[0]![0] as {
      data: { props: Record<string, unknown> };
    };
    expect(sent.data.props).toEqual({ heading: "Welcome home" });
  });

  it("is not saved when another tab changed the field while it was typed", async () => {
    saved();
    vi.spyOn(toast, "info").mockImplementation(() => "");
    const client = readyQueryClient();
    const view = renderShell(client);
    await selectHeading();

    // Another tab's save reaches this editor while the canvas edit is open.
    view.rerender(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={
            editorHolding({ heading: "Theirs" })
              .data as unknown as StorefrontThemeEditorDTO
          }
          search={baseSearch}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    // The edit began from the value this tab saw.
    sendInlineCommit("Welcome, mine", "Welcome");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();

    // The control: an edit begun from the value now stored is saved, so the
    // refusal above was about the moved value and nothing else.
    sendInlineCommit("Theirs, edited", "Theirs");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const sent = updateSectionProps.mock.calls[0]![0] as {
      data: { props: Record<string, unknown> };
    };
    expect(sent.data.props).toEqual({ heading: "Theirs, edited" });
  });

  it("is not saved when another tab's save, at a newer generation, changed the field", async () => {
    saved();
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    const client = readyQueryClient();
    const view = renderShell(client);
    await selectHeading();

    // Another tab's save, read back at the generation it produced.
    view.rerender(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={
            editorHolding({ heading: "Theirs" }, 2)
              .data as unknown as StorefrontThemeEditorDTO
          }
          search={baseSearch}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    sendInlineCommit("Welcome, mine", "Welcome");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_NOT_SAVED_MESSAGE,
      expect.anything(),
    );

    // The control: an edit begun from the newer stored value is saved, on
    // the generation that read brought.
    sendInlineCommit("Theirs, edited", "Theirs");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const sent = updateSectionProps.mock.calls[0]![0] as {
      data: { props: Record<string, unknown>; expectedDraftGeneration: number };
    };
    expect(sent.data.props).toEqual({ heading: "Theirs, edited" });
    expect(sent.data.expectedDraftGeneration).toBe(2);
  });

  it("is not saved when it names a field other than the one selected", async () => {
    saved();
    renderShell();
    await selectHeading();

    // A late commit from an edit of another field.
    sendInlineCommit("Late", "Welcome", {
      fieldKey: "subheading",
      fieldPath: "subheading",
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("holds an obsolete selected field rather than borrowing the newer workspace generation", async () => {
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
      storefrontId: "storefront-1",
      themeId: "theme-1",
    });
    const message =
      "The source code has changed. Select the field again. Your changes are kept.";
    updateSectionProps.mockResolvedValue({
      success: false,
      error: "SELECTION_SOURCE_CONFLICT",
      message,
    } as never);
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    renderShell();
    await selectHeading();
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      }),
    );
    sendInlineCommit("Unsaved from old source", "Welcome");
    // Once the newer source is known, rejection is client-side, not an RPC.
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(message, {
        id: "selection-source-conflict",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(saveStatus()).not.toBe("Saved");
  });

  it("keeps the same selected source precondition for two content-only saves", async () => {
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
      storefrontId: "storefront-1",
      themeId: "theme-1",
    });
    saved();
    renderShell();
    await selectHeading();
    sendInlineCommit("First own save", "Welcome");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    // The second edit begins from the text the first save left on the page.
    sendInlineCommit("Second own save", "First own save");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(
      updateSectionProps.mock.calls.map(
        (call) => call[0].data.expectedSourceGeneration,
      ),
    ).toEqual([1, 1]);
  });

  it("refuses a second edit that claims the text from before the first own save", async () => {
    const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
    saved();
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    renderShell();
    await selectHeading();
    sendInlineCommit("First own save", "Welcome");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const sourceBaseline = () => {
      const state = useThemeWorkspaceStore.getState();
      return {
        accepted: state.getAcceptedSourceGeneration(scope),
        observed: state.getObservedSourceGeneration(scope),
      };
    };
    const before = sourceBaseline();

    // The first save's answer is the stored value now; the editor context
    // has not caught up. A claim of the older text is out of date.
    sendInlineCommit("Second own save", "Welcome");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_NOT_SAVED_MESSAGE,
      expect.anything(),
    );
    expect(sourceBaseline()).toEqual(before);
  });

  it("keeps Inspector text visible after a source baseline refusal without resending", async () => {
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
      storefrontId: "storefront-1",
      themeId: "theme-1",
    });
    const message =
      "The source code has changed. Select the field again. Your changes are kept.";
    updateSectionProps.mockResolvedValue({
      success: false,
      error: "SELECTION_SOURCE_CONFLICT",
      message,
    } as never);
    renderShellWithHero(
      'export const contentFields = { heading: { type: "text", label: "Heading" } }; export function Hero({ heading = "Welcome" }) { return <h1>{heading}</h1>; }',
      "hero",
    );
    await selectHeading();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const input = await screen.findByDisplayValue("Welcome");
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      }),
    );
    fireEvent.input(input, { target: { value: "Unsaved Inspector text" } });
    fireEvent.blur(input);
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    const expectDraftInActivePanel = () => {
      const field = screen.getByDisplayValue("Unsaved Inspector text");
      expect(field.isConnected).toBe(true);
      expect(field.closest("[hidden], [inert]")).toBeNull();
      for (
        let element: Element | null = field;
        element;
        element = element.parentElement
      ) {
        expect(window.getComputedStyle(element).display).not.toBe("none");
      }
    };
    expectDraftInActivePanel();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expectDraftInActivePanel();
  });

  it("is not saved when it comes from a window other than the preview", async () => {
    saved();
    renderShell();
    await selectHeading();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "morph:storefront-preview-commit-inline-text",
            sectionId: "hero",
            fieldKey: "heading",
            fieldPath: "heading",
            value: "Forged",
            originalValue: "Welcome",
            previewSession: PREVIEW_SESSION,
          },
          origin: PREVIEW_ORIGIN,
          source: window,
        }),
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("tells the author where to edit text the preview would not open", async () => {
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    renderShell();
    await selectHeading();

    fromPreview({
      type: "morph:storefront-preview-inline-text-refused",
      sectionId: "hero",
      fieldPath: "heading",
    });

    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_REFUSED_MESSAGE,
      expect.anything(),
    );
  });
});

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
    const { rerender } = render(shell(editorContext));
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

  // (b) A read that does not show the write cannot prove the original request
  // was cancelled. Keep it tracked and do not send the frozen payload again.
  it("keeps a lost answer tracked when read-back does not show the write", async () => {
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
      await pause();
      expect(sent()).toHaveLength(1);
      expect(read.sentWhenRead).toBe(1);
      expect(saveStatus()).toBe("Save failed");
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
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
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });
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
    expect(saveStatus()).toBe("Out of date");
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
    expect(saveStatus()).toBe("Out of date");
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
    expect(saveStatus()).toBe("Out of date");
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
    return {
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
  // Past the content write's 300 ms debounce and its answer.
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

      /**
       * `heading` typed and an entry added inside one debounce: one write,
       * one history entry, whose undo restores `heading` and removes `items`.
       */
      async function mixedWrite() {
        stored = { ...STORED };
        const editor = await openSection({ ...STORED });
        const heading = (await screen.findAllByDisplayValue("Hello"))[0]!;
        const add = await screen.findByRole("button", { name: "Add entry" });
        // Both inside the shell's 300 ms debounce, with nothing awaited
        // between them: one pending entry, so one write.
        fireEvent.input(heading, { target: { value: "New" } });
        fireEvent.blur(heading);
        fireEvent.click(add);
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

        it("keeps tracking when the late original wins the compare-and-swap race", async () => {
          await lostOrdinaryWrite();
          const original = sent()[0]!;
          serverHolds({ ...STORED }, 1);
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
          expect(
            unconfirmedCount(),
            "the original outcome still needs read-back",
          ).toBe("1");
          expect(depth()).toBe("0");

          serverHolds({ heading: "New" }, 2);
          await checkAndSave();

          expect(
            sent(),
            "the late original is never sent a third time",
          ).toHaveLength(2);
          expect(unconfirmedCount()).toBeNull();
          expect(depth(), "the landed edit is recorded once").toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
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
          const { receive } = await storedFieldEdit();
          // Typed, and Undo pressed inside the 300 ms debounce.
          await typeThenUndo("New", "Newer");

          expect(sent(), "the input only, no undo after it").toHaveLength(2);
          expect(sent()[1]!.props).toEqual({ heading: "Newer" });
          expect(sent()[1]).toMatchObject({ expectedDraftGeneration: 2 });
          expect(stored, "the older entry is not undone").toEqual({
            heading: "Newer",
          });
          expect(depth(), "both entries kept").toBe("2");
          expect(historyButtons()).toEqual({ undo: true, redo: false });
          expect(errors(notice)).toContainEqual(
            expect.stringMatching(/^Could not undo/),
          );
          expect(unconfirmedCount()).toBeNull();
          await settle();
          expect(sent(), "nothing sent after it").toHaveLength(2);

          // The input's entry is on top: its undo puts back "New".
          await reread(receive);
          await undo();
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
          await undo();
          expect(sent()).toHaveLength(4);
          expect(sent()[3]!.props).toEqual({ heading: "Hello" });
          expect(stored).toEqual({ heading: "Hello" });
          expect(depth()).toBe("0");
          expect(historyButtons()).toEqual({ undo: false, redo: true });

          // Redo in the same order: the older entry, then the input.
          await reread(receive);
          await redo();
          expect(sent()).toHaveLength(5);
          expect(sent()[4]!.props).toEqual({ heading: "New" });
          expect(depth()).toBe("1");
          expect(historyButtons()).toEqual({ undo: true, redo: true });
          await reread(receive);
          await redo();
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

      it("does not record a generic Content history entry when read-back confirms a reorder", async () => {
        const { one, two } = await dragWithLostAnswer();
        expect(
          screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
        ).toBe(true);
        getThemeEditor.mockResolvedValue(readBack({ items: [two, one] }, 2));

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));

        await waitFor(() =>
          expect(
            screen.queryByRole("button", { name: "Try again" }),
          ).toBeNull(),
        );
        expect(sent()).toHaveLength(1);
        expect(
          screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
        ).toBe(true);
      });
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
    const errors = (notice: ReturnType<typeof notices>) =>
      notice.error.mock.calls.map((call) => String(call[0]));
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
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
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
        expect(saveStatus()).toBe("Out of date");
        expect(screen.getAllByDisplayValue("Mine").length).toBeGreaterThan(0);
        expect(depth(), "history unchanged").toBe("0");
        expect(unconfirmedCount()).toBeNull();
        expect(errors(notice)).toContain(MISSING_BASIS_MESSAGE);
        await settle();
        expect(sent(), "nothing is sent on its own").toHaveLength(0);
      });

      it("focused with no basis, then another tab's change read, then typed: nothing sent, theirs kept, the input kept", async () => {
        const notice = notices();
        readsCarryGeneration = false;
        const { receive } = await openHeading(NO_GENERATION);
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

        expect(sent(), "no request").toHaveLength(0);
        expect(stored).toEqual({ heading: "Theirs" });
        expect(saveStatus()).toBe("Out of date");
        expect(depth()).toBe("0");
        expect(errors(notice)).toContain(MISSING_BASIS_MESSAGE);
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

      it("dragged with no basis, another tab's change on the server: nothing sent, theirs kept, the swap kept as not saved", async () => {
        const notice = notices();
        readsCarryGeneration = false;
        await openTitle({}, 1, NO_GENERATION);
        theyWrite({ items: theirRows() });

        drag(1, 0);
        await settle();

        expect(sent(), "no request").toHaveLength(0);
        expect(stored).toEqual({ items: theirRows() });
        expect(saveStatus()).toBe("Out of date");
        expect(canvasRows(), "the swap stays drawn").toEqual(["Two", "One"]);
        expect(depth(), "history unchanged").toBe("0");
        expect(unconfirmedCount()).toBeNull();
        expect(errors(notice)).toContain(MISSING_BASIS_MESSAGE);
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

      it("pressed with no basis while the field still shows the copy it was focused on, after another tab's change was read: nothing sent, theirs kept, the value kept", async () => {
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
        act(() => field.focus());
        theyWrite({ heading: "Theirs" });
        act(() => {
          receive(editorAt({ ...stored }, draftGeneration));
        });
        await flushFrames();

        await pressReset();

        expect(sent(), "no request").toHaveLength(0);
        expect(stored, "their value kept").toEqual({ heading: "Theirs" });
        expect(depth(), "history unchanged").toBe("0");
        expect(unconfirmedCount()).toBeNull();
        expect(errors(notice)).toContain(MISSING_BASIS_MESSAGE);
        expect(
          screen.getByRole("button", { name: "Use code default" }),
        ).toBeTruthy();
      });

      it("pressed with no basis, another tab's change on the server: nothing sent, theirs kept", async () => {
        const notice = notices();
        stored = { heading: "Hello" };
        readsCarryGeneration = false;
        await openSection({ heading: "Hello" }, NO_GENERATION);
        theyWrite({ heading: "Theirs" });

        await pressReset();

        expect(sent(), "no request").toHaveLength(0);
        expect(stored).toEqual({ heading: "Theirs" });
        expect(depth()).toBe("0");
        expect(errors(notice)).toContain(MISSING_BASIS_MESSAGE);
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
