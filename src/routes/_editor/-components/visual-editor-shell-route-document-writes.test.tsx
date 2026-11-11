import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
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
import { MISSING_BASIS_MESSAGE } from "@/lib/storefront/editor/pending-content-write";
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
import { UNCONFIRMED_SAVE_HOLD } from "./editor-unconfirmed-saves-notice";
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
// The other steps that flush first: publish, build, promote.
const publishTemplate = vi.hoisted(() => vi.fn());
const prepareInitialDraft = vi.hoisted(() => vi.fn());
const promoteText = vi.hoisted(() => vi.fn());
const createPreviewBuild = vi.hoisted(() => vi.fn());
const checkPublishMedia = vi.hoisted(() => vi.fn());
/** What the last promotion asked through the assistant panel came to. */
const promoteOutcome = vi.hoisted((): { settled?: unknown } => ({}));

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    getStorefrontThemeEditor: getThemeEditor,
    ensureStorefrontThemeRouteTemplate: ensureRouteTemplate,
    renameStorefrontThemeSection: renameSection,
    publishStorefrontThemeTemplate: publishTemplate,
    prepareInitialStorefrontThemeTemplateDraft: prepareInitialDraft,
    promoteStorefrontThemeText: promoteText,
  }),
);
vi.mock(
  "@/server/storefront/storefront-theme-builds.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    createPreviewBuild,
  }),
);
vi.mock(
  "@/server/storefront/storefront-publish-check.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    checkStorefrontPublishMedia: checkPublishMedia,
  }),
);
/**
 * The real assistant panel, with one button: a text promotion of the card's
 * heading, a step that flushes the section's document first.
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
          onClick={() => {
            promoteOutcome.settled = undefined;
            if (!props.onPromoteText) {
              promoteOutcome.settled = { status: "no promote" };
              return;
            }
            void Promise.resolve(
              props.onPromoteText({
                sectionId: "about-card",
                componentSourcePath: "src/components/AboutCard.tsx",
                targetKey: "heading",
                fieldName: "heading",
                value: "Default heading",
              }),
            ).then(
              (outcome) => {
                promoteOutcome.settled = outcome;
              },
              (error: unknown) => {
                promoteOutcome.settled = {
                  status: "threw",
                  message:
                    error instanceof Error ? error.message : String(error),
                };
              },
            );
          }}
        >
          Promote the card text
        </button>
      </>
    ),
  };
});
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
                  message:
                    error instanceof Error ? error.message : String(error),
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
  expectedSourceGeneration?: number;
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
  if (data.expectedDraftGeneration !== route.generation)
    return conflictAnswer();
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
  /** Moves the editor's address, as a link or the page picker would. */
  go?: (next: Partial<StorefrontThemeEditorSearch>) => void;
} = {};
function Host({ initial }: { initial: StorefrontThemeEditorSearch }) {
  const query = useQuery({ ...detailQuery(), staleTime: Infinity });
  const [search, setSearch] = useState(initial);
  host.go = (next) => setSearch((previous) => ({ ...previous, ...next }));
  const data = query.data as
    { success: boolean; data?: StorefrontThemeEditorDTO } | undefined;
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
  const item = resolveSelectable(
    root.querySelectorAll(selector)[index] ?? null,
  );
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
      item.descendantFields.length > 0
        ? null
        : (item.fieldKey ?? item.elementKey),
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

/**
 * A read of the Theme arrives while a write is still out. The editor's own
 * read after creating the route document waits for that write to be over;
 * any other read (another refetch, a window coming back) does not, and the
 * page then takes up the document while the write is unanswered.
 */
async function readWhileOut() {
  await act(async () => {
    await client.invalidateQueries({ queryKey: detailQuery().queryKey });
  });
}

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
    // As the DAL answers: created by this call only on the insert.
    const createdByThisCall = !server.route;
    if (!server.route) server.route = { generation: 1, props: null };
    return {
      success: true,
      message: "Route document ready",
      data: { ...routeTemplate(server.route), createdByThisCall },
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
  // Steps past the flush. Any call is what the entry tests count; the answer
  // is a refusal so nothing past it runs on.
  const notExpected = async () => ({
    success: false,
    error: "NOT_EXPECTED",
    message: "Not expected in this test.",
  });
  promoteOutcome.settled = undefined;
  for (const step of [
    publishTemplate,
    prepareInitialDraft,
    promoteText,
    createPreviewBuild,
  ]) {
    step.mockReset();
    step.mockImplementation(notExpected);
  }
  checkPublishMedia.mockReset();
  checkPublishMedia.mockImplementation(async () => ({
    success: true,
    message: "ok",
    data: { brokenImages: [] },
  }));
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

/**
 * Stage 1 of "refuse an existing-Document content write that has no version
 * basis": input made while the route had no document carries no basis, and
 * goes with none only onto a document this editor confirmed creating (the
 * ensure's `createdByThisCall`), at generation 1. A generation-1 document
 * that already existed is not one: generation 1 alone proves nothing.
 */
describe("the route-document exception to the version basis", () => {
  it("control: the document this editor's ensure created takes the first write once, at generation 1", async () => {
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 1" },
    });
    expect(server.route).toMatchObject({
      generation: 2,
      props: { heading: "Value 1" },
    });
  });

  it("an existing generation-1 document the ensure found (not created by it): no write, the input kept as not saved", async () => {
    await openOn(headingReport);
    // Another editor created the route's document after this one opened.
    server.route = { generation: 1, props: null };
    await type("Default heading", "Value 1");
    await pause(1_500);

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps, "no content write").not.toHaveBeenCalled();
    expect(server.route, "their document unchanged").toEqual({
      generation: 1,
      props: null,
    });
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getAllByDisplayValue("Value 1").length).toBeGreaterThan(0);
    expect(
      vi.mocked(toast.error).mock.calls.map((call) => String(call[0])),
    ).toContain(MISSING_BASIS_MESSAGE);
    // Nothing goes on its own afterwards either.
    await pause(1_500);
    expect(updateSectionProps).not.toHaveBeenCalled();
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

const liveTyped = (value: string) =>
  posted.filter(
    (message) =>
      message.type === "morph:storefront-preview-update-selection-field" &&
      message.value === value,
  );

describe("the selection when the page takes up the route document it created", () => {
  it("stays: typing on, with nothing selected again, reaches the canvas and the new document", async () => {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(liveTyped("Value 1")).toHaveLength(1);
    await readWhileOut();
    await expectAdopted();

    // No click, no Inspector reopened: the author goes on typing.
    typeInCard(0, "Value 2");
    expect(liveTyped("Value 2")).toHaveLength(1);
    expect(liveTyped("Value 2")[0]).toMatchObject({ sectionId: SLOT });

    await act(async () => {
      first.release();
    });
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      sectionId: SLOT,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
  });

  it("is let go on a real change of page, after the route document was taken up", async () => {
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    await expectAdopted();
    expect(cardFields().length).toBeGreaterThan(0);

    // Another page: the selection and the Inspector it fed are let go.
    act(() => {
      host.go!({ routePath: "/", templateId: undefined });
    });
    await waitFor(() => expect(cardFields()).toHaveLength(0));
    expect(liveTyped("Value 2")).toHaveLength(0);
  });
});

/** The route requests the editor posted to the frame, in order. */
const routeRequests = () =>
  posted.filter(
    (message) => message.type === "morph:storefront-preview-set-route",
  );

describe("the frame's route when the page takes up the route document it created", () => {
  it("is not sent again when the editor takes up the document its own first write created", async () => {
    await openOn(headingReport);
    // On the route with the borrowed shared document, the frame told once.
    expect(host.search?.templateId).toBe("template-1");
    const before = routeRequests().length;
    expect(before).toBeGreaterThan(0);
    expect(routeRequests().at(-1)).toMatchObject({
      templateId: "template-1",
      routePath: ROUTE_PATH,
    });

    // The first write creates the route document, is answered, and the
    // editor's own read after it moves the page onto the new id.
    await type("Default heading", "Value 1");
    await pause();
    await expectAdopted();
    await flushFrames();
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");

    // Same page: the frame is asked for nothing, so one that moved away by
    // itself meanwhile is not taken back.
    expect(routeRequests()).toHaveLength(before);
  });

  it("control: is sent again when the route's document changes to one this editor did not create", async () => {
    await openOn(headingReport);
    expect(host.search?.templateId).toBe("template-1");
    const before = routeRequests().length;
    expect(before).toBeGreaterThan(0);

    // Another tab created the route document; this editor only reads it.
    server.route = { generation: 1, props: null };
    await readWhileOut();
    await expectAdopted();
    await flushFrames();
    expect(ensureRouteTemplate).not.toHaveBeenCalled();

    await waitFor(() => expect(routeRequests().length).toBeGreaterThan(before));
    expect(routeRequests().at(-1)).toMatchObject({
      templateId: ROUTE_DOC_ID,
      routePath: ROUTE_PATH,
    });
  });
});

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
    await readWhileOut();
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
    await readWhileOut();
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
    await readWhileOut();
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

  it("G2c: the first write onto the created document, with no answer and not landed, is resent at the generation it was sent at", async () => {
    // H2 at shell level: the write composed with no copy held is sent at the
    // generation the queue resolved for the created document. That sent
    // generation, frozen with it, is what Try again sends again.
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await act(async () => {
      first.lose();
    });
    await pause();
    expect(saveStatus()).toBe("Save failed");
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 1" },
    });
    // Not landed: the created document is still as created.
    expect(server.route).toEqual({ generation: 1, props: null });

    const readsBefore = getThemeEditor.mock.calls.length;
    pressTryAgain();
    await waitFor(() =>
      expect(getThemeEditor.mock.calls.length).toBeGreaterThan(readsBefore),
    );
    await pause();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: sent()[0]!.expectedDraftGeneration,
      expectedSourceGeneration: sent()[0]!.expectedSourceGeneration,
      props: { heading: "Value 1" },
    });
    expect(storedHeading()).toBe("Value 1");
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
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
  /**
   * Row b's title. Taking up the route document keeps the row element
   * selected, so the Inspector still shows the rows' titles, row b's as
   * saved.
   */
  function typeInSelectedRow(value: string) {
    expect(cardFields().map((field) => field.value)).toEqual([
      "One",
      "Two edited",
    ]);
    typeInCard(1, value);
  }

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
      (server.route!.props!.items as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    ).toEqual([one!.id, two!.id]);
    await expectAdopted();
    return { one: one!, two: two! };
  }

  it("refuses an edit to row b when the rows are read back reordered before it leaves", async () => {
    await firstRowWriteLanded();
    holdDebounce();
    typeInSelectedRow("Two again");
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
    typeInSelectedRow("Two again");
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
    // A read arrives while the first write is out (see `readWhileOut`).
    act(() => {
      void client.invalidateQueries({ queryKey: detailQuery().queryKey });
    });
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

// ---------------------------------------------------------------------------
// Held content under every id, recovery, and the steps that flush first.

const CONFLICT_HELD = heldContentMessage({ hasListConflict: false });
const FAILED_HELD = "Content changed while saving. Retry before continuing.";
const COMPOSE_REFUSED =
  "This section changed elsewhere since you edited it. Your changes are kept.";

/** Every request the server was asked for, by kind. */
const calls = () => ({
  props: updateSectionProps.mock.calls.length,
  ensure: ensureRouteTemplate.mock.calls.length,
  rename: renameSection.mock.calls.length,
  publish: publishTemplate.mock.calls.length,
  prepare: prepareInitialDraft.mock.calls.length,
  build: createPreviewBuild.mock.calls.length,
  promote: promoteText.mock.calls.length,
});

/** Presses the panel's rename and waits for what it came to. */
async function rename() {
  fireEvent.click(screen.getByRole("button", { name: "Rename the card" }));
  await waitFor(() => expect(renameOutcome.settled).toBeDefined());
  await pause(300);
  return renameOutcome.settled!;
}

/** The next write is refused (someone wrote first, +2) or fails. */
function answerNextWrite(answer: "conflict" | "failure") {
  updateSectionProps.mockImplementationOnce(
    async ({ data }: { data: WriteRequest }) => {
      if (answer === "failure") {
        return {
          success: false,
          error: "SECTION_WRITE_FAILED",
          message: "Could not save the section.",
        };
      }
      const route = server.route!;
      route.props = { ...(route.props ?? {}), heading: "Theirs" };
      route.generation += 2;
      return applyWrite(data);
    },
  );
}

/** The server creates the route document; the answer to ensure is lost. */
function loseNextEnsureAnswer() {
  ensureRouteTemplate.mockImplementationOnce(async () => {
    if (!server.route) server.route = { generation: 1, props: null };
    throw new Error("Failed to fetch");
  });
}

/** Releases held reads and waits until the shell's context is at `target`. */
async function releaseReadsUntil(target: number) {
  const gate = readGate;
  readGate = null;
  gate?.open();
  const faked = vi.isFakeTimers();
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

function pressKeepMine() {
  act(() => {
    screen.getByRole("button", { name: "Load latest, keep mine" }).click();
  });
}
function pressTryAgain() {
  act(() => {
    screen.getByRole("button", { name: "Try again" }).click();
  });
}

/** The first write lands (generation 2) and the page is on the real id. */
async function firstWriteLanded() {
  await openOn(headingReport);
  await type("Default heading", "Value 1");
  await pause();
  expect(sent()).toHaveLength(1);
  expect(server.route!.generation).toBe(2);
  await expectAdopted();
}

/**
 * Content keyed by the real id is refused: the second edit, after an outside
 * change to generation 4 ("Theirs") was read before it left.
 */
async function realKeyedRefused() {
  await firstWriteLanded();
  holdDebounce();
  typeInCard(0, "Value 2");
  await outsideWriteRead((route) => {
    route.props = { ...route.props, heading: "Theirs" };
    route.generation = 4;
  });
  await releaseDebounce();
  expect(sent()).toHaveLength(1);
  expect(saveStatus()).toBe("Out of date");
  expect(storedHeading()).toBe("Theirs");
}

describe("A: the pre-step flush holds refused and failed content under every id", () => {
  describe("the step asks by the real id (the page is on the real document)", () => {
    it("refused, placeholder-keyed: nothing is sent, the step stops; Keep mine sends once, then the step runs", async () => {
      answerNextWrite("conflict");
      await openOn(headingReport);
      await type("Default heading", "Value 1");
      await pause();
      await expectAdopted();
      expect(saveStatus()).toBe("Out of date");
      expect(storedHeading()).toBe("Theirs");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: CONFLICT_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Theirs");
      expect(server.route!.generation).toBe(3);

      pressKeepMine();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
        props: { heading: "Value 1" },
      });
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
      expect(storedHeading()).toBe("Value 1");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 4,
      });
      expect(sent()).toHaveLength(2);
    });

    it("refused, real-keyed: nothing is sent, the step stops; Keep mine sends once, then the step runs", async () => {
      await realKeyedRefused();
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: CONFLICT_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Theirs");
      expect(screen.getAllByDisplayValue("Value 2").length).toBeGreaterThan(0);

      pressKeepMine();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 4,
        props: { heading: "Value 2" },
      });
      expect(storedHeading()).toBe("Value 2");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 5,
      });
    });

    it("failed, placeholder-keyed: nothing is sent, the step stops; Try again sends once, then the step runs", async () => {
      answerNextWrite("failure");
      await openOn(headingReport);
      await type("Default heading", "Value 1");
      await pause();
      await expectAdopted();
      expect(saveStatus()).toBe("Save failed");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: FAILED_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(server.route).toEqual({ generation: 1, props: null });

      pressTryAgain();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 1,
        props: { heading: "Value 1" },
      });
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
      expect(storedHeading()).toBe("Value 1");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
      });
    });

    it("failed, real-keyed: nothing is sent, the step stops; Try again sends once, then the step runs", async () => {
      await firstWriteLanded();
      answerNextWrite("failure");
      typeInCard(0, "Value 2");
      await pause();
      expect(sent()).toHaveLength(2);
      expect(saveStatus()).toBe("Save failed");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: FAILED_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Value 1");
      expect(screen.getAllByDisplayValue("Value 2").length).toBeGreaterThan(0);

      pressTryAgain();
      await waitFor(() => expect(sent()).toHaveLength(3));
      await pause();
      expect(sent()).toHaveLength(3);
      expect(sent()[2]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
        props: { heading: "Value 2" },
      });
      expect(storedHeading()).toBe("Value 2");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
      });
    });

    it("failed with no answer, real-keyed: a not-landed write is resent once before the step proceeds", async () => {
      await firstWriteLanded();
      const second = holdNextWrite();
      typeInCard(0, "Value 2");
      await waitFor(() => expect(sent()).toHaveLength(2));
      await act(async () => {
        second.lose();
      });
      await pause();
      expect(saveStatus()).toBe("Save failed");
      const before = calls();

      expect(await rename()).toEqual({
        ok: false,
        message: UNCONFIRMED_SAVE_HOLD,
      });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Value 1");

      const readsBefore = getThemeEditor.mock.calls.length;
      pressTryAgain();
      await waitFor(() =>
        expect(getThemeEditor.mock.calls.length).toBeGreaterThan(readsBefore),
      );
      await pause();
      // Same-generation readback proves it had not landed at that instant;
      // retry sends the exact frozen payload once, at the original basis.
      expect(sent()).toHaveLength(3);
      expect(sent()[2]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
        props: { heading: "Value 2" },
      });
      expect(storedHeading()).toBe("Value 2");
      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
      });
    });
  });

  describe("the step asks by the placeholder (the page is still bound to it)", () => {
    it("refused, before adoption: nothing is sent, the step stops; Keep mine sends once, then the step runs", async () => {
      await openOn(headingReport);
      holdReads();
      answerNextWrite("conflict");
      await type("Default heading", "Value 1");
      await pause();
      // The read after ensure is held: the page is still on the placeholder.
      expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
      expect(saveStatus()).toBe("Out of date");
      expect(storedHeading()).toBe("Theirs");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: CONFLICT_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(storedHeading()).toBe("Theirs");
      expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);

      pressKeepMine();
      await releaseReads();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 3,
        props: { heading: "Value 1" },
      });
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
      expect(storedHeading()).toBe("Value 1");

      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 4,
      });
    });

    it("failed, before adoption: nothing is sent, the step stops; Try again sends once, then the step runs", async () => {
      await openOn(headingReport);
      holdReads();
      answerNextWrite("failure");
      await type("Default heading", "Value 1");
      await pause();
      expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
      expect(saveStatus()).toBe("Save failed");
      const before = calls();

      expect(await rename()).toEqual({ ok: false, message: FAILED_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(server.route).toEqual({ generation: 1, props: null });

      pressTryAgain();
      await waitFor(() => expect(sent()).toHaveLength(2));
      await pause();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 1,
        props: { heading: "Value 1" },
      });
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
      expect(storedHeading()).toBe("Value 1");

      await releaseReads();
      await expectAdopted();
      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
      });
    });

    // Stage 1 of "refuse a write with no version basis": after a lost ensure
    // answer, the next ensure finds the document existing, so this editor
    // cannot prove it created it, and generation 1 alone is no proof. Try
    // again no longer sends at generation 1: it is refused before sending,
    // kept, and "Load latest, keep mine" sends it once. (Before, Try again
    // sent it at generation 1 with no basis.)
    it("failed after a lost ensure answer (no mapping): nothing is sent or ensured, the step stops; Try again refuses for want of a basis, Keep mine sends once, then the step runs", async () => {
      loseNextEnsureAnswer();
      await openOn(headingReport);
      await type("Default heading", "Value 1");
      await pause(1_500);
      expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
      expect(saveStatus()).toBe("Save failed");
      const before = calls();
      expect(before).toMatchObject({ ensure: 1, props: 0 });

      expect(await rename()).toEqual({ ok: false, message: FAILED_HELD });
      await pause();
      expect(calls()).toEqual(before);
      expect(server.route).toEqual({ generation: 1, props: null });

      pressTryAgain();
      await waitFor(() => expect(saveStatus()).toBe("Out of date"));
      await pause();
      expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);
      expect(updateSectionProps).not.toHaveBeenCalled();
      expect(server.route).toEqual({ generation: 1, props: null });

      pressKeepMine();
      await waitFor(() => expect(sent()).toHaveLength(1));
      await pause();
      expect(sent()).toHaveLength(1);
      expect(sent()[0]).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 1,
        props: { heading: "Value 1" },
      });
      expect(storedHeading()).toBe("Value 1");

      await expectAdopted();
      expect(await rename()).toEqual({ ok: true });
      expect(renameSection).toHaveBeenCalledTimes(1);
      expect(renameSection.mock.calls[0]![0].data).toMatchObject({
        templateId: ROUTE_DOC_ID,
        expectedDraftGeneration: 2,
      });
    });
  });
});

