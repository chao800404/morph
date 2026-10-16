import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { themePreviewContentModuleSource } from "@/lib/storefront/compiler/theme-preview-content";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { signThemePreviewMedia } from "@/server/storefront/storefront-preview-media.serverFn";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * A hidden section's stored values never reach the preview page from the
 * editor's own posts (design v2, phase 1).
 *
 * The editor holds a section's visibility V(S) in the refs it already keeps
 * (the accepted copy, the pending and the unanswered entries). Every section
 * post goes through one poster, `postPreviewSectionProps`, which at the
 * moment it posts sends a hidden section as `{ enabled: false }` and nothing
 * else (R1); the selection-field post sends nothing for one (R1, P11). What is
 * saved is not touched: the save payload, the accepted copy and the Document
 * keep every value.
 *
 * The harness plays the preview through `postEditorToPreviewMessage`, and the
 * server through a small in-memory document the content write merges into
 * (`enabled` to the section itself, as the real one does), so the Document a
 * read would return can be asserted on.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const HERO_PATH = "src/components/Hero.tsx";
const SECTION_PROPS = "morph:storefront-preview-update-section-props";
const SELECTION_FIELD = "morph:storefront-preview-update-selection-field";
const ASSET = "0b9f3a52-2f7e-4c1a-9d4b-6a1f2e3d4c5b";
const SIGNED_URL = "https://media.morph.test/signed-hero.png";
const STORED_IMAGE = {
  source: "asset",
  mediaType: "image",
  assetId: ASSET,
  url: `/assets/${ASSET}.png`,
  name: "hero.png",
};
const STORED_PROPS = {
  heading: "Welcome",
  subheading: "Summary",
  image: STORED_IMAGE,
};
const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

const posted: Array<Record<string, unknown>> = [];
const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());
const promoteText = vi.hoisted(() => vi.fn());

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    getStorefrontThemeEditor: getThemeEditor,
    promoteStorefrontThemeText: promoteText,
  }),
);
vi.mock(
  "@/server/storefront/storefront-preview-media.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    signThemePreviewMedia: vi.fn(),
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
// The real panel, with the promotion the Inspector offers for fixed text
// reachable by one button (as in `visual-editor-shell-round-trip.test.tsx`).
vi.mock("./editor-assistant-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-assistant-panel")>();
  const RealPanel = actual.EditorAssistantPanel;
  return {
    ...actual,
    EditorAssistantPanel: (props: ComponentProps<typeof RealPanel>) => (
      <>
        <RealPanel {...props} />
        <button
          type="button"
          onClick={() =>
            void props.onPromoteText?.({
              sectionId: "hero",
              componentSourcePath: HERO_PATH,
              targetKey: "heading",
              fieldName: "heading",
              value: "Welcome",
            })
          }
        >
          Promote the selected text
        </button>
      </>
    ),
  };
});

