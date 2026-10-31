import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRequired } from "@/lib/auth/auth-failure";
import { DESIGN_ELEMENT_SECTIONS_MESSAGE } from "@/lib/storefront/compiler/design-element-operation";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import {
  postEditorToPreviewMessage,
  type PreviewEditableNode,
} from "@/lib/storefront/editor/preview-protocol";
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
import {
  PENDING_DESIGN_WRITE_HELD_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";

/**
 * Reproductions for decision A (handoff/2026-10-31/guard-a-decisions.md;
 * inventory guard-a-origin-inventory.md sections 2.1-2.3, tests A1/A3/A4/A5).
 *
 * A Design element edit (layers-panel Delete, canvas sibling reorder) is sent
 * the first time as `operation: "design-element"` with its `designElement`
 * op, so the server recomputes and judges it on the stored Theme. When that
 * first send does not land, the edit stays in the workspace, and three paths
 * send it again: Save my changes after a source-generation conflict, Check
 * and save after an unanswered send, and Save my changes after an auth pause.
 * Decision A: the pending edit keeps its origin, so each resend carries the
 * same operation. Decision Q3: on resume, only an explicit NOT_FOUND read may
 * mean "absent"; any other failed read keeps the file held and sends nothing.
 *
 * A1, A3, A4 and A5 were committed as expected-failure reproductions on 8f707df
 * (55b8cbd), each failing because of the gap it names; the fix turns them
 * into plain tests. The tests marked control held before the fix too. Harness
 * and fixture copied from visual-editor-shell-element-structure-guard.test.tsx;
 * only server functions and the preview transport are mocked.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const SESSION = "aaaaaaaa-1111-4111-8111-111111111111";
const OWNER = { id: "user-1", name: "Owner", email: "owner@morph.test" };

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const saveThemeFile = vi.hoisted(() => vi.fn());
const getThemeFile = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
let lastSectionsPanelProps: ComponentProps<
  typeof import("./editor-sections-panel").EditorSectionsPanel
> | null = null;

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
    getStorefrontThemeFile: getThemeFile,
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
vi.mock("@/server/auth/getSession", () => ({ getSession }));
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
// Code mode, as visual-editor-shell-source-conflict-retry.test.tsx mounts it:
// Monaco is a textarea; language services and formatting are inert.
vi.mock("@monaco-editor/react", () => ({
  default: ({
    defaultValue,
    onChange,
  }: {
    defaultValue?: string;
    onChange?: (value?: string) => void;
  }) => {
    const [value, setValue] = useState(defaultValue ?? "");
    return (
      <textarea
        aria-label="Code editor"
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value);
          onChange?.(event.currentTarget.value);
        }}
      />
    );
  },
}));
vi.mock("./editor-code-language-support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editor-code-language-support")>()),
  configureThemeTypeScript: vi.fn(),
  disposeThemeWorkspaceModels: vi.fn(),
  ensureThemeWorkspaceModels: vi.fn(),
  registerTailwindCompletionProvider: vi.fn(() => ({ dispose: vi.fn() })),
}));
vi.mock("./editor-code-formatter", () => ({
  formatEditorCode: vi.fn(async (content: string) => content),
}));
// The real panel; its props are recorded so a test can reach the shell's own
// delete handler with a node, as the panel's confirmed Delete does.
vi.mock("./editor-sections-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-sections-panel")>();
  const RealPanel = actual.EditorSectionsPanel;
  return {
    ...actual,
    EditorSectionsPanel: (props: ComponentProps<typeof RealPanel>) => {
      lastSectionsPanelProps = props;
      return <RealPanel {...props} />;
    },
  };
});

const sectionComponent = (name: string) => `export const contentFields = {
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

// The OPEN fixture of visual-editor-shell-element-structure-guard.test.tsx.
// Line numbers matter: elements are named by `line:column` of their opening
// tag, as the preview does for unmarked elements.
const ROUTE_PATH = "/guard";
const ROUTE_FILE = "src/routes/guard.tsx";
const TEMPLATE_ID = "template-guard";
const SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import GuardHero from "../components/sections/GuardHero";
import GuardBanner from "../components/sections/GuardBanner";

export const Route = createFileRoute("/guard")({
  component: GuardRoute,
});

function GuardRoute() {
  return (
    <main>
      <div className="stack">
        <GuardHero {...content("hero")} />
        <GuardBanner {...content("banner")} />
      </div>
      <p className="note">Plain note</p>
      <small className="fine">Fine print</small>
    </main>
  );
}
`;
const AT = { note: "17:7", fine: "18:7" };

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
const FILES = [
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
  file("src/components/sections/GuardHero.tsx", sectionComponent("GuardHero")),
  file(
    "src/components/sections/GuardBanner.tsx",
    sectionComponent("GuardBanner"),
  ),
  file(ROUTE_FILE, SOURCE),
];
const treeAt = (sourceGeneration: number) => ({
  files: FILES,
  tree: [
    {
      name: "src",
      path: "src",
      isDirectory: true,
      children: FILES.filter((entry) => entry.path.startsWith("src/")).map(
        (entry) => ({
          name: entry.path.split("/").pop()!,
          path: entry.path,
          isDirectory: false,
        }),
      ),
    },
  ],
  sourceGeneration,
  latestPublishedRevision: null,
});

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
      id: TEMPLATE_ID,
      type: "page",
      name: ROUTE_PATH,
      routePath: ROUTE_PATH,
      document: { version: 1, sections: [] },
      draftRevisionId: null,
      publishedRevisionId: null,
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

type Posted = { type: string; routeRequestId?: number };
let log: Posted[] = [];

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
/** Lets queued effects and messages run; not a wait for anything to finish. */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Renders the route's page, signed in as OWNER, and brings the frame up. */
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
    treeAt(3) as never,
  );
  render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={
          {
            template: "page",
            templateId: TEMPLATE_ID,
            routePath: ROUTE_PATH,
            viewport: "desktop",
          } as StorefrontThemeEditorSearch
        }
        onSearchChange={vi.fn()}
        navigatingRoutePath={ROUTE_PATH}
        currentUser={OWNER}
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
  await flush();
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
  await waitFor(() =>
    expect(lastSectionsPanelProps?.onDeleteEditableNode).toBeTypeOf("function"),
  );
}

