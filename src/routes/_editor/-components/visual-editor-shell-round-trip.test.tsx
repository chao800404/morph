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

function renderShell(client = readyQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={baseSearch}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/** A message from the framed preview, addressed so the transport accepts it. */
function fromPreview(data: Record<string, unknown>) {
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
) {
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId: "hero",
    ...field,
    value,
    originalValue,
  });
}

/** The editor's read of the Theme, with the hero holding `props`. */
function editorHolding(props: Record<string, unknown>) {
  return {
    success: true,
    message: "ok",
    data: {
      ...context,
      templates: [
        {
          ...context.templates[0],
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

  it("asks the server before sending again, and sends what did not land once", async () => {
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

    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    // Asked first; the server did not hold the edit, so it went once more.
    expect(getThemeEditor).toHaveBeenCalled();
    expect(getThemeEditor.mock.invocationCallOrder[0]!).toBeLessThan(
      updateSectionProps.mock.invocationCallOrder[1]!,
    );
    await waitFor(() => expect(saveStatus()).not.toBe("Save failed"));
  });

  it("does not send again a write that landed when its answer was lost", async () => {
    updateSectionProps.mockRejectedValue(new Error("offline"));
    // The server made the write; only the answer was lost on the way back.
    getThemeEditor.mockResolvedValue(editorHolding({ heading: "Hello" }));
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
    render(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={listContext}
          search={baseSearch}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
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

    // The way out names the list, and asks before anything is discarded.
    act(() => {
      screen.getByRole("button", { name: "Discard mine…" }).click();
    });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/items in hero/);
    expect(dialog.textContent).toMatch(/cannot be undone/);

    // Declined, nothing changes: the draft is still there to decide about.
    act(() => {
      screen.getByRole("button", { name: "Keep my changes" }).click();
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getByRole("button", { name: "Discard mine…" })).toBeTruthy();

    // Confirmed while the latest version cannot be read: nothing is
    // discarded, since dropping the draft would leave the author with neither.
    getThemeEditor.mockRejectedValueOnce(new Error("offline"));
    act(() => {
      screen.getByRole("button", { name: "Discard mine…" }).click();
    });
    act(() => {
      screen.getByRole("button", { name: "Discard and load latest" }).click();
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
      screen.getByRole("button", { name: "Discard mine…" }).click();
    });
    act(() => {
      screen.getByRole("button", { name: "Discard and load latest" }).click();
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Discard mine…",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
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
    // The newer edit's own save is answered (refused, as the document moved)
    // before the author decides again.
    await waitFor(() =>
      expect(updateSectionProps.mock.calls.length).toBeGreaterThan(1),
    );
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    const sentBeforeDiscard = updateSectionProps.mock.calls.length;

    // Confirmed with the latest version readable and nothing typed meanwhile,
    // the section's draft is dropped and the conflict with it. Nothing is
    // written: the latest version is what the editor now holds.
    getThemeEditor.mockResolvedValue(remote);
    act(() => {
      screen.getByRole("button", { name: "Discard mine…" }).click();
    });
    act(() => {
      screen.getByRole("button", { name: "Discard and load latest" }).click();
    });
    await waitFor(() => expect(saveStatus()).not.toBe("Out of date"));
    expect(screen.queryByRole("button", { name: "Discard mine…" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    // A replay may debounce like ordinary content. It must never borrow gen2.
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
  const saved = () =>
    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 2, droppedProps: [] },
    } as never);

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
    sendInlineCommit("Second own save", "Welcome");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(
      updateSectionProps.mock.calls.map(
        (call) => call[0].data.expectedSourceGeneration,
      ),
    ).toEqual([1, 1]);
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

  /** The canvas's report for one image, from the real preview pass. */
  async function reportImage(fixture: Fixture, imageIndex: number) {
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
      root.querySelectorAll("img")[imageIndex] ?? null,
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

  function renderEditor(fixture: Fixture) {
    const editorContext = {
      ...context,
      templates: [
        {
          ...context.templates[0]!,
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
    render(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={editorContext}
          search={{ ...baseSearch, section: "section" }}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
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
  beforeEach(() => {
    draftGeneration = 1;
    updateSectionProps.mockReset();
    updateSectionProps.mockImplementation(async () => {
      draftGeneration += 1;
      return { success: true, data: { draftGeneration, droppedProps: [] } };
    });
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

    await choose(trigger, "Top");

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

    await choose(trigger, "Top");
    await choose(trigger, "Bottom");

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

  // The row is found again by its id, but the selection's baseline was taken
  // under its old index: the write is held for a fresh selection, as any row
  // field's is (#217), rather than sent to whichever row took that index.
  it("never writes another row when the rows moved after the click", async () => {
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

    await choose(trigger, "Top");

    expect(sent()).toHaveLength(0);
    expect(reselectNotices(toasts)).toBe(1);
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
});
