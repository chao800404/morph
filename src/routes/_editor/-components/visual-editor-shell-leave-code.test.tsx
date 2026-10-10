import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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
// Loaded with the file, not inside a test. The shell reaches the Code
// workspace through `lazy()`, and its first load — a large module, compiled on
// demand — counted against the first test's time and outran it under a full,
// parallel run. Imported here it is compiled at collection; `lazy()` then
// resolves to this same, already-loaded module, which the tests still mount
// for real through the shell.
import "./editor-code-workspace";

/**
 * Leaving the editor with a Code draft, through the shell as it is wired.
 *
 * The Code workspace is the real one, mounted by switching the shell to Code;
 * only Monaco is a textarea. The draft is saved through the shell's own save
 * path (`handleUnifiedSaveFile` → `saveStorefrontThemeFile`), whose answer the
 * test holds open by hand. Only `setTimeout` is faked once the workspace is up,
 * so Code's own 700ms autosave never fires behind the test's back.
 */

vi.mock("@monaco-editor/react", () => ({
  default: ({
    defaultValue,
    onChange,
    onMount,
  }: {
    defaultValue?: string;
    onChange?: (value?: string) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    const [value, setValue] = useState(defaultValue ?? "");
    const valueRef = { current: value };
    void onMount;
    return (
      <textarea
        aria-label="Code editor"
        value={value}
        onChange={(event) => {
          valueRef.current = event.currentTarget.value;
          setValue(event.currentTarget.value);
          onChange?.(event.currentTarget.value);
        }}
      />
    );
  },
}));

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

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    saveStorefrontThemeFile: vi.fn(),
    getStorefrontThemeFile: vi.fn(),
  }),
);

vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({ to, children, ...rest }: { to?: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const PREVIEW_ORIGIN = "https://preview.morph.test";
const FILE_PATH = "src/components/Hero.tsx";
const ORIGINAL = "export function Hero() { return <section>x</section>; }\n";

const heroFile: StorefrontThemeFileDTO = {
  id: "file-hero",
  storefrontId: "storefront-1",
  themeId: "theme-1",
  path: FILE_PATH,
  content: ORIGINAL,
  mimeType: "text/typescript",
  isEntry: false,
  version: 1,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
} as StorefrontThemeFileDTO;

const context = {
  previewChannel: {
    editorOrigin: "http://localhost:3000",
    sessionId: "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e",
  },
  storefront: { id: "storefront-1", name: "Store", domain: null, status: "active" },
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      document: { version: 1, sections: [] },
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const saved = (content: string) => ({
  success: true,
  message: "Theme file saved",
  data: { ...heroFile, content, version: 2, sourceGeneration: 2 },
});

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
              children: [{ name: "Hero.tsx", path: FILE_PATH, isDirectory: false }],
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
        search={{ template: "index", templateId: "template-1", viewport: "desktop" } as StorefrontThemeEditorSearch}
        onSearchChange={vi.fn()}
        navigationGuardRef={guardRef}
      />
    </QueryClientProvider>,
  );
  const navigate = (kind: EditorLeaveKind) => {
    const outcome: { blocked?: boolean } = {};
    void guardRef.current!(kind).then((blocked) => {
      outcome.blocked = blocked;
    });
    return outcome;
  };
  return { navigate };
}

/** Switches the shell to Code, opens the hero, and freezes the clock. */
async function openCode() {
  const shell = renderShell();
  act(() => {
    screen.getByRole("button", { name: /^Code$/ }).click();
  });
  await screen.findByRole("button", { name: /Hero\.tsx/ }, { timeout: 15_000 });
  act(() => {
    screen.getAllByRole("button", { name: /Hero\.tsx/ })[0]!.click();
  });
  const editor = await screen.findByRole(
    "textbox",
    { name: "Code editor" },
    { timeout: 15_000 },
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return { ...shell, editor };
}

const tick = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const savedContents = () =>
  vi
    .mocked(saveStorefrontThemeFile)
    .mock.calls.map(([request]) => (request as { data: { content: string } }).data.content);

const unload = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

beforeEach(() => {
  useThemeWorkspaceStore.setState({ workspaces: {} });
  useEditorWriteGateStore.setState({ gates: {} });
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("leaving the editor with an unsaved Code draft", () => {
  it("warns on reload, and on leaving saves the draft before going", async () => {
    const write = deferred<unknown>();
    vi.mocked(saveStorefrontThemeFile).mockReturnValue(write.promise as never);
    const { navigate, editor } = await openCode();

    const draft = `${ORIGINAL}// edited in Code\n`;
    fireEvent.change(editor, { target: { value: draft } });
    await tick(0);

    // Only a warning: a reload cannot wait for a save.
    expect(unload()).toBe(true);
    expect(saveStorefrontThemeFile).not.toHaveBeenCalled();

    const outcome = navigate("leave-editor");
    await tick();
    // Sent by the navigation, long before Code's own 700ms autosave.
    expect(savedContents()).toEqual([draft]);
    expect(outcome.blocked).toBeUndefined();

    write.resolve(saved(draft));
    await tick();
    expect(outcome.blocked).toBe(false);
    expect(unload()).toBe(false);
  });

  it("stays, with the newest draft, when the author types in Code while the save waits", async () => {
    const write = deferred<unknown>();
    vi.mocked(saveStorefrontThemeFile).mockReturnValue(write.promise as never);
    const { navigate, editor } = await openCode();

    const first = `${ORIGINAL}// first\n`;
    fireEvent.change(editor, { target: { value: first } });
    await tick(0);
    const outcome = navigate("leave-editor");
    await tick();
    expect(savedContents()).toEqual([first]);

    const second = `${ORIGINAL}// first\n// second\n`;
    fireEvent.change(editor, { target: { value: second } });
    await tick(0);
    expect(outcome.blocked).toBe(true);

    // The first save landing neither revives the navigation nor takes the
    // newer draft as saved.
    write.resolve(saved(first));
    await tick();
    expect(outcome.blocked).toBe(true);
    expect((editor as HTMLTextAreaElement).value).toBe(second);
    expect(unload()).toBe(true);
  });
});
