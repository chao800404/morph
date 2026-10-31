import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveThemeRouteSections,
  themeRouteStructureLock,
} from "@/lib/storefront/compiler/theme-route-sections";
import { DESIGN_ELEMENT_SECTIONS_MESSAGE } from "@/lib/storefront/compiler/design-element-operation";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import {
  postEditorToPreviewMessage,
  type PreviewEditableNode,
} from "@/lib/storefront/editor/preview-protocol";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
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
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * Design's ordinary element edits and the route's section structure
 * (handoff/2026-10-31/guard-d-reorder-removal.md D3 and R3;
 * server-structure-guard-proposal.md, user decisions E).
 *
 * The open route renders two sections inside a plain wrapper `<div>` and two
 * ordinary elements after it; the locked route reads its one section through
 * its loader. The layers-panel Delete and the canvas sibling reorder run
 * through the shell's real handlers; only server functions and the preview
 * transport are mocked, so these tests show what the shell sends, not what
 * the database accepts (storefront-theme-files-design-element.test.ts covers
 * the server on real SQL). Sections are read with the real analysis,
 * `deriveThemeRouteSections`, never with component names.
 *
 * 830b51c reproduced the two refusals below as saves that removed or swapped
 * the sections. An edit that deletes or moves a section call site, or an
 * element containing one, is refused before anything is sent; an edit of
 * ordinary elements only is still saved, on a locked route too.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const saveThemeFile = vi.hoisted(() => vi.fn());
let lastSectionsPanelProps: ComponentProps<
  typeof import("./editor-sections-panel").EditorSectionsPanel
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
// The real panel; its props are recorded so a test can reach the shell's own
// delete handler with a node, as the panel's confirmed Delete does.
vi.mock("./editor-sections-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-sections-panel")>();
  const RealPanel = actual.EditorSectionsPanel;
  return {
    ...actual,
    EditorSectionsPanel: (props: ComponentProps<typeof RealPanel>) => {
      lastSectionsPanelProps = props;
      return <RealPanel {...props} />;
    },
  };
});

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
type Fixture = Readonly<{
  routePath: string;
  routeFile: string;
  templateId: string;
  source: string;
  at: Readonly<Record<string, string>>;
}>;

// Line numbers matter: the tests name elements by `line:column` of their
// opening tag, as the preview does for unmarked elements.
const OPEN: Fixture = {
  routePath: "/guard",
  routeFile: "src/routes/guard.tsx",
  templateId: "template-guard",
  source: `import { createFileRoute } from "@tanstack/react-router";
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
`,
  at: {
    wrapper: "13:7",
    hero: "14:9",
    banner: "15:9",
    note: "17:7",
    fine: "18:7",
  },
};

/** A route whose section comes from its loader: its structure is locked. */
const LOCKED: Fixture = {
  routePath: "/guard-locked",
  routeFile: "src/routes/guard-locked.tsx",
  templateId: "template-guard-locked",
  source: `import { createFileRoute } from "@tanstack/react-router";
import GuardHero from "../components/sections/GuardHero";
import { getGuardPage } from "../server/guard";

export const Route = createFileRoute("/guard-locked")({
  loader: () => getGuardPage(),
  component: GuardLockedRoute,
});

function GuardLockedRoute() {
  const page = Route.useLoaderData();
  return (
    <main>
      <GuardHero {...page.hero} />
      <p className="note">Plain note</p>
      <small className="fine">Fine print</small>
    </main>
  );
}
`,
  at: { hero: "14:7", note: "15:7", fine: "16:7" },
};
const LOCKED_DATA = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";

export const getGuardPage = createServerFn().handler(() =>
  morph.pages.get("/guard-locked"),
);
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
  file("src/server/guard.ts", LOCKED_DATA),
  file(OPEN.routeFile, OPEN.source),
  file(LOCKED.routeFile, LOCKED.source),
];
const TREE = {
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
  sourceGeneration: 3,
  latestPublishedRevision: null,
};

