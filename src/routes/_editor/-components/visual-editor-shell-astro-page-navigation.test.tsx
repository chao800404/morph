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
import { PREVIEW_DOCUMENT_NAVIGATION_TIMEOUT_MS } from "@/lib/storefront/editor/preview-document-navigation";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { astroPreviewSourceHash } from "@/lib/storefront/theme-framework/astro-preview-locate";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import {
  answerFramePings,
  frameEnvelope,
} from "@/lib/test-utils/preview-frame-handshake";
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
  PREVIEW_PAGE_OPENING_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";

/**
 * M2 step 3, PR 3 (D3): the editor lists an Astro Theme's own pages, read the
 * way its recorded framework reads them, and a page switch in its preview is
 * a document load the canvas waits on. Nothing from the frame is taken until
 * the new document answers for the page asked for; a page that never answers
 * ends in a clear state, never in "open". A Start Theme keeps what it had.
 *
 * Harness copied from visual-editor-shell-astro-locate.test.tsx; only server
 * functions and the preview transport are mocked.
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

const ABOUT_PAGE = "src/pages/about.astro";
const ABOUT_SOURCE = `---
const title = "About";
---
<main>
  <h1>{title}</h1>
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
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});
/**
 * The hybrid workspace today's Astro E2E specs use: Astro's pages beside a
 * Starter's Start routes, which the Astro site never renders.
 */
const FILES = [
  file(
    "package.json",
    JSON.stringify({
      dependencies: {
        "@tanstack/react-router": "1.0.0",
        "@tanstack/react-start": "1.0.0",
        astro: "5.0.0",
      },
    }),
  ),
  file("astro.config.mjs", "export default {};\n"),
  file("src/router.tsx", "export const getRouter = () => null;\n"),
  ...livePreviewPlatformFiles().map((entry) =>
    file(entry.path, entry.content ?? ""),
  ),
  file(
    "src/routes/index.tsx",
    'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/")({ component: () => <main /> });\n',
  ),
  file(
    "src/routes/guard.tsx",
    'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/guard")({ component: () => <main /> });\n',
  ),
  file("src/pages/index.astro", "<main>Home</main>\n"),
  file(ABOUT_PAGE, ABOUT_SOURCE),
  file("src/pages/blog/[slug].astro", "<main>Post</main>\n"),
  file(
    "src/pages/feed.xml.ts",
    "export const GET = () => new Response('<rss />');\n",
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

const astroContext = {
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
  ],
} as unknown as StorefrontThemeEditorDTO;
/** The same workspace, recorded as TanStack Start (NULL). */
const startContext = {
  ...astroContext,
  theme: { ...astroContext.theme, framework: null },
} as unknown as StorefrontThemeEditorDTO;

type Posted = { type: string; routeRequestId?: number; routePath?: string };
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
/** Lets work settle; moves the clock when a test has frozen it. */
const tick = (ms = 0) =>
  act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms);
    else await new Promise((resolve) => setTimeout(resolve, ms));
  });
const routeRequests = () =>
  log.filter((message) => message.type === "morph:storefront-preview-set-route");

/**
 * Renders the editor on `routePath` and brings the frame's first document
 * up. The frame is not answered: each test plays what the frame says next.
 */
async function rendered(
  themeContext: StorefrontThemeEditorDTO,
  routePath: string,
  beforeReady?: () => void,
) {
  getThemeEditor.mockResolvedValue({
    success: true,
    message: "ok",
    data: themeContext,
  });
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
    treeAt(3) as never,
  );
  render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={themeContext}
        search={
          {
            template: "index",
            templateId: "template-1",
            routePath,
            viewport: "desktop",
          } as StorefrontThemeEditorSearch
        }
        onSearchChange={vi.fn()}
        navigatingRoutePath={routePath}
        currentUser={OWNER}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  beforeReady?.();
  fromPreview({
    type: "morph:storefront-preview-ready",
    servedInstance: {
      kind: "known",
      instance: { session: SESSION, serial: 1 },
    },
  });
  await tick();
}

/** The frame answers the editor's latest route request. */
function frameAnswers(routePath: string | null) {
  fromPreview({
    type: "morph:storefront-preview-route-applied",
    routeRequestId: routeRequests().at(-1)?.routeRequestId,
    routePath,
  });
}

