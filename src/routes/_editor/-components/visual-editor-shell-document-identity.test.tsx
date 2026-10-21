import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { PREVIEW_DOCUMENT_PROBE_BASE } from "@/lib/storefront/editor/preview-document-identity";
import { INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS } from "@/lib/storefront/editor/preview-instance-content";
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
  PREVIEW_OLDER_BRIDGE_RELOADED_MESSAGE,
  PREVIEW_RELOAD_CONTENT_UNREAD_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";

/**
 * C5 with document identity (A1): which preview document a message comes
 * from, and what an open inline edit holds back from the canvas.
 *
 * Every frame→editor message carries the id of the document that sent it
 * (`previewDocument`). Here the frame's window stays the same while the
 * document in it changes, as it does when the page reloads by itself (a
 * Theme source save, the diagnostic script's reload, a full-page link): the
 * origin, source and session checks cannot tell those documents apart, and
 * the id is what does.
 *
 * - While an inline edit is open, canvas posts are held and sent, in order,
 *   when it ends (`editing:false`).
 * - A ready from a new document ends an open edit as lost and discards what
 *   it held; the existing content replay sends the new document the editor's
 *   stored+pending content once the frame confirms its route.
 * - The same document's ready again is not a new document.
 * - Anything from a replaced document, from a document that has not said it
 *   is ready, or with no id while a verified document is current, is not
 *   taken as the current frame's.
 * - A frame with no id at all (an older bridge) is unverified: each of its
 *   readies is a replacement, and while a replay armed for a lost edit is
 *   unsettled another one is told with the existing notice.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";
const TYPED = "Typed on the canvas";
const DOC_A = "a".repeat(32);
const DOC_B = "b".repeat(32);
const DOC_C = "c".repeat(32);
const DOC_X = "e".repeat(32);

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
vi.mock("@/server/storefront/storefront-preview-media.serverFn", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  signThemePreviewMedia: vi.fn(),
}));
vi.mock("./editor-media-picker-popover", () => ({
  EditorMediaPickerPopover: () => null,
}));
// The real panel, with one button that reports live typing for the heading
// section, as an Inspector field bound to it does.
vi.mock("./editor-assistant-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor-assistant-panel")>();
  const RealPanel = actual.EditorAssistantPanel;
  return {
    ...actual,
    EditorAssistantPanel: (props: ComponentProps<typeof RealPanel>) => (
      <>
        <RealPanel {...props} />
        <button
          type="button"
          onClick={() =>
            props.onPreviewSelectionField?.("hero", "heading", "heading", "From the panel")
          }
        >
          Type for the hero
        </button>
      </>
    ),
  };
});
vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(),
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

const search = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

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

const routeFile = {
  id: "file-index",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path: "src/routes/index.tsx",
  content: "export default function Index() { return <main />; }\n",
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};
const tree = () => ({
  files: [routeFile],
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
          children: [{ name: "index.tsx", path: routeFile.path, isDirectory: false }],
        },
      ],
    },
  ],
  sourceGeneration: 1,
  latestPublishedRevision: null,
});

const SAVED = { success: true, data: { draftGeneration: 2, droppedProps: [] } };

const infoLines: string[] = [];

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  return render(
    <QueryClientProvider client={client}>
      <VisualEditorShell context={context} search={search} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

/**
 * The document active in the frame now: the one a post to the frame's
 * window reaches, and so the one that answers a ping. A real reload makes
 * the new document active (`ready`); a stale document's late ready does not
 * (`staleReady`).
 */
let active: string | null = null;
/** Pings this frame has answered, and whether it answers at all for now. */
let answeredPings = 0;
let pongsHeld = false;

function dispatchFrom(id: string | null, data: Record<string, unknown>) {
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ...data,
          previewSession: PREVIEW_SESSION,
          ...(id === null ? {} : { previewDocument: id }),
        },
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
}

/** The active document answers every ping it has not answered yet, as a live bridge does. */
function answerPings() {
  if (pongsHeld) return;
  const pings = posted().filter((message) => message.type === "morph:storefront-preview-ping");
  for (const ping of pings.slice(answeredPings)) {
    answeredPings += 1;
    dispatchFrom(active, { type: "morph:storefront-preview-pong", heartbeatId: ping.heartbeatId });
  }
}

