import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  answerLatestRouteRequest,
  createLiveFrame,
  disablePresentationAcks,
  frameEnvelope,
  sendFrameReady,
} from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * The editor's half of the presentation trace (`[preview-presentation]`):
 * each section presentation it posts, and what it did with the frame's
 * answer, under the one operation id the frame's own lines carry. What the
 * lines say is identities only: never a section's props, a draft's text,
 * the preview URL or the session.
 *
 * Same harness as `visual-editor-shell-presentation-replay-remeasure`.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const PREVIEW_URL = `${PREVIEW_ORIGIN}/store/1/themes/1/preview?access=pv-secret-token`;
const ADDRESS = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION };
const liveFrame = createLiveFrame(ADDRESS, { answerReady: false });
const HERO_PATH = "src/components/Hero.tsx";
const SECTION_IDS = ["hero-1", "hero-2"];
const DRAFT = "Draft text that must stay out of the console";

const posted: Array<Record<string, unknown>> = [];
const updateSectionProps = vi.hoisted(() =>
  vi.fn(() => new Promise<never>(() => {})),
);

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
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
  storefront: { id: "storefront-1", name: "Store", domain: null, status: "active" },
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
          props: { heading: `Stored heading ${index + 1}` },
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
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: PREVIEW_URL },
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
              children: [{ name: "Hero.tsx", path: HERO_PATH, isDirectory: false }],
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
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

let lines: string[] = [];
const traceLines = () =>
  lines.filter((line) => line.startsWith("[preview-presentation]"));

function renderShell() {
  render(
    <QueryClientProvider client={readyClient()}>
      <VisualEditorShell context={context} search={search} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** The posts that carried a token, since `from`. */
const tokenPosts = (from = 0) =>
  posted
    .slice(from)
    .filter(
      (message) =>
        message.type === "morph:storefront-preview-update-section-props" &&
        message.presentationToken !== undefined,
    ) as Array<{ sectionId: string; presentationToken: Record<string, unknown> }>;

function frameUp() {
  sendFrameReady(ADDRESS);
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [], routePath: "/" });
}

beforeEach(() => {
  posted.length = 0;
  lines = [];
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the editor's [preview-presentation] lines", () => {
  it("follows each replayed section from post to accepted answer under one operation id, with round, frame and document", async () => {
    renderShell();
    await flushFrames();
    frameUp();
    answerLatestRouteRequest(ADDRESS);
    const replayed = tokenPosts();
    expect(new Set(replayed.map((post) => post.sectionId))).toEqual(new Set(SECTION_IDS));
    await waitFor(() =>
      expect(traceLines().filter((line) => line.includes(" ack accepted "))).toHaveLength(
        SECTION_IDS.length,
      ),
    );

    const started = traceLines().find((line) => line.includes(" round started "));
    expect(started).toMatch(
      /^\[preview-presentation\] round started round=1 frame=f1 doc=[0-9a-f]{8} acknowledges=yes$/,
    );
    expect(traceLines()).toContain(
      "[preview-presentation] replay mode=initial sections=2 round=1 frame=f1 doc=" +
        started!.match(/doc=([0-9a-f]{8})/)![1],
    );
    for (const post of replayed) {
      const op = String(post.presentationToken.operationId);
      const postedLine = traceLines().find(
        (line) => line.includes(" posted ") && line.includes(`op=${op} `),
      );
      expect(postedLine).toMatch(
        new RegExp(
          `^\\[preview-presentation\\] posted op=${op} section=${post.sectionId} template=template-1 route=/ basis=existing:1 overlay=\\d+ via=replay round=1 frame=f1 doc=[0-9a-f]{8}$`,
        ),
      );
      const accepted = traceLines().find(
        (line) => line.includes(" ack accepted ") && line.includes(`op=${op} `),
      );
      expect(accepted).toMatch(
        new RegExp(
          `status=applied round=1 frame=f1 doc=[0-9a-f]{8} page=(waiting|confirmed) unconfirmed=\\d+$`,
        ),
      );
    }
    expect(traceLines().at(-1)).toMatch(/page=confirmed unconfirmed=0$/);
  });

  it("says which guard refused an answer: a changed token, and one for an operation no longer waited on", async () => {
    renderShell();
    await flushFrames();
    frameUp();
    disablePresentationAcks();
    answerLatestRouteRequest(ADDRESS);
    const [first] = tokenPosts();
    expect(first).toBeDefined();
    const op = String(first!.presentationToken.operationId);

    // An answer for the right operation that names another overlay revision.
    fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: op,
      token: { ...first!.presentationToken, overlayRevision: 999 },
      status: "applied",
    });
    expect(traceLines().at(-1)).toMatch(
      new RegExp(
        `^\\[preview-presentation\\] ack rejected op=${op} section=${first!.sectionId} .*overlay=999 status=applied guard=token-mismatch round=1 frame=f1 doc=[0-9a-f]{8}$`,
      ),
    );

    // The real answer is taken; the same answer again waits on nothing.
    fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: op,
      token: first!.presentationToken,
      status: "applied",
    });
    expect(traceLines().at(-1)).toContain(`ack accepted op=${op} `);
    fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: op,
      token: first!.presentationToken,
      status: "applied",
    });
    expect(traceLines().at(-1)).toMatch(/ status=applied guard=no-pending round=1 /);
  });

  it("carries no content: no stored or draft text, no preview URL, no session", async () => {
    renderShell();
    await flushFrames();
    frameUp();
    await flushFrames();
    fireEvent.click(screen.getAllByTitle("Select hero; drag to reorder")[0]!);
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await flushFrames();
    const field = await screen.findByDisplayValue("Stored heading 1");
    // Typed before the frame answered its route: held, and carried by the
    // replay's post for that section.
    fireEvent.input(field, { target: { value: DRAFT } });
    fireEvent.blur(field);
    await flushFrames();
    const before = posted.length;
    answerLatestRouteRequest(ADDRESS);
    const draftPost = tokenPosts(before).find(
      (post) =>
        (post as { props?: { heading?: unknown } }).props?.heading === DRAFT,
    );
    expect(draftPost, "the replay carries the draft").toBeDefined();
    await waitFor(() =>
      expect(traceLines().some((line) => line.includes(" ack accepted "))).toBe(true),
    );

    expect(traceLines().length).toBeGreaterThan(3);
    for (const line of traceLines()) {
      expect(line).not.toContain(DRAFT);
      expect(line).not.toContain("Stored heading");
      expect(line).not.toContain(PREVIEW_SESSION);
      expect(line).not.toContain(PREVIEW_ORIGIN);
      expect(line).not.toContain("pv-secret-token");
      expect(line).not.toContain("storefront-1:theme-1");
    }
  });
});

