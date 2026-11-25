/**
 * Shared setup for the shell round-trip tests: the mocks, the playing preview,
 * the fixtures and the render helpers. It registers its own `vi.mock` calls and
 * hooks, so every test file imports it first and gets the same environment the
 * former single file had. Not a test file: Vitest only collects `*.test.tsx`.
 */
import {
  createLiveFrame,
  frameEnvelope,
  modelCurrentBridge,
} from "@/lib/test-utils/preview-frame-handshake";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type {
  StorefrontThemeEditorDTO,
} from "@/lib/storefront/dto/storefront-theme.dto";
import {
  useThemeWorkspaceStore,
} from "@/lib/storefront/store/theme-workspace-store";
import {
  useEditorWriteGateStore,
} from "@/lib/storefront/store/editor-write-gate-store";
import type {
  StorefrontThemeEditorSearch,
} from "@/lib/validations/storefront-theme";
import {
  storefrontThemeFileQueries,
} from "../-queries/storefront-theme-files.queries";
import {
  themePreviewServerQueries,
} from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";
import type { EditorCodeWorkspaceHandle } from "./editor-code-workspace";

const themeFileServerControl = vi.hoisted(() => ({
  save: null as null | ((...args: unknown[]) => unknown),
  read: null as null | ((...args: unknown[]) => unknown),
  list: null as null | ((...args: unknown[]) => unknown),
}));

const themeFileQueueControl = vi.hoisted(() => ({
  supersedeNext: false,
  supersededCount: 0,
}));

const editFileSaveControl = vi.hoisted(() => ({
  captureSave: false,
  saveFile: null as unknown,
}));

/**
 * Every Theme file save the shell starts, recorded and then made as usual:
 * the object position tests assert that the control saves no source.
 */
const objposSavedFiles = vi.hoisted((): unknown[] => []);

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const save = actual.saveStorefrontThemeFile as (
      ...args: unknown[]
    ) => unknown;
    const read = actual.getStorefrontThemeFile as (
      ...args: unknown[]
    ) => unknown;
    const list = actual.listStorefrontThemeFiles as (
      ...args: unknown[]
    ) => unknown;
    return {
      ...actual,
      listStorefrontThemeFiles: (...args: unknown[]) =>
        themeFileServerControl.list
          ? themeFileServerControl.list(...args)
          : list(...args),
      getStorefrontThemeFile: (...args: unknown[]) =>
        themeFileServerControl.read
          ? themeFileServerControl.read(...args)
          : read(...args),
      saveStorefrontThemeFile: (...args: unknown[]) => {
        objposSavedFiles.push(args[0]);
        return themeFileServerControl.save
          ? themeFileServerControl.save(...args)
          : save(...args);
      },
    };
  },
);

vi.mock("./theme-file-save-queue", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./theme-file-save-queue")
  >();
  return {
    ...actual,
    createThemeFileSaveQueue: () => {
      const queue = actual.createThemeFileSaveQueue();
      const controlled: typeof queue = {
        ...queue,
        enqueue: (args) => {
          if (themeFileQueueControl.supersedeNext) {
            themeFileQueueControl.supersedeNext = false;
            themeFileQueueControl.supersededCount += 1;
            return Promise.resolve(args.superseded());
          }
          return queue.enqueue(args);
        },
      };
      return controlled;
    },
  };
});

vi.mock("./editor-code-workspace", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./editor-code-workspace")
  >();
  const RealWorkspace = actual.EditorCodeWorkspace;
  return {
    ...actual,
    EditorCodeWorkspace: forwardRef<
      EditorCodeWorkspaceHandle,
      ComponentProps<typeof RealWorkspace>
    >((props, ref) => {
      if (editFileSaveControl.captureSave) {
        editFileSaveControl.saveFile = props.onSaveFile;
        return null;
      }
      return <RealWorkspace {...props} ref={ref} />;
    }),
  };
});

