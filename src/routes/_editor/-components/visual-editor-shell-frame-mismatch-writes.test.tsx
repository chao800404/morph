import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { listStorefrontThemeFiles } from "@/server/storefront/storefront-theme-files.serverFn";
import {
  applyThemePreviewFiles,
  probeThemePreviewAddress,
  startThemePreviewServer,
  touchThemePreviewServer,
} from "@/server/storefront/storefront-theme-preview-server.serverFn";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import {
  CANVAS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE,
  HISTORY_OTHER_PAGE_MESSAGE,
  PREVIEW_OTHER_PAGE_NOT_SAVED_MESSAGE,
  VisualEditorShell,
  type EditorNavigationGuard,
} from "./visual-editor-shell";
import {
  answerFramePings,
  frameEnvelope,
  modelCurrentBridge,
  reloadFrameDocument,
} from "@/lib/test-utils/preview-frame-handshake";

/**
 * Whether a write can land on another page's document while the editor and
 * the frame show different pages.
 *
 * Two windows open that mismatch: the author moved inside the frame and the
 * editor's switch to follow has not landed yet, and the editor switched pages
 * and the frame has not arrived yet. In both, the frame keeps sending what
 * the author does on the page it shows. A selection or a commit from it names
 * a slot id, not a page; when the editor's page has a slot of that id, it
 * would be read as that page's.
 *
 * The harness is the one of `visual-editor-shell-frame-navigation.test.tsx`.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const saveThemeFile = vi.hoisted(() => vi.fn());
const panelSelections = vi.hoisted((): unknown[] => []);
let lastPanelProps: ComponentProps<
  typeof import("./editor-assistant-panel").EditorAssistantPanel
> | null = null;

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    getStorefrontThemeEditor: getThemeEditor,
  }),
);
vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    listStorefrontThemeFiles: vi.fn(),
    saveStorefrontThemeFile: saveThemeFile,
  }),
);
vi.mock(
  "@/server/storefront/storefront-theme-preview-server.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startThemePreviewServer: vi.fn(),
    applyThemePreviewFiles: vi.fn(),
    touchThemePreviewServer: vi.fn(),
    probeThemePreviewAddress: vi.fn(),
  }),
);
vi.mock(
  "@/server/storefront/storefront-preview-media.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    signThemePreviewMedia: vi.fn(),
  }),
);
vi.mock("./editor-media-picker-popover", () => ({
  EditorMediaPickerPopover: () => null,
}));
vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(),
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
// Code Mode mounts the Code workspace; Monaco itself is not what is tested.
vi.mock("@monaco-editor/react", () => ({
  default: () => <textarea aria-label="Code editor" />,
}));
vi.mock("./editor-code-language-support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editor-code-language-support")>()),
  configureThemeTypeScript: vi.fn(),
  disposeThemeWorkspaceModels: vi.fn(),
  ensureThemeWorkspaceModels: vi.fn(),
  registerTailwindCompletionProvider: vi.fn(() => ({ dispose: vi.fn() })),
}));
// The Inspector panel is the real one; what it is handed as the selection is
// recorded, since its style and spacing controls act on that alone.
vi.mock("./editor-assistant-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-assistant-panel")>();
  const RealPanel = actual.EditorAssistantPanel;
  return {
    ...actual,
    EditorAssistantPanel: (props: ComponentProps<typeof RealPanel>) => {
      lastPanelProps = props;
      panelSelections.push(props.selection ?? null);
      return <RealPanel {...props} />;
    },
  };
});

/**
 * Two static pages, /b and /c, each rendering the same component under the
 * same two slot ids (`hero`, `promo`) with the same stored text. Each has
 * its own page document. A slot id shared by two pages is legitimate: the
 * content is per page, and only the page the editor shows decides which
 * document an edit is for.
 */
const SAME = "Same heading";
const pageDocument = (routePath: string) => ({
  id: `template${routePath.replace("/", "-")}`,
  type: "page",
  name: `Page ${routePath}`,
  routePath,
  document: {
    version: 1,
    sections: [
      { id: "hero", type: "Hero", props: { heading: SAME } },
      { id: "promo", type: "Hero", props: { heading: SAME } },
    ],
  },
  draftRevisionId: null,
  publishedRevisionId: null,
  draftGeneration: 1,
  version: 1,
});

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
      document: { version: 1, sections: [] },
      draftGeneration: 1,
      version: 1,
    },
    pageDocument("/b"),
    pageDocument("/c"),
  ],
} as unknown as StorefrontThemeEditorDTO;

const pageSearch = (routePath: "/b" | "/c") =>
  ({
    template: "page",
    templateId: `template${routePath.replace("/", "-")}`,
    routePath,
    viewport: "desktop",
  }) as StorefrontThemeEditorSearch;
const homeSearch = pageSearch("/b");

