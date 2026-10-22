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
 * A prop set at a section's call site next to its content spread, from the
 * click to what the editor writes.
 *
 * `<Hero {...content("hero")} title={other.title} />` shows `other.title`:
 * the later attribute replaces the spread's. Claiming the element as
 * `hero.title` wrote the field the page does not show. Set before the spread,
 * the prop is a default the spread replaces, and the element is `hero.title`.
 *
 * The Theme renders with real React after the Live Preview's source pass;
 * the click is resolved, and an inline edit begun and finished, by the code
 * the canvas bridge runs; what that produces reaches the real editor shell in
 * the shape the bridge posts it. Nothing of the binding is stubbed: only the
 * server's write is recorded.
 *
 * Every stored title and every code literal is the same text, "Sale". The
 * inline guard compares the text on the page with the stored value of the
 * field the element names, so equal text passes it for a wrong field: where
 * the element is has to come from the source.
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
type Props = Record<string, string>;
type Sections = Record<string, Props>;

const HERO: File = {
  path: "src/components/Hero.tsx",
  content: `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
export default function Hero({ title = "Default title", subtitle = "Default subtitle" }) {
  return <section><h1>{title}</h1><p>{subtitle}</p></section>;
}`,
};
const ROUTE = "src/routes/index.tsx";

function contentRoute(body: string): File {
  return {
    path: ROUTE,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
const extra = { title: "Sale" };
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const other = content("other");
  return <main>${body.replaceAll("$hero", 'content("hero")')}</main>;
}`,
  };
}

function loaderRoute(body: string): File {
  return {
    path: ROUTE,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import Hero from "../components/Hero";
const getHome = createServerFn().handler(() => morph.pages.get("/"));
export const Route = createFileRoute("/")({ loader: () => getHome(), component: Home });
function Home() {
  const { hero, other } = Route.useLoaderData();
  return <main>${body.replaceAll("$hero", "hero")}</main>;
}`,
  };
}

/** Both sections hold "Sale" as their title. */
const STORED: Sections = {
  hero: { title: "Sale", subtitle: "Hero subtitle" },
  other: { title: "Sale", subtitle: "Other subtitle" },
};

/**
 * Hero taking its props whole: there is no destructured pattern to take the
 * thread through, so the call site is left unmarked as the section.
 */
const HERO_WHOLE: File = {
  path: HERO.path,
  content: `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
};
export default function Hero(props) {
  const { title = "Default title", subtitle = "Default subtitle" } = props;
  return <section><h1>{title}</h1><p>{subtitle}</p></section>;
}`,
};

/** Call sites whose `title` is not the spread's. */
const OVERRIDDEN: Record<string, readonly File[]> = {
  'content("hero"), then a literal': [
    HERO,
    contentRoute(`<Hero {...$hero} title="Sale" />`),
  ],
  'content("hero"), then another section\'s title (C4b)': [
    HERO,
    contentRoute(`<Hero {...$hero} title={other.title} />`),
  ],
  'content("hero"), then a literal, Hero taking its props whole': [
    HERO_WHOLE,
    contentRoute(`<Hero {...$hero} title="Sale" />`),
  ],
  "the loader form, then a literal": [
    HERO,
    loaderRoute(`<Hero {...$hero} title="Sale" />`),
  ],
  "the loader form, then another section's title (C4b)": [
    HERO,
    loaderRoute(`<Hero {...$hero} title={other.title} />`),
  ],
};

/** The literal first: the spread's title wins, so the element is hero.title. */
const BEFORE = contentRoute(`<Hero title="Sale" {...$hero} />`);

function document(sections: Sections): StorefrontPageDocument {
  return {
    version: 1,
    sections: Object.entries(sections).map(([id, props]) => ({
      id,
      type: "hero",
      enabled: true,
      props: { ...props },
    })),
  } as unknown as StorefrontPageDocument;
}

