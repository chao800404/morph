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
  frameEnvelope,
} from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * A list action on a list the panel shows behind the accepted copy.
 *
 * W1 removes Bravo in the Inspector and is answered at generation 2 while the
 * route still renders generation 1. The hero is opened again (promo and back)
 * with nothing held, so the panel shows the list from before W1. A list
 * action there (Add entry, Remove, a canvas reorder) used to be built on that
 * list and sent with a current basis: OCC accepted it and Bravo came back
 * (handoff/2026-11-20/h1-red, the H1 residual test).
 *
 * The decision: the action is refused. Nothing is sent, the panel's list is
 * refreshed to the accepted one, and the author is told to do it again. A
 * list with an unanswered write of its own is not behind (the controls at
 * the end).
 *
 * The window is pinned as in
 * `visual-editor-shell-inspector-post-accepted-copy.test.tsx`: query
 * notifications held, so a write is answered (and its refetch too) while the
 * route still renders the copy from before it. The server mock enforces OCC.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const frameAddress = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION };
const liveFrame = createLiveFrame(frameAddress);
const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

/** The notice shown when a list action is refused on a list that is behind. */
const LIST_BEHIND_NOTICE =
  "This list was out of date, so your change was not made. The latest list is shown now. Make your change again.";

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

type Row = { id: string; title?: string };
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

const clickAdd = () =>
  fireEvent.click(screen.getByRole("button", { name: /^Add entry$/ }));
const clickRemove = (index: number) =>
  fireEvent.click(screen.getAllByRole("button", { name: /^Remove$/ })[index]!);

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

