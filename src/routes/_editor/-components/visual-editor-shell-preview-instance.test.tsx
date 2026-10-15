import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import {
  postEditorToPreviewMessage,
  type PreviewServedInstance,
} from "@/lib/storefront/editor/preview-protocol";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { saveStorefrontThemeFile } from "@/server/storefront/storefront-theme-files.serverFn";
import {
  applyThemePreviewFiles,
  startThemePreviewServer,
  touchThemePreviewServer,
} from "@/server/storefront/storefront-theme-preview-server.serverFn";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * A preview frame whose dev server was replaced on the same address.
 *
 * A start from another tab can lay the workspace out again and restart Vite
 * where this frame is pointed. The frame keeps the modules the old instance
 * served, and every later sync of them is `unchanged`, so nothing would ever
 * update it. The shell reloads the frame — only the frame — when a sync or
 * renewal answer names a later instance than the one the page said served
 * it. What has to hold around that: nothing is started, nothing the author
 * has pending is dropped or sent early, and no source baseline moves.
 *
 * Only `setTimeout` is faked, from the moment of the edit, so the edit's
 * 300ms debounce is still waiting when the frame is replaced.
 */

const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const FILE_PATH = "src/components/Hero.tsx";
const ORIGINAL = `export default function Hero() {
  return <section data-morph-node="hero-root" className="p-2">x</section>;
}
`;
const SESSION_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SESSION_B = "bbbbbbbb-2222-4222-8222-222222222222";

const getThemeEditor = vi.hoisted(() => vi.fn());

vi.mock("./editor-assistant-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-assistant-panel")>();
  const RealPanel = actual.EditorAssistantPanel;
  return {
    ...actual,
    EditorAssistantPanel: (props: ComponentProps<typeof RealPanel>) => (
      <>
        <RealPanel {...props} />
        <button
          type="button"
          onClick={() =>
            props.onUpdateThemeFileStyle?.(
              "src/components/Hero.tsx",
              "hero-root",
              (prevClasses) => `${prevClasses} p-8`,
            )
          }
        >
          Apply a style patch
        </button>
      </>
    ),
  };
});

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getStorefrontThemeEditor: getThemeEditor,
  }),
);

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    saveStorefrontThemeFile: vi.fn(),
    getStorefrontThemeFile: vi.fn(),
  }),
);

vi.mock(
  "@/server/storefront/storefront-theme-preview-server.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startThemePreviewServer: vi.fn(),
    applyThemePreviewFiles: vi.fn(),
    touchThemePreviewServer: vi.fn(),
    probeThemePreviewAddress: vi.fn(async () => ({
      success: true,
      message: "ok",
      data: { state: "unknown" },
    })),
  }),
);

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

const heroFile: StorefrontThemeFileDTO = {
  id: "file-hero",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path: FILE_PATH,
  content: ORIGINAL,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
} as StorefrontThemeFileDTO;

const context = {
  previewChannel: {
    editorOrigin: "http://localhost:3000",
    sessionId: PREVIEW_SESSION,
  },
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

/** The instance the sidecar says is serving now. */
let serving: PreviewServedInstance = { session: SESSION_A, serial: 1 };
/** What a renewal says is serving, when it differs from a sync's answer. */
let touchServing: PreviewServedInstance | null = null;

function renderShell() {
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
    {
      files: [heroFile],
      tree: [
        {
          name: "src",
          path: "src",
          isDirectory: true,
          children: [
            {
              name: "components",
              path: "src/components",
              isDirectory: true,
              children: [
                { name: "Hero.tsx", path: FILE_PATH, isDirectory: false },
              ],
            },
          ],
        },
      ],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={
          {
            template: "index",
            templateId: "template-1",
            viewport: "desktop",
          } as StorefrontThemeEditorSearch
        }
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const frame = () => document.querySelector("iframe");

/** The page's ready message, naming the instance that served it. */
function frameReady(served: PreviewServedInstance) {
  const current = frame();
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "morph:storefront-preview-ready",
          servedInstance: { kind: "known", instance: served },
          previewSession: PREVIEW_SESSION,
        },
        origin: PREVIEW_ORIGIN,
        source: current?.contentWindow ?? null,
      }),
    );
  });
}

/** The pong a live page sends for the latest ping. */
function answerHeartbeat(current: HTMLIFrameElement | null) {
  const pings = vi
    .mocked(postEditorToPreviewMessage)
    .mock.calls.map(([, message]) => message as { type: string; heartbeatId?: number })
    .filter((message) => message.type === "morph:storefront-preview-ping");
  const latest = pings.at(-1);
  if (!latest) return;
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "morph:storefront-preview-pong",
          heartbeatId: latest.heartbeatId,
          previewSession: PREVIEW_SESSION,
        },
        origin: PREVIEW_ORIGIN,
        source: current?.contentWindow ?? null,
      }),
    );
  });
}

const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const saveStatus = () =>
  document
    .querySelector("[data-editor-save-status]")
    ?.getAttribute("aria-label");

const localHeroSource = () =>
  useThemeWorkspaceStore
    .getState()
    .getWorkspaceFiles("storefront-1", "theme-1")[FILE_PATH]?.localContent;

const appliedContents = () =>
  vi
    .mocked(applyThemePreviewFiles)
    .mock.calls.flatMap(
      ([request]) =>
        (request as { data: { files: { content: string }[] } }).data.files,
    )
    .map((file) => file.content);

