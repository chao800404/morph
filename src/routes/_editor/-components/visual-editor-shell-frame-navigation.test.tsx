import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  VisualEditorShell,
  type EditorNavigationGuard,
} from "./visual-editor-shell";

/**
 * The author moving inside the preview frame — a `<Link>`, back, forward —
 * and the editor following.
 *
 * The frame names the route it is on in every structure report. A report that
 * does not name the editor's route is set aside, as before; when the editor
 * is asking the frame for nothing (the latest set-route, sent to this frame
 * in this ready round, is answered, and no switch of its own is waiting or
 * under way), and the report names exactly one static Theme page, the editor
 * switches there through the switch a page row asks for. The report the frame
 * sends after that switch's own set-route is answered is the one taken.
 *
 * The harness plays the router: `onSearchChange` asks the shell's leave guard
 * first, as `useBlocker` does, and moves the location only when the guard
 * lets it. A test can hold the load, so `search` stays where it was while the
 * router is heading elsewhere. The frame is played by messages on `window`
 * that pass the transport's origin, source and session checks.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());

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

const homeSearch = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

const routeSource = (id: string, options = "{ component: () => <main /> }") =>
  `import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("${id}")(${options});\n`;
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
/**
 * Two static pages besides Home, and one of each kind of route the editor
 * must not follow to: a dynamic page, a pathless layout, a layout and a
 * handler-only route. `/nowhere` is in no file at all.
 */
