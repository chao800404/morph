import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
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
  PREVIEW_RELOAD_CONTENT_UNREAD_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";

/**
 * The content replay after a frame reload, on a static route that is not the
 * home page (`/inline-reload-defer`, as the E2E uses).
 *
 * Every preview frame boots on `/` and is moved to the selected route by
 * `set-route`. Content posted before it arrives is applied to the boot page's
 * content, not this route's. So the replay waits until the frame that came
 * up answers the latest `set-route` with the route it is on
 * (`morph:storefront-preview-route-applied`) — or with null, which only a
 * page with no router says. Nothing else counts: the route having been sent,
 * a structure report with or without a route, an answer from the replaced
 * window, to an older request, for another route. With no answer at all, as
 * from a frame running an older bridge, it gives up and says so.
 *
 * Assertions stop at what is posted, to which window, and when.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";
const ROUTE_PATH = "/inline-reload-defer";
const SLOT = "defer-card";
const STORED = "Stored defer title";

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

const routeDocument = (title: string, draftGeneration = 1) => ({
  id: "template-route",
  type: "page",
  name: "Inline reload defer",
  routePath: ROUTE_PATH,
  document: {
    version: 1,
    sections: [{ id: SLOT, type: "DeferCard", props: { title } }],
  },
  draftRevisionId: null,
  publishedRevisionId: null,
  draftGeneration,
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
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      document: { version: 1, sections: [] },
      draftGeneration: 1,
      version: 1,
    },
    routeDocument("Defer title before the reload"),
  ],
} as unknown as StorefrontThemeEditorDTO;

const search = {
  template: "page",
  templateId: "template-route",
  routePath: ROUTE_PATH,
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
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
});
// The route and component the E2E writes (e2e/preview-inline-reload-defer.spec.ts).
const FILES = [
  file(
    "src/morph/content.ts",
    'export { content, morph, isSectionHidden } from "@morph/sdk";\n',
  ),
  file(
    "src/routes/index.tsx",
    'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/")({ component: () => <main /> });\n',
  ),
  file(
    "src/routes/inline-reload-defer.tsx",
    `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import DeferCard from "../defer/DeferCard";

export const Route = createFileRoute("${ROUTE_PATH}")({
  component: DeferRoute,
});

function DeferRoute() {
  return (
    <main>
      <DeferCard {...content("${SLOT}")} />
    </main>
  );
}
`,
  ),
  file(
    "src/defer/DeferCard.tsx",
    `type DeferCardProps = { title?: string };

export default function DeferCard({ title = "Defer default title" }: DeferCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
    </section>
  );
}
`,
  ),
  file(
    "src/defer/DeferCard.fields.ts",
    `export const contentFields = {
  title: { type: "text", label: "DeferCard title" },
} as const;
`,
  ),
];
const leaf = (path: string) => ({
  name: path.split("/").at(-1)!,
  path,
  isDirectory: false,
});
const tree = () => ({
  files: FILES,
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
          children: [
            leaf("src/routes/index.tsx"),
            leaf("src/routes/inline-reload-defer.tsx"),
          ],
        },
        {
          name: "defer",
          path: "src/defer",
          isDirectory: true,
          children: [
            leaf("src/defer/DeferCard.tsx"),
            leaf("src/defer/DeferCard.fields.ts"),
          ],
        },
      ],
    },
  ],
  sourceGeneration: 1,
  latestPublishedRevision: null,
});

let serving = { session: SESSION, serial: 1 };
const infoLines: string[] = [];

type Posted = {
  type: string;
  sectionId?: string;
  props?: Record<string, unknown>;
  routePath?: string | null;
  routeRequestId?: number;
};
/** Every post, in order, with the window it went to. */
let log: Array<{ target: unknown; message: Posted }> = [];

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
    tree() as never,
  );
  return render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={search}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const currentWindow = () =>
  document.querySelector("iframe")?.contentWindow ?? null;
