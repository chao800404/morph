import {
  createLiveFrame,
  frameEnvelope,
  modelCurrentBridge,
  reloadFrameDocument,
  sendFrameReady,
} from "@/lib/test-utils/preview-frame-handshake";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { toast } from "sonner";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";
import {
  resolvePageStandIn,
  resolveSelectable,
  selectionMetadata,
} from "@/lib/storefront/editor/preview-dom";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

/**
 * The page stand-in in the editor: a field a Theme component renders outside
 * every section, on a page that owns its document (full Start, the current
 * Starter), reported under the route the editor asked for.
 *
 * The editor takes it only from the document it confirmed as current, after
 * that document answered its latest route request, for exactly that route.
 * Then the Inspector shows the field's state: controlled by code where the
 * page passes it, and where the component's default is proven to be what
 * renders, that default, labelled as the component's code default and saved
 * into the component's source. Nothing is ever written to a Document under a
 * route path, whatever the frame sends.
 *
 * The canvas report comes from the real preview pass and the real
 * resolution, on a page with no root element of its own. Only the server
 * calls and the frame's transport are replaced.
 */

const savedFiles = vi.hoisted(
  (): Array<{ path?: string; content?: string }> => [],
);
vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    saveStorefrontThemeFile: async (call: {
      data?: { path?: string; content?: string };
    }) => {
      savedFiles.push(call?.data ?? {});
      return {
        success: true,
        data: {
          id: `saved-${savedFiles.length}`,
          storefrontId: "storefront-1",
          themeId: "theme-1",
          path: call?.data?.path,
          content: call?.data?.content,
          mimeType: "text/typescript",
          isEntry: false,
          version: 1 + savedFiles.length,
          sourceGeneration: 1 + savedFiles.length,
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      };
    },
  }),
);
const updateSectionProps = vi.hoisted(() => vi.fn());
const reorderSections = vi.hoisted(() => vi.fn());
const renameSection = vi.hoisted(() => vi.fn());
const promoteText = vi.hoisted(() => vi.fn());
vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    reorderStorefrontThemeSections: reorderSections,
    renameStorefrontThemeSection: renameSection,
    promoteStorefrontThemeText: promoteText,
  }),
);
vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({ to, children }: { to?: string; children?: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const PREVIEW_ORIGIN = "https://preview.morph.test";
const SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const ADDRESS = { origin: PREVIEW_ORIGIN, session: SESSION };

const ROUTE = "src/routes/index.tsx";
const HERO = "src/components/Hero.tsx";
const heroSource = `export const contentFields = {
  title: { type: "text", label: "Title" },
  desc: { type: "text", label: "Desc" },
};
export default function Hero({ title = "Default title", desc = "Default desc" }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{desc}</p>
    </section>
  );
}`;
const route = (
  body: string,
) => `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";
const getHome = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getHome(), component: Home });
function Home() {
${body}
}`;
const EXPLICIT = route(
  `  return <main><Hero title="Stored title" desc="Stored desc" /></main>;`,
);
const TITLE_ONLY = route(
  `  return <main><Hero title="Stored title" /></main>;`,
);
const SPREAD = route(`  const { hero } = Route.useLoaderData();
  return <main><Hero {...hero} /></main>;`);

const STORED = { title: "Stored title", desc: "Stored desc" };
const DOC = {
  version: 1,
  sections: [{ id: "hero", type: "hero", enabled: true, props: STORED }],
};
const allFiles = (routeSource: string) => [
  ...livePreviewPlatformFiles(),
  { path: HERO, content: heroSource },
  { path: ROUTE, content: routeSource },
];

const context = {
  previewChannel: { editorOrigin: "http://localhost:3000", sessionId: SESSION },
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
      document: DOC,
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

beforeAll(() => {
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as { CSS?: unknown }).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    };
  }
});
beforeEach(() => {
  savedFiles.length = 0;
  for (const mock of [
    updateSectionProps,
    reorderSections,
    renameSection,
    promoteText,
  ]) {
    mock.mockReset();
    mock.mockResolvedValue({ success: false, message: "not in this test" });
  }
  vi.mocked(postEditorToPreviewMessage).mockClear();
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
    storefrontId: "storefront-1",
    themeId: "theme-1",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/**
 * A canvas answer is taken only when it is newer than every selection the
 * editor asked the frame for, and measured at the style revision it last
 * sent; the bridge stamps both, and so does this.
 */
function stampedReport(
  report: Record<string, unknown>,
): Record<string, unknown> {
  const sent = vi
    .mocked(postEditorToPreviewMessage)
    .mock.calls.map((call) => call[1] as Record<string, unknown>);
  const highest = (key: string) =>
    Math.max(
      0,
      ...sent.map((message) =>
        typeof message[key] === "number" ? (message[key] as number) : 0,
      ),
    );
  return {
    ...report,
    selectionRevision: highest("selectionRevision") + 1,
    styleRevision: highest("styleRevision"),
  };
}

/** A message from the frame's active document, as its bridge posts it. */
function fromFrame(
  liveFrame: ReturnType<typeof createLiveFrame>,
  data: Record<string, unknown>,
  previewDocument?: string,
) {
  liveFrame.before(data);
  const frame = document.querySelector("iframe");
  const stamped =
    data.type === "morph:storefront-preview-select-section"
      ? stampedReport(data)
      : data;
  const envelope = frameEnvelope({ ...stamped, previewSession: SESSION });
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data:
          previewDocument === undefined
            ? envelope
            : { ...envelope, previewDocument },
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
  liveFrame.after(data);
}

/**
 * What the bridge reports for a click on `selector`: the real preview pass
 * mounted the way a page that owns its document is (no root element of its
 * own), then the bridge's own resolution — a section, or else the page
 * stand-in for the route the editor asked for.
 */
async function canvasReport(routeSource: string, selector: string) {
  const { html } = await renderLivePreviewRoute({
    files: allFiles(routeSource),
    documents: { index: DOC as never },
  });
  const root = mountLivePreview(html);
  const element = root.querySelector(selector);
  const sectioned = resolveSelectable(element);
  const item = sectioned?.sectionId
    ? sectioned
    : resolvePageStandIn(element, { routePath: "/" });
  const text = element?.textContent ?? null;
  document.body.replaceChildren();
  if (!item?.sectionId) throw new Error(`nothing selectable at ${selector}`);
  return {
    text,
    report: {
      type: "morph:storefront-preview-select-section",
      sectionId: item.sectionId,
      componentType: item.type,
      sourceLocation: item.element.dataset.morphLoc ?? null,
      nodeId: undefined,
      elementKey: item.elementKey,
      fieldKey: item.fieldKey,
      field:
        item.descendantFields.length > 0
          ? null
          : (item.fieldKey ?? item.elementKey),
      descendantFields: item.descendantFields,
      itemId: item.itemId,
      contentUnavailable: item.contentUnavailable,
      ...selectionMetadata(item),
      styleRevision: 0,
      selectionRevision: 1,
      className: "",
      isSection: item.element === item.section,
      inspectorOverride: null,
      computedStyle: null,
      parentComputedStyle: null,
      sectionComputedStyle: null,
      documentRect: { top: 0, height: 100 },
    } as Record<string, unknown>,
  };
}

function mountShell(routeSource: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    } as never,
  );
  const files = allFiles(routeSource);
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    {
      files: files.map((file, index) => ({
        id: `f${index}`,
        storefrontId: "storefront-1",
        themeId: "theme-1",
        path: file.path,
        content: file.content,
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-08-20T00:00:00.000Z",
      })),
      tree: [],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  return render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={baseSearch}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

type FrameMode = "current" | "old-bridge" | "route-unanswered";

/** Mounts the editor with a frame of the given kind, ready on its page. */
async function editorWithFrame(routeSource: string, mode: FrameMode) {
  if (mode !== "old-bridge") modelCurrentBridge();
  const liveFrame = createLiveFrame(ADDRESS, {
    answerReady: mode !== "route-unanswered",
  });
  mountShell(routeSource);
  await wait(30);
  if (mode === "route-unanswered") {
    // Ready and on its page, but the editor's route request is unanswered.
    sendFrameReady(ADDRESS);
    fromFrame(liveFrame, {
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: "/",
    });
  } else {
    liveFrame.ready();
  }
  await wait(30);
  return liveFrame;
}

async function openContent() {
  const tab = screen.queryByRole("button", { name: /^Content$/ });
  if (tab) fireEvent.click(tab);
  await wait(30);
}

const panel = () =>
  document.querySelector<HTMLElement>("[data-editor-inspector-panel]")!;
const selectionShown = () =>
  !panel().textContent?.includes("Select a component");
const inputWithValue = (value: string) =>
  Array.from(
    panel().querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input,textarea",
    ),
  ).find((element) => element.value === value);
const codeControlled = (label: string) =>
  Array.from(
    panel().querySelectorAll<HTMLElement>(
      '[data-slot="inspector-code-controlled-field"]',
    ),
  ).find((element) => element.textContent?.includes(label));

const heroDefaultLine = (key: string) =>
  savedFiles
    .filter((file) => file.path === HERO)
    .map(
      (file) => String(file.content).match(new RegExp(`${key} = "[^"]*"`))?.[0],
    );

/** Content posts to the frame: what would change the canvas or the page's content. */
const contentPosts = (since: number) =>
  vi
    .mocked(postEditorToPreviewMessage)
    .mock.calls.slice(since)
    .map((call) => call[1] as { type?: string })
    .filter((message) =>
      [
        "morph:storefront-preview-update-section-props",
        "morph:storefront-preview-set-section-order",
        "morph:storefront-preview-update-selection-field",
      ].includes(message.type ?? ""),
    );

describe("a page stand-in from the confirmed current document", () => {
  it("is taken, and a field the page passes is controlled by code", async () => {
    const { report, text } = await canvasReport(EXPLICIT, "h1");
    const liveFrame = await editorWithFrame(EXPLICIT, "current");
    expect(report.sectionId).toBe("/");
    expect(text).toBe("Stored title");
    fromFrame(liveFrame, report);
    await wait(30);
    await openContent();

    expect(selectionShown()).toBe(true);
    expect(codeControlled("Title")?.textContent).toMatch(/controlled by code/i);
    expect(inputWithValue("Default title")).toBeUndefined();
    await wait(1500);
    expect(savedFiles).toEqual([]);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("offers a proven default labelled as the component's code default, and writes only the source", async () => {
    const { report, text } = await canvasReport(TITLE_ONLY, "p");
    const liveFrame = await editorWithFrame(TITLE_ONLY, "current");
    expect(text).toBe("Default desc");
    fromFrame(liveFrame, report);
    await wait(30);
    await openContent();

    const input = inputWithValue("Default desc");
    expect(input).toBeDefined();
    const field = input!.closest<HTMLElement>(
      '[data-slot="inspector-content-field"]',
    );
    expect(field?.dataset.contentStore).toBe("source-default");
    expect(
      field?.querySelector('[data-slot="inspector-code-default-badge"]')
        ?.textContent,
    ).toBe("Component code default");

    fireEvent.input(input!, { target: { value: "Edited code default" } });
    fireEvent.blur(input!);
    await wait(1800);
    expect(heroDefaultLine("desc")).toContain('desc = "Edited code default"');
    expect(updateSectionProps).not.toHaveBeenCalled();
  });
});

describe("a page stand-in the editor does not take", () => {
  it.each([
    ["from a frame on an older bridge, which names no document", "old-bridge"],
    [
      "before the frame answered the editor's route request",
      "route-unanswered",
    ],
  ] as const)("%s", async (_name, mode) => {
    const { report } = await canvasReport(EXPLICIT, "h1");
    const liveFrame = await editorWithFrame(EXPLICIT, mode);
    fromFrame(liveFrame, report);
    await wait(30);
    await openContent();
    expect(selectionShown()).toBe(false);
  });

  it("for a route other than the one the editor asked for", async () => {
    const { report } = await canvasReport(EXPLICIT, "h1");
    const liveFrame = await editorWithFrame(EXPLICIT, "current");
    fromFrame(liveFrame, { ...report, sectionId: "/other" });
    await wait(30);
    await openContent();
    expect(selectionShown()).toBe(false);
  });

  it("from a document other than the confirmed one, or one not yet confirmed", async () => {
    const { report } = await canvasReport(EXPLICIT, "h1");
    const liveFrame = await editorWithFrame(EXPLICIT, "current");
    fromFrame(liveFrame, report, "an-old-document");
    await wait(30);
    // The page reloads itself: its new document has not been confirmed.
    reloadFrameDocument();
    fromFrame(liveFrame, report);
    await wait(30);
    await openContent();
    expect(selectionShown()).toBe(false);
  });

  it("while a normal section is still taken from an older bridge", async () => {
    const { report } = await canvasReport(SPREAD, "h1");
    const liveFrame = await editorWithFrame(SPREAD, "old-bridge");
    expect(report.sectionId).toBe("hero");
    fromFrame(liveFrame, report);
    await wait(30);
    await openContent();
    expect(inputWithValue("Stored title")).toBeDefined();
  });
});

describe("a forged page stand-in writes nothing", () => {
  it("through any write the frame can ask for", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { report } = await canvasReport(EXPLICIT, "h1");
    const liveFrame = await editorWithFrame(EXPLICIT, "current");
    fromFrame(liveFrame, report);
    await wait(30);
    const since = vi.mocked(postEditorToPreviewMessage).mock.calls.length;

    fromFrame(liveFrame, {
      type: "morph:storefront-preview-commit-inline-text",
      sectionId: "/",
      fieldKey: "title",
      fieldPath: "title",
      value: "Forged inline",
      originalValue: "Stored title",
    });
    fromFrame(liveFrame, {
      type: "morph:storefront-preview-commit-section-reorder",
      draggedSectionId: "/",
      targetSectionId: "hero",
    });
    fromFrame(liveFrame, {
      type: "morph:storefront-preview-commit-array-item-reorder",
      sectionId: "/",
      draggedFieldPath: "items.0",
      targetFieldPath: "items.1",
    });
    await wait(1800);

    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(reorderSections).not.toHaveBeenCalled();
    expect(renameSection).not.toHaveBeenCalled();
    expect(promoteText).not.toHaveBeenCalled();
    expect(savedFiles).toEqual([]);
    expect(contentPosts(since)).toEqual([]);
    // Refused without a word about a section: there is none to speak of.
    expect(error).not.toHaveBeenCalled();
  });
});