const pageSource = (
  routePath: string,
) => `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../hero/Hero";

export const Route = createFileRoute("${routePath}")({
  component: Page,
});

function Page() {
  return (
    <main>
      <Hero {...content("hero")} />
      <Hero {...content("promo")} />
    </main>
  );
}
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
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
});
const FILES = [
  // The source of a TanStack Start Theme: its preview is mounted with a
  // router, so its frame names the page it shows.
  file(
    "package.json",
    JSON.stringify({
      dependencies: {
        "@tanstack/react-router": "1.0.0",
        "@tanstack/react-start": "1.0.0",
      },
    }),
  ),
  file("src/router.tsx", "export const getRouter = () => null;\n"),
  file(
    "src/routes/__root.tsx",
    'import { createRootRoute } from "@tanstack/react-router";\nexport const Route = createRootRoute({});\n',
  ),
  file(
    "src/morph/content.ts",
    'export { content, morph, isSectionHidden } from "@morph/sdk";\n',
  ),
  file(
    "src/routes/index.tsx",
    'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/")({ component: () => <main /> });\n',
  ),
  file("src/routes/b.tsx", pageSource("/b")),
  file("src/routes/c.tsx", pageSource("/c")),
  file(
    "src/hero/Hero.tsx",
    `type HeroProps = { heading?: string };