/** A message from the document `id` in the frame (null: one with no id). */
function fromDocument(id: string | null, data: Record<string, unknown>) {
  dispatchFrom(id, data);
  answerPings();
}

/** Lets the active document answer again, answering what it held back. */
function releasePongs() {
  pongsHeld = false;
  answerPings();
}

const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

type Posted = {
  type: string;
  sectionId?: string;
  props?: Record<string, unknown>;
  enabled?: boolean;
  value?: string;
  routePath?: string | null;
  routeRequestId?: number;
  heartbeatId?: number;
};
const posted = () =>
  vi.mocked(postEditorToPreviewMessage).mock.calls.map(([, message]) => message as Posted);
const canvasPosts = (from: number) =>
  posted()
    .slice(from)
    .filter(
      (message) =>
        message.type === "morph:storefront-preview-update-section-props" ||
        message.type === "morph:storefront-preview-update-selection-field",
    );
const heroPosts = (from: number) =>
  canvasPosts(from).filter(
    (message) =>
      message.type === "morph:storefront-preview-update-section-props" &&
      message.sectionId === "hero",
  );
const routeRequests = () =>
  posted().filter((message) => message.type === "morph:storefront-preview-set-route");
const replayedLines = () =>
  infoLines.filter((line) => line.startsWith("[preview-instance] content replayed"));
const droppedLines = () =>
  infoLines.filter((line) => line.startsWith("[preview-instance] content replay dropped"));
const unreadNotices = () =>
  vi
    .mocked(toast.warning)
    .mock.calls.filter((call) => call[0] === PREVIEW_RELOAD_CONTENT_UNREAD_MESSAGE);

/** The document says it is ready, as a current bridge does, being the one now active. */
async function ready(id: string | null) {
  active = id;
  await staleReady(id);
}

/** A ready from document `id` that is not the active one: one sent before it was replaced. */
async function staleReady(id: string | null) {
  fromDocument(id, {
    type: "morph:storefront-preview-ready",
    capabilities: ["selection-field-section"],
  });
  await tick(0);
  await tick(0);
}

/** The document answers the editor's latest route request: it is on "/". */
function answerRoute(id: string | null) {
  fromDocument(id, {
    type: "morph:storefront-preview-route-applied",
    routeRequestId: routeRequests().at(-1)?.routeRequestId,
    routePath: "/",
  });
}

/** Renders, selects the heading, opens Content, brings document `id` up and on its route. */
async function frameUp(id: string | null) {
  renderShell();
  // Before any ready, as a page reports its structure.
  fromDocument(id, { type: "morph:storefront-preview-structure", nodes: [heroNode] });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
  fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
  await screen.findByDisplayValue("Welcome");
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  await ready(id);
  answerRoute(id);
  await tick(0);
}

const editing = (id: string | null, open: boolean) =>
  fromDocument(id, { type: "morph:storefront-preview-inline-text-editing", editing: open });

/** The page's commit of the heading, typed over the stored "Welcome". */
const commit = (id: string | null, value = TYPED) =>
  fromDocument(id, {
    type: "morph:storefront-preview-commit-inline-text",
    sectionId: "hero",
    fieldKey: "heading",
    fieldPath: "heading",
    value,
    originalValue: "Welcome",
  });

/** Answers heartbeats from document `id` while `ms` pass. */
async function live(id: string | null, ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 5_000) {
    await tick(5_000);
    const ping = posted()
      .filter((message) => message.type === "morph:storefront-preview-ping")
      .at(-1);
    if (ping) {
      fromDocument(id, { type: "morph:storefront-preview-pong", heartbeatId: ping.heartbeatId });
    }
  }
}