const event = (data: Record<string, unknown>, source: Window | null) =>
  new MessageEvent("message", {
    data: { ...data, previewSession: PREVIEW_SESSION },
    origin: PREVIEW_ORIGIN,
    source,
  });
function fromPreview(data: Record<string, unknown>, source = currentWindow()) {
  act(() => {
    window.dispatchEvent(event(data, source));
  });
}
/** Delivered outside act: React has not committed what the handler set. */
function fromPreviewUncommitted(data: Record<string, unknown>) {
  window.dispatchEvent(event(data, currentWindow()));
}

const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Answers heartbeats as a live page does while `ms` pass. */
async function live(ms: number) {
  const frame = document.querySelector("iframe");
  for (let elapsed = 0; elapsed < ms; elapsed += 5_000) {
    await tick(5_000);
    const ping = log
      .map((entry) => entry.message as Posted & { heartbeatId?: number })
      .filter((message) => message.type === "morph:storefront-preview-ping")
      .at(-1);
    if (ping && document.querySelector("iframe") === frame) {
      fromPreview({
        type: "morph:storefront-preview-pong",
        heartbeatId: ping.heartbeatId,
      });
    }
  }
}

const cardPosts = (target: unknown) =>
  log.filter(
    (entry) =>
      entry.target === target &&
      entry.message.type === "morph:storefront-preview-update-section-props" &&
      entry.message.sectionId === SLOT,
  );
const cardMessages = (target: unknown) =>
  cardPosts(target).map((entry) => entry.message);
const routeRequests = (target: unknown) =>
  log.filter(
    (entry) =>
      entry.target === target &&
      entry.message.type === "morph:storefront-preview-set-route",
  );
const latestRequest = (target: unknown) =>
  routeRequests(target).at(-1)?.message.routeRequestId;
const replayedLines = () =>
  infoLines.filter((line) =>
    line.startsWith("[preview-instance] content replayed"),
  );
const givenUpLines = () =>
  infoLines.filter((line) =>
    line.startsWith("[preview-instance] content replay given up"),
  );
const reloadLines = () =>
  infoLines.filter((line) =>
    line.startsWith("[preview-instance] reload frame"),
  );
const notices = () =>
  vi
    .mocked(toast.warning)
    .mock.calls.filter(
      (call) => call[0] === PREVIEW_RELOAD_CONTENT_UNREAD_MESSAGE,
    );

/**
 * The first frame comes up on `.1`; a renewal names `.2`, so it is reloaded.
 * Returns the replaced window and the new one, which has not said it is ready.
 */
async function reloaded() {
  renderShell();
  await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  fromPreview({
    type: "morph:storefront-preview-ready",
    servedInstance: {
      kind: "known",
      instance: { session: SESSION, serial: 1 },
    },
  });
  await tick(0);
  await tick(0);
  const first = currentWindow();
  // Precondition: the first frame was sent its route.
  expect(
    routeRequests(first).map((entry) => entry.message.routePath),
  ).toContain(ROUTE_PATH);
  // The saved copy a read returns from now on.
  getThemeEditor.mockResolvedValue({
    success: true,
    message: "ok",
    data: {
      ...context,
      templates: [context.templates[0], routeDocument(STORED, 2)],
    },
  });
  serving = { session: SESSION, serial: 2 };
  await live(65_000);
  expect(reloadLines()).toHaveLength(1);
  const second = currentWindow();
  // Compared, not printed: a detached window cannot be printed.
  expect(second !== null && second !== first).toBe(true);
  return { first, second: second! };
}

/** The new frame says it is ready, on `.2`; its read lands. */
async function newFrameReady() {
  fromPreview({
    type: "morph:storefront-preview-ready",
    servedInstance: { kind: "known", instance: serving },
  });
  await tick(0);
  await tick(0);
}

const applied = (
  routeRequestId: number | undefined,
  routePath: string | null,
  source?: Window | null,
) =>
  fromPreview(
    {
      type: "morph:storefront-preview-route-applied",
      routeRequestId,
      routePath,
    },
    source === undefined ? currentWindow() : source,
  );