export default function Hero({ heading = "Hero default" }: HeroProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{heading}</h2>
    </section>
  );
}
`,
  ),
  file(
    "src/hero/Hero.fields.ts",
    `export const contentFields = {
  heading: { type: "text", label: "Hero heading" },
} as const;
`,
  ),
];
const tree = (files = FILES) => ({
  files,
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
          children: files
            .filter((entry) => entry.path.startsWith("src/routes/"))
            .map((entry) => ({
              name: entry.path.slice("src/routes/".length),
              path: entry.path,
              isDirectory: false,
            })),
        },
        {
          name: "hero",
          path: "src/hero",
          isDirectory: true,
          children: files
            .filter((entry) => entry.path.startsWith("src/hero/"))
            .map((entry) => ({
              name: entry.path.slice("src/hero/".length),
              path: entry.path,
              isDirectory: false,
            })),
        },
      ],
    },
  ],
  sourceGeneration: 1,
  latestPublishedRevision: null,
});

type Posted = {
  type: string;
  routePath?: string | null;
  routeRequestId?: number;
  selectionRevision?: number;
  sectionId?: string | null;
  nodeId?: string | null;
};
let log: Posted[] = [];

type Harness = {
  /** Every change the shell asked the router for, in order. */
  asked: Array<Partial<StorefrontThemeEditorSearch>>;
  /** The location the shell is showing now. */
  search: () => StorefrontThemeEditorSearch;
  /** Holds the next load: `search` stays put until `finishLoad`. */
  holdLoads: () => void;
  /** Finishes the held load; later ones are not held. */
  finishLoad: () => void;
  /** The editor's read of the Theme, as a refetch hands it over. */
  setContext: (next: StorefrontThemeEditorDTO) => void;
};

function renderRouted(
  initial: StorefrontThemeEditorSearch = homeSearch,
  initialContext = context,
  files = FILES,
) {
  const harness = { asked: [] } as unknown as Harness;
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
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    tree(files) as never,
  );
  const guardRef: { current: EditorNavigationGuard | null } = { current: null };
  let holding = false;

  function Routed() {
    const [search, setSearch] = useState(initial);
    const [heading, setHeading] = useState(initial);
    const [shellContext, setShellContext] = useState(initialContext);
    harness.setContext = setShellContext;
    harness.search = () => search;
    harness.holdLoads = () => {
      holding = true;
    };
    harness.finishLoad = () => {
      holding = false;
      act(() => setSearch(heading));
    };
    const onSearchChange = (next: Partial<StorefrontThemeEditorSearch>) => {
      harness.asked.push(next);
      const merged = { ...heading, ...next };
      // Like the route's search middleware: Home carries no path.
      if (merged.routePath === "/") delete merged.routePath;
      const go = () => {
        setHeading(merged);
        if (!holding) setSearch(merged);
      };
      const switchesPage =
        (merged.routePath ?? "/") !== (heading.routePath ?? "/") ||
        merged.templateId !== heading.templateId;
      if (!switchesPage || !guardRef.current) {
        go();
        return;
      }
      // As `useBlocker` does: the location moves only once the guard says so.
      void guardRef.current("switch-page").then((blocked) => {
        if (!blocked) go();
      });
    };
    return (
      <VisualEditorShell
        context={shellContext}
        search={search}
        onSearchChange={onSearchChange}
        navigatingRoutePath={heading.routePath || "/"}
        navigationGuardRef={guardRef}
      />
    );
  }

  render(
    <QueryClientProvider client={client}>
      <Routed />
    </QueryClientProvider>,
  );
  return harness;
}

const currentWindow = () =>
  document.querySelector("iframe")?.contentWindow ?? null;
const event = (data: Record<string, unknown>) =>
  new MessageEvent("message", {
    data: frameEnvelope({ ...data, previewSession: PREVIEW_SESSION }),
    origin: PREVIEW_ORIGIN,
    source: currentWindow(),
  });
function fromPreview(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(event(data));
  });
  answerFramePings({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
}
const report = (routePath: string | undefined, nodes: unknown[] = []) =>
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes,
    ...(routePath === undefined ? {} : { routePath }),
  });
const applied = (
  routeRequestId: number | undefined,
  routePath: string | null,
) =>
  fromPreview({
    type: "morph:storefront-preview-route-applied",
    routeRequestId,
    routePath,
  });

/** Lets work settle; moves the clock when a test has frozen it. */
const tick = (ms = 20) =>
  act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms);
    else await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** The style revision the editor last sent the frame; 0 before any. */
const latestStyleRevision = () =>
  Number(
    log
      .map((message) => (message as { styleRevision?: unknown }).styleRevision)
      .filter((revision) => revision !== undefined)
      .at(-1) ?? 0,
  );
const routeRequests = () =>
  log.filter(
    (message) => message.type === "morph:storefront-preview-set-route",
  );
const latestRequest = () => routeRequests().at(-1);
/** The routes the shell asked the router to switch to. */
const routesAsked = (harness: Harness) =>
  harness.asked
    .filter((next) => "routePath" in next)
    .map((next) => next.routePath);
const shownRoute = (harness: Harness) => harness.search().routePath ?? "/";

/**
 * Renders on `initial`, brings the frame up and lets it answer the editor's
 * route request: the editor is asking it for nothing.
 */
async function settled(
  initial: StorefrontThemeEditorSearch = homeSearch,
  initialContext = context,
  files = FILES,
) {
  const harness = renderRouted(initial, initialContext, files);
  await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  fromPreview({
    type: "morph:storefront-preview-ready",
    servedInstance: {
      kind: "known",
      instance: { session: SESSION, serial: 1 },
    },
  });
  await tick(0);
  const request = latestRequest();
  // Precondition: the frame was sent the route on screen.
  expect(request?.routePath ?? "/").toBe(initial.routePath ?? "/");
  applied(request?.routeRequestId, initial.routePath ?? "/");
  report(initial.routePath ?? "/");
  await tick(0);
  return harness;
}

beforeEach(() => {
  log = [];
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
  getThemeEditor.mockReset();
  getThemeEditor.mockResolvedValue({
    success: true,
    message: "ok",
    data: context,
  });
  updateSectionProps.mockReset();
  vi.mocked(postEditorToPreviewMessage).mockReset();
  vi.mocked(postEditorToPreviewMessage).mockImplementation(
    (_target, message) => {
      log.push(message as Posted);
    },
  );
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(listStorefrontThemeFiles).mockReset();
  vi.mocked(listStorefrontThemeFiles).mockImplementation(
    async () => ({ success: true, message: "ok", data: tree() }) as never,
  );
  vi.mocked(startThemePreviewServer).mockReset();
  vi.mocked(startThemePreviewServer).mockResolvedValue({
    success: true,
    message: "Live Preview server ready",
    data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
  } as never);
  vi.mocked(touchThemePreviewServer).mockReset();
  vi.mocked(touchThemePreviewServer).mockImplementation(
    async () =>
      ({
        success: true,
        message: "Live Preview server checked",
        data: {
          previewId: "preview-1",
          serving: true,
          servedInstance: { session: SESSION, serial: 1 },
        },
      }) as never,
  );
  vi.mocked(applyThemePreviewFiles).mockReset();
  vi.mocked(applyThemePreviewFiles).mockImplementation(
    async (request: unknown) => {
      const files = (request as { data: { files: Array<{ path: string }> } })
        .data.files;
      return {
        success: true,
        message: "Live Preview files written",
        data: {
          previewId: "preview-1",
          changed: [],
          unchanged: files.map((entry) => entry.path),
          skipped: [],
          servedInstance: { session: SESSION, serial: 1 },
        },
      } as never;
    },
  );
  vi.mocked(probeThemePreviewAddress).mockReset();
  vi.mocked(probeThemePreviewAddress).mockResolvedValue({
    success: true,
    message: "ok",
    data: { state: "unknown" },
  } as never);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

let selectionRevision = 10_000;
/** The canvas selection mode, as the author turns it on to click the page. */
function enableSelection() {
  act(() => {
    screen.getByRole("button", { name: "Enable section selection" }).click();
  });
}
/** The author clicks a slot's heading on the page the frame shows. */
function frameSelects(sectionId: "hero" | "promo", fieldPath = "heading") {
  selectionRevision += 1;
  fromPreview({
    type: "morph:storefront-preview-select-section",
    sectionId,
    componentType: "Hero",
    kind: "heading",
    nodeId: `${sectionId}:node:heading`,
    sourceFilePath: "src/hero/Hero.tsx",
    sourceLocation: null,
    elementKey: "heading",
    fieldKey: fieldPath.split(".")[0],
    field: fieldPath.split(".")[0],
    fieldPath,
    descendantFields: [],
    tagName: "h2",
    role: null,
    inputType: null,
    styleRevision: latestStyleRevision(),
    className: "text-2xl font-semibold",
    isSection: false,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
    selectionRevision,
  });
}
/** Text finished on the frame's page, over the stored text. */
function frameCommitsText(sectionId: "hero" | "promo", value: string) {
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId,
    fieldKey: "heading",
    fieldPath: "heading",
    value,
    originalValue: SAME,
  });
}
/** Which page document each content write was for. */
const writtenTemplates = () =>
  updateSectionProps.mock.calls.map(
    (call) => (call[0] as { data: { templateId?: string } }).data.templateId,
  );
const selectedInInspector = () =>
  (panelSelections.at(-1) as { sectionId?: string } | null | undefined)
    ?.sectionId ?? null;

/**
 * Types into every Inspector box that shows the stored heading, as the
 * author would into the one the selection opened. None, when nothing was
 * selected.
 */
async function editInInspector(value: string) {
  const content = screen.queryByRole("button", { name: /^Content$/ });
  if (content) fireEvent.click(content);
  await tick(0);
  for (const field of screen.queryAllByDisplayValue(SAME)) {
    fireEvent.focus(field);
    fireEvent.input(field, { target: { value } });
    fireEvent.blur(field);
  }
  await tick(400);
}

/**
 * The editor shows /b; the frame is on /c. The author followed a link inside
 * the frame and the editor's switch to /c is still on its way: the router
 * has not loaded it.
 */
async function frameAheadOfEditor() {
  const harness = await settled(pageSearch("/b"));
  enableSelection();
  harness.holdLoads();
  report("/c");
  await tick(0);
  // Precondition: the mismatch window.
  expect(routesAsked(harness)).toEqual(["/c"]);
  expect(shownRoute(harness)).toBe("/b");
  return harness;
}

/**
 * The editor shows /c; the frame is still on /b. The author picked /c in the
 * page list and the frame has not answered the editor's set-route yet.
 */
async function editorAheadOfFrame() {
  const harness = await settled(pageSearch("/b"));
  enableSelection();
  const row = await screen.findByTitle("Preview /c");
  act(() => row.click());
  await tick(0);
  // Precondition: the mismatch window, the other way round.
  expect(shownRoute(harness)).toBe("/c");
  expect(latestRequest()?.routePath).toBe("/c");
  return harness;
}

/**
 * The editor shows /b; the frame has just reloaded itself (a new ready round)
 * and has not named its page yet in this round.
 */
async function frameReloadedUnnamed() {
  // A current bridge: each document names itself and answers the editor's
  // pings (C5 option A), so a reload in the frame is a confirmed new document.
  modelCurrentBridge();
  const harness = await settled(pageSearch("/b"));
  enableSelection();
  reloadFrameDocument();
  fromPreview({
    type: "morph:storefront-preview-ready",
    servedInstance: {
      kind: "known",
      instance: { session: SESSION, serial: 1 },
    },
  });
  await tick(0);
  // Precondition: the new round's request went out, unanswered, unreported.
  expect(latestRequest()?.routePath).toBe("/b");
  expect(shownRoute(harness)).toBe("/b");
  return harness;
}

type Entry = {
  /** What the frame sends. */
  send: () => void;
  /** It wrote, or moved the Inspector: what it does when it is taken. */
  wrote: () => boolean;
  /** Commits say why they were not saved; a selection is dropped quietly. */
  notice: boolean;
};
/** Every frame message that writes or moves the Inspector's target. */
const ENTRIES: Record<string, Entry> = {
  "select-section": {
    send: () => frameSelects("hero"),
    wrote: () => selectedInInspector() !== null,
    notice: false,
  },
  "commit-inline-text": {
    send: () => frameCommitsText("hero", "Typed on the frame's page"),
    wrote: () => writtenTemplates().length > 0,
    notice: true,
  },
  "commit-section-reorder": {
    send: () =>
      fromPreview({
        type: "morph:storefront-preview-commit-section-reorder",
        draggedSectionId: "promo",
        targetSectionId: "hero",
      }),
    wrote: () => saveThemeFile.mock.calls.length > 0,
    notice: true,
  },
  "commit-sibling-reorder": {
    send: () =>
      fromPreview({
        type: "morph:storefront-preview-commit-sibling-reorder",
        sectionId: "hero",
        sourceFilePath: "src/hero/Hero.tsx",
        draggedNodeId: "hero:node:heading",
        targetNodeId: "hero:node:section",
      }),
    wrote: () => saveThemeFile.mock.calls.length > 0,
    notice: true,
  },
  "commit-array-item-reorder": {
    send: () =>
      fromPreview({
        type: "morph:storefront-preview-commit-array-item-reorder",
        sectionId: "hero",
        draggedFieldPath: "items.0",
        targetFieldPath: "items.1",
      }),
    wrote: () => writtenTemplates().length > 0,
    notice: true,
  },
};
const noticed = () =>
  vi
    .mocked(toast.info)
    .mock.calls.some(
      (call) => call[0] === PREVIEW_OTHER_PAGE_NOT_SAVED_MESSAGE,
    );
const WINDOWS: Record<string, () => Promise<unknown>> = {
  "frame ahead (frame on /c, editor on /b)": frameAheadOfEditor,
  "editor ahead (editor on /c, frame on /b)": editorAheadOfFrame,
  "unknown page (frame reloaded, no page named yet)": frameReloadedUnnamed,
};

beforeEach(() => {
  selectionRevision = 10_000;
  panelSelections.length = 0;
  lastPanelProps = null;
  saveThemeFile.mockReset();
  saveThemeFile.mockResolvedValue({
    success: false,
    message: "not in this test",
  });
  updateSectionProps.mockResolvedValue({
    success: true,
    data: { draftGeneration: 2, droppedProps: [] },
  });
});

describe("source-derived sorting with an unprojected stored Document", () => {
  const unstoredContext = (): StorefrontThemeEditorDTO => ({
    ...context,
    templates: context.templates.map((template) =>
      template.id === "template-b"
        ? { ...template, document: { version: 1, sections: [] } }
        : template,
    ),
  });

  it("reorders proven virtual page slots without materializing their Document", async () => {
    const raw = unstoredContext();
    const before = JSON.stringify(raw);
    await settled(homeSearch, raw);
    enableSelection();
    ENTRIES["commit-section-reorder"]!.send();
    await waitFor(() => expect(saveThemeFile).toHaveBeenCalledTimes(1));
    const saved = saveThemeFile.mock.calls[0]![0].data as {
      path: string;
      content: string;
    };
    expect(saved.path).toBe("src/routes/b.tsx");
    expect(saved.content.indexOf('content("promo")')).toBeLessThan(
      saved.content.indexOf('content("hero")'),
    );
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("refuses a section absent from the derived page view", async () => {
    await settled(homeSearch, unstoredContext());
    enableSelection();
    fromPreview({
      type: "morph:storefront-preview-commit-section-reorder",
      draggedSectionId: "unknown",
      targetSectionId: "hero",
    });
    await tick(20);
    expect(saveThemeFile).not.toHaveBeenCalled();
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("uses only page-owned virtual slots when a shared layout surrounds them", async () => {
    const raw = unstoredContext();
    raw.templates.push({
      ...raw.templates[0]!,
      id: "template-layout",
      type: "layout",
      document: { version: 1, sections: [] },
    });
    const files = [
      ...FILES,
      file(
        "morph.theme.json",
        JSON.stringify({
          documentLayout: { source: "src/Layout.tsx" },
        }),
      ),
      file(
        "src/Layout.tsx",
        `import { content } from "./morph/content";
