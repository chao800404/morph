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
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { EditorStyleInspector } from "./editor-style-inspector";
import { VisualEditorShell } from "./visual-editor-shell";

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
        draftGeneration: 1,
        version: 1,
      },
    ],
  } as unknown as StorefrontThemeEditorDTO;
}

const SHOWN = contextWith([{ id: "hero", enabled: true, heading: "Welcome" }]);
const HIDDEN = contextWith([{ id: "hero", enabled: false, heading: "Welcome" }]);

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
    onSearchChange,
    storedAs: (context: StorefrontThemeEditorDTO) => {
      currentContext = context;
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

    fireEvent.click(hideButton());
    await waitFor(() =>
      expect(
        updateSectionProps.mock.calls.some(
          (_, index) => request(index).props.enabled === false,
        ),
      ).toBe(true),
    );
    const sent = updateSectionProps.mock.calls.map((_, index) => request(index));
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
    expect(screen.getByRole("heading", { level: 4, name: "heading" })).toBeTruthy();

    shell.storedAs(both(false));
    await flushFrames();
    expect(screen.getByDisplayValue("Welcome")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "heading" })).toBeTruthy();
    expect(shell.onSearchChange).not.toHaveBeenCalledWith({ section: "" });
  });

  it("is not given back when the section is shown again; a fresh selection works", async () => {
    updateSectionProps.mockResolvedValue(saved);
    const shell = renderShell();
    await openHeadingField();
    fireEvent.click(hideButton());
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    shell.storedAs(HIDDEN);
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Welcome")).toBeNull(),
    );

    shell.storedAs(SHOWN);
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
    fireEvent.click(screen.getByTitle("Select hero; drag to reorder"));
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
    expect(screen.getByRole("button", { name: "Show section hero" })).toBeTruthy();
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
  async function reportImage(sectionId: string) {
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
      kind: "image",
      nodeId: "image",
      sourceFilePath: HERO_PATH,
      sourceLocation: null,
      elementKey: "image",
      fieldKey: "imageSrc",
      field: "imageSrc",
      fieldPath: "imageSrc",
      descendantFields: [],
      tagName: "img",
      role: null,
      inputType: null,
      styleRevision: 0,
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

  it("the image position of a hidden section is disabled and sends nothing; another section's unsaved edit stays", async () => {
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

    await reportImage("hero");
    await openStyles();
    const trigger = screen.getByRole("combobox", { name: "Object position" });
    expect(trigger.hasAttribute("data-disabled")).toBe(true);
    await pickObjectPosition("Top");
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(trigger.textContent).not.toContain("Top");
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
  function renderInspector(args: {
    refused: boolean;
    withFile: boolean;
  }) {
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
        (screen.getByRole("button", { name: "Remove py-4" }) as HTMLButtonElement)
          .disabled,
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