type SentSave = {
  path: string;
  content: string;
  operation?: string;
  designElement?: unknown;
  expectedSourceGeneration?: number;
};
const sentSaves = () =>
  saveThemeFile.mock.calls.map(
    ([request]) => (request as { data: SentSave }).data,
  );
const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
const workspaceFile = () =>
  useThemeWorkspaceStore
    .getState()
    .getWorkspaceFiles(scope.storefrontId, scope.themeId)[ROUTE_FILE];
const localContent = () => workspaceFile()?.localContent ?? SOURCE;

const routeElement = (key: keyof typeof AT): PreviewEditableNode => ({
  id: `route:${key}`,
  parentId: null,
  sectionId: ROUTE_FILE,
  label: key,
  kind: "custom",
  tagName: "div",
  target: {
    sectionId: ROUTE_FILE,
    sourceLocation: `${ROUTE_FILE}:${AT[key]}`,
    isSection: false,
  },
});

/** The panel's confirmed Delete; resolves with the shell's own answer. */
async function deleteNote() {
  let result: unknown;
  await act(async () => {
    result = await lastSectionsPanelProps!.onDeleteEditableNode!(
      routeElement("note"),
    );
  });
  return result as { success: boolean; message?: string };
}

function reorderNoteAndFine() {
  fromPreview({
    type: "morph:storefront-preview-commit-sibling-reorder",
    sectionId: ROUTE_FILE,
    sourceFilePath: ROUTE_FILE,
    draggedNodeId: AT.note,
    targetNodeId: AT.fine,
  });
}

