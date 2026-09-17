import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

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
 * The Inspector panel is replaced with a passthrough; see the mock below for
 * why, and for the browser check that says the reason is jsdom's.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";

const posted: Array<Record<string, unknown>> = [];

/**
 * The Inspector panel is replaced with a passthrough, and it is a jsdom
 * workaround rather than a claim about the panel.
 *
 * With it rendered, a content write that fails sends the shell through React's
 * nested-update limit — "Maximum update depth exceeded" out of Radix's
 * `useComposedRefs` — and React tears the tree down: `[data-editor-save-status]`
 * goes from one element to none, which is why the failure marker could not be
 * asserted at all. The same failure was produced in a real browser against the
 * running editor: the marker stayed, showed "Save failed", and the tree kept its
 * rows. So the cascade is jsdom's, and answering it here hides nothing.
 *
 * The row the tests click lives in the sections panel, which stays rendered, and
 * the marker they assert lives in the shell's own header.
 */
vi.mock("./editor-assistant-panel", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EditorAssistantPanel: () => null,
}));

/**
 * The content write an inline-text commit reaches.
 *
 * Mocked so a failure can be produced on demand. The shape decides which
 * callback runs: a refused write resolves with `success: false` — the OCC
 * conflict case — while a request that never lands rejects and goes to
 * `onError`. Both have to reach the author.
 */
const updateSectionProps = vi.hoisted(() => vi.fn());

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
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
        sections: [{ id: "hero", type: "hero" }],
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
async function commitInlineText(value = "Hello") {
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId: "hero",
    fieldKey: "heading",
    fieldPath: "heading",
    value,
  });
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
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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

    expect(messagesOfType("morph:storefront-preview-set-section")).toContainEqual(
      expect.objectContaining({ sectionId: "hero" }),
    );
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

  it("offers one more send once the attempts are spent", async () => {
    updateSectionProps.mockRejectedValue(new Error("offline"));
    renderShell();
    await commitInlineText();

    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    // Three attempts: the first, and the two the retry allowance spent.
    expect(updateSectionProps).toHaveBeenCalledTimes(3);

    const attempts = updateSectionProps.mock.calls.length;
    updateSectionProps.mockResolvedValue({
      success: true,
      data: { draftGeneration: 8 },
    } as never);
    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });

    await waitFor(() =>
      expect(updateSectionProps.mock.calls.length).toBeGreaterThan(attempts),
    );
    await waitFor(() => expect(saveStatus()).not.toBe("Save failed"));
  });

  it("goes again by itself when the request never lands", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        success: true,
        data: { draftGeneration: 8 },
      } as never);
    renderShell();

    await commitInlineText();

    // The first attempt is refused by the network, not by the server, so the
    // same payload goes again without asking — and the author is told nothing,
    // because there was no decision for them to make.
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(error).not.toHaveBeenCalled();
    await waitFor(() => expect(saveStatus()).not.toBe("Save failed"));
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
      data: { draftGeneration: 8 },
    } as never);
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });

    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    const resend = updateSectionProps.mock.calls[1]![0] as {
      data: { props: Record<string, unknown>; expectedDraftGeneration: number };
    };

    // The author's key wins and the other writer's keys survive, which is the
    // only reason this is safe to send at all.
    expect(resend.data.props).toEqual({ heading: "Mine", cta: "New" });
    // The generation comes from the document as it is now. Reusing this
    // session's observed one would be refused for the same reason.
    expect(resend.data.expectedDraftGeneration).toBe(7);
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

    fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
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