/**
 * The selection round trip through the shell, rather than through the rules.
 *
 * `preview-reveal-request.test.ts` already pins what the editor decides about a
 * report — supersession, target matching, which preview it came from. What it
 * cannot see is whether the shell feeds those rules the right numbers, and that
 * is where this round trip has actually broken: a selection-mode re-assertion
 * that minted a fresh revision silently outranked the request the author had
 * just made, so the first tree click of every session was answered and then
 * thrown away.
 *
 * The harness plays the preview. `postEditorToPreviewMessage` is observed
 * instead of driven through a real iframe, because the transport refuses to
 * address a frame that is still same-origin — which is every iframe jsdom can
 * make — and would swallow the messages this is here to watch. Incoming
 * messages are real ones on `window`, so they still pass the transport's origin,
 * source and session checks.
 *
 * The Inspector panel is the real one; see the mock below for what it adds.
 */

const EDITOR_ORIGIN = "http://localhost:3000";

const PREVIEW_ORIGIN = "https://preview.morph.test";

const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";

/** The frame comes up and names its page, as a live one does. */
const liveFrame = createLiveFrame(
  {
    origin: PREVIEW_ORIGIN,
    session: PREVIEW_SESSION,
  },
  {
    capabilities: ["selection-field-section", "section-presentation-ack-v1"],
  },
);

const bridgeWithoutPresentationAck = createLiveFrame(
  { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION },
  { capabilities: ["selection-field-section"] },
);

const { posted, latestPostedStyleRevision, postPreviewMessage } = vi.hoisted(
  () => ({
    posted: [] as Array<Record<string, unknown>>,
    latestPostedStyleRevision: { value: 0 },
    postPreviewMessage: vi.fn(),
  }),
);

const recordPreviewMessage = (
  _target: unknown,
  message: Record<string, unknown>,
) => {
  posted.push(message);
  if (
    typeof message.styleRevision === "number" &&
    Number.isSafeInteger(message.styleRevision)
  ) {
    latestPostedStyleRevision.value = Math.max(
      latestPostedStyleRevision.value,
      message.styleRevision,
    );
  }
  if (
    message.type !== "morph:storefront-preview-update-section-props" ||
    typeof message.presentationToken !== "object" ||
    message.presentationToken === null
  ) {
    return;
  }
  const token = message.presentationToken as { operationId?: unknown };
  const frame = document.querySelector("iframe");
  if (!frame?.contentWindow || typeof token.operationId !== "string") {
    return;
  }
  // Model the bridge ack after its queued React DOM commit. The document
  // identity is copied from the active frame, so a stale-document ack is
  // rejected by the shell just as it is in the live transport.
  const data = frameEnvelope({
    type: "morph:storefront-preview-section-presentation-ack",
    previewSession: PREVIEW_SESSION,
    operationId: token.operationId,
    token: message.presentationToken,
    status: "applied",
  });
  queueMicrotask(() => {
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          origin: PREVIEW_ORIGIN,
          source: frame.contentWindow,
        }),
      ),
    );
  });
};

beforeEach(() => {
  modelCurrentBridge();
  posted.length = 0;
  latestPostedStyleRevision.value = 0;
  postPreviewMessage.mockClear();
  postPreviewMessage.mockImplementation(recordPreviewMessage);
  themeFileServerControl.save = null;
  themeFileServerControl.read = null;
  themeFileServerControl.list = null;
  themeFileQueueControl.supersedeNext = false;
  themeFileQueueControl.supersededCount = 0;
  editFileSaveControl.captureSave = false;
  editFileSaveControl.saveFile = null;
  useEditorWriteGateStore.setState({ gates: {} });
  // Code acceptance and observed query versions are intentionally distinct.
  // No scenario may inherit the previous test's observed source generation.
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
});

/**
 * The Inspector panel is the real one, with one button beside it.
 *
 * It used to be stubbed out as a jsdom workaround: with it rendered, a failed
 * content write tore the tree down through "Maximum update depth exceeded".
 * That was not jsdom's. The fixture's hero has no `props`, and the Inspector's
 * content hook made a fresh `{}` for it on every render — an effect dependency
 * that set state — so it re-rendered until React gave up. The hook takes
 * `props` as `unknown` and has to survive any of them, so rendering the panel
 * here keeps that path under test.
 *
 * The button reaches `onUpdateThemeFileStyle`, which the real panel hands to
 * `EditorStyleInspector`: the style path is otherwise only reachable through
 * Radix controls jsdom cannot drive.
 */
