import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { themeRouteStructureLock } from "@/lib/storefront/compiler/theme-route-sections";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";
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
 * Reproduction of loader-data-binding.spec.ts 2B (handoff/2026-10-30/
 * 2b-extra-save, handoff/2026-10-31/2b-narrow-fix-plan.md step 1).
 *
 * A Design section reorder on a loader route is refused on the Theme's source
 * generation (this tab holds 3, the server is at 4: another tab changed only
 * the loader's module, which makes the route a loader route and locks its
 * structure). The refusal invalidates the Theme files read. The author then
 * presses "Save my changes" in `EditorSourceConflictNotice`, which runs the
 * shell's real `saveSourceConflicts`.
 *
 * Two orderings: the press while that read is still in flight (as in the
 * failed E2E run), and the press after it has been answered and hydrated.
 *
 * Only server functions and the preview transport are mocked. The structure
 * lock is the real function, wrapped in a pass-through spy so the test can
 * tell whether `saveSourceConflicts` asked it, with which files, and what it
 * answered; its only caller in the shell is `saveSourceConflicts`. The server
 * double refuses every save whose expectedSourceGeneration is not the
 * current one, as the real source-generation check does.
 *
 * The first tests never open or preload the Code workspace (the E2E never
 * enters Code mode), so `editorCodeWorkspaceRef.current` is null and the
 * `saveAll` branch cannot send: any save after the press is the loop's
 * `handleUnifiedSaveFile`. The Code tests mount the real Code workspace
 * (Monaco is a textarea), preloaded as hovering its button does, or opened.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const saveThemeFile = vi.hoisted(() => vi.fn());

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
// Instrumentation only: the real lock, its calls recorded.
vi.mock(
  "@/lib/storefront/compiler/theme-route-sections",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/storefront/compiler/theme-route-sections")
      >();
    return {
      ...actual,
      themeRouteStructureLock: vi.fn(actual.themeRouteStructureLock),
    };
  },
);
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

// The fixture of the E2E's "a Design structure edit that meets a conflict".
const ROUTE_PATH = "/conflict-retry";
const ROUTE_FILE = "src/routes/conflict-retry.tsx";
const DATA_FILE = "src/server/conflict-retry.ts";
const LOCKED = /reads its content through its route loader/;

