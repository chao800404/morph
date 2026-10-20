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
  PREVIEW_OTHER_PAGE_NOT_SAVED_MESSAGE,
  VisualEditorShell,
  type EditorNavigationGuard,
} from "./visual-editor-shell";

/**
 * Which document a frame with no router edits, and when the editor takes its
 * word for it.
 *
 * A Theme whose source has no router (no TanStack Start entry) is mounted as
 * one document: the one the editor sends. Its frame never names a page; it
 * answers a route request with no route. The editor takes its selections and
 * edits as the document on screen once it has read the Theme's files and
 * found no router, except while the frame is known to be behind: it answered
 * with no route, and the editor has sent a newer request it has not answered.
 * Before the files are read nothing is taken.
 *
 * The harness is the one of `visual-editor-shell-frame-mismatch-writes.test.tsx`.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const saveThemeFile = vi.hoisted(() => vi.fn());
const panelSelections = vi.hoisted((): unknown[] => []);

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
      panelSelections.push(props.selection ?? null);
      return <RealPanel {...props} />;
    },
  };
});

const SAME = "Same heading";
const sections = [
  { id: "hero", type: "Hero", props: { heading: SAME } },
  { id: "promo", type: "Hero", props: { heading: SAME } },
];
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
      document: { version: 1, sections },
      draftGeneration: 1,
      version: 1,
    },
    {
      id: "template-about",
      type: "page",
      name: "About",
      document: { version: 1, sections },
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
const aboutSearch = {
  template: "page",
  templateId: "template-about",
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

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
// No package.json naming TanStack Start, no router, no routes.
const FILES = [
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
const tree = () => ({
  files: FILES,
  tree: [
    {
      name: "src",
      path: "src",
      isDirectory: true,
      children: [
        {
          name: "hero",
          path: "src/hero",
          isDirectory: true,
          children: FILES.map((entry) => ({
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
  templateId?: string;
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
  /** The router moved to `next`, as a template switch moves it. */
  moveTo: (next: StorefrontThemeEditorSearch) => void;
};