const FILES = [
  file("src/routes/index.tsx", routeSource("/")),
  file("src/routes/b.tsx", routeSource("/b")),
  file("src/routes/c.tsx", routeSource("/c")),
  file("src/routes/products/$handle.tsx", routeSource("/products/$handle")),
  file("src/routes/deals/_promo.tsx", routeSource("/deals/_promo")),
  file("src/routes/shop/route.tsx", routeSource("/shop")),
  file(
    "src/routes/api.tsx",
    routeSource(
      "/api",
      "{ server: { handlers: { GET: () => new Response('ok') } } }",
    ),
  ),
];
const tree = () => ({
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
          children: FILES.map((entry) => ({
            name: entry.path.slice("src/routes/".length),
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
/** The one element a page's report lists, told apart by its tag. */
const pageNode = (routePath: string, tagName: string) => ({
  id: `${routePath}:node:title`,
  parentId: null,
  sectionId: routePath,
  label: "Title",
  kind: "heading",
  tagName,
  target: {
    sectionId: routePath,
    nodeId: `${routePath}:node:title`,
    elementKey: "title",
    isSection: false,
  },
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
};

function renderRouted(initial: StorefrontThemeEditorSearch = homeSearch) {
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
    tree() as never,
  );
  const guardRef: { current: EditorNavigationGuard | null } = { current: null };
  let holding = false;

  function Routed() {
    const [search, setSearch] = useState(initial);
    const [heading, setHeading] = useState(initial);
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
        context={context}
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
    data: { ...data, previewSession: PREVIEW_SESSION },
    origin: PREVIEW_ORIGIN,
    source: currentWindow(),
  });
function fromPreview(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(event(data));
  });
}
/** Delivered outside act: React has not committed what the handler set. */
function fromPreviewUncommitted(data: Record<string, unknown>) {
  window.dispatchEvent(event(data));
}
const report = (routePath: string | undefined, nodes: unknown[] = []) =>
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes,
    ...(routePath === undefined ? {} : { routePath }),
  });
const applied = (routeRequestId: number | undefined, routePath: string) =>
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
async function settled(initial: StorefrontThemeEditorSearch = homeSearch) {
  const harness = renderRouted(initial);
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

/** The frame answers the editor's latest request from `routePath`. */
async function frameAnswers(routePath: string, nodes: unknown[] = []) {
  const request = latestRequest();
  expect(request?.routePath ?? "/").toBe(routePath);
  applied(request?.routeRequestId, routePath);
  report(routePath, nodes);
  await tick(0);
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

describe("following the author's navigation inside the preview frame", () => {
  it("does not take the report a frame sends with its ready as a navigation", async () => {
    // On a page that is not the one every frame boots on.
    const harness = await settled({ ...homeSearch, routePath: "/b" });
    expect(shownRoute(harness)).toBe("/b");
    const before = routeRequests().length;

    // The frame reloads itself: ready, and at once the report of the page it
    // booted on — both before the editor has sent this round's request. The
    // last request it knows of was answered, but by the frame's last round.
    fromPreviewUncommitted({
      type: "morph:storefront-preview-ready",
      servedInstance: {
        kind: "known",
        instance: { session: SESSION, serial: 1 },
      },
    });
    fromPreviewUncommitted({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/",
    });
    await act(async () => {});
    await tick(0);

    // Precondition: this round's request went out after the boot report.
    expect(routeRequests().length).toBeGreaterThan(before);
    expect(routesAsked(harness)).toEqual([]);
    expect(shownRoute(harness)).toBe("/b");
    // And the frame is sent back to the page the editor shows.
    expect(latestRequest()?.routePath).toBe("/b");
  });

  it("switches once to the static page a <Link> took the frame to, and selects there", async () => {
    const harness = await settled();
    const requestsBefore = routeRequests().length;

    // The author follows a link inside the frame; its DOM settles in steps.
    report("/b");
    report("/b");
    await tick(0);
    report("/b");
    await tick(0);

    expect(routesAsked(harness)).toEqual(["/b"]);
    expect(shownRoute(harness)).toBe("/b");
    // The switch's own request, the way a page row's switch sends one.
    expect(routeRequests().length).toBe(requestsBefore + 1);
    expect(latestRequest()?.routePath).toBe("/b");

    // Its answer, then the report it is followed by, which is taken.
    await frameAnswers("/b", [pageNode("/b", "h3")]);
    expect(routesAsked(harness)).toEqual(["/b"]);
    const row = await screen.findByText("h3");
    log = [];
    act(() => {
      row.closest("button")?.click();
    });
    await tick(0);
    const ask = log.find(
      (message) =>
        message.type === "morph:storefront-preview-set-selection-mode" &&
        message.selectionRevision !== undefined,
    );
    expect(ask, "the selection the tree row asks the frame for").toBeTruthy();
    expect(harness.asked.at(-1)).toEqual({ section: "/b" });
  });

  it("follows back and forward the same way", async () => {
    const harness = await settled();
    report("/b");
    await tick(0);
    await frameAnswers("/b");

    // Back, to Home.
    report("/");
    await tick(0);
    expect(routesAsked(harness)).toEqual(["/b", "/"]);
    expect(shownRoute(harness)).toBe("/");
    await frameAnswers("/");

    // Forward, to /b again.
    report("/b");
    await tick(0);
    expect(routesAsked(harness)).toEqual(["/b", "/", "/b"]);
    expect(shownRoute(harness)).toBe("/b");
    await frameAnswers("/b");
    expect(routesAsked(harness)).toEqual(["/b", "/", "/b"]);
  });

  it("takes an index route's trailing slash as its page", async () => {
    const harness = await settled();
    report("/c/");
    await tick(0);
    expect(routesAsked(harness)).toEqual(["/c"]);
  });

  describe("does not follow", () => {
    it("while the frame has not answered the editor's own switch", async () => {
      const harness = await settled();
      // A page row's switch: the editor sends /c and the frame has not
      // arrived. A report from the page it is leaving is not a navigation.
      const row = await screen.findByTitle("Preview /c");
      act(() => row.click());
      await tick(0);
      expect(shownRoute(harness)).toBe("/c");
      expect(latestRequest()?.routePath).toBe("/c");

      // The page row asks for /c itself, and its pending switch asks again
      // while the guard decides; only /c is ever asked for.
      const asked = routesAsked(harness).length;
      expect(new Set(routesAsked(harness))).toEqual(new Set(["/c"]));

      report("/");
      await tick(0);
      report("/b");
      await tick(0);
      expect(routesAsked(harness)).toHaveLength(asked);
      expect(shownRoute(harness)).toBe("/c");

      // Once answered, the editor follows again.
      await frameAnswers("/c");
      report("/b");
      await tick(0);
      expect(routesAsked(harness).slice(asked)).toEqual(["/b"]);
    });

    it("while a switch of the editor's own is waiting for the router", async () => {
      const harness = await settled();
      harness.holdLoads();
      const row = await screen.findByTitle("Preview /c");
      act(() => row.click());
      await tick(0);
      // The router is heading to /c; the editor still shows Home.
      expect(new Set(routesAsked(harness))).toEqual(new Set(["/c"]));
      expect(shownRoute(harness)).toBe("/");

      report("/b");
      await tick(0);
      expect(new Set(routesAsked(harness))).toEqual(new Set(["/c"]));
      harness.finishLoad();
      await tick(0);
      expect(shownRoute(harness)).toBe("/c");
      expect(new Set(routesAsked(harness))).toEqual(new Set(["/c"]));
    });

    it.each([
      ["a dynamic route", "/products/$handle"],
      ["a route in no file", "/nowhere"],
      ["a pathless layout", "/deals"],
      ["a layout", "/shop"],
      ["a handler-only route", "/api"],
    ])("to %s", async (_label, routePath) => {
      const harness = await settled();
      report(routePath);
      await tick(0);
      expect(routesAsked(harness)).toEqual([]);
      expect(shownRoute(harness)).toBe("/");
    });

    it("a report that names no route", async () => {
      const harness = await settled({ ...homeSearch, routePath: "/b" });
      report(undefined);
      await tick(0);
      expect(routesAsked(harness)).toEqual([]);
      expect(shownRoute(harness)).toBe("/b");
    });
  });

  it("stays where it is when the leave guard keeps the author on the page", async () => {
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "The heading is too long.",
    });
    const harness = await settled();
    // An edit on Home still waiting out its debounce.
    report("/", [heroNode]);
    const heading = await screen.findByText("h1");
    act(() => {
      heading.closest("button")?.click();
    });
    // Frozen from here, so the edit is sent by the switch, not the debounce.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fromPreview({
      type: "morph:storefront-preview-commit-inline-text",
      sectionId: "hero",
      fieldKey: "heading",
      fieldPath: "heading",
      value: "Hello",
      originalValue: "Welcome",
    });
    await tick(0);
    const requestsBefore = routeRequests().length;

    report("/b");
    await tick(0);
    // The switch was asked for, the save it waited on failed, and the author
    // chose to stay.
    expect(routesAsked(harness)).toEqual(["/b"]);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    act(() => {
      screen.getByRole("button", { name: "Stay here" }).click();
    });
    await tick(0);
    expect(shownRoute(harness)).toBe("/");
    expect(routeRequests().length).toBe(requestsBefore);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // Recorded, not decided: the frame is still on /b and nothing sends it
    // back, so its next report asks for the switch again, and the leave
    // dialog opens again. Nothing is sent again meanwhile.
    report("/b");
    await tick(0);
    expect(routesAsked(harness)).toEqual(["/b", "/b"]);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(shownRoute(harness)).toBe("/");
  });

  describe("in Code Mode", () => {
    it("does not follow, and follows once the author is back in Design", async () => {
      const harness = await settled();
      act(() => {
        screen.getByRole("button", { name: /^Code$/ }).click();
      });
      await tick(0);
      report("/b");
      await tick(0);
      report("/b");
      await tick(0);
      expect(routesAsked(harness)).toEqual([]);
      expect(shownRoute(harness)).toBe("/");

      log = [];
      await act(async () => {
        screen.getByRole("button", { name: /^Design$/ }).click();
      });
      await tick(0);
      // Back in Design, the frame is asked where it is.
      expect(
        log.filter(
          (message) =>
            message.type === "morph:storefront-preview-request-structure",
        ),
      ).not.toHaveLength(0);
      report("/b");
      await tick(0);
      expect(routesAsked(harness)).toEqual(["/b"]);
      expect(shownRoute(harness)).toBe("/b");
    });

    it("does nothing new when the frame is still on the page the editor shows", async () => {
      const harness = await settled();
      act(() => {
        screen.getByRole("button", { name: /^Code$/ }).click();
      });
      await tick(0);
      await act(async () => {
        screen.getByRole("button", { name: /^Design$/ }).click();
      });
      await tick(0);
      report("/", [heroNode]);
      await tick(0);
      expect(routesAsked(harness)).toEqual([]);
      expect(shownRoute(harness)).toBe("/");
    });
  });
});

