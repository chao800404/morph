import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import {
  answerLatestRouteRequest,
  createLiveFrame,
  sendFrameReady,
} from "@/lib/test-utils/preview-frame-handshake";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { INLINE_TEXT_NOT_SAVED_MESSAGE, VisualEditorShell } from "./visual-editor-shell";

/**
 * A text promotion's answer and the editor's accepted copy.
 *
 * Promoting text writes the document (the new field holds the text) and
 * returns it with its draft generation, as a content write does. It used to
 * reach only the preview: the content snapshot stayed at the copy from
 * before, so until the refetch reached the editor context, the newest-copy
 * decision (`newestAcceptedCopy`) found the promoted value in neither copy —
 * a canvas edit of the promoted text was refused as not the stored value.
 *
 * The answer is now taken by the rule a content write's answer is
 * (`acceptAnsweredWrite`): only as the direct successor of the copy it was
 * sent on. The shell's `context` is a fixed prop, standing for a context
 * the editor has not re-rendered yet.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
const HERO_PATH = "src/components/Hero.tsx";

const posted: Array<Record<string, unknown>> = [];
const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const promoteText = vi.hoisted(() => vi.fn());

vi.mock("@/server/storefront/storefront-themes.serverFn", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateStorefrontThemeSectionProps: updateSectionProps,
  getStorefrontThemeEditor: getThemeEditor,
  promoteStorefrontThemeText: promoteText,
}));
vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn((_target: unknown, message: Record<string, unknown>) => {
    posted.push(message);
  }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({ to, children, ...rest }: { to?: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
/** The real panel, with the promotion request the round-trip tests also use. */
vi.mock("./editor-assistant-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor-assistant-panel")>();
  const RealPanel = actual.EditorAssistantPanel;
  return {
    ...actual,
    EditorAssistantPanel: (props: ComponentProps<typeof RealPanel>) => (
      <>
        <RealPanel {...props} />
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

// The heading is a literal until it is promoted; the subheading is a field.
const source = `export const contentFields = {
  subheading: { type: "text", label: "Subheading" }
};
export function Hero({ subheading = "Summary" }) {
  return <section><h1 data-morph-node="heading">Welcome</h1><p>{subheading}</p></section>;
}`;

type HeroProps = Record<string, string>;
const heroDocument = (props: HeroProps) => ({
  version: 1,
  sections: [{ id: "hero", type: "hero", enabled: true, props: { ...props } }],
});
const contextAt = (props: HeroProps, draftGeneration: number): StorefrontThemeEditorDTO =>
  ({
    previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
    storefront: { id: "storefront-1", name: "Store", domain: null, status: "active" },
    theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
    templates: [
      {
        id: "template-1",
        type: "index",
        name: "Home",
        document: heroDocument(props),
        draftGeneration,
        version: 1,
      },
    ],
  }) as unknown as StorefrontThemeEditorDTO;

const search = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
  section: "hero",
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
    fieldKey: "heading",
    fieldPath: "heading",
    isSection: false,
  },
};

const client = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey, {
    success: true,
    message: "Live Preview server ready",
    data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
  } as never);
  queryClient.setQueryData(storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey, {
    files: [
      {
        id: "file-hero",
        storefrontId: "storefront-1",
        themeId: "theme-1",
        path: HERO_PATH,
        content: source,
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-10-17T00:00:00.000Z",
        updatedAt: "2026-10-17T00:00:00.000Z",
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
            children: [{ name: "Hero.tsx", path: HERO_PATH, isDirectory: false }],
          },
        ],
      },
    ],
    sourceGeneration: 1,
    latestPublishedRevision: null,
  } as never);
  return queryClient;
};

function renderEditor(context: StorefrontThemeEditorDTO) {
  render(
    <QueryClientProvider client={client()}>
      <VisualEditorShell context={context} search={search} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

function dispatchFromFrame(data: Record<string, unknown>) {
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

/**
 * The frame comes up as a live one does before it sends anything else: it
 * says it is ready, reports its structure naming the page it is on, and
 * answers the route request that ready brought, with the request's own id
 * (`preview-frame-handshake.ts`). Since #270 the editor takes a selection or
 * a canvas commit only from a frame that has named the editor's page in this
 * ready round; these tests are about what a promotion's answer does once it
 * does.
 */
const FRAME = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION } as const;
const liveFrame = createLiveFrame(FRAME);
const framesUp = new WeakSet<Window>();
function bringFrameUp() {
  const frame = document.querySelector("iframe")?.contentWindow;
  if (!frame || framesUp.has(frame)) return;
  framesUp.add(frame);
  sendFrameReady(FRAME);
  liveFrame.up();
  answerLatestRouteRequest(FRAME);
}

function fromPreview(data: Record<string, unknown>) {
  bringFrameUp();
  dispatchFromFrame(data);
}

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
const saveSettles = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await settle();
};

let canvasRevision = 0;
async function canvasSelectSection() {
  // Up before the report is built: a live frame stamps it with the revisions
  // the editor has told it, its ready's file sync included.
  bringFrameUp();
  const revision =
    Math.max(
      canvasRevision,
      ...posted.map((m) => (typeof m.selectionRevision === "number" ? m.selectionRevision : 0)),
    ) + 1;
  canvasRevision = revision;
  fromPreview({
    type: "morph:storefront-preview-select-section",
    sectionId: "hero",
    componentType: "hero",
    kind: "section",
    nodeId: "hero",
    sourceFilePath: HERO_PATH,
    sourceLocation: null,
    elementKey: null,
    fieldKey: null,
    field: null,
    fieldPath: null,
    descendantFields: [],
    tagName: "section",
    role: null,
    inputType: null,
    styleRevision: Math.max(
      0,
      ...posted.map((m) => (typeof m.styleRevision === "number" ? m.styleRevision : 0)),
    ),
    className: "",
    isSection: true,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
    selectionRevision: revision,
  });
  await settle();
}

async function inspectorSavesSubheading(from: string, value: string) {
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
  await canvasSelectSection();
  const contentTab = screen.queryByRole("button", { name: /^Content$/ });
  if (contentTab) fireEvent.click(contentTab);
  await settle();
  const field = screen.getByDisplayValue(from);
  fireEvent.focus(field);
  fireEvent.input(field, { target: { value } });
  fireEvent.blur(field);
  await saveSettles();
}

async function selectHeading() {
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
  await settle();
}

async function promoteHeading() {
  await selectHeading();
  fireEvent.click(screen.getByRole("button", { name: "Promote the selected text" }));
  await waitFor(() => expect(promoteText).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope)).toBe(2),
  );
  await settle();
}