describe("B: a lost ensure answer, then the author goes on", () => {
  async function lostEnsureThenTheirs() {
    loseNextEnsureAnswer();
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause(1_500);
    expect(saveStatus()).toBe("Save failed");
    expect(updateSectionProps).not.toHaveBeenCalled();
    // Someone else writes the document this tab created, unread here.
    server.route = { generation: 3, props: { heading: "Theirs" } };
  }

  async function refusedOverTheirs(kept: string) {
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(server.route).toEqual({
      generation: 3,
      props: { heading: "Theirs" },
    });
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();
    await pause(1_500);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);

    pressKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 3,
      props: { heading: kept },
    });
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);
    expect(storedHeading()).toBe(kept);
    expect(server.route!.generation).toBe(4);
  }

  it("typing again after an outside change: not written over Theirs, out of date, kept; Keep mine sends once at its generation", async () => {
    await lostEnsureThenTheirs();
    typeInCard(0, "Value 2");
    await pause(1_500);
    await refusedOverTheirs("Value 2");
  });

  it("Try again after an outside change: not written over Theirs, out of date, kept; Keep mine sends once at its generation", async () => {
    await lostEnsureThenTheirs();
    pressTryAgain();
    await pause(1_500);
    await refusedOverTheirs("Value 1");
  });

  // Stage 1 of "refuse a write with no version basis": with the ensure's
  // answer lost, the document is found existing next time, not proven
  // created here; typing again is refused before sending even with no
  // outside change, and Keep mine sends it once at generation 1. (Before,
  // typing again sent it at generation 1 with no basis.)
  it("mirror: with no outside change, typing again is refused for want of a basis; Keep mine sends once at generation 1 and it is stored", async () => {
    loseNextEnsureAnswer();
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause(1_500);
    expect(updateSectionProps).not.toHaveBeenCalled();
    typeInCard(0, "Value 2");
    await pause(1_500);

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(2);
    expect(updateSectionProps).not.toHaveBeenCalled();
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(server.route).toEqual({ generation: 1, props: null });

    pressKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(server.route!.generation).toBe(2);
  });
});

