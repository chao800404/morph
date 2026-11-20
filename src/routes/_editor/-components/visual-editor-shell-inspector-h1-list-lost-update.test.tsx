import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  createLiveFrame,
  disablePresentationAcks,
  enablePresentationAcks,
  frameEnvelope,
} from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * H1 (review of the M1/M2 follow-up to #399,
 * handoff/2026-11-19/review-399/m1m2-fix-REVIEW.md): the Inspector's held
 * props are its whole copy of the section, so a panel reopened in the
 * answered-write window gives every key of that copy the accepted copy's
 * baseline. An untouched key the panel still shows at its old value (`items`
 * here) is then never rebased, and a later Inspector list action writes it.
 *
 * The window is pinned as in
 * `visual-editor-shell-inspector-post-accepted-copy.test.tsx`: query
 * notifications held, so a write is answered (and its refetch too) while the
 * route still renders the copy from before it.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const frameAddress = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION };
const liveFrame = createLiveFrame(frameAddress);
const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

const posted: Array<Record<string, unknown>> = [];
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
  items: { type: "array", label: "Items", fields: { title: { type: "text", label: "Title" } } }
};
export function Hero({ heading = "Welcome", items = [] }) {
  return <section><h1>{heading}</h1>{items.map((item) => <p key={item.id}>{item.title}</p>)}</section>;
}`;

type Row = { id: string; title: string };
type HeroProps = { heading: string; items: Row[] };
const rows = (...titles: string[]): Row[] =>
  titles.map((title) => ({ id: title.toLowerCase(), title }));

const HEADING = "Welcome";
const HEADING_TYPED = "Welcome back";
/** The stored list before W1. */
const BEFORE = () => rows("Alpha", "Bravo", "Charlie");
/** W1's list: Bravo removed in the Inspector. */
const AFTER_W1_IDS = ["alpha", "charlie"];

const PROMO: HeroProps = { heading: "Promo", items: rows("Xray") };

const contextAt = (
  props: HeroProps,
  draftGeneration: number,
): StorefrontThemeEditorDTO =>
  ({
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
          sections: [
            {
              id: "hero",
              type: "hero",
              enabled: true,
              props: structuredClone(props),
            },
            {
              id: "promo",
              type: "hero",
              enabled: true,
              props: structuredClone(PROMO),
            },
          ],
        },
        draftGeneration,
        version: 1,
      },
    ],
  }) as unknown as StorefrontThemeEditorDTO;

const search = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
  section: "hero",
} as StorefrontThemeEditorSearch;

const promoNode = {
  id: "promo",
  parentId: null,
  sectionId: "promo",
  label: "Promo",
  kind: "section",
  tagName: "section",
  target: {
    sectionId: "promo",
    nodeId: "promo",
    elementKey: null,
    fieldKey: null,
    fieldPath: null,
    isSection: true,
  },
};

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

const detailKey = storefrontThemeQueries.detail(
  "storefront-1",
  "theme-1",
).queryKey;

const client = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(detailKey, {
    success: true,
    message: "ok",
    data: contextAt(server.props, server.generation),
  } as never);
  queryClient.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    } as never,
  );
  queryClient.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    {
      files: [
        {
          id: "file-hero",
          storefrontId: "storefront-1",
          themeId: "theme-1",
          path: "src/components/Hero.tsx",
          content: source,
          mimeType: "text/typescript",
          isEntry: false,
          version: 1,
          createdAt: "2026-10-15T00:00:00.000Z",
          updatedAt: "2026-10-15T00:00:00.000Z",
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
                {
                  name: "Hero.tsx",
                  path: "src/components/Hero.tsx",
                  isDirectory: false,
                },
              ],
            },
          ],
        },
      ],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  return queryClient;
};

let renderedGenerations: number[] = [];

function EditorRoute() {
  const query = useQuery(
    storefrontThemeQueries.detail("storefront-1", "theme-1"),
  );
  const context = query.data?.success ? query.data.data : null;
  if (!context) return null;
  renderedGenerations.push(context.templates[0]!.draftGeneration as number);
  return (
    <VisualEditorShell
      context={context}
      search={search}
      onSearchChange={vi.fn()}
    />
  );
}

let queryClient: QueryClient;
function renderEditor() {
  queryClient = client();
  render(
    <QueryClientProvider client={queryClient}>
      <EditorRoute />
    </QueryClientProvider>,
  );
  liveFrame.ready();
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

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
  });
const debounceRuns = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await settle();
};

let canvasRevision = 0;
async function canvasSelect(sectionId: string) {
  const revision =
    Math.max(
      canvasRevision,
      ...posted.map((m) =>
        typeof m.selectionRevision === "number" ? m.selectionRevision : 0,
      ),
    ) + 1;
  canvasRevision = revision;
  fromPreview({
    type: "morph:storefront-preview-select-section",
    sectionId,
    componentType: "hero",
    kind: "section",
    nodeId: sectionId,
    sourceFilePath: "src/components/Hero.tsx",
    sourceLocation: null,
    elementKey: null,
    fieldKey: null,
    field: null,
    fieldPath: null,
    descendantFields: [],
    tagName: "section",
    role: null,
    inputType: null,
    styleRevision: Math.max(
      0,
      ...posted.map((m) =>
        typeof m.styleRevision === "number" ? m.styleRevision : 0,
      ),
    ),
    className: "",
    isSection: true,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
    selectionRevision: revision,
  });
  await settle();
}

async function openContent() {
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes: [heroNode, promoNode],
  });
  await canvasSelect("hero");
  const contentTab = screen.queryByRole("button", { name: /^Content$/ });
  if (contentTab) fireEvent.click(contentTab);
  await settle();
}

async function switchAwayAndBack() {
  await canvasSelect("promo");
  await canvasSelect("hero");
}

/** The row titles the Inspector's Items list shows, in order. */
const shownTitles = (): string[] =>
  (
    screen.queryAllByDisplayValue(
      /^(Alpha|Bravo|Charlie)$/,
    ) as HTMLInputElement[]
  ).map((input) => input.value);

function typeHeading(from: string, value: string) {
  const field = screen.getByDisplayValue(from);
  fireEvent.focus(field);
  fireEvent.input(field, { target: { value } });
  fireEvent.blur(field);
}

let held = false;
let heldNotifications: Array<() => void> = [];
async function releaseNotifications() {
  held = false;
  const runs = heldNotifications;
  heldNotifications = [];
  await act(async () => {
    for (const run of runs) run();
  });
  await settle();
}

type SentData = {
  sectionId?: string;
  props: Partial<HeroProps>;
  expectedDraftGeneration: number;
};
const sentCalls = (): SentData[] =>
  updateSectionProps.mock.calls.map(
    (call) => (call[0] as { data: SentData }).data,
  );

let server: { props: HeroProps; generation: number };

type SectionPost = {
  type?: string;
  sectionId?: string;
  presentationToken?: { operationId: string };
};
/** The frame acknowledges every token-carrying section post from `from` on. */
function acknowledgeSectionPosts(from = 0) {
  for (const post of posted.slice(from) as SectionPost[]) {
    if (post.type !== "morph:storefront-preview-update-section-props") continue;
    const token = post.presentationToken;
    if (!token) continue;
    fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: token.operationId,
      token,
      status: "applied",
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
  held = false;
  heldNotifications = [];
  notifyManager.setScheduler((run) => {
    if (held) heldNotifications.push(run);
    else setTimeout(run, 0);
  });
  posted.length = 0;
  canvasRevision = 0;
  renderedGenerations = [];
  useEditorWriteGateStore.setState({ gates: {} });
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
  server = { props: { heading: HEADING, items: BEFORE() }, generation: 1 };
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(
    async ({ data }: { data: SentData }) => {
      if (data.expectedDraftGeneration !== server.generation) {
        return {
          success: false,
          error: "TEMPLATE_DRAFT_CONFLICT",
          message: "Template draft was modified concurrently.",
        };
      }
      server = {
        props: { ...server.props, ...structuredClone(data.props) },
        generation: server.generation + 1,
      };
      return {
        success: true,
        data: {
          draftGeneration: server.generation,
          droppedProps: [],
          document: {
            version: 1,
            sections: [
              {
                id: "hero",
                type: "hero",
                enabled: true,
                props: structuredClone(server.props),
              },
              {
                id: "promo",
                type: "hero",
                enabled: true,
                props: structuredClone(PROMO),
              },
            ],
          },
        },
      };
    },
  );
  getThemeEditor.mockReset();
  getThemeEditor.mockImplementation(async () => ({
    success: true,
    message: "ok",
    data: contextAt(server.props, server.generation),
  }));
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
});

afterEach(() => {
  held = false;
  for (const run of heldNotifications.splice(0)) run();
  notifyManager.setScheduler((run) => setTimeout(run, 0));
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("H1: an Inspector list action after a held input reopened in the window", () => {
  it("H1: adding a row writes the accepted list plus the new row, not the panel's stale list", async () => {
    renderEditor();
    await openContent();
    expect(shownTitles(), "the stored list").toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);

    // Step 1. W1: Bravo removed through the Inspector. Answered (its refetch
    // too) while the route still renders the copy before it. From here on
    // the frame acknowledges nothing, so presentation is not proven and the
    // next input is held.
    const removes = screen.getAllByRole("button", { name: /^Remove$/ });
    expect(removes, "one Remove per row").toHaveLength(3);
    fireEvent.click(removes[1]!);
    disablePresentationAcks();
    held = true;
    await debounceRuns();
    expect(updateSectionProps, "W1 sent once").toHaveBeenCalledTimes(1);
    expect(sentCalls()[0]!.props.items?.map((row) => row.id)).toEqual(
      AFTER_W1_IDS,
    );
    expect(sentCalls()[0]!.expectedDraftGeneration).toBe(1);
    expect(server.generation, "W1 answered at generation 2").toBe(2);
    expect(
      renderedGenerations.at(-1),
      "the route still renders the copy before W1",
    ).toBe(1);

    // Step 2. The panel opens the hero again from the context, which is
    // behind: its copy of items is the old list. The author types a heading;
    // it is held (not sent), and the pending entry's props are the panel's
    // whole copy, old items included.
    await switchAwayAndBack();
    expect(renderedGenerations.at(-1)).toBe(1);
    expect(shownTitles(), "reopened from the older context").toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
    typeHeading(HEADING, HEADING_TYPED);
    await debounceRuns();
    expect(
      updateSectionProps,
      "the heading is held, not sent",
    ).toHaveBeenCalledTimes(1);

    // Step 3. The panel reopens the hero, still in the window: the held
    // entry is shown over the context's copy.
    await switchAwayAndBack();
    expect(renderedGenerations.at(-1)).toBe(1);

    // Step 4. The context renders W1's copy.
    await releaseNotifications();
    expect(renderedGenerations.at(-1), "W1's copy rendered").toBe(2);
    const shownAfterRender = shownTitles();

    // The frame acknowledges what it was told; the held heading is sent.
    const acknowledgedUpTo = posted.length;
    acknowledgeSectionPosts();
    await debounceRuns();
    await debounceRuns();
    expect(
      sentCalls().map((data) => Object.keys(data.props)),
      "W1 (items), then the held heading alone",
    ).toEqual([["items"], ["heading"]]);

    // Step 6. An Inspector list action: Add entry. The frame acknowledges
    // again from here on, so the action is sent rather than held.
    acknowledgeSectionPosts(acknowledgedUpTo);
    enablePresentationAcks(frameAddress);
    await settle();
    const before = posted.length;
    fireEvent.click(screen.getByRole("button", { name: /^Add entry$/ }));
    await debounceRuns();
    acknowledgeSectionPosts(before);
    await debounceRuns();
    await debounceRuns();

    const listWrites = sentCalls().filter((data) => data.props.items);
    expect(listWrites, "W1 and the Add entry write").toHaveLength(2);
    const added = listWrites[1]!.props.items!;
    // The write payload: the accepted list (Bravo removed) plus the new row.
    // Red at the 07 head: the panel's stale list (Bravo back) plus the row.
    expect(
      added.slice(0, -1).map((row) => row.id),
      "the list action writes on the accepted list, not the panel's stale copy",
    ).toEqual(AFTER_W1_IDS);
    expect(added).toHaveLength(AFTER_W1_IDS.length + 1);
    expect(
      server.props.items.map((row) => row.id).slice(0, -1),
      "Bravo stays deleted on the server",
    ).toEqual(AFTER_W1_IDS);
    // What the panel showed once the context rendered W1's copy.
    expect(shownAfterRender, "the panel after W1's copy rendered").toEqual([
      "Alpha",
      "Charlie",
    ]);
  });
});
