import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { createLiveFrame, frameEnvelope } from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * Input made after a content write was answered, before the editor context
 * rendered that answer.
 *
 * `updatePropsMutation.onSuccess` awaits the detail refetch, so the write's
 * pending input is dropped once the new document is in the query cache. The
 * route's `useQuery` only hands that document to the shell when the query
 * observers are notified, which `notifyManager` schedules for a later task.
 * In between, the editor context still holds the copy from before the write,
 * while the accepted snapshot already holds the write's answer.
 *
 * Found by PR #399's container acceptance: the author typed the original
 * value back and left the field in that window. Compared with the context's
 * copy (the original value) the input looked unchanged, so nothing was sent
 * and nothing was said; the next render then showed the write's value over
 * the author's.
 *
 * The window is pinned here by holding query notifications: the route below
 * renders the shell from the detail query exactly as the editor route does.
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

vi.mock("@/server/storefront/storefront-themes.serverFn", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateStorefrontThemeSectionProps: updateSectionProps,
  getStorefrontThemeEditor: getThemeEditor,
}));
vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn((_target: unknown, message: Record<string, unknown>) => {
    posted.push(message);
  }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({ to, children, ...rest }: { to?: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const source = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  subheading: { type: "text", label: "Subheading" }
};
export function Hero({ heading = "Welcome", subheading = "Summary" }) {
  return <section><h1>{heading}</h1><p>{subheading}</p></section>;
}`;

/** The stored heading before the first write: the value typed back. */
const ORIGINAL = "New collection";
/** The first write's value. */
const EDITED = "Swapped heading";

type HeroProps = { heading: string; subheading: string };
const contextAt = (props: HeroProps, draftGeneration: number): StorefrontThemeEditorDTO =>
  ({
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
          sections: [{ id: "hero", type: "hero", enabled: true, props: { ...props } }],
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

const detailKey = storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey;

const client = () => {
  const queryClient = new QueryClient({
    // The route's read is fresh until a write invalidates it, so the only
    // refetch is the one `updatePropsMutation.onSuccess` awaits.
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(detailKey, {
    success: true,
    message: "ok",
    data: contextAt(server.props, server.generation),
  } as never);
  queryClient.setQueryData(themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey, {
    success: true,
    message: "Live Preview server ready",
    data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
  } as never);
  queryClient.setQueryData(storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey, {
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
            children: [{ name: "Hero.tsx", path: "src/components/Hero.tsx", isDirectory: false }],
          },
        ],
      },
    ],
    sourceGeneration: 1,
    latestPublishedRevision: null,
  } as never);
  return queryClient;
};

/** Draft generations of the contexts the route has handed the shell, in order. */
let renderedGenerations: number[] = [];

/** The editor route's shape: the shell renders the detail query's document. */
function EditorRoute() {
  const query = useQuery(storefrontThemeQueries.detail("storefront-1", "theme-1"));
  const context = query.data?.success ? query.data.data : null;
  if (!context) return null;
  renderedGenerations.push(context.templates[0]!.draftGeneration as number);
  return <VisualEditorShell context={context} search={search} onSearchChange={vi.fn()} />;
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
async function canvasSelect(field: "heading" | null) {
  const revision =
    Math.max(
      canvasRevision,
      ...posted.map((m) => (typeof m.selectionRevision === "number" ? m.selectionRevision : 0)),
    ) + 1;
  canvasRevision = revision;
  fromPreview({
    type: "morph:storefront-preview-select-section",
    sectionId: "hero",
    componentType: "hero",
    kind: field ? "heading" : "section",
    nodeId: field ? `hero:node:${field}` : "hero",
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
      ...posted.map((m) => (typeof m.styleRevision === "number" ? m.styleRevision : 0)),
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
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
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
  if (inputs.length !== 1) return inputs.length === 0 ? null : `ambiguous(${inputs.length})`;
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

/**
 * W1: the heading becomes EDITED and the write is answered, its refetch
 * answered too, while the query's observers have not been told: the route
 * still renders the copy from before W1. Asserts that window, so a test that
 * passes on it passes for its reason.
 */
async function firstWriteAnsweredContextBehind() {
  await openContent();
  expect(shownHeading()).toBe(ORIGINAL);
  typeHeading(ORIGINAL, EDITED);
  held = true;
  await debounceRuns();

  expect(updateSectionProps, "W1 sent once").toHaveBeenCalledTimes(1);
  expect(sentAt(0)).toMatchObject({ props: { heading: EDITED }, expectedDraftGeneration: 1 });
  expect(getThemeEditor, "the refetch W1's onSuccess awaits was answered").toHaveBeenCalledTimes(1);
  const cached = queryClient.getQueryData(detailKey) as {
    data: StorefrontThemeEditorDTO;
  };
  expect(cached.data.templates[0]!.draftGeneration, "the cache holds W1's answer").toBe(2);
  expect(renderedGenerations.at(-1), "the route still renders the copy before W1").toBe(1);
  expect(heldNotifications.length, "its notification is held").toBeGreaterThan(0);
  // The Inspector shows what the author typed.
  expect(shownHeading()).toBe(EDITED);
}

const sentAt = (index: number) =>
  (updateSectionProps.mock.calls[index]![0] as { data: Record<string, unknown> }).data;
const saveStatus = () =>
  document.querySelector("[data-editor-save-status]")?.getAttribute("aria-label") ?? null;
const notices = () => ({
  status: saveStatus(),
  tryAgain: screen.queryByRole("button", { name: "Try again" }) !== null,
  saveMyChanges: screen.queryByRole("button", { name: "Save my changes" }) !== null,
  signInExpired: (document.body.textContent ?? "").includes("Your sign-in has expired"),
  unconfirmed:
    document
      .querySelector("[data-editor-unconfirmed-saves]")
      ?.getAttribute("data-editor-unconfirmed-saves") ?? null,
  errors: vi.mocked(toast.error).mock.calls.map((call) => String(call[0])),
  warnings: vi.mocked(toast.warning).mock.calls.map((call) => String(call[0])),
  infos: vi.mocked(toast.info).mock.calls.map((call) => String(call[0])),
});

/** The server's copy of the hero, written as the shell writes it. */
let server: { props: HeroProps; generation: number };
const serverRead = async () =>
  ((await getThemeEditor()) as { data: StorefrontThemeEditorDTO }).data.templates[0]!.document
    .sections[0]!.props as HeroProps;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
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
  server = { props: { heading: ORIGINAL, subheading: "Summary" }, generation: 1 };
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
      server = { props: { ...server.props, ...data.props }, generation: server.generation + 1 };
      return {
        success: true,
        data: {
          draftGeneration: server.generation,
          droppedProps: [],
          document: {
            version: 1,
            sections: [{ id: "hero", type: "hero", enabled: true, props: { ...server.props } }],
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

describe("input after a write was answered, before the context rendered it", () => {
  it("G1 typing the original value back is sent once, on W1's answer, and stays shown", async () => {
    renderEditor();
    await firstWriteAnsweredContextBehind();

    // In the window: the author types the original value back and leaves.
    typeHeading(EDITED, ORIGINAL);
    // The next task runs the held notifications: the route renders W1's copy.
    await releaseNotifications();
    expect(renderedGenerations.at(-1), "W1's copy rendered").toBe(2);
    const shownOnW1Copy = shownHeading();
    await debounceRuns();
    const shownAfterSecondWrite = shownHeading();
    await debounceRuns();

    // The author's last value was written: once, on W1's answer.
    expect(
      updateSectionProps.mock.calls.map((call) => (call[0] as { data: { props: HeroProps } }).data.props.heading),
      "W1, then the value typed back, once",
    ).toEqual([EDITED, ORIGINAL]);
    expect(sentAt(1)).toMatchObject({
      sectionId: "hero",
      templateId: "template-1",
      props: { heading: ORIGINAL },
      expectedDraftGeneration: 2,
      expectedSourceGeneration: 1,
    });
    // And never shown overwritten back to W1's value.
    expect(shownOnW1Copy, "W1's copy rendered over the author's input").toBe(ORIGINAL);
    expect(shownAfterSecondWrite).toBe(ORIGINAL);
    expect(shownHeading()).toBe(ORIGINAL);
    // A read of the server afterwards has the author's last value.
    expect(await serverRead()).toMatchObject({ heading: ORIGINAL });
    expect(server.generation).toBe(3);
    expect(notices().errors).toEqual([]);
    expect(notices().warnings).toEqual([]);
  });

  it("G2 leaving the field in the window without a change sends nothing", async () => {
    renderEditor();
    await firstWriteAnsweredContextBehind();

    const field = screen.getByDisplayValue(EDITED);
    fireEvent.focus(field);
    fireEvent.blur(field);
    await releaseNotifications();
    await debounceRuns();
    await debounceRuns();

    expect(updateSectionProps, "W1 only").toHaveBeenCalledTimes(1);
    expect(shownHeading()).toBe(EDITED);
    expect(await serverRead()).toMatchObject({ heading: EDITED });
    expect(notices().errors).toEqual([]);
  });

  it("G3 a canvas commit of the text W1 wrote, in the window, is no change and sends nothing", async () => {
    renderEditor();
    await firstWriteAnsweredContextBehind();

    // The heading selected the way the round-trip tests select it.
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
    const row = await screen.findByText("h1");
    act(() => {
      row.closest("button")?.click();
    });
    await settle();
    fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: true });
    fromPreview({
      type: "morph:storefront-preview-commit-inline-text",
      sectionId: "hero",
      fieldKey: "heading",
      fieldPath: "heading",
      value: EDITED,
      originalValue: EDITED,
    });
    fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing: false });
    await releaseNotifications();
    await debounceRuns();
    await debounceRuns();

    expect(updateSectionProps, "W1 only: the commit holds W1's text").toHaveBeenCalledTimes(1);
    expect(await serverRead()).toMatchObject({ heading: EDITED });
    expect(server.generation).toBe(2);
    expect(notices().infos).toEqual([]);
    expect(notices().errors).toEqual([]);
  });
});

describe("a second write that is not answered, or not sent, keeps its existing notices in the window", () => {
  /** W2 gets no answer: the request fails with no response. */
  const secondWriteUnanswered = () => {
    const answered = updateSectionProps.getMockImplementation()!;
    updateSectionProps.mockImplementation(async (args: unknown) => {
      if (updateSectionProps.mock.calls.length === 2) throw new Error("offline");
      return answered(args);
    });
  };
  /** Writes stop: the sign-in expired, as a refused write would have said. */
  const writesPause = () => {
    act(() => {
      useEditorWriteGateStore.getState().pause(scope, "AUTH_REQUIRED", "theme");
    });
  };
  /** The author signs in again and chooses to save. */
  async function resumeWrites() {
    const gate = useEditorWriteGateStore.getState();
    const epoch = gate.beginVerification(scope);
    if (epoch === null) throw new Error("Expected a paused write gate");
    act(() => {
      gate.finishVerification(scope, epoch, "verified");
    });
    await settle();
    const save = screen.getByRole("button", { name: "Save my changes" });
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);
    await debounceRuns();
    await debounceRuns();
  }

  it("U0 outside the window (control): what an unanswered input after W1 shows", async () => {
    secondWriteUnanswered();
    renderEditor();
    await firstWriteAnsweredContextBehind();
    await releaseNotifications();
    expect(renderedGenerations.at(-1)).toBe(2);

    typeHeading(EDITED, ORIGINAL);
    await debounceRuns();
    await debounceRuns();

    expect(updateSectionProps).toHaveBeenCalledTimes(2);
    expect(sentAt(1)).toMatchObject({ props: { heading: ORIGINAL }, expectedDraftGeneration: 2 });
    expect(shownHeading()).toBe(ORIGINAL);
    expect(notices()).toEqual(UNANSWERED_NOTICES);
  });

  it("U1 in the window: the same write, the same notices, the input kept", async () => {
    secondWriteUnanswered();
    renderEditor();
    await firstWriteAnsweredContextBehind();

    typeHeading(EDITED, ORIGINAL);
    await releaseNotifications();
    await debounceRuns();
    await debounceRuns();

    expect(updateSectionProps).toHaveBeenCalledTimes(2);
    expect(sentAt(1)).toMatchObject({ props: { heading: ORIGINAL }, expectedDraftGeneration: 2 });
    expect(shownHeading()).toBe(ORIGINAL);
    expect(notices()).toEqual(UNANSWERED_NOTICES);
    // Not landed: the server still holds W1's value.
    expect(await serverRead()).toMatchObject({ heading: EDITED });
  });

  it("H0 outside the window (control): an input while writes are paused is held, then sent on resume", async () => {
    renderEditor();
    await firstWriteAnsweredContextBehind();
    await releaseNotifications();
    expect(renderedGenerations.at(-1)).toBe(2);

    writesPause();
    typeHeading(EDITED, ORIGINAL);
    await debounceRuns();
    await debounceRuns();

    expect(updateSectionProps, "held, not sent").toHaveBeenCalledTimes(1);
    expect(shownHeading()).toBe(ORIGINAL);
    expect(notices()).toEqual(PAUSED_NOTICES);

    await resumeWrites();
    expect(updateSectionProps).toHaveBeenCalledTimes(2);
    expect(sentAt(1)).toMatchObject({ props: { heading: ORIGINAL }, expectedDraftGeneration: 2 });
    expect(shownHeading()).toBe(ORIGINAL);
    expect(await serverRead()).toMatchObject({ heading: ORIGINAL });
  });

  it("H1 in the window: the input is held with the same notices, then sent once on resume", async () => {
    renderEditor();
    await firstWriteAnsweredContextBehind();

    writesPause();
    typeHeading(EDITED, ORIGINAL);
    await releaseNotifications();
    await debounceRuns();
    await debounceRuns();

    expect(updateSectionProps, "held, not sent").toHaveBeenCalledTimes(1);
    expect(shownHeading()).toBe(ORIGINAL);
    expect(notices()).toEqual(PAUSED_NOTICES);

    await resumeWrites();
    expect(updateSectionProps).toHaveBeenCalledTimes(2);
    expect(sentAt(1)).toMatchObject({ props: { heading: ORIGINAL }, expectedDraftGeneration: 2 });
    expect(shownHeading()).toBe(ORIGINAL);
    expect(await serverRead()).toMatchObject({ heading: ORIGINAL });
  });
});

/**
 * What the editor shows for an unanswered content write, read from the
 * control U0 on main's behaviour: the window changes none of it.
 */
const UNANSWERED_NOTICES = {
  status: "Save failed",
  tryAgain: true,
  saveMyChanges: false,
  signInExpired: false,
  unconfirmed: "1",
  errors: ["Failed to update section properties"],
  warnings: [],
  infos: [],
};
/** What the editor shows for a content input held while writes are paused (H0). */
const PAUSED_NOTICES = {
  status: "Unsaved",
  tryAgain: false,
  saveMyChanges: false,
  signInExpired: true,
  unconfirmed: null,
  errors: [],
  warnings: [],
  infos: [],
};