describe("C: placeholder-keyed content sent after an outside change", () => {
  /**
   * The first write lands (generation 2) while the read after it is held, so
   * the page stays on the placeholder and the next input is keyed by it. Its
   * answer is taken only once that read returns (the content mutation's
   * success awaits the Theme read), so the input has no recorded basis.
   */
  async function landedOnPlaceholder() {
    await openOn(headingReport);
    holdReads();
    await type("Default heading", "Value 1");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route!.generation).toBe(2);
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
  }
  const theirsAt4 = () => {
    server.route = { generation: 4, props: { heading: "Theirs" } };
  };
  function expectRefusedOverTheirs() {
    expect(sent()).toHaveLength(1);
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(server.route).toEqual({
      generation: 4,
      props: { heading: "Theirs" },
    });
    expect(saveStatus()).toBe("Out of date");
    expect(
      screen.getByRole("button", { name: "Load latest, keep mine" }),
    ).toBeTruthy();
  }

  it("typed while the first answer waits on its read, sent by the debounce: refused, kept, out of date; Keep mine sends once", async () => {
    await landedOnPlaceholder();
    holdDebounce();
    typeInCard(0, "Value 2");
    theirsAt4();
    await releaseReadsUntil(4);
    await releaseDebounce();
    expectRefusedOverTheirs();
    await pause();
    expectRefusedOverTheirs();

    // Kept: the author's explicit recovery sends what they typed, once. (The
    // field itself shows the stored value after adoption, the separate
    // stale-field-display issue, Q3.)
    pressKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 4,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
  });

  it("typed while the first answer waits on its read, sent by the pre-step flush: refused, the step stops, kept", async () => {
    await landedOnPlaceholder();
    holdDebounce();
    typeInCard(0, "Value 2");
    vi.useRealTimers();
    theirsAt4();
    await releaseReadsUntil(4);
    await expectAdopted();

    const outcome = await rename();
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe(COMPOSE_REFUSED);
    await pause();
    expect(renameSection).not.toHaveBeenCalled();
    expectRefusedOverTheirs();
  });

  it("typed before the first answer (no basis recorded), sent by the debounce: refused, kept, out of date", async () => {
    await openOn(headingReport);
    holdReads();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeInCard(0, "Value 2");
    await act(async () => {
      first.release();
      await settleMicrotasks();
    });
    expect(server.route!.generation).toBe(2);
    theirsAt4();
    await releaseReadsUntil(4);
    await releaseDebounce();
    expectRefusedOverTheirs();
  });
});