/** While closed, the server receives a write but does not answer it yet. */
let gate: { promise: Promise<void>; open: () => void } | null = null;
function closeGate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  gate = { promise, open };
}
async function openGate() {
  const closed = gate;
  gate = null;
  closed?.open();
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
const listWrites = () => sentCalls().filter((data) => data.props.items);
const ids = (list: readonly Row[] | undefined) =>
  (list ?? []).map((row) => row.id);
const behindNotices = () =>
  vi
    .mocked(toast.warning)
    .mock.calls.filter(([message]) => message === LIST_BEHIND_NOTICE);

let server: { props: HeroProps; generation: number };

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
  held = false;
  heldNotifications = [];
  gate = null;
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
      const waiting = gate?.promise;
      if (waiting) await waiting;
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
  gate?.open();
  gate = null;
  notifyManager.setScheduler((run) => setTimeout(run, 0));
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * W1 removes Bravo and is answered at generation 2 while the route still
 * renders 1; the hero is opened again from that older context with nothing
 * held. The panel then shows the list from before W1.
 */
async function panelBehindAfterW1() {
  renderEditor();
  await openContent();
  expect(shownTitles(), "the stored list").toEqual([
    "Alpha",
    "Bravo",
    "Charlie",
  ]);
  clickRemove(1);
  held = true;
  await debounceRuns();
  expect(updateSectionProps, "W1 sent once").toHaveBeenCalledTimes(1);
  expect(ids(sentCalls()[0]!.props.items)).toEqual(AFTER_W1_IDS);
  expect(server.generation, "W1 answered at generation 2").toBe(2);
  expect(
    renderedGenerations.at(-1),
    "the route still renders the copy before W1",
  ).toBe(1);

  await switchAwayAndBack();
  expect(renderedGenerations.at(-1)).toBe(1);
  expect(
    shownTitles(),
    "reopened from the older context: the list before W1",
  ).toEqual(["Alpha", "Bravo", "Charlie"]);
  expect(behindNotices(), "nothing refused yet").toHaveLength(0);
}

/** Lets everything held run: the route renders the newest copy. */
async function finishWindow() {
  await debounceRuns();
  await releaseNotifications();
  await debounceRuns();
  await debounceRuns();
}

describe("a list action on a list the panel shows behind the accepted copy", () => {
  it("(a) Add entry is refused: nothing sent, the list refreshed, a notice, another field's draft kept", async () => {
    await panelBehindAfterW1();

    // A draft of another field, made in the same panel just before.
    typeHeading(HEADING, HEADING_TYPED);
    clickAdd();
    await settle();

    expect(
      shownTitles(),
      "the panel's list is refreshed to the accepted one",
    ).toEqual(["Alpha", "Charlie"]);
    expect(behindNotices(), "the author is told to do it again").toHaveLength(
      1,
    );
    expect(
      screen.getByDisplayValue(HEADING_TYPED),
      "the heading draft is kept",
    ).toBeTruthy();

    await finishWindow();

    expect(listWrites(), "no list write after W1").toHaveLength(1);
    expect(
      ids(server.props.items),
      "Bravo stays deleted on the server",
    ).toEqual(AFTER_W1_IDS);
    expect(
      sentCalls()
        .slice(1)
        .map((data) => Object.keys(data.props)),
      "after W1 only the heading draft is written",
    ).toEqual([["heading"]]);
    expect(server.props.heading, "the heading draft is saved").toBe(
      HEADING_TYPED,
    );
    expect(shownTitles()).toEqual(["Alpha", "Charlie"]);
    expect(screen.getByDisplayValue(HEADING_TYPED)).toBeTruthy();
  });

  it("(b) after the refresh, Add entry again writes exactly one new row on [alpha, charlie]", async () => {
    await panelBehindAfterW1();

    clickAdd();
    await settle();
    expect(shownTitles()).toEqual(["Alpha", "Charlie"]);
    expect(behindNotices()).toHaveLength(1);

    clickAdd();
    await finishWindow();

    expect(listWrites(), "W1 and the second Add entry").toHaveLength(2);
    const added = listWrites()[1]!.props.items!;
    expect(ids(added.slice(0, -1))).toEqual(AFTER_W1_IDS);
    expect(added).toHaveLength(AFTER_W1_IDS.length + 1);
    expect(listWrites()[1]!.expectedDraftGeneration).toBe(2);
    expect(ids(server.props.items).slice(0, -1)).toEqual(AFTER_W1_IDS);
    expect(server.props.items).toHaveLength(3);
    expect(behindNotices(), "refused only once").toHaveLength(1);
    expect(shownTitles()).toEqual(["Alpha", "Charlie"]);
  });

  it("(c) Remove is refused the same way: no write, the list refreshed, a notice", async () => {
    await panelBehindAfterW1();

    // Charlie as this panel draws it (the third row of the old list).
    clickRemove(2);
    await settle();

    expect(shownTitles()).toEqual(["Alpha", "Charlie"]);
    expect(behindNotices()).toHaveLength(1);

    await finishWindow();

    expect(listWrites(), "no list write after W1").toHaveLength(1);
    expect(ids(server.props.items)).toEqual(AFTER_W1_IDS);
    expect(shownTitles()).toEqual(["Alpha", "Charlie"]);
  });

  it("(c) a canvas reorder is refused the same way: no write, the list refreshed, a notice", async () => {
    await panelBehindAfterW1();

    // The canvas shows W1's list: its first two entries are Alpha and Charlie.
    fromPreview({
      type: "morph:storefront-preview-commit-array-item-reorder",
      sectionId: "hero",
      draggedFieldPath: "items.0",
      targetFieldPath: "items.1",
    });
    await settle();

    expect(shownTitles()).toEqual(["Alpha", "Charlie"]);
    expect(behindNotices()).toHaveLength(1);

    await finishWindow();

    expect(listWrites(), "no list write after W1").toHaveLength(1);
    expect(ids(server.props.items)).toEqual(AFTER_W1_IDS);
    expect(shownTitles()).toEqual(["Alpha", "Charlie"]);
  });
});

describe("control: a list with an unanswered write of its own is not behind", () => {
  it("(d) Add, then Add again before the first write is sent: one write with both rows", async () => {
    renderEditor();
    await openContent();

    clickAdd();
    clickAdd();
    await debounceRuns();
    await debounceRuns();

    expect(behindNotices()).toHaveLength(0);
    expect(listWrites()).toHaveLength(1);
    const sent = listWrites()[0]!.props.items!;
    expect(ids(sent.slice(0, 3))).toEqual(["alpha", "bravo", "charlie"]);
    expect(sent).toHaveLength(5);
    expect(server.props.items).toHaveLength(5);
  });

  it("(d) Add, then Add again while the first write is unanswered: both rows written", async () => {
    renderEditor();
    await openContent();

    closeGate();
    clickAdd();
    await debounceRuns();
    expect(updateSectionProps, "the first Add is out").toHaveBeenCalledTimes(1);
    expect(server.generation, "and unanswered").toBe(1);

    clickAdd();
    await settle();
    expect(behindNotices(), "its own unanswered write").toHaveLength(0);

    await openGate();
    await debounceRuns();
    await debounceRuns();

    expect(behindNotices()).toHaveLength(0);
    expect(listWrites()).toHaveLength(2);
    expect(listWrites()[0]!.props.items).toHaveLength(4);
    const second = listWrites()[1]!.props.items!;
    expect(ids(second.slice(0, 4))).toEqual(ids(listWrites()[0]!.props.items));
    expect(second).toHaveLength(5);
    expect(server.props.items).toHaveLength(5);
    expect(ids(server.props.items).slice(0, 3)).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
  });

  it("(d) Add, then Remove of the new row while the first write is unanswered: the list ends as it began", async () => {
    renderEditor();
    await openContent();

    closeGate();
    clickAdd();
    await debounceRuns();
    expect(updateSectionProps).toHaveBeenCalledTimes(1);

    clickRemove(3);
    await settle();
    expect(behindNotices(), "its own unanswered write").toHaveLength(0);

    await openGate();
    await debounceRuns();
    await debounceRuns();

    expect(behindNotices()).toHaveLength(0);
    expect(listWrites()).toHaveLength(2);
    expect(ids(listWrites()[1]!.props.items)).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
    expect(ids(server.props.items)).toEqual(["alpha", "bravo", "charlie"]);
    expect(shownTitles()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("(d) Add answered but not yet rendered, then Add again: both rows written", async () => {
    renderEditor();
    await openContent();

    held = true;
    clickAdd();
    await debounceRuns();
    expect(server.generation, "the first Add answered").toBe(2);
    expect(renderedGenerations.at(-1), "not yet rendered").toBe(1);

    clickAdd();
    await finishWindow();

    expect(behindNotices()).toHaveLength(0);
    expect(listWrites()).toHaveLength(2);
    expect(listWrites()[1]!.expectedDraftGeneration).toBe(2);
    expect(listWrites()[1]!.props.items).toHaveLength(5);
    expect(server.props.items).toHaveLength(5);
  });
});