const retryComponent = (name: string) => `export const contentFields = {
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
const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import RetryHero from "../components/sections/RetryHero";
import RetryBanner from "../components/sections/RetryBanner";
import RetryPromo from "../components/sections/RetryPromo";
import { getRetryPage } from "../server/conflict-retry";

export const Route = createFileRoute("${ROUTE_PATH}")({
  loader: () => getRetryPage(),
  component: ConflictRetryRoute,
});

function ConflictRetryRoute() {
  const page = Route.useLoaderData();
  return (
    <main>
      <RetryHero {...content("hero")} />
      <RetryBanner {...content("banner")} />
      <RetryPromo {...page.promo} />
    </main>
  );
}
`;
const DATA_PLAIN = `import { createServerFn } from "@tanstack/react-start";

export const getRetryPage = createServerFn().handler(() => ({
  promo: { title: "Static promo" },
}));
`;
const DATA_PAGE = `import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";

export const getRetryPage = createServerFn().handler(() =>
  morph.pages.get("${ROUTE_PATH}"),
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
const themeFiles = (data: string, dataVersion: number) => [
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
  file("src/components/sections/RetryHero.tsx", retryComponent("RetryHero")),
  file(
    "src/components/sections/RetryBanner.tsx",
    retryComponent("RetryBanner"),
  ),
  file("src/components/sections/RetryPromo.tsx", retryComponent("RetryPromo")),
  file(DATA_FILE, data, dataVersion),
  file(ROUTE_FILE, ROUTE_SOURCE),
];
const tree = (
  files: ReturnType<typeof themeFiles>,
  sourceGeneration: number,
) => ({
  files,
  tree: [
    {
      name: "src",
      path: "src",
      isDirectory: true,
      children: files
        .filter((entry) => entry.path.startsWith("src/"))
        .map((entry) => ({
          name: entry.path.split("/").pop()!,
          path: entry.path,
          isDirectory: false,
        })),
    },
  ],
  sourceGeneration,
  latestPublishedRevision: null,
});
/** What this tab read when it opened: the loader is not this page. */
const TREE_AT_3 = tree(themeFiles(DATA_PLAIN, 1), 3);
/** The newest Theme: another tab changed only the loader's module. */
const TREE_AT_4 = tree(themeFiles(DATA_PAGE, 2), 4);
/**
 * The newest Theme when the other tab changed a file that leaves the route
 * unlocked: the reorder may be saved, against this read's generation.
 */
const TREE_AT_4_UNLOCKED = tree(
  themeFiles(DATA_PLAIN, 1).map((entry) =>
    entry.path === "src/router.tsx"
      ? {
          ...entry,
          content: "export const getRouter = () => undefined;\n",
          version: 2,
        }
      : entry,
  ),
  4,
);
const SERVER_GENERATION = 4;

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
      id: "template-retry",
      type: "page",
      name: "Conflict retry",
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
  templateId: "template-retry",
  routePath: ROUTE_PATH,
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

type Posted = {
  type: string;
  routePath?: string | null;
  routeRequestId?: number;
};
let log: Posted[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

/** Renders the route page, brings the frame up on it. */
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
    TREE_AT_3 as never,
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
}

type SentSave = {
  path: string;
  content: string;
  expectedVersion?: number;
  expectedSourceGeneration?: number;
};
const sentSaves = () =>
  saveThemeFile.mock.calls.map(
    ([request]) => (request as { data: SentSave }).data,
  );
const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
const store = () => useThemeWorkspaceStore.getState();
/** Design's surface only; Code's is added once it is opened or preloaded. */
const codeSurfaceMounted = () =>
  document.querySelectorAll("[data-editor-mode-surface]").length > 1;
const lockCalls = () => vi.mocked(themeRouteStructureLock).mock;
const lockToastShown = () =>
  vi
    .mocked(toast.error)
    .mock.calls.some((call) => LOCKED.test(String(call[0])));

/**
 * The reorder, refused on generation; the Theme read its refusal starts is
 * held until `answerRead` is called.
 */
async function refusedReorderWithReadHeld(options?: {
  beforeReorder?: () => Promise<void>;
}) {
  await settled();
  await options?.beforeReorder?.();
  // Precondition: what this tab holds before the reorder.
  expect(store().getAcceptedSourceGeneration(scope)).toBe(3);
  expect(store().getObservedSourceGeneration(scope)).toBe(3);
  expect(themeRouteStructureLock(TREE_AT_3.files, ROUTE_FILE)).toBeNull();
  expect(themeRouteStructureLock(TREE_AT_4.files, ROUTE_FILE)).toMatch(LOCKED);
  vi.mocked(themeRouteStructureLock).mockClear();

  const read = deferred<unknown>();
  const readsBefore = vi.mocked(listStorefrontThemeFiles).mock.calls.length;
  vi.mocked(listStorefrontThemeFiles).mockImplementation(
    () => read.promise as never,
  );

  fromPreview({
    type: "morph:storefront-preview-commit-section-reorder",
    draggedSectionId: "hero",
    targetSectionId: "banner",
  });
  await waitFor(() => expect(saveThemeFile).toHaveBeenCalledTimes(1));
  const [first] = sentSaves();
  expect(first?.path).toBe(ROUTE_FILE);
  expect(first?.expectedSourceGeneration).toBe(3);
  expect(first!.content.indexOf('content("banner")')).toBeLessThan(
    first!.content.indexOf('content("hero")'),
  );
  // The refusal started a Theme read, and it is still in flight.
  await waitFor(() =>
    expect(
      vi.mocked(listStorefrontThemeFiles).mock.calls.length,
    ).toBeGreaterThan(readsBefore),
  );
  await screen.findByRole("button", { name: "Save my changes" });
  expect(store().getObservedSourceGeneration(scope)).toBe(3);

  return {
    first,
    /** `data` may be a function, for a Theme that changes on later reads. */
    answerRead: async (
      data: typeof TREE_AT_4 | (() => typeof TREE_AT_4) = TREE_AT_4,
    ) => {
      const current = typeof data === "function" ? data : () => data;
      vi.mocked(listStorefrontThemeFiles).mockImplementation(
        async () =>
          ({ success: true, message: "ok", data: current() }) as never,
      );
      read.resolve({ success: true, message: "ok", data: current() });
      await tick(50);
    },
    /** The read, and any retry of it, fails. */
    failRead: async () => {
      const failed = {
        success: false,
        error: "LIST_FAILED",
        message: "Failed to list theme files",
      };
      vi.mocked(listStorefrontThemeFiles).mockImplementation(
        async () => failed as never,
      );
      read.resolve(failed);
      await tick(50);
    },
  };
}

/** Mounts the Code workspace without showing it, as hovering its button does. */
async function preloadCode() {
  act(() => {
    fireEvent.pointerEnter(screen.getByRole("button", { name: /^Code$/ }));
  });
  await waitFor(
    () => {
      expect(codeSurfaceMounted()).toBe(true);
      expect(screen.queryByText("Loading Code Workspace…")).toBeNull();
    },
    { timeout: 15_000 },
  );
}

/** Switches to Code and opens a file there, as the author clicks its row. */
async function openInCode(path: string) {
  act(() => {
    screen.getByRole("button", { name: /^Code$/ }).click();
  });
  const row = await waitFor(
    () => {
      const found = document.querySelector<HTMLElement>(
        `[data-file-tree-file="${path}"] > div`,
      );
      expect(found, `the row of ${path} in the Code explorer`).not.toBeNull();
      return found!;
    },
    { timeout: 15_000 },
  );
  act(() => {
    fireEvent.click(row);
  });
  return screen.findByRole(
    "textbox",
    { name: "Code editor" },
    { timeout: 15_000 },
  );
}

/** Opens a file in Code and replaces its text, as the author types. */
async function editInCode(path: string, content: string) {
  const editor = await openInCode(path);
  fireEvent.change(editor, { target: { value: content } });
  await tick(0);
}

const routeFileState = () =>
  store().getWorkspaceFiles("storefront-1", "theme-1")[ROUTE_FILE];

async function pressSaveMyChanges() {
  await act(async () => {
    screen.getByRole("button", { name: "Save my changes" }).click();
  });
}

/** What the press led to, once everything has settled. */
async function outcomeAfterPress(sentBeforePress: number) {
  await tick(300);
  const lock = lockCalls();
  return {
    sent: sentSaves().slice(sentBeforePress),
    lockRan: lock.calls.length,
    lockAnswers: lock.results.map((result) => result.value as string | null),
    lockSawDataFile: lock.calls.map(
      ([files]) =>
        (files as Array<{ path: string; content: string }>).find(
          (entry) => entry.path === DATA_FILE,
        )?.content,
    ),
    lockToastShown: lockToastShown(),
  };
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
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(3, scope);
  useEditorWriteGateStore.setState({ gates: {} });
  getThemeEditor.mockReset();
  getThemeEditor.mockResolvedValue({
    success: true,
    message: "ok",
    data: context,
  });
  updateSectionProps.mockReset();
  updateSectionProps.mockResolvedValue({
    success: true,
    data: { draftGeneration: 2, droppedProps: [] },
  });
  saveThemeFile.mockReset();
  // The server's source-generation check: any save not against the current
  // generation is refused, and nothing is stored.
  saveThemeFile.mockImplementation(async (request: { data: SentSave }) => {
    if (request.data.expectedSourceGeneration !== SERVER_GENERATION) {
      return {
        success: false,
        error: "SOURCE_GENERATION_CONFLICT",
        message: `Theme source changed (current generation: ${SERVER_GENERATION}).`,
      };
    }
    return {
      success: true,
      message: "saved",
      data: {
        ...file(ROUTE_FILE, request.data.content, 2),
        sourceGeneration: SERVER_GENERATION + 1,
      },
    };
  });
  vi.mocked(themeRouteStructureLock).mockClear();
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
    async () => ({ success: true, message: "ok", data: TREE_AT_3 }) as never,
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

describe("2B: 'Save my changes' after a Design reorder refused on generation", () => {
  it("(ii) read answered before the press: the lock is asked on the newest files, refuses, nothing is sent", async () => {
    const { answerRead } = await refusedReorderWithReadHeld();
    await answerRead();
    // The read was hydrated: this tab has seen generation 4 and the new
    // loader module (the data file was not dirty).
    expect(store().getObservedSourceGeneration(scope)).toBe(4);
    expect(
      store().getWorkspaceFiles("storefront-1", "theme-1")[DATA_FILE]
        ?.localContent,
    ).toBe(DATA_PAGE);
    // Precondition: Code workspace never mounted, so `saveAll` cannot send.
    expect(codeSurfaceMounted()).toBe(false);
    const sentBeforePress = sentSaves().length;

    await pressSaveMyChanges();
    const outcome = await outcomeAfterPress(sentBeforePress);

    expect(outcome.sent).toEqual([]);
    expect(outcome.lockRan).toBe(1);
    expect(outcome.lockSawDataFile).toEqual([DATA_PAGE]);
    expect(outcome.lockAnswers[0]).toMatch(LOCKED);
    expect(outcome.lockToastShown).toBe(true);
    // The press accepted the generation the hydrated read observed.
    expect(store().getAcceptedSourceGeneration(scope)).toBe(4);
    // Not discarded: still marked and unsaved.
    expect(
      screen.getByRole("button", { name: "Save my changes" }),
    ).toBeTruthy();
  });

  it("(i) press while the read is in flight: the press waits for that read, accepts its generation, and the lock judged on its files refuses; nothing is sent", async () => {
    const { answerRead } = await refusedReorderWithReadHeld();
    // Precondition: Code workspace never mounted, so `saveAll` cannot send.
    expect(codeSurfaceMounted()).toBe(false);
    const sentBeforePress = sentSaves().length;

    await pressSaveMyChanges();
    // Nothing accepted, asked or sent before the newest read is answered.
    expect(store().getAcceptedSourceGeneration(scope)).toBe(3);
    expect(lockCalls().calls.length).toBe(0);
    expect(sentSaves().length).toBe(sentBeforePress);
    await answerRead();
    const outcome = await outcomeAfterPress(sentBeforePress);

    // Asked once, on the newest loader module: this tab never changed that
    // file, so its older copy does not stand in for the stored one.
    expect(outcome.lockRan).toBe(1);
    expect(outcome.lockSawDataFile).toEqual([DATA_PAGE]);
    expect(outcome.lockAnswers[0]).toMatch(LOCKED);
    expect(outcome.lockToastShown).toBe(true);
    expect(outcome.sent).toEqual([]);
    // The generation of the read the lock was judged on.
    expect(store().getAcceptedSourceGeneration(scope)).toBe(4);
    // Not discarded: still marked and unsaved.
    expect(routeFileState()?.sourceConflict).toBe(true);
    expect(routeFileState()?.dirty).toBe(true);
    expect(
      screen.getByRole("button", { name: "Save my changes" }),
    ).toBeTruthy();
  });

  it("(i) press while the read is in flight (intended): refused locally by the lock on the newest Theme, nothing sent", async () => {
    const { answerRead } = await refusedReorderWithReadHeld();
    const sentBeforePress = sentSaves().length;

    await pressSaveMyChanges();
    await answerRead();
    const outcome = await outcomeAfterPress(sentBeforePress);

    expect(outcome.sent).toEqual([]);
    expect(outcome.lockToastShown).toBe(true);
  });

  it("generation consistency: when the newest read leaves the route unlocked, the resend carries that read's generation and lands", async () => {
    const { answerRead, first } = await refusedReorderWithReadHeld();
    const sentBeforePress = sentSaves().length;

    await pressSaveMyChanges();
    await answerRead(TREE_AT_4_UNLOCKED);
    const outcome = await outcomeAfterPress(sentBeforePress);

    // The lock was judged on that read's files and allowed the edit …
    expect(outcome.lockRan).toBe(1);
    expect(outcome.lockSawDataFile).toEqual([DATA_PLAIN]);
    expect(outcome.lockAnswers).toEqual([null]);
    expect(outcome.lockToastShown).toBe(false);
    // … and the one send carries the same read's generation, with the route
    // file's own version unchanged (the server still checks both).
    expect(outcome.sent).toHaveLength(1);
    expect(outcome.sent[0]).toEqual({
      ...first,
      expectedSourceGeneration: TREE_AT_4_UNLOCKED.sourceGeneration,
    });
    expect(outcome.sent[0]?.expectedVersion).toBe(first?.expectedVersion);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save my changes" }),
      ).toBeNull(),
    );
  });

  it("read failure: the newest read fails, nothing is sent, the edit stays unsaved and an error is shown", async () => {
    const { failRead } = await refusedReorderWithReadHeld();
    const sentBeforePress = sentSaves().length;

    await pressSaveMyChanges();
    await failRead();
    await waitFor(
      () =>
        expect(
          vi
            .mocked(toast.error)
            .mock.calls.some((call) =>
              /latest version of the Theme could not be read/.test(
                String(call[0]),
              ),
            ),
        ).toBe(true),
      { timeout: 5_000 },
    );
    const outcome = await outcomeAfterPress(sentBeforePress);

    expect(outcome.sent).toEqual([]);
    expect(outcome.lockRan).toBe(0);
    expect(store().getAcceptedSourceGeneration(scope)).toBe(3);
    expect(routeFileState()?.sourceConflict).toBe(true);
    expect(routeFileState()?.dirty).toBe(true);
    expect(
      screen.getByRole("button", { name: "Save my changes" }),
    ).toBeTruthy();
  });
});

describe("2B with the Code workspace mounted", () => {
  it("Code preloaded, no edit in Code: the Design reorder is left out of Code's save, refused by the lock on the newest Theme, nothing sent", async () => {
    const { answerRead } = await refusedReorderWithReadHeld({
      beforeReorder: preloadCode,
    });
    expect(codeSurfaceMounted()).toBe(true);
    const sentBeforePress = sentSaves().length;

    await pressSaveMyChanges();
    await answerRead();
    const outcome = await outcomeAfterPress(sentBeforePress);

    expect(outcome.sent).toEqual([]);
    expect(outcome.lockRan).toBe(1);
    expect(outcome.lockSawDataFile).toEqual([DATA_PAGE]);
    expect(outcome.lockAnswers[0]).toMatch(LOCKED);
    expect(outcome.lockToastShown).toBe(true);
    expect(routeFileState()?.sourceConflict).toBe(true);
    expect(routeFileState()?.dirty).toBe(true);
  });

  it("Code mode active, route file shown unsaved only from the Design reorder: still refused by the lock on the newest Theme, nothing sent", async () => {
    const { answerRead, first } = await refusedReorderWithReadHeld();
    // Code is shown, on the route file, which it lists as unsaved: the
    // author has not typed in it.
    const editor = await openInCode(ROUTE_FILE);
    expect(
      editor.closest("[data-editor-mode-surface]")?.getAttribute("aria-hidden"),
    ).toBe("false");
    expect(routeFileState()?.dirty).toBe(true);
    expect(routeFileState()?.localContent).toBe(first!.content);
    const sentBeforePress = sentSaves().length;

    await pressSaveMyChanges();
    await answerRead();
    const outcome = await outcomeAfterPress(sentBeforePress);

    expect(outcome.sent).toEqual([]);
    expect(outcome.lockRan).toBe(1);
    expect(outcome.lockSawDataFile).toEqual([DATA_PAGE]);
    expect(outcome.lockAnswers[0]).toMatch(LOCKED);
    expect(outcome.lockToastShown).toBe(true);
    expect(routeFileState()?.sourceConflict).toBe(true);
    expect(routeFileState()?.dirty).toBe(true);
  });

  it.each([
    ["unlocked", TREE_AT_4_UNLOCKED, null],
    ["locked", TREE_AT_4, LOCKED],
  ] as const)(
    "Code saves another file first, moving the generation on: the Theme is read again, and the Design reorder is judged on that read and sent against its generation, or held (newest Theme %s)",
    async (_label, base, expectedLock) => {
      // A server that stores what it accepts and moves its generation on.
      let generation = base.sourceGeneration;
      const stored = new Map(base.files.map((entry) => [entry.path, entry]));
      const currentTree = () => tree([...stored.values()], generation);
      const reads: number[] = [];
      saveThemeFile.mockImplementation(async (request: { data: SentSave }) => {
        if (request.data.expectedSourceGeneration !== generation) {
          return {
            success: false,
            error: "SOURCE_GENERATION_CONFLICT",
            message: `Theme source changed (current generation: ${generation}).`,
          };
        }
        const before = stored.get(request.data.path)!;
        const saved = {
          ...before,
          content: request.data.content,
          version: before.version + 1,
        };
        stored.set(saved.path, saved);
        generation += 1;
        return {
          success: true,
          message: "saved",
          data: { ...saved, sourceGeneration: generation },
        };
      });
      const { answerRead, first } = await refusedReorderWithReadHeld();
      // The author's own edit, in Code, of a file the reorder did not touch.
      const PROMO = "src/components/sections/RetryPromo.tsx";
      const promo = `${retryComponent("RetryPromo")}// edited in Code\n`;
      await editInCode(PROMO, promo);
      const sentBeforePress = sentSaves().length;

      await pressSaveMyChanges();
      await answerRead(() => {
        reads.push(generation);
        return currentTree();
      });
      const outcome = await outcomeAfterPress(sentBeforePress);

      // Code saved the promo against the first read's generation, and it
      // landed: the generation moved on past that read.
      const promoLanded = outcome.sent.filter(
        (save) =>
          save.path === PROMO &&
          save.expectedSourceGeneration === base.sourceGeneration,
      );
      expect(promoLanded).toHaveLength(1);
      expect(stored.get(PROMO)?.content).toBe(promo);
      // The Theme was read again after that save, and the lock was judged on
      // that read: it holds the promo as saved.
      expect(reads).toContain(base.sourceGeneration + 1);
      expect(outcome.lockRan).toBe(1);
      const judged = lockCalls().calls[0]![0] as Array<{
        path: string;
        content: string;
      }>;
      expect(judged.find((entry) => entry.path === PROMO)?.content).toBe(promo);
      const routeSends = outcome.sent.filter(
        (save) => save.path === ROUTE_FILE,
      );
      if (expectedLock) {
        expect(outcome.lockAnswers[0]).toMatch(expectedLock);
        expect(outcome.lockToastShown).toBe(true);
        expect(routeSends).toEqual([]);
        expect(routeFileState()?.sourceConflict).toBe(true);
        expect(routeFileState()?.dirty).toBe(true);
      } else {
        expect(outcome.lockAnswers).toEqual([null]);
        // Sent once, against the generation of the read the lock used.
        expect(routeSends).toEqual([
          {
            ...first,
            expectedSourceGeneration: base.sourceGeneration + 1,
          },
        ]);
        expect(stored.get(ROUTE_FILE)?.content).toBe(first!.content);
      }
    },
  );

  it("explicit Code rewrite: the author's own edit of the route in Code is saved by Code, against the newest read's generation", async () => {
    const { answerRead, first } = await refusedReorderWithReadHeld();
    // The author's own rewrite, on top of the refused reorder.
    const rewrite = `${first!.content}// kept by hand\n`;
    await editInCode(ROUTE_FILE, rewrite);
    const sentBeforePress = sentSaves().length;

    await pressSaveMyChanges();
    await answerRead();
    const outcome = await outcomeAfterPress(sentBeforePress);

    // Not the Design guard's to judge: the lock is not asked about it.
    expect(outcome.lockRan).toBe(0);
    // Code's autosave may have sent it once already, against the refused
    // generation; the author's save sends it against the newest read's, and
    // the server double, which refuses any other generation, stores it.
    const landed = outcome.sent.filter(
      (save) => save.expectedSourceGeneration === SERVER_GENERATION,
    );
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({
      path: ROUTE_FILE,
      content: rewrite,
      expectedVersion: first?.expectedVersion,
    });
    expect(outcome.sent.every((save) => save.content === rewrite)).toBe(true);
    await waitFor(() => expect(routeFileState()?.dirty).toBe(false));
    expect(routeFileState()?.sourceConflict).toBeFalsy();
  });
});
