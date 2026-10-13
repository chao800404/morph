import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessDenied, accountChanged } from "@/lib/auth/auth-failure";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useEditorWriteGateStore } from "@/lib/storefront/store/editor-write-gate-store";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { saveStorefrontThemeFile } from "@/server/storefront/storefront-theme-files.serverFn";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * Source and style writes waiting when the editor closes to another account,
 * or its Theme writes are refused: one still in its debounce, and one already
 * sent whose answer comes after.
 *
 * A Code draft waits out Code's own autosave; a style edit rewrites a source
 * file and waits out the 300ms debounce content does. Both go out through
 * `sendEditorWrite`, which asks the write gate before sending. What has to
 * hold: nothing waiting is sent once writes are closed, the draft is kept,
 * and an answer arriving afterwards neither sends anything again nor opens
 * the editor.
 *
 * Only `setTimeout` is faked, from the moment of the edit. Every server answer
 * is a promise the test resolves.
 */

const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const FILE_PATH = "src/components/Hero.tsx";
const SCOPE = { storefrontId: "storefront-1", themeId: "theme-1" };
const ORIGINAL = `export default function Hero() {
  return <section data-morph-node="hero-root" className="p-2">x</section>;
}
`;

const getThemeEditor = vi.hoisted(() => vi.fn());

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

/**
 * The real Inspector panel, with one button that reaches
 * `onUpdateThemeFileStyle` — the path its Radix style controls take, which
 * jsdom cannot drive (as in `visual-editor-shell-leave-style-mode.test.tsx`).
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const savedFile = (content: string) => ({
  success: true,
  message: "Theme file saved",
  data: { ...heroFile, content, version: 2, sourceGeneration: 2 },
});

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
      />
    </QueryClientProvider>,
  );
}

const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const savedContents = () =>
  vi
    .mocked(saveStorefrontThemeFile)
    .mock.calls.map(
      ([request]) => (request as { data: { content: string } }).data.content,
    );

const localHeroSource = () =>
  useThemeWorkspaceStore
    .getState()
    .getWorkspaceFiles("storefront-1", "theme-1")[FILE_PATH]?.localContent;

const locked = () =>
  document
    .querySelector("[data-editor-locked]")
    ?.getAttribute("data-editor-locked") ?? null;

/** Another account found here, as the focus check, a read or a refused save does. */
const anotherAccountSignedIn = () =>
  act(() => {
    useEditorWriteGateStore.getState().writerChanged(SCOPE);
  });

/** Theme writes refused for this account, as a refused save does. */
const themeWritesRefused = () =>
  act(() => {
    useEditorWriteGateStore.getState().pause(SCOPE, "ACCESS_DENIED", "theme");
  });

/** Switches the shell to Code, opens the hero, and freezes the clock. */
async function openCode() {
  renderShell();
  act(() => {
    screen.getByRole("button", { name: /^Code$/ }).click();
  });
  const row = await waitFor(
    () => {
      const found = document.querySelector<HTMLElement>(
        `[data-file-tree-file="${FILE_PATH}"] > div`,
      );
      expect(found, "the hero's row in the Code explorer").not.toBeNull();
      return found!;
    },
    { timeout: 15_000 },
  );
  act(() => {
    fireEvent.click(row);
  });
  const editor = await screen.findByRole(
    "textbox",
    { name: "Code editor" },
    { timeout: 15_000 },
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return editor as HTMLTextAreaElement;
}

/** Renders, freezes the clock, and makes the style edit. */
async function styleEdit() {
  renderShell();
  await screen.findByRole("button", { name: "Apply a style patch" });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  act(() => {
    screen.getByRole("button", { name: "Apply a style patch" }).click();
  });
  await tick(0);
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
});

