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
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { createInlineTextEditor } from "@/lib/storefront/editor/inline-text-editor";
import {
  resolveSelectable,
  selectionKindOf,
  selectionMetadata,
} from "@/lib/storefront/editor/preview-dom";
import { getFieldPathValue } from "@/lib/storefront/editor/selection-taxonomy";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";
import { createLiveFrame } from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * A click on an element whose value cannot be traced to one field of its
 * section, from the click to what the editor writes.
 *
 * The Theme renders with real React after the Live Preview's source pass;
 * the click is resolved, and an inline edit begun and finished, by the code
 * the canvas bridge runs; what that produces reaches the real editor shell in
 * the shape the bridge posts it. Nothing of the binding is stubbed: only the
 * server's write is recorded.
 *
 * Every case runs with title and subtitle holding the same text, "Sale". The
 * inline guard compares the text on the page with the stored value of the
 * field the element names, and two fields holding the same text pass it for
 * either: equal values are where a wrong field would be written unnoticed.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const liveFrame = createLiveFrame({
  origin: PREVIEW_ORIGIN,
  session: PREVIEW_SESSION,
});

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

beforeAll(() => {
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as { CSS?: unknown }).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    };
  }
});

type File = { path: string; content: string };
type HeroProps = { title: string; subtitle: string };

const HERO = "src/components/Hero.tsx";
const HEADING = "src/components/Heading.tsx";
const ROUTE = "src/routes/index.tsx";

const heroFile = (body: string, preamble = ""): File => ({
  path: HERO,
  content: `${preamble}export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
export default function Hero({ title = "Default title", subtitle = "Default subtitle" }) {
  const show = false;
  return <section>${body}</section>;
}`,
});

const headingFile = (name: string): File => ({
  path: HEADING,
  content: `export const contentFields = { ${name}: { type: "text", label: "Heading ${name}" } };
export default function Heading({ ${name} = "Default heading" }) {
  return <h2>{${name}}</h2>;
}`,
});