async function press(name: string | RegExp) {
  const button = await screen.findByRole<HTMLButtonElement>("button", {
    name,
  });
  await waitFor(() => expect(button.disabled).toBe(false));
  await act(async () => {
    button.click();
  });
}

const REMOVE_NOTE = { kind: "remove-element", targetKey: AT.note };
const SWAP_NOTE_FINE = {
  kind: "swap-siblings",
  firstKey: AT.note,
  secondKey: AT.fine,
};
const stored = (content = SOURCE) => ({
  success: true,
  message: "Theme file loaded",
  data: file(ROUTE_FILE, content, 1),
});

/**
 * A Delete whose save was refused for who is signed in (a sign-in that
 * expired), then a check that finds the same account back: the paused
 * notice now offers Save my changes, and nothing has been resent yet.
 */
async function deleteWhilePausedThenVerify() {
  saveThemeFile.mockRejectedValueOnce(authRequired());
  await settled();
  await deleteNote();
  await waitFor(() => expect(workspaceFile()?.authPaused).toBe(true));
  const held = localContent();
  expect(held).not.toBe(SOURCE);
  expect(held).not.toContain("Plain note");
  await press("Check again");
  await screen.findByRole("button", { name: "Save my changes" });
  expect(sentSaves()).toHaveLength(1);
  return held;
}

/** Presses the paused notice's Save my changes and waits for it to finish. */
async function resumeAndWait() {
  await press("Save my changes");
  await waitFor(() => expect(getThemeFile).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull(),
  );
}