beforeEach(() => {
  infoLines.length = 0;
  active = null;
  answeredPings = 0;
  pongsHeld = false;
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
  getThemeEditor.mockResolvedValue({ success: true, message: "ok", data: context });
  updateSectionProps.mockReset();
  updateSectionProps.mockResolvedValue(SAVED);
  vi.mocked(postEditorToPreviewMessage).mockReset();
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(console, "info").mockImplementation((...args) => {
    infoLines.push(String(args[0]));
  });
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
  vi.mocked(applyThemePreviewFiles).mockImplementation(async (request: unknown) => {
    const files = (request as { data: { files: Array<{ path: string }> } }).data.files;
    return {
      success: true,
      message: "Live Preview files written",
      data: {
        previewId: "preview-1",
        changed: [],
        unchanged: files.map((file) => file.path),
        skipped: [],
        servedInstance: { session: SESSION, serial: 1 },
      },
    } as never;
  });
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

describe("canvas posts while an inline edit is open (C5)", () => {
  it("holds the commit's canvas post until the edit ends, then sends it once", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    // Held: nothing reaches the canvas while the page is being typed in.
    expect(canvasPosts(from)).toEqual([]);
    editing(DOC_A, false);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    // The write goes as it always does.
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("M1: replays held posts in their original order across message kinds", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    // Live typing in the Inspector for the selected heading, then the commit.
    fireEvent.click(screen.getByRole("button", { name: "Type for the hero" }));
    await tick(0);
    commit(DOC_A);
    await tick(0);
    expect(canvasPosts(from)).toEqual([]);
    editing(DOC_A, false);
    await tick(0);
    expect(
      canvasPosts(from).map((message) =>
        message.type === "morph:storefront-preview-update-selection-field"
          ? `field:${message.sectionId}:${message.value}`
          : `section:${message.sectionId}:${String(message.props?.heading)}`,
      ),
    ).toEqual(["field:hero:From the panel", `section:hero:${TYPED}`]);
  });
});

describe("a ready from a new document while an edit is open", () => {
  it("ends the edit as lost, discards what it held, and replays stored+pending only after the route is confirmed", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    expect(canvasPosts(from)).toEqual([]);

    // The page reloads by itself: same window, a new document.
    const requestsBefore = routeRequests().length;
    await ready(DOC_B);
    expect(routeRequests().length).toBe(requestsBefore + 1);
    // Nothing before the new document confirms its route: not the held post,
    // not the replay. A structure report is no confirmation either.
    fromDocument(DOC_B, {
      type: "morph:storefront-preview-structure",
      nodes: [heroNode],
      routePath: "/",
    });
    await tick(0);
    await tick(0);
    expect(canvasPosts(from)).toEqual([]);

    answerRoute(DOC_B);
    await tick(0);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    expect(replayedLines()).toHaveLength(1);

    // The edit was lost with its document: a late close from it posts nothing.
    editing(DOC_A, false);
    await tick(0);
    expect(heroPosts(from)).toHaveLength(1);
    // Nothing was saved twice, and the commit's write still goes.
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(unreadNotices()).toEqual([]);
  });

  it("an old document's late ready or answer never overrides the newer document's replay", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    await ready(DOC_B);
    const requests = routeRequests().length;

    // A late ready from the replaced document: not a new round, no new route.
    await staleReady(DOC_A);
    expect(routeRequests()).toHaveLength(requests);
    // Its answer to the new document's request releases nothing.
    answerRoute(DOC_A);
    await tick(0);
    await tick(0);
    expect(canvasPosts(from)).toEqual([]);
    expect(droppedLines()).toEqual([]);

    answerRoute(DOC_B);
    await tick(0);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    expect(replayedLines()).toHaveLength(1);
  });

  it("gives up with the existing notice, sending nothing, when the content read fails", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    getThemeEditor.mockResolvedValue({ success: false, message: "offline" });
    await ready(DOC_B);
    answerRoute(DOC_B);
    await tick(0);
    await tick(0);
    expect(heroPosts(from)).toEqual([]);
    expect(unreadNotices()).toHaveLength(1);
    // No retry, no resend.
    answerRoute(DOC_B);
    await live(DOC_B, 10_000);
    expect(heroPosts(from)).toEqual([]);
    expect(unreadNotices()).toHaveLength(1);
  });

  it("gives up with the existing notice when the new document never confirms its route", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    await ready(DOC_B);
    await live(DOC_B, INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS + 5_000);
    expect(heroPosts(from)).toEqual([]);
    expect(unreadNotices()).toHaveLength(1);
    answerRoute(DOC_B);
    await tick(0);
    expect(heroPosts(from)).toEqual([]);
  });
});