const routeFile: File = {
  path: ROUTE,
  content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";
const getHome = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getHome(), component: Home });
function Home() {
  const { hero } = Route.useLoaderData();
  return <main><Hero {...hero} /></main>;
}`,
};

/** Each Theme under test: its files, and the element a click lands on. */
const THEMES = {
  ternary: {
    files: [heroFile(`<h1>{show ? title : subtitle}</h1>`), routeFile],
    clicked: "h1",
  },
  "nested, shared name": {
    files: [
      heroFile(
        `<Heading title={subtitle} />`,
        `import Heading from "./Heading";\n`,
      ),
      headingFile("title"),
      routeFile,
    ],
    clicked: "h2",
  },
  "nested, distinct name": {
    files: [
      heroFile(
        `<Heading text={subtitle} />`,
        `import Heading from "./Heading";\n`,
      ),
      headingFile("text"),
      routeFile,
    ],
    clicked: "h2",
  },
} as const;
type ThemeName = keyof typeof THEMES;

/** The provable control: the sole spread's `{subtitle}`, written to subtitle. */
const CONTROL = {
  files: [heroFile(`<h1>{title}</h1><p>{subtitle}</p>`), routeFile],
  clicked: "p",
};

const SALE: HeroProps = { title: "Sale", subtitle: "Sale" };

function document(props: HeroProps): StorefrontPageDocument {
  return {
    version: 1,
    sections: [
      { id: "hero", type: "hero", enabled: true, props: { ...props } },
    ],
  } as unknown as StorefrontPageDocument;
}

function contextAt(
  props: HeroProps,
  generation: number,
): StorefrontThemeEditorDTO {
  return {
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
        document: document(props),
        draftGeneration: generation,
        version: 1,
      },
    ],
  } as unknown as StorefrontThemeEditorDTO;
}

const search = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
  section: "hero",
} as StorefrontThemeEditorSearch;

function client(files: readonly File[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
      files: files.map((file, index) => ({
        id: `file-${index}`,
        storefrontId: "storefront-1",
        themeId: "theme-1",
        path: file.path,
        content: file.content,
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-10-21T00:00:00.000Z",
        updatedAt: "2026-10-21T00:00:00.000Z",
      })),
      tree: [],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  return queryClient;
}

function fromPreview(data: Record<string, unknown>) {
  liveFrame.before(data);
  const frame = window.document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION },
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
  });
const saveSettles = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await settle();
};

/**
 * The page, rendered from the Theme and the stored content, in a host of its
 * own beside the editor (the iframe the shell renders stays empty in jsdom).
 * Mounted before the editor: mounting replaces the document's body.
 */
async function renderPage(files: readonly File[], props: HeroProps) {
  const { html } = await renderLivePreviewRoute({
    files: [...livePreviewPlatformFiles(), ...files],
    documents: { index: document(props) },
  });
  return mountLivePreview(
    `<div id="root" data-morph-route-path="/">${html}</div>`,
  );
}

let selectionRevision = 0;
/** What the bridge posts for a click on `element` (`sendSelectionReport`). */
function selectionReport(element: HTMLElement) {
  const item = resolveSelectable(element);
  expect(item?.sectionId).toBe("hero");
  selectionRevision =
    Math.max(
      selectionRevision,
      ...posted.map((m) =>
        typeof m.selectionRevision === "number" ? m.selectionRevision : 0,
      ),
    ) + 1;
  return {
    type: "morph:storefront-preview-select-section",
    sectionId: item!.sectionId,
    componentType: item!.type,
    sourceLocation: item!.element.dataset.morphLoc ?? null,
    elementKey: item!.elementKey,
    fieldKey: item!.fieldKey,
    field:
      item!.descendantFields.length > 0
        ? null
        : (item!.fieldKey ?? item!.elementKey),
    descendantFields: item!.descendantFields,
    itemId: item!.itemId,
    contentUnavailable: item!.contentUnavailable,
    ...selectionMetadata(item!),
    styleRevision: Math.max(
      0,
      ...posted.map((m) =>
        typeof m.styleRevision === "number" ? m.styleRevision : 0,
      ),
    ),
    selectionRevision,
    className: item!.element.getAttribute("class") ?? "",
    isSection: item!.element === item!.section,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
  };
}

/**
 * A double click and typing on `element`, by the bridge's own inline editor:
 * the commit it would post, or none when it refuses to begin.
 */
function inlineEdit(element: HTMLElement, props: HeroProps, typed: string) {
  const commits: Array<Record<string, unknown>> = [];
  const editor = createInlineTextEditor({
    onCommit: (commit) => commits.push({ ...commit }),
    onLayoutChanged: () => {},
    storedValue: (target) =>
      target.sectionId === "hero" && target.fieldPath
        ? getFieldPathValue(props, target.fieldPath)
        : undefined,
  });
  const item = resolveSelectable(element);
  const began = item
    ? editor.begin(
        { ...item, kind: selectionKindOf(item) },
        { selectionEnabled: true },
      )
    : false;
  if (began) {
    element.textContent = typed;
    editor.finish(true);
  }
  return { began, commits };
}

const written = () =>
  updateSectionProps.mock.calls.map(
    (call) =>
      (call[0] as { data: { props: Record<string, unknown> } }).data.props,
  );

let server: { props: HeroProps; generation: number };

function renderEditor(files: readonly File[]) {
  const queryClient = client(files);
  render(
    <QueryClientProvider client={queryClient}>
      <VisualEditorShell
        context={contextAt(server.props, server.generation)}
        search={search}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  liveFrame.ready();
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
  posted.length = 0;
  selectionRevision = 0;
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
    .setBaseSourceGeneration(1, {
      storefrontId: "storefront-1",
      themeId: "theme-1",
    });
  server = { props: { ...SALE }, generation: 1 };
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(
    async ({ data }: { data: { props: Partial<HeroProps> } }) => {
      server = {
        props: { ...server.props, ...data.props },
        generation: server.generation + 1,
      };
      return {
        success: true,
        data: {
          draftGeneration: server.generation,
          droppedProps: [],
          document: document(server.props),
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
  cleanup();
  window.document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Selects `element` on the canvas, opens Content, and types into whatever holds "Sale". */
async function inspectorTypes(element: HTMLElement, value: string) {
  fromPreview(selectionReport(element));
  await settle();
  const contentTab = screen.queryByRole("button", { name: /^Content$/ });
  if (contentTab) fireEvent.click(contentTab);
  await settle();
  const inputs = screen
    .queryAllByDisplayValue("Sale")
    .filter((input) => !page?.contains(input));
  for (const input of inputs) {
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value } });
    fireEvent.blur(input);
  }
  await saveSettles();
  return inputs.length;
}

let page: HTMLElement | null = null;

/**
 * Selects `element` with the canvas in select mode, which the Styles tab
 * turns on: the editor takes a canvas edit only while it is.
 */
async function selectForInlineEditing(element: HTMLElement) {
  fireEvent.click(screen.getByRole("button", { name: /^Styles$/ }));
  await settle();
  fromPreview(selectionReport(element));
  await settle();
}

describe.each(Object.keys(THEMES) as ThemeName[])(
  "%s, title and subtitle both Sale",
  (name) => {
    const theme = THEMES[name];

    it("the Inspector offers nothing on the element to write into the title", async () => {
      page = await renderPage(theme.files, SALE);
      renderEditor(theme.files);
      const element = page.querySelector<HTMLElement>(theme.clicked)!;
      expect(element.textContent).toBe("Sale");

      const offered = await inspectorTypes(element, "Edited");
      expect(written().filter((props) => "title" in props)).toEqual([]);
      expect(written()).toEqual([]);
      expect(offered).toBe(0);
      page = null;
    });

    it("an inline edit does not begin, so nothing reaches the editor to write", async () => {
      page = await renderPage(theme.files, SALE);
      renderEditor(theme.files);
      const element = page.querySelector<HTMLElement>(theme.clicked)!;
      await selectForInlineEditing(element);

      const { began, commits } = inlineEdit(element, SALE, "Edited");
      for (const commit of commits) {
        fromPreview({
          type: "morph:storefront-preview-inline-text-editing",
          editing: true,
        });
        fromPreview({
          type: "morph:storefront-preview-commit-inline-text",
          ...commit,
        });
        fromPreview({
          type: "morph:storefront-preview-inline-text-editing",
          editing: false,
        });
      }
      await saveSettles();
      expect(written().filter((props) => "title" in props)).toEqual([]);
      expect(written()).toEqual([]);
      expect(began).toBe(false);
      page = null;
    });
  },
);

describe("the provable control, title and subtitle both Sale", () => {
  it("the Inspector writes the subtitle the element shows, and only it", async () => {
    page = await renderPage(CONTROL.files, SALE);
    renderEditor(CONTROL.files);
    const element = page.querySelector<HTMLElement>(CONTROL.clicked)!;
    const offered = await inspectorTypes(element, "Edited");
    expect(offered).toBe(1);
    expect(written()).toEqual([{ subtitle: "Edited" }]);
    page = null;
  });

  it("an inline edit writes the subtitle the element shows, and only it", async () => {
    page = await renderPage(CONTROL.files, SALE);
    renderEditor(CONTROL.files);
    const element = page.querySelector<HTMLElement>(CONTROL.clicked)!;
    await selectForInlineEditing(element);

    const { began, commits } = inlineEdit(element, SALE, "Edited");
    expect(began).toBe(true);
    expect(commits).toEqual([
      {
        sectionId: "hero",
        fieldKey: "subtitle",
        fieldPath: "subtitle",
        value: "Edited",
        originalValue: "Sale",
      },
    ]);
    fromPreview({
      type: "morph:storefront-preview-inline-text-editing",
      editing: true,
    });
    fromPreview({
      type: "morph:storefront-preview-commit-inline-text",
      ...commits[0],
    });
    fromPreview({
      type: "morph:storefront-preview-inline-text-editing",
      editing: false,
    });
    await saveSettles();
    expect(written()).toEqual([{ subtitle: "Edited" }]);
    page = null;
  });
});
