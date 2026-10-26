import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { signThemePreviewMedia } from "@/server/storefront/storefront-preview-media.serverFn";
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
 * The content replay after a frame reload, for a section the editor holds as
 * hidden (design v2, P5 with R1).
 *
 * #252's gating is unchanged and is not re-tested here
 * (`visual-editor-shell-replay-route-confirmed.test.tsx`): the replay still
 * waits for the new frame's own answer to the latest set-route in its ready
 * round. What changes is what it sends for a hidden section: no props, only
 * `enabled: false` — whether the hide is unanswered, confirmed by this tab,
 * or another tab's hide the replay's own read brought in. And a value the
 * replay composed while the section was shown, posted again once its media
 * is signed, is not posted after a hide.
 *
 * Same harness as the #252 suite, on the same static route.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";
const ROUTE_PATH = "/inline-reload-defer";
const SLOT = "defer-card";
const STORED = "Stored defer title";
const ASSET = "0b9f3a52-2f7e-4c1a-9d4b-6a1f2e3d4c5b";
const SIGNED_URL = "https://media.morph.test/signed-defer.png";
const IMAGE = {
  source: "asset",
  mediaType: "image",
  assetId: ASSET,
  url: `/assets/${ASSET}.png`,
  name: "defer.png",
};

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

const routeDocument = (
  title: string,
  draftGeneration = 1,
  enabled?: boolean,
) => ({
  id: "template-route",
  type: "page",
  name: "Inline reload defer",
  routePath: ROUTE_PATH,
  document: {
    version: 1,
    sections: [
      {
        id: SLOT,
        type: "DeferCard",
        ...(enabled === undefined ? {} : { enabled }),
        props: { title, image: IMAGE },
      },
    ],
  },
  draftRevisionId: null,
  publishedRevisionId: null,
  draftGeneration,
  version: 1,
});