function contextAt(
  sections: Sections,
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
        document: document(sections),
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
 * own beside the editor. Mounted before the editor: mounting replaces the
 * document's body.
 */
async function renderPage(files: readonly File[], sections: Sections) {
  const { html } = await renderLivePreviewRoute({
    files: [...livePreviewPlatformFiles(), ...files],
    documents: { index: document(sections) },
  });
  return mountLivePreview(
    `<div id="root" data-morph-route-path="/">${html}</div>`,
  );
}

let selectionRevision = 0;
/** What the bridge posts for a click on `element` (`sendSelectionReport`). */
function selectionReport(element: HTMLElement) {
  const item = resolveSelectable(element);
  expect(item).not.toBeNull();
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
function inlineEdit(element: HTMLElement, sections: Sections, typed: string) {
  const commits: Array<Record<string, unknown>> = [];
  const editor = createInlineTextEditor({
    onCommit: (commit) => commits.push({ ...commit }),
    onLayoutChanged: () => {},
    storedValue: (target) => {
      const props = target.sectionId ? sections[target.sectionId] : undefined;
      return props && target.fieldPath
        ? getFieldPathValue(props, target.fieldPath)
        : undefined;
    },
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
  updateSectionProps.mock.calls.map((call) => {
    const { data } = call[0] as {
      data: { sectionId: string; props: Record<string, unknown> };
    };
    return { sectionId: data.sectionId, props: data.props };
  });

let server: { sections: Sections; generation: number };

/**
 * The editor, with its search kept the way the route keeps it: a selection
 * on another section moves `section` there, so the Inspector shows what the
 * click selected rather than the section the test opened on.
 */
function renderEditor(
  files: readonly File[],
  initial: StorefrontThemeEditorSearch = search,
) {
  const queryClient = client(files);
  let current = initial;
  const view = () => (
    <QueryClientProvider client={queryClient}>
      <VisualEditorShell
        context={contextAt(server.sections, server.generation)}
        search={current}
        onSearchChange={(next) => {
          current = { ...current, ...next } as StorefrontThemeEditorSearch;
          queueMicrotask(() => rerender(view()));
        }}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(view());
  liveFrame.ready();
}

let page: HTMLElement | null = null;

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
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
    storefrontId: "storefront-1",
    themeId: "theme-1",
  });
  server = {
    sections: structuredClone(STORED),
    generation: 1,
  };
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(
    async ({ data }: { data: { sectionId: string; props: Props } }) => {
      const sections = structuredClone(server.sections);
      sections[data.sectionId] = {
        ...(sections[data.sectionId] ?? {}),
        ...data.props,
      };
      server = { sections, generation: server.generation + 1 };
      return {
        success: true,
        data: {
          draftGeneration: server.generation,
          droppedProps: [],
          document: document(server.sections),
        },
      };
    },
  );
  getThemeEditor.mockReset();
  getThemeEditor.mockImplementation(async () => ({
    success: true,
    message: "ok",
    data: contextAt(server.sections, server.generation),
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
  page = null;
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

async function postCommits(commits: Array<Record<string, unknown>>) {
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
}

describe.each(Object.keys(OVERRIDDEN))("%s, every title Sale", (name) => {
  const files = OVERRIDDEN[name]!;

  it("the Inspector offers nothing on the title element, and nothing is written", async () => {
    page = await renderPage(files, STORED);
    renderEditor(files);
    const h1 = page.querySelector<HTMLElement>("h1")!;
    expect(h1.textContent).toBe("Sale");

    const offered = await inspectorTypes(h1, "Edited");
    expect(written().filter(({ props }) => "title" in props)).toEqual([]);
    expect(written()).toEqual([]);
    expect(offered).toBe(0);
  });

  it("an inline edit of the title element does not begin, and nothing is written", async () => {
    page = await renderPage(files, STORED);
    renderEditor(files);
    const h1 = page.querySelector<HTMLElement>("h1")!;
    await selectForInlineEditing(h1);

    const { began, commits } = inlineEdit(h1, STORED, "Edited");
    await postCommits(commits);
    expect(written().filter(({ props }) => "title" in props)).toEqual([]);
    expect(written()).toEqual([]);
    expect(began).toBe(false);
    expect(commits).toEqual([]);
  });
});

/**
 * The field the call site leaves alone, clicked on the canvas of an
 * overridden instance: it is still the section's, and only it is written.
 */
describe.each([
  'content("hero"), then a literal',
  'content("hero"), then another section\'s title (C4b)',
])("%s, the subtitle the call site leaves alone", (name) => {
  const files = OVERRIDDEN[name]!;

  it("the Inspector writes hero.subtitle, and only it", async () => {
    page = await renderPage(files, STORED);
    renderEditor(files);
    const p = page.querySelector<HTMLElement>("p")!;
    expect(p.textContent).toBe("Hero subtitle");
    fromPreview(selectionReport(p));
    await settle();
    await openContent();
    expect(editorInputs("Sale")).toEqual([]);
    const subtitle = editorInputs("Hero subtitle");
    expect(subtitle).toHaveLength(1);
    await type(subtitle[0]!, "Edited subtitle");
    expect(written()).toEqual([
      { sectionId: "hero", props: { subtitle: "Edited subtitle" } },
    ]);
  });

  it("an inline edit writes hero.subtitle, and only it", async () => {
    page = await renderPage(files, STORED);
    renderEditor(files);
    const p = page.querySelector<HTMLElement>("p")!;
    await selectForInlineEditing(p);
    const { began, commits } = inlineEdit(p, STORED, "Edited subtitle");
    expect(began).toBe(true);
    expect(commits).toEqual([
      {
        sectionId: "hero",
        fieldKey: "subtitle",
        fieldPath: "subtitle",
        value: "Edited subtitle",
        originalValue: "Hero subtitle",
      },
    ]);
    await postCommits(commits);
    expect(written()).toEqual([
      { sectionId: "hero", props: { subtitle: "Edited subtitle" } },
    ]);
  });
});

describe("a literal before the spread, both titles Sale", () => {
  const files = [HERO, BEFORE];

  it("the Inspector writes hero.title, the field the page shows, and only it", async () => {
    page = await renderPage(files, STORED);
    renderEditor(files);
    const h1 = page.querySelector<HTMLElement>("h1")!;
    expect(h1.textContent).toBe("Sale");
    const offered = await inspectorTypes(h1, "Edited");
    expect(offered).toBe(1);
    expect(written()).toEqual([
      { sectionId: "hero", props: { title: "Edited" } },
    ]);
    // The spread carries the written title, so the page shows it.
    const after = await renderPage(files, server.sections);
    expect(after.querySelector("h1")!.textContent).toBe("Edited");
  });

  it("an inline edit writes hero.title, and only it", async () => {
    page = await renderPage(files, STORED);
    renderEditor(files);
    const h1 = page.querySelector<HTMLElement>("h1")!;
    await selectForInlineEditing(h1);

    const { began, commits } = inlineEdit(h1, STORED, "Edited");
    expect(began).toBe(true);
    expect(commits).toEqual([
      {
        sectionId: "hero",
        fieldKey: "title",
        fieldPath: "title",
        value: "Edited",
        originalValue: "Sale",
      },
    ]);
    await postCommits(commits);
    expect(written()).toEqual([
      { sectionId: "hero", props: { title: "Edited" } },
    ]);
  });
});

/**
 * The section itself selected, from the structure panel or as the canvas
 * reports a click on its wrapper: the Inspector's whole Content form for it.
 *
 * A field the call site sets in code is not the stored value the page shows,
 * so the form does not offer it as a control; it says the code sets it. The
 * fields the call site leaves alone stay editable, and their writes are the
 * section's.
 */
const SECTION_ENTRY_OVERRIDDEN: Record<
  string,
  { files: readonly File[]; setInCode: readonly string[] }
> = {
  'content("hero"), then a literal': {
    files: [HERO, contentRoute(`<Hero {...$hero} title="Sale" />`)],
    setInCode: ["Title"],
  },
  'content("hero"), then another section\'s title (C4b)': {
    files: [HERO, contentRoute(`<Hero {...$hero} title={other.title} />`)],
    setInCode: ["Title"],
  },
  'content("hero"), then a later spread': {
    files: [HERO, contentRoute(`<Hero {...$hero} {...extra} />`)],
    setInCode: ["Title", "Subtitle"],
  },
  // The loader form binds no such call site, so the canvas has no wrapper to
  // click; the stored section is still listed, and its form is what is shown.
  "the loader form, then a literal": {
    files: [HERO, loaderRoute(`<Hero {...$hero} title="Sale" />`)],
    setInCode: ["Title"],
  },
  "the loader form, then another section's title (C4b)": {
    files: [HERO, loaderRoute(`<Hero {...$hero} title={other.title} />`)],
    setInCode: ["Title"],
  },
};

/** Clicks the section's row in the structure panel. */
async function selectFromStructurePanel(sectionId: string) {
  const row = screen
    .queryAllByRole("button")
    .find((button) =>
      (button.getAttribute("title") ?? "").startsWith(`Select ${sectionId};`),
    );
  expect(row, `a structure panel row for ${sectionId}`).toBeDefined();
  fireEvent.click(row!);
  await settle();
  await settle();
}

async function openContent() {
  const contentTab = screen.queryByRole("button", { name: /^Content$/ });
  if (contentTab) fireEvent.click(contentTab);
  await settle();
}

const editorInputs = (value: string) =>
  screen
    .queryAllByDisplayValue(value)
    .filter((input) => !page?.contains(input));

async function type(input: HTMLElement, value: string) {
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value } });
  fireEvent.blur(input);
  await saveSettles();
}

const codeSetNotice = () =>
  screen.queryByText(
    (_, element) =>
      element?.getAttribute("data-slot") === "inspector-code-set-fields",
  );

describe.each(Object.keys(SECTION_ENTRY_OVERRIDDEN))(
  "%s, the section itself selected, every title Sale",
  (name) => {
    const { files, setInCode } = SECTION_ENTRY_OVERRIDDEN[name]!;
    const subtitleSetInCode = setInCode.includes("Subtitle");

    async function expectForm() {
      await openContent();
      // The title the page does not show from storage is not a control.
      expect(editorInputs("Sale")).toEqual([]);
      const notice = codeSetNotice();
      expect(notice).not.toBeNull();
      for (const label of setInCode)
        expect(notice!.textContent).toContain(label);
      const subtitle = editorInputs("Hero subtitle");
      expect(subtitle).toHaveLength(subtitleSetInCode ? 0 : 1);
      if (!subtitleSetInCode) {
        await type(subtitle[0]!, "Edited subtitle");
      }
      expect(written().filter(({ props }) => "title" in props)).toEqual([]);
      expect(written()).toEqual(
        subtitleSetInCode
          ? []
          : [{ sectionId: "hero", props: { subtitle: "Edited subtitle" } }],
      );
    }

    it("from the structure panel", async () => {
      page = await renderPage(files, STORED);
      renderEditor(files);
      await settle();
      await selectFromStructurePanel("hero");
      await expectForm();
    });

    const loader = name.startsWith("the loader form");
    if (!loader)
      it("from a click on the section's wrapper on the canvas", async () => {
        page = await renderPage(files, STORED);
        renderEditor(files);
        const wrapper = page.querySelector<HTMLElement>(
          '[data-storefront-section-id="hero"]',
        );
        // The thread keeps the wrapper; every variant here takes the thread.
        expect(wrapper).not.toBeNull();
        const report = selectionReport(wrapper!);
        expect(report.isSection).toBe(true);
        fromPreview(report);
        await settle();
        await expectForm();
      });
  },
);

describe("a literal before the spread, the section itself selected", () => {
  it("from the structure panel, Title stays a control and writes hero.title", async () => {
    const files = [HERO, BEFORE];
    page = await renderPage(files, STORED);
    renderEditor(files);
    await settle();
    await selectFromStructurePanel("hero");
    await openContent();
    expect(codeSetNotice()).toBeNull();
    const title = editorInputs("Sale");
    expect(title).toHaveLength(1);
    await type(title[0]!, "Edited");
    expect(written()).toEqual([
      { sectionId: "hero", props: { title: "Edited" } },
    ]);
  });
});
