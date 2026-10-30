import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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
 * The Code workspace is never opened or preloaded here (the E2E never enters
 * Code mode), so `editorCodeWorkspaceRef.current` is null and the
 * `saveAll` branch cannot send: any save after the press is the loop's
 * `handleUnifiedSaveFile`.
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
async function refusedReorderWithReadHeld() {
  await settled();
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
    answerRead: async () => {
      vi.mocked(listStorefrontThemeFiles).mockImplementation(
        async () =>
          ({ success: true, message: "ok", data: TREE_AT_4 }) as never,
      );
      read.resolve({ success: true, message: "ok", data: TREE_AT_4 });
      await tick(50);
    },
  };
}

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

  it("(i) press while the read is in flight (current behaviour): the lock runs on this tab's stale loader module, answers unlocked, and the loop's handleUnifiedSaveFile resends the same body with generation 3", async () => {
    const { answerRead } = await refusedReorderWithReadHeld();
    const [first] = sentSaves();
    // Precondition: Code workspace never mounted, so `saveAll` cannot send.
    expect(codeSurfaceMounted()).toBe(false);
    const sentBeforePress = sentSaves().length;

    await pressSaveMyChanges();
    // The press accepted what was observed then: still 3.
    expect(store().getAcceptedSourceGeneration(scope)).toBe(3);
    // The lock check waits on the same in-flight read (fetchQuery, staleTime 0).
    expect(lockCalls().calls.length).toBe(0);
    await answerRead();
    const outcome = await outcomeAfterPress(sentBeforePress);

    // The lock was asked once, by `saveSourceConflicts` …
    expect(outcome.lockRan).toBe(1);
    // … with the files this tab held at the press for every file but the
    // route: the loader's module as it was before the other tab's save.
    expect(outcome.lockSawDataFile).toEqual([DATA_PLAIN]);
    expect(outcome.lockAnswers).toEqual([null]);
    expect(outcome.lockToastShown).toBe(false);
    // One save, byte-identical to the refused one, still against generation 3.
    expect(outcome.sent).toHaveLength(1);
    expect(outcome.sent[0]).toEqual(first);
    expect(outcome.sent[0]?.expectedSourceGeneration).toBe(3);
    // Refused again by the server double; the hydrated read moved observed
    // to 4 after the accept, so accepted stays behind it.
    expect(store().getObservedSourceGeneration(scope)).toBe(4);
    expect(store().getAcceptedSourceGeneration(scope)).toBe(3);
    expect(
      screen.getByRole("button", { name: "Save my changes" }),
    ).toBeTruthy();
  });

  it.fails(
    "(i) press while the read is in flight (intended): refused locally by the lock on the newest Theme, nothing sent",
    async () => {
      const { answerRead } = await refusedReorderWithReadHeld();
      const sentBeforePress = sentSaves().length;

      await pressSaveMyChanges();
      await answerRead();
      const outcome = await outcomeAfterPress(sentBeforePress);

      expect(outcome.sent).toEqual([]);
      expect(outcome.lockToastShown).toBe(true);
    },
  );
});