beforeEach(() => {
  log = [];
  lastSectionsPanelProps = null;
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
  getSession.mockReset();
  getSession.mockResolvedValue({ user: { id: OWNER.id } });
  getThemeFile.mockReset();
  getThemeFile.mockResolvedValue(stored());
  updateSectionProps.mockReset();
  saveThemeFile.mockReset();
  saveThemeFile.mockImplementation(
    async (request: { data: { path: string; content: string } }) => ({
      success: true,
      message: "saved",
      data: {
        ...file(request.data.path, request.data.content, 2),
        sourceGeneration: 5,
      },
    }),
  );
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
    async () => ({ success: true, message: "ok", data: treeAt(3) }) as never,
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

describe("a Design element edit sent again keeps its origin (decision A)", () => {
  it("control: the first send of a Delete carries operation design-element", async () => {
    await settled();
    const result = await deleteNote();

    expect(result).toEqual({ success: true });
    expect(sentSaves()).toHaveLength(1);
    expect(sentSaves()[0]).toMatchObject({
      path: ROUTE_FILE,
      operation: "design-element",
      designElement: REMOVE_NOTE,
    });
  });

  // Was: Save my changes resent with no operation; only section structure
  // edits were recorded. Decision A: the pending op keeps its origin and is
  // resent as itself.
  it("A1: a Delete refused by generation, then Save my changes, is sent again as the same design-element op", async () => {
    saveThemeFile.mockImplementationOnce(async () => {
      // Another tab saved meanwhile; the Theme read from now on is newer.
      vi.mocked(listStorefrontThemeFiles).mockImplementation(
        async () =>
          ({ success: true, message: "ok", data: treeAt(4) }) as never,
      );
      return {
        success: false,
        error: "SOURCE_GENERATION_CONFLICT",
        message:
          "Remote source changes detected (current generation: 4): the theme working source was updated by another operation.",
      };
    });
    await settled();
    await deleteNote();
    await waitFor(() => expect(workspaceFile()?.sourceConflict).toBe(true));
    const held = localContent();
    expect(held).not.toContain("Plain note");

    await press("Save my changes");
    await waitFor(() => expect(sentSaves()).toHaveLength(2));

    const resent = sentSaves()[1]!;
    expect(resent.path).toBe(ROUTE_FILE);
    expect(resent.content).toBe(held);
    expect(resent.expectedSourceGeneration).toBe(4);
    expect(resent.operation).toBe("design-element");
    expect(resent.designElement).toEqual(REMOVE_NOTE);
  });

  // Decision Q4: a resend the server refuses outright is an answer, not an
  // unknown outcome. The edit stays as it is, unsaved; it is not taken back
  // (the author's draft) and not sent again on its own.
  it("Q4: a resend refused by the server keeps the edit unsaved, not taken back and not sent again", async () => {
    saveThemeFile.mockImplementationOnce(async () => {
      vi.mocked(listStorefrontThemeFiles).mockImplementation(
        async () =>
          ({ success: true, message: "ok", data: treeAt(4) }) as never,
      );
      return {
        success: false,
        error: "SOURCE_GENERATION_CONFLICT",
        message:
          "Remote source changes detected (current generation: 4): the theme working source was updated by another operation.",
      };
    });
    await settled();
    await deleteNote();
    await waitFor(() => expect(workspaceFile()?.sourceConflict).toBe(true));
    const held = localContent();
    saveThemeFile.mockImplementationOnce(async () => ({
      success: false,
      error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
      message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
    }));

    await press("Save my changes");
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        DESIGN_ELEMENT_SECTIONS_MESSAGE,
      ),
    );

    expect(sentSaves()).toHaveLength(2);
    expect(sentSaves()[1]).toMatchObject({
      operation: "design-element",
      designElement: REMOVE_NOTE,
    });
    expect(localContent()).toBe(held);
    expect(workspaceFile()?.dirty).toBe(true);
  });

  // Was: Check and save resent the unconfirmed file with no operation, after
  // confirmLostSave found it had not landed. Decision A: the resend carries
  // the original op.
  it("A5: a reorder whose send got no answer, not landed, is sent again by Check and save as the same design-element op", async () => {
    saveThemeFile.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    await settled();
    reorderNoteAndFine();
    await waitFor(() =>
      expect(workspaceFile()?.unconfirmedContent).toBeDefined(),
    );
    const held = localContent();
    expect(sentSaves()[0]).toMatchObject({
      operation: "design-element",
      designElement: SWAP_NOTE_FINE,
    });
    // The server still holds the route as it was: the first send did not land.
    getThemeFile.mockResolvedValue(stored(SOURCE));

    await press("Check and save");
    await waitFor(() => expect(sentSaves()).toHaveLength(2));

    const resent = sentSaves()[1]!;
    expect(resent.content).toBe(held);
    expect(resent.operation).toBe("design-element");
    expect(resent.designElement).toEqual(SWAP_NOTE_FINE);
  });

  // Was: resumePausedWrites sent each held file through settleHeldFile with
  // no operation. Decision A.
  it("A3: a Delete held while writes were paused is sent on Save my changes as the same design-element op", async () => {
    const held = await deleteWhilePausedThenVerify();
    getThemeFile.mockResolvedValue(stored(SOURCE));

    await press("Save my changes");
    await waitFor(() => expect(sentSaves()).toHaveLength(2));

    const resent = sentSaves()[1]!;
    expect(resent.content).toBe(held);
    expect(resent.operation).toBe("design-element");
    expect(resent.designElement).toEqual(REMOVE_NOTE);
  });
});

describe("resume after an auth pause when the held file's read fails (decision Q3)", () => {
  // Was: readLatest in resumePausedWrites mapped any `success: false` answer
  // to null, which settleHeldFile takes as "not landed", and sent. Decision
  // Q3: only an explicit NOT_FOUND may mean absent; any other failure keeps
  // the file held and sends nothing.
  it("A4: a read answered with GET_FAILED sends nothing and keeps the draft held", async () => {
    const held = await deleteWhilePausedThenVerify();
    getThemeFile.mockResolvedValue({
      success: false,
      message: "Failed to load theme file",
      error: "GET_FAILED",
    });

    await resumeAndWait();

    expect(sentSaves()).toHaveLength(1);
    expect(localContent()).toBe(held);
    expect(workspaceFile()?.dirty).toBe(true);
    expect(workspaceFile()?.authPaused).toBe(true);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "A file was not saved: what the server holds could not be read. Your changes are kept; try again.",
    );
  });

  // Control. `getStorefrontThemeFile` answers a missing file with
  // `fail("File not found", { error: "NOT_FOUND" })`
  // (storefront-theme-files.serverFn.ts ~714). Decision Q3 allows that answer
  // to be read as "absent", so the resume may go on to send; what that send
  // looks like (and its OCC outcome) is not asserted here.
  it("control: a read answered with NOT_FOUND lets the resume go on to send", async () => {
    await deleteWhilePausedThenVerify();
    getThemeFile.mockResolvedValue({
      success: false,
      message: "File not found",
      error: "NOT_FOUND",
    });

    await resumeAndWait();

    expect(sentSaves()).toHaveLength(2);
  });
});