const pageTemplate = (fixture: Fixture) => ({
  id: fixture.templateId,
  type: "page",
  name: fixture.routePath,
  routePath: fixture.routePath,
  document: { version: 1, sections: [] },
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
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 3 },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      document: { version: 1, sections: [] },
      draftGeneration: 1,
      version: 1,
    },
    pageTemplate(OPEN),
    pageTemplate(LOCKED),
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
const tick = (ms = 20) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** The route's sections, as the real analysis reads them from `source`. */
function sectionIds(fixture: Fixture, source: string) {
  const files = FILES.map((entry) =>
    entry.path === fixture.routeFile ? { ...entry, content: source } : entry,
  );
  return deriveThemeRouteSections(files, fixture.routeFile).sections.map(
    (section) => section.slotId,
  );
}

/** Renders the fixture's page and brings the frame up on it. */
async function settled(fixture: Fixture) {
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
    TREE as never,
  );
  render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={
          {
            template: "page",
            templateId: fixture.templateId,
            routePath: fixture.routePath,
            viewport: "desktop",
          } as StorefrontThemeEditorSearch
        }
        onSearchChange={vi.fn()}
        navigatingRoutePath={fixture.routePath}
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
  });
  await tick(0);
  const request = log
    .filter((message) => message.type === "morph:storefront-preview-set-route")
    .at(-1);
  fromPreview({
    type: "morph:storefront-preview-route-applied",
    routeRequestId: request?.routeRequestId,
    routePath: fixture.routePath,
  });
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes: [],
    routePath: fixture.routePath,
  });
  await waitFor(() =>
    expect(lastSectionsPanelProps?.onDeleteEditableNode).toBeTypeOf("function"),
  );
}

const sentSaves = () =>
  saveThemeFile.mock.calls.map(
    ([request]) =>
      (
        request as {
          data: {
            path: string;
            content: string;
            operation?: string;
            designElement?: unknown;
          };
        }
      ).data,
  );
const localContent = (fixture: Fixture) =>
  useThemeWorkspaceStore
    .getState()
    .getWorkspaceFiles("storefront-1", "theme-1")[fixture.routeFile]
    ?.localContent ?? fixture.source;

/**
 * A layers-panel row for a route-file element under the route's own root, as
 * the Live preview reports it (guard-d-reorder-removal.md D3): its section is
 * the route source itself.
 */
const routeElement = (fixture: Fixture, key: string): PreviewEditableNode => ({
  id: `route:${key}`,
  parentId: null,
  sectionId: fixture.routeFile,
  label: key,
  kind: "custom",
  tagName: "div",
  target: {
    sectionId: fixture.routeFile,
    sourceLocation: `${fixture.routeFile}:${fixture.at[key]}`,
    isSection: false,
  },
});

/** The panel's confirmed Delete; resolves with the shell's own answer. */
async function deleteFromPanel(fixture: Fixture, key: string) {
  let result: unknown;
  await act(async () => {
    result = await lastSectionsPanelProps!.onDeleteEditableNode!(
      routeElement(fixture, key),
    );
  });
  return result as { success: boolean; message?: string };
}

function siblingReorderFromFrame(
  fixture: Fixture,
  dragged: string,
  target: string,
) {
  fromPreview({
    type: "morph:storefront-preview-commit-sibling-reorder",
    sectionId: fixture.routeFile,
    sourceFilePath: fixture.routeFile,
    draggedNodeId: fixture.at[dragged],
    targetNodeId: fixture.at[target],
  });
}

const warned = (message: string) =>
  vi.mocked(toast.warning).mock.calls.some((call) => call[0] === message);

