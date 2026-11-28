import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
} from "@/lib/storefront/default-storefront-document";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  createLiveFrame,
  frameEnvelope,
  sendFrameReady,
} from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * "Maximum update depth exceeded" from the editor, in E2E runs that open the
 * editor while its frame is busy (recovery-editor-writes, and the stalled
 * open of 11-20). React says it when 50 passive-effect flushes in a row each
 * schedule an update. Two shell effects did that after every commit, because
 * each depended on a value built anew on every render:
 *
 * - the server-state effect, on `livePreviewSecurity`: its lifecycle dispatch
 *   always schedules a render (a reducer has no eager bailout), even though
 *   the reducer then returns the same state;
 * - the comment-group effect, on a fresh `[]` while there are no groups: its
 *   `setActiveGroupId(null)` is not bailed out eagerly while the shell has
 *   other work pending.
 *
 * Alone each only costs one more render. While the frame's answers arrive
 * faster than the shell renders, that render also takes the next answer, so
 * it commits for real and the count never resets. The real starter is used so
 * the shell renders as much as it does in the browser.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const ADDRESS = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION };
const liveFrame = createLiveFrame(ADDRESS);
const PAGE_ID = "00000000-0000-4000-8000-000000000004";
const LAYOUT_ID = "00000000-0000-4000-8000-000000000006";
const UPDATE_DEPTH = /Maximum update depth exceeded/;

const posted: Array<Record<string, unknown>> = [];
/** Lifecycle events, in order, as the shell's reducer receives them. */
const lifecycleEvents = vi.hoisted(() => [] as Array<{ type: string }>);

vi.mock("./live-preview-lifecycle", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./live-preview-lifecycle")>();
  return {
    ...actual,
    reduceLivePreviewLifecycle: (
      state: Parameters<typeof actual.reduceLivePreviewLifecycle>[0],
      event: Parameters<typeof actual.reduceLivePreviewLifecycle>[1],
    ) => {
      lifecycleEvents.push(event);
      return actual.reduceLivePreviewLifecycle(state, event);
    },
  };
});
vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: vi.fn(() => new Promise<never>(() => {})),
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
  Link: ({ to, children, ...rest }: { to?: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const context = {
  previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
  storefront: { id: "storefront-1", name: "Store", domain: null, status: "active" },
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
  templates: [
    {
      id: PAGE_ID,
      type: "index",
      name: "Home",
      document: createDefaultStorefrontHomeDocument(),
      draftGeneration: 1,
      version: 1,
    },
    {
      id: LAYOUT_ID,
      type: "layout",
      name: "Layout",
      document: createDefaultStorefrontLayoutDocument(),
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const search = {
  template: "index",
  templateId: PAGE_ID,
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

type TreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
};
function fileTree(paths: readonly string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of paths) {
    const parts = path.split("/");
    let level = root;
    parts.forEach((name, index) => {
      const isDirectory = index < parts.length - 1;
      let node = level.find((candidate) => candidate.name === name);
      if (!node) {
        node = {
          name,
          path: parts.slice(0, index + 1).join("/"),
          isDirectory,
          ...(isDirectory ? { children: [] } : {}),
        };
        level.push(node);
      }
      level = node.children ?? [];
    });
  }
  return root;
}

function readyClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
    { success: true, message: "ok", data: context } as never,
  );
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    } as never,
  );
  const files = STARTER_THEME_FILES.map((file, index) => ({
    id: `file-${index}`,
    storefrontId: "storefront-1",
    themeId: "theme-1",
    path: file.path,
    content: file.content,
    mimeType: file.path.endsWith(".json")
      ? "application/json"
      : "text/typescript",
    isEntry: false,
    version: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  }));
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    {
      files,
      tree: fileTree(files.map((file) => file.path)),
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  return client;
}

const SECTION_IDS = [
  "starter-header",
  "starter-hero",
  "starter-introduction",
  "starter-categories",
  "starter-story",
  "starter-principles",
  "starter-newsletter",
  "starter-footer",
];

function fromPreview(data: Record<string, unknown>) {
  liveFrame.before(data);
  act(() => {
    window.dispatchEvent(previewEvent(data));
  });
  liveFrame.after(data);
}

function previewEvent(data: Record<string, unknown>) {
  return new MessageEvent("message", {
    data: frameEnvelope({ ...data, previewSession: PREVIEW_SESSION }),
    origin: PREVIEW_ORIGIN,
    source: document.querySelector("iframe")?.contentWindow ?? null,
  });
}

/** The frame's answer to the editor's latest size request. */
function sizeAnswer(height: number) {
  const asked = posted
    .filter((message) => message.type === "morph:storefront-preview-request-size")
    .at(-1) as { measurementRevision?: number } | undefined;
  return {
    type: "morph:storefront-preview-size",
    height,
    measurementRevision: asked?.measurementRevision ?? 0,
  };
}

const updateDepthWarnings = () =>
  vi
    .mocked(console.error)
    .mock.calls.filter((call) => UPDATE_DEPTH.test(String(call[0]))).length;

/** The editor open on the starter, its frame up and on the page. */
async function openEditor() {
  render(
    <QueryClientProvider client={readyClient()}>
      <VisualEditorShell
        context={context}
        search={search}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
  sendFrameReady(ADDRESS);
  fromPreview({
    type: "morph:storefront-preview-structure",
    routePath: "/",
    nodes: SECTION_IDS.map((sectionId) => ({
      id: `${sectionId}:root`,
      parentId: null,
      sectionId,
      label: sectionId,
      kind: "section",
      tagName: "section",
      target: { sectionId, nodeId: `${sectionId}:root`, isSection: true },
    })),
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 1_000)));
}

beforeEach(() => {
  posted.length = 0;
  lifecycleEvents.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore
    .getState()
    .setBaseSourceGeneration(1, { storefrontId: "storefront-1", themeId: "theme-1" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a shell commit schedules no further update of its own", () => {
  it("a commit that changes nothing about the preview server dispatches nothing to the lifecycle", { timeout: 60_000 }, async () => {
    await openEditor();
    const before = lifecycleEvents.length;

    for (let index = 0; index < 5; index += 1) {
      fromPreview(sizeAnswer(4_000 + index));
    }

    const after = lifecycleEvents.slice(before).map((event) => event.type);
    // Each answer is a frame signal; nothing tells the server state again.
    expect(after.filter((type) => type === "server-ready")).toEqual([]);
    expect(after.filter((type) => type === "frame-signal")).toHaveLength(5);
  });

  it("answers arriving faster than the shell renders do not set off React's update-depth warning", { timeout: 60_000 }, async () => {
    await openEditor();
    expect(updateDepthWarnings(), "none while opening").toBe(0);

    // Outside act, as a browser delivers them: each answer is queued while
    // the shell is still rendering the one before it.
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      let height = 4_000;
      const until = Date.now() + 5_000;
      await new Promise<void>((resolve) => {
        const answer = () => {
          if (Date.now() > until) return resolve();
          height += 1;
          window.dispatchEvent(previewEvent(sizeAnswer(height)));
          setTimeout(answer, 1);
        };
        answer();
      });
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = true;
    }
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

    expect(updateDepthWarnings()).toBe(0);
  });
});