/** Switches to Code and opens a file there, as the author clicks its row. */
async function openInCode(path: string) {
  act(() => {
    screen.getByRole("button", { name: /^Code$/ }).click();
  });
  const row = await waitFor(
    () => {
      const found = document.querySelector<HTMLElement>(
        `[data-file-tree-file="${path}"] > div`,
      );
      expect(found, `the row of ${path} in the Code explorer`).not.toBeNull();
      return found!;
    },
    { timeout: 15_000 },
  );
  act(() => {
    fireEvent.click(row);
  });
  return screen.findByRole(
    "textbox",
    { name: "Code editor" },
    { timeout: 15_000 },
  );
}

/** The Save my changes of the notice whose text matches `notice`. */
function saveMyChangesOf(notice: RegExp) {
  const button = screen
    .getAllByRole<HTMLButtonElement>("button", { name: "Save my changes" })
    .find((candidate) => {
      let node: HTMLElement | null = candidate.parentElement;
      while (node && !notice.test(node.textContent ?? "")) {
        node = node.parentElement;
      }
      return node !== null && node !== document.body;
    });
  expect(button, `Save my changes of the notice ${notice}`).toBeDefined();
  return button!;
}

const HERO_FILE = "src/components/sections/GuardHero.tsx";
const savesOf = (path: string) =>
  sentSaves().filter((save) => save.path === path);
const sourceConflictAt4 = async () => {
  // Another tab saved meanwhile; the Theme read from now on is newer.
  vi.mocked(listStorefrontThemeFiles).mockImplementation(
    async () => ({ success: true, message: "ok", data: treeAt(4) }) as never,
  );
  return {
    success: false,
    error: "SOURCE_GENERATION_CONFLICT",
    message:
      "Remote source changes detected (current generation: 4): the theme working source was updated by another operation.",
  };
};

