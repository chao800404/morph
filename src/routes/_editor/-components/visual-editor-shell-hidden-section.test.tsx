import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { EditorStyleInspector } from "./editor-style-inspector";
import {
  HISTORY_NEWER_EDIT_MESSAGE,
  HISTORY_RUN_PENDING_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";
import {
  createLiveFrame,
  frameEnvelope,
} from "@/lib/test-utils/preview-frame-handshake";

/**
 * A hidden section is not selectable (content binding contract §6), and that
 * includes the selection the author already had when they hid it.
 *
 * The editor lets that selection go only once the hide is confirmed: when the
 * stored document — the one the Sections panel reads its Show/Hide control
 * from — holds the section as hidden. The canvas hides at once, but a hide the
 * server refused, or never answered, never reaches the stored document, so the
 * selection stays. The harness plays the route above the shell by handing it
 * the document a refetch would bring.
 *
 * Same harness as `visual-editor-shell-round-trip.test.tsx`: the preview is
 * observed through `postEditorToPreviewMessage`, and messages from it are real
 * `message` events on `window`.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
/** The frame comes up and names its page, as a live one does. */
const liveFrame = createLiveFrame({
  origin: PREVIEW_ORIGIN,
  session: PREVIEW_SESSION,
});
const HERO_PATH = "src/components/Hero.tsx";

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
};
export function Hero({ heading = "Welcome", imageSrc = "/hero.png" }) {
  return <section><h1 data-morph-node="heading" className="text-4xl">{heading}</h1><img data-morph-node="image" src={imageSrc} className="object-cover" /></section>;
}`;

const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

/** The editor's context with the stored sections given. */
function contextWith(
  sections: Array<{ id: string; enabled: boolean; heading: string }>,
  draftGeneration = 1,
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
        document: {
          version: 1,
          sections: sections.map(({ id, enabled, heading }) => ({
            id,
            type: "hero",
            enabled,
            props: { heading },
          })),
        },
        draftGeneration,
        version: 1,
      },
    ],
  } as unknown as StorefrontThemeEditorDTO;
}

const SHOWN = contextWith([{ id: "hero", enabled: true, heading: "Welcome" }]);
const HIDDEN = contextWith([
  { id: "hero", enabled: false, heading: "Welcome" },
]);

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

/**
 * The shell, and a way to hand it the document a refetch would bring. The
 * search is applied the way the route applies it, so the Inspector reads the
 * section the URL names as it would in the editor.
 */
function renderShell(initial: StorefrontThemeEditorDTO = SHOWN) {
  const client = readyClient();
  let currentContext = initial;
  let currentSearch = search;
  const onSearchChange = vi.fn((next: Partial<StorefrontThemeEditorSearch>) => {
    currentSearch = { ...currentSearch, ...next };
    if (!currentSearch.section) delete currentSearch.section;
    queueMicrotask(() => act(() => view.rerender(tree())));
  });
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
  liveFrame.ready();
  return {
    onSearchChange,
    storedAs: (context: StorefrontThemeEditorDTO) => {
      currentContext = context;
      act(() => view.rerender(tree()));
    },
  };
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

/** The canvas reporting a click on a section's heading. */
async function selectHeadingOf(sectionId: string) {
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
    kind: "heading",
    nodeId: `${sectionId}:node:heading`,
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

async function openHeadingField(sectionId = "hero", value = "Welcome") {
  await selectHeadingOf(sectionId);
  fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
  return screen.findByDisplayValue(value);
}

async function waitForPresentationReady() {
  await waitFor(() => {
    expect(
      screen.queryByText("Preview syncing. Content writes are paused."),
    ).toBeNull();
    expect(
      screen.queryByText(
        "Preview syncing. Content writes are paused until every section confirms its current preview was applied.",
      ),
    ).toBeNull();
  });
}

const hideButton = () =>
  screen.getAllByRole("button", { name: "Hide section hero" })[0]!;

const request = (index: number) =>
  updateSectionProps.mock.calls[index]![0].data as {
    sectionId: string;
    props: Record<string, unknown>;
    expectedSourceGeneration: number;
  };

const saved = { success: true, data: { draftGeneration: 2, droppedProps: [] } };

beforeEach(() => {
  posted.length = 0;
  canvasRevision = 0;
  updateSectionProps.mockReset();
  getThemeEditor.mockReset();
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
});

describe("a hidden section's selection", () => {
  it("is let go once the hide is confirmed, and the old Inspector sends nothing more", async () => {
    updateSectionProps.mockResolvedValue(saved);
    const shell = renderShell();
    await openHeadingField();

    fireEvent.click(hideButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(request(0).sectionId).toBe("hero");
    expect(request(0).props).toEqual({ enabled: false });
    // Saved, but not yet in the document this editor holds: not confirmed.
    expect(screen.getByDisplayValue("Welcome")).toBeTruthy();

    shell.storedAs(HIDDEN);
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Welcome")).toBeNull(),
    );
    expect(shell.onSearchChange).toHaveBeenCalledWith({ section: "" });

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("keeps what was typed: it goes with the hide, and nothing is sent after", async () => {
    updateSectionProps.mockResolvedValue(saved);
    const shell = renderShell();
    const field = await openHeadingField();
    // Typed, and left the way a click on the Hide control leaves it.
    fireEvent.input(field, { target: { value: "Typed before hiding" } });
    fireEvent.blur(field);
    await waitForPresentationReady();

    fireEvent.click(hideButton());
    await waitFor(() =>
      expect(
        updateSectionProps.mock.calls.some(
          (_, index) => request(index).props.enabled === false,
        ),
      ).toBe(true),
    );
    const sent = updateSectionProps.mock.calls.map((_, index) =>
      request(index),
    );
    expect(sent.map((entry) => entry.props.heading)).toContain(
      "Typed before hiding",
    );
    const sentBeforeConfirm = sent.length;

    shell.storedAs(
      contextWith([
        { id: "hero", enabled: false, heading: "Typed before hiding" },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Typed before hiding")).toBeNull(),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(updateSectionProps).toHaveBeenCalledTimes(sentBeforeConfirm);
  });

  it("stays when the server refuses the hide", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockResolvedValue({
      success: false,
      error: "TEMPLATE_DRAFT_CONFLICT",
      message: "Template draft was modified concurrently.",
    });
    const shell = renderShell();
    await openHeadingField();

    fireEvent.click(hideButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    // What the editor holds is what a refetch brings: still shown.
    shell.storedAs(SHOWN);
    await flushFrames();
    expect(screen.getByDisplayValue("Welcome")).toBeTruthy();
    expect(shell.onSearchChange).not.toHaveBeenCalledWith({ section: "" });
  });

  it("stays when the hide gets no answer, and the hide is not sent again by itself", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    updateSectionProps.mockRejectedValue(new Error("offline"));
    const shell = renderShell();
    await openHeadingField();

    fireEvent.click(hideButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    shell.storedAs(SHOWN);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("Welcome")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("leaves another section's selection alone", async () => {
    updateSectionProps.mockResolvedValue(saved);
    const both = (promoEnabled: boolean) =>
      contextWith([
        { id: "hero", enabled: true, heading: "Welcome" },
        { id: "promo", enabled: promoEnabled, heading: "Promo" },
      ]);
    const shell = renderShell(both(true));
    await openHeadingField();
    // The heading itself is selected, not only its section.
    expect(
      screen.getByRole("heading", { level: 4, name: "heading" }),
    ).toBeTruthy();

    shell.storedAs(both(false));
    await flushFrames();
    expect(screen.getByDisplayValue("Welcome")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 4, name: "heading" }),
    ).toBeTruthy();
    expect(shell.onSearchChange).not.toHaveBeenCalledWith({ section: "" });
  });

  it("is not given back when the section is shown again; a fresh selection works", async () => {
    // The generations as the server moves them: this tab's hide is 2, and
    // the section shown again is read back at 3.
    const hiddenAt2 = contextWith(
      [{ id: "hero", enabled: false, heading: "Welcome" }],
      2,
    );
    const shownAt3 = contextWith(
      [{ id: "hero", enabled: true, heading: "Welcome" }],
      3,
    );
    updateSectionProps
      .mockResolvedValueOnce({
        success: true,
        data: {
          draftGeneration: 2,
          droppedProps: [],
          document: hiddenAt2.templates[0]!.document,
        },
      })
      .mockResolvedValue(saved);
    const shell = renderShell();
    await openHeadingField();
    fireEvent.click(hideButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    shell.storedAs(hiddenAt2);
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Welcome")).toBeNull(),
    );

    shell.storedAs(shownAt3);
    await flushFrames();
    expect(screen.queryByDisplayValue("Welcome")).toBeNull();

    const field = await openHeadingField();
    fireEvent.input(field, { target: { value: "After showing" } });
    fireEvent.blur(field);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(request(1).props).toEqual({ heading: "After showing" });
    // The fresh selection's own baseline, not one borrowed from elsewhere.
    expect(request(1).expectedSourceGeneration).toBe(1);
  });
});

/**
 * The other entries into a section: its Sections-panel row, and a URL that
 * names it. A hidden one opens no content editing from either, read from the
 * same stored document; a shown one opens as before.
 */
describe("a hidden section's other entries", () => {
  const selectRow = async () => {
    await flushFrames();
    fireEvent.click(screen.getAllByTitle("Select hero; drag to reorder")[0]!);
    await flushFrames();
  };
  const openContentTab = async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await flushFrames();
  };
  /** Types into the field if one is offered, as an author would. */
  const tryToEdit = async () => {
    const field = screen.queryByDisplayValue("Welcome");
    if (!field) return false;
    fireEvent.input(field, { target: { value: "Edited while hidden" } });
    fireEvent.blur(field);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    return true;
  };

  it("a Sections-row click opens no content field, keeps the Show control, and sends nothing", async () => {
    updateSectionProps.mockResolvedValue(saved);
    renderShell(HIDDEN);
    await selectRow();
    await openContentTab();
    expect(
      screen.getByRole("button", { name: "Show section hero" }),
    ).toBeTruthy();
    expect(screen.queryByDisplayValue("Welcome")).toBeNull();
    expect(await tryToEdit()).toBe(false);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("a URL naming it offers no content field, and nothing is sent", async () => {
    updateSectionProps.mockResolvedValue(saved);
    renderShell(HIDDEN);
    await flushFrames();
    await openContentTab();
    expect(screen.queryByDisplayValue("Welcome")).toBeNull();
    expect(await tryToEdit()).toBe(false);
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("a shown section opens from its row as before, and its edit is saved", async () => {
    updateSectionProps.mockResolvedValue(saved);
    renderShell(SHOWN);
    await selectRow();
    await openContentTab();
    expect(await screen.findByDisplayValue("Welcome")).toBeTruthy();
    expect(await tryToEdit()).toBe(true);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(request(0).props).toEqual({ heading: "Edited while hidden" });
  });
});

/**
 * Document-backed style controls. Most of the Styles tab patches the source,
 * which stays open on a hidden section. Two kinds of control write the
 * Document instead: every control of a section with no component file, and
 * the image's object position. On a hidden section they are shown disabled,
 * through the `disabled` they already take, and send nothing.
 */
describe("a hidden section's Document-backed style controls", () => {
  const openStyles = async () => {
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: /^Styles$/ }));
    await flushFrames();
  };
  const pickObjectPosition = async (label: string) => {
    const trigger = screen.getByRole("combobox", { name: "Object position" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    await flushFrames();
    const option = screen.queryByRole("option", { name: label });
    if (option) {
      fireEvent.keyDown(option, { key: "Enter" });
      fireEvent.click(option);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  };

  it("a hidden section row has no image target; another section's unsaved edit stays", async () => {
    vi.spyOn(toast, "error").mockImplementation(() => "");
    // Another section's edit that got no answer: kept, waiting on Try again.
    updateSectionProps.mockRejectedValue(new Error("offline"));
    renderShell(
      contextWith([
        { id: "hero", enabled: false, heading: "Welcome" },
        { id: "promo", enabled: true, heading: "Promo" },
      ]),
    );
    const field = await openHeadingField("promo", "Promo");
    fireEvent.input(field, { target: { value: "Kept elsewhere" } });
    fireEvent.blur(field);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy(),
    );

    await flushFrames();
    fireEvent.click(screen.getAllByTitle("Select hero; drag to reorder")[0]!);
    await flushFrames();
    await openStyles();
    expect(
      screen.queryByRole("combobox", { name: "Object position" }),
    ).toBeNull();
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  // The Inspector on its own, at the boundary every Document write from it
  // crosses (`onPropsChange`), with an image whose position is provably the
  // declared `imagePosition` field: the only kind of image the control writes.
  const positionSource = `export const contentFields = {
  image: { type: "image", label: "Image" },
  imagePosition: { type: "text", label: "Image position", maxLength: 100 },
};
export default function Hero({ image, imagePosition = "center" }) {
  return <section><img src={image?.src} style={{ objectPosition: imagePosition }} className="object-cover" /></section>;
}`;
  const positionImageLine = positionSource
    .split("\n")
    .findIndex((line) => line.includes("<img"));
  const positionImageLocation = `${HERO_PATH}:${positionImageLine + 1}:${
    positionSource.split("\n")[positionImageLine]!.indexOf("<img") + 1
  }`;
  it.each([
    { refused: true, writes: 0 },
    { refused: false, writes: 1 },
  ])(
    "the Inspector's image position with Document writes refused: $refused",
    async ({ refused, writes }) => {
      const onPropsChange = vi.fn();
      render(
        <EditorStyleInspector
          view="styles"
          documentWritesRefused={refused}
          selectionSourceCurrent
          onPropsChange={onPropsChange}
          onUpdateThemeFileStyle={vi.fn()}
          section={{
            id: "hero",
            type: "hero",
            enabled: !refused,
            props: { image: { src: "/hero.png" }, imagePosition: "center" },
          }}
          themeFiles={[
            {
              id: "file-hero",
              storefrontId: "storefront-1",
              themeId: "theme-1",
              path: HERO_PATH,
              content: positionSource,
              mimeType: "text/typescript",
              isEntry: false,
              version: 1,
              createdAt: "2026-08-20T00:00:00.000Z",
              updatedAt: "2026-08-20T00:00:00.000Z",
            },
          ]}
          selection={
            {
              sectionId: "hero",
              componentType: "hero",
              kind: "image",
              sourceFilePath: HERO_PATH,
              sourceLocation: positionImageLocation,
              elementKey: null,
              fieldKey: "image",
              field: "image",
              fieldPath: "image",
              descendantFields: [],
              tagName: "img",
              className: "object-cover",
              isSection: false,
            } as never
          }
        />,
      );
      const trigger = screen.getByRole("combobox", { name: "Object position" });
      expect(trigger.hasAttribute("data-disabled")).toBe(refused);
      await pickObjectPosition("Top");
      expect(onPropsChange).toHaveBeenCalledTimes(writes);
      if (writes) {
        expect(onPropsChange.mock.calls[0]![0].imagePosition).toBe("top");
      } else {
        expect(trigger.textContent).toContain("Center");
      }
    },
  );

  it("Show on a hidden section's row works as before", async () => {
    updateSectionProps.mockResolvedValue(saved);
    renderShell(HIDDEN);
    await flushFrames();
    fireEvent.click(screen.getByRole("button", { name: "Show section hero" }));
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(request(0).props).toEqual({ enabled: true });
  });
});

/**
 * The class list, at the same boundary. A section with no component file
 * stores its classes in the Document; one with a file has them patched into
 * the source, which stays open while the section is hidden.
 */
describe("the Inspector's class list on a hidden section", () => {
  const heroFile = {
    id: "file-hero",
    storefrontId: "storefront-1",
    themeId: "theme-1",
    path: HERO_PATH,
    content: source,
    mimeType: "text/typescript",
    isEntry: false,
    version: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  function renderInspector(args: { refused: boolean; withFile: boolean }) {
    const onPropsChange = vi.fn();
    const onUpdateThemeFileStyle = vi.fn();
    render(
      <EditorStyleInspector
        view="styles"
        documentWritesRefused={args.refused}
        onPropsChange={onPropsChange}
        onUpdateThemeFileStyle={onUpdateThemeFileStyle}
        section={{
          id: args.withFile ? "hero" : "newsletter",
          type: args.withFile ? "hero" : "newsletter",
          enabled: !args.refused,
          props: { className: "py-4" },
        }}
        themeFiles={args.withFile ? [heroFile] : []}
        selection={
          args.withFile
            ? ({
                sectionId: "hero",
                componentType: "hero",
                kind: "heading",
                nodeId: "heading",
                sourceFilePath: HERO_PATH,
                elementKey: "heading",
                fieldKey: "heading",
                field: "heading",
                fieldPath: "heading",
                descendantFields: [],
                tagName: "h1",
                className: "text-4xl",
                isSection: false,
              } as never)
            : undefined
        }
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Tailwind CSS Classes/ }),
    );
    const input = screen.getByRole("textbox", {
      name: "Add Tailwind CSS class",
    }) as HTMLInputElement;
    return { onPropsChange, onUpdateThemeFileStyle, input };
  }
  const paste = (input: HTMLElement, value: string) =>
    fireEvent.paste(input, { clipboardData: { getData: () => value } });

  it.each([
    { refused: true, writes: 0 },
    { refused: false, writes: 1 },
  ])(
    "with no component file, Document writes refused: $refused",
    ({ refused, writes }) => {
      const { onPropsChange, input } = renderInspector({
        refused,
        withFile: false,
      });
      expect(input.disabled).toBe(refused);
      expect(
        (
          screen.getByRole("button", {
            name: "Remove py-4",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(refused);
      // A browser delivers no paste to a disabled input; dispatched anyway,
      // it still reaches no Document write.
      paste(input, "px-6");
      expect(onPropsChange).toHaveBeenCalledTimes(writes);
      if (writes) {
        expect(onPropsChange.mock.calls[0]![0].className).toBe("py-4 px-6");
      }
    },
  );

  it("with a component file, a hidden section's classes are still patched into the source", () => {
    const { onPropsChange, onUpdateThemeFileStyle, input } = renderInspector({
      refused: true,
      withFile: true,
    });
    expect(input.disabled).toBe(false);
    paste(input, "px-6");
    expect(onUpdateThemeFileStyle).toHaveBeenCalled();
    expect(onPropsChange).not.toHaveBeenCalled();
  });
});

/**
 * The Undo and Redo of a "Hide section" / "Show section" entry are history
 * runs of their own, as #388's content replays are: one awaited write each,
 * carrying only the toggle, checked against the draft generation answered
 * for the step it reverses or re-applies, recording nothing new, and moving
 * history only once answered. A refusal leaves the history, the Document and
 * the preview's hidden state as they were; a lost answer is held with its
 * history run and decided by its own read-back.
 *
 * The server is modelled here: one section, its `heading` and `enabled`,
 * and a draft generation its writes are checked against.
 */
describe("Show / Hide section Undo and Redo as history runs", () => {
  let server: { heading: string; enabled: boolean; generation: number };
  /** One-off answers, in order, before the server's own. */
  let answerNext: Array<(data: Record<string, unknown>) => unknown> = [];
  const conflictAnswer = {
    success: false,
    error: "TEMPLATE_DRAFT_CONFLICT",
    message: "Template draft was modified concurrently.",
  };
  const held = () =>
    contextWith(
      [{ id: "hero", enabled: server.enabled, heading: server.heading }],
      server.generation,
    );
  const apply = (data: Record<string, unknown>) => {
    if (data.expectedDraftGeneration !== server.generation) {
      return conflictAnswer;
    }
    const props = data.props as Record<string, unknown>;
    if (typeof props.heading === "string") server.heading = props.heading;
    if (typeof props.enabled === "boolean") server.enabled = props.enabled;
    server.generation += 1;
    return {
      success: true,
      data: {
        draftGeneration: server.generation,
        droppedProps: [],
        document: held().templates[0]!.document,
      },
    };
  };
  /** The request is sent and no answer comes back. */
  const lost = () => {
    throw new Error("offline");
  };
  const refusal = () => ({
    success: false,
    error: "REFUSED_BY_MOCK",
    message: "The mock refused the replay.",
  });
  /** The next write waits for `release` before it is answered. */
  const heldAnswer = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    answerNext.push(async (data) => {
      await gate;
      return apply(data);
    });
    return release;
  };

  const sent = () =>
    updateSectionProps.mock.calls.map(
      (call) => call[0].data as Record<string, unknown>,
    );
  const depth = () =>
    document
      .querySelector("[data-editor-undo-depth]")
      ?.getAttribute("data-editor-undo-depth") ?? null;
  const historyButtons = () => ({
    undo: !screen
      .getByRole("button", { name: "Undo" })
      .hasAttribute("disabled"),
    redo: !screen
      .getByRole("button", { name: "Redo" })
      .hasAttribute("disabled"),
  });
  const unconfirmedCount = () =>
    document
      .querySelector("[data-editor-unconfirmed-saves]")
      ?.getAttribute("data-editor-unconfirmed-saves") ?? null;
  const saveStatus = () =>
    document
      .querySelector("[data-editor-save-status]")
      ?.getAttribute("aria-label");
  // Past the content write's 300 ms debounce and its answer.
  const settle = () =>
    act(() => new Promise((resolve) => setTimeout(resolve, 1_200)));
  const press = async (name: "Undo" | "Redo") => {
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name }));
    await settle();
  };
  const undo = () => press("Undo");
  const redo = () => press("Redo");
  const notices = () => ({
    error: vi.spyOn(toast, "error").mockImplementation(() => ""),
  });
  const errors = (notice: ReturnType<typeof notices>) =>
    notice.error.mock.calls.map((call) => String(call[0]));
  /** Whether the last thing the preview was told about the hero hides it. */
  const previewHidden = () => {
    const last = posted
      .filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.sectionId === "hero" &&
          typeof message.enabled === "boolean",
      )
      .at(-1);
    return last ? last.enabled === false : null;
  };
  const checkAndSave = async () => {
    fireEvent.click(
      await screen.findByRole("button", { name: "Check and save" }),
    );
    await settle();
  };

  beforeEach(() => {
    server = { heading: "Welcome", enabled: true, generation: 1 };
    answerNext = [];
    updateSectionProps.mockImplementation(async ({ data }) => {
      const override = answerNext.shift();
      return override ? override(data) : apply(data);
    });
    getThemeEditor.mockImplementation(async () => ({
      success: true,
      message: "ok",
      data: held(),
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The route's read of the Theme: the editor is handed what the server holds. */
  const reread = async (shell: ReturnType<typeof renderShell>) => {
    shell.storedAs(held());
    await flushFrames();
  };

  /** The hero hidden (draft 1 -> 2): one write, one "Hide section" entry. */
  async function hidden() {
    const shell = renderShell(held());
    await flushFrames();
    fireEvent.click(hideButton());
    await settle();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      props: { enabled: false },
      expectedDraftGeneration: 1,
      expectedSourceGeneration: 1,
    });
    await reread(shell);
    expect(server).toMatchObject({ enabled: false, generation: 2 });
    expect(depth()).toBe("1");
    expect(historyButtons()).toEqual({ undo: true, redo: false });
    expect(previewHidden()).toBe(true);
    return shell;
  }

  it("two rounds of Undo then Redo: one awaited write each, carrying only the toggle; history moves only once answered, and nothing new is recorded", async () => {
    const notice = notices();
    const shell = await hidden();

    for (const round of [1, 2]) {
      const before = sent().length;
      const releaseUndo = heldAnswer();
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await settle();
      expect(sent(), `round ${round}: the undo is out`).toHaveLength(
        before + 1,
      );
      expect(sent().at(-1)).toMatchObject({
        props: { enabled: true },
        expectedDraftGeneration: before + 1,
        expectedSourceGeneration: 1,
      });
      expect(Object.keys(sent().at(-1)!.props as object)).toEqual(["enabled"]);
      expect(depth(), `round ${round}: not moved before its answer`).toBe("1");
      expect(historyButtons().redo).toBe(false);
      expect(
        previewHidden(),
        `round ${round}: the preview waits for the undo's answer`,
      ).toBe(true);
      releaseUndo();
      await settle();
      await reread(shell);
      expect(server.enabled).toBe(true);
      expect(depth(), `round ${round}: after undo`).toBe("0");
      expect(historyButtons()).toEqual({ undo: false, redo: true });
      expect(previewHidden()).toBe(false);

      const releaseRedo = heldAnswer();
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
      await settle();
      expect(sent(), `round ${round}: the redo is out`).toHaveLength(
        before + 2,
      );
      expect(sent().at(-1)).toMatchObject({
        props: { enabled: false },
        expectedDraftGeneration: before + 2,
        expectedSourceGeneration: 1,
      });
      expect(Object.keys(sent().at(-1)!.props as object)).toEqual(["enabled"]);
      expect(depth(), `round ${round}: not moved before its answer`).toBe("0");
      expect(historyButtons().undo).toBe(false);
      expect(previewHidden()).toBe(false);
      releaseRedo();
      await settle();
      await reread(shell);
      expect(server.enabled).toBe(false);
      expect(depth(), `round ${round}: after redo`).toBe("1");
      expect(historyButtons()).toEqual({ undo: true, redo: false });
      expect(previewHidden()).toBe(true);
    }
    expect(notice.error).not.toHaveBeenCalled();
    // Visibility reaches the preview as `enabled`, never as one of its props.
    expect(
      posted.filter(
        (message) =>
          message.type === "morph:storefront-preview-update-section-props" &&
          message.sectionId === "hero" &&
          typeof message.props === "object" &&
          message.props !== null &&
          "enabled" in (message.props as object),
      ),
    ).toEqual([]);
    await settle();
    expect(sent(), "nothing is sent after the last step").toHaveLength(5);
  }, 45_000);

  for (const [label, prepare] of [
    [
      "answered with a refusal",
      () => {
        answerNext.push(refusal);
      },
    ],
    [
      "refused by the draft generation (another tab moved the Document, unread)",
      () => {
        server.heading = "Theirs";
        server.generation = 3;
      },
    ],
  ] as const) {
    it(`an Undo ${label}: history, the Document, entries and the preview's hidden state as they were`, async () => {
      const notice = notices();
      const shell = await hidden();
      prepare();
      const before = { ...server };

      await undo();

      expect(sent(), "the undo is sent once").toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        props: { enabled: true },
        expectedDraftGeneration: 2,
        expectedSourceGeneration: 1,
      });
      expect(server, "the Document is unchanged").toEqual(before);
      expect(depth(), "history did not move").toBe("1");
      expect(historyButtons()).toEqual({ undo: true, redo: false });
      expect(errors(notice)).toContainEqual(
        expect.stringMatching(/^Could not undo/),
      );
      expect(unconfirmedCount()).toBeNull();
      expect(previewHidden(), "the preview still hides it").toBe(true);
      await settle();
      expect(sent(), "nothing is sent after it").toHaveLength(2);
      expect(depth(), "nothing new is recorded").toBe("1");
      expect(previewHidden()).toBe(true);
      void shell;
    });
  }

  it("a refused Redo leaves history, the Document and the preview's hidden state as they were", async () => {
    const notice = notices();
    const shell = await hidden();
    await undo();
    await reread(shell);
    expect(server).toMatchObject({ enabled: true, generation: 3 });
    expect(previewHidden()).toBe(false);
    answerNext.push(refusal);

    await redo();

    expect(sent()).toHaveLength(3);
    expect(sent()[2]).toMatchObject({
      props: { enabled: false },
      expectedDraftGeneration: 3,
    });
    expect(server).toMatchObject({ enabled: true, generation: 3 });
    expect(depth()).toBe("0");
    expect(historyButtons()).toEqual({ undo: false, redo: true });
    expect(errors(notice)).toContainEqual(
      expect.stringMatching(/^Could not redo/),
    );
    expect(unconfirmedCount()).toBeNull();
    expect(previewHidden(), "the preview still shows it").toBe(false);
  });

  for (const direction of ["undo", "redo"] as const) {
    it(`its ${direction}, after another tab's change the editor has read: refused before sending, their change kept`, async () => {
      const notice = notices();
      const shell = await hidden();
      if (direction === "redo") {
        await undo();
        await reread(shell);
        expect(server).toMatchObject({ enabled: true, generation: 3 });
      }
      const buttons = historyButtons();
      const depthBefore = depth();
      const hiddenBefore = previewHidden();
      // Another tab writes the heading at the next draft generation, and the
      // editor reads it.
      server.heading = "Theirs";
      server.generation += 1;
      await reread(shell);
      const theirs = { ...server };
      const before = sent().length;

      await press(direction === "undo" ? "Undo" : "Redo");

      expect(
        sent(),
        "nothing is sent over a step that was not this editor's own",
      ).toHaveLength(before);
      expect(server, "their change is kept").toEqual(theirs);
      expect(depth(), "history did not move").toBe(depthBefore);
      expect(historyButtons()).toEqual(buttons);
      expect(errors(notice)).toContainEqual(
        expect.stringMatching(
          direction === "undo" ? /^Could not undo/ : /^Could not redo/,
        ),
      );
      expect(unconfirmedCount()).toBeNull();
      expect(previewHidden()).toBe(hiddenBefore);
    });
  }

  it("input of the section still pending when Undo is pressed is sent first, as its own entry; that Undo then refuses as a newer edit is on top, and the toggle's Undo later carries only the toggle", async () => {
    const notice = notices();
    server.enabled = false;
    const shell = renderShell(held());
    await flushFrames();
    // Shown (draft 1 -> 2): one "Show section" entry.
    fireEvent.click(screen.getByRole("button", { name: "Show section hero" }));
    await settle();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.props).toEqual({ enabled: true });
    await reread(shell);
    expect(depth()).toBe("1");

    const field = await openHeadingField();
    const button = screen.getByRole("button", { name: "Undo" });
    expect(button.hasAttribute("disabled")).toBe(false);
    // Typed, and Undo pressed inside the 300 ms debounce.
    fireEvent.input(field, { target: { value: "Typed" } });
    fireEvent.blur(field);
    await waitForPresentationReady();
    fireEvent.click(button);
    await settle();

    expect(sent(), "the input only, no toggle after it").toHaveLength(2);
    expect(sent()[1]!.props).toEqual({ heading: "Typed" });
    expect(sent()[1]).toMatchObject({ expectedDraftGeneration: 2 });
    expect(server, "the Show is not undone").toMatchObject({
      heading: "Typed",
      enabled: true,
      generation: 3,
    });
    expect(depth(), "both entries kept").toBe("2");
    expect(historyButtons()).toEqual({ undo: true, redo: false });
    expect(errors(notice)).toContainEqual(
      expect.stringContaining(HISTORY_NEWER_EDIT_MESSAGE),
    );
    expect(unconfirmedCount()).toBeNull();
    expect(previewHidden()).toBe(false);
    await settle();
    expect(sent(), "nothing sent after it").toHaveLength(2);

    // The input's entry first, then the Show's: the toggle alone.
    await reread(shell);
    await undo();
    expect(sent()).toHaveLength(3);
    expect(sent()[2]!.props).toEqual({ heading: "Welcome" });
    expect(depth()).toBe("1");
    await reread(shell);
    await undo();
    expect(sent()).toHaveLength(4);
    expect(sent()[3]).toMatchObject({
      props: { enabled: false },
      expectedDraftGeneration: 4,
    });
    expect(Object.keys(sent()[3]!.props as object)).toEqual(["enabled"]);
    expect(server).toMatchObject({
      heading: "Welcome",
      enabled: false,
      generation: 5,
    });
    expect(depth()).toBe("0");
    expect(historyButtons()).toEqual({ undo: false, redo: true });
  });

  /** The Hide's undo sent at draft 2, and no answer comes back. */
  async function lostUndo() {
    const notice = notices();
    const shell = await hidden();
    answerNext.push(lost);

    await undo();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatchObject({
      props: { enabled: true },
      expectedDraftGeneration: 2,
      expectedSourceGeneration: 1,
    });
    expect(unconfirmedCount(), "one unconfirmed save").toBe("1");
    expect(depth(), "history did not move").toBe("1");
    expect(historyButtons()).toEqual({ undo: true, redo: false });
    expect(errors(notice)).toContainEqual(
      expect.stringMatching(/^Could not undo/),
    );
    await settle();
    expect(sent(), "nothing is sent by itself").toHaveLength(2);
    return shell;
  }

  it("an Undo with no answer, read back as landed: history moves once, nothing is sent again, Redo still there", async () => {
    const shell = await lostUndo();
    // It landed: the server holds the section shown, one generation on.
    server.enabled = true;
    server.generation = 3;

    await checkAndSave();

    expect(sent(), "nothing is sent again").toHaveLength(2);
    expect(unconfirmedCount()).toBeNull();
    expect(depth(), "moved once").toBe("0");
    expect(historyButtons()).toEqual({ undo: false, redo: true });
    await settle();
    expect(depth(), "and only once").toBe("0");

    await reread(shell);
    await redo();

    expect(sent()).toHaveLength(3);
    expect(sent()[2]).toMatchObject({
      props: { enabled: false },
      expectedDraftGeneration: 3,
      expectedSourceGeneration: 1,
    });
    expect(server).toMatchObject({ enabled: false, generation: 4 });
    expect(depth()).toBe("1");
    expect(historyButtons()).toEqual({ undo: true, redo: false });
  });

  it("an Undo with no answer, read back as not landed: sent once more, as first sent, only on Check and save; history moves once", async () => {
    const shell = await lostUndo();
    // Not landed: the server still holds it hidden, at the same generation.
    expect(server).toMatchObject({ enabled: false, generation: 2 });
    await settle();
    expect(sent(), "nothing is sent by itself").toHaveLength(2);
    expect(depth()).toBe("1");

    await checkAndSave();

    expect(sent(), "sent once more").toHaveLength(3);
    expect(sent()[2]).toMatchObject({
      props: { enabled: true },
      expectedDraftGeneration: 2,
      expectedSourceGeneration: 1,
    });
    expect(Object.keys(sent()[2]!.props as object)).toEqual(["enabled"]);
    expect(server).toMatchObject({ enabled: true, generation: 3 });
    expect(unconfirmedCount()).toBeNull();
    expect(depth(), "moved once, nothing new recorded").toBe("0");
    expect(historyButtons()).toEqual({ undo: false, redo: true });
    await settle();
    expect(sent(), "and nothing after it").toHaveLength(3);

    await reread(shell);
    await redo();
    expect(sent()).toHaveLength(4);
    expect(sent()[3]).toMatchObject({
      props: { enabled: false },
      expectedDraftGeneration: 3,
    });
    expect(depth()).toBe("1");
  });

  /**
   * Task 41 29-B (the user's decision): a Hide whose own answer was lost,
   * confirmed later by read-back or by an answered resend, records what an
   * answered Hide records — one "Hide section" entry, once — and its Undo
   * shows the section again, exactly that step.
   */
  describe("a Hide with no answer, confirmed later", () => {
    async function lostHide() {
      const shell = renderShell(held());
      await flushFrames();
      answerNext.push(lost);
      fireEvent.click(hideButton());
      await settle();
      expect(sent()).toHaveLength(1);
      expect(sent()[0]).toMatchObject({
        props: { enabled: false },
        expectedDraftGeneration: 1,
      });
      expect(unconfirmedCount()).toBe("1");
      expect(depth(), "nothing recorded without an answer").toBe("0");
      return shell;
    }

    it("read back as landed: recorded once, and Undo shows the section again", async () => {
      const shell = await lostHide();
      // It landed: the server holds the section hidden, one generation on.
      server.enabled = false;
      server.generation = 2;

      await checkAndSave();

      expect(sent(), "nothing is sent again").toHaveLength(1);
      expect(unconfirmedCount()).toBeNull();
      expect(depth(), "recorded once").toBe("1");
      expect(historyButtons()).toEqual({ undo: true, redo: false });
      await settle();
      expect(depth(), "and only once").toBe("1");

      await reread(shell);
      await undo();

      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        props: { enabled: true },
        expectedDraftGeneration: 2,
        expectedSourceGeneration: 1,
      });
      expect(Object.keys(sent()[1]!.props as object)).toEqual(["enabled"]);
      expect(server).toMatchObject({ enabled: true, generation: 3 });
      expect(depth()).toBe("0");
      expect(historyButtons()).toEqual({ undo: false, redo: true });
    });

    it("read back as not landed and resent with an answer: recorded once, and Undo shows the section again", async () => {
      const shell = await lostHide();
      expect(server).toMatchObject({ enabled: true, generation: 1 });

      await checkAndSave();

      expect(sent(), "sent once more").toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        props: { enabled: false },
        expectedDraftGeneration: 1,
      });
      expect(server).toMatchObject({ enabled: false, generation: 2 });
      expect(unconfirmedCount()).toBeNull();
      expect(depth(), "recorded once").toBe("1");
      expect(historyButtons()).toEqual({ undo: true, redo: false });

      await reread(shell);
      await undo();

      expect(sent()).toHaveLength(3);
      expect(sent()[2]).toMatchObject({
        props: { enabled: true },
        expectedDraftGeneration: 2,
      });
      expect(server).toMatchObject({ enabled: true, generation: 3 });
      expect(depth()).toBe("0");
      expect(historyButtons()).toEqual({ undo: false, redo: true });
    });

    // Round 4 R4-4: a press that changes nothing the editor holds (Hide
    // again while the Hide is unanswered: the row still offers Hide) retires
    // nothing, so the Hide confirmed later keeps its entry, as an answered
    // Hide does. (Round 3 had this press retire the history, which left a
    // landed Hide with no history.) Retiring by a real change is pinned on a
    // reorder in the round-trip tests.
    const showButton = () =>
      screen.getAllByRole("button", { name: "Show section hero" })[0]!;

    it("Hide pressed again while the Hide is unanswered changes nothing: the Hide confirmed later keeps its entry", async () => {
      await lostHide();
      fireEvent.click(hideButton());
      await settle();
      expect(sent(), "nothing more is sent").toHaveLength(1);

      await checkAndSave();

      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toMatchObject({
        props: { enabled: false },
        expectedDraftGeneration: 1,
      });
      expect(server).toMatchObject({ enabled: false, generation: 2 });
      expect(depth(), "as the answered path: the Hide's entry").toBe("1");
      expect(
        screen.getByRole("button", { name: "Undo" }).getAttribute("title"),
      ).toBe("Undo Hide section");
    });

    it("Try again before Show: the Hide is recorded, then Show retires it and records its own", async () => {
      const shell = await lostHide();

      await checkAndSave();
      expect(depth()).toBe("1");

      await reread(shell);
      fireEvent.click(showButton());
      await settle();

      expect(sent()).toHaveLength(3);
      expect(sent()[2]).toMatchObject({ props: { enabled: true } });
      expect(depth(), "as the answered path: one entry").toBe("1");
      expect(
        screen.getByRole("button", { name: "Undo" }).getAttribute("title"),
      ).toBe("Undo Show section");
    });
  });

  it("an Undo with no answer, not landed, its resend refused for another reason: the run fails with the reason and stays to run again; nothing reads as Save failed", async () => {
    // Round 4 R4-1: a write refused by an answer did not land: nothing to
    // confirm or record, nothing kept to resend. The run fails visibly with
    // the server's reason, its entry stays, and Undo starts a fresh attempt.
    await lostUndo();
    answerNext.push(refusal);

    await checkAndSave();

    expect(sent()).toHaveLength(3);
    expect(sent()[2]).toMatchObject({
      props: { enabled: true },
      expectedDraftGeneration: 2,
    });
    expect(unconfirmedCount()).toBeNull();
    expect(
      vi.mocked(toast.error).mock.calls.map((call) => String(call[0])),
    ).toContain("The mock refused the replay.");
    expect(saveStatus(), "nothing is pending: not a failed save").not.toBe(
      "Save failed",
    );
    expect(depth(), "the run has not moved").toBe("1");
    expect(previewHidden(), "the canvas shows what the server holds").toBe(
      true,
    );
    await settle();
    expect(sent(), "nothing is sent again by itself").toHaveLength(3);

    await undo();

    expect(sent()).toHaveLength(4);
    expect(sent()[3]).toMatchObject({
      props: { enabled: true },
      expectedDraftGeneration: 2,
    });
    expect(server).toMatchObject({ enabled: true, generation: 3 });
    expect(depth(), "moved once").toBe("0");
    expect(historyButtons()).toEqual({ undo: false, redo: true });
  });

  it("an Undo with no answer, the source moved before Check and save: not sent, said so, the entry stays, the canvas matches the server", async () => {
    // Round 4 R4-3(b): a run's write not sent because the source moved says
    // so in its own words; the marker it leaves is its history entry.
    await lostUndo();
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, scope),
    );

    await checkAndSave();

    expect(sent(), "not sent at the old source").toHaveLength(2);
    expect(unconfirmedCount()).toBeNull();
    expect(
      vi.mocked(toast.error).mock.calls.map((call) => String(call[0])),
    ).toContain(
      "The source code has changed, so an unanswered undo or redo was not sent again. Nothing was changed; its entry is still in the history.",
    );
    expect(saveStatus()).not.toBe("Save failed");
    expect(depth(), "its entry is still there").toBe("1");
    expect(previewHidden(), "the canvas shows what the server holds").toBe(
      true,
    );
  });

  /**
   * #391 review P2: a first (non-history) Show / Hide pressed while a history
   * run of the same section is out used to retire the section's history first
   * (`invalidateSectionHistory`), deleting that run's open attempt: the run
   * could land and the history not move, and Undo / Redo were gone. The
   * toggle is now checked (run out, unanswered write held) before anything
   * is retired or drawn; refused, the author is told and nothing changes.
   */
  describe("a Show / Hide pressed while a history run of the section is out", () => {
    const showButton = () =>
      screen.getAllByRole("button", { name: "Show section hero" })[0]!;

    it("the Undo out, Show pressed: nothing else is sent, the Undo lands and the history moves once", async () => {
      const notice = notices();
      const shell = await hidden();
      const releaseUndo = heldAnswer();
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await settle();
      expect(sent(), "the undo is out").toHaveLength(2);

      fireEvent.click(showButton());
      await settle();
      expect(previewHidden(), "the canvas waits for the undo").toBe(true);

      releaseUndo();
      await settle();
      await reread(shell);
      expect(server).toMatchObject({ enabled: true, generation: 3 });
      expect(sent(), "the toggle sent nothing, then or after").toHaveLength(2);
      expect(depth(), "moved once").toBe("0");
      expect(historyButtons()).toEqual({ undo: false, redo: true });
      expect(errors(notice)).toContain(HISTORY_RUN_PENDING_MESSAGE);
      await settle();
      expect(sent(), "nothing after it").toHaveLength(2);
    });

    it("the Undo out, Show pressed and refused: Redo and Undo still work afterwards", async () => {
      notices();
      const shell = await hidden();
      const releaseUndo = heldAnswer();
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await settle();
      fireEvent.click(showButton());
      await settle();
      releaseUndo();
      await settle();
      await reread(shell);

      await redo();
      expect(sent()).toHaveLength(3);
      expect(sent()[2]).toMatchObject({
        props: { enabled: false },
        expectedDraftGeneration: 3,
      });
      expect(depth()).toBe("1");
      await reread(shell);
      await undo();
      expect(sent()).toHaveLength(4);
      expect(sent()[3]).toMatchObject({
        props: { enabled: true },
        expectedDraftGeneration: 4,
      });
      expect(depth()).toBe("0");
      expect(historyButtons()).toEqual({ undo: false, redo: true });
    });

    it("the Undo unanswered, Show pressed: nothing is sent, the entry is kept and completes once on Check and save", async () => {
      const notice = notices();
      const shell = await hidden();
      answerNext.push(lost);
      await undo();
      expect(unconfirmedCount()).toBe("1");

      fireEvent.click(showButton());
      await settle();
      expect(sent(), "the toggle sends nothing").toHaveLength(2);
      expect(errors(notice).length).toBeGreaterThan(0);

      // It landed: the server holds the section shown, one generation on.
      server.enabled = true;
      server.generation = 3;
      await checkAndSave();
      expect(sent()).toHaveLength(2);
      expect(depth(), "moved once").toBe("0");
      expect(historyButtons()).toEqual({ undo: false, redo: true });
      await reread(shell);
      await redo();
      expect(sent()).toHaveLength(3);
      expect(sent()[2]).toMatchObject({ props: { enabled: false } });
      expect(depth()).toBe("1");
    });
  });

  /**
   * Stage 1 of "refuse an existing-Document content write that has no version
   * basis": the toggle's basis is the latest accepted snapshot generation at
   * the click. With none (constructed here: every read the editor is given
   * carries no valid draft generation, so it holds no snapshot), nothing is
   * sent, nothing is drawn, the history is not retired, and the toggle is
   * not sent while the presented Document generation is unknown.
   */
  describe("a Show / Hide with no version basis", () => {
    const saveStatus = () =>
      document
        .querySelector("[data-editor-save-status]")
        ?.getAttribute("aria-label");

    it("Hide pressed with no basis, another tab's change on the server: nothing sent, theirs kept, the canvas and history unchanged", async () => {
      // Every read the editor is given carries no valid draft generation.
      const unversioned = () =>
        contextWith(
          [{ id: "hero", enabled: server.enabled, heading: server.heading }],
          // Not undefined: contextWith defaults an omitted one to 1.
          null as unknown as number,
        );
      getThemeEditor.mockImplementation(async () => ({
        success: true,
        message: "ok",
        data: unversioned(),
      }));
      renderShell(unversioned());
      await flushFrames();
      // Another tab's write the editor has not read.
      server.heading = "Theirs";
      server.generation = 2;

      fireEvent.click(hideButton());
      await settle();

      expect(sent(), "no request").toHaveLength(0);
      expect(server).toEqual({
        heading: "Theirs",
        enabled: true,
        generation: 2,
      });
      expect(previewHidden(), "not drawn hidden").not.toBe(true);
      expect(depth(), "history unchanged").toBe("0");
      expect(saveStatus()).toBe("Unpublished");
      expect(unconfirmedCount()).toBeNull();
      await settle();
      expect(sent()).toHaveLength(0);
    });

    it("control: Hide pressed with the basis it was made on: written once, recorded once", async () => {
      notices();
      await hidden();
      expect(sent()).toHaveLength(1);
      expect(depth()).toBe("1");
    });

    it("control: Hide pressed on generation 1 after another tab's unread change: refused by the draft generation, theirs kept, nothing recorded", async () => {
      notices();
      renderShell(held());
      await flushFrames();
      server.heading = "Theirs";
      server.generation = 2;
      fireEvent.click(hideButton());
      await settle();
      expect(sent()).toHaveLength(1);
      expect(sent()[0]).toMatchObject({ expectedDraftGeneration: 1 });
      expect(server).toEqual({
        heading: "Theirs",
        enabled: true,
        generation: 2,
      });
      expect(depth()).toBe("0");
    });
  });
});