vi.mock("./editor-assistant-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-assistant-panel")>();
  const RealPanel = actual.EditorAssistantPanel;
  return {
    ...actual,
    EditorAssistantPanel: (props: ComponentProps<typeof RealPanel>) => {
      return (
        <>
          <RealPanel {...props} />
          <button
            type="button"
            onClick={() =>
              props.onUpdateThemeFileStyle?.(
                stylePatchTarget.filePath,
                stylePatchTarget.elementName,
                (prevClasses) => `${prevClasses} p-8`,
              )
            }
          >
            Apply a style patch
          </button>
          <button
            type="button"
            onClick={() =>
              void props.onPromoteText?.({
                sectionId: "hero",
                componentSourcePath: "src/components/Hero.tsx",
                targetKey: "heading",
                fieldName: "heading",
                value: "Welcome",
              })
            }
          >
            Promote the selected text
          </button>
        </>
      );
    },
  };
});

/**
 * The content write an inline-text commit reaches.
 *
 * Mocked so a failure can be produced on demand. The shape decides which
 * callback runs: a refused write resolves with `success: false` — the OCC
 * conflict case — while a request that never lands rejects and goes to
 * `onError`. Both have to reach the author.
 */
const updateSectionProps = vi.hoisted(() => vi.fn());

const promoteText = vi.hoisted(() => vi.fn());

/**
 * The editor's read of the Theme, which is how a write that got no answer is
 * checked before anything is sent again.
 */
const getThemeEditor = vi.hoisted(() => vi.fn());

/**
 * What the stub panel asks the shell to patch.
 *
 * A `line:column` location rather than a marker, because
 * `element-target.test.ts` pins `"99:1"` as the target that matches no element
 * — so this drives the real `not-found` branch instead of a spelling that
 * merely happens to miss.
 */
const stylePatchTarget = vi.hoisted(() => ({
  filePath: "src/components/Hero.tsx",
  elementName: "99:1",
}));

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    promoteStorefrontThemeText: promoteText,
    getStorefrontThemeEditor: getThemeEditor,
  }),
);

vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: postPreviewMessage,
}));

vi.mock("./use-live-preview-message-bridge", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./use-live-preview-message-bridge")>();
  const { useCallback } = await import("react");
  return {
    ...actual,
    useLivePreviewMessageBridge: (
      ...args: Parameters<typeof actual.useLivePreviewMessageBridge>
    ) => {
      const bridge = actual.useLivePreviewMessageBridge(...args);
      const postMessage = useCallback(
        (
          target: Parameters<typeof bridge.postMessage>[0],
          message: Parameters<typeof bridge.postMessage>[1],
        ) => {
          postPreviewMessage(target, message);
        },
        [args[0]],
      );
      return { ...bridge, postMessage };
    },
  };
});

// The shell's breadcrumb uses `Link`. A real router would make this a test
// about routing.
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
        sections: [{ id: "hero", type: "hero", props: { heading: "Welcome" } }],
      },
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const baseSearch = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
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
    // The inline-text guard maps one text box to one persisted field and
    // compares these against the message it is sent.
    fieldKey: "heading",
    fieldPath: "heading",
    isSection: false,
  },
};

/** A preview server that is up, so the shell has something to frame. */
function readyQueryClient() {
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
  return client;
}

function renderShell(
  client = readyQueryClient(),
  frameOrContext: typeof liveFrame | StorefrontThemeEditorDTO = liveFrame,
  onSearchChange = vi.fn(),
) {
  const hasFrame = "ready" in frameOrContext;
  const frame = hasFrame ? frameOrContext : liveFrame;
  const editorContext = hasFrame ? context : frameOrContext;
  const rendered = render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={editorContext}
        search={baseSearch}
        onSearchChange={onSearchChange}
      />
    </QueryClientProvider>,
  );
  if (document.querySelector("iframe")) frame.ready();
  return rendered;
}