describe("D: steps that flush first stop on held content", () => {
  it("build: stops on a refused entry; no draft is prepared and no build is created", async () => {
    await realKeyedRefused();
    const before = calls();
    fireEvent.click(screen.getByRole("button", { name: "Build the theme" }));
    await pause();
    expect(calls()).toEqual(before);
    expect(createPreviewBuild).not.toHaveBeenCalled();
    expect(prepareInitialDraft).not.toHaveBeenCalled();
    expect(storedHeading()).toBe("Theirs");
    expect(saveStatus()).toBe("Out of date");
    // Said, with the reason it was held.
    expect(toast.error).toHaveBeenCalledWith(`Cannot build: ${CONFLICT_HELD}`);
    // Kept: the explicit recovery sends the typed text once; the build does
    // not go on by itself.
    pressKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 4,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(createPreviewBuild).not.toHaveBeenCalled();
    expect(prepareInitialDraft).not.toHaveBeenCalled();
  });

  it("publish: stops on a refused entry; nothing is prepared or published", async () => {
    await firstWriteLanded();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(document.querySelector("[data-publish-confirm]")).toBeTruthy(),
    );
    holdDebounce();
    typeInCard(0, "Value 2");
    await outsideWriteRead((route) => {
      route.props = { ...route.props, heading: "Theirs" };
      route.generation = 4;
    });
    await releaseDebounce();
    expect(saveStatus()).toBe("Out of date");
    const before = calls();

    const confirm = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        "[data-publish-confirm]",
      );
      expect(button).toBeTruthy();
      expect(button!.disabled).toBe(false);
      return button!;
    });
    fireEvent.click(confirm);
    await pause();
    expect(calls()).toEqual(before);
    expect(publishTemplate).not.toHaveBeenCalled();
    expect(prepareInitialDraft).not.toHaveBeenCalled();
    expect(storedHeading()).toBe("Theirs");
    // Said, with the reason it was held.
    expect(toast.error).toHaveBeenCalledWith(
      `Cannot publish: ${CONFLICT_HELD}`,
    );
    // Kept: the explicit recovery sends the typed text once; the publish
    // does not go on by itself.
    pressKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 4,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(publishTemplate).not.toHaveBeenCalled();
    expect(prepareInitialDraft).not.toHaveBeenCalled();
  });

  it("promote: stops on a refused entry with the held message; nothing is promoted", async () => {
    await realKeyedRefused();
    const before = calls();
    fireEvent.click(
      screen.getByRole("button", { name: "Promote the card text" }),
    );
    await waitFor(() => expect(promoteOutcome.settled).toBeDefined());
    await pause();
    expect(promoteOutcome.settled).toEqual({
      status: "failed",
      message: CONFLICT_HELD,
    });
    expect(calls()).toEqual(before);
    expect(promoteText).not.toHaveBeenCalled();
    expect(storedHeading()).toBe("Theirs");
  });
});