/**
 * Recorded, not decided: the author moves on twice inside the frame faster
 * than the editor's switch for the first move is answered. What the editor
 * does with the second report is pinned here as it is; whether to keep it is
 * the user's decision.
 */
describe("a fast /b then /c inside the frame (behaviour recorded)", () => {
  it("while the router is still loading /b: ends on /b and sends the frame back to /b", async () => {
    const harness = await settled();
    harness.holdLoads();
    report("/b");
    await tick(0);
    expect(routesAsked(harness)).toEqual(["/b"]);
    // The frame is on /c before the router has loaded /b.
    report("/c");
    await tick(0);
    expect(routesAsked(harness)).toEqual(["/b"]);
    harness.finishLoad();
    await tick(0);
    expect(shownRoute(harness)).toBe("/b");
    // The set-route that follows the switch names /b, sent to a frame on /c.
    expect(latestRequest()?.routePath).toBe("/b");
    // The frame, sent to /b, answers from there; the editor stays on /b.
    await frameAnswers("/b");
    expect(routesAsked(harness)).toEqual(["/b"]);
    expect(shownRoute(harness)).toBe("/b");
  });

  it("after /b is loaded, before the frame answers it: ends on /b and sends the frame back to /b", async () => {
    const harness = await settled();
    report("/b");
    await tick(0);
    expect(shownRoute(harness)).toBe("/b");
    const pullBack = latestRequest();
    expect(pullBack?.routePath).toBe("/b");
    // The frame reached /c; the editor's request for /b is unanswered.
    report("/c");
    await tick(0);
    expect(routesAsked(harness)).toEqual(["/b"]);
    expect(shownRoute(harness)).toBe("/b");
    expect(latestRequest()).toBe(pullBack);
  });

  it("a canvas selection the frame reports from /c meanwhile is taken as a selection on /b", async () => {
    const harness = await settled();
    harness.holdLoads();
    report("/b");
    await tick(0);
    report("/c");
    harness.finishLoad();
    await tick(0);
    expect(shownRoute(harness)).toBe("/b");
    // Before the frame is back on /b, the author clicks an element of /c.
    fromPreview({
      type: "morph:storefront-preview-select-section",
      sectionId: "c-only-section",
      componentType: "custom",
      kind: "heading",
      nodeId: "c-only-section:node:title",
      sourceFilePath: null,
      sourceLocation: null,
      elementKey: "title",
      fieldKey: "title",
      field: "title",
      fieldPath: "title",
      descendantFields: [],
      tagName: "h2",
      role: null,
      inputType: null,
      styleRevision: latestStyleRevision(),
      className: "",
      isSection: false,
      inspectorOverride: null,
      computedStyle: null,
      parentComputedStyle: null,
      sectionComputedStyle: null,
      selectionRevision: 10_000,
    });
    await tick(0);
    // Pinned as observed: see the PR body.
    expect(harness.asked.at(-1)).toEqual({ section: "c-only-section" });
    expect(harness.search().section).toBe("c-only-section");
    expect(shownRoute(harness)).toBe("/b");

    // An inline edit of that element, a section /b does not have, sends
    // no write. (A section id /b and /c share is not covered here.)
    fromPreview({
      type: "morph:storefront-preview-commit-inline-text",
      sectionId: "c-only-section",
      fieldKey: "title",
      fieldPath: "title",
      value: "Typed on /c",
      originalValue: "C title",
    });
    await tick(400);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });
});