describe("pending Design writes across paths and states (decision A)", () => {
  // A6. The first send was refused by the server, but the answer was lost:
  // the edit is unconfirmed. Check finds it did not land and sends it again
  // as the same operation; the server refuses it again; that answer is
  // known: refused and unsaved, no longer unconfirmed. No plain save.
  it("A6: a refusal whose answer was lost: Check sends the same op, the server refuses it again, nothing plain is sent", async () => {
    saveThemeFile.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    await settled();
    await deleteNote();
    await waitFor(() =>
      expect(workspaceFile()?.unconfirmedContent).toBeDefined(),
    );
    const held = localContent();
    getThemeFile.mockResolvedValue(stored(SOURCE));
    saveThemeFile.mockImplementationOnce(async () => ({
      success: false,
      error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
      message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
    }));

    await press("Check and save");
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        DESIGN_ELEMENT_SECTIONS_MESSAGE,
      ),
    );

    expect(sentSaves()).toHaveLength(2);
    for (const sent of sentSaves()) {
      expect(sent).toMatchObject({
        path: ROUTE_FILE,
        content: held,
        operation: "design-element",
        designElement: REMOVE_NOTE,
      });
    }
    expect(localContent()).toBe(held);
    expect(workspaceFile()?.dirty).toBe(true);
    expect(workspaceFile()?.unconfirmedContent).toBeUndefined();
  });

  // A2. Two files in different pending states, Code mode open. The route
  // holds a Design Delete still held by a pause (its read failed on resume,
  // so it was not sent); a component the author edited in Code met a source
  // conflict. Saving the source conflicts runs Code's save of everything
  // unsaved: it must leave the held Design write to its own path, not send
  // it as a plain save along the way.
  it("A2: Save my changes for a Code file's source conflict leaves a Design Delete held by a pause unsent", async () => {
    const held = await deleteWhilePausedThenVerify();
    getThemeFile.mockResolvedValue({
      success: false,
      message: "Failed to load theme file",
      error: "GET_FAILED",
    });
    await resumeAndWait();
    expect(workspaceFile()?.authPaused).toBe(true);
    expect(sentSaves()).toHaveLength(1);

    // The author edits a component in Code; its autosave meets a Theme that
    // moved on.
    saveThemeFile.mockImplementationOnce(sourceConflictAt4);
    const editor = await openInCode(HERO_FILE);
    const edited = `${sectionComponent("GuardHero")}// edited in Code\n`;
    fireEvent.change(editor, { target: { value: edited } });
    await waitFor(
      () =>
        expect(
          useThemeWorkspaceStore
            .getState()
            .getWorkspaceFiles(scope.storefrontId, scope.themeId)[HERO_FILE]
            ?.sourceConflict,
        ).toBe(true),
      { timeout: 5_000 },
    );
    expect(savesOf(HERO_FILE)).toHaveLength(1);

    await act(async () => {
      saveMyChangesOf(/The source may be/).click();
    });
    await waitFor(() => expect(savesOf(HERO_FILE)).toHaveLength(2));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull(),
    );

    expect(savesOf(HERO_FILE)[1]).toMatchObject({ content: edited });
    // The route was sent once, the first time, as the Design Delete; nothing
    // sent it again, plain or otherwise.
    expect(savesOf(ROUTE_FILE)).toHaveLength(1);
    expect(savesOf(ROUTE_FILE)[0]).toMatchObject({
      operation: "design-element",
      designElement: REMOVE_NOTE,
    });
    expect(localContent()).toBe(held);
    expect(workspaceFile()?.authPaused).toBe(true);
  });

  // A plain save call is not the author taking the file over: Code's own
  // Save of the very text a pending Design write wrote sends that write, as
  // itself, for the server to judge again. Here the write was refused on its
  // resend (Q4: kept, unsaved); the author opens the route in Code and
  // presses Save without changing it.
  it("Code's Save of the unchanged text of a refused Design Delete sends it as the design-element op again", async () => {
    saveThemeFile.mockImplementationOnce(sourceConflictAt4);
    await settled();
    await deleteNote();
    await waitFor(() => expect(workspaceFile()?.sourceConflict).toBe(true));
    const held = localContent();
    const refused = async () => ({
      success: false,
      error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
      message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
    });
    saveThemeFile.mockImplementationOnce(refused);
    await press("Save my changes");
    await waitFor(() => expect(savesOf(ROUTE_FILE)).toHaveLength(2));
    await waitFor(() => expect(workspaceFile()?.saveState).toBe("error"));

    saveThemeFile.mockImplementationOnce(refused);
    await openInCode(ROUTE_FILE);
    await press(/^Save\s*Ctrl\+S$/);
    await waitFor(() => expect(savesOf(ROUTE_FILE)).toHaveLength(3));

    expect(localContent()).toBe(held);
    for (const sent of savesOf(ROUTE_FILE)) {
      expect(sent).toMatchObject({
        content: held,
        operation: "design-element",
        designElement: REMOVE_NOTE,
      });
    }
  });

  // Keep Mine is the author taking the file over in Code: the explicit
  // overwrite ends the Design write's identity, and its text goes as a plain
  // save. (Code's ordinary Save of the same text keeps it; see above.)
  it("Keep Mine on a version conflict sends the Design Delete's text as a plain overwrite", async () => {
    const remote = SOURCE.replace("Fine print", "Fine print, from another tab");
    saveThemeFile.mockImplementationOnce(async () => ({
      success: false,
      error: "FILE_VERSION_CONFLICT",
      message: "The file changed on the server.",
    }));
    getThemeFile.mockResolvedValue({
      success: true,
      message: "Theme file loaded",
      data: file(ROUTE_FILE, remote, 2),
    });
    await settled();
    await deleteNote();
    await waitFor(() => expect(workspaceFile()?.conflict).toBeDefined());
    const held = localContent();
    expect(held).not.toContain("Plain note");
    expect(sentSaves()[0]).toMatchObject({
      operation: "design-element",
      designElement: REMOVE_NOTE,
    });

    await openInCode(ROUTE_FILE);
    await press("Keep Mine (Overwrite)");
    await waitFor(() => expect(savesOf(ROUTE_FILE)).toHaveLength(2));

    const overwrite = savesOf(ROUTE_FILE)[1]!;
    expect(overwrite.content).toBe(held);
    expect(overwrite.operation).toBeUndefined();
    expect(overwrite.designElement).toBeUndefined();
  });

  /**
   * A Design Delete refused on its resend (Q4): kept, unsaved, still the
   * pending write of the route.
   */
  async function refusedDelete() {
    saveThemeFile.mockImplementationOnce(sourceConflictAt4);
    await settled();
    await deleteNote();
    await waitFor(() => expect(workspaceFile()?.sourceConflict).toBe(true));
    saveThemeFile.mockImplementationOnce(async () => ({
      success: false,
      error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
      message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
    }));
    await press("Save my changes");
    await waitFor(() => expect(savesOf(ROUTE_FILE)).toHaveLength(2));
    await waitFor(() => expect(workspaceFile()?.saveState).toBe("error"));
    return localContent();
  }

  // Control pair, 1 of 2. Another part of the editor changes the route on top
  // of the pending Delete (here written into the workspace directly, as such
  // an edit leaves it); the author then only presses Save in Code. Code did
  // not get that text from the author: sent plain, it would carry the
  // Delete unchecked. It is held: nothing sent, the text kept, the reason
  // shown.
  it("Code's Save of text another part of the editor put on top of a pending Design Delete sends nothing and keeps it", async () => {
    const held = await refusedDelete();
    const onTop = held.replace("Fine print", "Fine print, restyled");
    act(() =>
      useThemeWorkspaceStore
        .getState()
        .updateLocalContent(ROUTE_FILE, onTop, scope),
    );

    await openInCode(ROUTE_FILE);
    await press(/^Save\s*Ctrl\+S$/);
    await waitFor(() =>
      expect(workspaceFile()?.errorMessage).toBe(
        PENDING_DESIGN_WRITE_HELD_MESSAGE,
      ),
    );

    expect(savesOf(ROUTE_FILE)).toHaveLength(2);
    expect(localContent()).toBe(onTop);
    expect(workspaceFile()?.dirty).toBe(true);
  });

  // Control pair, 2 of 2. The author rewrites the route in Code, typing in
  // it, and saves: that is theirs, and Code keeps the ability to save it.
  it("the author's own rewrite in Code is saved as a plain Code save, ending the pending Design Delete", async () => {
    const held = await refusedDelete();
    const mine = `${held}// rewritten by the author\n`;

    const editor = await openInCode(ROUTE_FILE);
    fireEvent.change(editor, { target: { value: mine } });
    await press(/^Save\s*Ctrl\+S$/);
    await waitFor(() => expect(savesOf(ROUTE_FILE)).toHaveLength(3));

    const saved = savesOf(ROUTE_FILE)[2]!;
    expect(saved.content).toBe(mine);
    expect(saved.operation).toBeUndefined();
    expect(saved.designElement).toBeUndefined();
  });
});