describe("a Code draft when the editor closes to another account", () => {
  it("still waiting for its autosave: not sent, and kept", async () => {
    vi.mocked(saveStorefrontThemeFile).mockResolvedValue(
      savedFile("unused") as never,
    );
    const editor = await openCode();
    const draft = `${ORIGINAL}// typed before the switch\n`;
    fireEvent.change(editor, { target: { value: draft } });
    await tick(0);

    anotherAccountSignedIn();
    await tick(3_000);

    expect(locked()).toBe("different-account");
    expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
    expect(editor.value).toBe(draft);
    expect(localHeroSource()).toBe(draft);
  });

  it("already sent and then accepted: not sent again, and the editor stays closed", async () => {
    const write = deferred<unknown>();
    vi.mocked(saveStorefrontThemeFile).mockReturnValue(write.promise as never);
    const editor = await openCode();
    const draft = `${ORIGINAL}// saved as the first account\n`;
    fireEvent.change(editor, { target: { value: draft } });
    await tick(3_000);
    // Code's autosave sent it, before anyone else signed in.
    expect(savedContents()).toEqual([draft]);

    anotherAccountSignedIn();
    write.resolve(savedFile(draft));
    await tick();
    await tick(3_000);

    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    expect(locked()).toBe("different-account");
    expect(localHeroSource()).toBe(draft);
  });

  it("already sent and then refused for the other account: kept, not sent again", async () => {
    const write = deferred<unknown>();
    vi.mocked(saveStorefrontThemeFile).mockReturnValue(write.promise as never);
    const editor = await openCode();
    const draft = `${ORIGINAL}// refused once the account changed\n`;
    fireEvent.change(editor, { target: { value: draft } });
    await tick(3_000);
    expect(savedContents()).toEqual([draft]);

    anotherAccountSignedIn();
    write.reject(accountChanged());
    await tick();
    await tick(3_000);

    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    expect(locked()).toBe("different-account");
    expect(editor.value).toBe(draft);
    expect(localHeroSource()).toBe(draft);
  });

  it("waiting while Theme writes are refused for this account: not sent, and kept", async () => {
    vi.mocked(saveStorefrontThemeFile).mockResolvedValue(
      savedFile("unused") as never,
    );
    const editor = await openCode();
    const draft = `${ORIGINAL}// typed before access was taken away\n`;
    fireEvent.change(editor, { target: { value: draft } });
    await tick(0);

    themeWritesRefused();
    await tick(3_000);

    expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
    expect(localHeroSource()).toBe(draft);
  });
});

describe("a style edit when the editor closes to another account", () => {
  it("still in its debounce: not sent, and the patched source is kept", async () => {
    vi.mocked(saveStorefrontThemeFile).mockResolvedValue(
      savedFile("unused") as never,
    );
    await styleEdit();
    expect(localHeroSource()).toContain("p-2 p-8");

    anotherAccountSignedIn();
    await tick(300);
    await tick(3_000);

    expect(locked()).toBe("different-account");
    expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
    expect(localHeroSource()).toContain("p-2 p-8");
  });

  it("already sent and then accepted: not sent again", async () => {
    const write = deferred<unknown>();
    vi.mocked(saveStorefrontThemeFile).mockReturnValue(write.promise as never);
    await styleEdit();
    await tick(300);
    expect(savedContents()).toHaveLength(1);
    expect(savedContents()[0]).toContain("p-2 p-8");

    anotherAccountSignedIn();
    write.resolve(savedFile(savedContents()[0]!));
    await tick();
    await tick(3_000);

    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    expect(locked()).toBe("different-account");
  });

  it("already sent and then refused for the other account: kept, not sent again", async () => {
    const write = deferred<unknown>();
    vi.mocked(saveStorefrontThemeFile).mockReturnValue(write.promise as never);
    await styleEdit();
    await tick(300);
    expect(savedContents()).toHaveLength(1);

    anotherAccountSignedIn();
    write.reject(accountChanged());
    await tick();
    await tick(3_000);

    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    expect(locked()).toBe("different-account");
    expect(localHeroSource()).toContain("p-2 p-8");
  });

  it("already sent and then refused for this account's access: kept, not sent again", async () => {
    const write = deferred<unknown>();
    vi.mocked(saveStorefrontThemeFile).mockReturnValue(write.promise as never);
    await styleEdit();
    await tick(300);
    expect(savedContents()).toHaveLength(1);

    write.reject(accessDenied("Forbidden"));
    await tick();
    await tick(3_000);

    expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    expect(
      useEditorWriteGateStore.getState().gates[
        `${SCOPE.storefrontId}:${SCOPE.themeId}`
      ]?.denied ?? [],
    ).toContain("theme");
    expect(localHeroSource()).toContain("p-2 p-8");
  });
});
