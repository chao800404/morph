import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS } from "@/lib/storefront/editor/preview-instance-content";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { listStorefrontThemeFiles } from "@/server/storefront/storefront-theme-files.serverFn";
import { signThemePreviewMedia } from "@/server/storefront/storefront-preview-media.serverFn";
import {
  applyThemePreviewFiles,
  probeThemePreviewAddress,
  startThemePreviewServer,
  touchThemePreviewServer,
} from "@/server/storefront/storefront-theme-preview-server.serverFn";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import {
  INLINE_TEXT_NOT_SAVED_MESSAGE,
  PREVIEW_RELOAD_CONTENT_UNREAD_MESSAGE,
  PREVIEW_RELOAD_DEFERRED_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";
import {
  answerLatestRouteRequest,
  createLiveFrame,
} from "@/lib/test-utils/preview-frame-handshake";

/**
 * Text being typed on the canvas when the preview's dev server is replaced.
 *
 * The text lives only in the frame until it is committed, so replacing the
 * frame then would lose it (V2/V3, docs in the PR). The shell keeps the
 * frame, tells the author once without interrupting, and replaces it when the
 * edit ends — after the commit, if there is one, has entered the ordinary
 * pending flow. Whether that write then succeeds is the pending flow's
 * business: both a write that lands and one refused because the source moved
 * are followed here, and in both the text stays with the author.
 *
 * The instance change comes through the real path: the frame's ready message
 * names `.1`, a renewal answer names `.2`. Only timers are faked, from the
 * moment the frame is up, and the clock moves in steps.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
/** The frame comes up and names its page, as a live one does. */
const liveFrame = createLiveFrame(
  { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION },
  { answerReady: false },
);
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";
const TYPED = "Typed on the canvas";

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
// The media library picker opens a dialog jsdom cannot drive; this stands in
// for it with one button that picks a fixed library asset. Everything after
// the pick — the field's onChange, the Inspector, the save, the preview post
// and signing — is the real path.
const PICKED_ASSET = vi.hoisted(() => "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f");
vi.mock("./editor-media-picker-popover", () => ({
  EditorMediaPickerPopover: ({
    onSelect,
    disabled,
  }: {
    onSelect: (asset: { id: string; url: string; name?: string }) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        onSelect({ id: PICKED_ASSET, url: `/assets/${PICKED_ASSET}.png`, name: "picked.png" })
      }
    >
      Pick test asset
    </button>
  ),
}));
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

const baseSearch = {
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
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
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
const REFUSED = {
  success: false,
  error: "SELECTION_SOURCE_CONFLICT",
  message: "The source code has changed. Select the field again. Your changes are kept.",
};

/** The editor context and Theme files the shell renders with; reset per test. */
let activeContext: StorefrontThemeEditorDTO = context;
let activeTree: () => ReturnType<typeof tree> = tree;
/** `onSearchChange` is a mock here, so a selection never reaches `search` by itself. */
let activeSearch: StorefrontThemeEditorSearch = baseSearch;

let serving = { session: SESSION, serial: 1 };
let order: string[] = [];
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
    activeTree() as never,
  );
  const view = render(
    <QueryClientProvider client={client}>
      <VisualEditorShell context={activeContext} search={activeSearch} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
  return { client, view };
}

function fromPreview(data: Record<string, unknown>) {
  liveFrame.before(data);
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION },
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
  liveFrame.after(data);
}

const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const saveStatus = () =>
  document.querySelector("[data-editor-save-status]")?.getAttribute("aria-label");

const unloadWarned = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

const reloadLines = () =>
  infoLines.filter((line) => line.startsWith("[preview-instance] reload frame"));
const deferredLines = () =>
  infoLines.filter((line) => line.startsWith("[preview-instance] reload deferred"));
const deferredNotices = () =>
  vi
    .mocked(toast.info)
    .mock.calls.filter((call) => call[0] === PREVIEW_RELOAD_DEFERRED_MESSAGE);

/** Renders, selects the heading, opens Content, brings the frame up on `.1`. */
async function frameUp() {
  const shell = renderShell();
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
  fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
  await screen.findByDisplayValue("Welcome");
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  fromPreview({
    type: "morph:storefront-preview-ready",
    servedInstance: { kind: "known", instance: { session: SESSION, serial: 1 } },
  });
  await tick(0);
  answerLatestRouteRequest({ origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION });
  await tick(0);
  return shell;
}

/** Answers heartbeats as a live page does while `ms` pass. */
async function live(ms: number, frame: HTMLIFrameElement | null) {
  for (let elapsed = 0; elapsed < ms; elapsed += 5_000) {
    await tick(5_000);
    const ping = vi
      .mocked(postEditorToPreviewMessage)
      .mock.calls.map(([, message]) => message as { type: string; heartbeatId?: number })
      .filter((message) => message.type === "morph:storefront-preview-ping")
      .at(-1);
    if (ping && document.querySelector("iframe") === frame) {
      fromPreview({ type: "morph:storefront-preview-pong", heartbeatId: ping.heartbeatId });
    }
  }
}

/** Typing opens; a renewal names `.2`; the reload is held. Returns the frame kept. */
async function heldWhileTyping() {
  fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: true });
  await tick(0);
  expect(saveStatus()).toBe("Unsaved");
  const frame = document.querySelector("iframe");
  serving = { session: SESSION, serial: 2 };
  await live(65_000, frame);
  // Precondition: the renewal ran and named the later instance.
  expect(vi.mocked(touchThemePreviewServer)).toHaveBeenCalled();
  expect(deferredLines()).toEqual([
    `[preview-instance] reload deferred | served by ${SESSION}.1, serving ${SESSION}.2`,
  ]);
  return frame;
}