/** A message from the framed preview, addressed so the transport accepts it. */
function fromPreview(
  data: Record<string, unknown>,
  options: Readonly<{ preserveSelectionRevision?: boolean }> = {},
) {
  // Flush startup effects before choosing the revision the live frame echoes.
  act(() => {});
  const latestSelectionRevision = posted.reduce((latest, message) => {
    const revision = message.selectionRevision;
    return typeof revision === "number" ? Math.max(latest, revision) : latest;
  }, 0);
  const latestStyleRevision = posted.reduce((latest, message) => {
    const revision = message.styleRevision;
    return typeof revision === "number" ? Math.max(latest, revision) : latest;
  }, latestPostedStyleRevision.value);
  const currentReport =
    data.type === "morph:storefront-preview-select-section"
      ? { ...data, styleRevision: latestStyleRevision }
      : data;
  const response =
    currentReport.type === "morph:storefront-preview-select-section" &&
    !options.preserveSelectionRevision
      ? { ...currentReport, selectionRevision: latestSelectionRevision + 1 }
      : currentReport;
  liveFrame.before(response);
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: frameEnvelope({ ...response, previewSession: PREVIEW_SESSION }),
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
  liveFrame.after(response);
}

const messagesOfType = (type: string) =>
  posted.filter((message) => message.type === type);

/**
 * Selects the one node, then commits text into it the way the canvas does.
 *
 * The preview decides whether an element is an inline-text candidate; the shell
 * re-checks the descriptor it already holds, then writes. So the harness only
 * has to select the node and send the commit.
 */
async function commitInlineText(value = "Hello", originalValue = "Welcome") {
  await selectHeading();
  sendInlineCommit(value, originalValue);
}

async function selectHeading() {
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes: [heroNode],
  });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
}

function sendInlineCommit(
  value: string,
  originalValue: string,
  field: { fieldKey: string; fieldPath: string } = {
    fieldKey: "heading",
    fieldPath: "heading",
  },
  sectionId = "hero",
) {
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId,
    ...field,
    value,
    originalValue,
  });
}

/**
 * The editor's read of the Theme, with the hero holding `props` — at
 * `draftGeneration` when given, otherwise at the fixture's own.
 */
function editorHolding(
  props: Record<string, unknown>,
  draftGeneration?: number,
) {
  return {
    success: true,
    message: "ok",
    data: {
      ...context,
      templates: [
        {
          ...context.templates[0],
          ...(draftGeneration === undefined ? {} : { draftGeneration }),
          document: {
            version: 1,
            sections: [{ id: "hero", type: "hero", props }],
          },
        },
      ],
    },
  };
}

/** Said when an unanswered write is not resent because the source moved. */
const UNANSWERED_SOURCE_MOVED =
  "The source code has changed, so an unanswered save was not sent again. Select the field again. Your changes are kept.";

/** Said when a resend was refused as out of date and was not this write's. */
const UNANSWERED_RESEND_REFUSED =
  "This section changed elsewhere, so the save sent again was refused. Your changes are kept; load the latest version to continue.";

/** Said when an unanswered write read back as moved is not sent again. */
const UNANSWERED_DOCUMENT_MOVED =
  "This section changed elsewhere since an unanswered save, so it was not sent again. Load the latest version to continue.";

/** The header's own marker, which outlives the toast. */
const saveStatus = () =>
  document
    .querySelector("[data-editor-save-status]")
    ?.getAttribute("aria-label");

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A viewport with a height.
 *
 * The reveal reads the viewport height through the canvas's `ResizeObserver`,
 * and jsdom has no layout: `clientHeight` is 0 and the setup file's observer
 * never fires, so the reveal's `viewportHeight <= 0` guard returns before the
 * canvas is moved. Reporting a height through the observer the shell actually
 * registers is what puts the wiring in range.
 */
const VIEWPORT_HEIGHT = 900;

function isCanvasViewport(target: Element): boolean {
  return (
    target.getAttribute("role") === "region" &&
    (target.getAttribute("aria-label") ?? "").startsWith(
      "Storefront preview canvas",
    )
  );
}

class ReportingResizeObserver {
  private readonly reported = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    if (this.reported.has(target)) return;
    this.reported.add(target);
    // Radix registers one of these per floating element; only the canvas is
    // answered, which is what the setup file's silent stub does for the rest.
    if (!isCanvasViewport(target)) return;
    queueMicrotask(() => {
      this.callback(
        [
          {
            target,
            contentRect: { height: VIEWPORT_HEIGHT },
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    });
  }

  unobserve() {}

  disconnect() {}
}

/** The canvas offset the transform was applied to the DOM with, or null. */
function canvasY(): string | null {
  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>("*"),
  )) {
    const value = element.style.getPropertyValue("--morph-canvas-y");
    if (value) return value;
  }
  return null;
}

