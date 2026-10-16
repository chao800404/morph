import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { INLINE_TEXT_NOT_SAVED_MESSAGE, VisualEditorShell } from "./visual-editor-shell";

/**
 * Text finished on the canvas right after a write was answered.
 *
 * The shell checks a canvas commit's `originalValue` — the text the page
 * showed when the edit began — against its own copy of the field. A write's
 * answer reaches the accepted snapshot before its pending input is dropped;
 * the editor context only catches up on the next render. Compared with the
 * context alone in between, the page's (new) text met the copy from before
 * the write and a valid edit was refused (main CI run 38733497767).
 *
 * The shell's `context` is a fixed prop here: it stands for a context the
 * editor has not re-rendered yet. Rendering it again with another context is
 * a later read arriving — someone else's change, or an older one, late.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

const posted: Array<Record<string, unknown>> = [];
const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());

vi.mock("@/server/storefront/storefront-themes.serverFn", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateStorefrontThemeSectionProps: updateSectionProps,
  getStorefrontThemeEditor: getThemeEditor,
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

const source = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  subheading: { type: "text", label: "Subheading" }
};
export function Hero({ heading = "Welcome", subheading = "Summary" }) {
  return <section><h1>{heading}</h1><p>{subheading}</p></section>;
}`;

type HeroProps = { heading: string; subheading: string };
const contextAt = (
  props: HeroProps,
  draftGeneration: number | undefined,
): StorefrontThemeEditorDTO =>
  ({
    previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
    storefront: { id: "storefront-1", name: "Store", domain: null, status: "active" },
    theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
    templates: [
      {
        id: "template-1",
        type: "index",
        name: "Home",
        document: {
          version: 1,
          sections: [{ id: "hero", type: "hero", enabled: true, props }],
        },
        ...(draftGeneration === undefined ? {} : { draftGeneration }),
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
        path: "src/components/Hero.tsx",
        content: source,
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-10-15T00:00:00.000Z",
        updatedAt: "2026-10-15T00:00:00.000Z",
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
            children: [{ name: "Hero.tsx", path: "src/components/Hero.tsx", isDirectory: false }],
          },
        ],
      },
    ],
    sourceGeneration: 1,
    latestPublishedRevision: null,
  } as never);
  return queryClient;
};

/** Renders the shell with `context`; returns a way to render it with another. */
function renderEditor(context: StorefrontThemeEditorDTO) {
  const queryClient = client();
  const tree = (ctx: StorefrontThemeEditorDTO) => (
    <QueryClientProvider client={queryClient}>
      <VisualEditorShell context={ctx} search={search} onSearchChange={vi.fn()} />
    </QueryClientProvider>
  );
  const view = render(tree(context));
  return { rerenderWith: (ctx: StorefrontThemeEditorDTO) => view.rerender(tree(ctx)) };
}

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
/** The page reports a selection: the section (null) or its heading. */
async function canvasSelect(field: "heading" | null) {
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
    kind: field ? "heading" : "section",
    nodeId: field ? `hero:node:${field}` : "hero",
    sourceFilePath: "src/components/Hero.tsx",
    sourceLocation: null,
    elementKey: field,
    fieldKey: field,
    field,
    fieldPath: field,
    descendantFields: [],
    tagName: field ? "h1" : "section",
    role: null,
    inputType: null,
    styleRevision: Math.max(
      0,
      ...posted.map((m) => (typeof m.styleRevision === "number" ? m.styleRevision : 0)),
    ),
    className: "",
    isSection: field === null,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
    selectionRevision: revision,
  });
  await settle();
}

/** Selects the section, opens the Inspector's content and saves `value` as the heading. */
async function inspectorSavesHeading(from: string, value: string) {
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
  await canvasSelect(null);
  const contentTab = screen.queryByRole("button", { name: /^Content$/ });
  if (contentTab) fireEvent.click(contentTab);
  await settle();
  const field = screen.getByDisplayValue(from);
  fireEvent.focus(field);
  fireEvent.input(field, { target: { value } });
  fireEvent.blur(field);
  await saveSettles();
}

/** Text finished on the canvas, claiming the page showed `originalValue`. */
async function canvasCommits(value: string, originalValue: string) {
  // The heading selected the way the round-trip tests select it: the page
  // reports its structure and the tree row is clicked.
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
  await settle();
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

const savedHeadings = () =>
  updateSectionProps.mock.calls.map(
    (call) => (call[0] as { data: { props: Record<string, unknown> } }).data.props.heading,
  );
const refusedNotices = () =>
  vi.mocked(toast.info).mock.calls.filter((call) => call[0] === INLINE_TEXT_NOT_SAVED_MESSAGE);

/** The server's copy of the hero, written as the shell writes it. */
let server: { props: HeroProps; generation: number };

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
  server = { props: { heading: "Welcome", subheading: "Summary" }, generation: 1 };
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(async ({ data }: { data: { props: Partial<HeroProps> } }) => {
    server = { props: { ...server.props, ...data.props }, generation: server.generation + 1 };
    return {
      success: true,
      data: {
        draftGeneration: server.generation,
        droppedProps: [],
        document: {
          version: 1,
          sections: [{ id: "hero", type: "hero", enabled: true, props: { ...server.props } }],
        },
      },
    };
  });
  getThemeEditor.mockReset();
  getThemeEditor.mockImplementation(async () => ({
    success: true,
    message: "ok",
    data: contextAt(server.props, server.generation),
  }));
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a canvas commit right after a write was answered, before the context caught up", () => {
  it("P1 an existing document: the text the Inspector just saved is the stored value", async () => {
    renderEditor(contextAt({ heading: "Welcome", subheading: "Summary" }, 1));
    await inspectorSavesHeading("Welcome", "Inspector heading");
    expect(savedHeadings()).toEqual(["Inspector heading"]);

    await canvasCommits("Canvas heading", "Inspector heading");
    expect(refusedNotices()).toEqual([]);
    expect(savedHeadings()).toEqual(["Inspector heading", "Canvas heading"]);
  });

  it("P2 no copy held before the write: its answered document is the stored value", async () => {
    // A context with no draft generation gives the editor no accepted copy,
    // as before the first read of a document this tab has just created.
    renderEditor(contextAt({ heading: "Welcome", subheading: "Summary" }, undefined));
    await inspectorSavesHeading("Welcome", "Inspector heading");
    expect(savedHeadings()).toEqual(["Inspector heading"]);

    await canvasCommits("Canvas heading", "Inspector heading");
    expect(refusedNotices()).toEqual([]);
    expect(savedHeadings()).toEqual(["Inspector heading", "Canvas heading"]);
  });
});

