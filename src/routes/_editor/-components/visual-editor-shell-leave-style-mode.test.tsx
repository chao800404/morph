import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { EditorLeaveKind } from "@/lib/storefront/editor/editor-leave-guard";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { saveStorefrontThemeFile } from "@/server/storefront/storefront-theme-files.serverFn";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import {
  VisualEditorShell,
  type EditorNavigationGuard,
} from "./visual-editor-shell";

/**
 * Two edits #192 covered only below the shell: a style edit followed at once
 * by a page switch, and an edit followed at once by a switch from Design to
 * Code.
 *
 * A style edit rewrites a source file and waits out the same 300ms debounce as
 * content (`pendingSaveWritesRef`). Design and Code are one mounted shell with
 * an `editorMode` state, not a navigation, so a switch between them is never
 * asked of the leave guard; what has to hold is that the waiting write is
 * still sent, once, after the switch.
 *
 * Only `setTimeout` is faked, from the moment of the edit, and the clock moves
 * in steps far shorter than the debounce, so a write that arrives early was
 * sent by the navigation, not by the timer. Every server answer is a promise
 * the test resolves.
 */

const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const FILE_PATH = "src/components/Hero.tsx";
const ORIGINAL = `export default function Hero() {
  return <section data-morph-node="hero-root" className="p-2">x</section>;
}
`;

const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());

/**
 * The real Inspector panel, with one button that reaches
 * `onUpdateThemeFileStyle` — the path its Radix style controls take, which
 * jsdom cannot drive (as in `visual-editor-shell-round-trip.test.tsx`).
 */
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
            props.onUpdateThemeFileStyle?.(
              "src/components/Hero.tsx",
              "hero-root",
              (prevClasses) => `${prevClasses} p-8`,
            )
          }
        >
          Apply a style patch
        </button>
      </>
    ),
  };
});

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
    saveStorefrontThemeFile: vi.fn(),
    getStorefrontThemeFile: vi.fn(),
  }),
);

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

const heroFile: StorefrontThemeFileDTO = {
  id: "file-hero",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path: FILE_PATH,
  content: ORIGINAL,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
} as StorefrontThemeFileDTO;

const context = {
  previewChannel: {
    editorOrigin: "http://localhost:3000",
    sessionId: PREVIEW_SESSION,
  },
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
    fieldKey: "heading",
    fieldPath: "heading",
    isSection: false,
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const SAVED_CONTENT = {
  success: true,
  data: { draftGeneration: 2, droppedProps: [] },
};

const savedFile = (content: string) => ({
  success: true,
  message: "Theme file saved",
  data: { ...heroFile, content, version: 2, sourceGeneration: 2 },
});

const refusedFile = {
  success: false,
  message: "Theme file could not be saved",
  error: "UPDATE_FAILED",
};

function renderShell() {
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
      files: [heroFile],
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
                { name: "Hero.tsx", path: FILE_PATH, isDirectory: false },
              ],
            },
          ],
        },
      ],
      sourceGeneration: 1,
      latestPublishedRevision: null,
    } as never,
  );
  const guardRef: { current: EditorNavigationGuard | null } = { current: null };
  render(
    <QueryClientProvider client={client}>
      <VisualEditorShell
        context={context}
        search={
          {
            template: "index",
            templateId: "template-1",
            viewport: "desktop",
          } as StorefrontThemeEditorSearch
        }
        onSearchChange={vi.fn()}
        navigationGuardRef={guardRef}
      />
    </QueryClientProvider>,
  );
  /** Asks the shell, as the router's blocker does, and records the answer. */
  const navigate = (kind: EditorLeaveKind) => {
    const outcome: { blocked?: boolean } = {};
    void guardRef.current!(kind).then((blocked) => {
      outcome.blocked = blocked;
    });
    return outcome;
  };
  return { navigate };
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

function typeHeading(value: string, originalValue: string) {
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId: "hero",
    fieldKey: "heading",
    fieldPath: "heading",
    value,
    originalValue,
  });
}

function applyStylePatch() {
  act(() => {
    screen.getByRole("button", { name: "Apply a style patch" }).click();
  });
}

function switchToCode() {
  act(() => {
    screen.getByRole("button", { name: /^Code$/ }).click();
  });
}

/** Moves the clock, well short of the 300ms debounce, and lets work settle. */
const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const saveStatus = () =>
  document
    .querySelector("[data-editor-save-status]")
    ?.getAttribute("aria-label");

const savedContents = () =>
  vi
    .mocked(saveStorefrontThemeFile)
    .mock.calls.map(
      ([request]) => (request as { data: { content: string } }).data.content,
    );

const sentHeadings = () =>
  updateSectionProps.mock.calls.map(
    ([request]) =>
      (request as { data: { props: { heading?: string } } }).data.props.heading,
  );