/** What the bridge reports for a click on a located element of /about. */
function locatedClick(selectionRevision: number) {
  fromPreview({
    type: "morph:storefront-preview-select-section",
    sectionId: `source:${ABOUT_PAGE}`,
    componentType: "h1",
    kind: "heading",
    sourceFilePath: ABOUT_PAGE,
    sourceLocation: `${ABOUT_PAGE}:5:3`,
    sourceVersion: astroPreviewSourceHash(ABOUT_SOURCE),
    previewBoundary: null,
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

const navigationNotice = () =>
  screen.queryByTestId("preview-document-navigation");
const pagesList = () => screen.getByRole("list", { name: "Theme pages" });

const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

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
  getSession.mockReset();
  getSession.mockResolvedValue({ user: { id: OWNER.id } });
  getThemeFile.mockReset();
  getThemeFile.mockResolvedValue({
    success: true,
    message: "Theme file loaded",
    data: file(ABOUT_PAGE, ABOUT_SOURCE, 1),
  });
  updateSectionProps.mockReset();
  saveThemeFile.mockReset();
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

describe("the page list of an Astro Theme", () => {
  it("lists src/pages, never the Start routes beside them; a pattern is listed but not opened; an endpoint is Code only", async () => {
    await rendered(astroContext, "/");
    frameAnswers("/");
    await tick();

    const pages = within(pagesList());
    expect(pages.getByRole("button", { name: "Home /" })).toBeTruthy();
    expect(pages.getByRole("button", { name: "/about" })).toBeTruthy();
    expect(pages.queryByRole("button", { name: "/guard" })).toBeNull();
    const pattern = pages.getByTitle(
      "/blog/[slug] needs a concrete address to preview. Open its source instead.",
    );
    expect((pattern as HTMLButtonElement).disabled).toBe(true);
    expect(pattern.textContent).toContain("Pattern");
    // The endpoint is not a page; its source still opens.
    expect(pages.queryByRole("button", { name: "/feed.xml" })).toBeNull();
    const endpoints = within(
      screen.getByLabelText("Theme endpoints"),
    );
    expect(
      endpoints.getByRole("button", { name: "/feed.xml" }),
    ).toBeTruthy();
  });

  it("on TanStack Start the same workspace lists the Start routes, as before", async () => {
    await rendered(startContext, "/");
    frameAnswers("/");
    await tick();

    const pages = within(pagesList());
    expect(pages.getByRole("button", { name: "/guard" })).toBeTruthy();
    expect(pages.queryByRole("button", { name: "/about" })).toBeNull();
  });
});

describe("switching pages in a preview that navigates as documents (D3)", () => {
  it("waits for the new document to answer for the page, pausing canvas clicks until it does", async () => {
    await rendered(astroContext, "/about");

    expect(routeRequests().at(-1)?.routePath).toBe("/about");
    expect(navigationNotice()?.textContent).toContain("Opening /about");

    // A click from the frame before it has answered: it may be the page it
    // is leaving. Nothing opens.
    locatedClick(1);
    await tick();
    expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
      PREVIEW_PAGE_OPENING_MESSAGE,
      expect.anything(),
    );
    expect(screen.queryByRole("textbox", { name: "Code editor" })).toBeNull();

    // The frame's document said where it is, but has not answered yet.
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/about",
    });
    locatedClick(2);
    await tick();
    expect(screen.queryByRole("textbox", { name: "Code editor" })).toBeNull();

    frameAnswers("/about");
    await tick();
    expect(navigationNotice()).toBeNull();

    locatedClick(3);
    const editor = await screen.findByRole(
      "textbox",
      { name: "Code editor" },
      { timeout: 15_000 },
    );
    expect((editor as HTMLTextAreaElement).value).toBe(ABOUT_SOURCE);
    expect(saveThemeFile).not.toHaveBeenCalled();
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("an answer for another page is no answer", async () => {
    await rendered(astroContext, "/about");

    frameAnswers("/");
    await tick();
    expect(navigationNotice()?.textContent).toContain("Opening /about");
  });

  it("a page that never answers ends in a clear state, and a late answer still opens it", async () => {
    await rendered(astroContext, "/about", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    expect(navigationNotice()?.getAttribute("role")).toBe("status");

    await tick(PREVIEW_DOCUMENT_NAVIGATION_TIMEOUT_MS + 10);
    const alert = navigationNotice();
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toContain("did not open /about");
    expect(
      within(alert!).getByRole("button", { name: "Retry Preview" }),
    ).toBeTruthy();

    frameAnswers("/about");
    await tick();
    expect(navigationNotice()).toBeNull();
  });

  it("a frame that answers it has no page to go to is said, not taken as the page", async () => {
    // A bridge from before document navigation: no router, so it answers null.
    await rendered(astroContext, "/about");

    frameAnswers(null);
    await tick();
    expect(navigationNotice()?.getAttribute("role")).toBe("alert");
    expect(navigationNotice()?.textContent).toContain(
      "could not switch to /about",
    );
  });

  it("a Start Theme with no answer shows nothing of it: it keeps exactly what it had", async () => {
    await rendered(startContext, "/guard", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    expect(routeRequests().at(-1)?.routePath).toBe("/guard");
    await tick(PREVIEW_DOCUMENT_NAVIGATION_TIMEOUT_MS + 10);
    expect(navigationNotice()).toBeNull();
  });
});