describe("E: generation 1 is not proof this tab created the document", () => {
  // Stage 1 of "refuse a write with no version basis": an existing
  // generation-1 document this editor did not create is no exception. The
  // write is refused before it is sent and kept; Keep mine sends it once.
  // (Before, it went once at generation 1 with no basis.)
  it("E1: another tab created it and left it as created: this tab's write is refused for want of a basis, kept; Keep mine sends once at generation 1", async () => {
    await openOn(headingReport);
    server.route = { generation: 1, props: null };
    await type("Default heading", "Value 1");
    await pause();

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps).not.toHaveBeenCalled();
    await waitFor(() => expect(saveStatus()).toBe("Out of date"));
    expect(screen.getAllByDisplayValue("Value 1").length).toBeGreaterThan(0);

    pressKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 1" },
    });
    expect(server.route).toMatchObject({
      generation: 2,
      props: { heading: "Value 1" },
    });
  });

  it("E2: another tab created and wrote it: refused, not written over Theirs, kept; Keep mine sends once", async () => {
    await openOn(headingReport);
    server.route = { generation: 2, props: { heading: "Theirs" } };
    await type("Default heading", "Value 1");
    await pause(1_500);

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(server.route).toEqual({
      generation: 2,
      props: { heading: "Theirs" },
    });
    expect(saveStatus()).toBe("Out of date");

    pressKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 1" },
    });
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(server.route).toMatchObject({
      generation: 3,
      props: { heading: "Value 1" },
    });
  });
});