const localHeroSource = () =>
  useThemeWorkspaceStore
    .getState()
    .getWorkspaceFiles("storefront-1", "theme-1")[FILE_PATH]?.localContent;

/** Renders, freezes the clock, and makes the style edit. */
async function styleEditBeforeDebounce() {
  const shell = renderShell();
  await screen.findByRole("button", { name: "Apply a style patch" });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  applyStylePatch();
  await tick(0);
  return shell;
}

beforeEach(() => {
  useThemeWorkspaceStore.setState({ workspaces: {} });
  useEditorWriteGateStore.setState({ gates: {} });
  getThemeEditor.mockResolvedValue({
    success: true,
    message: "ok",
    data: context,
  });
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(saveStorefrontThemeFile).mockReset();
  updateSectionProps.mockReset();
});

describe("a style edit, then a page switch before its debounce", () => {
  it("sends the patched source at once, and switches only once it is stored", async () => {
    const write = deferred<unknown>();
    vi.mocked(saveStorefrontThemeFile).mockReturnValue(write.promise as never);
    const { navigate } = await styleEditBeforeDebounce();

    // The edit is held, not sent: the debounce has not fired.
    expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
    expect(localHeroSource()).toContain("p-2 p-8");
    expect(saveStatus()).toBe("Unsaved");

    const outcome = navigate("switch-page");
    await tick();

    // Sent by the navigation, 20ms in.
    expect(savedContents()).toHaveLength(1);
    expect(savedContents()[0]).toContain("p-2 p-8");
    expect(outcome.blocked).toBeUndefined();

    write.resolve(savedFile(savedContents()[0]!));
    await tick();
    expect(outcome.blocked).toBe(false);

    // The cancelled debounce does not send it a second time.
    await tick(1_000);
    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
  });

  it("stays, keeps the patched source and says so when the save is refused", async () => {
    vi.mocked(saveStorefrontThemeFile).mockResolvedValue(refusedFile as never);
    const { navigate } = await styleEditBeforeDebounce();

    const outcome = navigate("switch-page");
    await tick();

    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    // The author is told and asked; the switch does not go on its own.
    expect(outcome.blocked).toBeUndefined();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Your changes were not saved");

    act(() => {
      screen.getByRole("button", { name: "Stay here" }).click();
    });
    await tick();
    expect(outcome.blocked).toBe(true);
    // The author's edit is kept in the workspace, not rolled back.
    expect(localHeroSource()).toContain("p-2 p-8");
    // And the refused save is not sent again by itself.
    await tick(1_000);
    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
  });
});

describe("an edit, then a switch from Design to Code before its debounce", () => {
  it("still sends a content edit once, when its debounce fires", async () => {
    const write = deferred<unknown>();
    updateSectionProps.mockReturnValue(write.promise);
    renderShell();
    await selectHeading();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    typeHeading("Hello", "Welcome");
    await tick(0);

    switchToCode();
    await tick();

    // The switch is not a navigation: nothing is flushed, nothing is dropped.
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(saveStatus()).toBe("Unsaved");

    await tick(300);
    expect(sentHeadings()).toEqual(["Hello"]);
    expect(saveStatus()).toBe("Saving…");

    write.resolve(SAVED_CONTENT);
    await tick();
    expect(saveStatus()).toMatch(/^(Unpublished|Published)$/);

    await tick(1_000);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("sends a content edit made in Design when the author then leaves from Code", async () => {
    const write = deferred<unknown>();
    updateSectionProps.mockReturnValue(write.promise);
    const { navigate } = renderShell();
    await selectHeading();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    typeHeading("Hello", "Welcome");
    await tick(0);

    switchToCode();
    await tick();
    const outcome = navigate("leave-editor");
    await tick();

    expect(sentHeadings()).toEqual(["Hello"]);
    expect(outcome.blocked).toBeUndefined();

    write.resolve(SAVED_CONTENT);
    await tick();
    expect(outcome.blocked).toBe(false);
    await tick(1_000);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
  });

  it("still sends a style edit once, and the workspace keeps the patched source", async () => {
    const write = deferred<unknown>();
    vi.mocked(saveStorefrontThemeFile).mockReturnValue(write.promise as never);
    await styleEditBeforeDebounce();

    switchToCode();
    await tick();

    expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
    // What Code reads for this file is the patched source, not the stored one.
    expect(localHeroSource()).toContain("p-2 p-8");

    await tick(300);
    expect(savedContents()).toHaveLength(1);
    expect(savedContents()[0]).toContain("p-2 p-8");

    write.resolve(savedFile(savedContents()[0]!));
    await tick();
    await tick(1_000);
    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    expect(localHeroSource()).toContain("p-2 p-8");
  });
});