/** The page finishes the edit as it does: the commit, then the close. */
function commitAndClose(value: string) {
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId: "hero",
    fieldKey: "heading",
    fieldPath: "heading",
    value,
    originalValue: "Welcome",
  });
  order.push("commit-delivered");
  fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
  order.push("close-delivered");
}

beforeEach(() => {
  activeContext = context;
  activeTree = tree;
  activeSearch = baseSearch;
  serving = { session: SESSION, serial: 1 };
  order = [];
  infoLines.length = 0;
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
  updateSectionProps.mockImplementation(async (request: { data: { props: unknown } }) => {
    order.push(`save:${JSON.stringify(request.data.props)}`);
    return SAVED;
  });
  vi.mocked(postEditorToPreviewMessage).mockReset();
  vi.mocked(postEditorToPreviewMessage).mockImplementation((_target, message) => {
    const type = (message as { type: string }).type;
    if (type === "morph:storefront-preview-update-section-props") order.push("canvas-props-sync");
  });
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(console, "info").mockImplementation((...args) => {
    const line = String(args[0]);
    infoLines.push(line);
    if (line.startsWith("[preview-instance] reload frame")) order.push("reload");
  });
  vi.mocked(listStorefrontThemeFiles).mockReset();
  vi.mocked(listStorefrontThemeFiles).mockImplementation(
    async () => ({ success: true, message: "ok", data: activeTree() }) as never,
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
        data: { previewId: "preview-1", serving: true, servedInstance: serving },
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
        servedInstance: serving,
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

describe("text typed on the canvas when the preview server is replaced", () => {
  it("keeps the frame, says so once, and reloads it once after the commit is pending", async () => {
    await frameUp();
    const accepted = useThemeWorkspaceStore.getState().acceptedGenerations;
    const kept = await heldWhileTyping();

    // Held: the frame is the same, the edit still counts, the author is told.
    expect(document.querySelector("iframe")).toBe(kept);
    expect(reloadLines()).toEqual([]);
    expect(saveStatus()).toBe("Unsaved");
    expect(unloadWarned()).toBe(true);
    expect(deferredNotices()).toEqual([
      [PREVIEW_RELOAD_DEFERRED_MESSAGE, { id: "preview-reload-deferred" }],
    ]);
    // Later answers add nothing: one notice, still held.
    await live(65_000, kept);
    expect(deferredNotices()).toHaveLength(1);
    expect(document.querySelector("iframe")).toBe(kept);

    commitAndClose(TYPED);
    // The commit reached the canvas and the pending flow before the reload.
    expect(order.indexOf("canvas-props-sync")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("canvas-props-sync")).toBeLessThan(order.indexOf("reload"));
    expect(document.querySelector("iframe")).not.toBe(kept);
    expect(reloadLines()).toEqual([
      `[preview-instance] reload frame | served by ${SESSION}.1, serving ${SESSION}.2`,
    ]);

    // The pending write goes as it always does, once, after the reload.
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(order.filter((step) => step.startsWith("save:"))).toEqual([
      `save:${JSON.stringify({ heading: TYPED })}`,
    ]);
    await tick(1_000);
    expect(saveStatus()).toMatch(/^(Unpublished|Published)$/);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
    expect(useThemeWorkspaceStore.getState().acceptedGenerations).toEqual(accepted);
  });

  it("keeps the text with the author when the source moved and the write is refused", async () => {
    updateSectionProps.mockImplementation(async (request: { data: { props: unknown } }) => {
      order.push(`save:${JSON.stringify(request.data.props)}`);
      return REFUSED;
    });
    await frameUp();
    const kept = await heldWhileTyping();
    // The source moves while the text is open: another tab saved a file.
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      }),
    );
    expect(document.querySelector("iframe")).toBe(kept);

    commitAndClose(TYPED);
    expect(order.indexOf("canvas-props-sync")).toBeLessThan(order.indexOf("reload"));
    expect(document.querySelector("iframe")).not.toBe(kept);
    await tick(400);
    await tick(1_000);

    // Refused or held back — never stored, never sent again, never dropped:
    // the text is in the Inspector, and the field is named for reselection.
    expect(updateSectionProps.mock.calls.length).toBeLessThanOrEqual(1);
    const sent = updateSectionProps.mock.calls.length;
    expect(screen.getByDisplayValue(TYPED)).toBeTruthy();
    expect(
      document.querySelector("[data-editor-source-reselection]")?.textContent ?? "",
    ).toContain("hero.heading");
    expect(saveStatus()).not.toMatch(/^(Unpublished|Published)$/);
    await tick(2_000);
    expect(updateSectionProps).toHaveBeenCalledTimes(sent);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
  });

  it("reloads once and saves nothing when the edit is cancelled", async () => {
    await frameUp();
    const kept = await heldWhileTyping();
    fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
    expect(document.querySelector("iframe")).not.toBe(kept);
    expect(reloadLines()).toHaveLength(1);
    await tick(1_000);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("drops the held reload when the frame is replaced for another reason first", async () => {
    const { client } = await frameUp();
    const kept = await heldWhileTyping();
    // A new preview address: the frame is replaced, and the open edit with it.
    act(() => {
      client.setQueryData(
        themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
        {
          success: true,
          message: "Live Preview server ready",
          data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview?again` },
        } as never,
      );
    });
    await tick(0);
    const replacement = document.querySelector("iframe");
    expect(replacement).not.toBe(kept);
    // A late close from the old page, and time: nothing reloads again.
    fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
    await tick(1_000);
    expect(reloadLines()).toEqual([]);
    expect(document.querySelector("iframe")).toBe(replacement);
  });

  it("does nothing more once the editor is gone", async () => {
    const { view } = await frameUp();
    await heldWhileTyping();
    view.unmount();
    await tick(70_000);
    expect(reloadLines()).toEqual([]);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
  });
});

/**
 * The new frame renders from the snapshot of the last start, which a save
 * since does not reach. Once it is on its route it is sent each section's
 * latest accepted content, with the pending input the write path would still
 * send — read once more when the reload is decided. Paired: a write that
 * lands against one refused, answered before against after the read, an
 * unanswered write that the read shows landed against one it does not, and
 * a read that fails.
 */
describe("the frame brought up after the reload", () => {
  type Posted = { type: string; sectionId?: string; props?: Record<string, unknown> };
  const posted = () =>
    vi
      .mocked(postEditorToPreviewMessage)
      .mock.calls.map(([, message]) => message as Posted);
  const heroPosts = (from: number) =>
    posted()
      .slice(from)
      .filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.sectionId === "hero",
      );
  const replayedLines = () =>
    infoLines.filter((line) => line.startsWith("[preview-instance] content replayed"));
  const unreadNotices = () =>
    vi
      .mocked(toast.warning)
      .mock.calls.filter((call) => call[0] === PREVIEW_RELOAD_CONTENT_UNREAD_MESSAGE);

  /** The server's copy of the Theme, as a read returns it. */
  const serverHolds = (heading: string, draftGeneration: number) => {
    getThemeEditor.mockResolvedValue({
      success: true,
      message: "ok",
      data: {
        ...context,
        templates: [
          {
            ...context.templates[0]!,
            document: {
              version: 1,
              sections: [{ id: "hero", type: "hero", props: { heading } }],
            },
            draftGeneration,
          },
        ],
      },
    });
  };
  const landed = (heading: string) => ({
    success: true,
    data: {
      draftGeneration: 2,
      droppedProps: [],
      document: { sections: [{ id: "hero", type: "hero", props: { heading } }] },
    },
  });

  /**
   * The page answers the latest route it was sent, as a page whose router
   * arrived on the home page does (`morph:storefront-preview-route-applied`).
   */
  function confirmRoute() {
    const request = posted()
      .filter((message) => message.type === "morph:storefront-preview-set-route")
      .at(-1) as (Posted & { routeRequestId?: number }) | undefined;
    fromPreview({
      type: "morph:storefront-preview-route-applied",
      routeRequestId: request?.routeRequestId,
      routePath: "/",
    });
  }

  /** The reloaded page comes up and confirms the route. Returns where its posts start. */
  async function newFrameUp() {
    const from = posted().length;
    fromPreview({
      type: "morph:storefront-preview-ready",
      servedInstance: { kind: "known", instance: serving },
    });
    await tick(0);
    await tick(0);
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
    confirmRoute();
    await tick(0);
    await tick(0);
    return from;
  }

  it("shows the typed text when the write was answered before the frame came up", async () => {
    updateSectionProps.mockImplementation(async (request: { data: { props: unknown } }) => {
      order.push(`save:${JSON.stringify(request.data.props)}`);
      serverHolds(TYPED, 2);
      return landed(TYPED);
    });
    await frameUp();
    const accepted = useThemeWorkspaceStore.getState().acceptedGenerations;
    await heldWhileTyping();
    commitAndClose(TYPED);
    await tick(400);
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    const from = await newFrameUp();
    expect(replayedLines()).toHaveLength(1);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    await tick(1_000);
    expect(heroPosts(from)).toHaveLength(1);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
    expect(reloadLines()).toHaveLength(1);
    expect(useThemeWorkspaceStore.getState().acceptedGenerations).toEqual(accepted);
  });

  it("shows the typed text when the frame came up before the write was answered", async () => {
    let answer!: (value: unknown) => void;
    updateSectionProps.mockImplementation(
      (request: { data: { props: unknown } }) =>
        new Promise((resolve) => {
          order.push(`save:${JSON.stringify(request.data.props)}`);
          answer = resolve;
        }),
    );
    await frameUp();
    await heldWhileTyping();
    commitAndClose(TYPED);
    await tick(400);
    // Sent, not answered; the server has not stored it yet.
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    const from = await newFrameUp();
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);

    serverHolds(TYPED, 2);
    await act(async () => answer(landed(TYPED)));
    await tick(1_000);
    // Answered: still the typed text, nothing sent again, no second replay.
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    expect(replayedLines()).toHaveLength(1);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
  });

  it("shows the accepted text, not the refused input, when the source moved", async () => {
    updateSectionProps.mockImplementation(async (request: { data: { props: unknown } }) => {
      order.push(`save:${JSON.stringify(request.data.props)}`);
      return REFUSED;
    });
    await frameUp();
    await heldWhileTyping();
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      }),
    );
    commitAndClose(TYPED);
    await tick(400);
    await tick(1_000);
    const sent = updateSectionProps.mock.calls.length;

    const from = await newFrameUp();
    expect(replayedLines()).toHaveLength(1);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual(["Welcome"]);
    // The text stays with the Inspector and its recovery.
    expect(screen.getByDisplayValue(TYPED)).toBeTruthy();
    expect(
      document.querySelector("[data-editor-source-reselection]")?.textContent ?? "",
    ).toContain("hero.heading");
    await tick(2_000);
    expect(updateSectionProps).toHaveBeenCalledTimes(sent);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
  });

  it("does not show an unanswered write the read does not hold, and leaves it unanswered", async () => {
    updateSectionProps.mockImplementation(async (request: { data: { props: unknown } }) => {
      order.push(`save:${JSON.stringify(request.data.props)}`);
      throw new Error("Failed to fetch");
    });
    await frameUp();
    await heldWhileTyping();
    commitAndClose(TYPED);
    await tick(400);
    await tick(1_000);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    const status = saveStatus();

    const from = await newFrameUp();
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual(["Welcome"]);
    await tick(2_000);
    expect(saveStatus()).toBe(status);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
  });

  it("shows an unanswered write the read holds, and still leaves it unanswered", async () => {
    updateSectionProps.mockImplementation(async (request: { data: { props: unknown } }) => {
      order.push(`save:${JSON.stringify(request.data.props)}`);
      // It landed; the answer was lost.
      serverHolds(TYPED, 2);
      throw new Error("Failed to fetch");
    });
    await frameUp();
    await heldWhileTyping();
    commitAndClose(TYPED);
    await tick(400);
    await tick(1_000);
    const status = saveStatus();

    const from = await newFrameUp();
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    await tick(2_000);
    expect(saveStatus()).toBe(status);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("sends nothing and says so when the read fails", async () => {
    await frameUp();
    await heldWhileTyping();
    getThemeEditor.mockRejectedValue(new Error("offline"));
    commitAndClose(TYPED);
    await tick(400);
    await tick(400);

    const from = await newFrameUp();
    expect(heroPosts(from)).toEqual([]);
    expect(replayedLines()).toEqual([]);
    expect(unreadNotices()).toHaveLength(1);
    await tick(2_000);
    expect(heroPosts(from)).toEqual([]);
  });

  // A frame that never confirms its route, as one still running a bridge from
  // before the confirmation existed: the replay is given up, once, with the
  // notice — and nothing else. The author's text stays unsaved and with them,
  // nothing is marked saved, no write is sent again, the frame is kept.
  it("gives up only the replay, with a notice, when the frame never confirms its route", async () => {
    updateSectionProps.mockImplementation(async (request: { data: { props: unknown } }) => {
      order.push(`save:${JSON.stringify(request.data.props)}`);
      return REFUSED;
    });
    await frameUp();
    await heldWhileTyping();
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      }),
    );
    commitAndClose(TYPED);
    await tick(400);
    await tick(1_000);
    // Precondition: the text is with the author, not saved.
    const status = saveStatus();
    expect(status).not.toMatch(/^(Unpublished|Published)$/);
    expect(screen.getByDisplayValue(TYPED)).toBeTruthy();
    const warned = unloadWarned();
    const sent = updateSectionProps.mock.calls.length;

    const from = await newFrameReady();
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
    const frame = document.querySelector("iframe");
    await live(INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS + 5_000, frame);

    expect(heroPosts(from)).toEqual([]);
    expect(replayedLines()).toEqual([]);
    expect(
      infoLines.filter((line) => line.startsWith("[preview-instance] content replay given up")),
    ).toEqual([
      "[preview-instance] content replay given up | the frame did not confirm its route in time",
    ]);
    expect(unreadNotices()).toHaveLength(1);
    // Not cleared: the text is still the author's, still unsaved.
    expect(screen.getByDisplayValue(TYPED)).toBeTruthy();
    expect(unloadWarned()).toBe(warned);
    // Not marked saved.
    expect(saveStatus()).toBe(status);
    // No write sent again.
    expect(updateSectionProps).toHaveBeenCalledTimes(sent);
    // No frame swapped or reloaded, nothing started.
    expect(document.querySelector("iframe")).toBe(frame);
    expect(reloadLines()).toHaveLength(1);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
  });

  /** The reloaded page says it is ready; it has not reported its route yet. */
  async function newFrameReady() {
    const from = posted().length;
    fromPreview({
      type: "morph:storefront-preview-ready",
      servedInstance: { kind: "known", instance: serving },
    });
    await tick(0);
    await tick(0);
    return from;
  }
  /** That page reports its structure and confirms the route it is on. */
  async function newFrameOnRoute() {
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
    confirmRoute();
    await tick(0);
    await tick(0);
  }
  /** A write that stays in flight until `answer` is called. */
  function writeInFlight() {
    const control = { answer: (_value: unknown) => {} };
    updateSectionProps.mockImplementation(
      (request: { data: { props: unknown } }) =>
        new Promise((resolve) => {
          order.push(`save:${JSON.stringify(request.data.props)}`);
          control.answer = resolve;
        }),
    );
    return control;
  }

  // G1. The read is ready-triggered, so a ready frame says nothing about the
  // write: here the write is answered while the read is still out, and the
  // read then returns the copy from before it.
  it("keeps the answered write when the read returns an older copy afterwards", async () => {
    const write = writeInFlight();
    await frameUp();
    await heldWhileTyping();
    commitAndClose(TYPED);
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    const reads: Array<(value: unknown) => void> = [];
    getThemeEditor.mockImplementation(
      () => new Promise((resolve) => reads.push(resolve)),
    );
    const from = await newFrameReady();
    await newFrameOnRoute();
    expect(reads.length).toBeGreaterThanOrEqual(1);
    expect(heroPosts(from)).toEqual([]);

    // The write lands and is answered first...
    await act(async () => write.answer(landed(TYPED)));
    await tick(0);
    // ...then the read, from before it, comes back.
    const stale = {
      success: true,
      message: "ok",
      data: context,
    };
    await act(async () => {
      for (const resolve of reads) resolve(stale);
    });
    await tick(0);
    await tick(0);
    expect(replayedLines()).toHaveLength(1);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  // G2. Composed when sent, not when the read lands: between the two the
  // write is refused, so the input composed at the read would be shown, and
  // the one composed at sending is not.
  it("composes what it sends when it sends it, not when the read lands", async () => {
    const write = writeInFlight();
    await frameUp();
    await heldWhileTyping();
    commitAndClose(TYPED);
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    // The read (the stored copy) lands while the write is still out; the
    // input is pending and would be put on the canvas at this point.
    const from = await newFrameReady();
    await tick(0);
    expect(infoLines.some((line) => line.startsWith("[preview-instance] content read failed"))).toBe(
      false,
    );
    // The source refuses the write before the frame reports its route.
    await act(async () => write.answer(REFUSED));
    await tick(0);
    expect(heroPosts(from)).toEqual([]);

    await newFrameOnRoute();
    expect(replayedLines()).toHaveLength(1);
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual(["Welcome"]);
    expect(screen.getByDisplayValue(TYPED)).toBeTruthy();
  });

  // With #243: the replayed text is this editor's newest accepted copy (the
  // write's answer), while the editor context still holds the copy from
  // before the write. An edit begun on the new frame from the replayed text
  // is saved; one claiming the text from before the write is refused.
  it("takes the replayed text as stored before the editor context catches up", async () => {
    updateSectionProps.mockImplementation(async (request: { data: { props: unknown } }) => {
      order.push(`save:${JSON.stringify(request.data.props)}`);
      serverHolds(TYPED, 2);
      return landed(TYPED);
    });
    await frameUp();
    await heldWhileTyping();
    commitAndClose(TYPED);
    await tick(400);
    await tick(400);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    const from = await newFrameUp();
    expect(heroPosts(from).map((message) => message.props?.heading)).toEqual([TYPED]);
    // Precondition: the editor context was never given the newer copy.
    expect(activeContext.templates[0]!.draftGeneration).toBe(1);

    const commitOnNewFrame = (value: string, originalValue: string) => {
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: true });
      fromPreview({
        type: "morph:storefront-preview-commit-inline-text",
        sectionId: "hero",
        fieldKey: "heading",
        fieldPath: "heading",
        value,
        originalValue,
      });
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
    };
    const refusedNotices = () =>
      vi.mocked(toast.info).mock.calls.filter((call) => call[0] === INLINE_TEXT_NOT_SAVED_MESSAGE);

    commitOnNewFrame("Stale claim", "Welcome");
    await tick(400);
    await tick(400);
    expect(refusedNotices()).toHaveLength(1);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    commitOnNewFrame("Edited on the new frame", TYPED);
    await tick(400);
    await tick(400);
    expect(refusedNotices()).toHaveLength(1);
    expect(updateSectionProps).toHaveBeenCalledTimes(2);
    const second = updateSectionProps.mock.calls[1]![0] as {
      data: { props: Record<string, unknown>; expectedDraftGeneration: number };
    };
    expect(second.data.props).toEqual({ heading: "Edited on the new frame" });
    expect(second.data.expectedDraftGeneration).toBe(2);
  });

  describe("an image signed after the content was sent", () => {
    const ASSET = "0b9f3a52-2f7e-4c1a-9d4b-6a1f2e3d4c5b";
    const SIGNED_URL = "https://media.morph.test/signed.png";
    /** An image field's stored value, as the media picker stores a library asset. */
    const STORED_IMAGE = {
      source: "asset",
      mediaType: "image",
      assetId: ASSET,
      url: `/assets/${ASSET}.png`,
      name: "hero.png",
    };
    const imageSigned = (message: Posted | undefined) =>
      JSON.stringify(message?.props?.image ?? null).includes(SIGNED_URL);
    let signed!: (value: unknown) => void;

    async function replayedWithUnsignedImage() {
      vi.mocked(signThemePreviewMedia).mockReset();
      vi.mocked(signThemePreviewMedia).mockImplementation(
        () =>
          new Promise((resolve) => {
            signed = resolve;
          }) as never,
      );
      await frameUp();
      await heldWhileTyping();
      commitAndClose(TYPED);
      await tick(400);
      await tick(400);
      getThemeEditor.mockResolvedValue({
        success: true,
        message: "ok",
        data: {
          ...context,
          templates: [
            {
              ...context.templates[0]!,
              document: {
                version: 1,
                sections: [
                  {
                    id: "hero",
                    type: "hero",
                    props: { heading: TYPED, image: STORED_IMAGE },
                  },
                ],
              },
              draftGeneration: 2,
            },
          ],
        },
      });
      const from = await newFrameUp();
      expect(heroPosts(from)).toHaveLength(1);
      expect(imageSigned(heroPosts(from)[0])).toBe(false);
      expect(signThemePreviewMedia).toHaveBeenCalled();
      return from;
    }
    const sign = () =>
      act(async () =>
        signed({
          success: true,
          data: {
            urls: { [ASSET]: SIGNED_URL },
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          },
        }),
      );

    it("is posted again to the frame it was sent to", async () => {
      const from = await replayedWithUnsignedImage();
      await sign();
      await tick(0);
      expect(heroPosts(from)).toHaveLength(2);
      // The second post carries the signed address, and the same content.
      expect(imageSigned(heroPosts(from)[1])).toBe(true);
      expect(heroPosts(from)[1]?.props?.heading).toBe(TYPED);
    });

    // G3. A newer edit to the section while its image is being signed: the
    // replay's late post is not sent, and the edit shows through its own.
    it("does not cover a newer edit made while the image was being signed", async () => {
      const from = await replayedWithUnsignedImage();
      // Text typed again on the new canvas, finished as the page finishes it.
      // `originalValue` is the text the new frame shows: the replayed,
      // stored value.
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: true });
      fromPreview({
        type: "morph:storefront-preview-commit-inline-text",
        sectionId: "hero",
        fieldKey: "heading",
        fieldPath: "heading",
        value: "Newer",
        originalValue: TYPED,
      });
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
      await tick(0);
      const edited = heroPosts(from).findIndex(
        (message) => message.props?.heading === "Newer",
      );
      expect(edited).toBeGreaterThan(0);

      const editPost = heroPosts(from)[edited]!;
      // The edit's own post goes before the image is signed: the stored
      // library image, unsigned.
      expect(imageSigned(editPost)).toBe(false);
      expect(editPost.props?.image).toEqual(STORED_IMAGE);

      await sign();
      await tick(0);
      // Nothing after the edit puts the older content back. Before C5 this
      // asserted that nothing at all came after the edit's post. Since C5 the
      // section a commit landed on is sent, when the edit ends, as the newest
      // copy the editor has accepted with the pending input on top — and that
      // copy, the replay's read, holds the image the edit's echo was composed
      // without — so the edit's own post may be followed by its own signed
      // repost. The user's conditions for accepting that (2026-10-20):
      // (a) every post after the edit's own post is that edit's signed repost
      //     of the SAME section: same props as the edit's post except the
      //     library image, which goes from unsigned to signed, and nothing
      //     else differs;
      // (b) at most one such repost;
      // (c) no post carries older text, and the replay's late post is never
      //     sent;
      // (d) a reverse check showing (a) and (b) catch an extra or different
      //     post (run by hand: see the PR's reverse-check table).
      const after = heroPosts(from).slice(edited + 1);
      const withoutImage = (message: Posted) => ({
        ...message,
        props: { ...message.props, image: undefined },
      });
      // (a)
      for (const message of after) {
        expect(message.sectionId).toBe(editPost.sectionId);
        expect(withoutImage(message)).toEqual(withoutImage(editPost));
        // The same library image, now as its signed address.
        expect(message.props?.image).toBe(SIGNED_URL);
      }
      // (b)
      expect(after.length).toBeLessThanOrEqual(1);
      // (c) No post from the edit's on carries older text, and the replay's
      // late post (the older text with the signed image) is never sent.
      expect(
        heroPosts(from)
          .slice(edited)
          .filter((message) => message.props?.heading !== "Newer"),
      ).toEqual([]);
      expect(
        heroPosts(from).filter(
          (message) => message.props?.heading === TYPED && imageSigned(message),
        ),
      ).toEqual([]);
      expect(heroPosts(from).at(-1)?.props?.heading).toBe("Newer");
    });

    // C5: the section an inline commit landed on is sent, when the edit
    // ends, from the stored copy with the pending input on top. That copy's
    // library image is resolved for the canvas the way any edit's is: posted
    // at once, then again once signed.
    it("signs the stored image of a section an inline edit committed, when the edit ends", async () => {
      const from = await replayedWithUnsignedImage();
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: true });
      fromPreview({
        type: "morph:storefront-preview-commit-inline-text",
        sectionId: "hero",
        fieldKey: "heading",
        fieldPath: "heading",
        value: "Newer",
        originalValue: TYPED,
      });
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
      await tick(0);
      await sign();
      await tick(0);
      const last = heroPosts(from).at(-1);
      expect(last?.props?.heading).toBe("Newer");
      expect(imageSigned(last)).toBe(true);
    });

    it("is not posted to a frame that replaced it meanwhile", async () => {
      const from = await replayedWithUnsignedImage();
      // Replaced, for another reason, while the image was being signed.
      fromPreview({
        type: "morph:storefront-preview-ready",
        servedInstance: { kind: "known", instance: serving },
      });
      await tick(0);
      await sign();
      await tick(0);
      expect(heroPosts(from)).toHaveLength(1);
      expect(heroPosts(from).some(imageSigned)).toBe(false);
    });
  });

  it("sends nothing to a frame that is not the one the reload brought up", async () => {
    await frameUp();
    await heldWhileTyping();
    commitAndClose(TYPED);
    await tick(400);
    // The reloaded page comes up, and is replaced again before it reports
    // its route.
    fromPreview({
      type: "morph:storefront-preview-ready",
      servedInstance: { kind: "known", instance: serving },
    });
    await tick(0);
    const from = await newFrameUp();
    expect(heroPosts(from)).toEqual([]);
    expect(replayedLines()).toEqual([]);
  });

  /**
   * T6 and T6c: an Inspector edit while the replay's image is being signed,
   * with a declared source and a valid stored image.
   *
   * A declared text field that is not the selected one previews on the
   * element and saves with `skipPreviewSync`, so it replaces a section post
   * still waiting on signing (#235). A replay's waiting post belongs to the
   * frame it was for: once that frame is replaced, nothing of the replay is
   * posted, superseded or not (T6c, option b). New work on the frame that
   * replaced it — a canvas edit, an Inspector edit, a new image — is its own
   * and is never held back by the expired replay.
   *
   * The shell's `context` is a fixed prop in this harness (no refetch after a
   * save), so the Inspector's copy of fields the test does not type into can
   * lag behind what the server holds; only fields the test sets are asserted.
   */
  describe("T6: an Inspector edit while the replayed image is being signed", () => {
    const ASSET = "0b9f3a52-2f7e-4c1a-9d4b-6a1f2e3d4c5b";
    const STORED_IMAGE = {
      source: "asset",
      mediaType: "image",
      assetId: ASSET,
      url: `/assets/${ASSET}.png`,
      name: "hero.png",
    };
    const signedUrl = (id: string) => `https://media.morph.test/signed-${id}.png`;
    const imageSignedWith = (message: Posted | undefined, id: string) =>
      JSON.stringify(message?.props?.image ?? null).includes(signedUrl(id));
    const HERO_SOURCE = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  subheading: { type: "text", label: "Subheading" },
  image: { type: "image", label: "Image" }
};
export function Hero({ heading = "Welcome", subheading = "Summary", image }) {
  return <section><h1>{heading}</h1><p>{subheading}</p>{image ? <img src={image.url} alt="" /> : null}</section>;
}`;
    const heroSection = (props: Record<string, unknown>) => ({
      id: "hero",
      type: "hero",
      enabled: true,
      props,
    });
    const declaredContext = {
      ...context,
      templates: [
        {
          ...context.templates[0]!,
          document: {
            version: 1,
            sections: [heroSection({ heading: "Welcome", subheading: "Summary", image: STORED_IMAGE })],
          },
        },
      ],
    } as unknown as StorefrontThemeEditorDTO;
    const declaredTree = () => {
      const base = tree();
      return {
        ...base,
        files: [
          ...base.files,
          { ...routeFile, id: "file-hero", path: "src/components/Hero.tsx", content: HERO_SOURCE },
        ],
        tree: [
          {
            name: "src",
            path: "src",
            isDirectory: true,
            children: [
              ...base.tree[0]!.children,
              {
                name: "components",
                path: "src/components",
                isDirectory: true,
                children: [
                  { name: "Hero.tsx", path: "src/components/Hero.tsx", isDirectory: false },
                ],
              },
            ],
          },
        ],
      };
    };

    let answers: Array<{ ids: string[]; resolve: (value: unknown) => void }> = [];
    let canvasRevision = 0;
    beforeEach(() => {
      activeContext = declaredContext;
      activeTree = declaredTree as typeof tree;
      // The hero section is the document section the Inspector writes to, as
      // it is once the editor's search follows a selection.
      activeSearch = { ...baseSearch, section: "hero" } as StorefrontThemeEditorSearch;
      answers = [];
      canvasRevision = 0;
      vi.mocked(signThemePreviewMedia).mockReset();
      vi.mocked(signThemePreviewMedia).mockImplementation(
        (request: unknown) =>
          new Promise((resolve) =>
            answers.push({
              ids: (request as { data: { assetIds: string[] } }).data.assetIds,
              resolve,
            }),
          ) as never,
      );
    });
    /** Answers every signing request made so far. */
    const releaseSigning = async () => {
      await act(async () => {
        for (const answer of answers.splice(0)) {
          answer.resolve({
            success: true,
            data: {
              urls: Object.fromEntries(answer.ids.map((id) => [id, signedUrl(id)])),
              expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            },
          });
        }
      });
      await tick(0);
      await tick(0);
    };
    const signedIds = () =>
      vi
        .mocked(signThemePreviewMedia)
        .mock.calls.flatMap((call) => (call[0] as { data: { assetIds: string[] } }).data.assetIds);

    /** The reload's frame is replayed into; its image is still being signed. */
    async function replayedWithUnsignedImage() {
      await frameUp();
      await heldWhileTyping();
      commitAndClose(TYPED);
      await tick(400);
      await tick(400);
      getThemeEditor.mockResolvedValue({
        success: true,
        message: "ok",
        data: {
          ...declaredContext,
          templates: [
            {
              ...declaredContext.templates[0]!,
              document: {
                version: 1,
                sections: [heroSection({ heading: TYPED, subheading: "Summary", image: STORED_IMAGE })],
              },
              draftGeneration: 2,
            },
          ],
        },
      });
      const from = await newFrameUp();
      expect(heroPosts(from)).toHaveLength(1);
      expect(heroPosts(from)[0]?.props?.heading).toBe(TYPED);
      expect(imageSignedWith(heroPosts(from)[0], ASSET)).toBe(false);
      return from;
    }
    /** The page reports a selection: the section itself (null) or the heading. */
    async function canvasSelect(field: "heading" | null) {
      const messages = vi
        .mocked(postEditorToPreviewMessage)
        .mock.calls.map(([, message]) => message as Record<string, unknown>);
      const revision =
        Math.max(
          canvasRevision,
          ...messages.map((m) => (typeof m.selectionRevision === "number" ? m.selectionRevision : 0)),
        ) + 1;
      canvasRevision = revision;
      fromPreview({
        type: "morph:storefront-preview-select-section",
        sectionId: "hero",
        componentType: "hero",
        kind: field ? "heading" : "section",
        nodeId: field ? `hero:node:${field}` : "hero",
        sourceFilePath: "src/components/Hero.tsx",
        sourceLocation: null,
        elementKey: field,
        fieldKey: field,
        field,
        fieldPath: field,
        descendantFields: [],
        tagName: field ? "h1" : "section",
        role: null,
        inputType: null,
        styleRevision: Math.max(
          0,
          ...messages.map((m) => (typeof m.styleRevision === "number" ? m.styleRevision : 0)),
        ),
        className: "",
        isSection: field === null,
        inspectorOverride: null,
        computedStyle: null,
        parentComputedStyle: null,
        sectionComputedStyle: null,
        selectionRevision: revision,
      });
      await tick(0);
      await tick(0);
    }
    /** The section selected on the canvas, its declared subheading typed in the Inspector. */
    async function inspectorSubheading(to: string) {
      await canvasSelect(null);
      // Timers are faked here; findBy* would poll on a clock that never moves.
      const field = screen.getByDisplayValue("Summary");
      fireEvent.focus(field);
      fireEvent.input(field, { target: { value: to } });
      fireEvent.blur(field);
      await tick(0);
    }
    /** Text finished on the canvas, as the page finishes it. */
    async function canvasHeading(value: string, originalValue: string) {
      await canvasSelect("heading");
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: true });
      fromPreview({
        type: "morph:storefront-preview-commit-inline-text",
        sectionId: "hero",
        fieldKey: "heading",
        fieldPath: "heading",
        value,
        originalValue,
      });
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
      await tick(0);
    }
    /** The frame is replaced for another reason: a new ready round. */
    async function frameReplaced() {
      fromPreview({
        type: "morph:storefront-preview-ready",
        servedInstance: { kind: "known", instance: serving },
      });
      await tick(0);
      // And confirms its page, as a live frame does at once: what the author
      // does on it is then the editor's page's.
      answerLatestRouteRequest({
        origin: PREVIEW_ORIGIN,
        session: PREVIEW_SESSION,
      });
      await tick(0);
    }

    it("T6: ends with the newest text and the signed image, never the older subheading", async () => {
      await replayedWithUnsignedImage();
      const before = posted().length;
      await inspectorSubheading("Sub newer");
      // Previewed on the element; no section post yet.
      expect(heroPosts(before)).toEqual([]);
      await tick(400);
      await releaseSigning();
      const after = heroPosts(before);
      expect(after).toHaveLength(1);
      expect(after.map((m) => m.props?.subheading)).not.toContain("Summary");
      expect(after[0]?.props?.subheading).toBe("Sub newer");
      expect(imageSignedWith(after[0], ASSET)).toBe(true);
      expect(startThemePreviewServer).not.toHaveBeenCalled();
      expect(reloadLines()).toHaveLength(1);
    });

    it("T6-binding: the replay's late post does not reach a frame that replaced it", async () => {
      const from = await replayedWithUnsignedImage();
      await frameReplaced();
      await releaseSigning();
      expect(heroPosts(from)).toHaveLength(1);
      expect(heroPosts(from).some((m) => imageSignedWith(m, ASSET))).toBe(false);
    });

    it("T6c-a: an Inspector edit after the frame was replaced posts and signs nothing for the replay", async () => {
      await replayedWithUnsignedImage();
      await frameReplaced();
      const signedBefore = signedIds().length;
      const before = posted().length;
      await inspectorSubheading("Sub newer");
      await tick(400);
      await releaseSigning();
      expect(heroPosts(before)).toEqual([]);
      expect(signedIds().length).toBe(signedBefore);
    });

    it("T6c-b: a replacement made before the frame was replaced is not posted to the new frame", async () => {
      await replayedWithUnsignedImage();
      const before = posted().length;
      await inspectorSubheading("Sub newer");
      expect(heroPosts(before)).toEqual([]);
      await frameReplaced();
      await tick(400);
      await releaseSigning();
      expect(heroPosts(before)).toEqual([]);
    });

    it("T6c-c: a canvas edit on the new frame is posted and signed as usual", async () => {
      await replayedWithUnsignedImage();
      await frameReplaced();
      const before = posted().length;
      // `originalValue` is the stored value this editor's newest copy holds:
      // the answered write, which the replay's read also brought.
      await canvasHeading("Final", TYPED);
      expect(heroPosts(before).at(-1)?.props?.heading).toBe("Final");
      await releaseSigning();
      const after = heroPosts(before);
      expect(after.map((m) => m.props?.heading).filter((h) => h !== "Final")).toEqual([]);
      expect(imageSignedWith(after.at(-1), ASSET)).toBe(true);
    });

    it("T6c-d: an Inspector edit on the new frame replaces that frame's own waiting post", async () => {
      await replayedWithUnsignedImage();
      await frameReplaced();
      await canvasHeading("Final", TYPED);
      const before = posted().length;
      await inspectorSubheading("Sub newer");
      expect(heroPosts(before)).toEqual([]);
      await tick(400);
      await releaseSigning();
      const after = heroPosts(before);
      expect(after).toHaveLength(1);
      expect(after[0]?.props?.subheading).toBe("Sub newer");
      expect(after[0]?.props?.heading).not.toBe(TYPED);
      expect(imageSignedWith(after[0], ASSET)).toBe(true);
    });

    it("T6c-e: a new image chosen on the new frame is posted and signed as usual", async () => {
      await replayedWithUnsignedImage();
      await frameReplaced();
      await canvasSelect(null);
      const before = posted().length;
      fireEvent.click(screen.getByRole("button", { name: "Pick test asset" }));
      await tick(0);
      expect(JSON.stringify(heroPosts(before).at(-1)?.props?.image ?? null)).toContain(PICKED_ASSET);
      expect(signedIds()).toContain(PICKED_ASSET);
      await releaseSigning();
      const after = heroPosts(before);
      expect(imageSignedWith(after.at(-1), PICKED_ASSET)).toBe(true);
      // Nothing of the expired replay follows the pick.
      expect(after.some((m) => imageSignedWith(m, ASSET))).toBe(false);
    });
  });
});