function renderRouted(
  initial: StorefrontThemeEditorSearch = homeSearch,
  {
    treeRead = true,
    framework,
  }: { treeRead?: boolean; framework?: string } = {},
) {
  // The framework the site records for the Theme; absent reads as TanStack
  // Start, as the editor's DTO says.
  const shellContext = framework
    ? ({
        ...context,
        theme: { ...context.theme, framework },
      } as unknown as StorefrontThemeEditorDTO)
    : context;
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
  if (treeRead) {
    client.setQueryData(
      storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
      tree() as never,
    );
  }
  const guardRef: { current: EditorNavigationGuard | null } = { current: null };
  let holding = false;

  function Routed() {
    const [search, setSearch] = useState(initial);
    const [heading, setHeading] = useState(initial);
    harness.search = () => search;
    harness.holdLoads = () => {
      holding = true;
    };
    harness.moveTo = (next) => {
      act(() => {
        setHeading(next);
        setSearch(next);
      });
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
    data: { ...data, previewSession: PREVIEW_SESSION },
    origin: PREVIEW_ORIGIN,
    source: currentWindow(),
  });
function fromPreview(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(event(data));
  });
}
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
function frameSelects(sectionId: "hero" | "promo") {
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
    fieldKey: "heading",
    field: "heading",
    fieldPath: "heading",
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

/** The frame comes up, as a live one does; with `answer`, it answers the route request. */
async function frameUp(answer: boolean) {
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
  if (answer) {
    applied(latestRequest()?.routeRequestId, null);
    await tick(0);
  }
}
const noticed = () =>
  vi
    .mocked(toast.info)
    .mock.calls.some(
      (call) => call[0] === PREVIEW_OTHER_PAGE_NOT_SAVED_MESSAGE,
    );

beforeEach(() => {
  selectionRevision = 10_000;
  panelSelections.length = 0;
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

describe("a frame with no router", () => {
  it("is not taken before it has answered the editor's route request", async () => {
    renderRouted(homeSearch);
    await frameUp(false);
    frameSelects("hero");
    await tick(0);
    expect(selectedInInspector()).toBeNull();
    frameCommitsText("hero", "Typed before the answer");
    await tick(400);
    expect(writtenTemplates()).toEqual([]);
    expect(noticed()).toBe(true);
  });

  it("is taken as the document on screen once it answered with no route", async () => {
    renderRouted(homeSearch);
    await frameUp(true);
    frameSelects("hero");
    await tick(0);
    frameCommitsText("hero", "Typed on Home");
    await tick(400);
    expect(writtenTemplates()).toEqual(["template-1"]);
  });

  it("is not taken while it is behind the editor's newer request, and is again once it answers", async () => {
    const harness = renderRouted(homeSearch);
    await frameUp(true);
    // The author moves to another document; its request is not answered yet.
    harness.moveTo(aboutSearch);
    await tick(0);
    expect(latestRequest()?.templateId).toBe("template-about");
    frameSelects("hero");
    await tick(0);
    expect(selectedInInspector()).toBeNull();
    frameCommitsText("hero", "Typed while behind");
    await tick(400);
    expect(writtenTemplates()).toEqual([]);
    expect(noticed()).toBe(true);

    applied(latestRequest()?.routeRequestId, null);
    await tick(0);
    frameSelects("hero");
    await tick(0);
    expect(selectedInInspector()).toBe("hero");
    frameCommitsText("hero", "Typed on About");
    await tick(400);
    expect(writtenTemplates()).toEqual(["template-about"]);
  });

  it("is not taken before the editor has read the Theme's files", async () => {
    vi.mocked(listStorefrontThemeFiles).mockImplementation(
      () => new Promise(() => {}) as never,
    );
    renderRouted(homeSearch, { treeRead: false });
    await frameUp(true);
    frameSelects("hero");
    await tick(0);
    expect(selectedInInspector()).toBeNull();
    frameCommitsText("hero", "Typed before the files");
    await tick(400);
    expect(writtenTemplates()).toEqual([]);
    expect(noticed()).toBe(true);
  });
});

/**
 * A preview that names no page and is not proven to be one document: an
 * Astro Theme (its preview loads the same bridge, with no router: a page
 * navigates as a document) or one recorded with a framework the editor does
 * not know. Nothing it reports is taken unless it names the page on screen.
 */
describe.each([["astro"], ["a-framework-the-editor-does-not-know"]])(
  "a preview recorded as %s",
  (framework) => {
    async function refused() {
      frameSelects("hero");
      await tick(0);
      expect(selectedInInspector()).toBeNull();
      frameCommitsText("hero", "Typed on the frame's page");
      await tick(400);
      expect(writtenTemplates()).toEqual([]);
      // Said as unavailable: waiting for another page would never help here.
      expect(noticed()).toBe(false);
      expect(
        vi
          .mocked(toast.info)
          .mock.calls.some(
            (call) => call[0] === CANVAS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE,
          ),
      ).toBe(true);
    }

    it("is not taken once it answered with no route (unknown page)", async () => {
      renderRouted(homeSearch, { framework });
      await frameUp(true);
      await refused();
    });

    it("is not taken while the editor's switch is unanswered (editor ahead)", async () => {
      const harness = renderRouted(homeSearch, { framework });
      await frameUp(true);
      harness.moveTo(aboutSearch);
      await tick(0);
      await refused();
    });

    it("is not taken after it moved to another document by itself (frame ahead)", async () => {
      renderRouted(homeSearch, { framework });
      await frameUp(true);
      // A page-to-page navigation is a new document: a new ready, nothing named.
      fromPreview({
        type: "morph:storefront-preview-ready",
        servedInstance: {
          kind: "known",
          instance: { session: SESSION, serial: 1 },
        },
      });
      await tick(0);
      await refused();
    });

    it("is taken while it names the page on screen", async () => {
      renderRouted(homeSearch, { framework });
      await frameUp(true);
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/",
      });
      await tick(0);
      frameSelects("hero");
      await tick(0);
      expect(selectedInInspector()).toBe("hero");
      frameCommitsText("hero", "Typed on Home");
      await tick(400);
      expect(writtenTemplates()).toEqual(["template-1"]);
      expect(noticed()).toBe(false);
    });
  },
);

/**
 * The limit, said, and nothing else changed. On a Theme of another framework
 * the canvas is not available: every click and every edit from it is
 * refused with a notice that says so, never "wait". The panel, Code mode and
 * the preview itself work as on any Theme.
 */
describe.each([["astro"], ["a-framework-the-editor-does-not-know"]])(
  "the canvas of a Theme recorded as %s",
  (framework) => {
    const unavailableSaid = () =>
      vi
        .mocked(toast.info)
        .mock.calls.filter(
          (call) => call[0] === CANVAS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE,
        );
    const SENDS: Record<string, () => void> = {
      "a canvas click (select-section)": () => frameSelects("hero"),
      "commit-inline-text": () => frameCommitsText("hero", "Typed"),
      "commit-section-reorder": () =>
        fromPreview({
          type: "morph:storefront-preview-commit-section-reorder",
          draggedSectionId: "promo",
          targetSectionId: "hero",
        }),
      "commit-sibling-reorder": () =>
        fromPreview({
          type: "morph:storefront-preview-commit-sibling-reorder",
          sectionId: "hero",
          sourceFilePath: "src/hero/Hero.tsx",
          draggedNodeId: "hero:node:heading",
          targetNodeId: "hero:node:section",
        }),
      "commit-array-item-reorder": () =>
        fromPreview({
          type: "morph:storefront-preview-commit-array-item-reorder",
          sectionId: "hero",
          draggedFieldPath: "items.0",
          targetFieldPath: "items.1",
        }),
    };
    const WINDOWS: Record<
      string,
      (harness: ReturnType<typeof renderRouted>) => Promise<void>
    > = {
      "after the frame answered with no route": async () => {},
      "while the editor's switch is unanswered": async (harness) => {
        harness.moveTo(aboutSearch);
        await tick(0);
      },
      "after the frame moved to another document": async () => {
        fromPreview({
          type: "morph:storefront-preview-ready",
          servedInstance: {
            kind: "known",
            instance: { session: SESSION, serial: 1 },
          },
        });
        await tick(0);
      },
    };

    describe.each(Object.entries(WINDOWS))("%s", (_window, open) => {
      it.each(Object.keys(SENDS))(
        "%s is refused with the unavailable notice, and writes nothing",
        async (name) => {
          const harness = renderRouted(homeSearch, { framework });
          await frameUp(true);
          await open(harness);
          SENDS[name]!();
          await tick(400);
          expect(unavailableSaid()).toEqual([
            [
              CANVAS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE,
              { id: "canvas-unavailable-for-framework" },
            ],
          ]);
          // Never the "another page, wait" notice.
          expect(noticed()).toBe(false);
          expect(selectedInInspector()).toBeNull();
          expect(writtenTemplates()).toEqual([]);
          expect(saveThemeFile).not.toHaveBeenCalled();
        },
      );
    });

    it("says it once for repeated clicks: one stable id", async () => {
      renderRouted(homeSearch, { framework });
      await frameUp(true);
      frameSelects("hero");
      frameSelects("promo");
      await tick(0);
      expect(
        new Set(
          vi
            .mocked(toast.info)
            .mock.calls.filter(
              (call) => call[0] === CANVAS_UNAVAILABLE_FOR_FRAMEWORK_MESSAGE,
            )
            .map((call) => (call[1] as { id?: string }).id),
        ),
      ).toEqual(new Set(["canvas-unavailable-for-framework"]));
    });

    it("leaves the panel as it was: a section picked there is edited and written, quietly", async () => {
      renderRouted(homeSearch, { framework });
      await frameUp(true);
      const row = screen.getAllByTitle("Select Hero; drag to reorder")[0]!;
      act(() => row.click());
      await tick(0);
      // The frame answers the panel's request with its element, as the
      // bridge does; set aside, and nothing said about the canvas.
      const ask = log
        .filter(
          (message) => message.type === "morph:storefront-preview-set-section",
        )
        .at(-1);
      fromPreview({
        type: "morph:storefront-preview-select-section",
        sectionId: "hero",
        componentType: "Hero",
        kind: "section",
        nodeId: "hero",
        sourceFilePath: "src/hero/Hero.tsx",
        sourceLocation: null,
        elementKey: null,
        fieldKey: null,
        field: null,
        fieldPath: null,
        descendantFields: [],
        tagName: "section",
        role: null,
        inputType: null,
        styleRevision: latestStyleRevision(),
        className: "",
        isSection: true,
        inspectorOverride: null,
        computedStyle: null,
        parentComputedStyle: null,
        sectionComputedStyle: null,
        selectionRevision: ask?.selectionRevision ?? 0,
      });
      await tick(0);
      expect(unavailableSaid()).toEqual([]);
      act(() => screen.getByRole("button", { name: /^Content$/ }).click());
      await tick(0);
      const field = screen.getByDisplayValue(SAME);
      fireEvent.focus(field);
      fireEvent.input(field, { target: { value: "Panel edit" } });
      fireEvent.blur(field);
      await tick(400);
      expect(writtenTemplates()).toEqual(["template-1"]);
      expect(unavailableSaid()).toEqual([]);
      expect(noticed()).toBe(false);
      // And the preview is refreshed with it, as on any Theme.
      expect(
        log.some(
          (message) =>
            message.type === "morph:storefront-preview-update-section-props" &&
            message.sectionId === "hero" &&
            (message as { props?: { heading?: string } }).props?.heading ===
              "Panel edit",
        ),
      ).toBe(true);
    });

    it("leaves the preview and Code mode as they were", async () => {
      renderRouted(homeSearch, { framework });
      await frameUp(true);
      // The preview is framed, sent its route and the Theme's files.
      expect(document.querySelector("iframe")).toBeTruthy();
      expect(
        log.some(
          (message) => message.type === "morph:storefront-preview-set-route",
        ),
      ).toBe(true);
      expect(
        log.some(
          (message) =>
            message.type === "morph:storefront-preview-update-theme-files",
        ),
      ).toBe(true);
      act(() => screen.getByRole("button", { name: /^Code$/ }).click());
      await waitFor(
        () =>
          expect(
            document.querySelector('[data-file-tree-file="src/hero/Hero.tsx"]'),
          ).not.toBeNull(),
        { timeout: 15_000 },
      );
      expect(unavailableSaid()).toEqual([]);
    });
  },
);