const homeTemplate = {
  id: "template-1",
  type: "index",
  name: "Home",
  document: { version: 1, sections: [] },
  draftGeneration: 1,
  version: 1,
};
const context = {
  previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
  storefront: {
    id: "storefront-1",
    name: "Store",
    domain: null,
    status: "active",
  },
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
  templates: [homeTemplate, routeDocument("Defer title before the reload")],
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
    `type DeferCardProps = { title?: string; image?: { url?: string } };

export default function DeferCard({ title = "Defer default title", image }: DeferCardProps) {
  return (
    <section className="px-6 py-10">
      <h2 className="text-2xl font-semibold">{title}</h2>
      {image?.url ? <img src={image.url} alt="" /> : null}
    </section>
  );
}
`,
  ),
  file(
    "src/defer/DeferCard.fields.ts",
    `export const contentFields = {
  title: { type: "text", label: "DeferCard title" },
  image: { type: "image", label: "DeferCard image" },
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

type Posted = {
  type: string;
  sectionId?: string;
  props?: Record<string, unknown>;
  enabled?: boolean;
  routePath?: string | null;
  routeRequestId?: number;
  heartbeatId?: number;
};
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
function fromPreview(data: Record<string, unknown>, source = currentWindow()) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION },
        origin: PREVIEW_ORIGIN,
        source,
      }),
    );
  });
}

const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function live(ms: number) {
  const frame = document.querySelector("iframe");
  for (let elapsed = 0; elapsed < ms; elapsed += 5_000) {
    await tick(5_000);
    const ping = log
      .map((entry) => entry.message)
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

const cardMessages = (target: unknown) =>
  log
    .filter(
      (entry) =>
        entry.target === target &&
        entry.message.type === "morph:storefront-preview-update-section-props" &&
        entry.message.sectionId === SLOT,
    )
    .map((entry) => entry.message);
const latestRequest = (target: unknown) =>
  log
    .filter(
      (entry) =>
        entry.target === target &&
        entry.message.type === "morph:storefront-preview-set-route",
    )
    .at(-1)?.message.routeRequestId;
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

/** The first frame comes up on `.1` and is sent its route. */
async function firstFrame() {
  renderShell();
  await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  fromPreview({
    type: "morph:storefront-preview-ready",
    servedInstance: { kind: "known", instance: { session: SESSION, serial: 1 } },
  });
  await tick(0);
  await tick(0);
  return currentWindow();
}

/** A renewal names `.2`: the frame is reloaded; the new one comes up. */
async function reloadAndReady(first: Window | null) {
  serving = { session: SESSION, serial: 2 };
  await live(65_000);
  const second = currentWindow();
  expect(second !== null && second !== first).toBe(true);
  fromPreview({
    type: "morph:storefront-preview-ready",
    servedInstance: { kind: "known", instance: serving },
  });
  await tick(0);
  await tick(0);
  return second!;
}

async function hide() {
  fireEvent.click(
    screen.getAllByRole("button", { name: /^Hide section/ })[0]!,
  );
  await tick(0);
  await tick(0);
}

beforeEach(() => {
  serving = { session: SESSION, serial: 1 };
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
    .setBaseSourceGeneration(1, { storefrontId: "storefront-1", themeId: "theme-1" });
  useEditorWriteGateStore.setState({ gates: {} });
  getThemeEditor.mockReset();
  getThemeEditor.mockResolvedValue({
    success: true,
    message: "ok",
    data: { ...context, templates: [homeTemplate, routeDocument(STORED, 2)] },
  });
  updateSectionProps.mockReset();
  vi.mocked(postEditorToPreviewMessage).mockReset();
  vi.mocked(postEditorToPreviewMessage).mockImplementation((target, message) => {
    log.push({ target, message: message as Posted });
  });
  vi.mocked(signThemePreviewMedia).mockReset();
  vi.mocked(signThemePreviewMedia).mockResolvedValue({
    success: true,
    data: { urls: { [ASSET]: SIGNED_URL }, expiresAt: Date.now() + 86_400_000 },
  } as never);
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(console, "info").mockImplementation(() => {});
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
    const files = (request as { data: { files: Array<{ path: string }> } }).data
      .files;
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

const HIDDEN_ONLY = {
  type: "morph:storefront-preview-update-section-props",
  sectionId: SLOT,
  props: undefined,
  enabled: false,
};

describe("the replay for a hidden section", () => {
  it("T2: a reload during an unanswered hide replays it with no props", async () => {
    updateSectionProps.mockRejectedValue(new Error("offline"));
    const first = await firstFrame();
    await hide();
    // Precondition: sent, and never answered.
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(
      (updateSectionProps.mock.calls[0]![0] as { data: { props: unknown } }).data
        .props,
    ).toEqual({ enabled: false });

    const second = await reloadAndReady(first);
    applied(latestRequest(second), ROUTE_PATH);
    await tick(0);
    // The read holds the section shown with its stored title: the write it
    // was never answered about did not land. The replay sends the hide.
    expect(cardMessages(second)).toEqual([HIDDEN_ONLY]);
  });

  it("(d): another tab's hide, brought in by the replay's own read, replays with no props", async () => {
    const first = await firstFrame();
    // This tab last read the section shown; another tab hid it since.
    getThemeEditor.mockResolvedValue({
      success: true,
      message: "ok",
      data: {
        ...context,
        templates: [homeTemplate, routeDocument(STORED, 2, false)],
      },
    });
    const second = await reloadAndReady(first);
    applied(latestRequest(second), ROUTE_PATH);
    await tick(0);
    expect(cardMessages(second)).toEqual([HIDDEN_ONLY]);
  });

  it("(g): answers from the replaced frame or an older round release nothing, and the release sends no props", async () => {
    updateSectionProps.mockRejectedValue(new Error("offline"));
    const first = await firstFrame();
    const earlier = latestRequest(first);
    await hide();
    const second = await reloadAndReady(first);
    // The replaced window, and an answer to the earlier round's request.
    applied(latestRequest(second), ROUTE_PATH, first);
    applied(earlier, ROUTE_PATH);
    await tick(0);
    expect(cardMessages(second)).toEqual([]);
    applied(latestRequest(second), ROUTE_PATH);
    await tick(0);
    expect(cardMessages(second)).toEqual([HIDDEN_ONLY]);
    // Nothing reached the replaced window after the hide either.
    expect(
      cardMessages(first).filter((message) => message.props !== undefined),
    ).toEqual([]);
  });

  it("(b): a replay composed while shown, posted again once signed after a hide, is not posted", async () => {
    let releaseSigning!: () => void;
    vi.mocked(signThemePreviewMedia).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSigning = () =>
            resolve({
              success: true,
              data: {
                urls: { [ASSET]: SIGNED_URL },
                expiresAt: Date.now() + 86_400_000,
              },
            } as never);
        }) as never,
    );
    updateSectionProps.mockImplementation(async () => ({
      success: true,
      data: {
        draftGeneration: 3,
        droppedProps: [],
        document: routeDocument(STORED, 3, false).document,
      },
    }));
    const first = await firstFrame();
    const second = await reloadAndReady(first);
    applied(latestRequest(second), ROUTE_PATH);
    await tick(0);
    // The replay composed the section shown, its image not signed yet.
    const [replayed] = cardMessages(second);
    expect(replayed?.props?.title).toBe(STORED);
    expect(replayed?.enabled).toBe(true);
    expect(JSON.stringify(replayed?.props?.image)).not.toContain(SIGNED_URL);
    expect(signThemePreviewMedia).toHaveBeenCalled();

    await hide();
    const hideAt = cardMessages(second).length;
    expect(cardMessages(second).at(-1)).toEqual(HIDDEN_ONLY);
    await act(async () => {
      releaseSigning();
    });
    await tick(0);
    await tick(0);
    expect(
      cardMessages(second)
        .slice(hideAt)
        .filter((message) => message.props !== undefined || message.enabled === true),
    ).toEqual([]);
  });
});
