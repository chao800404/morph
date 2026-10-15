import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
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
  PREVIEW_RELOAD_CONTENT_UNREAD_MESSAGE,
  PREVIEW_RELOAD_DEFERRED_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";

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
    tree() as never,
  );
  const view = render(
    <QueryClientProvider client={client}>
      <VisualEditorShell context={context} search={baseSearch} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
  return { client, view };
}

function fromPreview(data: Record<string, unknown>) {
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

  /** The reloaded page comes up and reports the route. Returns where its posts start. */
  async function newFrameUp() {
    const from = posted().length;
    fromPreview({
      type: "morph:storefront-preview-ready",
      servedInstance: { kind: "known", instance: serving },
    });
    await tick(0);
    await tick(0);
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
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
  /** That page reports the route it is on. */
  async function newFrameOnRoute() {
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
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

  describe("an image signed after the content was sent", () => {
    const ASSET = "0b9f3a52-2f7e-4c1a-9d4b-6a1f2e3d4c5b";
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
                    props: { heading: TYPED, image: { source: "asset", assetId: ASSET } },
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
      expect(signThemePreviewMedia).toHaveBeenCalled();
      return from;
    }
    const sign = () =>
      act(async () =>
        signed({
          success: true,
          data: {
            urls: { [ASSET]: "https://media.morph.test/signed.png" },
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          },
        }),
      );

    it("is posted again to the frame it was sent to", async () => {
      const from = await replayedWithUnsignedImage();
      await sign();
      await tick(0);
      expect(heroPosts(from)).toHaveLength(2);
    });

    // G3. A newer edit to the section while its image is being signed: the
    // replay's late post is not sent, and the edit shows through its own.
    it("does not cover a newer edit made while the image was being signed", async () => {
      const from = await replayedWithUnsignedImage();
      // Text typed again on the new canvas, finished as the page finishes it.
      // `originalValue` is the stored value this editor holds for the field.
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: true });
      fromPreview({
        type: "morph:storefront-preview-commit-inline-text",
        sectionId: "hero",
        fieldKey: "heading",
        fieldPath: "heading",
        value: "Newer",
        originalValue: "Welcome",
      });
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
      await tick(0);
      const edited = heroPosts(from).findIndex(
        (message) => message.props?.heading === "Newer",
      );
      expect(edited).toBeGreaterThan(0);

      await sign();
      await tick(0);
      // Nothing after the edit puts the older content back.
      expect(heroPosts(from).slice(edited + 1)).toEqual([]);
      expect(heroPosts(from).at(-1)?.props?.heading).toBe("Newer");
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
});
