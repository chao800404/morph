import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
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
import { createInlineTextEditor } from "@/lib/storefront/editor/inline-text-editor";
import {
  answerLatestRouteRequest,
  createLiveFrame,
  sendFrameReady,
} from "@/lib/test-utils/preview-frame-handshake";
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

function dispatchFromFrame(data: Record<string, unknown>) {
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

/**
 * The frame comes up as a live one does before it sends anything else: it
 * says it is ready, reports its structure naming the page it is on, and
 * answers the route request that ready brought, with the request's own id
 * (`preview-frame-handshake.ts`). Since #270 the editor takes a selection or
 * a canvas commit only from a frame that has named the editor's page in this
 * ready round; these tests are about what the editor posts once it does.
 */
const FRAME = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION } as const;
const liveFrame = createLiveFrame(FRAME);
const framesUp = new WeakSet<Window>();
function bringFrameUp() {
  const frame = document.querySelector("iframe")?.contentWindow;
  if (!frame || framesUp.has(frame)) return;
  framesUp.add(frame);
  sendFrameReady(FRAME);
  liveFrame.up();
  answerLatestRouteRequest(FRAME);
}

function fromPreview(data: Record<string, unknown>) {
  bringFrameUp();
  dispatchFromFrame(data);
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
  // Up before the report is built: a live frame stamps it with the revisions
  // the editor has told it, its ready's file sync included.
  bringFrameUp();
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

  it("T6b: Discard mine after another tab hid the section posts it hidden, with no values", async () => {
    const rows = (...titles: string[]) =>
      titles.map((title) => ({ id: title.toLowerCase(), title }));
    const listContext = (
      items: ReturnType<typeof rows>,
      draftGeneration: number,
      enabled = true,
    ) =>
      contextOf(
        {
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              enabled,
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
    // The document as the other writer left it at the conflict.
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
    act(() => {
      screen.getByRole("button", { name: "Load latest, keep mine" }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Discard mine…" })).toBeTruthy(),
    );

    // Between the conflict and the discard, another tab hides the section:
    // the read the discard makes is the first to bring that version.
    getThemeEditor.mockResolvedValue({
      success: true,
      message: "ok",
      data: listContext(rows("C", "A", "B"), 8, false),
    });

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
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    // The preview is told the version the discard leaves: hidden, and none
    // of the older copy's values on the way.
    const afterDiscard = heroPosts(beforeDiscard);
    expect(afterDiscard.filter((message) => message.enabled === true)).toEqual([]);
    expect(valuePosts(beforeDiscard)).toEqual([]);
    expect(afterDiscard.at(-1)).toMatchObject({ enabled: false });
    expect(frameAfter(heroPosts()).slots).not.toHaveProperty("hero");
  });
});

/**
 * The canvas end of an inline edit, as the preview page runs it.
 *
 * The real inline editor (`createInlineTextEditor`, the one the bridge runs)
 * on a heading React renders from the frame's content object, which is
 * driven by the editor's real posts through the real `updatePreviewContent`
 * (`frameAfter`). A hidden slot renders nothing, as the starter Theme's
 * `isSectionHidden` does, and the heading falls back to the Hero's own
 * default. The bridge's two hooks are kept as they are: the edit's messages
 * go to the editor as the page sends them, and a render that took the edited
 * element away ends the edit unsaved (`structureObserver`).
 *
 * The frame does not guard a slot being typed into: a section post merges
 * into the slot and the page renders again. Typed text survives only because
 * React leaves a text node alone when the value it renders is unchanged.
 */
function canvasPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let content = frameAfter([], { slots: {}, hiddenSlots: ["hero"] });
  const Page = ({ slots, hiddenSlots }: typeof content) =>
    hiddenSlots.includes("hero") ? null : (
      <section data-storefront-section-id="hero">
        <h1>
          {((slots.hero as Record<string, unknown> | undefined)?.heading as
            | string
            | undefined) ?? "Welcome"}
        </h1>
      </section>
    );
  const editor = createInlineTextEditor({
    onCommit: (commit) =>
      fromPreview({ type: "morph:storefront-preview-commit-inline-text", ...commit }),
    onEditingChange: (editing) =>
      fromPreview({ type: "morph:storefront-preview-inline-text-editing", editing }),
    onLayoutChanged: () => {},
    storedValue: (target) =>
      target.sectionId && target.fieldPath
        ? (content.slots[target.sectionId] as Record<string, unknown> | undefined)?.[
            target.fieldPath
          ]
        : undefined,
  });
  return {
    editor,
    heading: () => container.querySelector("h1"),
    /** The page as the editor's posts so far leave it. */
    render() {
      content = frameAfter(heroPosts(), { slots: {}, hiddenSlots: ["hero"] });
      act(() => root.render(<Page {...content} />));
      if (editor.editingElement()?.isConnected === false) editor.finish(false);
      return content;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Selects the heading from the structure panel, as T6 selects its row. */
async function selectHeadingRow() {
  fromPreview({
    type: "morph:storefront-preview-structure",
    nodes: [
      {
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
      },
    ],
  });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
  await flushFrames();
}

describe("text typed on the canvas while a show is answered", () => {
  it("keeps the un-blurred text through the show's acknowledgement, stores it on blur, and the editor and frame agree", async () => {
    const STORED = "Stored heading";
    const TYPED = "Typed on the canvas";
    serverHolding(false);
    // Stored differs from the Hero's default, so a post that took the stored
    // value away would show on the canvas too.
    server.sections[0]!.props.heading = STORED;
    holdWrites = true;
    const shell = renderShell();
    await flushFrames();
    const page = canvasPage();
    try {
      // The show: posted at once with the composed props, its write held.
      fireEvent.click(showButton());
      await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
      expect(writes()[0]).toEqual({ enabled: true });
      page.render();
      expect(page.heading()?.textContent).toBe(STORED);

      // Before the show is answered, the author double-clicks the heading
      // and types; nothing is blurred, committed or pending.
      await selectHeadingRow();
      const heading = page.heading()!;
      const section = heading.closest("section") as HTMLElement;
      expect(
        page.editor.begin(
          {
            element: heading,
            kind: "heading",
            section,
            sectionId: "hero",
            fieldKey: "heading",
            fieldPath: "heading",
            descendantFields: [],
          },
          { selectionEnabled: true },
        ),
      ).toBe(true);
      (heading.firstChild as Text).data = TYPED;
      heading.dispatchEvent(new Event("input", { bubbles: true }));
      expect(heading.textContent).toBe(TYPED);

      // The acknowledgement: the reconcile composes the section's truth.
      // C5 changed what this step asserts. It used to require that the
      // reconcile reached the frame while the edit was open (and then that
      // the edit survived it, because its values matched what React
      // rendered). Since C5, no canvas post reaches the frame while an
      // inline edit is open: the reconcile is held, and sent when the edit
      // ends. So the precondition is now that it was composed and held —
      // shown below by the post after blur carrying its `enabled: true` —
      // and the survival check is stronger: nothing reached the frame.
      const beforeAck = posted.length;
      await releaseWrites();
      await flushFrames();
      expect(heroPosts(beforeAck)).toEqual([]);

      // Not lost: the edit is still open on the same element, and the typed
      // text is still there.
      const during = page.render();
      expect(during.hiddenSlots).toEqual([]);
      expect(page.heading()).toBe(heading);
      expect(page.editor.editingElement()).toBe(heading);
      expect(heading.textContent).toBe(TYPED);
      // The editor did not end the edit or leave select mode either.
      expect(
        posted
          .slice(beforeAck)
          .filter(
            (m) =>
              m.type === "morph:storefront-preview-finish-inline-text" ||
              (m.type === "morph:storefront-preview-set-selection-mode" &&
                m.enabled === false),
          ),
      ).toEqual([]);

      // Blur: the page commits the typed text and closes the edit.
      const info = vi.spyOn(toast, "info").mockImplementation(() => "");
      heading.dispatchEvent(new FocusEvent("blur"));
      expect(page.editor.editingElement()).toBeNull();
      // What the edit held goes now, in one post for the section the commit
      // landed on: shown, as the held reconcile said, with what the editor
      // holds — the typed text on the stored copy — and nothing reset.
      const released = heroPosts(beforeAck);
      expect(released).toHaveLength(1);
      expect(released[0]).toMatchObject({
        enabled: true,
        props: { heading: TYPED },
      });
      expect(released[0]?.resetKeys).toBeUndefined();
      await waitFor(
        () => expect(updateSectionProps).toHaveBeenCalledTimes(2),
        { timeout: 3_000 },
      );
      expect(writes()[1]).toEqual({ heading: TYPED });
      expect(
        info.mock.calls.filter(
          (call) => (call[1] as { id?: string } | undefined)?.id === "inline-text-refused",
        ),
      ).toEqual([]);
      await flushFrames();

      // Stored, and the editor, the frame and the canvas agree on it.
      expect(server.sections[0]).toMatchObject({
        enabled: true,
        props: { ...STORED_PROPS, heading: TYPED },
      });
      const after = page.render();
      expect(after.hiddenSlots).toEqual([]);
      expect((after.slots.hero as Record<string, unknown>).heading).toBe(TYPED);
      expect(page.heading()?.textContent).toBe(TYPED);
      shell.reread();
      expect(await openHeadingField(TYPED)).toBeTruthy();
    } finally {
      page.unmount();
    }
  });
});