const source = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  subheading: { type: "text", label: "Subheading" },
  image: { type: "image", label: "Image" }
};
export function Hero({ heading = "Welcome", subheading = "Summary", image }) {
  return <section><h1 data-morph-node="heading">{heading}</h1><p>{subheading}</p>{image ? <img src={image.url} alt="" /> : null}</section>;
}`;

/** The document the server holds, which every content write merges into. */
type ServerSection = {
  id: string;
  type: string;
  enabled: boolean;
  props: Record<string, unknown>;
};
let server: { generation: number; sections: ServerSection[] };
const serverDocument = () => ({
  version: 1,
  sections: JSON.parse(JSON.stringify(server.sections)) as ServerSection[],
});
function contextOf(
  document = serverDocument(),
  draftGeneration = server.generation,
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
        document,
        draftGeneration,
        version: 1,
      },
    ],
  } as unknown as StorefrontThemeEditorDTO;
}
const serverHolding = (enabled: boolean) => {
  server = {
    generation: 1,
    sections: [
      { id: "hero", type: "hero", enabled, props: { ...STORED_PROPS } },
    ],
  };
};

/** Content writes wait here while `holdWrites` is set, answered in order. */
let holdWrites = false;
const heldWrites: Array<() => void> = [];
async function releaseWrites() {
  holdWrites = false;
  await act(async () => {
    for (const answer of heldWrites.splice(0)) answer();
    await Promise.resolve();
  });
}

/** Signing that answers only when told to, while `holdSigning` is set. */
let holdSigning = false;
const heldSignings: Array<() => void> = [];
async function releaseSigning() {
  holdSigning = false;
  await act(async () => {
    for (const answer of heldSignings.splice(0)) answer();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const search = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
  section: "hero",
} as StorefrontThemeEditorSearch;

function readyClient() {
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
    {
      files: [
        {
          id: "file-hero",
          storefrontId: "storefront-1",
          themeId: "theme-1",
          path: HERO_PATH,
          content: source,
          mimeType: "text/typescript",
          isEntry: false,
          version: 1,
          createdAt: "2026-10-17T00:00:00.000Z",
          updatedAt: "2026-10-17T00:00:00.000Z",
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
                { name: "Hero.tsx", path: HERO_PATH, isDirectory: false },
              ],
            },
          ],
        },
      ],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  return client;
}

/** The shell, and a way to hand it what a refetch of the server would bring. */
function renderShell() {
  const client = readyClient();
  let currentContext = contextOf();
  let currentSearch = search;
  const onSearchChange = vi.fn(
    (next: Partial<StorefrontThemeEditorSearch>) => {
      currentSearch = { ...currentSearch, ...next };
      if (!currentSearch.section) delete currentSearch.section;
      queueMicrotask(() => act(() => view.rerender(tree())));
    },
  );
  const tree = () => (
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={currentContext}
        search={currentSearch}
        onSearchChange={onSearchChange}
      />
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    client,
    /** The route above the shell reads the server again. */
    reread: () => {
      currentContext = contextOf();
      act(() => view.rerender(tree()));
    },
  };
}

function fromPreview(data: Record<string, unknown>) {
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION },
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
}

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

let canvasRevision = 0;
async function selectHeading() {
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
    sectionId: "hero",
    componentType: "hero",
    kind: "heading",
    nodeId: "hero:node:heading",
    sourceFilePath: HERO_PATH,
    sourceLocation: null,
    elementKey: "heading",
    fieldKey: "heading",
    field: "heading",
    fieldPath: "heading",
    descendantFields: [],
    tagName: "h1",
    role: null,
    inputType: null,
    styleRevision: Math.max(
      0,
      ...posted.map((m) =>
        typeof m.styleRevision === "number" ? m.styleRevision : 0,
      ),
    ),
    className: "",
    isSection: false,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
    selectionRevision: revision,
  });
  await flushFrames();
}

async function openHeadingField(value = "Welcome") {
  await selectHeading();
  fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
  return screen.findByDisplayValue(value);
}

const hideButton = () =>
  screen.getAllByRole("button", { name: "Hide section hero" })[0]!;
const showButton = () =>
  screen.getAllByRole("button", { name: "Show section hero" })[0]!;

type Posted = {
  type: string;
  sectionId?: string;
  props?: Record<string, unknown>;
  enabled?: boolean;
  resetKeys?: string[];
};
const heroPosts = (from = 0) =>
  (posted.slice(from) as Posted[]).filter(
    (message) =>
      message.type === SECTION_PROPS && message.sectionId === "hero",
  );
function lastIndexWhere<T>(items: readonly T[], test: (item: T) => boolean) {
  for (let at = items.length - 1; at >= 0; at -= 1) {
    if (test(items[at]!)) return at;
  }
  return -1;
}
/** Where the latest hide was posted, as an index into `posted`. */
const lastHideAt = () =>
  lastIndexWhere(
    posted,
    (message) =>
      message.type === SECTION_PROPS &&
      message.sectionId === "hero" &&
      message.enabled === false,
  );
const valuePosts = (from: number) =>
  heroPosts(from).filter(
    (message) => message.props !== undefined || message.enabled === true,
  );
const writes = () =>
  updateSectionProps.mock.calls.map(
    (call) => (call[0] as { data: { props: Record<string, unknown> } }).data.props,
  );
const imageSigned = (message: Posted | undefined) =>
  JSON.stringify(message?.props?.image ?? null).includes(SIGNED_URL);

/** The frame's content object, driven by the editor's posts in a given order. */
function frameAfter(messages: readonly Posted[], initial = { slots: {}, hiddenSlots: [] as string[] }) {
  const moduleSource = themePreviewContentModuleSource();
  const body = moduleSource
    .slice(
      moduleSource.indexOf("export function updatePreviewContent"),
      moduleSource.indexOf("// Below `updatePreviewContent`"),
    )
    .replace("export function updatePreviewContent", "function updatePreviewContent");
  const content = JSON.parse(JSON.stringify(initial)) as {
    slots: Record<string, unknown>;
    hiddenSlots: string[];
  };
  const update = new Function(
    "content",
    `${body}\nfunction currentPreviewContent() { return content; }\nreturn updatePreviewContent;`,
  )(content) as (...args: unknown[]) => void;
  for (const message of messages) {
    update(message.sectionId, message.props, message.enabled, message.resetKeys);
  }
  return content;
}

beforeEach(() => {
  posted.length = 0;
  canvasRevision = 0;
  holdWrites = false;
  heldWrites.length = 0;
  holdSigning = false;
  heldSignings.length = 0;
  serverHolding(true);
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(async (request: unknown) => {
    if (holdWrites) await new Promise<void>((resolve) => heldWrites.push(resolve));
    const { sectionId, props, resetProps } = (
      request as {
        data: {
          sectionId: string;
          props: Record<string, unknown>;
          resetProps?: string[];
        };
      }
    ).data;
    const section = server.sections.find((entry) => entry.id === sectionId)!;
    for (const [key, value] of Object.entries(props)) {
      if (key === "enabled") section.enabled = value as boolean;
      else section.props[key] = value;
    }
    for (const key of resetProps ?? []) delete section.props[key];
    server.generation += 1;
    return {
      success: true,
      data: {
        draftGeneration: server.generation,
        droppedProps: [],
        document: serverDocument(),
      },
    };
  });
  getThemeEditor.mockReset();
  getThemeEditor.mockImplementation(async () => ({
    success: true,
    message: "ok",
    data: contextOf(),
  }));
  promoteText.mockReset();
  vi.mocked(signThemePreviewMedia).mockReset();
  vi.mocked(signThemePreviewMedia).mockImplementation(async () => {
    if (holdSigning) {
      await new Promise<void>((resolve) => heldSignings.push(resolve));
    }
    return {
      success: true,
      data: {
        urls: { [ASSET]: SIGNED_URL },
        expiresAt: Date.now() + 86_400_000,
      },
    } as never;
  });
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
});

describe("an edit to a section that is being hidden", () => {
  it("T1/B1: posts no props, while the save carries the edit and the stored values stay", async () => {
    holdWrites = true;
    const shell = renderShell();
    const field = await openHeadingField();

    fireEvent.click(hideButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(writes()[0]).toEqual({ enabled: false });
    const hideAt = lastHideAt();
    expect(hideAt).toBeGreaterThanOrEqual(0);
    expect(posted[hideAt]).toMatchObject({ props: undefined, enabled: false });

    // The hide is not answered yet, so the field is still open.
    fireEvent.input(field, { target: { value: "Typed while hidden" } });
    fireEvent.blur(field);
    await flushFrames();

    // T1: the Inspector edit was posted, and stripped to the hide.
    const after = heroPosts(hideAt + 1);
    expect(after.length).toBeGreaterThan(0);
    for (const message of after) {
      expect(message).toEqual({
        type: SECTION_PROPS,
        sectionId: "hero",
        props: undefined,
        enabled: false,
      });
    }

    // B1: the save is not stripped. Once the hide is answered the edit goes,
    // with its value.
    await releaseWrites();
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(writes()[1]).toEqual({ heading: "Typed while hidden" });
    expect(server.sections[0]).toEqual({
      id: "hero",
      type: "hero",
      enabled: false,
      props: { ...STORED_PROPS, heading: "Typed while hidden" },
    });

    // The accepted copy still holds every stored value: showing the section
    // again composes them, the edit included.
    shell.reread();
    await flushFrames();
    const beforeShow = posted.length;
    fireEvent.click(showButton());
    const shown = heroPosts(beforeShow)[0];
    expect(shown?.enabled).toBe(true);
    expect(shown?.props).toMatchObject({
      heading: "Typed while hidden",
      subheading: "Summary",
    });
    // The stored image, as the preview is given library media: signed once
    // its address is known, the stored reference until then.
    const image = shown?.props?.image as { assetId?: string } | string;
    expect(
      image === SIGNED_URL ||
        (typeof image === "object" && image?.assetId === ASSET),
    ).toBe(true);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(3));
    expect(writes()[2]).toEqual({ enabled: true });
  });

  it("T5: the selection-field preview posts nothing for it, and the save path is unchanged", async () => {
    holdWrites = true;
    renderShell();
    const field = await openHeadingField();
    // Precondition: typing into the selected field previews it while shown.
    fireEvent.input(field, { target: { value: "Typed while shown" } });
    expect(
      posted.filter((message) => message.type === SELECTION_FIELD),
    ).toHaveLength(1);

    fireEvent.click(hideButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const hideAt = lastHideAt();
    fireEvent.input(field, { target: { value: "Typed while hidden" } });
    expect(
      posted
        .slice(hideAt + 1)
        .filter((message) => message.type === SELECTION_FIELD),
    ).toEqual([]);
    fireEvent.blur(field);
    await releaseWrites();
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(writes()[1]).toEqual({ heading: "Typed while hidden" });
  });
});

describe("showing a hidden section", () => {
  it("T3: posts the composed props with enabled true, in the same message", async () => {
    serverHolding(false);
    renderShell();
    await flushFrames();
    const before = posted.length;
    fireEvent.click(showButton());
    const [shown] = heroPosts(before);
    expect(shown).toMatchObject({ enabled: true });
    expect(shown?.props).toMatchObject({
      heading: "Welcome",
      subheading: "Summary",
    });
    // The canvas stays instant: posted before the write is answered.
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
  });

  it("B3: hide then show writes only enabled; the Document keeps its props", async () => {
    const shell = renderShell();
    await flushFrames();
    fireEvent.click(hideButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(server.sections[0]!.enabled).toBe(false));
    shell.reread();
    await flushFrames();
    fireEvent.click(showButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(server.sections[0]!.enabled).toBe(true));
    expect(writes()).toEqual([{ enabled: false }, { enabled: true }]);
    expect(server.sections[0]!.props).toEqual(STORED_PROPS);
    // What a read now returns.
    const read = await getThemeEditor();
    expect(read.data.templates[0].document.sections[0]).toEqual({
      id: "hero",
      type: "hero",
      enabled: true,
      props: STORED_PROPS,
    });
  });
});

describe("a late post after a hide", () => {
  it("T4/(a)/(e): a show's delayed signed post never carries values after the hide, in any order the frame gets it", async () => {
    serverHolding(false);
    holdSigning = true;
    const shell = renderShell();
    await flushFrames();
    fireEvent.click(showButton());
    // Precondition: the show carried values, and its image is being signed.
    const [shown] = heroPosts();
    expect(shown?.props).toMatchObject({ heading: "Welcome" });
    expect(imageSigned(shown)).toBe(false);
    await waitFor(() => expect(signThemePreviewMedia).toHaveBeenCalled());
    await waitFor(() => expect(server.sections[0]!.enabled).toBe(true));
    shell.reread();
    await flushFrames();

    fireEvent.click(hideButton());
    const hideAt = lastHideAt();
    expect(hideAt).toBeGreaterThan(posted.indexOf(shown as never));
    await releaseSigning();
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    await flushFrames();

    // (e) Editor side: nothing that carries values after the hide.
    expect(valuePosts(hideAt + 1)).toEqual([]);

    // (e) Frame side: the editor's posts in the order sent leave nothing.
    const sent = heroPosts();
    expect(frameAfter(sent).slots).toEqual({});
    expect(frameAfter(sent).hiddenSlots).toEqual(["hero"]);
    // The post R1 and R2 kept back — the show's values, signed, with no
    // `enabled` — arriving anyway, at every place after the hide, writes
    // nothing either.
    const late: Posted = {
      type: SECTION_PROPS,
      sectionId: "hero",
      props: { ...shown!.props, image: { ...STORED_IMAGE, url: SIGNED_URL } },
    };
    const hideInSent = lastIndexWhere(sent, (message) => message.enabled === false);
    for (let at = hideInSent + 1; at <= sent.length; at += 1) {
      const content = frameAfter([...sent.slice(0, at), late, ...sent.slice(at)]);
      expect(content.slots).toEqual({});
      expect(content.hiddenSlots).toEqual(["hero"]);
    }
  });

  it("(c): a promotion that started before the hide and posts after its await is stripped", async () => {
    let answerPromotion!: (value: unknown) => void;
    promoteText.mockImplementation(
      () =>
        new Promise((resolve) => {
          answerPromotion = resolve;
        }),
    );
    renderShell();
    await openHeadingField();
    fireEvent.click(
      screen.getByRole("button", { name: "Promote the selected text" }),
    );
    await waitFor(() => expect(promoteText).toHaveBeenCalledTimes(1));

    fireEvent.click(hideButton());
    const hideAt = lastHideAt();
    expect(hideAt).toBeGreaterThanOrEqual(0);
    await act(async () => {
      answerPromotion({
        success: true,
        data: {
          fieldName: "heading",
          sourceGeneration: 2,
          draftGeneration: 2,
          file: {
            path: HERO_PATH,
            content: source,
            version: 2,
            updatedAt: "2026-10-17T00:00:01.000Z",
          },
          document: {
            version: 1,
            sections: [
              { id: "hero", type: "hero", enabled: true, props: STORED_PROPS },
            ],
          },
        },
      });
    });
    await flushFrames();
    // Precondition: the promotion posted its section after the hide.
    expect(heroPosts(hideAt + 1).length).toBeGreaterThan(0);
    expect(valuePosts(hideAt + 1)).toEqual([]);
  });

  it("(f): a show answered after the author hid again posts no second show", async () => {
    serverHolding(false);
    holdWrites = true;
    const shell = renderShell();
    await flushFrames();
    fireEvent.click(showButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    // The panel reads the section shown (another read brought it), and the
    // author hides it again before the show is answered.
    server.sections[0]!.enabled = true;
    shell.reread();
    server.sections[0]!.enabled = false;
    await flushFrames();
    fireEvent.click(hideButton());
    const hideAt = lastHideAt();
    expect(hideAt).toBeGreaterThan(0);

    await releaseWrites();
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    await releaseWrites();
    await flushFrames();
    expect(writes()).toEqual([{ enabled: true }, { enabled: false }]);
    expect(valuePosts(hideAt + 1)).toEqual([]);
  });
});

describe("a refused hide the author discards", () => {
  it("T6: Discard mine posts the section shown again, with the latest version's values", async () => {
    const rows = (...titles: string[]) =>
      titles.map((title) => ({ id: title.toLowerCase(), title }));
    const listContext = (
      items: ReturnType<typeof rows>,
      draftGeneration: number,
    ) =>
      contextOf(
        {
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              enabled: true,
              props: { heading: "Welcome", items },
            },
          ],
        },
        draftGeneration,
      );
    updateSectionProps.mockReset();
    updateSectionProps.mockResolvedValue({
      success: false,
      message: "Template draft was modified concurrently.",
      error: "TEMPLATE_DRAFT_CONFLICT",
    } as never);
    // The document as the other writer left it: a row added in front.
    const remote = {
      success: true,
      message: "ok",
      data: listContext(rows("C", "A", "B"), 7),
    };
    getThemeEditor.mockReset();
    getThemeEditor.mockResolvedValue(remote);
    const client = readyClient();
    client.setQueryData(
      storefrontThemeQueries.detail("storefront-1", "theme-1").queryKey,
      remote as never,
    );
    render(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={listContext(rows("A", "B"), 1)}
          search={{
            template: "index",
            templateId: "template-1",
            viewport: "desktop",
          } as StorefrontThemeEditorSearch}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    // The author edits B's title on the canvas, then hides the section.
    fromPreview({
      type: "morph:storefront-preview-structure",
      nodes: [
        {
          id: "hero:node:row-title",
          parentId: null,
          sectionId: "hero",
          label: "Title",
          kind: "heading",
          tagName: "h1",
          target: {
            sectionId: "hero",
            nodeId: "hero:node:row-title",
            fieldKey: "title",
            fieldPath: "items.1.title",
            itemId: "b",
            isSection: false,
          },
        },
      ],
    });
    const row = await screen.findByText("h1");
    act(() => {
      row.closest("button")?.click();
    });
    fromPreview({
      type: "morph:storefront-preview-commit-inline-text",
      sectionId: "hero",
      fieldKey: "title",
      fieldPath: "items.1.title",
      value: "B edited",
      originalValue: "B",
    });
    fireEvent.click(hideButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(writes()[0]).toMatchObject({ enabled: false });
    expect(writes()[0]).toHaveProperty("items");
    const hideAt = lastHideAt();
    expect(hideAt).toBeGreaterThanOrEqual(0);

    // Refused: the hide stays pending, so nothing shows the section yet.
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Discard mine…" })).toBeTruthy(),
    );
    expect(valuePosts(hideAt + 1)).toEqual([]);

    const beforeDiscard = posted.length;
    act(() => {
      screen.getByRole("button", { name: "Discard mine…" }).click();
    });
    act(() => {
      screen.getByRole("button", { name: "Discard and load latest" }).click();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Discard mine…" })).toBeNull(),
    );
    // Nothing was written, and the preview was told the section is shown,
    // with the version the editor now holds.
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    const reconciled = heroPosts(beforeDiscard).at(-1);
    expect(reconciled?.enabled).toBe(true);
    expect(
      (reconciled?.props?.items as Array<{ title: string }> | undefined)?.map(
        (item) => item.title,
      ),
    ).toEqual(["C", "A", "B"]);
  });
});