beforeEach(() => {
  log = [];
  lastSectionsPanelProps = null;
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(3, {
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
  saveThemeFile.mockReset();
  saveThemeFile.mockImplementation(
    async (request: { data: { path: string; content: string } }) => ({
      success: true,
      message: "saved",
      data: {
        ...file(request.data.path, request.data.content, 2),
        sourceGeneration: 4,
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
    async () => ({ success: true, message: "ok", data: TREE }) as never,
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

describe("Design element operations and the route's section structure", () => {
  it("precondition: the open route has two sections and no lock; the loader route has one and is locked", () => {
    expect(sectionIds(OPEN, OPEN.source)).toEqual(["hero", "banner"]);
    expect(themeRouteStructureLock(FILES, OPEN.routeFile)).toBeNull();
    expect(sectionIds(LOCKED, LOCKED.source)).toHaveLength(1);
    expect(themeRouteStructureLock(FILES, LOCKED.routeFile)).toMatch(
      /route loader/,
    );
  });

  // Reproduced by 830b51c: this delete reached the save and removed both.
  it("deleting a wrapper that contains sections is refused: nothing is sent, the route and its sections are unchanged", async () => {
    await settled(OPEN);
    const result = await deleteFromPanel(OPEN, "wrapper");

    expect(result).toEqual({
      success: false,
      message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
    });
    expect(sentSaves()).toEqual([]);
    expect(localContent(OPEN)).toBe(OPEN.source);
    expect(sectionIds(OPEN, localContent(OPEN))).toEqual(["hero", "banner"]);
  });

  // Reproduced by 830b51c: this message reached the save and swapped them.
  it("a sibling reorder message naming two section call sites is refused: nothing is sent, the order is unchanged", async () => {
    // Not a message the bridge produces for this page (a section root reorders
    // through the section list, guard-d-reorder-removal.md R1); the shell no
    // longer takes the iframe's file path and keys as an ordinary reorder (R3).
    await settled(OPEN);
    siblingReorderFromFrame(OPEN, "hero", "banner");
    await waitFor(() =>
      expect(warned(DESIGN_ELEMENT_SECTIONS_MESSAGE)).toBe(true),
    );

    expect(sentSaves()).toEqual([]);
    expect(localContent(OPEN)).toBe(OPEN.source);
    expect(sectionIds(OPEN, localContent(OPEN))).toEqual(["hero", "banner"]);
  });

  it("reordering the wrapper that contains sections with an ordinary sibling is refused", async () => {
    await settled(OPEN);
    siblingReorderFromFrame(OPEN, "wrapper", "note");
    await waitFor(() =>
      expect(warned(DESIGN_ELEMENT_SECTIONS_MESSAGE)).toBe(true),
    );

    expect(sentSaves()).toEqual([]);
    expect(localContent(OPEN)).toBe(OPEN.source);
  });

  for (const fixture of [OPEN, LOCKED]) {
    const label =
      fixture === LOCKED ? "on the locked loader route" : "on the open route";

    it(`deleting an ordinary element is saved as a Design element edit, sections unchanged, ${label}`, async () => {
      await settled(fixture);
      const sectionsBefore = sectionIds(fixture, fixture.source);
      const result = await deleteFromPanel(fixture, "note");

      expect(result).toEqual({ success: true });
      expect(sentSaves()).toHaveLength(1);
      const [saved] = sentSaves();
      expect(saved?.path).toBe(fixture.routeFile);
      expect(saved?.operation).toBe("design-element");
      expect(saved?.designElement).toEqual({
        kind: "remove-element",
        targetKey: fixture.at.note,
      });
      expect(saved!.content).not.toContain("Plain note");
      expect(sectionIds(fixture, saved!.content)).toEqual(sectionsBefore);
    });

    it(`reordering two ordinary siblings is saved as a Design element edit, sections unchanged, ${label}`, async () => {
      await settled(fixture);
      const sectionsBefore = sectionIds(fixture, fixture.source);
      siblingReorderFromFrame(fixture, "note", "fine");
      await waitFor(() => expect(sentSaves()).toHaveLength(1));

      const [saved] = sentSaves();
      expect(saved?.operation).toBe("design-element");
      expect(saved?.designElement).toEqual({
        kind: "swap-siblings",
        firstKey: fixture.at.note,
        secondKey: fixture.at.fine,
      });
      expect(saved!.content.indexOf("Fine print")).toBeLessThan(
        saved!.content.indexOf("Plain note"),
      );
      expect(sectionIds(fixture, saved!.content)).toEqual(sectionsBefore);
    });
  }

  it("deleting the loader-bound section call site of the locked route is refused", async () => {
    await settled(LOCKED);
    const result = await deleteFromPanel(LOCKED, "hero");

    expect(result.success).toBe(false);
    expect(result.message).toBe(DESIGN_ELEMENT_SECTIONS_MESSAGE);
    expect(sentSaves()).toEqual([]);
    expect(localContent(LOCKED)).toBe(LOCKED.source);
  });

  it("a server refusal of a Design element edit puts the file back and says why", async () => {
    saveThemeFile.mockImplementation(async () => ({
      success: false,
      error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
      message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
    }));
    await settled(OPEN);
    const result = await deleteFromPanel(OPEN, "note");

    expect(sentSaves()).toHaveLength(1);
    expect(result).toEqual({
      success: false,
      message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
    });
    expect(localContent(OPEN)).toBe(OPEN.source);
  });
});
