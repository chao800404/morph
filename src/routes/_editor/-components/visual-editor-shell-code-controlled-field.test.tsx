import {
  createLiveFrame,
  frameEnvelope,
  modelCurrentBridge,
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
import {
  INLINE_TEXT_REFUSED_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";
import {
  resolveSelectable,
  selectionMetadata,
} from "@/lib/storefront/editor/preview-dom";
import {
  livePreviewPlatformFiles,
  mountLivePreview,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

/**
 * A component's source default is offered for editing only where it is what
 * the canvas shows (content binding contract, ROADMAP 1.2).
 *
 * A route that hands CMS values to a component through explicit props
 * (`const { title } = hero; <Hero title={title} />`) is traced: the prop is
 * proven against the section the loader serves, so the Inspector offers it as
 * that CMS field and an edit writes the Document, never the component source.
 * A literal or an untraced value stays unproven: the field is not offered, the
 * canvas says why, and nothing is written. Each field is judged on its own; a
 * literal that overrides one prop does not remove the section's other proven
 * fields from the Document.
 *
 * Everything between the click and the write is real: the preview pass and
 * its injected markers, the selection the bridge would report from them, the
 * shell, the panel and the Inspector. Only the server calls and the frame's
 * transport are replaced.
 */

const savedFiles = vi.hoisted(
  (): Array<{
    path?: string;
    content?: string;
    operation?: string;
    codeDefault?: Record<string, unknown>;
  }> => [],
);
// Records what a source save writes, and accepts it as the server would.
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
vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
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
const liveFrame = createLiveFrame({ origin: PREVIEW_ORIGIN, session: SESSION });

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
/** The audit's case: values from loader data, handed over one by one. */
const EXPLICIT = route(`  const { hero } = Route.useLoaderData();
  const { title, desc } = hero;
  return <main><Hero title={title} desc={desc} /></main>;`);
/** The proven form: a sole spread of the slot. */
const SPREAD = route(`  const { hero } = Route.useLoaderData();
  return <main><Hero {...hero} /></main>;`);
/** Nothing passed: both defaults render. */
const BARE = route(`  return <main><Hero /></main>;`);
/** Title passed, desc left out. */
const TITLE_ONLY = route(`  const { hero } = Route.useLoaderData();
  const { title } = hero;
  return <main><Hero title={title} /></main>;`);
/** A spread plus an explicit prop: not a sole spread, and the spread may set desc. */
const SPREAD_AND_TITLE = route(`  const { hero } = Route.useLoaderData();
  return <main><Hero {...hero} title="Code title" /></main>;`);

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
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(async ({ data }) => ({
    success: true,
    data: {
      draftGeneration: data.expectedDraftGeneration + 1,
      droppedProps: [],
    },
  }));
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
  vi.spyOn(toast, "error").mockImplementation(() => "");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

function fromPreview(given: Record<string, unknown>) {
  const data =
    given.type === "morph:storefront-preview-select-section"
      ? stampedReport(given)
      : given;
  liveFrame.before(data);
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: frameEnvelope({ ...data, previewSession: SESSION }),
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
  liveFrame.after(data);
}
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/**
 * What the canvas reports for a click on `selector`, from the real preview
 * pass. The page root is the one the client-only preview wraps the route in.
 */
async function canvasReport(routeSource: string, selector: string) {
  const { html } = await renderLivePreviewRoute({
    files: allFiles(routeSource),
    documents: { index: DOC as never },
  });
  const root = mountLivePreview(
    `<div id="root" data-morph-route-path="/">${html}</div>`,
  );
  const element = root.querySelector(selector);
  const item = resolveSelectable(element);
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
      bindingState: item.bindingState ?? null,
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
    },
  };
}

function mountShell(routeSource: string, section: string) {
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
        search={{ ...baseSearch, section }}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/**
 * Clicks `selector` on the canvas and opens the Content tab.
 *
 * The frame is a current bridge that has said it is ready and answered the
 * editor's route: a page stand-in (`/`) is taken only from such a frame
 * (`acceptsPageStandIn`).
 */
async function select(routeSource: string, selector: string) {
  const { report, text } = await canvasReport(routeSource, selector);
  modelCurrentBridge();
  mountShell(routeSource, report.sectionId);
  await wait(30);
  liveFrame.ready();
  await wait(30);
  fromPreview(report);
  await wait(30);
  const tab = screen.queryByRole("button", { name: /^Content$/ });
  if (tab) fireEvent.click(tab);
  await wait(30);
  return { report, text };
}

const panel = () =>
  document.querySelector<HTMLElement>("[data-editor-inspector-panel]")!;
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

/** Edits the input showing `value`, if the panel offers one, as an author would. */
async function editIfOffered(value: string, next: string) {
  const input = inputWithValue(value);
  if (input) {
    fireEvent.input(input, { target: { value: next } });
    fireEvent.blur(input);
  }
  await wait(1800);
  return Boolean(input);
}

const heroDefaultLine = (key: string) =>
  savedFiles
    .filter((file) => file.path === HERO)
    .map(
      (file) => String(file.content).match(new RegExp(`${key} = "[^"]*"`))?.[0],
    );

describe("explicit props from loader data (the audit's case)", () => {
  it("the title is the CMS field it was traced to, and writes the Document", async () => {
    const { text, report } = await select(EXPLICIT, "h1");
    // The canvas shows the stored value the route passes, not the default.
    expect(text).toBe("Stored title");
    expect(report.sectionId).toBe("hero");
    expect(report.bindingState).toBe("cms-field");
    expect(await editIfOffered("Stored title", "Edited in Inspector")).toBe(
      true,
    );

    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(updateSectionProps.mock.calls[0]![0].data).toMatchObject({
      sectionId: "hero",
      props: { title: "Edited in Inspector" },
    });
    expect(savedFiles).toEqual([]);
  });

  it("the description is the CMS field it was traced to, and writes the Document", async () => {
    const { report } = await select(EXPLICIT, "p");
    expect(report.sectionId).toBe("hero");
    expect(report.bindingState).toBe("cms-field");
    expect(await editIfOffered("Stored desc", "Edited desc")).toBe(true);

    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(updateSectionProps.mock.calls[0]![0].data).toMatchObject({
      sectionId: "hero",
      props: { desc: "Edited desc" },
    });
    expect(savedFiles).toEqual([]);
  });
});

describe("a component rendered without the prop", () => {
  it("shows its default, which stays editable and is written to the source", async () => {
    const { text } = await select(BARE, "h1");
    expect(text).toBe("Default title");
    expect(codeControlled("Title")).toBeUndefined();
    expect(await editIfOffered("Default title", "Edited default")).toBe(true);

    expect(heroDefaultLine("title")).toContain('title = "Edited default"');
    expect(updateSectionProps).not.toHaveBeenCalled();
  });
});

describe("the sole spread form", () => {
  it("still writes the Document section, unchanged", async () => {
    const { report } = await select(SPREAD, "h1");
    expect(report.sectionId).toBe("hero");
    expect(codeControlled("Title")).toBeUndefined();
    expect(await editIfOffered("Stored title", "Edited stored")).toBe(true);

    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(updateSectionProps.mock.calls[0]![0].data).toMatchObject({
      sectionId: "hero",
      props: { title: "Edited stored" },
    });
    expect(savedFiles).toEqual([]);
  });
});

describe("per field, on one component", () => {
  it("title passed writes the Document; desc left out stays a source default", async () => {
    const first = await select(TITLE_ONLY, "h1");
    expect(first.report.sectionId).toBe("hero");
    expect(first.report.bindingState).toBe("cms-field");
    expect(await editIfOffered("Stored title", "Leaked title")).toBe(true);
    expect(savedFiles).toEqual([]);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    cleanup();

    const second = await select(TITLE_ONLY, "p");
    expect(second.text).toBe("Default desc");
    expect(second.report.bindingState).toBe("code-default");
    fromPreview({
      type: "morph:storefront-preview-commit-inline-text",
      sectionId: "hero",
      fieldKey: "desc",
      fieldPath: "desc",
      value: "Leaked inline desc",
      originalValue: "Default desc",
    });
    expect(savedFiles).toEqual([]);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(await editIfOffered("Default desc", "Edited desc default")).toBe(
      true,
    );
    expect(heroDefaultLine("desc")).toContain('desc = "Edited desc default"');
    expect(savedFiles.at(-1)).toMatchObject({
      path: HERO,
      operation: "code-default",
      codeDefault: {
        componentPath: HERO,
        componentName: "Hero",
        fieldKey: "desc",
        expectedCurrentDefault: "Default desc",
        value: "Edited desc default",
      },
    });
    // The title's default was not touched by that save, and the source write
    // did not become a Document write.
    expect(heroDefaultLine("title")).toEqual(['title = "Default title"']);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("refuses and never falls back to a full-file save when the component source no longer has a provable static string default at save time", async () => {
    const second = await select(TITLE_ONLY, "p");
    expect(second.text).toBe("Default desc");
    expect(second.report.bindingState).toBe("code-default");
    const input = inputWithValue("Default desc");
    expect(input).toBeDefined();

    // Mutate the workspace file underneath the mounted Inspector so `desc` no
    // longer has a static string literal default (`desc = fallbackDesc`),
    // forcing `handleCodeComponentPropsChange` into the unprovable-default path.
    const nonLiteralHero = heroSource.replace(
      'export default function Hero({ title = "Default title", desc = "Default desc" })',
      'const fallbackDesc = "Default desc";\nexport default function Hero({ title = "Default title", desc = fallbackDesc })',
    );
    useThemeWorkspaceStore.getState().updateLocalContent(
      HERO,
      nonLiteralHero,
      {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      },
    );

    fireEvent.input(input!, { target: { value: "Attempted fallback edit" } });
    fireEvent.blur(input!);
    await wait(1800);
    expect(savedFiles).toEqual([]);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("a spread plus an explicit title keeps the section: the literal is not writable, the spread field is", async () => {
    const literal = await select(SPREAD_AND_TITLE, "h1");
    // The section is proven, but the literal that overrides title is not a CMS
    // field and must not be written.
    expect(literal.report.sectionId).toBe("hero");
    expect(literal.report.bindingState).toBe("not-cms");
    expect(inputWithValue("Code title")).toBeUndefined();
    await editIfOffered("Code title", "Leaked title");
    expect(savedFiles).toEqual([]);
    expect(updateSectionProps).not.toHaveBeenCalled();
    cleanup();

    const spread = await select(SPREAD_AND_TITLE, "p");
    expect(spread.report.sectionId).toBe("hero");
    expect(spread.report.bindingState).toBe("cms-field");
    expect(await editIfOffered("Stored desc", "Edited desc")).toBe(true);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(updateSectionProps.mock.calls[0]![0].data).toMatchObject({
      sectionId: "hero",
      props: { desc: "Edited desc" },
    });
    expect(savedFiles).toEqual([]);
  });
});

describe("the inline-edit refusal names only a field that can be used", () => {
  it("for a CMS field it points to a field the Inspector actually offers", async () => {
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    const { report } = await select(EXPLICIT, "h1");
    expect(report.bindingState).toBe("cms-field");
    expect(
      inputWithValue("Stored title"),
      "the Inspector must offer the field the message points to",
    ).toBeDefined();

    fromPreview({
      type: "morph:storefront-preview-inline-text-refused",
      sectionId: report.sectionId,
      fieldPath: "title",
    });
    const messages = info.mock.calls.map((call) => String(call[0]));
    expect(messages).toContain(INLINE_TEXT_REFUSED_MESSAGE);
    expect(messages.join("\n")).not.toMatch(/controlled by code/i);
  });

  it("for a default the Inspector edits, it still points to the right-hand field", async () => {
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    const { report } = await select(BARE, "h1");
    fromPreview({
      type: "morph:storefront-preview-inline-text-refused",
      sectionId: report.sectionId,
      fieldPath: "title",
    });
    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_REFUSED_MESSAGE,
      expect.anything(),
    );
  });

  it("for a Document field it is unchanged", async () => {
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    await select(SPREAD, "h1");
    fromPreview({
      type: "morph:storefront-preview-inline-text-refused",
      sectionId: "hero",
      fieldPath: "title",
    });
    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_REFUSED_MESSAGE,
      expect.anything(),
    );
  });
});
