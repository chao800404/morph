import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  answerLatestRouteRequest,
  createLiveFrame,
  frameEnvelope,
  sendFrameReady,
} from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * The presentation replay a first ready brings sends every bound section
 * once, with a presentation token, so the frame can acknowledge what it
 * shows. Those posts must not restart the canvas measurement once per
 * section: the size answer the editor asked for on ready, measured on the
 * page the frame was rendered with, is still the page's height when the
 * replay re-sends that same content, and throwing it away left the canvas at
 * its default height until a later measurement came back (#399 on full
 * Start: 8 sections moved the measurement revision 3 -> 11, and the frame
 * reached its full height only ~0.5 s later).
 *
 * Same harness as `visual-editor-shell-hidden-section.test.tsx`: the preview
 * is observed through `postEditorToPreviewMessage`, and messages from it are
 * real `message` events on `window`.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const ADDRESS = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION };
/** The frame names its page; its route answer is sent by the test. */
const liveFrame = createLiveFrame(ADDRESS, { answerReady: false });
const HERO_PATH = "src/components/Hero.tsx";
const SECTION_IDS = ["hero-1", "hero-2", "hero-3", "hero-4"];
const CONTENT_HEIGHT = 2_400;

const posted: Array<Record<string, unknown>> = [];

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

const source = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
};
export function Hero({ heading = "Welcome" }) {
  return <section><h1 data-morph-node="heading" className="text-4xl">{heading}</h1></section>;
}`;

const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

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
      document: {
        version: 1,
        sections: SECTION_IDS.map((id, index) => ({
          id,
          type: "hero",
          enabled: true,
          props: { heading: `Heading ${index + 1}` },
        })),
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

function readyClient() {
  const client = new QueryClient({
    // The data below is all the shell is given; nothing is fetched again.
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
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
      files: [
        {
          id: "file-hero",
          storefrontId: "storefront-1",
          themeId: "theme-1",
          path: HERO_PATH,
          content: source,
          mimeType: "text/typescript",
          isEntry: false,
          version: 1,
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
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
                { name: "Hero.tsx", path: HERO_PATH, isDirectory: false },
              ],
            },
          ],
        },
      ],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  return client;
}

function fromPreview(data: Record<string, unknown>) {
  liveFrame.before(data);
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: frameEnvelope({ ...data, previewSession: PREVIEW_SESSION }),
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
  liveFrame.after(data);
}

async function flushFrames() {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
}

/** Every size request the editor has posted, in order. */
const sizeRequests = () =>
  posted.filter(
    (message) => message.type === "morph:storefront-preview-request-size",
  ) as Array<{ measurementRevision: number }>;

/** The canvas box the frame is sized by. */
const canvasHeight = () =>
  document.querySelector("iframe")?.parentElement?.style.height ?? null;

beforeEach(() => {
  posted.length = 0;
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
});

describe("the first ready's presentation replay and the canvas measurement", () => {
  it("re-sending what the frame already shows restarts no measurement: the answer to the size the editor asked for on ready is taken", async () => {
    render(
      <QueryClientProvider client={readyClient()}>
        <VisualEditorShell
          context={context}
          search={search}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    // The frame comes up and names its page; the editor sends it the route
    // and, a frame later, asks for its size.
    sendFrameReady(ADDRESS);
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/",
    });
    await flushFrames();
    const asked = sizeRequests().at(-1);
    expect(asked, "the size asked for on ready").toBeDefined();
    const requestsBeforeReplay = sizeRequests().length;
    const postsBeforeReplay = posted.length;

    // The frame answers the route first, as a live one does: that answer
    // releases the presentation replay, every bound section once.
    answerLatestRouteRequest(ADDRESS);
    const replayed = posted
      .slice(postsBeforeReplay)
      .filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.presentationToken !== undefined,
      )
      .map((message) => message.sectionId);
    expect(new Set(replayed), "every bound section is replayed").toEqual(
      new Set(SECTION_IDS),
    );

    // Then the size it measured for the request above. The replay re-sent
    // the content the page was rendered with, so this is its height.
    fromPreview({
      type: "morph:storefront-preview-size",
      height: CONTENT_HEIGHT,
      measurementRevision: asked!.measurementRevision,
    });
    expect(canvasHeight()).toBe(`${CONTENT_HEIGHT}px`);

    // Past the remeasure delay: the batch restarted the measurement at most
    // once, never once per section.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_200)));
    await flushFrames();
    const later = sizeRequests().slice(requestsBeforeReplay);
    expect(later.length, "one remeasure at most").toBeLessThanOrEqual(1);
    for (const request of later) {
      expect(request.measurementRevision).toBeLessThanOrEqual(
        asked!.measurementRevision + 1,
      );
    }
    expect(canvasHeight()).toBe(`${CONTENT_HEIGHT}px`);
  });
});