describe("text held behind a Design write still on its way (decision A)", () => {
  type Answer = () => Promise<unknown>;
  /**
   * A Design Delete whose answer the test holds; then text another part of
   * the editor puts on top of it, which the author only saves in Code. That
   * save is held behind the Delete, waiting for the saves queued ahead.
   */
  async function heldBehindDeleteOnItsWay() {
    let answerDelete!: (answer: Answer) => void;
    saveThemeFile.mockImplementationOnce(
      (request: { data: { path: string; content: string } }) =>
        new Promise((resolve, reject) => {
          answerDelete = (answer) => answer().then(resolve, reject);
        }).then((value) =>
          value === "landed"
            ? {
                success: true,
                message: "saved",
                data: {
                  ...file(request.data.path, request.data.content, 2),
                  sourceGeneration: 4,
                },
              }
            : value,
        ),
    );
    await settled();
    act(() => {
      void lastSectionsPanelProps!.onDeleteEditableNode!(routeElement("note"));
    });
    await waitFor(() => expect(sentSaves()).toHaveLength(1));
    const deleted = localContent();
    expect(deleted).not.toContain("Plain note");
    const onTop = deleted.replace("Fine print", "Fine print, restyled");
    act(() =>
      useThemeWorkspaceStore
        .getState()
        .updateLocalContent(ROUTE_FILE, onTop, scope),
    );
    await openInCode(ROUTE_FILE);
    await press(/^Save\s*Ctrl\+S$/);
    // Held, waiting: nothing more is sent while the Delete is unanswered.
    await flush();
    expect(sentSaves()).toHaveLength(1);
    return { answerDelete, onTop };
  }

  it("the Delete lands and nothing newer came: the held text goes, as an ordinary save", async () => {
    const { answerDelete, onTop } = await heldBehindDeleteOnItsWay();

    await act(async () => {
      answerDelete(async () => "landed");
    });
    await waitFor(() => expect(savesOf(ROUTE_FILE)).toHaveLength(2));

    const second = savesOf(ROUTE_FILE)[1]!;
    expect(second.content).toBe(onTop);
    expect(second.operation).toBeUndefined();
  });

  it("the Delete is refused: the held text stays held, nothing more is sent", async () => {
    const { answerDelete, onTop } = await heldBehindDeleteOnItsWay();

    await act(async () => {
      answerDelete(async () => ({
        success: false,
        error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
        message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
      }));
    });
    await waitFor(() =>
      expect(workspaceFile()?.errorMessage).toBe(
        PENDING_DESIGN_WRITE_HELD_MESSAGE,
      ),
    );

    expect(savesOf(ROUTE_FILE)).toHaveLength(1);
    expect(localContent()).toBe(onTop);
  });

  it("the Delete goes unanswered: the held text stays held, nothing more is sent", async () => {
    const { answerDelete, onTop } = await heldBehindDeleteOnItsWay();

    await act(async () => {
      answerDelete(async () => {
        throw new TypeError("Failed to fetch");
      });
    });
    await waitFor(() =>
      expect(workspaceFile()?.errorMessage).toBe(
        PENDING_DESIGN_WRITE_HELD_MESSAGE,
      ),
    );

    expect(savesOf(ROUTE_FILE)).toHaveLength(1);
    expect(localContent()).toBe(onTop);
    expect(workspaceFile()?.unconfirmedContent).toBeDefined();
  });

  it("newer text replaces the held text while it waits: the held text stops, and does not go after the newer one", async () => {
    const { answerDelete, onTop } = await heldBehindDeleteOnItsWay();
    const newer = onTop.replace("Fine print, restyled", "Fine print, newer");
    act(() =>
      useThemeWorkspaceStore
        .getState()
        .updateLocalContent(ROUTE_FILE, newer, scope),
    );

    await act(async () => {
      answerDelete(async () => "landed");
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull(),
    );
    await flush();

    // Only the Delete went; the replaced text was never sent, and the newer
    // text is what the workspace holds.
    expect(savesOf(ROUTE_FILE)).toHaveLength(1);
    expect(sentSaves().some((sent) => sent.content === onTop)).toBe(false);
    expect(localContent()).toBe(newer);
  });
});