describe("F: the creation basis applies only to placeholder-keyed input", () => {
  /** The route has its document at load (generation 3): bound to the real id. */
  async function openOnExisting() {
    server.route = { generation: 3, props: { heading: "Stored" } };
    renderEditor();
    await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    await flushFrames();
    await select(headingReport);
    expect(host.search?.templateId).toBe(ROUTE_DOC_ID);
  }

  it("F1: an existing document's own-step chain still sends, at its generations, with no ensure", async () => {
    await openOnExisting();
    await type("Stored", "Value 1");
    await pause();
    typeInCard(0, "Value 2");
    await pause();

    expect(ensureRouteTemplate).not.toHaveBeenCalled();
    expect(sent().map((write) => write.expectedDraftGeneration)).toEqual([
      3, 4,
    ]);
    expect(sent().map((write) => write.props.heading)).toEqual([
      "Value 1",
      "Value 2",
    ]);
    expect(server.route).toMatchObject({
      generation: 5,
      props: { heading: "Value 2" },
    });
  });

  it("F1: an existing document's outside change is still refused", async () => {
    await openOnExisting();
    await type("Stored", "Value 1");
    await pause();
    holdDebounce();
    typeInCard(0, "Value 2");
    await outsideWriteRead((route) => {
      route.props = { heading: "Theirs" };
      route.generation = 7;
    });
    await releaseDebounce();

    expect(ensureRouteTemplate).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(1);
    expect(server.route).toEqual({
      generation: 7,
      props: { heading: "Theirs" },
    });
    expect(saveStatus()).toBe("Out of date");
    expect(screen.getAllByDisplayValue("Value 2").length).toBeGreaterThan(0);
  });

  it("F2: placeholder-keyed input with a recorded basis (2) keeps it: sent once at 2, not refused as made on 1", async () => {
    await openOn(headingReport);
    // Reads of the Theme fail from here: the page stays on the placeholder,
    // while the first write's answer is still taken (its document, at 2,
    // becomes the copy held, nobody's own range before it).
    getThemeEditor.mockImplementation(async () => {
      throw new Error("Failed to fetch");
    });
    await type("Default heading", "Value 1");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route!.generation).toBe(2);
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
    // Typed on that copy, so its basis is 2. Replaced by 1, it would be
    // outside the own range and refused.
    typeInCard(0, "Value 2");
    await pause();

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(server.route!.generation).toBe(3);
  });

  it("F2b: placeholder-keyed input typed after the creating write's answer while the read its ensure started is still out, with NO outside change, is sent at 2 (not refused as made on 1)", async () => {
    // The read the first write's ensure started is slower than the write:
    // the first copy this tab holds is the one the write's answer brought,
    // at 2, and the input is typed on the placeholder before that read
    // arrives. Nobody else wrote the document. (The write itself has been
    // answered here; input typed while it is still unanswered, with the
    // read arriving first, is a separate case, not covered by this test.)
    await openOn(headingReport);
    holdReads();
    await type("Default heading", "Value 1");
    await pause();
    expect(sent()).toHaveLength(1);
    expect(server.route!.generation).toBe(2);
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);
    holdDebounce();
    typeInCard(0, "Value 2");
    // Held by the debounce: the second edit has not left yet.
    expect(sent()).toHaveLength(1);
    expect(server.route).toEqual({
      generation: 2,
      props: { heading: "Value 1" },
    });
    await releaseReadsUntil(2);
    await releaseDebounce();

    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(saveStatus()).not.toBe("Out of date");
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(server.route).toEqual({
      generation: 3,
      props: { heading: "Value 2" },
    });
  });

  it("F3: after Keep mine on a placeholder-keyed refusal, the rebased basis decides: sent once at the latest generation", async () => {
    await openOn(headingReport);
    holdReads();
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    holdDebounce();
    typeInCard(0, "Value 2");
    await act(async () => {
      first.release();
      await settleMicrotasks();
    });
    server.route = { generation: 4, props: { heading: "Theirs" } };
    await releaseReadsUntil(4);
    await releaseDebounce();
    expect(sent()).toHaveLength(1);
    expect(saveStatus()).toBe("Out of date");

    pressKeepMine();
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 4,
      props: { heading: "Value 2" },
    });
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(server.route).toMatchObject({
      generation: 5,
      props: { heading: "Value 2" },
    });
  });
});

/**
 * R1: one section has one pending identity across the page taking up its
 * route document. An edit held under the placeholder (failed, refused, or
 * sent with no answer) and a newer edit of the same section made after the
 * page took up the document are one edit of one section, never two, so no
 * recovery can send the older value after the newer one.
 */