beforeEach(() => {
  serving = { session: SESSION, serial: 1 };
  infoLines.length = 0;
  log = [];
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
    .setBaseSourceGeneration(1, {
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
    (target, message) => {
      log.push({ target, message: message as Posted });
    },
  );
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
          servedInstance: serving,
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
          servedInstance: serving,
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

describe("the replay after a frame reload on a route that is not the home page", () => {
  it("posts nothing until the new frame confirms the route, then posts once", async () => {
    const { second } = await reloaded();
    await newFrameReady();
    // The router has matched nothing yet, then the page it booted on.
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [] });
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/",
    });
    await tick(0);
    await tick(0);
    // The route was sent; that, and those reports, post nothing.
    expect(routeRequests(second).at(-1)?.message.routePath).toBe(ROUTE_PATH);
    expect(cardMessages(second)).toEqual([]);
    expect(replayedLines()).toEqual([]);
    // The request carries the id it is answered with.
    const request = latestRequest(second);
    expect(request).toEqual(expect.any(Number));

    applied(request, ROUTE_PATH);
    await tick(0);
    expect(cardMessages(second).map((message) => message.props?.title)).toEqual(
      [STORED],
    );
    expect(replayedLines()).toEqual([
      `[preview-instance] content replayed | round 2 | ${ROUTE_PATH}`,
    ]);
    // After the route was sent to this window, not before.
    expect(log.indexOf(routeRequests(second).at(-1)!)).toBeLessThan(
      log.indexOf(cardPosts(second)[0]!),
    );
    expect(notices()).toEqual([]);
  });

  it("waits through a slow navigation, then posts exactly once", async () => {
    const { second } = await reloaded();
    await newFrameReady();
    const request = latestRequest(second);
    await live(10_000);
    expect(cardMessages(second)).toEqual([]);
    applied(request, ROUTE_PATH);
    await tick(0);
    expect(cardMessages(second)).toHaveLength(1);
    // The same answer again, and time: nothing more.
    applied(request, ROUTE_PATH);
    await live(INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS + 5_000);
    expect(cardMessages(second)).toHaveLength(1);
    expect(replayedLines()).toHaveLength(1);
    expect(notices()).toEqual([]);
    expect(givenUpLines()).toEqual([]);
  });

  describe("is not released by", () => {
    it("reports that name no route", async () => {
      const { second } = await reloaded();
      await newFrameReady();
      for (let report = 0; report < 3; report += 1) {
        fromPreview({ type: "morph:storefront-preview-structure", nodes: [] });
      }
      await tick(0);
      expect(cardMessages(second)).toEqual([]);
      expect(replayedLines()).toEqual([]);
    });

    it("an answer from the replaced window", async () => {
      const { first, second } = await reloaded();
      await newFrameReady();
      const request = latestRequest(second);
      applied(request, ROUTE_PATH, first);
      await tick(0);
      expect(cardMessages(second)).toEqual([]);
      expect(cardMessages(first)).toEqual([]);
      // The new frame's own answer still counts.
      applied(request, ROUTE_PATH);
      await tick(0);
      expect(cardMessages(second)).toHaveLength(1);
    });

    it("an answer to the request of an earlier ready round", async () => {
      const { first, second } = await reloaded();
      const earlier = latestRequest(first);
      await newFrameReady();
      expect(latestRequest(second)).not.toBe(earlier);
      applied(earlier, ROUTE_PATH);
      await tick(0);
      expect(cardMessages(second)).toEqual([]);
      expect(givenUpLines()).toEqual([]);
      applied(latestRequest(second), ROUTE_PATH);
      await tick(0);
      expect(cardMessages(second)).toHaveLength(1);
    });

    it("a report of another route, nor an answer that the frame is on one", async () => {
      const { second } = await reloaded();
      await newFrameReady();
      // On the way there: set aside, the replay still waits.
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/",
      });
      await tick(0);
      expect(cardMessages(second)).toEqual([]);
      expect(givenUpLines()).toEqual([]);
      // The answer: it is somewhere else. Nothing is posted, and the author is told.
      applied(latestRequest(second), "/");
      await tick(0);
      expect(cardMessages(second)).toEqual([]);
      expect(givenUpLines()).toHaveLength(1);
      expect(notices()).toHaveLength(1);
      applied(latestRequest(second), ROUTE_PATH);
      await tick(0);
      expect(cardMessages(second)).toEqual([]);
    });

    it("reports and answers that arrived before the route was sent", async () => {
      const { second } = await reloaded();
      const before = routeRequests(second).length;
      fromPreviewUncommitted({
        type: "morph:storefront-preview-ready",
        servedInstance: { kind: "known", instance: serving },
      });
      const guessed = (latestRequest(currentWindow()) ?? 0) + 1;
      fromPreviewUncommitted({
        type: "morph:storefront-preview-structure",
        nodes: [],
      });
      fromPreviewUncommitted({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: ROUTE_PATH,
      });
      fromPreviewUncommitted({
        type: "morph:storefront-preview-route-applied",
        routeRequestId: guessed,
        routePath: ROUTE_PATH,
      });
      // Precondition: none of it found the route sent yet.
      expect(routeRequests(second)).toHaveLength(before);
      await act(async () => {});
      await tick(0);
      await tick(0);
      expect(routeRequests(second).length).toBeGreaterThan(before);
      expect(cardMessages(second)).toEqual([]);
      applied(latestRequest(second), ROUTE_PATH);
      await tick(0);
      expect(cardMessages(second)).toHaveLength(1);
    });
  });

  describe("an answer of null, which says the page has no router", () => {
    it("releases a frame that never named a route", async () => {
      const { second } = await reloaded();
      await newFrameReady();
      fromPreview({ type: "morph:storefront-preview-structure", nodes: [] });
      applied(latestRequest(second), null);
      await tick(0);
      expect(
        cardMessages(second).map((message) => message.props?.title),
      ).toEqual([STORED]);
    });

    it("does not confirm the target of a frame that named a route", async () => {
      const { second } = await reloaded();
      await newFrameReady();
      fromPreview({
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/",
      });
      applied(latestRequest(second), null);
      await tick(0);
      expect(cardMessages(second)).toEqual([]);
      expect(givenUpLines()).toHaveLength(1);
      expect(notices()).toHaveLength(1);
    });
  });

  it("gives up and says so when the frame never answers, as one on an older bridge", async () => {
    const { second } = await reloaded();
    await newFrameReady();
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [] });
    const frame = document.querySelector("iframe");
    const touched = vi.mocked(touchThemePreviewServer).mock.calls.length;
    await live(INSTANCE_REPLAY_CONFIRM_TIMEOUT_MS + 5_000);
    expect(cardMessages(second)).toEqual([]);
    expect(givenUpLines()).toEqual([
      "[preview-instance] content replay given up | the frame did not confirm its route in time",
    ]);
    expect(notices()).toEqual([
      [
        PREVIEW_RELOAD_CONTENT_UNREAD_MESSAGE,
        { id: "preview-reload-content-unread", duration: 10_000 },
      ],
    ]);
    // Only that: the frame is kept, nothing is reloaded, started or saved.
    expect(document.querySelector("iframe")).toBe(frame);
    expect(reloadLines()).toHaveLength(1);
    expect(startThemePreviewServer).not.toHaveBeenCalled();
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(
      vi.mocked(touchThemePreviewServer).mock.calls.length,
    ).toBeGreaterThanOrEqual(touched);
    // A late answer posts nothing.
    applied(latestRequest(second), ROUTE_PATH);
    await tick(0);
    expect(cardMessages(second)).toEqual([]);
    expect(notices()).toHaveLength(1);
  });
});
