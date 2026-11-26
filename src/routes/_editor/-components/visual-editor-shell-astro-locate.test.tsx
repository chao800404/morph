import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  answerFramePings,
  frameEnvelope,
  modelCurrentBridge,
  reloadFrameDocument,
} from "@/lib/test-utils/preview-frame-handshake";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { listStorefrontThemeFiles } from "@/server/storefront/storefront-theme-files.serverFn";
import {
  applyThemePreviewFiles,
  confirmThemePreviewContent,
  probeThemePreviewAddress,
  startThemePreviewServer,
  touchThemePreviewServer,
} from "@/server/storefront/storefront-theme-preview-server.serverFn";
import { ASTRO_BASIS_UNCONFIRMED_MESSAGE } from "@/lib/storefront/editor/astro-basis-presentation";
import {
  ASTRO_SELECTION_RECHECK_TIMEOUT_MS,
  ASTRO_SELECTION_RECHECKING_MESSAGE,
} from "@/lib/storefront/editor/astro-design-focus";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import {
  CANVAS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE,
  SOURCE_LOCATION_STALE_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";
import { astroPreviewSourceHash } from "@/lib/storefront/theme-framework/astro-preview-locate";
import {
  SECTIONS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE,
} from "./editor-sections-panel";

/**
 * Astro L1.5a (docs/astro-theme-plan.md 3.6.2): on an Astro Theme the canvas
 * only locates. A click the preview reports with a source location opens
 * that place in Code, checked against the file the editor holds; it is never
 * a Design selection, and nothing is written. A location from another version
 * of the file opens nothing and says why.
 *
 * Harness copied from visual-editor-shell-design-element-resend.test.tsx;
 * only server functions and the preview transport are mocked.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";
const OWNER = { id: "user-1", name: "Owner", email: "owner@morph.test" };

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const saveThemeFile = vi.hoisted(() => vi.fn());
const getThemeFile = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const readRouteBindings = vi.hoisted(() => vi.fn());

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    getStorefrontThemeEditor: getThemeEditor,
    readThemeRouteBindings: readRouteBindings,
  }),
);
vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    listStorefrontThemeFiles: vi.fn(),
    saveStorefrontThemeFile: saveThemeFile,
    getStorefrontThemeFile: getThemeFile,
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
    // Called only by the basis-ack cases, which say what they answer.
    syncThemePreviewContent: vi.fn(),
    confirmThemePreviewContent: vi.fn(),
  }),
);
vi.mock(
  "@/server/storefront/storefront-preview-media.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    signThemePreviewMedia: vi.fn(),
  }),
);
vi.mock("@/server/auth/getSession", () => ({ getSession }));
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
// Code mode, as visual-editor-shell-source-conflict-retry.test.tsx mounts it:
// Monaco is a textarea; language services and formatting are inert.
vi.mock("@monaco-editor/react", () => ({
  default: ({
    defaultValue,
    onChange,
  }: {
    defaultValue?: string;
    onChange?: (value?: string) => void;
  }) => {
    const [value, setValue] = useState(defaultValue ?? "");
    return (
      <textarea
        aria-label="Code editor"
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value);
          onChange?.(event.currentTarget.value);
        }}
      />
    );
  },
}));
vi.mock("./editor-code-language-support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editor-code-language-support")>()),
  configureThemeTypeScript: vi.fn(),
  disposeThemeWorkspaceModels: vi.fn(),
  ensureThemeWorkspaceModels: vi.fn(),
  registerTailwindCompletionProvider: vi.fn(() => ({ dispose: vi.fn() })),
}));
vi.mock("./editor-code-formatter", () => ({
  formatEditorCode: vi.fn(async (content: string) => content),
}));

const sectionComponent = (name: string) => `export const contentFields = {
  title: { type: "text", label: "${name} title" },
} as const;

export default function ${name}({ title = "${name} default" }: { title?: string }) {
  return (
    <section>
      <h2>{title}</h2>
    </section>
  );
}
`;

// The OPEN fixture of visual-editor-shell-element-structure-guard.test.tsx.
// Line numbers matter: elements are named by `line:column` of their opening
// tag, as the preview does for unmarked elements.
const ROUTE_PATH = "/guard";
const ROUTE_FILE = "src/routes/guard.tsx";
const TEMPLATE_ID = "template-guard";
const SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import GuardHero from "../components/sections/GuardHero";
import GuardBanner from "../components/sections/GuardBanner";

export const Route = createFileRoute("/guard")({
  component: GuardRoute,
});

function GuardRoute() {
  return (
    <main>
      <div className="stack">
        <GuardHero {...content("hero")} />
        <GuardBanner {...content("banner")} />
      </div>
      <p className="note">Plain note</p>
      <small className="fine">Fine print</small>
    </main>
  );
}
`;
const ASTRO_PAGE = "src/pages/index.astro";
const ASTRO_SOURCE = `---
const title = "Astro home";
---
<main>
  <h1>{title}</h1>
  <p class="lead">Lead</p>
</main>
`;

const file = (path: string, content: string, version = 1) => ({
  id: `file-${path}`,
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path,
  content,
  mimeType: "text/typescript",
  isEntry: false,
  version,
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
});
const FILES = [
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
  ...livePreviewPlatformFiles().map((entry) =>
    file(entry.path, entry.content ?? ""),
  ),
  file(
    "src/routes/index.tsx",
    'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/")({ component: () => <main /> });\n',
  ),
  file("src/components/sections/GuardHero.tsx", sectionComponent("GuardHero")),
  file(
    "src/components/sections/GuardBanner.tsx",
    sectionComponent("GuardBanner"),
  ),
  file(ROUTE_FILE, SOURCE),
  file(ASTRO_PAGE, ASTRO_SOURCE),
  // The Astro section component and its `.fields.ts` declaration (M2 PR 3):
  // the Inspector's field types and labels come from the declaration only.
  file(
    "src/components/Hero.astro",
    "---\nconst { title, subtitle } = Astro.props;\n---\n<section><h1>{title}</h1><p>{subtitle}</p></section>\n",
  ),
  file(
    "src/components/Hero.fields.ts",
    'export const contentFields = {\n  title: { type: "text", label: "Hero title" },\n  subtitle: { type: "textarea", label: "Hero subtitle" },\n} as const;\n',
  ),
];
const treeAt = (sourceGeneration: number) => ({
  files: FILES,
  tree: [
    {
      name: "src",
      path: "src",
      isDirectory: true,
      children: FILES.filter((entry) => entry.path.startsWith("src/")).map(
        (entry) => ({
          name: entry.path.split("/").pop()!,
          path: entry.path,
          isDirectory: false,
        }),
      ),
    },
  ],
  sourceGeneration,
  latestPublishedRevision: null,
});

const context = {
  previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
  storefront: {
    id: "storefront-1",
    name: "Store",
    domain: null,
    status: "active",
  },
  theme: {
    id: "theme-1",
    name: "Theme",
    sourceGeneration: 3,
    framework: "astro",
  },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      document: { version: 1, sections: [] },
      draftGeneration: 1,
      version: 1,
    },
    {
      id: TEMPLATE_ID,
      type: "page",
      name: ROUTE_PATH,
      routePath: ROUTE_PATH,
      document: { version: 1, sections: [] },
      draftRevisionId: null,
      publishedRevisionId: null,
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

type Posted = { type: string; routeRequestId?: number };
let log: Posted[] = [];

const currentWindow = () =>
  document.querySelector("iframe")?.contentWindow ?? null;
function fromPreview(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: frameEnvelope({ ...data, previewSession: PREVIEW_SESSION }),
        origin: PREVIEW_ORIGIN,
        source: currentWindow(),
      }),
    );
  });
  answerFramePings({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
}
/** Lets queued effects and messages run; not a wait for anything to finish. */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** The editor moved to another of its pages (search changed), as the router does. */
let showEditorPage: (page: {
  template: "index" | "page";
  templateId: string;
  routePath: string;
}) => void = () => {
  throw new Error("settled() has not rendered the shell");
};

/** Renders the route's page, signed in as OWNER, and brings the frame up. */
async function settled(
  themeContext: StorefrontThemeEditorDTO = context,
  page: {
    template: "index" | "page";
    templateId: string;
    routePath: string;
  } = { template: "page", templateId: TEMPLATE_ID, routePath: ROUTE_PATH },
  capabilities?: string[],
  /** Basis-ack cases only: more start data, and the ready's stamp. */
  extra: {
    serverData?: Record<string, unknown>;
    servedContent?: { ticket: number; instance: string };
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: {
        url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
        ...extra.serverData,
      },
    } as never,
  );
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    treeAt(3) as never,
  );
  const onSearchChange = vi.fn();
  const shellOn = (shown: typeof page) => (
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={themeContext}
        search={
          {
            template: shown.template,
            templateId: shown.templateId,
            routePath: shown.routePath,
            viewport: "desktop",
          } as StorefrontThemeEditorSearch
        }
        onSearchChange={onSearchChange}
        navigatingRoutePath={shown.routePath}
        currentUser={OWNER}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(shellOn(page));
  showEditorPage = (next) => rerender(shellOn(next));
  await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  fromPreview({
    type: "morph:storefront-preview-ready",
    servedInstance: {
      kind: "known",
      instance: { session: SESSION, serial: 1 },
    },
    ...(capabilities ? { capabilities } : {}),
    ...(extra.servedContent ? { servedContent: extra.servedContent } : {}),
  });
  await flush();
  const request = log
    .filter((message) => message.type === "morph:storefront-preview-set-route")
    .at(-1);
  fromPreview({
    type: "morph:storefront-preview-route-applied",
    routeRequestId: request?.routeRequestId,
    routePath: page.routePath,
  });
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes: [],
    routePath: page.routePath,
  });
  await flush();
  // For a case that changes what Core answered after the page came up.
  return client;
}

