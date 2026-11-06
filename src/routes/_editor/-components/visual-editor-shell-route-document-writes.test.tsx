import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ComponentProps, useMemo, useState } from "react";
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
import {
  resolveSelectable,
  selectionMetadata,
} from "@/lib/storefront/editor/preview-dom";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { heldContentMessage } from "@/lib/storefront/editor/content-rebase";
import { TEMPLATE_DRAFT_CONFLICT } from "@/lib/storefront/theme-write-errors";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  answerLatestRouteRequest,
  createLiveFrame,
} from "@/lib/test-utils/preview-frame-handshake";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import {
  normalizeEditorTemplateSearch,
  routeTemplatePlaceholderId,
} from "./editor-template";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * Consecutive content writes to a route document this editor creates.
 *
 * Fixture: the editor is on a static route (`/about-us`) that has no document
 * of its own yet, so its section is bound to the route placeholder id
 * (`routeTemplatePlaceholderId`). The first write is queued under the
 * placeholder; its op calls `ensureStorefrontThemeRouteTemplate`, which the
 * in-memory server below answers with a new document at draft generation 1,
 * then invalidates the editor's Theme read. The host component here reads
 * that query as the editor route does, so the refetch (the mocked
 * `getStorefrontThemeEditor`, answering from the same server) hands the shell
 * a context holding the route document, and the page's bindings move to the
 * real id. Edits made after that are queued under the real id: the case of
 * defect C1, where the second write did not wait for the first.
 *
 * The server keeps one document and decides conflicts by draft generation;
 * nothing here borrows a generation. A held write is applied when its answer
 * is released, as a slow server would.
 *
 * See `~/handoff/2026-11-06/route-doc-adoption/`: `fix-plan.md` (and its
 * "User decisions" section), `diagw-a44935f/FINDINGS.md` (C1),
 * `negative-checks-coverage.md` (G1-G3) and `queue-key-map.md`.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const FRAME = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION } as const;
const ROUTE_PATH = "/about-us";
const ROUTE_FILE = "src/routes/about-us.tsx";
const CARD_PATH = "src/components/AboutCard.tsx";
const SLOT = "about-card";
const ROUTE_DOC_ID = "route-doc-about-us";
const PLACEHOLDER = routeTemplatePlaceholderId(ROUTE_PATH);
const DEFAULT_ROWS = [{ title: "One" }, { title: "Two" }];

const posted: Array<Record<string, unknown>> = [];
const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const ensureRouteTemplate = vi.hoisted(() => vi.fn());
const renameSection = vi.hoisted(() => vi.fn());
/** What the last rename asked through the panel came to. */
const renameOutcome = vi.hoisted(
  (): { settled?: { ok: boolean; message?: string } } => ({}),
);

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    getStorefrontThemeEditor: getThemeEditor,
    ensureStorefrontThemeRouteTemplate: ensureRouteTemplate,
    renameStorefrontThemeSection: renameSection,
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
/**
 * The real sections panel, with one button: a section rename, a step that
 * flushes the section's document first (`flushTemplatePendingProps`).
 */
vi.mock("./editor-sections-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-sections-panel")>();
  const RealPanel = actual.EditorSectionsPanel;
  return {
    ...actual,
    EditorSectionsPanel: (props: ComponentProps<typeof RealPanel>) => (
      <>
        <RealPanel {...props} />
        <button
          type="button"
          onClick={() => {
            renameOutcome.settled = undefined;
            if (!props.onRenameSection) {
              renameOutcome.settled = { ok: false, message: "no rename" };
              return;
            }
            void Promise.resolve(props.onRenameSection(SLOT, "Renamed")).then(
              () => {
                renameOutcome.settled = { ok: true };
              },
              (error: unknown) => {
                renameOutcome.settled = {
                  ok: false,
                  message: error instanceof Error ? error.message : String(error),
                };
              },
            );
          }}
        >
          Rename the card
        </button>
      </>
    ),
  };
});