/**
 * Holds the content write's 300 ms debounce, and only it: every other timer
 * (the frame's acknowledgements, React's, the transport's) keeps running on
 * the real clock, so nothing else has to be cleared afterwards. `fire()`
 * runs the held debounce callbacks still set, as their timers running out
 * would; `restore()` puts back exactly the two functions replaced here.
 */
function holdContentDebounce() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const held = new Map<object, () => void>();
  const setSpy = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation(((
      handler: (...args: unknown[]) => void,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout === 300 && typeof handler === "function") {
        const handle = {};
        held.set(handle, () => handler(...args));
        return handle;
      }
      return realSetTimeout(handler, timeout, ...args);
    }) as unknown as typeof setTimeout);
  const clearSpy = vi
    .spyOn(globalThis, "clearTimeout")
    .mockImplementation(((handle?: unknown) => {
      if (typeof handle === "object" && handle !== null && held.has(handle)) {
        held.delete(handle);
        return;
      }
      realClearTimeout(handle as Parameters<typeof clearTimeout>[0]);
    }) as typeof clearTimeout);
  return {
    count: () => held.size,
    fire() {
      const due = [...held.values()];
      held.clear();
      for (const run of due) run();
    },
    restore() {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    },
  };
}

/** Lets the reveal's frame, and the transform's own frame, run. */
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

/**
 * The same shell, with the one theme file the style path reads a source from.
 *
 * `handleUpdateThemeFileStyle` takes the current source out of the workspace
 * snapshot or this query and returns before patching when neither holds it, so
 * a shell rendered without a file cannot reach the code under test at all. The
 * tree is written by hand rather than through `buildFileTree` because it only
 * has to render, and importing the DAL would pull the server layer into jsdom.
 */