describe("R1: one section, one pending edit across the page taking up its route document", () => {
  /** Writes sent after `from` that carry `heading`. */
  const sentSince = (from: number, heading: string) =>
    sent()
      .slice(from)
      .filter((write) => write.props.heading === heading);

  /** Presses whichever recovery is offered, if any, and settles. */
  async function recoverIfOffered() {
    if (screen.queryByRole("button", { name: "Try again" })) {
      pressTryAgain();
      await pause();
    }
    if (screen.queryByRole("button", { name: "Load latest, keep mine" })) {
      pressKeepMine();
      await pause();
    }
  }

  it("failed under the placeholder, then a newer edit: the newer value is stored and no recovery puts the older one back", async () => {
    answerNextWrite("failure");
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    await expectAdopted();
    expect(saveStatus()).toBe("Save failed");
    expect(server.route).toEqual({ generation: 1, props: null });
    const typedAt = sent().length;

    typeInCard(0, "Value 2");
    await pause();
    await recoverIfOffered();

    expect(sentSince(typedAt, "Value 1")).toHaveLength(0);
    expect(storedHeading()).toBe("Value 2");
    expect(server.route!.generation).toBe(2);
    expect(saveStatus()).not.toBe("Save failed");
    // Nothing more goes on its own.
    const settled = sent().length;
    await pause();
    expect(sent()).toHaveLength(settled);
  });

  it("refused under the placeholder, then a newer edit: Theirs is written over only by the newer value, and only once", async () => {
    answerNextWrite("conflict");
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause();
    await expectAdopted();
    expect(saveStatus()).toBe("Out of date");
    expect(storedHeading()).toBe("Theirs");
    const typedAt = sent().length;

    typeInCard(0, "Value 2");
    await pause();
    await recoverIfOffered();

    expect(sentSince(typedAt, "Value 1")).toHaveLength(0);
    // Every write after the newer edit carries it; one of them landed.
    expect(sent().slice(typedAt).length).toBeGreaterThan(0);
    expect(
      sent()
        .slice(typedAt)
        .every((write) => write.props.heading === "Value 2"),
    ).toBe(true);
    expect(storedHeading()).toBe("Value 2");
    const settled = sent().length;
    await pause();
    expect(sent()).toHaveLength(settled);
  });

  it("landed with no answer, then a newer edit: held; Try again checks the write as it was sent, then sends the newer value once", async () => {
    // The write lands, and its answer never arrives.
    updateSectionProps.mockImplementationOnce(
      async ({ data }: { data: WriteRequest }) => {
        applyWrite(data);
        throw new Error("Failed to fetch");
      },
    );
    await openOn(headingReport);
    await type("Default heading", "Value 1");
    await pause(1_500);
    expect(storedHeading()).toBe("Value 1");
    expect(server.route!.generation).toBe(2);
    expect(saveStatus()).toBe("Save failed");

    typeInCard(0, "Value 2");
    await pause();
    // Held behind the unanswered write: nothing goes on its own.
    expect(sent()).toHaveLength(1);
    expect(storedHeading()).toBe("Value 1");

    await recoverIfOffered();
    await pause();

    expect(sent()).toHaveLength(2);
    // The check found the write as it was sent (Value 1) landed: the newer
    // value goes once, on the document that write produced.
    expect(sent()[1]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 2,
      props: { heading: "Value 2" },
    });
    expect(storedHeading()).toBe("Value 2");
    expect(server.route!.generation).toBe(3);
  });
});

/**
 * Q3: the Inspector field the author is typing in stays the same input
 * across the page taking up the route document its own first write
 * created: its text, focus, caret and anything typed since are the author's,
 * and an edit that appends builds on what they typed, never on a default the
 * field was rebuilt with. Typing appends to the value shown, as a keyboard
 * does; `fill()`-style replacement would hide a rebuilt field.
 */
describe("Q3: the field the author types in, across the page taking up its route document", () => {
  /** Row b's title, among the rows' titles the row selection shows. */
  const rowB = () => cardFields()[1] as HTMLInputElement | undefined;

  function typeKeeping(field: HTMLInputElement, value: string) {
    act(() => {
      field.focus();
    });
    fireEvent.input(field, { target: { value } });
    field.setSelectionRange(value.length, value.length);
  }

  /**
   * The first input into a list whose rows have no ids gives the rows their
   * ids, and the row inputs are rebuilt then. That happens on any document,
   * not when the page takes up its route document, and is recorded apart
   * (handoff row-id-seeding: input lost, a separate fix). These tests start
   * following the field once the rows have their ids, with focus and caret
   * where the author left them. They show the page taking up its document
   * no longer rebuilds the input; they do not show the first edit of rows
   * without ids keeps it.
   */
  function beginInRowB(value: string): HTMLInputElement {
    typeKeeping(rowB()!, value);
    const field = rowB()!;
    act(() => {
      field.focus();
    });
    field.setSelectionRange(field.value.length, field.value.length);
    expect(field.value).toBe(value);
    return field;
  }

  function expectSameField(field: HTMLInputElement, value: string) {
    expect(field.isConnected).toBe(true);
    expect(rowB()).toBe(field);
    expect(field.value).toBe(value);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([
      value.length,
      value.length,
    ]);
  }

  it("row b while the first write is unanswered: the same input keeps text, focus and caret; the appended text is stored", async () => {
    await openOn(secondRowReport);
    const first = holdNextWrite();
    expect(rowB()!.value).toBe("Two");
    const field = beginInRowB("Two edited");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    expectSameField(field, "Two edited");

    typeKeeping(field, `${field.value} more`);
    await act(async () => {
      first.release();
    });
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    await expectAdopted();

    expectSameField(field, "Two edited more");
    expect(rowsOf(sent()[1]!).map(([, title]) => title)).toEqual([
      "One",
      "Two edited more",
    ]);
    expect(
      (server.route!.props!.items as Array<{ title: string }>).map(
        (row) => row.title,
      ),
    ).toEqual(["One", "Two edited more"]);
  });

  it("row b after the first answer landed: the same input keeps text, focus and caret; the appended text is stored", async () => {
    await openOn(secondRowReport);
    const field = beginInRowB("Two edited");
    await pause();
    await expectAdopted();
    expectSameField(field, "Two edited");

    typeKeeping(field, `${field.value} more`);
    await pause();
    expectSameField(field, "Two edited more");
    expect(
      (server.route!.props!.items as Array<{ title: string }>).map(
        (row) => row.title,
      ),
    ).toEqual(["One", "Two edited more"]);
  });

  it("the heading (saved on leaving the field) while the first write is unanswered: it shows the author's text, and appending builds on it", async () => {
    await openOn(headingReport);
    const first = holdNextWrite();
    await type("Default heading", "Value 1");
    await waitFor(() => expect(sent()).toHaveLength(1));
    await pause();
    const field = cardFields()[0] as HTMLTextAreaElement;
    expect(field.value).toBe("Value 1");

    // The author goes back into the field and appends to what is shown.
    act(() => {
      field.focus();
    });
    fireEvent.input(field, { target: { value: `${field.value} more` } });
    fireEvent.blur(field);
    await act(async () => {
      first.release();
    });
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pause();
    await expectAdopted();

    expect(sent()[1]!.props.heading).toBe("Value 1 more");
    expect(
      sent().filter((write) =>
        String(write.props.heading).startsWith("Default heading"),
      ),
    ).toHaveLength(0);
    expect(storedHeading()).toBe("Value 1 more");
    expect((cardFields()[0] as HTMLTextAreaElement).value).toBe("Value 1 more");
  });

  it("synthetic composition events (jsdom, not a real IME): a composition open across the page taking up the document ends in the same input and is stored", async () => {
    await openOn(secondRowReport);
    const first = holdNextWrite();
    const field = beginInRowB("Two edited");
    await waitFor(() => expect(sent()).toHaveLength(1));

    fireEvent.compositionStart(field);
    fireEvent.input(field, { target: { value: "Two edited 新" } });
    await act(async () => {
      first.release();
    });
    await pause();
    await expectAdopted();
    expect(field.isConnected).toBe(true);
    expect(rowB()).toBe(field);
    expect(document.activeElement).toBe(field);
    fireEvent.input(field, { target: { value: "Two edited 新年" } });
    fireEvent.compositionEnd(field);
    await pause();

    expect(field.value).toBe("Two edited 新年");
    expect(
      (server.route!.props!.items as Array<{ title: string }>).map(
        (row) => row.title,
      ),
    ).toEqual(["One", "Two edited 新年"]);
  });
});