async function canvasCommitsHeading(value: string, originalValue: string) {
  await selectHeading();
  fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: true });
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId: "hero",
    fieldKey: "heading",
    fieldPath: "heading",
    value,
    originalValue,
  });
  fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
  await saveSettles();
}

const headingWrites = () =>
  updateSectionProps.mock.calls
    .map((call) => (call[0] as { data: { props: HeroProps; expectedDraftGeneration: number } }).data)
    .filter((data) => "heading" in data.props);
const refusedNotices = () =>
  vi.mocked(toast.info).mock.calls.filter((call) => call[0] === INLINE_TEXT_NOT_SAVED_MESSAGE);

/** The server's copy of the hero. */
let server: { props: HeroProps; generation: number };

function promoteAnswers() {
  promoteText.mockImplementation(async ({ data }: { data: { expectedDraftGeneration: number } }) => {
    server = {
      props: { ...server.props, heading: "Welcome" },
      generation: data.expectedDraftGeneration + 1,
    };
    return {
      success: true,
      data: {
        fieldName: "heading",
        sourceGeneration: 2,
        draftGeneration: server.generation,
        file: { path: HERO_PATH, content: source, version: 2, updatedAt: "2026-10-17T00:00:01.000Z" },
        document: heroDocument(server.props),
      },
    };
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  posted.length = 0;
  canvasRevision = 0;
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
  server = { props: { subheading: "Summary" }, generation: 1 };
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(async ({ data }: { data: { props: HeroProps } }) => {
    server = { props: { ...server.props, ...data.props }, generation: server.generation + 1 };
    return {
      success: true,
      data: { draftGeneration: server.generation, droppedProps: [], document: heroDocument(server.props) },
    };
  });
  getThemeEditor.mockReset();
  getThemeEditor.mockImplementation(async () => ({
    success: true,
    message: "ok",
    data: contextAt(server.props, server.generation),
  }));
  promoteText.mockReset();
  promoteAnswers();
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a promotion's answer, before the context caught up", () => {
  it("is the stored copy: the promoted text edited on the canvas is saved on the promoted document", async () => {
    renderEditor(contextAt({ subheading: "Summary" }, 1));
    await promoteHeading();
    expect(promoteText.mock.calls[0]![0].data.expectedDraftGeneration).toBe(1);

    await canvasCommitsHeading("Canvas heading", "Welcome");
    expect(refusedNotices()).toEqual([]);
    // Written at the promotion's generation, on the document it returned.
    expect(headingWrites()).toEqual([
      expect.objectContaining({ props: expect.objectContaining({ heading: "Canvas heading" }), expectedDraftGeneration: 2 }),
    ]);
    expect(server).toEqual({ props: { subheading: "Summary", heading: "Canvas heading" }, generation: 3 });
  });
});

describe("a promotion's answer that is not the successor of the copy held", () => {
  it("changes nothing: the next read brings the document, and until then the text is not taken as stored", async () => {
    // A write answered with its generation but without its document moves
    // the observed generation and leaves the copy where it was (the R2 case
    // in visual-editor-shell-inline-guard-accepted-copy.test.tsx).
    updateSectionProps.mockImplementation(async ({ data }: { data: { props: HeroProps } }) => {
      server = { props: { ...server.props, ...data.props }, generation: server.generation + 1 };
      return { success: true, data: { draftGeneration: server.generation, droppedProps: [] } };
    });
    renderEditor(contextAt({ subheading: "Summary" }, 1));
    await inspectorSavesSubheading("Summary", "Inspector subheading");
    await promoteHeading();
    // Sent at 2, the generation the first write reported; the copy is at 1.
    expect(promoteText.mock.calls[0]![0].data.expectedDraftGeneration).toBe(2);

    await canvasCommitsHeading("Canvas heading", "Welcome");
    expect(refusedNotices()).toHaveLength(1);
    expect(headingWrites()).toEqual([]);
  });
});