function renderShellWithHero(
  content: string,
  selectedSection?: string,
  editorContext = context,
  providedClient?: QueryClient,
) {
  const client = providedClient ?? readyQueryClient();
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    {
      files: [
        {
          id: "file-hero",
          storefrontId: "storefront-1",
          themeId: "theme-1",
          path: stylePatchTarget.filePath,
          content,
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
                {
                  name: "Hero.tsx",
                  path: stylePatchTarget.filePath,
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
  const rendered = render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={editorContext}
        search={
          selectedSection
            ? { ...baseSearch, section: selectedSection }
            : baseSearch
        }
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  if (document.querySelector("iframe")) liveFrame.ready();
  return rendered;
}

const STYLE_SOURCE =
  'export function Hero() { return <section data-morph-node="section" className="p-4">x</section>; }';

const STYLE_AFTER =
  'export function Hero() { return <section data-morph-node="section" className="p-4 p-8">x</section>; }';

const STYLE_REMOTE = STYLE_SOURCE + "\n// saved by another editor";

type ThemeFileOutcome =
  | "saved"
  | "source-conflict"
  | "server-refusal"
  | "offline"
  | "offline-after-landing"
  /** Lands and answers success, but the answer names another receipt. */
  | "saved-foreign-receipt";

/**
 * A controllable Theme-file endpoint for the shell's real save/recovery path.
 * The test owns the server bytes and the sequence of answers; reads made by
 * `confirmLostSave` therefore observe whether a lost reply actually landed.
 */
function controlledThemeFile(initialContent: string) {
  let current = {
    id: "file-hero",
    storefrontId: "storefront-1",
    themeId: "theme-1",
    path: stylePatchTarget.filePath,
    content: initialContent,
    mimeType: "text/typescript",
    isEntry: false,
    version: 1,
    lastWriteAttemptId: null as string | null,
    sourceGeneration: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  let externalFile:
    | Omit<typeof current, "sourceGeneration">
    | undefined;
  const events: string[] = [];
  const outcomes: ThemeFileOutcome[] = [];
  let nextReadGate: Promise<void> | null = null;
  let releaseHeldRead: (() => void) | null = null;
  let nextSaveGate: Promise<void> | null = null;
  /** The Hero file is gone from the server (deleted elsewhere). */
  let deleted = false;
  /** Other source files this fixture answers for, by path (task 39 round 4). */
  const otherFiles = new Map<string, Omit<typeof current, "sourceGeneration">>();
  /** Editable public text files, listed as binary files, by path. */
  const publicTexts = new Map<string, Omit<typeof current, "sourceGeneration">>();
  const save = vi.fn(async (...args: unknown[]) => {
    const gate = nextSaveGate;
    nextSaveGate = null;
    if (gate) await gate;
    const data = (
      args[0] as {
        data?: { path?: unknown; content?: unknown; writeAttemptId?: unknown };
      } | undefined
    )?.data;
    if (typeof data?.content !== "string") {
      throw new Error("Theme-file test write had no content");
    }
    const content = data.content;
    if (typeof data.path === "string" && otherFiles.has(data.path)) {
      const before = otherFiles.get(data.path)!;
      const landedOther = {
        ...before,
        content,
        version: before.version + 1,
        lastWriteAttemptId: null,
      };
      otherFiles.set(data.path, landedOther);
      current = { ...current, sourceGeneration: current.sourceGeneration + 1 };
      events.push(`write:${data.path}:` + content);
      return {
        success: true,
        data: { ...landedOther, sourceGeneration: current.sourceGeneration },
      };
    }
    const outcome = outcomes.shift() ?? "saved";
    events.push("write:" + content);

    if (outcome === "source-conflict") {
      return {
        success: false,
        error: "SOURCE_GENERATION_CONFLICT",
        message: "The Theme source generation changed.",
      };
    }
    if (outcome === "server-refusal") {
      return {
        success: false,
        error: "THEME_FILE_REFUSED",
        message: "The Theme file write was refused.",
      };
    }
    if (outcome === "offline") {
      throw new Error("The Theme-file write got no answer");
    }

    const landed = {
      ...current,
      content,
      version: current.version + 1,
      lastWriteAttemptId:
        typeof data?.writeAttemptId === "string" ? data.writeAttemptId : null,
      sourceGeneration: current.sourceGeneration + 1,
    };
    if (outcome === "offline-after-landing") {
      current = landed;
      throw new Error("The answer was lost after the file landed");
    }
    if (outcome === "saved-foreign-receipt") {
      current = landed;
      return {
        success: true,
        data: { ...current, lastWriteAttemptId: "foreign-receipt" },
      };
    }
    current = landed;
    return { success: true, data: { ...current } };
  });
  const read = vi.fn(async (...args: unknown[]) => {
    const gate = nextReadGate;
    nextReadGate = null;
    if (gate) await gate;
    events.push("read");
    const path = (args[0] as { data?: { path?: unknown } } | undefined)?.data
      ?.path;
    if (typeof path === "string" && publicTexts.has(path)) {
      return { success: true, data: { ...publicTexts.get(path)! } };
    }
    if (typeof path === "string" && otherFiles.has(path)) {
      return { success: true, data: { ...otherFiles.get(path)! } };
    }
    if (deleted) {
      return {
        success: false,
        error: "NOT_FOUND",
        message: "File not found",
      };
    }
    const { sourceGeneration: _sourceGeneration, ...file } = current;
    return { success: true, data: file };
  });
  const list = vi.fn(async () => {
    events.push("snapshot");
    const { sourceGeneration, ...file } = current;
    return {
      success: true,
      message: "Theme files listed",
      data: {
        files: [
          ...(deleted ? [] : [file]),
          ...(externalFile ? [externalFile] : []),
          ...otherFiles.values(),
        ],
        binaryFiles: Array.from(publicTexts.values(), (text) => ({
          ...text,
          content: "",
          encoding: "binary",
          blobDigest: "a".repeat(64),
          sizeBytes: new TextEncoder().encode(text.content).byteLength,
        })),
        tree: [],
        sourceGeneration,
        latestPublishedRevision: null,
      },
    };
  });
  const externalWrite = (content: string) => {
    current = {
      ...current,
      content,
      version: current.version + 1,
      lastWriteAttemptId: null,
      sourceGeneration: current.sourceGeneration + 1,
    };
  };
  const externalSourceWrite = () => {
    externalFile = {
      id: "file-other",
      storefrontId: current.storefrontId,
      themeId: current.themeId,
      path: "src/components/Other.tsx",
      content: "export const Other = () => null;",
      mimeType: "text/typescript",
      isEntry: false,
      version: 1,
      lastWriteAttemptId: null,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    current = {
      ...current,
      sourceGeneration: current.sourceGeneration + 1,
    };
  };
  const replaceFileIdKeepingReceipt = () => {
    current = { ...current, id: `${current.id}-replacement` };
  };
  const advanceFileVersionKeepingReceipt = () => {
    current = { ...current, version: current.version + 1 };
  };
  /** Other bytes under the same receipt, version and generation. */
  const replaceContentKeepingReceipt = (content: string) => {
    current = { ...current, content };
  };

  themeFileServerControl.save = save;
  themeFileServerControl.read = read;
  themeFileServerControl.list = list;
  return {
    save,
    read,
    list,
    outcomes,
    events,
    holdNextRead: () => {
      nextReadGate = new Promise<void>((resolve) => {
        releaseHeldRead = resolve;
      });
      return () => {
        releaseHeldRead?.();
        releaseHeldRead = null;
      };
    },
    externalWrite,
    externalSourceWrite,
    replaceFileIdKeepingReceipt,
    advanceFileVersionKeepingReceipt,
    replaceContentKeepingReceipt,
    /** The next write waits until the returned release is called. */
    holdNextSave: () => {
      let release: () => void = () => {};
      nextSaveGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    deleteOnServer: () => {
      deleted = true;
      current = { ...current, sourceGeneration: current.sourceGeneration + 1 };
    },
    addOtherFile: (path: string, content: string) => {
      const { sourceGeneration: _generation, ...base } = current;
      otherFiles.set(path, {
        ...base,
        id: `file-${path}`,
        path,
        content,
        version: 1,
        lastWriteAttemptId: null,
      });
    },
    otherFile: (path: string) => otherFiles.get(path),
    addPublicText: (path: string, content: string) => {
      const { sourceGeneration: _generation, ...base } = current;
      publicTexts.set(path, {
        ...base,
        id: `file-${path}`,
        path,
        content,
        mimeType: "text/plain",
        version: 2,
        lastWriteAttemptId: null,
      });
    },
    file: () => ({ ...current }),
  };
}

function localThemeFile() {
  return useThemeWorkspaceStore
    .getState()
    .getWorkspaceFiles("storefront-1", "theme-1")[stylePatchTarget.filePath];
}

async function captureCodeFileSave() {
  editFileSaveControl.captureSave = true;
  fireEvent.click(screen.getByRole("button", { name: "Code" }));
  await waitFor(() =>
    expect(typeof editFileSaveControl.saveFile).toBe("function"),
  );
  const saveFile = editFileSaveControl.saveFile as
    | (
        (
          filePath: string,
          content: string,
          options?: { confirmed?: boolean },
        ) => Promise<unknown>
      )
    | null;
  if (!saveFile) throw new Error("Code Workspace did not expose onSaveFile");
  return saveFile;
}

async function createEditHistoryEntry(content: string) {
  renderShellWithHero(STYLE_SOURCE);
  const saveFile = await captureCodeFileSave();
  await act(async () => {
    await saveFile(stylePatchTarget.filePath, content);
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"))
      .toBe(false),
  );
}

function applyStylePatch() {
  act(() => {
    screen.getByRole("button", { name: "Apply a style patch" }).click();
  });
}

export {
  PREVIEW_ORIGIN,
  PREVIEW_SESSION,
  ReportingResizeObserver,
  STYLE_AFTER,
  STYLE_REMOTE,
  STYLE_SOURCE,
  UNANSWERED_DOCUMENT_MOVED,
  UNANSWERED_RESEND_REFUSED,
  UNANSWERED_SOURCE_MOVED,
  applyStylePatch,
  baseSearch,
  bridgeWithoutPresentationAck,
  canvasY,
  captureCodeFileSave,
  commitInlineText,
  context,
  controlledThemeFile,
  createEditHistoryEntry,
  editorHolding,
  flushFrames,
  fromPreview,
  getThemeEditor,
  heroNode,
  holdContentDebounce,
  liveFrame,
  localThemeFile,
  messagesOfType,
  objposSavedFiles,
  postPreviewMessage,
  posted,
  promoteText,
  readyQueryClient,
  recordPreviewMessage,
  renderShell,
  renderShellWithHero,
  saveStatus,
  selectHeading,
  sendInlineCommit,
  stylePatchTarget,
  themeFileQueueControl,
  updateSectionProps,
};