describe("the editor's [preview-frame] lines", () => {
  const frameLines = () => lines.filter((line) => line.startsWith("[preview-frame]"));
  const labelled = [
    {
      id: "hero-1:node:heading",
      parentId: null,
      sectionId: "hero-1",
      label: "Label text that must stay out",
      kind: "heading",
      tagName: "h1",
      target: {
        sectionId: "hero-1",
        nodeId: "hero-1:node:heading",
        elementKey: "heading",
        fieldKey: "heading",
        fieldPath: "heading",
        isSection: false,
      },
    },
  ];

  it("follows one frame load: ready received, confirmed and accepted, structure accepted with what was applied, the tree becoming sortable", async () => {
    renderShell();
    await flushFrames();
    frameUp();
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: labelled,
      routePath: "/",
      frameNavigationEpoch: 0,
    });
    answerLatestRouteRequest(ADDRESS);
    await waitFor(() =>
      expect(frameLines().some((line) => line.includes("sortable=yes"))).toBe(true),
    );
    const doc = "[0-9a-f]{8}";
    const expectLine = (pattern: string) =>
      expect(
        frameLines().some((line) => new RegExp(`^\\[preview-frame\\] ${pattern}$`).test(line)),
        pattern,
      ).toBe(true);
    expectLine(`ready received doc=${doc} verdict=candidate`);
    expectLine(`ready confirmed doc=${doc} candidate=kept`);
    expectLine(
      `ready accepted round=1 frame=f1 doc=${doc} acknowledges=yes served=unnamed`,
    );
    expectLine(
      `structure accepted applied=sections=0 nodes=0 route=/ epoch=none round=1 frame=f1 doc=${doc}`,
    );
    expectLine(
      `structure accepted applied=sections=1 nodes=1 route=/ epoch=0 round=1 frame=f1 doc=${doc}`,
    );
    expectLine(
      `section tree sortable=no structure=(none|sections=\\d+ nodes=\\d+) bound=2 unconfirmed=\\d+ round=1 frame=f1 doc=${doc}`,
    );
    expectLine(
      `section tree sortable=yes structure=sections=1 nodes=1 bound=2 unconfirmed=0 round=1 frame=f1 doc=${doc}`,
    );
    // A report repeated with the same summary is not said again.
    const before = frameLines().length;
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: labelled,
      routePath: "/",
      frameNavigationEpoch: 0,
    });
    expect(frameLines().length).toBe(before);
    for (const line of frameLines()) {
      expect(line).not.toContain("Label text");
      expect(line).not.toContain(PREVIEW_SESSION);
      expect(line).not.toContain("pv-secret-token");
    }
  });

  it("says why a structure report was not taken: another route, or a document the frame no longer shows", async () => {
    renderShell();
    await flushFrames();
    frameUp();
    answerLatestRouteRequest(ADDRESS);
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: labelled,
      routePath: "/elsewhere",
      frameNavigationEpoch: 3,
    });
    expect(frameLines().at(-1)).toMatch(
      /^\[preview-frame\] structure set aside reason=other-route editorRoute=\/ sections=1 nodes=1 route=\/elsewhere epoch=3 round=1 frame=f1 doc=[0-9a-f]{8}$/,
    );

    // A report from a document that is not the one the frame shows.
    const frame = document.querySelector("iframe");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "morph:storefront-preview-structure",
            nodes: labelled,
            routePath: "/",
            frameNavigationEpoch: 0,
            previewSession: PREVIEW_SESSION,
            previewDocument: "ffffffffffffffffffffffffffffffff",
          },
          origin: PREVIEW_ORIGIN,
          source: frame?.contentWindow ?? null,
        }),
      );
    });
    expect(
      frameLines().some((line) =>
        /^\[preview-frame\] structure not taken doc=ffffffff verdict=(refused:[a-z-]+|unverified-document) sections=1 nodes=1 route=\/ epoch=0$/.test(
          line,
        ),
      ),
    ).toBe(true);
  });
});
