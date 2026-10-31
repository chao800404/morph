import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveThemeRouteSections } from "@/lib/storefront/compiler/theme-route-sections";
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
 * Reproductions for the Design structure guard (handoff/2026-10-31/
 * guard-d-reorder-removal.md D3 and R3; server-structure-guard-proposal.md,
 * user decisions E).
 *
 * The route renders two sections inside a plain wrapper `<div>`, and two
 * ordinary elements after it. Design's ordinary element operations, the
 * layers-panel Delete and the canvas sibling reorder, rewrite the route file
 * through the shell's real handlers; only server functions and the preview
 * transport are mocked. Section structure is read with the real analysis,
 * `deriveThemeRouteSections`, not with component names.
 *
 * The tests named "today:" record what the shell does now. They are the
 * reproduction and are inverted by the fix: an ordinary element operation that
 * deletes or reorders a section call site, or an ancestor that wraps one, is
 * refused and nothing is written.
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

const ROUTE_PATH = "/guard";
const ROUTE_FILE = "src/routes/guard.tsx";

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
// Line numbers matter: the tests name elements by `line:column` of their
// opening tag, as the preview does for unmarked elements.
const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import GuardHero from "../components/sections/GuardHero";
import GuardBanner from "../components/sections/GuardBanner";

export const Route = createFileRoute("${ROUTE_PATH}")({
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
const AT = {
  wrapper: "13:7",
  hero: "14:9",
  banner: "15:9",
  note: "17:7",
  fine: "18:7",
} as const;

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
  file(ROUTE_FILE, ROUTE_SOURCE),
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
    {
      id: "template-guard",
      type: "page",
      name: "Guard",
      routePath: ROUTE_PATH,
      document: { version: 1, sections: [] },
      draftRevisionId: null,
      publishedRevisionId: null,
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const search = {
  template: "page",
  templateId: "template-guard",
  routePath: ROUTE_PATH,
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

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

/** Renders the route page and brings the frame up on it. */
async function settled() {
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
        search={search}
        onSearchChange={vi.fn()}
        navigatingRoutePath={ROUTE_PATH}
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
    routePath: ROUTE_PATH,
  });
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes: [],
    routePath: ROUTE_PATH,
  });
  await tick(50);
  // Precondition: both sections are in the route, in this order.
  expect(sectionIds(ROUTE_SOURCE)).toEqual(["hero", "banner"]);
  await waitFor(() =>
    expect(lastSectionsPanelProps?.onDeleteEditableNode).toBeTypeOf("function"),
  );
}

/** The route's sections as the real analysis reads them from `content`. */
function sectionIds(routeSource: string) {
  const files = FILES.map((entry) =>
    entry.path === ROUTE_FILE ? { ...entry, content: routeSource } : entry,
  );
  return deriveThemeRouteSections(files, ROUTE_FILE).sections.map(
    (section) => section.slotId,
  );
}

const sentSaves = () =>
  saveThemeFile.mock.calls.map(
    ([request]) =>
      (request as { data: { path: string; content: string } }).data,
  );

/**
 * A layers-panel row for a route-file element under the route's own root, as
 * the Live preview reports it (guard-d-reorder-removal.md D3): its section is
 * the route source itself.
 */
const routeElement = (key: keyof typeof AT): PreviewEditableNode => ({
  id: `route:${key}`,
  parentId: null,
  sectionId: ROUTE_FILE,
  label: key,
  kind: "custom",
  tagName: key === "wrapper" ? "div" : key === "note" ? "p" : "small",
  target: {
    sectionId: ROUTE_FILE,
    sourceLocation: `${ROUTE_FILE}:${AT[key]}`,
    isSection: false,
  },
});

async function deleteFromPanel(key: keyof typeof AT) {
  let result: unknown;
  await act(async () => {
    result = await lastSectionsPanelProps!.onDeleteEditableNode!(
      routeElement(key),
    );
  });
  await tick(100);
  return result as { success: boolean; message?: string };
}

async function siblingReorderFromFrame(
  dragged: keyof typeof AT,
  target: keyof typeof AT,
) {
  fromPreview({
    type: "morph:storefront-preview-commit-sibling-reorder",
    sectionId: ROUTE_FILE,
    sourceFilePath: ROUTE_FILE,
    draggedNodeId: AT[dragged],
    targetNodeId: AT[target],
  });
  await tick(100);
}

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
  it("today: deleting a wrapper that contains sections reaches the save and removes both sections", async () => {
    await settled();
    const result = await deleteFromPanel("wrapper");

    expect(result.success).toBe(true);
    expect(sentSaves()).toHaveLength(1);
    const [saved] = sentSaves();
    expect(saved?.path).toBe(ROUTE_FILE);
    expect(sectionIds(saved!.content)).toEqual([]);
    expect(saved!.content).toContain('<p className="note">');
  });

  it("deleting an ordinary element that wraps no section is saved, sections unchanged", async () => {
    await settled();
    const result = await deleteFromPanel("note");

    expect(result.success).toBe(true);
    expect(sentSaves()).toHaveLength(1);
    const [saved] = sentSaves();
    expect(saved?.path).toBe(ROUTE_FILE);
    expect(saved!.content).not.toContain("Plain note");
    expect(sectionIds(saved!.content)).toEqual(["hero", "banner"]);
  });

  it("reordering two ordinary siblings is saved, sections unchanged", async () => {
    await settled();
    await siblingReorderFromFrame("note", "fine");

    expect(sentSaves()).toHaveLength(1);
    const [saved] = sentSaves();
    expect(saved!.content.indexOf("Fine print")).toBeLessThan(
      saved!.content.indexOf("Plain note"),
    );
    expect(sectionIds(saved!.content)).toEqual(["hero", "banner"]);
  });

  it("today: a sibling reorder message naming two section call sites reaches the save and swaps the sections", async () => {
    // Not a message the bridge produces for this page (a section root reorders
    // through the section list, guard-d-reorder-removal.md R1); the shell takes
    // the iframe's file path and keys as given (R3).
    await settled();
    await siblingReorderFromFrame("hero", "banner");

    expect(sentSaves()).toHaveLength(1);
    const [saved] = sentSaves();
    expect(saved?.path).toBe(ROUTE_FILE);
    expect(sectionIds(saved!.content)).toEqual(["banner", "hero"]);
  });
});