const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
const stored = (content = SOURCE) => ({
  success: true,
  message: "Theme file loaded",
  data: file(ROUTE_FILE, content, 1),
});

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
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(3, scope);
  useEditorWriteGateStore.setState({ gates: {} });
  getThemeEditor.mockReset();
  getThemeEditor.mockResolvedValue({
    success: true,
    message: "ok",
    data: context,
  });
  getSession.mockReset();
  getSession.mockResolvedValue({ user: { id: OWNER.id } });
  getThemeFile.mockReset();
  getThemeFile.mockResolvedValue(stored());
  updateSectionProps.mockReset();
  readRouteBindings.mockReset();
  readRouteBindings.mockResolvedValue({
    success: false,
    message: "not read in this test",
    error: "ROUTE_BINDINGS_UNAVAILABLE",
  });
  saveThemeFile.mockReset();
  saveThemeFile.mockImplementation(
    async (request: { data: { path: string; content: string } }) => ({
      success: true,
      message: "saved",
      data: {
        ...file(request.data.path, request.data.content, 2),
        sourceGeneration: 5,
      },
    }),
  );
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
    async () => ({ success: true, message: "ok", data: treeAt(3) }) as never,
  );
  vi.mocked(startThemePreviewServer).mockReset();
  vi.mocked(startThemePreviewServer).mockResolvedValue({
    success: true,
    message: "Live Preview server ready",
    data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
  } as never);
  vi.mocked(touchThemePreviewServer).mockReset();
  vi.mocked(touchThemePreviewServer).mockResolvedValue({
    success: true,
    message: "Live Preview server checked",
    data: {
      previewId: "preview-1",
      serving: true,
      servedInstance: { session: SESSION, serial: 1 },
    },
  } as never);
  vi.mocked(applyThemePreviewFiles).mockReset();
  vi.mocked(applyThemePreviewFiles).mockImplementation(
    async (request: unknown) =>
      ({
        success: true,
        message: "Live Preview files written",
        data: {
          previewId: "preview-1",
          changed: [],
          unchanged: (
            request as { data: { files: Array<{ path: string }> } }
          ).data.files.map((entry) => entry.path),
          skipped: [],
          servedInstance: { session: SESSION, serial: 1 },
        },
      }) as never,
  );
  vi.mocked(probeThemePreviewAddress).mockReset();
  vi.mocked(probeThemePreviewAddress).mockResolvedValue({
    success: true,
    message: "ok",
    data: { state: "unknown" },
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

/** What the preview's bridge reports for a click on a located element. */
function locatedClick(
  selectionRevision: number,
  location: string,
  sourceVersion: string,
  tagName: string,
) {
  fromPreview({
    type: "morph:storefront-preview-select-section",
    sectionId: `source:${ASTRO_PAGE}`,
    componentType: tagName,
    kind: "heading",
    sourceFilePath: ASTRO_PAGE,
    sourceLocation: location,
    sourceVersion,
    previewBoundary: null,
    locatedAt: null,
    elementKey: null,
    fieldKey: null,
    field: null,
    fieldPath: null,
    descendantFields: [],
    tagName,
    role: null,
    inputType: null,
    styleRevision: 0,
    className: "",
    isSection: false,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
    documentRect: null,
    selectionRevision,
  });
}

describe("an Astro canvas click only locates (L1.5a)", () => {
  it("opens the clicked element's source in Code, at its line, and writes nothing", async () => {
    await settled();

    locatedClick(
      1,
      `${ASTRO_PAGE}:5:3`,
      astroPreviewSourceHash(ASTRO_SOURCE),
      "h1",
    );

    const editor = await screen.findByRole(
      "textbox",
      { name: "Code editor" },
      { timeout: 15_000 },
    );
    expect((editor as HTMLTextAreaElement).value).toBe(ASTRO_SOURCE);
    expect(saveThemeFile).not.toHaveBeenCalled();
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(vi.mocked(toast.info)).not.toHaveBeenCalledWith(
      CANVAS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE,
      expect.anything(),
    );
  });

  it("a location from another version of the file opens nothing, and says why", async () => {
    await settled();

    locatedClick(1, `${ASTRO_PAGE}:5:3`, "00000000", "h1");
    await flush();

    expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
      SOURCE_LOCATION_STALE_MESSAGE,
      expect.anything(),
    );
    expect(screen.queryByRole("textbox", { name: "Code editor" })).toBeNull();
    expect(saveThemeFile).not.toHaveBeenCalled();
  });

  it("a location that is not the clicked element opens nothing", async () => {
    await settled();

    // Line 6 starts a <p>, not the reported <h1>.
    locatedClick(
      1,
      `${ASTRO_PAGE}:6:3`,
      astroPreviewSourceHash(ASTRO_SOURCE),
      "h1",
    );
    await flush();

    expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
      SOURCE_LOCATION_STALE_MESSAGE,
      expect.anything(),
    );
    expect(screen.queryByRole("textbox", { name: "Code editor" })).toBeNull();
  });
});

describe("Start-only page and section structure stays off on an Astro Theme", () => {
  /** The same workspace, recorded as TanStack Start (NULL). */
  const startContext = {
    ...context,
    theme: { ...context.theme, framework: null },
  } as unknown as StorefrontThemeEditorDTO;
  const panel = () =>
    screen.getByRole("heading", { name: "Pages & Sections" }).closest("aside")!;

  it("shows the unavailable state, and offers no Add/Delete page or Add section", async () => {
    await settled();

    const sections = within(panel());
    expect(
      await sections.findByText(SECTIONS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE),
    ).toBeTruthy();
    expect(sections.queryByRole("button", { name: "Add page" })).toBeNull();
    expect(
      sections.queryByRole("button", { name: /^Delete page / }),
    ).toBeNull();
    expect(sections.queryByRole("button", { name: "Add section" })).toBeNull();
    expect(sections.queryByText("Sections needing binding")).toBeNull();
    expect(sections.queryByRole("button", { name: /^Bind / })).toBeNull();
  });

  it("on TanStack Start the same workspace still offers them", async () => {
    getThemeEditor.mockResolvedValue({
      success: true,
      message: "ok",
      data: startContext,
    });
    await settled(startContext);

    const sections = within(panel());
    expect(
      await sections.findByRole("button", { name: "Add page" }),
    ).toBeTruthy();
    expect(
      sections.getByRole("button", { name: `Delete page ${ROUTE_PATH}` }),
    ).toBeTruthy();
    expect(sections.getByRole("button", { name: "Add section" })).toBeTruthy();
    expect(
      sections.queryByText(SECTIONS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE),
    ).toBeNull();
  });
});