describe("what still refuses", () => {
  it("C1 a newer read brings someone else's change: the page's older text is refused", async () => {
    const { rerenderWith } = renderEditor(contextAt({ heading: "Welcome", subheading: "Summary" }, 1));
    await inspectorSavesHeading("Welcome", "Inspector heading");
    // Another tab saved since: the next read has it, at a newer generation.
    rerenderWith(contextAt({ heading: "Other tab heading", subheading: "Summary" }, 3));
    await settle();

    await canvasCommits("Canvas heading", "Inspector heading");
    expect(refusedNotices()).toHaveLength(1);
    expect(savedHeadings()).toEqual(["Inspector heading"]);
  });

  it("C2 an older read arriving late changes nothing: our text is accepted, the old one refused", async () => {
    const { rerenderWith } = renderEditor(contextAt({ heading: "Welcome", subheading: "Summary" }, 1));
    await inspectorSavesHeading("Welcome", "Inspector heading");
    // A read from before the write lands after its answer.
    rerenderWith(contextAt({ heading: "Welcome", subheading: "Summary" }, 1));
    await settle();

    await canvasCommits("Stale claim", "Welcome");
    expect(refusedNotices()).toHaveLength(1);
    expect(savedHeadings()).toEqual(["Inspector heading"]);

    await canvasCommits("Canvas heading", "Inspector heading");
    expect(refusedNotices()).toHaveLength(1);
    expect(savedHeadings()).toEqual(["Inspector heading", "Canvas heading"]);
  });
});

describe("only an answered write with a valid document makes the first copy", () => {
  const sourceBaseline = () => {
    const state = useThemeWorkspaceStore.getState();
    return {
      accepted: state.getAcceptedSourceGeneration(scope),
      observed: state.getObservedSourceGeneration(scope),
    };
  };

  // R1 and R3 keep their pending input, which the guard reads first, so the
  // absence of a copy is not observable through a canvas commit there; they
  // pin that the source baseline did not move. R2 drops its pending input,
  // so a copy made from its answer would be observable.
  it("R1 a refused write moves no source baseline", async () => {
    updateSectionProps.mockImplementation(async () => ({
      success: false,
      error: "TEMPLATE_DRAFT_CONFLICT",
      message: "This section changed elsewhere since you edited it. Your changes are kept.",
    }));
    renderEditor(contextAt({ heading: "Welcome", subheading: "Summary" }, undefined));
    const before = sourceBaseline();
    await inspectorSavesHeading("Welcome", "Inspector heading");
    expect(savedHeadings()).toEqual(["Inspector heading"]);
    expect(sourceBaseline()).toEqual(before);
  });

  it("R2 an answer without a document makes no copy: the answered text is not taken as stored", async () => {
    updateSectionProps.mockImplementation(async ({ data }: { data: { props: Partial<HeroProps> } }) => {
      server = { props: { ...server.props, ...data.props }, generation: server.generation + 1 };
      return { success: true, data: { draftGeneration: server.generation, droppedProps: [] } };
    });
    renderEditor(contextAt({ heading: "Welcome", subheading: "Summary" }, undefined));
    const before = sourceBaseline();
    await inspectorSavesHeading("Welcome", "Inspector heading");
    expect(savedHeadings()).toEqual(["Inspector heading"]);

    // The pending input is answered and dropped; with no copy made from the
    // answer, the context's copy is all this editor has, and it is older.
    await canvasCommits("Canvas heading", "Inspector heading");
    expect(refusedNotices()).toHaveLength(1);
    expect(savedHeadings()).toEqual(["Inspector heading"]);
    expect(sourceBaseline()).toEqual(before);
  });

  it("R3 an unanswered write moves no source baseline", async () => {
    updateSectionProps.mockImplementation(async () => {
      throw new Error("Failed to fetch");
    });
    renderEditor(contextAt({ heading: "Welcome", subheading: "Summary" }, undefined));
    const before = sourceBaseline();
    await inspectorSavesHeading("Welcome", "Inspector heading");
    expect(savedHeadings()).toEqual(["Inspector heading"]);
    expect(sourceBaseline()).toEqual(before);
  });
});
