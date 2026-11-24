import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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
  render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={themeContext}
        search={
          {
            template: page.template,
            templateId: page.templateId,
            routePath: page.routePath,
            viewport: "desktop",
          } as StorefrontThemeEditorSearch
        }
        onSearchChange={vi.fn()}
        navigatingRoutePath={page.routePath}
        currentUser={OWNER}
      />
    </QueryClientProvider>,
  );
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
  function boundaryClick(selectionRevision: number, sourceDigest = DIGEST) {
    fromPreview({
      type: "morph:storefront-preview-select-section",
      sectionId: `source:${ASTRO_PAGE}`,
      componentType: "h1",
      kind: "heading",
      sourceFilePath: ASTRO_PAGE,
      sourceLocation: `${ASTRO_PAGE}:5:3`,
      sourceVersion: astroPreviewSourceHash(ASTRO_SOURCE),
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

  it("a click on an instance Core confirmed still only locates, writes nothing, and says nothing more", async () => {
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
    const unconfirmedHint = () =>
      vi
        .mocked(toast.info)
        .mock.calls.some(
          ([text, options]) =>
            text === ASTRO_BASIS_UNCONFIRMED_MESSAGE &&
            (options as { id?: string } | undefined)?.id ===
              "astro-basis-unconfirmed",
        );

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

      // The frame acknowledges it; the editor takes it.
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: posts[0]!.presentationToken.operationId,
        token: posts[0]!.presentationToken,
        status: "applied",
      });
      await flush();
      expect(consoleSaid(/basis ack held/)).toBe(false);
      expect(consoleSaid(/guard=basis-unconfirmed/)).toBe(false);
      expect(unconfirmedHint()).toBe(false);
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
    });
  });
});