describe("the same document's ready again", () => {
  it("is not a new document: the edit stays open, what it held is kept, and nothing is replayed", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    const requests = routeRequests().length;
    await ready(DOC_A);
    expect(routeRequests()).toHaveLength(requests);
    expect(canvasPosts(from)).toEqual([]);
    editing(DOC_A, false);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    expect(replayedLines()).toEqual([]);
  });
});

describe("a message from a document that is not the current one", () => {
  it("id mismatch: a commit from a document that has not said it is ready is refused", async () => {
    await frameUp(DOC_A);
    commit(DOC_C);
    await tick(400);
    expect(updateSectionProps).not.toHaveBeenCalled();
    // The current document's own commit is taken.
    commit(DOC_A);
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("absent id: never equals the current document's, so it is refused", async () => {
    await frameUp(DOC_A);
    commit(null);
    await tick(400);
    expect(updateSectionProps).not.toHaveBeenCalled();
    // An edit opened without an id is not the current document's either.
    editing(null, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    expect(heroPosts(from)).toHaveLength(1);
  });

  it("replaced: a commit from the document the frame was before is refused", async () => {
    await frameUp(DOC_A);
    await ready(DOC_B);
    answerRoute(DOC_B);
    await tick(0);
    commit(DOC_A);
    await tick(400);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });
});

describe("a frame whose bridge sends no id (an older bridge)", () => {
  it("takes its messages as before", async () => {
    await frameUp(null);
    const from = posted().length;
    commit(null);
    await tick(0);
    expect(heroPosts(from)).toHaveLength(1);
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("does not take a later id-less ready on the same frame: the open edit and what it held stay, nothing is replayed, and the author is told once", async () => {
    await frameUp(null);
    editing(null, true);
    await tick(0);
    const from = posted().length;
    commit(null);
    await tick(0);
    const requests = routeRequests().length;
    await ready(null);
    // Not taken: no new round, nothing sent, nothing replayed.
    expect(routeRequests()).toHaveLength(requests);
    expect(canvasPosts(from)).toEqual([]);
    expect(screen.getAllByText(PREVIEW_OLDER_BRIDGE_RELOADED_MESSAGE)).toHaveLength(1);
    // The edit is still the editor's: its close sends what it held.
    editing(null, false);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    expect(replayedLines()).toEqual([]);
    // Told once, however many such readies come.
    await ready(null);
    expect(screen.getAllByText(PREVIEW_OLDER_BRIDGE_RELOADED_MESSAGE)).toHaveLength(1);
    // A status near the preview, never a toast or an automatic reload.
    expect(unreadNotices()).toEqual([]);
    expect(routeRequests()).toHaveLength(requests);
  });

  it("does not take an id-less ready while a verified document is current", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    const requests = routeRequests().length;
    await staleReady(null);
    expect(routeRequests()).toHaveLength(requests);
    expect(canvasPosts(from)).toEqual([]);
    editing(DOC_A, false);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
  });
});

/**
 * Option A (2026-10-20): a ready becomes the current document only once the
 * editor has asked the frame who is active, with the existing ping, and the
 * active document's pong names it. A post to the frame's window reaches only
 * the document active in it, so a stale document's late ready is answered by
 * another document and is never taken.
 */
describe("a ready the editor has not confirmed", () => {
  const idOf = (index: number) => index.toString(16).padStart(32, "0");

  it("test 1, same-iframe reload: the new document is taken once it answers, and the old one's later messages are refused", async () => {
    await frameUp(DOC_A);
    const requests = routeRequests().length;
    const before = posted().length;
    await ready(DOC_B);
    // The editor asked, in its own id range, and the active document answered.
    expect(
      posted()
        .slice(before)
        .filter(
          (message) =>
            message.type === "morph:storefront-preview-ping" &&
            (message.heartbeatId ?? 0) > PREVIEW_DOCUMENT_PROBE_BASE,
        ),
    ).toHaveLength(1);
    expect(routeRequests()).toHaveLength(requests + 1);
    answerRoute(DOC_B);
    await tick(0);
    commit(DOC_A);
    await tick(400);
    expect(updateSectionProps).not.toHaveBeenCalled();
    commit(DOC_B);
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("test 2, an old document's first ready arriving late does not end the open edit or take over the frame", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    const requests = routeRequests().length;
    // X loaded before A; its ready only now reaches the editor. A is active.
    await staleReady(DOC_X);
    expect(routeRequests()).toHaveLength(requests);
    expect(canvasPosts(from)).toEqual([]);
    // A is still the frame's document: its close sends what the edit held.
    editing(DOC_A, false);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    expect(replayedLines()).toEqual([]);
    // And X's own messages are not taken.
    commit(DOC_X, "From the stale document");
    await tick(400);
    expect(
      updateSectionProps.mock.calls.some((call) =>
        JSON.stringify(call).includes("From the stale document"),
      ),
    ).toBe(false);
  });

  it("test 2, an old document's first ready arriving late does not cancel a valid replay", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    // A real reload: B is active, its replay is armed and waits for its route.
    await ready(DOC_B);
    const requests = routeRequests().length;
    await staleReady(DOC_X);
    expect(routeRequests()).toHaveLength(requests);
    answerRoute(DOC_B);
    await tick(0);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    expect(replayedLines()).toHaveLength(1);
    expect(droppedLines()).toEqual([]);
  });

  it("test 3, an old id back after the memory cap does not end the open edit or take over the frame", async () => {
    await frameUp(idOf(0));
    for (let index = 1; index <= 65; index += 1) {
      await ready(idOf(index));
    }
    answerRoute(idOf(65));
    await tick(0);
    editing(idOf(65), true);
    await tick(0);
    const from = posted().length;
    commit(idOf(65));
    await tick(0);
    const requests = routeRequests().length;
    await staleReady(idOf(0));
    expect(routeRequests()).toHaveLength(requests);
    expect(canvasPosts(from)).toEqual([]);
    editing(idOf(65), false);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    expect(replayedLines()).toEqual([]);
  });

  it("does not take a candidate's own messages before it is confirmed", async () => {
    await frameUp(DOC_A);
    pongsHeld = true;
    await ready(DOC_B);
    // B's word is not taken yet: its edit does not open, and A is still the
    // frame's document, whose commit is posted at once.
    editing(DOC_B, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    // Once B answers, it is the frame's document: a new round, its route sent.
    const requests = routeRequests().length;
    releasePongs();
    await tick(0);
    await tick(0);
    expect(routeRequests()).toHaveLength(requests + 1);
  });

  it("drops a candidate not confirmed within 5 seconds, changing nothing", async () => {
    // The commit's write stays unanswered, so what the edit holds is still
    // pending when it is sent.
    updateSectionProps.mockImplementation(() => new Promise(() => {}));
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    const from = posted().length;
    commit(DOC_A);
    await tick(0);
    const requests = routeRequests().length;
    pongsHeld = true;
    await ready(DOC_B);
    await tick(6_000);
    // Its answer comes too late to confirm anything.
    releasePongs();
    await tick(0);
    expect(routeRequests()).toHaveLength(requests);
    active = DOC_A;
    editing(DOC_A, false);
    await tick(0);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
  });

  it("lets a second candidate replace the first", async () => {
    await frameUp(DOC_A);
    const requests = routeRequests().length;
    pongsHeld = true;
    await ready(DOC_B);
    await ready(DOC_C);
    releasePongs();
    await tick(0);
    await tick(0);
    // One new round, for C.
    expect(routeRequests()).toHaveLength(requests + 1);
    answerRoute(DOC_C);
    await tick(0);
    commit(DOC_C);
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("settles a replay that replayed: a later document with no edit open replays nothing", async () => {
    await frameUp(DOC_A);
    editing(DOC_A, true);
    await tick(0);
    commit(DOC_A);
    await tick(0);
    await ready(DOC_B);
    answerRoute(DOC_B);
    await tick(0);
    await tick(0);
    expect(replayedLines()).toHaveLength(1);
    await ready(DOC_C);
    answerRoute(DOC_C);
    await tick(0);
    await tick(0);
    expect(replayedLines()).toHaveLength(1);
  });
});