const CARD_SOURCE = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  items: {
    type: "array",
    label: "Entries",
    fields: { title: { type: "text", label: "Title", maxLength: 150 } },
  },
} as const;
export default function AboutCard({
  heading = "Default heading",
  items = ${JSON.stringify(DEFAULT_ROWS)},
}: { heading?: string; items?: { id?: string; title?: string }[] }) {
  return (
    <section>
      <h2>{heading}</h2>
      {items.map((item, index) => <h3 key={item.id ?? index}>{item.title}</h3>)}
    </section>
  );
}`;
const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import AboutCard from "../components/AboutCard";

export const Route = createFileRoute("${ROUTE_PATH}")({ component: AboutUs });

function AboutUs() {
  return (
    <main>
      <AboutCard {...content("${SLOT}")} />
    </main>
  );
}
`;
const INDEX_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({ component: () => <main /> });
`;

const file = (path: string, content: string) => ({
  id: `file-${path}`,
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path,
  content,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
});
const FILES = [
  file(
    "src/morph/content.ts",
    'export { content, morph, isSectionHidden } from "@morph/sdk";\n',
  ),
  file("src/routes/index.tsx", INDEX_SOURCE),
  file(ROUTE_FILE, ROUTE_SOURCE),
  file(CARD_PATH, CARD_SOURCE),
];
const leaf = (path: string) => ({
  name: path.split("/").at(-1)!,
  path,
  isDirectory: false,
});
const TREE = {
  files: FILES,
  tree: [
    {
      name: "src",
      path: "src",
      isDirectory: true,
      children: [
        {
          name: "routes",
          path: "src/routes",
          isDirectory: true,
          children: [leaf("src/routes/index.tsx"), leaf(ROUTE_FILE)],
        },
        {
          name: "components",
          path: "src/components",
          isDirectory: true,
          children: [leaf(CARD_PATH)],
        },
      ],
    },
  ],
  sourceGeneration: 1,
  latestPublishedRevision: null,
};

// ---------------------------------------------------------------------------
// The server: one Theme, whose route document does not exist until ensured.

type RouteDocument = {
  generation: number;
  /** The card's stored props, once a write stored the section. */
  props: Record<string, unknown> | null;
};
let server: { route: RouteDocument | null };

const routeSections = (route: RouteDocument) =>
  route.props === null
    ? []
    : [
        {
          id: SLOT,
          type: "AboutCard",
          enabled: true,
          props: JSON.parse(JSON.stringify(route.props)),
        },
      ];
const routeTemplate = (route: RouteDocument) => ({
  id: ROUTE_DOC_ID,
  type: "page",
  name: "About us",
  routePath: ROUTE_PATH,
  document: { version: 1, sections: routeSections(route) },
  draftRevisionId: null,
  publishedRevisionId: null,
  draftGeneration: route.generation,
  version: 1,
});
function contextOf(): StorefrontThemeEditorDTO {
  return {
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
        document: { version: 1, sections: [] },
        draftGeneration: 1,
        version: 1,
      },
      ...(server.route ? [routeTemplate(server.route)] : []),
    ],
  } as unknown as StorefrontThemeEditorDTO;
}

type WriteRequest = {
  templateId: string;
  sectionId: string;
  props: Record<string, unknown>;
  expectedDraftGeneration: number;
  routePath?: string;
};
const conflictAnswer = () => ({
  success: false,
  error: TEMPLATE_DRAFT_CONFLICT,
  message: "Template draft was modified concurrently.",
});
/** The server's answer to a content write, applied now (OCC by generation). */
function applyWrite(data: WriteRequest) {
  const route = server.route;
  if (!route || data.templateId !== ROUTE_DOC_ID || data.sectionId !== SLOT) {
    return {
      success: false,
      error: "TEMPLATE_NOT_FOUND",
      message: `No document ${data.templateId}`,
    };
  }
  if (data.expectedDraftGeneration !== route.generation) return conflictAnswer();
  route.props = { ...(route.props ?? {}), ...data.props };
  route.generation += 1;
  return savedAnswer(route);
}
const savedAnswer = (route: RouteDocument) => ({
  success: true,
  message: "ok",
  data: {
    draftGeneration: route.generation,
    droppedProps: [],
    document: { version: 1, sections: routeSections(route) },
  },
});

/** One content write whose answer the test gives. */
type HeldWrite = {
  data?: WriteRequest;
  /** Applies the write now and answers it, or answers with `answer` as given. */
  release: (answer?: unknown) => void;
  /** No answer: the request fails as a lost one does. */
  lose: (error?: Error) => void;
};
function holdNextWrite(): HeldWrite {
  const held: HeldWrite = { release: () => {}, lose: () => {} };
  updateSectionProps.mockImplementationOnce(
    ({ data }: { data: WriteRequest }) =>
      new Promise((resolve, reject) => {
        held.data = data;
        held.release = (answer) => resolve(answer ?? applyWrite(data));
        held.lose = (error = new Error("Failed to fetch")) => reject(error);
      }),
  );
  return held;
}

/** Reads of the Theme wait while held; they answer with the state at release. */
let readGate: { promise: Promise<void>; open: () => void } | null = null;
function holdReads() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  readGate = { promise, open };
}
async function releaseReads() {
  const gate = readGate;
  readGate = null;
  await act(async () => {
    gate?.open();
    await settleMicrotasks();
  });
}

const settleMicrotasks = async () => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

// ---------------------------------------------------------------------------
// The editor route, played: the Theme query feeds the shell, as editor.tsx does.

const detailQuery = () =>
  storefrontThemeQueries.detail("storefront-1", "theme-1");
/** What the host last handed the shell. */
const host: {
  search?: StorefrontThemeEditorSearch;
  routeGeneration?: number | null;
} = {};
function Host({ initial }: { initial: StorefrontThemeEditorSearch }) {
  const query = useQuery({ ...detailQuery(), staleTime: Infinity });
  const [search, setSearch] = useState(initial);
  const data = query.data as
    | { success: boolean; data?: StorefrontThemeEditorDTO }
    | undefined;
  const editorContext = data?.success ? data.data : undefined;
  const normalized = useMemo(
    () =>
      editorContext
        ? normalizeEditorTemplateSearch(editorContext, search)
        : search,
    [editorContext, search],
  );
  host.search = normalized;
  host.routeGeneration = editorContext?.templates.find(
    (template) => template.id === ROUTE_DOC_ID,
  )?.draftGeneration;
  if (!editorContext) return null;
  return (
    <VisualEditorShell
      context={editorContext}
      search={normalized}
      onSearchChange={(next) =>
        setSearch((previous) => ({ ...previous, ...next }))
      }
    />
  );
}

const liveFrame = createLiveFrame(FRAME);
let client: QueryClient;
function renderEditor() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    } as never,
  );
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    TREE as never,
  );
  client.setQueryData(detailQuery().queryKey, {
    success: true,
    message: "ok",
    data: contextOf(),
  } as never);
  render(
    <QueryClientProvider client={client}>
      <Host
        initial={
          {
            template: "index",
            routePath: ROUTE_PATH,
            viewport: "desktop",
            section: SLOT,
          } as StorefrontThemeEditorSearch
        }
      />
    </QueryClientProvider>,
  );
}

let lastFrame: Window | null = null;
/**
 * The frame on screen comes up, is sent to the editor's route and says it is
 * there, as a live one does. Once per frame window.
 */
async function frameUp() {
  const frame = document.querySelector("iframe")?.contentWindow ?? null;
  if (!frame || frame === lastFrame) return;
  lastFrame = frame;
  act(() => {
    liveFrame.ready();
  });
  await flushFrames();
  act(() => {
    answerLatestRouteRequest(FRAME);
  });
  dispatchFromFrame({
    type: "morph:storefront-preview-structure",
    nodes: [],
    routePath: ROUTE_PATH,
  });
  await flushFrames();
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
async function fromPreview(data: Record<string, unknown>) {
  await frameUp();
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

/** The canvas's select report for one element of the card, as rendered. */
async function canvasReport(selector: string, index: number) {
  const { html } = await renderLivePreviewRoute({
    files: [
      ...livePreviewPlatformFiles(),
      { path: CARD_PATH, content: CARD_SOURCE },
      { path: ROUTE_FILE, content: ROUTE_SOURCE },
    ],
    routeFile: ROUTE_FILE,
    path: ROUTE_PATH,
  });
  const root = mountLivePreview(html);
  const item = resolveSelectable(root.querySelectorAll(selector)[index] ?? null);
  document.body.replaceChildren();
  if (!item) throw new Error(`canvasReport: nothing selectable at ${selector}`);
  return {
    type: "morph:storefront-preview-select-section",
    sectionId: item.sectionId,
    componentType: item.type,
    sourceLocation: item.element.dataset.morphLoc ?? null,
    nodeId: item.element.getAttribute("data-morph-node") || undefined,
    elementKey: item.elementKey,
    fieldKey: item.fieldKey,
    field:
      item.descendantFields.length > 0 ? null : (item.fieldKey ?? item.elementKey),
    descendantFields: item.descendantFields,
    itemId: item.itemId,
    contentUnavailable: item.contentUnavailable,
    ...selectionMetadata(item),
    styleRevision: 0,
    selectionRevision: 1,
    className: item.element.getAttribute("class") ?? "",
    isSection: item.element === item.section,
    inspectorOverride: item.element.dataset.morphInspector ?? null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
    documentRect: { top: 0, height: 100 },
  };
}

let headingReport: Awaited<ReturnType<typeof canvasReport>>;
let secondRowReport: Awaited<ReturnType<typeof canvasReport>>;

/** Opens the editor on the route and selects `report`'s element in Content. */
async function openOn(report: Record<string, unknown>) {
  renderEditor();
  await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  await flushFrames();
  await select(report);
}

/**
 * The frame reports `report`'s element selected, at the revisions the
 * editor last sent it (a click newer than anything the editor asked for).
 */
async function select(report: Record<string, unknown>) {
  await frameUp();
  const latest = (field: string) =>
    Math.max(
      0,
      ...posted.map((message) =>
        typeof message[field] === "number" ? (message[field] as number) : 0,
      ),
    );
  await fromPreview({
    ...report,
    styleRevision: latest("styleRevision"),
    selectionRevision: latest("selectionRevision") + 1,
  });
  await flushFrames();
  const contentTab = screen.queryByRole("button", { name: /^Content$/ });
  if (contentTab) fireEvent.click(contentTab);
  await flushFrames();
}

/** Types into the first field showing `shown`, and leaves it. */
async function type(shown: string, value: string) {
  const field = (await screen.findAllByDisplayValue(shown))[0]!;
  fireEvent.input(field, { target: { value } });
  fireEvent.blur(field);
}

/** Past the content write's 300 ms debounce and anything it starts. */
const pause = (ms = 1_200) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

const sent = () =>
  updateSectionProps.mock.calls.map((call) => call[0].data as WriteRequest);
const saveStatus = () =>
  document
    .querySelector("[data-editor-save-status]")
    ?.getAttribute("aria-label");

/** The page's own bindings are on the real id: the context holds the document. */
async function expectAdopted() {
  await waitFor(() => expect(host.search?.templateId).toBe(ROUTE_DOC_ID));
}

beforeAll(async () => {
  // Every browser this runs in has CSS.escape; this jsdom does not.
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as { CSS?: unknown }).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    };
  }
  headingReport = await canvasReport("h2", 0);
  secondRowReport = await canvasReport("h3", 1);
});

beforeEach(() => {
  posted.length = 0;
  lastFrame = null;
  readGate = null;
  host.search = undefined;
  renameOutcome.settled = undefined;
  server = { route: null };
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
    storefrontId: "storefront-1",
    themeId: "theme-1",
  });
  useEditorWriteGateStore.setState({ gates: {} });
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(
    async ({ data }: { data: WriteRequest }) => applyWrite(data),
  );
  ensureRouteTemplate.mockReset();
  ensureRouteTemplate.mockImplementation(async () => {
    if (!server.route) server.route = { generation: 1, props: null };
    return {
      success: true,
      message: "Route document ready",
      data: routeTemplate(server.route),
    };
  });
  renameSection.mockReset();
  renameSection.mockImplementation(
    async ({ data }: { data: { expectedDraftGeneration: number } }) => {
      const route = server.route;
      if (!route || data.expectedDraftGeneration !== route.generation) {
        return conflictAnswer();
      }
      route.generation += 1;
      return {
        success: true,
        message: "ok",
        data: { draftGeneration: route.generation },
      };
    },
  );
  getThemeEditor.mockReset();
  getThemeEditor.mockImplementation(async () => {
    if (readGate) await readGate.promise;
    return { success: true, message: "ok", data: contextOf() };
  });
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
});

afterEach(() => {
  vi.useRealTimers();
  readGate?.open();
  cleanup();
  vi.restoreAllMocks();
});

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

// ---------------------------------------------------------------------------
// Helpers for the second edit.

/**
 * The card's Content inputs, in order: heading, row 0 title, row 1 title.
 *
 * Found by position, not by the value shown: once the bindings move to the
 * real id the Inspector shows the code default again rather than the value
 * just saved (stale-field-display.md, Q3, a separate PR). The author types
 * into that field either way, and what is sent is what they typed.
 */
const cardFields = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    ),
  ).filter((element) => !element.getAttribute("aria-label"));
function typeInCard(index: number, value: string) {
  const field = cardFields()[index];
  if (!field) throw new Error(`typeInCard: no card field ${index}`);
  fireEvent.input(field, { target: { value } });
  fireEvent.blur(field);
}

/** Holds the content debounce, so an edit waits before it leaves. */
const holdDebounce = () =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
/** Lets the held debounce run out, back on real timers, then settles. */
async function releaseDebounce() {
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
  } finally {
    vi.useRealTimers();
  }
  await pause();
}

/**
 * Someone else writes the route document; the editor then reads it (its
 * Theme query refetches, as on any invalidation). Works with the debounce
 * held: only short timers are run, never the 300 ms one.
 */
async function outsideWriteRead(change: (route: RouteDocument) => void) {
  const route = server.route!;
  change(route);
  const target = route.generation;
  const faked = vi.isFakeTimers();
  void client.invalidateQueries({ queryKey: detailQuery().queryKey });
  for (let step = 0; step < 15 && host.routeGeneration !== target; step += 1) {
    await act(async () => {
      if (faked) await vi.advanceTimersByTimeAsync(10);
      else await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  expect(host.routeGeneration).toBe(target);
  await act(async () => {
    await settleMicrotasks();
  });
}

const storedHeading = () => server.route?.props?.heading;
const rowsOf = (write: WriteRequest) =>
  ((write.props.items as Array<Record<string, unknown>> | undefined) ?? []).map(
    (row) => [row.id, row.title],
  );

// ---------------------------------------------------------------------------

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
    await expectAdopted();

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
});

describe("G1: someone else's change to the new document", () => {
  async function firstWriteLanded() {
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route!.generation).toBe(2);
    await expectAdopted();
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
    await expectAdopted();
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
    await expectAdopted();
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
      (server.route!.props!.items as Array<{ id: string }>).map((row) => row.id),
    ).toEqual([one!.id, two!.id]);
    await expectAdopted();
    return { one: one!, two: two! };
  }

  it("refuses an edit to row b when the rows are read back reordered before it leaves", async () => {
    await firstRowWriteLanded();
    holdDebounce();
    typeInCard(2, "Two again");
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
    typeInCard(2, "Two again");
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
  it("sends content still keyed by the placeholder before the step, and the step goes on", async () => {
    await openOn(headingReport);
    holdReads();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    // Typed while the page is still on the placeholder: kept under it. Its
    // debounce never runs here; only the flush can send it.
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
    holdDebounce();
    typeInCard(0, "Value 2");
    vi.useRealTimers();
    await releaseReads();
    await expectAdopted();

    fireEvent.click(screen.getByRole("button", { name: "Rename the card" }));
    await pause(300);
    // The flush waits on the first write, queued under the placeholder.
    expect(sent()).toHaveLength(1);
    expect(renameSection).not.toHaveBeenCalled();
    await act(async () => {
      first.release();
    });
    await waitFor(() => expect(renameOutcome.settled).toBeDefined());

    expect(renameOutcome.settled).toEqual({ ok: true });
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(renameSection).toHaveBeenCalledTimes(1);
    expect(renameSection.mock.calls[0]![0].data).toMatchObject({
      templateId: ROUTE_DOC_ID,
      sectionId: SLOT,
      expectedDraftGeneration: 3,
    });
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