beforeEach(() => {
  serving = { session: SESSION_A, serial: 1 };
  touchServing = null;
  useThemeWorkspaceStore.setState({ workspaces: {} });
  useEditorWriteGateStore.setState({ gates: {} });
  getThemeEditor.mockResolvedValue({
    success: true,
    message: "ok",
    data: context,
  });
  vi.mocked(startThemePreviewServer).mockResolvedValue({
    success: true,
    message: "Live Preview server ready",
    data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
  } as never);
  vi.mocked(applyThemePreviewFiles).mockImplementation((async (request: {
    data: { files: { path: string }[] };
  }) => ({
    success: true,
    message: "Live Preview files written",
    data: {
      previewId: "preview-1",
      changed: [],
      unchanged: request.data.files.map((file) => file.path),
      skipped: [],
      servedInstance: serving,
    },
  })) as never);
  vi.mocked(touchThemePreviewServer).mockImplementation((async () => ({
    success: true,
    message: "Live Preview server checked",
    data: {
      previewId: "preview-1",
      serving: true,
      servedInstance: touchServing ?? serving,
    },
  })) as never);
  vi.mocked(saveStorefrontThemeFile).mockReturnValue(
    new Promise(() => {}) as never,
  );
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(startThemePreviewServer).mockReset();
  vi.mocked(applyThemePreviewFiles).mockReset();
  vi.mocked(touchThemePreviewServer).mockReset();
  vi.mocked(saveStorefrontThemeFile).mockReset();
});

/** Renders, lets the first frame come up and sync, then freezes the clock. */
async function frameUpAndSynced() {
  renderShell();
  await screen.findByRole("button", { name: "Apply a style patch" });
  frameReady({ session: SESSION_A, serial: 1 });
  await settle();
  // Nothing unsaved, so the first sync has nothing to write: the edit's sync
  // below is the first answer that names an instance.
  expect(applyThemePreviewFiles).not.toHaveBeenCalled();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

function applyStylePatch() {
  act(() => {
    screen.getByRole("button", { name: "Apply a style patch" }).click();
  });
}

describe("a frame served by the instance still serving", () => {
  it("is left alone, and nothing is started or asked on the way up", async () => {
    await frameUpAndSynced();
    const first = frame();

    applyStylePatch();
    await tick(0);

    expect(applyThemePreviewFiles).toHaveBeenCalledTimes(1);
    expect(frame()).toBe(first);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
    expect(touchThemePreviewServer).not.toHaveBeenCalled();
  });
});

describe("a frame whose server was replaced on the same address", () => {
  it("is reloaded once, alone, keeping the waiting edit and every baseline", async () => {
    await frameUpAndSynced();
    const first = frame();
    const accepted = useThemeWorkspaceStore.getState().acceptedGenerations;

    // Another tab's start restarted Vite where this frame points.
    serving = { session: SESSION_A, serial: 2 };
    applyStylePatch();
    await tick(0);
    expect(applyThemePreviewFiles).toHaveBeenCalledTimes(1);

    // A new frame, and nothing else.
    const second = frame();
    expect(second).not.toBe(first);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
    expect(touchThemePreviewServer).not.toHaveBeenCalled();
    // The edit is still waiting out its debounce, unsent and unchanged.
    expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
    expect(saveStatus()).toBe("Unsaved");
    expect(localHeroSource()).toContain("p-2 p-8");
    expect(useThemeWorkspaceStore.getState().acceptedGenerations).toEqual(
      accepted,
    );

    // The new frame comes up from the instance serving, and is sent the
    // draft by its first sync.
    const appliedBefore = vi.mocked(applyThemePreviewFiles).mock.calls.length;
    frameReady({ session: SESSION_A, serial: 2 });
    await tick(0);
    expect(
      vi.mocked(applyThemePreviewFiles).mock.calls.length,
    ).toBeGreaterThan(appliedBefore);
    expect(appliedContents().at(-1)).toContain("p-2 p-8");
    // And it is not reloaded again.
    expect(frame()).toBe(second);

    await tick(300);
    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
    expect(frame()).toBe(second);
  });
});

describe("a renewal answer naming a later instance", () => {
  it("replaces the frame with no edit to sync, and starts nothing", async () => {
    renderShell();
    await screen.findByRole("button", { name: "Apply a style patch" });
    // Faked before the frame is ready, so the renewal and the heartbeat
    // timers the ready frame sets up run on this clock.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    frameReady({ session: SESSION_A, serial: 1 });
    await tick(0);
    const first = frame();

    serving = { session: SESSION_A, serial: 2 };
    // A minute, answering every heartbeat as a live page does.
    for (let elapsed = 0; elapsed < 60_000; elapsed += 5_000) {
      await tick(5_000);
      if (frame() !== first) break;
      answerHeartbeat(first);
    }

    expect(touchThemePreviewServer).toHaveBeenCalledTimes(1);
    expect(applyThemePreviewFiles).not.toHaveBeenCalled();
    expect(frame()).not.toBe(first);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
  });
});

describe("a sync answer from another session", () => {
  it("is confirmed by one renewal question, and reloads only if it holds", async () => {
    await frameUpAndSynced();
    const first = frame();

    // A late answer naming a sidecar that is gone; the renewal says the
    // frame's own instance is serving.
    serving = { session: SESSION_B, serial: 1 };
    touchServing = { session: SESSION_A, serial: 1 };
    applyStylePatch();
    await tick(0);
    expect(touchThemePreviewServer).toHaveBeenCalledTimes(1);
    expect(frame()).toBe(first);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
  });

  it("reloads the frame when the renewal confirms a restarted sidecar", async () => {
    await frameUpAndSynced();
    const first = frame();

    serving = { session: SESSION_B, serial: 1 };
    applyStylePatch();
    await tick(0);
    expect(touchThemePreviewServer).toHaveBeenCalledTimes(1);
    expect(frame()).not.toBe(first);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
    expect(localHeroSource()).toContain("p-2 p-8");
  });
});