/**
 * Moved from visual-editor-shell-inline-guard-accepted-copy.test.tsx (R1-R3),
 * where they wrote with no copy held of an existing document. Stage 1 of "no
 * basis -> refuse" sends no such write; the one write still sent with no copy
 * held is onto a route document this editor's ensure created
 * (`createdByThisCall`), so they run on that path here. Their intent is
 * unchanged: only an answered write with a valid document makes the first
 * copy; a refused, document-less or unanswered answer moves no source
 * baseline and makes no first copy.
 */
describe("only an answered write with a valid document makes the first copy", () => {
  const sourceBaseline = () => {
    const state = useThemeWorkspaceStore.getState();
    const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
    return {
      accepted: state.getAcceptedSourceGeneration(scope),
      observed: state.getObservedSourceGeneration(scope),
    };
  };
  /** The first write: sent once, with no copy held, onto the created document. */
  const sentOnceOntoCreatedDocument = () => {
    expect(ensureRouteTemplate).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      templateId: ROUTE_DOC_ID,
      expectedDraftGeneration: 1,
      props: { heading: "Value 1" },
    });
  };

  // Stage 1 of "no basis -> refuse": on a route document this editor created,
  // where the no-copy write is still sent (before: an existing document).
  it("R1 a refused write moves no source baseline", async () => {
    updateSectionProps.mockImplementation(async () => conflictAnswer());
    await openOn(headingReport);
    const before = sourceBaseline();
    await type("Default heading", "Value 1");
    await pause();
    sentOnceOntoCreatedDocument();
    expect(sourceBaseline()).toEqual(before);
  });

  // Stage 1 of "no basis -> refuse": on a route document this editor created
  // (before: an existing document, observed through a canvas commit). Reads
  // of the Theme fail, so no read brings a copy; the only copy there could
  // be is one made from the answer. F2 is the control: the same steps with
  // an answer that carries its document make a copy at 2, and the next edit
  // is sent at 2. Here none is made, so the next edit is not sent.
  it("R2 an answer without a document makes no copy: the answered text is not taken as stored", async () => {
    await openOn(headingReport);
    getThemeEditor.mockImplementation(async () => {
      throw new Error("Failed to fetch");
    });
    updateSectionProps.mockImplementationOnce(
      async ({ data }: { data: WriteRequest }) => {
        const saved = applyWrite(data) as ReturnType<typeof savedAnswer>;
        return {
          ...saved,
          data: {
            draftGeneration: saved.data.draftGeneration,
            droppedProps: [],
          },
        };
      },
    );
    const before = sourceBaseline();
    await type("Default heading", "Value 1");
    await pause();
    sentOnceOntoCreatedDocument();
    expect(server.route).toEqual({
      generation: 2,
      props: { heading: "Value 1" },
    });
    expect(host.search?.templateId).not.toBe(ROUTE_DOC_ID);

    typeInCard(0, "Value 2");
    await pause();
    expect(sent(), "no copy at 2 to send the next edit on").toHaveLength(1);
    expect(server.route).toEqual({
      generation: 2,
      props: { heading: "Value 1" },
    });
    expect(sourceBaseline()).toEqual(before);
  });

  // Stage 1 of "no basis -> refuse": on a route document this editor created,
  // where the no-copy write is still sent (before: an existing document).
  it("R3 an unanswered write moves no source baseline", async () => {
    updateSectionProps.mockImplementation(async () => {
      throw new Error("Failed to fetch");
    });
    await openOn(headingReport);
    const before = sourceBaseline();
    await type("Default heading", "Value 1");
    await pause();
    sentOnceOntoCreatedDocument();
    expect(sourceBaseline()).toEqual(before);
  });
});