import Hero from "./hero/Hero";
export default function Layout({ children }) {
  return <><Hero {...content("global-header")} />{children}</>;
}`,
      ),
    ];
    await settled(homeSearch, raw, files);
    enableSelection();
    ENTRIES["commit-section-reorder"]!.send();
    await waitFor(() => expect(saveThemeFile).toHaveBeenCalledTimes(1));
    expect(saveThemeFile.mock.calls[0]![0].data.path).toBe("src/routes/b.tsx");
    expect(updateSectionProps).not.toHaveBeenCalled();
    // A shared section cannot be moved into this page's source order.
    saveThemeFile.mockClear();
    fromPreview({
      type: "morph:storefront-preview-commit-section-reorder",
      draggedSectionId: "global-header",
      targetSectionId: "hero",
    });
    await tick(20);
    expect(saveThemeFile).not.toHaveBeenCalled();
  });

  it("refuses the whole source reorder when a stored slot is unbound", async () => {
    const raw = unstoredContext();
    const template = raw.templates.find((entry) => entry.id === "template-b")!;
    template.document.sections.push({
      id: "unbound",
      type: "Hero",
      enabled: false,
      props: { heading: "Keep this stored content" },
    });
    const before = JSON.stringify(raw);
    await settled(homeSearch, raw);
    enableSelection();
    ENTRIES["commit-section-reorder"]!.send();
    await tick(20);
    expect(saveThemeFile).not.toHaveBeenCalled();
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("reorders pending array items on a proven virtual slot through the existing writer", async () => {
    const raw = unstoredContext();
    const before = JSON.stringify(raw);
    const files = FILES.map((entry) =>
      entry.path === "src/hero/Hero.fields.ts"
        ? {
            ...entry,
            content: `export const contentFields = {
  heading: { type: "text", label: "Hero heading" },
  items: { type: "array", fields: { heading: { type: "text" } } },
} as const;`,
          }
        : entry,
    );
    await settled(homeSearch, raw, files);
    enableSelection();
    // The author selects the array the edit and the reorder are made in: a
    // selection of one item's heading is not a source capture for `items`,
    // and the existing guard rightly asks to reselect (stored slot alike).
    frameSelects("hero", "items");
    await tick(0);
    expect(selectedInInspector()).toBe("hero");
    act(() => {
      lastPanelProps?.onSectionPropsChange?.("hero", {
        items: [
          { id: "first", heading: "First" },
          { id: "second", heading: "Second" },
        ],
      });
    });
    // Reorder before the pending edit's ordinary debounce sends it. The view
    // owns the virtual slot; the raw Document must not fabricate it on read.
    ENTRIES["commit-array-item-reorder"]!.send();
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const saved = updateSectionProps.mock.calls[0]![0].data as {
      templateId: string;
      sectionId: string;
      props: Record<string, unknown>;
    };
    expect(saved.templateId).toBe("template-b");
    expect(saved.sectionId).toBe("hero");
    expect(saved.props.items).toEqual([
      { id: "second", heading: "Second" },
      { id: "first", heading: "First" },
    ]);
    expect(saveThemeFile).not.toHaveBeenCalled();
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("a write while the editor and the frame show different pages", () => {
  it("control: with both on /b, an inline edit of the shared slot is written to /b's document", async () => {
    await settled(pageSearch("/b"));
    enableSelection();
    frameSelects("hero");
    await tick(0);
    expect(selectedInInspector()).toBe("hero");
    frameCommitsText("hero", "Typed on B");
    await tick(400);
    expect(writtenTemplates()).toEqual(["template-b"]);
  });

  it("control: with both on /b, an Inspector edit of the shared slot is written to /b's document", async () => {
    await settled(pageSearch("/b"));
    enableSelection();
    frameSelects("hero");
    await tick(0);
    await editInInspector("Inspector on B");
    expect(writtenTemplates()).toEqual(["template-b"]);
  });

  describe("frame on /c, editor still on /b", () => {
    it("an inline edit of /c's slot that /b shares writes nothing", async () => {
      await frameAheadOfEditor();
      frameSelects("hero");
      await tick(0);
      frameCommitsText("hero", "Typed on C");
      await tick(400);
      expect(writtenTemplates()).toEqual([]);
    });

    it("an Inspector edit of /c's slot that /b shares writes nothing", async () => {
      await frameAheadOfEditor();
      frameSelects("hero");
      await tick(0);
      await editInInspector("Inspector on C");
      expect(writtenTemplates()).toEqual([]);
    });

    it("the Inspector's style and spacing controls are never handed /c's element", async () => {
      await frameAheadOfEditor();
      frameSelects("hero");
      await tick(0);
      expect(selectedInInspector()).toBeNull();
    });

    it("an inline edit from /c writes nothing even under a selection made on /b, and says so", async () => {
      const harness = await settled(pageSearch("/b"));
      enableSelection();
      // Selected while both were on /b: the selection is /b's own.
      frameSelects("hero");
      await tick(0);
      expect(selectedInInspector()).toBe("hero");
      harness.holdLoads();
      report("/c");
      await tick(0);
      expect(shownRoute(harness)).toBe("/b");
      // The frame's own inline edit on /c, of the slot of the same id.
      frameCommitsText("hero", "Typed on C");
      await tick(400);
      expect(writtenTemplates()).toEqual([]);
      expect(toast.info).toHaveBeenCalledWith(
        PREVIEW_OTHER_PAGE_NOT_SAVED_MESSAGE,
        expect.anything(),
      );
    });

    it("an Inspector edit under a selection made on /b still writes /b's own document", async () => {
      const harness = await settled(pageSearch("/b"));
      enableSelection();
      frameSelects("hero");
      await tick(0);
      harness.holdLoads();
      report("/c");
      await tick(0);
      expect(shownRoute(harness)).toBe("/b");
      await editInInspector("Inspector on B");
      // The element the author picked on /b, in /b's document; never /c's.
      expect(writtenTemplates()).toEqual(["template-b"]);
    });

    it("a section reorder dragged on /c rewrites nothing of /b", async () => {
      await frameAheadOfEditor();
      fromPreview({
        type: "morph:storefront-preview-commit-section-reorder",
        draggedSectionId: "promo",
        targetSectionId: "hero",
      });
      await tick(400);
      expect(saveThemeFile).not.toHaveBeenCalled();
      expect(writtenTemplates()).toEqual([]);
    });
  });

  describe("editor on /c, frame still on /b", () => {
    it("an inline edit of /b's slot that /c shares writes nothing", async () => {
      await editorAheadOfFrame();
      frameSelects("hero");
      await tick(0);
      frameCommitsText("hero", "Typed on B");
      await tick(400);
      expect(writtenTemplates()).toEqual([]);
    });

    it("an Inspector edit of /b's slot that /c shares writes nothing", async () => {
      await editorAheadOfFrame();
      frameSelects("hero");
      await tick(0);
      await editInInspector("Inspector on B");
      expect(writtenTemplates()).toEqual([]);
    });

    it("takes the frame's selections and edits again once it answers from /c", async () => {
      await editorAheadOfFrame();
      frameSelects("hero");
      await tick(0);
      expect(selectedInInspector()).toBeNull();
      applied(latestRequest()?.routeRequestId, "/c");
      report("/c");
      await tick(0);
      frameSelects("hero");
      await tick(0);
      expect(selectedInInspector()).toBe("hero");
      frameCommitsText("hero", "Typed on C");
      await tick(400);
      expect(writtenTemplates()).toEqual(["template-c"]);
    });

    it("the Inspector's style and spacing controls are never handed /b's element", async () => {
      await editorAheadOfFrame();
      frameSelects("hero");
      await tick(0);
      expect(selectedInInspector()).toBeNull();
    });
  });
});

describe("every frame message that writes or moves the Inspector", () => {
  describe.each(Object.entries(WINDOWS))(
    "in the window: %s",
    (_window, open) => {
      it.each(Object.keys(ENTRIES))("%s is not taken", async (name) => {
        await open();
        const entry = ENTRIES[name]!;
        entry.send();
        await tick(400);
        expect(entry.wrote()).toBe(false);
        expect(writtenTemplates()).toEqual([]);
        expect(saveThemeFile).not.toHaveBeenCalled();
        expect(selectedInInspector()).toBeNull();
        expect(noticed()).toBe(entry.notice);
        // A Start Theme: the page is wrong or not known yet, never "unavailable".
        expect(
          vi
            .mocked(toast.info)
            .mock.calls.some(
              (call) => call[0] === CANVAS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE,
            ),
        ).toBe(false);
      });
    },
  );

  // Each guarded entry is reached when the frame shows the editor's page:
  // the refusals above are the guard's, not an entry that does nothing.
  it.each(Object.keys(ENTRIES))(
    "control: %s is taken while both show /b",
    async (name) => {
      await settled(pageSearch("/b"));
      enableSelection();
      // The inline commit needs the selection of the field it edits.
      if (name === "commit-inline-text") {
        frameSelects("hero");
        await tick(0);
      }
      const entry = ENTRIES[name]!;
      entry.send();
      await tick(400);
      expect(noticed()).toBe(false);
      if (
        name !== "commit-sibling-reorder" &&
        name !== "commit-array-item-reorder"
      ) {
        expect(entry.wrote()).toBe(true);
      }
    },
  );

  it("takes them again once the reloaded frame names the editor's page", async () => {
    await frameReloadedUnnamed();
    frameSelects("hero");
    await tick(0);
    expect(selectedInInspector()).toBeNull();
    report("/b");
    await tick(0);
    frameSelects("hero");
    await tick(0);
    expect(selectedInInspector()).toBe("hero");
  });

  it("does not take them from a reloaded frame whose boot report names another page", async () => {
    await frameReloadedUnnamed();
    report("/");
    await tick(0);
    frameSelects("hero");
    await tick(0);
    expect(selectedInInspector()).toBeNull();
    frameCommitsText("hero", "Typed on Home");
    await tick(400);
    expect(writtenTemplates()).toEqual([]);
  });

  it("does not take an answer of no router from a Theme whose source has one", async () => {
    renderRouted(pageSearch("/b"));
    await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    enableSelection();
    fromPreview({
      type: "morph:storefront-preview-ready",
      servedInstance: {
        kind: "known",
        instance: { session: SESSION, serial: 1 },
      },
    });
    await tick(0);
    applied(latestRequest()?.routeRequestId, null);
    await tick(0);
    frameSelects("hero");
    await tick(0);
    expect(selectedInInspector()).toBeNull();
    frameCommitsText("hero", "Typed");
    await tick(400);
    expect(writtenTemplates()).toEqual([]);
    expect(noticed()).toBe(true);
  });
});

/**
 * Undo and redo after a page switch. Both pages keep their own document, and
 * their slots share ids; an edit's history belongs to the document it wrote.
 *
 * The server is played in full here: every write answers with the document
 * it produced, and the editor's next read of the Theme returns it. Without
 * that the editor's copy never moves, and an undo has nothing to undo.
 */
describe("undo and redo after a page switch", () => {
  type Section = { id: string; type: string; props: Record<string, unknown> };
  type Template = {
    id: string;
    draftGeneration: number;
    document: { version: number; sections: Section[] };
  };
  function storedDocuments(harness: Harness) {
    let templates = (context.templates as unknown as Template[]).map(
      (template) => ({
        ...template,
        document: {
          ...template.document,
          sections: template.document.sections.map((section) => ({
            ...section,
            props: { ...section.props },
          })),
        },
      }),
    );
    const read = () =>
      ({ ...context, templates }) as unknown as StorefrontThemeEditorDTO;
    getThemeEditor.mockImplementation(async () => ({
      success: true,
      message: "ok",
      data: read(),
    }));
    updateSectionProps.mockImplementation(
      async (request: {
        data: {
          templateId: string;
          sectionId: string;
          props: Record<string, unknown>;
        };
      }) => {
        templates = templates.map((template) =>
          template.id !== request.data.templateId
            ? template
            : {
                ...template,
                draftGeneration: template.draftGeneration + 1,
                document: {
                  ...template.document,
                  sections: template.document.sections.map((section) =>
                    section.id === request.data.sectionId
                      ? {
                          ...section,
                          props: { ...section.props, ...request.data.props },
                        }
                      : section,
                  ),
                },
              },
        );
        const stored = templates.find(
          (template) => template.id === request.data.templateId,
        )!;
        // As the refetch after a write does.
        queueMicrotask(() => harness.setContext(read()));
        return {
          success: true,
          data: {
            draftGeneration: stored.draftGeneration,
            droppedProps: [],
            document: stored.document,
          },
        };
      },
    );
    return {
      heading: (templateId: string, sectionId = "hero") =>
        templates
          .find((template) => template.id === templateId)
          ?.document.sections.find((section) => section.id === sectionId)?.props
          .heading,
      /** Another value stored for /c's slot, so an undo onto it would show. */
      store(templateId: string, sectionId: string, heading: string) {
        templates = templates.map((template) =>
          template.id !== templateId
            ? template
            : {
                ...template,
                document: {
                  ...template.document,
                  sections: template.document.sections.map((section) =>
                    section.id === sectionId
                      ? { ...section, props: { heading } }
                      : section,
                  ),
                },
              },
        );
        act(() => harness.setContext(read()));
      },
    };
  }
  const undoButton = () => screen.getByRole("button", { name: "Undo" });
  const redoButton = () => screen.getByRole("button", { name: "Redo" });
  const enabled = (button: HTMLElement) => !button.hasAttribute("disabled");
  const shortcut = (direction: "undo" | "redo") =>
    fromPreview({
      type: "morph:storefront-preview-history-shortcut",
      direction,
    });
  const ENTRY_POINTS = {
    toolbar: (direction: "undo" | "redo") =>
      act(() => (direction === "undo" ? undoButton() : redoButton()).click()),
    "frame history-shortcut": shortcut,
  };

  /** Edits /b's slot and lets the write land: one entry on the stack. */
  async function editedOnB() {
    const harness = await settled(pageSearch("/b"));
    const server = storedDocuments(harness);
    server.store("template-c", "hero", "C heading");
    enableSelection();
    frameSelects("hero");
    await tick(0);
    frameCommitsText("hero", "Typed on B");
    await tick(400);
    expect(writtenTemplates()).toEqual(["template-b"]);
    await waitFor(() => expect(enabled(undoButton())).toBe(true));
    return { harness, server };
  }
  /** The page list's switch to /c, answered by the frame from /c. */
  async function switchToC() {
    const row = await screen.findByTitle("Preview /c");
    act(() => row.click());
    await tick(0);
    applied(latestRequest()?.routeRequestId, "/c");
    report("/c");
    await tick(0);
  }

  describe.each(Object.entries(ENTRY_POINTS))("from the %s", (_name, press) => {
    it("control: undo on the same page writes the value back to /b", async () => {
      const { server } = await editedOnB();
      press("undo");
      await tick(400);
      expect(writtenTemplates()).toEqual(["template-b", "template-b"]);
      expect(server.heading("template-b")).toBe(SAME);
      expect(server.heading("template-c")).toBe("C heading");
    });

    it("control: redo is not offered once the undo's own write landed", async () => {
      // Pinned as it is, on main too: a content undo is replayed as an edit
      // of its own, and recording it starts a new branch of the history.
      const { server } = await editedOnB();
      press("undo");
      await tick(400);
      expect(server.heading("template-b")).toBe(SAME);
      expect(enabled(redoButton())).toBe(false);
      const before = writtenTemplates().length;
      press("redo");
      await tick(400);
      expect(writtenTemplates().length).toBe(before);
    });

    it("redo on /c applies nothing of /b's history to /c", async () => {
      const { server } = await editedOnB();
      press("undo");
      await tick(400);
      await switchToC();
      const before = writtenTemplates().length;
      press("redo");
      await tick(400);
      expect(writtenTemplates().slice(before)).toEqual([]);
      expect(writtenTemplates()).not.toContain("template-c");
      expect(server.heading("template-c")).toBe("C heading");
      expect(saveThemeFile).not.toHaveBeenCalled();
    });

    it("undo on /c applies nothing of /b's history to /c", async () => {
      const { server } = await editedOnB();
      await switchToC();
      press("undo");
      await tick(400);
      expect(writtenTemplates()).toEqual(["template-b"]);
      expect(server.heading("template-c")).toBe("C heading");
      expect(server.heading("template-b")).toBe("Typed on B");
      expect(saveThemeFile).not.toHaveBeenCalled();
      // Refused, and said: the entry is kept for /b.
      expect(toast.error).toHaveBeenCalledWith(
        `Could not undo: ${HISTORY_OTHER_PAGE_MESSAGE}`,
      );
      expect(enabled(undoButton())).toBe(true);
    });

    it("keeps /b's history for /b: back on /b, undo writes /b again", async () => {
      const { server } = await editedOnB();
      await switchToC();
      press("undo");
      await tick(400);
      const row = await screen.findByTitle("Preview /b");
      act(() => row.click());
      await tick(0);
      applied(latestRequest()?.routeRequestId, "/b");
      report("/b");
      await tick(0);
      press("undo");
      await tick(400);
      expect(writtenTemplates()).toEqual(["template-b", "template-b"]);
      expect(server.heading("template-b")).toBe(SAME);
      expect(server.heading("template-c")).toBe("C heading");
    });
  });
});
