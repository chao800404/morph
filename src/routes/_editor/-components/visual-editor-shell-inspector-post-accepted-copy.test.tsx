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
  frameEnvelope,
} from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * What the canvas and the panel show for a section while a content write is
 * answered but the editor context has not rendered it yet (the window of
 * `visual-editor-shell-content-write-accepted-gap.test.tsx`, pinned the same
 * way: query notifications held).
 *
 * M2 (review of #399 at c26891b): an Inspector input's section post is
 * stamped with the accepted copy's generation. It must carry that copy, not
 * the Inspector's own copy, which a panel opened in the window takes from
 * the older context.
 *
 * M1: a held input shown again by a panel opened in the window was staged on
 * the accepted copy; the context's render of that copy must not replace it in
 * the panel.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const liveFrame = createLiveFrame({
  origin: PREVIEW_ORIGIN,
  session: PREVIEW_SESSION,
});
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
  subheading: { type: "text", label: "Subheading" },
  count: { type: "number", label: "Count" }
};
export function Hero({ heading = "Welcome", subheading = "Summary", count = 1 }) {
  return <section><h1>{heading}</h1><p>{subheading}</p><span>{count}</span></section>;
}`;

/** The stored heading before the first write: the value typed back. */
const ORIGINAL = "New collection";
/** The first write's value. */
const EDITED = "Swapped heading";

/** The stored subheading before W1 in the M2 case, and W1's value for it. */
const SUMMARY = "Summary";
const SUMMARY_EDITED = "Swapped summary";

type HeroProps = { heading: string; subheading: string; count: number };
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
            { id: "hero", type: "hero", enabled: true, props: { ...props } },
            { id: "promo", type: "hero", enabled: true, props: { ...PROMO } },
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

/** A second section, only ever switched to and back from. */
const PROMO: HeroProps = {
  heading: "Promo",
  subheading: "Promo summary",
  count: 7,
};

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
    // The route's read is fresh until a write invalidates it, so the only
    // refetch is the one `updatePropsMutation.onSuccess` awaits.
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

/** Draft generations of the contexts the route has handed the shell, in order. */
let renderedGenerations: number[] = [];

/** The editor route's shape: the shell renders the detail query's document. */
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
    // The current-frame bridge acknowledges a section only after its
    // presentation post has been committed. Let its mocked post-commit pump
    // run before this helper interacts with the section.
    await vi.advanceTimersByTimeAsync(10);
  });
/** Past the 300 ms debounce, with the write and its refetch answered. */
const debounceRuns = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await settle();
};

let canvasRevision = 0;
async function canvasSelect(field: "heading" | null, sectionId = "hero") {
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
    kind: field ? "heading" : "section",
    nodeId: field ? `${sectionId}:node:${field}` : sectionId,
    sourceFilePath: "src/components/Hero.tsx",
    sourceLocation: null,
    elementKey: field,
    fieldKey: field,
    field,
    fieldPath: field,
    descendantFields: [],
    tagName: field ? "h1" : "section",
    role: null,
    inputType: null,
    styleRevision: Math.max(
      0,
      ...posted.map((m) =>
        typeof m.styleRevision === "number" ? m.styleRevision : 0,
      ),
    ),
    className: "",
    isSection: field === null,
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
  await canvasSelect(null);
  const contentTab = screen.queryByRole("button", { name: /^Content$/ });
  if (contentTab) fireEvent.click(contentTab);
  await settle();
}

/** The heading the Inspector shows: the input holding one of the two values. */
const shownHeading = (): string | null => {
  const inputs = [
    ...screen.queryAllByDisplayValue(ORIGINAL),
    ...screen.queryAllByDisplayValue(EDITED),
  ] as HTMLInputElement[];
  if (inputs.length !== 1)
    return inputs.length === 0 ? null : `ambiguous(${inputs.length})`;
  return inputs[0]!.value;
};

/** The author types `value` into the heading showing `from` and leaves it. */
function typeHeading(from: string, value: string) {
  const field = screen.getByDisplayValue(from);
  fireEvent.focus(field);
  fireEvent.input(field, { target: { value } });
  fireEvent.blur(field);
}

// ----- Query notifications, held to pin the window ---------------------------
let held = false;
let heldNotifications: Array<() => void> = [];
/** Runs the held notifications, as the next task would have. */
async function releaseNotifications() {
  held = false;
  const runs = heldNotifications;
  heldNotifications = [];
  await act(async () => {
    for (const run of runs) run();
  });
  await settle();
}

const sentAt = (index: number) =>
  (
    updateSectionProps.mock.calls[index]![0] as {
      data: Record<string, unknown>;
    }
  ).data;

/** The server's copy of the hero, written as the shell writes it. */
let server: { props: HeroProps; generation: number };
const serverRead = async () =>
  ((await getThemeEditor()) as { data: StorefrontThemeEditorDTO }).data
    .templates[0]!.document.sections[0]!.props as HeroProps;

/** Selects the promo section on the canvas, then the hero again: the panel opens the hero anew. */
async function switchAwayAndBack() {
  await canvasSelect(null, "promo");
  await canvasSelect(null, "hero");
}

type SectionPost = {
  type?: string;
  sectionId?: string;
  props?: Record<string, unknown>;
  presentationToken?: {
    operationId: string;
    documentBasis: { kind: string; draftGeneration?: number };
  };
};
/** The hero's section posts, from `from` on. */
const heroPosts = (from = 0): SectionPost[] =>
  (posted.slice(from) as SectionPost[]).filter(
    (message) =>
      message.type === "morph:storefront-preview-update-section-props" &&
      message.sectionId === "hero",
  );

/** The author sets the Count field to `value` and leaves it. */
function setCount(value: string) {
  // The content field's own input; the Design controls have number inputs too.
  const counts = document.querySelectorAll<HTMLInputElement>(
    '[data-slot="inspector-content-field"] input[type="number"]',
  );
  expect(counts.length, "one Count field").toBe(1);
  const count = counts[0]!;
  fireEvent.focus(count);
  fireEvent.input(count, { target: { value } });
  fireEvent.blur(count);
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
  server = {
    props: { heading: ORIGINAL, subheading: SUMMARY, count: 1 },
    generation: 1,
  };
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(
    async ({
      data,
    }: {
      data: { props: Partial<HeroProps>; expectedDraftGeneration: number };
    }) => {
      if (data.expectedDraftGeneration !== server.generation) {
        return {
          success: false,
          error: "TEMPLATE_DRAFT_CONFLICT",
          message: "Template draft was modified concurrently.",
        };
      }
      server = {
        props: { ...server.props, ...data.props },
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
                props: { ...server.props },
              },
              { id: "promo", type: "hero", enabled: true, props: { ...PROMO } },
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

describe("M2: an Inspector input's section post in the window", () => {
  it("carries the accepted copy for fields it did not touch, under the accepted copy's token", async () => {
    renderEditor();
    await openContent();
    // W1: the subheading, through the Inspector; answered, its refetch too,
    // while the route still renders the copy from before it.
    typeHeading(SUMMARY, SUMMARY_EDITED);
    held = true;
    await debounceRuns();
    expect(updateSectionProps, "W1 sent once").toHaveBeenCalledTimes(1);
    expect(sentAt(0)).toMatchObject({
      props: { subheading: SUMMARY_EDITED },
      expectedDraftGeneration: 1,
    });
    expect(
      renderedGenerations.at(-1),
      "the route still renders the copy before W1",
    ).toBe(1);

    // The panel opens the hero again: from the context, which is behind.
    await switchAwayAndBack();
    expect(renderedGenerations.at(-1)).toBe(1);
    const from = posted.length;
    setCount("5");
    await settle();

    const post = heroPosts(from).at(-1);
    expect(post, "the input is shown on the canvas").toBeDefined();
    expect(post!.presentationToken?.documentBasis).toEqual({
      kind: "existing",
      draftGeneration: 2,
    });
    // The copy that token names: W1's subheading, with the input on top.
    expect(post!.props).toMatchObject({
      heading: ORIGINAL,
      subheading: SUMMARY_EDITED,
      count: 5,
    });

    // The write is unchanged: the input's field alone, on W1's answer.
    await debounceRuns();
    expect(updateSectionProps).toHaveBeenCalledTimes(2);
    expect(sentAt(1)).toMatchObject({
      sectionId: "hero",
      props: { count: 5 },
      expectedDraftGeneration: 2,
    });
    expect(Object.keys(sentAt(1).props as object)).toEqual(["count"]);
    await releaseNotifications();
    await debounceRuns();
    expect(await serverRead()).toEqual({
      heading: ORIGINAL,
      subheading: SUMMARY_EDITED,
      count: 5,
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("outside the window (control): the same input posts the same section", async () => {
    renderEditor();
    await openContent();
    typeHeading(SUMMARY, SUMMARY_EDITED);
    await debounceRuns();
    expect(renderedGenerations.at(-1), "W1's copy rendered").toBe(2);

    await switchAwayAndBack();
    const from = posted.length;
    setCount("5");
    await settle();

    const post = heroPosts(from).at(-1);
    expect(post!.presentationToken?.documentBasis).toEqual({
      kind: "existing",
      draftGeneration: 2,
    });
    expect(post!.props).toMatchObject({
      heading: ORIGINAL,
      subheading: SUMMARY_EDITED,
      count: 5,
    });
  });
});

describe("M1: a held input shown again by a panel opened in the window", () => {
  it("stays shown when the context renders the accepted copy, and is sent once on the acknowledgement", async () => {
    renderEditor();
    await openContent();
    expect(shownHeading()).toBe(ORIGINAL);
    // W1, the heading; from its answer on, the frame acknowledges nothing,
    // so the section's presentation of W1's copy is not proven.
    typeHeading(ORIGINAL, EDITED);
    disablePresentationAcks();
    held = true;
    await debounceRuns();
    expect(updateSectionProps, "W1 sent once").toHaveBeenCalledTimes(1);
    expect(
      renderedGenerations.at(-1),
      "the route still renders the copy before W1",
    ).toBe(1);
    expect(shownHeading()).toBe(EDITED);

    // The author types the original value back: held, not sent.
    typeHeading(EDITED, ORIGINAL);
    await debounceRuns();
    expect(updateSectionProps, "held, not sent").toHaveBeenCalledTimes(1);

    // The panel opens the hero again, still in the window: the held input
    // on top of the context's copy.
    await switchAwayAndBack();
    expect(renderedGenerations.at(-1)).toBe(1);
    expect(shownHeading()).toBe(ORIGINAL);

    // The context renders W1's copy.
    await releaseNotifications();
    expect(renderedGenerations.at(-1), "W1's copy rendered").toBe(2);
    expect(shownHeading(), "W1's copy rendered over the held input").toBe(
      ORIGINAL,
    );

    // The frame acknowledges what it was told since, for every section on
    // the page (W1's copy is presented once all of them name it); the held
    // input is then sent.
    const sectionPosts = (posted as SectionPost[]).filter(
      (message) =>
        message.type === "morph:storefront-preview-update-section-props",
    );
    expect(
      heroPosts().at(-1),
      "the held input is shown on W1's copy",
    ).toMatchObject({
      props: { heading: ORIGINAL },
      presentationToken: {
        documentBasis: { kind: "existing", draftGeneration: 2 },
      },
    });
    for (const post of sectionPosts) {
      const token = post.presentationToken;
      if (!token) continue;
      fromPreview({
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: token.operationId,
        token,
        status: "applied",
      });
    }
    await debounceRuns();
    await debounceRuns();
    expect(
      updateSectionProps.mock.calls.map(
        (call) =>
          (call[0] as { data: { props: HeroProps } }).data.props.heading,
      ),
      "W1, then the held value, once",
    ).toEqual([EDITED, ORIGINAL]);
    expect(sentAt(1)).toMatchObject({
      props: { heading: ORIGINAL },
      expectedDraftGeneration: 2,
    });
    expect(shownHeading()).toBe(ORIGINAL);
    expect(await serverRead()).toMatchObject({ heading: ORIGINAL });
  });
});