describe("an Astro click is checked against Core's binding view (M2 PR-F)", () => {
  const NONCE = "0123456789abcdef";
  const SRC = "a".repeat(64);
  const DIGEST = "c".repeat(64);
  const MARKER = `${NONCE}:2:${SRC}:30:60`;
  const HOME = { template: "index" as const, templateId: "template-1", routePath: "/" };
  const V2_READY = ["astro-identity-v2", "section-presentation-ack-v1"];

  const bindingView = (overrides: Record<string, unknown> = {}) => ({
    success: true,
    message: "Route bindings read",
    data: {
      routePath: "/",
      routeFile: ASTRO_PAGE,
      sourceGeneration: 3,
      routeSourceDigest: SRC,
      boundaryRule: 2,
      status: { kind: "confirmed" },
      instances: [
        {
          identity: { rule: 2, src: SRC, start: 30, end: 60 },
          componentDigest: DIGEST,
          componentPath: "src/components/Hero.astro",
          componentName: "Hero",
          section: "hero",
          componentRef: "src/components/Hero.astro#default",
          sectionType: "hero",
          declaredFields: ["title"],
          claims: [{ slot: "hero", field: "title" }],
        },
      ],
      ...overrides,
    },
  });

  /** A located click on the page's <h1> that names a v2 boundary instance. */
  function boundaryClick(
    selectionRevision: number,
    sourceDigest = DIGEST,
    /** The file version the frame located in; another one is stale. */
    sourceVersion = astroPreviewSourceHash(ASTRO_SOURCE),
  ) {
    fromPreview({
      type: "morph:storefront-preview-select-section",
      sectionId: `source:${ASTRO_PAGE}`,
      componentType: "h1",
      kind: "heading",
      sourceFilePath: ASTRO_PAGE,
      sourceLocation: `${ASTRO_PAGE}:5:3`,
      sourceVersion,
      previewBoundary: { marker: MARKER, selectable: true, reason: null },
      sourceDigest,
      locatedAt: null,
      elementKey: null,
      fieldKey: null,
      field: null,
      fieldPath: null,
      descendantFields: [],
      tagName: "h1",
      role: null,
      inputType: null,
      styleRevision: 0,
      className: "",
      isSection: false,
      inspectorOverride: null,
      computedStyle: null,
      parentComputedStyle: null,
      sectionComputedStyle: null,
      documentRect: null,
      selectionRevision,
    });
  }

  const hinted = (pattern: RegExp) =>
    vi
      .mocked(toast.info)
      .mock.calls.some(
        ([text, options]) =>
          typeof text === "string" &&
          pattern.test(text) &&
          (options as { id?: string } | undefined)?.id ===
            "astro-design-status",
      );

  it("reads the view for the page and the workspace's source generation", async () => {
    readRouteBindings.mockResolvedValue(bindingView());
    await settled(context, HOME, V2_READY);

    await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
    expect(readRouteBindings.mock.calls[0]![0]).toEqual({
      data: {
        storefrontId: "storefront-1",
        themeId: "theme-1",
        routePath: "/",
        expectedSourceGeneration: 3,
      },
    });
  });

  // M2 PR 3 (D2): on a frame without the basis path (no astro-basis-ack-v1,
  // an older preview) a confirmed click cannot be presented as a write
  // basis, so it still only locates, as L1.5a did. The Design selection of
  // a basis frame is "the basis acknowledgement" › "D2" below.
  it("on a frame without the basis path, a click on an instance Core confirmed still only locates, writes nothing, and says nothing more", async () => {
    readRouteBindings.mockResolvedValue(bindingView());
    await settled(context, HOME, V2_READY);
    await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
    await flush();

    boundaryClick(1);
    expect(
      await screen.findByRole(
        "textbox",
        { name: "Code editor" },
        { timeout: 15_000 },
      ),
    ).toBeTruthy();
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(hinted(/./)).toBe(false);
  });

  it("a frame digest other than Core's asks for a preview reload (class A)", async () => {
    readRouteBindings.mockResolvedValue(bindingView());
    await settled(context, HOME, V2_READY);
    await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
    await flush();

    boundaryClick(1, "e".repeat(64));
    await flush();

    expect(hinted(/Reload the preview/)).toBe(true);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("a view refused for a missing parser binding says this environment has none", async () => {
    readRouteBindings.mockResolvedValue(
      bindingView({
        status: {
          kind: "refused",
          class: "temporarily-unconfirmable",
          reason: "parser-binding-missing",
          detail: "the .astro parser could not confirm this file",
        },
        instances: [],
      }),
    );
    await settled(context, HOME, V2_READY);
    await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
    await flush();

    boundaryClick(1);
    await flush();

    expect(hinted(/no \.astro analysis service/)).toBe(true);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("a frame older than the v2 identity asks for a reload", async () => {
    readRouteBindings.mockResolvedValue(bindingView());
    await settled(context, HOME);
    await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
    await flush();

    boundaryClick(1);
    await flush();

    expect(hinted(/Reload the preview/)).toBe(true);
  });

  it("a new document re-reads the view", async () => {
    // Each document names itself, so a reload is a new document's ready.
    modelCurrentBridge();
    readRouteBindings.mockResolvedValue(bindingView());
    await settled(context, HOME, V2_READY);
    await waitFor(() => expect(readRouteBindings).toHaveBeenCalledTimes(1));
    await flush();

    reloadFrameDocument();
    fromPreview({
      type: "morph:storefront-preview-ready",
      servedInstance: {
        kind: "known",
        instance: { session: SESSION, serial: 1 },
      },
      capabilities: V2_READY,
    });
    await waitFor(() => expect(readRouteBindings).toHaveBeenCalledTimes(2));
  });

  it("a TanStack Start Theme never reads a binding view", async () => {
    const startContext = {
      ...context,
      theme: { ...context.theme, framework: null },
    } as unknown as StorefrontThemeEditorDTO;
    getThemeEditor.mockResolvedValue({
      success: true,
      message: "ok",
      data: startContext,
    });
    await settled(startContext, HOME, V2_READY);
    await flush();

    expect(readRouteBindings).not.toHaveBeenCalled();
    // Nor shows any Astro Design status (Q2).
    expect(document.querySelector("[data-astro-design-notice]")).toBeNull();
    expect(document.querySelector("[data-astro-section-status]")).toBeNull();
    expect(document.querySelector("[data-astro-design-status-bar]")).toBeNull();
  });

  /**
   * Option B (handoff/2026-11-24/astro-presentation-ack-options.md): on a
   * frame that names astro-basis-ack-v1 and is refreshed by reload, a
   * confirmed click asks the document to acknowledge its basis — the
   * boundary, in the snapshot Core wrote and confirmed — at Core's draft
   * generation. Nothing is written.
   */
  describe("the basis acknowledgement", () => {
    const INSTANCE = "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11";
    const BASIS_READY = [...V2_READY, "astro-basis-ack-v1"];
    const START_DATA = {
      contentRefresh: "reload",
      contentTicket: 7,
      draftGenerations: { "template-1": 4 },
    };
    const basisPosts = () =>
      log.filter(
        (message) =>
          message.type === "morph:storefront-preview-confirm-section-basis",
      ) as unknown as Array<{
        type: string;
        presentationToken: Record<string, unknown> & { operationId: string };
      }>;
    const consoleSaid = (pattern: RegExp) =>
      [
        ...vi.mocked(console.info).mock.calls,
        ...vi.mocked(console.warn).mock.calls,
      ].some((call) => call.some((part) => typeof part === "string" && pattern.test(part)));
    /** The intake took an `applied` answer for `op` (its trace line). */
    const acceptedLine = (op: string) =>
      consoleSaid(new RegExp(` ack accepted op=${op} .*status=applied`));
    /**
     * The hint moved out of a toast (lead decision Q2): it is said at the top
     * of the Inspector and as a badge on the section's row. A toast with this
     * text is the old surface, which no case may see any more.
     */
    const toastedBasisHint = () =>
      vi
        .mocked(toast.info)
        .mock.calls.some(([text]) => text === ASTRO_BASIS_UNCONFIRMED_MESSAGE);
    const inspectorPanel = () =>
      document.querySelector<HTMLElement>("[data-editor-inspector-panel]")!;
    /** The Inspector's Content tab, whose top holds the Astro notice. */
    const openInspectorContent = () =>
      fireEvent.click(
        within(inspectorPanel()).getByRole("button", {
          name: "Content",
          hidden: true,
        }),
      );
    const inspectorNotice = () => {
      openInspectorContent();
      return inspectorPanel().querySelector("[data-astro-design-notice]");
    };
    const sectionStatus = () =>
      document.querySelector("[data-astro-section-status]");
    /** The basis hint, on the selected section, in both places (Q2). */
    const unconfirmedHint = () => {
      const notice = inspectorNotice();
      const row = sectionStatus();
      return (
        notice?.getAttribute("data-astro-design-notice") === "unconfirmed" &&
        (notice.textContent ?? "").includes(ASTRO_BASIS_UNCONFIRMED_MESSAGE) &&
        row?.getAttribute("data-astro-section-status") === "unconfirmed" &&
        (row.textContent ?? "").includes("Reload preview")
      );
    };
    /** One instance of Core's view; `bindingView` overrides whole arrays. */
    const heroInstance = (overrides: Record<string, unknown> = {}) => ({
      identity: { rule: 2, src: SRC, start: 30, end: 60 },
      componentDigest: DIGEST,
      componentPath: "src/components/Hero.astro",
      componentName: "Hero",
      section: "hero",
      componentRef: "src/components/Hero.astro#default",
      sectionType: "hero",
      declaredFields: ["title"],
      claims: [{ slot: "hero", field: "title" }],
      ...overrides,
    });
    afterEach(() => {
      // Every case: the hint is never a toast any more.
      expect(toastedBasisHint()).toBe(false);
    });

    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(startThemePreviewServer).mockResolvedValue({
        success: true,
        message: "Live Preview server ready",
        data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`, ...START_DATA },
      } as never);
      vi.mocked(confirmThemePreviewContent).mockReset();
      vi.mocked(confirmThemePreviewContent).mockResolvedValue({
        success: true,
        message: "Live Preview content confirmed",
        data: { ticket: 7, instance: INSTANCE },
      } as never);
    });

    it("asks Core once which instance reads the start's snapshot, then posts a basis token for a confirmed click", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledWith({
          data: { storefrontId: "storefront-1", themeId: "theme-1", ticket: 7 },
        }),
      );
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
      await flush();

      boundaryClick(1);
      await flush();

      const posts = basisPosts();
      expect(posts).toHaveLength(1);
      expect(posts[0]!.presentationToken).toMatchObject({
        templateId: "template-1",
        routePath: "/",
        sectionId: "hero",
        documentBasis: { kind: "existing", draftGeneration: 4 },
        overlayRevision: 0,
        basis: {
          kind: "astro-boundary",
          identity: MARKER,
          servedContent: { ticket: 7, instance: INSTANCE },
        },
      });
      expect(updateSectionProps).not.toHaveBeenCalled();

      // The frame acknowledges it; the editor takes it. Said positively:
      // an answer refused by any ordinary guard (unverified document, no
      // pending token, token mismatch, not latest), or never reaching the
      // intake, has no accepted line (review finding 5).
      const op = posts[0]!.presentationToken.operationId;
      expect(acceptedLine(op)).toBe(false);
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: op,
        token: posts[0]!.presentationToken,
        status: "applied",
      });
      await flush();
      expect(acceptedLine(op)).toBe(true);
      expect(consoleSaid(new RegExp(` ack rejected op=${op} `))).toBe(false);
      expect(consoleSaid(/basis ack held/)).toBe(false);
      expect(consoleSaid(/guard=basis-unconfirmed/)).toBe(false);
      expect(unconfirmedHint()).toBe(false);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    it("holds the ack when Core's basis moved between the token and its answer", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      const client = await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalled(),
      );
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
      await flush();

      boundaryClick(1);
      await flush();
      const posts = basisPosts();
      expect(posts).toHaveLength(1);
      const op = posts[0]!.presentationToken.operationId;

      // Core answers that it wrote a newer snapshot (ticket 8) for this
      // editor before the frame's answer arrives: the document the token
      // names is now older than Core's latest.
      act(() => {
        client.setQueryData(
          themePreviewServerQueries.forTheme("storefront-1", "theme-1")
            .queryKey,
          {
            success: true,
            message: "Live Preview server ready",
            data: {
              url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
              ...START_DATA,
              contentTicket: 8,
              draftGenerations: { "template-1": 5 },
            },
          } as never,
        );
      });
      await flush();

      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: op,
        token: posts[0]!.presentationToken,
        status: "applied",
      });
      await flush();

      expect(
        consoleSaid(new RegExp(`basis ack held op=${op} reason=other-ticket`)),
      ).toBe(true);
      expect(consoleSaid(/guard=basis-unconfirmed/)).toBe(true);
      expect(acceptedLine(op)).toBe(false);
      expect(unconfirmedHint()).toBe(true);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    it("a document naming another snapshot than Core's latest gets no token, and says reload", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        // Rendered before the start's snapshot was read (ticket 6 < 7).
        servedContent: { ticket: 6, instance: INSTANCE },
      });
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
      await flush();
      expect(vi.mocked(confirmThemePreviewContent)).not.toHaveBeenCalled();

      boundaryClick(1);
      await flush();

      expect(basisPosts()).toHaveLength(0);
      expect(unconfirmedHint()).toBe(true);
    });

    it("a page whose stamp names another instance than Core confirmed gets no token", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      // Core names another instance than the page's stamp.
      vi.mocked(confirmThemePreviewContent).mockResolvedValue({
        success: true,
        message: "Live Preview content confirmed",
        data: { ticket: 7, instance: "11111111-2222-3333-4444-555555555555" },
      } as never);
      await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalled(),
      );
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
      await flush();

      boundaryClick(1);
      await flush();

      expect(basisPosts()).toHaveLength(0);
      expect(unconfirmedHint()).toBe(true);
    });

    /** A new document of the same frame (a reload), stamped `servedContent`. */
    const reloadWith = async (
      servedContent: {
        ticket: number;
        instance: string;
      },
      /** The page the new document shows; another one after a followed link. */
      framePath = "/",
    ) => {
      reloadFrameDocument();
      fromPreview({
        type: "morph:storefront-preview-ready",
        servedInstance: {
          kind: "known",
          instance: { session: SESSION, serial: 1 },
        },
        capabilities: BASIS_READY,
        servedContent,
      });
      await flush();
      const request = log
        .filter(
          (message) => message.type === "morph:storefront-preview-set-route",
        )
        .at(-1);
      fromPreview({
        type: "morph:storefront-preview-route-applied",
        routeRequestId: request?.routeRequestId,
        routePath: framePath,
      });
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: framePath,
      });
      await flush();
    };
    const RESTARTED = "22222222-3333-4444-5555-666666666666";
    const confirmedBy = (instance: string) =>
      ({
        success: true,
        message: "Live Preview content confirmed",
        data: { ticket: 7, instance },
      }) as never;

    // Review finding 2: the dev server restarted and stamped a new instance
    // into the same snapshot; the reloaded page names it with Core's ticket.
    it("a reloaded page naming Core's ticket from a restarted dev server is asked about once more, then gets its token", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      vi.mocked(confirmThemePreviewContent)
        .mockResolvedValueOnce(confirmedBy(INSTANCE))
        .mockResolvedValueOnce(confirmedBy(RESTARTED));
      await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(1),
      );
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalledTimes(1));
      await flush();

      await reloadWith({ ticket: 7, instance: RESTARTED });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(2),
      );
      expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenLastCalledWith({
        data: { storefrontId: "storefront-1", themeId: "theme-1", ticket: 7 },
      });
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalledTimes(2));
      await flush();

      boundaryClick(1);
      await flush();

      const posts = basisPosts();
      expect(posts).toHaveLength(1);
      expect(posts[0]!.presentationToken).toMatchObject({
        basis: { servedContent: { ticket: 7, instance: RESTARTED } },
      });
      expect(unconfirmedHint()).toBe(false);
    });

    it("asks once per ticket and page instance: a page Core still does not confirm is not asked about again", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      // Core keeps naming the instance from before the restart.
      vi.mocked(confirmThemePreviewContent).mockResolvedValue(
        confirmedBy(INSTANCE),
      );
      await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(1),
      );
      await flush();

      await reloadWith({ ticket: 7, instance: RESTARTED });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(2),
      );
      await flush();
      await reloadWith({ ticket: 7, instance: RESTARTED });
      await flush();
      expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(2);

      // Still refused: the page's instance is not the one Core named.
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalledTimes(3));
      await flush();
      boundaryClick(1);
      await flush();
      expect(basisPosts()).toHaveLength(0);
      expect(unconfirmedHint()).toBe(true);
    });

    /** Core's answer to the ready-time confirm waits for `answer()`. */
    const confirmHeldUntilAnswered = () => {
      const held = { answer: (_value: unknown) => {} };
      vi.mocked(confirmThemePreviewContent).mockImplementation(
        () =>
          new Promise((resolve) => {
            held.answer = resolve;
          }) as never,
      );
      return held;
    };

    // Review finding 2: the click comes while the ready-time confirm is in
    // flight, so its token is refused for want of Core's answer. The hint
    // must not outlive that answer.
    it("a click refused while Core's confirm is in flight is asked about again on Core's answer", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      const confirm = confirmHeldUntilAnswered();
      await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(1),
      );
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
      await flush();

      // Core has not said yet which instance reads the start's snapshot.
      boundaryClick(1);
      await flush();
      expect(basisPosts()).toHaveLength(0);
      expect(unconfirmedHint()).toBe(true);

      await act(async () => {
        confirm.answer(confirmedBy(INSTANCE));
      });
      await waitFor(() => expect(basisPosts()).toHaveLength(1));
      expect(basisPosts()[0]!.presentationToken).toMatchObject({
        sectionId: "hero",
        basis: {
          kind: "astro-boundary",
          identity: MARKER,
          servedContent: { ticket: 7, instance: INSTANCE },
        },
      });
      expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(1);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    // Review finding 2, second case: the page reloads with the same stamp
    // before Core answers. The (ticket, instance) was already asked, so the
    // new document asks nothing; it waits for that same answer instead of
    // being refused before it.
    it("a reload while that confirm is still unanswered waits for it, then asks for the basis", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      const confirm = confirmHeldUntilAnswered();
      await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(1),
      );
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalledTimes(1));
      await flush();
      boundaryClick(1);
      await flush();
      expect(basisPosts()).toHaveLength(0);

      await reloadWith({ ticket: 7, instance: INSTANCE });
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalledTimes(2));
      await flush();
      expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(1);
      expect(sectionStatus()?.getAttribute("data-astro-section-status")).toBe(
        "checking",
      );
      expect(basisPosts()).toHaveLength(0);

      await act(async () => {
        confirm.answer(confirmedBy(INSTANCE));
      });
      await waitFor(() => expect(basisPosts()).toHaveLength(1));
      expect(basisPosts()[0]!.presentationToken).toMatchObject({
        sectionId: "hero",
        basis: { servedContent: { ticket: 7, instance: INSTANCE } },
      });
      expect(unconfirmedHint()).toBe(false);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    it("a frame without the basis capability (every Start frame) is never sent one", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      await settled(context, HOME, V2_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
      await flush();

      boundaryClick(1);
      await flush();

      expect(vi.mocked(confirmThemePreviewContent)).not.toHaveBeenCalled();
      expect(basisPosts()).toHaveLength(0);
      expect(unconfirmedHint()).toBe(false);
      expect(inspectorNotice()).toBeNull();
      expect(sectionStatus()).toBeNull();
    });

    /** Comes up on the start's confirmed snapshot; clicks the hero once. */
    const selectHero = async (
      themeContext: StorefrontThemeEditorDTO = context,
    ) => {
      modelCurrentBridge();
      await settled(themeContext, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalled(),
      );
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
      await flush();
      boundaryClick(1);
      await flush();
      const posts = basisPosts();
      expect(posts).toHaveLength(1);
      return posts[0]!.presentationToken;
    };

    // Review finding 8 ("silent not-applied"): the frame answering that it
    // does not hold the boundary is said like every other unconfirmed basis.
    it("a not-applied basis answer is said on the section, not left silent", async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      expect(unconfirmedHint()).toBe(false);

      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "not-applied",
        reason: "section-missing",
      });
      await flush();

      expect(unconfirmedHint()).toBe(true);
      expect(sectionStatus()?.textContent).toContain("hero");
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    // Review finding 8: the hint must be cleared by the frame's accepted
    // `applied` itself (`basis-acknowledged`), not by a new click, which
    // resets the hint on its own. Reachable without a click: the token
    // issued again on Core's confirm answer (finding 2) is posted while the
    // section still says it can't be edited, and only its `applied` may
    // clear that.
    it("the accepted applied answer to a token issued again on Core's answer is what clears the hint", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      const confirm = confirmHeldUntilAnswered();
      await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() =>
        expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalledTimes(1),
      );
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
      await flush();
      boundaryClick(1);
      await flush();
      expect(unconfirmedHint()).toBe(true);

      await act(async () => {
        confirm.answer(confirmedBy(INSTANCE));
      });
      await waitFor(() => expect(basisPosts()).toHaveLength(1));
      // Posted, not yet acknowledged: still said, and no click follows.
      expect(unconfirmedHint()).toBe(true);
      const token = basisPosts()[0]!.presentationToken;

      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "applied",
      });
      await flush();

      expect(acceptedLine(token.operationId)).toBe(true);
      expect(unconfirmedHint()).toBe(false);
      expect(inspectorNotice()).toBeNull();
      expect(sectionStatus()).toBeNull();
    });

    // Owner decision D2 (2026-11-26), M2 PR 3: in Design, a click on a
    // section Core confirmed selects it and opens the Inspector, as on
    // TanStack Start. It no longer jumps to Code; "open in Code" is an
    // explicit action. Nothing is written by the click itself.
    it("D2: a confirmed click in Design selects the section and opens its declared field in the Inspector, not Code", async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "applied",
      });
      await flush();

      expect(screen.queryByRole("textbox", { name: "Code editor" })).toBeNull();
      openInspectorContent();
      const field = await within(inspectorPanel()).findByRole(
        "textbox",
        { name: /title/i },
        { timeout: 15_000 },
      );
      expect(field).toBeTruthy();
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    /** The frame answers `applied` for `token`. */
    const ackBasis = async (token: { operationId: string }) => {
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "applied",
      });
      await flush();
    };
    const astroContent = () =>
      inspectorPanel().querySelector<HTMLElement>(
        "[data-astro-inspector-content]",
      );
    const heroTitleField = async () => {
      openInspectorContent();
      return (await within(inspectorPanel()).findByRole(
        "textbox",
        { name: "Hero title" },
        { timeout: 15_000 },
      )) as HTMLInputElement;
    };
    const switchToCode = () =>
      fireEvent.click(
        within(document.querySelector("header")!).getByRole("button", {
          name: "Code",
        }),
      );

    it("D2: in Code mode a confirmed click still locates its source (L1.5a), and asks for its basis", async () => {
      modelCurrentBridge();
      readRouteBindings.mockResolvedValue(bindingView());
      await settled(context, HOME, BASIS_READY, {
        serverData: START_DATA,
        servedContent: { ticket: 7, instance: INSTANCE },
      });
      await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
      await flush();
      switchToCode();
      await flush();

      boundaryClick(1);
      const editor = await screen.findByRole(
        "textbox",
        { name: "Code editor" },
        { timeout: 15_000 },
      );
      expect((editor as HTMLTextAreaElement).value).toBe(ASTRO_SOURCE);
      await waitFor(() => expect(basisPosts()).toHaveLength(1));
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    it("D2: the selection opens the Inspector on its Content tab", async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      await selectHero();

      const contentTab = within(inspectorPanel()).getByRole("button", {
        name: "Content",
        hidden: true,
      });
      await waitFor(() =>
        expect(contentTab.getAttribute("aria-pressed")).toBe("true"),
      );
      expect(astroContent()).not.toBeNull();
    });

    it("D2: Open in Code is an explicit action of the selected section", async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      await ackBasis(token);
      openInspectorContent();
      expect(screen.queryByRole("textbox", { name: "Code editor" })).toBeNull();

      fireEvent.click(
        within(astroContent()!).getByRole("button", { name: "Open in Code" }),
      );

      const editor = await screen.findByRole(
        "textbox",
        { name: "Code editor" },
        { timeout: 15_000 },
      );
      expect((editor as HTMLTextAreaElement).value).toBe(ASTRO_SOURCE);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    it("D2: a declared field Core does not prove, or a proven one .fields.ts does not declare, gets no input", async () => {
      readRouteBindings.mockResolvedValue(
        bindingView({
          instances: [
            heroInstance({
              declaredFields: ["title", "subtitle"],
              // subtitle declared but not proven here; eyebrow proven but
              // declared nowhere.
              claims: [
                { slot: "hero", field: "title" },
                { slot: "hero", field: "eyebrow" },
              ],
            }),
          ],
        }),
      );
      const token = await selectHero();
      await ackBasis(token);

      expect(await heroTitleField()).toBeTruthy();
      const content = within(astroContent()!);
      expect(content.queryByRole("textbox", { name: "Hero subtitle" })).toBeNull();
      expect(content.queryByRole("textbox", { name: /eyebrow/i })).toBeNull();
      // Structure stays off: the sections panel still offers none of it.
      expect(screen.queryByRole("button", { name: "Add section" })).toBeNull();
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    /**
     * M2 PR 3, the first Astro write: the Inspector input goes through the
     * #399 gate, whose proof on an Astro frame is the section's acknowledged
     * basis token, and is sent with the identity the token named and Core's
     * component digest. Core verifies both and both CASes again.
     */
    describe("an Inspector write of a confirmed Astro section", () => {
      const WRITE_CONTEXT = {
        ...context,
        templates: context.templates.map((template) =>
          template.id === "template-1"
            ? {
                ...template,
                draftGeneration: 4,
                document: {
                  version: 1,
                  sections: [
                    {
                      id: "hero",
                      type: "hero",
                      enabled: true,
                      props: {
                        title: "Stored title",
                        subtitle: "Stored subtitle",
                      },
                    },
                  ],
                },
              }
            : template,
        ),
      } as unknown as StorefrontThemeEditorDTO;
      const answered = (draftGeneration: number, title: string) => ({
        success: true,
        message: "Section updated",
        data: {
          draftGeneration,
          droppedProps: [],
          document: {
            version: 1,
            sections: [
              {
                id: "hero",
                type: "hero",
                enabled: true,
                props: { title, subtitle: "Stored subtitle" },
              },
            ],
          },
        },
      });
      /** Long enough for the input's debounce to have sent it, if it may. */
      const pastDebounce = () =>
        act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 450));
        });
      const sentData = (call: number) =>
        (updateSectionProps.mock.calls[call]![0] as { data: unknown }).data;
      const writeSelected = async () => {
        getThemeEditor.mockResolvedValue({
          success: true,
          message: "ok",
          data: WRITE_CONTEXT,
        });
        readRouteBindings.mockResolvedValue(bindingView());
        return selectHero(WRITE_CONTEXT);
      };

      it("an input before the basis is acknowledged is held; the frame's applied releases it", async () => {
        updateSectionProps.mockResolvedValue(answered(5, "New title"));
        const token = await writeSelected();

        const field = await heroTitleField();
        fireEvent.change(field, { target: { value: "New title" } });
        await pastDebounce();
        expect(updateSectionProps).not.toHaveBeenCalled();
        expect(field.value).toBe("New title");

        await ackBasis(token);
        await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
      });

      it("with the basis acknowledged, it is sent once with the token's identity and Core's digest, at the generations it was made on", async () => {
        updateSectionProps.mockResolvedValue(answered(5, "New title"));
        const token = await writeSelected();
        await ackBasis(token);

        fireEvent.change(await heroTitleField(), {
          target: { value: "New title" },
        });
        await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
        expect(sentData(0)).toEqual({
          storefrontId: "storefront-1",
          themeId: "theme-1",
          templateId: "template-1",
          sectionId: "hero",
          props: { title: "New title" },
          expectedDraftGeneration: 4,
          expectedSourceGeneration: 3,
          routePath: "/",
          identity: MARKER,
          componentDigest: DIGEST,
        });
      });

      it("Core writing a newer snapshot after the ack holds the input, and the draft is kept", async () => {
        updateSectionProps.mockResolvedValue(answered(5, "New title"));
        const client = await settledThenAcked();
        act(() => {
          client.setQueryData(
            themePreviewServerQueries.forTheme("storefront-1", "theme-1")
              .queryKey,
            {
              success: true,
              message: "Live Preview server ready",
              data: {
                url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
                ...START_DATA,
                contentTicket: 8,
                draftGenerations: { "template-1": 5 },
              },
            } as never,
          );
        });
        await flush();

        const field = await heroTitleField();
        fireEvent.change(field, { target: { value: "Typed on a stale page" } });
        await pastDebounce();
        expect(updateSectionProps).not.toHaveBeenCalled();
        expect(field.value).toBe("Typed on a stale page");
      });

      /** The write context up, the hero selected and its basis acknowledged. */
      async function settledThenAcked() {
        getThemeEditor.mockResolvedValue({
          success: true,
          message: "ok",
          data: WRITE_CONTEXT,
        });
        readRouteBindings.mockResolvedValue(bindingView());
        modelCurrentBridge();
        const client = await settled(WRITE_CONTEXT, HOME, BASIS_READY, {
          serverData: START_DATA,
          servedContent: { ticket: 7, instance: INSTANCE },
        });
        await waitFor(() =>
          expect(vi.mocked(confirmThemePreviewContent)).toHaveBeenCalled(),
        );
        await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
        await flush();
        boundaryClick(1);
        await flush();
        expect(basisPosts()).toHaveLength(1);
        await ackBasis(basisPosts()[0]!.presentationToken);
        return client;
      }

      it("a write Core refuses keeps the draft and is not sent again on its own", async () => {
        updateSectionProps.mockResolvedValue({
          success: false,
          error: "SECTION_SOURCE_UNCONFIRMABLE",
          message:
            "SECTION_SOURCE_UNCONFIRMABLE: this section can't be confirmed right now",
        });
        await settledThenAcked();

        const field = await heroTitleField();
        fireEvent.change(field, { target: { value: "Refused title" } });
        await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
        await pastDebounce();
        await pastDebounce();
        expect(updateSectionProps).toHaveBeenCalledTimes(1);
        expect(field.value).toBe("Refused title");
      });

      it("after a write the next input waits for the reloaded page's new ack; only that ack releases it", async () => {
        updateSectionProps.mockResolvedValueOnce(answered(5, "First"));
        updateSectionProps.mockResolvedValueOnce(answered(6, "Second"));
        const client = await settledThenAcked();

        const field = await heroTitleField();
        fireEvent.change(field, { target: { value: "First" } });
        await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
        await flush();

        // Typed again before the page shows the first write.
        fireEvent.change(await heroTitleField(), {
          target: { value: "Second" },
        });
        await pastDebounce();
        expect(updateSectionProps).toHaveBeenCalledTimes(1);

        // Core wrote the first write's snapshot; the page reloads onto it.
        act(() => {
          client.setQueryData(
            themePreviewServerQueries.forTheme("storefront-1", "theme-1")
              .queryKey,
            {
              success: true,
              message: "Live Preview server ready",
              data: {
                url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview`,
                ...START_DATA,
                contentTicket: 8,
                draftGenerations: { "template-1": 5 },
              },
            } as never,
          );
        });
        vi.mocked(confirmThemePreviewContent).mockResolvedValue({
          success: true,
          message: "Live Preview content confirmed",
          data: { ticket: 8, instance: INSTANCE },
        } as never);
        await reloadWith({ ticket: 8, instance: INSTANCE });
        await waitFor(() => expect(basisPosts()).toHaveLength(2));
        const reissued = basisPosts()[1]!.presentationToken;
        expect(reissued).toMatchObject({
          documentBasis: { kind: "existing", draftGeneration: 5 },
          basis: { servedContent: { ticket: 8, instance: INSTANCE } },
        });
        await pastDebounce();
        // The new token alone is not the proof; its applied is.
        expect(updateSectionProps).toHaveBeenCalledTimes(1);

        await ackBasis(reissued);
        await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
        expect(sentData(1)).toMatchObject({
          sectionId: "hero",
          props: { title: "Second" },
          expectedDraftGeneration: 5,
          identity: MARKER,
          componentDigest: DIGEST,
        });
      });
    });

    // Lead decision Q3: after a frame reload the selection is not kept from
    // the old document; it is matched again, exactly, in Core's view read
    // for the new one.
    it("after a reload the selection is re-derived from Core's new view, and its basis asked again", async () => {
      // Review finding 10: the second view is set only once the click was
      // answered, so the case does not depend on how many reads the first
      // settle makes.
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      expect(token).toMatchObject({ sectionId: "hero" });
      // The view read for the new document binds the same instance to
      // another slot: the selection follows Core, not the old frame.
      readRouteBindings.mockResolvedValue(
        bindingView({
          instances: [
            heroInstance({
              section: "hero-2",
              claims: [{ slot: "hero-2", field: "title" }],
            }),
          ],
        }),
      );
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "applied",
      });
      await flush();
      expect(acceptedLine(token.operationId)).toBe(true);

      await reloadWith({ ticket: 7, instance: INSTANCE });
      await waitFor(() => expect(basisPosts()).toHaveLength(2));

      const reissued = basisPosts()[1]!.presentationToken;
      expect(reissued).toMatchObject({
        sectionId: "hero-2",
        routePath: "/",
        documentBasis: { kind: "existing", draftGeneration: 4 },
        basis: {
          kind: "astro-boundary",
          identity: MARKER,
          servedContent: { ticket: 7, instance: INSTANCE },
        },
      });
      expect(readRouteBindings.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(unconfirmedHint()).toBe(false);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    it("after a reload whose view no longer has the instance, the selection clears with the hint", async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      // The source edit that caused the reload moved the instance.
      readRouteBindings.mockResolvedValue(
        bindingView({
          instances: [
            heroInstance({
              identity: { rule: 2, src: SRC, start: 31, end: 61 },
            }),
          ],
        }),
      );
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "applied",
      });
      await flush();

      await reloadWith({ ticket: 7, instance: INSTANCE });
      await waitFor(() =>
        expect(inspectorNotice()?.textContent ?? "").toContain(
          "Couldn't restore your selection. Select the section again.",
        ),
      );

      const notice = inspectorNotice()!;
      expect(notice.getAttribute("data-astro-design-notice")).toBe(
        "unconfirmed",
      );
      expect(notice.textContent).toContain("Reload the preview");
      // No section is selected, so no row carries a badge, and nothing is
      // asked of the new document.
      expect(sectionStatus()).toBeNull();
      expect(basisPosts()).toHaveLength(1);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    // Hints review finding 4: a re-read that fails keeps the query's last
    // view as its data (TanStack Query keeps data on a failed refetch). That
    // view was read for the old document, so it must never be taken as the
    // new document's: the re-derive fails closed as for no view.
    it("after a reload whose view re-read fails, the selection clears and no basis is asked of the new document", async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      readRouteBindings.mockRejectedValue(new Error("binding view read failed"));
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "applied",
      });
      await flush();
      expect(acceptedLine(token.operationId)).toBe(true);

      await reloadWith({ ticket: 7, instance: INSTANCE });
      await waitFor(() =>
        expect(readRouteBindings.mock.calls.length).toBeGreaterThanOrEqual(2),
      );
      await waitFor(() =>
        expect(inspectorNotice()?.textContent ?? "").toContain(
          "Couldn't restore your selection. Select the section again.",
        ),
      );

      expect(inspectorNotice()!.getAttribute("data-astro-design-notice")).toBe(
        "unconfirmed",
      );
      expect(sectionStatus()).toBeNull();
      expect(basisPosts()).toHaveLength(1);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    // Finding 4, the click path: after a failed re-read the kept data is not
    // a view either, so a new click is not matched against it. It is
    // confirmed again only by a view read that succeeds.
    it("a click after a failed view re-read is not matched against the earlier view", async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      readRouteBindings.mockRejectedValue(new Error("binding view read failed"));
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "applied",
      });
      await flush();

      await reloadWith({ ticket: 7, instance: INSTANCE });
      await waitFor(() =>
        expect(readRouteBindings.mock.calls.length).toBeGreaterThanOrEqual(2),
      );
      await flush();

      // A revision well past any the editor minted: an author click.
      boundaryClick(100);
      await flush();

      expect(basisPosts()).toHaveLength(1);
      expect(updateSectionProps).not.toHaveBeenCalled();

      // Only a read that succeeds, for the next document, confirms a click
      // again.
      readRouteBindings.mockResolvedValue(bindingView());
      const reads = readRouteBindings.mock.calls.length;
      await reloadWith({ ticket: 7, instance: INSTANCE });
      await waitFor(() =>
        expect(readRouteBindings.mock.calls.length).toBeGreaterThan(reads),
      );
      await flush();
      boundaryClick(101);
      await waitFor(() => expect(basisPosts()).toHaveLength(2));
      expect(basisPosts()[1]!.presentationToken).toMatchObject({
        sectionId: "hero",
        basis: { servedContent: { ticket: 7, instance: INSTANCE } },
      });
    });

    // Hints review finding 5: the workspace's source generation moves on
    // after the frame's ready was answered (the store saw the new
    // generation later than the frame). The kept selection was matched
    // against the old source's view; it is matched again in the view of the
    // source the workspace now holds, not kept as it was.
    describe("when the workspace's source generation moves on without a new ready", () => {
      const selectedThenNewGeneration = async (
        viewOfNewSource: ReturnType<typeof bindingView>,
      ) => {
        readRouteBindings.mockResolvedValue(bindingView());
        const token = await selectHero();
        fromPreview({
          type: "morph:storefront-preview-section-presentation-ack",
          operationId: token.operationId,
          token,
          status: "applied",
        });
        await flush();
        expect(acceptedLine(token.operationId)).toBe(true);
        readRouteBindings.mockResolvedValue(viewOfNewSource);
        act(() => {
          useThemeWorkspaceStore.getState().setBaseSourceGeneration(4, scope);
        });
        await waitFor(() =>
          expect(readRouteBindings).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ expectedSourceGeneration: 4 }),
            }),
          ),
        );
        await flush();
      };

      it("a selection the new source no longer has clears with the hint", async () => {
        await selectedThenNewGeneration(
          bindingView({
            sourceGeneration: 4,
            instances: [
              heroInstance({ identity: { rule: 2, src: SRC, start: 31, end: 61 } }),
            ],
          }),
        );

        await waitFor(() =>
          expect(inspectorNotice()?.textContent ?? "").toContain(
            "Couldn't restore your selection. Select the section again.",
          ),
        );
        expect(basisPosts()).toHaveLength(1);
        expect(updateSectionProps).not.toHaveBeenCalled();
      });

      it("a selection the new source still has is confirmed again and its basis asked again", async () => {
        await selectedThenNewGeneration(bindingView({ sourceGeneration: 4 }));

        await waitFor(() => expect(basisPosts()).toHaveLength(2));
        expect(basisPosts()[1]!.presentationToken).toMatchObject({
          sectionId: "hero",
          basis: { servedContent: { ticket: 7, instance: INSTANCE } },
        });
        expect(unconfirmedHint()).toBe(false);
        expect(updateSectionProps).not.toHaveBeenCalled();
      });
    });

    // Review finding 3: the author followed a link in the frame. The new
    // document is another page (the editor's page is unchanged, so the
    // route effect does not deselect), and Core's view of the editor's page
    // would still match the kept identity.
    it("after a reload onto another page, the selection clears and nothing says it can't be edited", async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "applied",
      });
      await flush();

      await reloadWith({ ticket: 7, instance: INSTANCE }, "/about");
      await waitFor(() =>
        expect(readRouteBindings.mock.calls.length).toBeGreaterThanOrEqual(2),
      );
      await flush();

      // No basis asked of a frame that does not show the section.
      expect(basisPosts()).toHaveLength(1);
      expect(sectionStatus()).toBeNull();
      expect(inspectorNotice()).toBeNull();
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    it("a section-missing answer from a frame on another page is not said as can't be edited", async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      // In this round the frame now names another page.
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/about",
      });
      await flush();

      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "not-applied",
        reason: "section-missing",
      });
      await flush();

      expect(unconfirmedHint()).toBe(false);
      expect(sectionStatus()).toBeNull();
    });

    // Review finding 7: every author click other than a confirmed one
    // deselects, including the clicks the locate path stops early.
    /** The hero selected, with the not-applied hint on it. */
    const heroWithHint = async () => {
      readRouteBindings.mockResolvedValue(bindingView());
      const token = await selectHero();
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "not-applied",
        reason: "section-missing",
      });
      await flush();
      expect(unconfirmedHint()).toBe(true);
    };

    it("a click while the frame shows another page leaves no status behind", async () => {
      await heroWithHint();
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/about",
      });
      await flush();

      // A revision well past any the editor minted: an author click.
      boundaryClick(100);
      await flush();

      expect(inspectorNotice()).toBeNull();
      expect(sectionStatus()).toBeNull();
      expect(basisPosts()).toHaveLength(1);
    });

    it("a click whose location is from another file version leaves no status behind", async () => {
      await heroWithHint();

      boundaryClick(100, DIGEST, "00000000");
      await flush();

      expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
        SOURCE_LOCATION_STALE_MESSAGE,
        expect.anything(),
      );
      expect(inspectorNotice()).toBeNull();
      expect(sectionStatus()).toBeNull();
      expect(basisPosts()).toHaveLength(1);
    });

    it("the frame's answer to the editor's own request is not a click and keeps the status", async () => {
      await heroWithHint();

      // Revision 0 is never newer than the editor's own.
      boundaryClick(0);
      await flush();

      expect(unconfirmedHint()).toBe(true);
    });

    // Review finding 6: "Checking…" is bounded. A view read for the new
    // document that never answers clears the selection, with the hint, once
    // the bound has passed.
    it("a view read that never answers stops saying Checking after the bound, and clears the selection", async () => {
      // Every timer the shell starts is on the faked clock, which also moves
      // with real time, so the frame's message pump and the waits run.
      vi.useFakeTimers({
        toFake: [
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "Date",
        ],
        shouldAdvanceTime: true,
      });
      readRouteBindings.mockResolvedValue(bindingView());
      await selectHero();
      readRouteBindings.mockImplementation(() => new Promise(() => {}));

      await reloadWith({ ticket: 7, instance: INSTANCE });
      await waitFor(() =>
        expect(sectionStatus()?.getAttribute("data-astro-section-status")).toBe(
          "checking",
        ),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ASTRO_SELECTION_RECHECK_TIMEOUT_MS);
      });

      expect(sectionStatus()).toBeNull();
      const notice = inspectorNotice();
      expect(notice?.getAttribute("data-astro-design-notice")).toBe(
        "unconfirmed",
      );
      expect(notice?.textContent ?? "").toContain(
        "Couldn't restore your selection. Select the section again.",
      );
      expect(basisPosts()).toHaveLength(1);
      expect(updateSectionProps).not.toHaveBeenCalled();
    });

    it("while Core's view is read again for the new document, the section says it is checking", async () => {
      let answerView: (value: unknown) => void = () => {};
      readRouteBindings.mockResolvedValue(bindingView());
      await selectHero();
      readRouteBindings.mockImplementation(
        () =>
          new Promise((resolve) => {
            answerView = resolve;
          }),
      );

      await reloadWith({ ticket: 7, instance: INSTANCE });
      await waitFor(() =>
        expect(sectionStatus()?.getAttribute("data-astro-section-status")).toBe(
          "checking",
        ),
      );
      expect(inspectorNotice()?.getAttribute("data-astro-design-notice")).toBe(
        "checking",
      );
      expect(basisPosts()).toHaveLength(1);

      await act(async () => {
        answerView(bindingView());
      });
      await waitFor(() => expect(basisPosts()).toHaveLength(2));
      expect(sectionStatus()).toBeNull();
    });

    /**
     * Review finding 1: every Astro click opens Code, and the Inspector and
     * the sections panel are inside the Design surface, which Code makes
     * aria-hidden, inert and invisible. The same notice (one focus state) is
     * said in a status bar outside both mode surfaces while Code is shown.
     *
     * jsdom ignores `inert`, so a query cannot prove the author sees it; the
     * cases check that no ancestor of the bar is inert or aria-hidden.
     */
    // M2 PR 3 (D2): a confirmed click in Design no longer lands in Code; a
    // refused one still does. The cases that select the hero open Code
    // through the selection's explicit "Open in Code" action instead.
    describe("in Code mode, where a refused Astro click or Open in Code lands", () => {
      const statusBar = () =>
        document.querySelector<HTMLElement>("[data-astro-design-status-bar]");
      const outsideHiddenSurfaces = (element: Element) =>
        element.closest('[inert], [aria-hidden="true"]') === null;
      /** The selection's explicit action (D2): Code is shown after it. */
      const openInCode = async () => {
        openInspectorContent();
        fireEvent.click(
          within(
            inspectorPanel().querySelector<HTMLElement>(
              "[data-astro-inspector-content]",
            )!,
          ).getByRole("button", { name: "Open in Code" }),
        );
        await screen.findByRole(
          "textbox",
          { name: "Code editor" },
          { timeout: 15_000 },
        );
      };

      it("a hint said at the click is in the status bar, in the node mounted before it, outside the hidden Design surface", async () => {
        modelCurrentBridge();
        readRouteBindings.mockResolvedValue(bindingView());
        await settled(context, HOME, BASIS_READY, {
          serverData: START_DATA,
          // Rendered before the start's snapshot: the click is refused.
          servedContent: { ticket: 6, instance: INSTANCE },
        });
        await waitFor(() => expect(readRouteBindings).toHaveBeenCalled());
        await flush();

        // Mounted, and empty, before anything is said.
        const bar = statusBar();
        expect(bar).not.toBeNull();
        expect(bar!.getAttribute("role")).toBe("status");
        expect(bar!.getAttribute("aria-live")).toBe("polite");
        expect(bar!.textContent).toBe("");

        boundaryClick(1);
        expect(
          await screen.findByRole(
            "textbox",
            { name: "Code editor" },
            { timeout: 15_000 },
          ),
        ).toBeTruthy();

        expect(statusBar()).toBe(bar);
        expect(bar!.getAttribute("data-astro-design-status-bar")).toBe(
          "unconfirmed",
        );
        expect(bar!.textContent).toContain(
          "This section can't be edited in Design right now.",
        );
        expect(bar!.textContent).toContain(ASTRO_BASIS_UNCONFIRMED_MESSAGE);
        expect(bar!.textContent).toContain("hero");
        expect(outsideHiddenSurfaces(bar!)).toBe(true);
        // The Design copy is still kept, under the surface Code hides.
        expect(inspectorPanel().closest("[inert]")).not.toBeNull();
        expect(basisPosts()).toHaveLength(0);
      });

      it("a not-applied answer that arrives in Code is said in the bar as an update", async () => {
        readRouteBindings.mockResolvedValue(bindingView());
        const token = await selectHero();
        await openInCode();
        const bar = statusBar()!;
        expect(bar.textContent).toBe("");

        fromPreview({
          type: "morph:storefront-preview-section-presentation-ack",
          operationId: token.operationId,
          token,
          status: "not-applied",
          reason: "section-missing",
        });
        await flush();

        expect(statusBar()).toBe(bar);
        expect(bar.getAttribute("data-astro-design-status-bar")).toBe(
          "unconfirmed",
        );
        expect(bar.textContent).toContain(ASTRO_BASIS_UNCONFIRMED_MESSAGE);
        expect(outsideHiddenSurfaces(bar)).toBe(true);
      });

      it("Checking… after a reload is said in the bar while Code is shown", async () => {
        let answerView: (value: unknown) => void = () => {};
        readRouteBindings.mockResolvedValue(bindingView());
        await selectHero();
        await openInCode();
        readRouteBindings.mockImplementation(
          () =>
            new Promise((resolve) => {
              answerView = resolve;
            }),
        );
        const bar = statusBar()!;

        await reloadWith({ ticket: 7, instance: INSTANCE });
        await waitFor(() =>
          expect(bar.getAttribute("data-astro-design-status-bar")).toBe(
            "checking",
          ),
        );
        expect(bar.textContent).toContain(
          "Checking whether this section can be edited in Design…",
        );
        expect(bar.textContent).toContain(ASTRO_SELECTION_RECHECKING_MESSAGE);
        expect(outsideHiddenSurfaces(bar)).toBe(true);

        await act(async () => {
          answerView(bindingView());
        });
        await waitFor(() => expect(basisPosts()).toHaveLength(2));
        expect(statusBar()).toBe(bar);
        expect(bar.textContent).toBe("");
      });

      it("a new selection clears the old hint from the bar", async () => {
        await heroWithHint();
        await openInCode();
        const bar = statusBar()!;
        expect(bar.textContent).toContain(ASTRO_BASIS_UNCONFIRMED_MESSAGE);

        // A confirmed click on the section again: a new selection.
        boundaryClick(2);
        await flush();

        expect(basisPosts()).toHaveLength(2);
        expect(statusBar()).toBe(bar);
        expect(bar.getAttribute("data-astro-design-status-bar")).toBe("none");
        expect(bar.textContent).toBe("");
      });

      it("a page change clears the old hint from the bar", async () => {
        await heroWithHint();
        await openInCode();
        const bar = statusBar()!;
        expect(bar.textContent).toContain(ASTRO_BASIS_UNCONFIRMED_MESSAGE);

        act(() =>
          showEditorPage({
            template: "page",
            templateId: TEMPLATE_ID,
            routePath: ROUTE_PATH,
          }),
        );
        await flush();

        expect(statusBar()).toBe(bar);
        expect(bar.textContent).toBe("");
        expect(sectionStatus()).toBeNull();
      });

      it("back in Design the bar is quiet, and the Inspector and section row say it", async () => {
        await heroWithHint();
        await openInCode();
        const bar = statusBar()!;
        expect(bar.textContent).toContain(ASTRO_BASIS_UNCONFIRMED_MESSAGE);

        fireEvent.click(
          within(document.querySelector("header")!).getByRole("button", {
            name: "Design",
          }),
        );
        await waitFor(() => expect(bar.textContent).toBe(""));

        expect(unconfirmedHint()).toBe(true);
        expect(inspectorPanel().closest("[inert]")).toBeNull();
      });
    });
  });
});
