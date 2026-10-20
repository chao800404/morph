import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Editor from "@monaco-editor/react";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { EditorCodeWorkspace } from "./editor-code-workspace";
import type {
  EditorCodeMonacoLoader,
  EditorCodeMonacoRuntime,
} from "./editor-code-monaco-loader";

/**
 * The workspace while the bundled Monaco is not there: what the editor pane
 * shows, that Retry recovers, and that an unsaved draft survives both.
 *
 * vitest.setup.ts hands every other suite a Monaco that is ready at once; this
 * one replaces that with the real loader, given an import it controls.
 */
const control = vi.hoisted(() => ({
  loader: null as EditorCodeMonacoLoader | null,
  importRuntime: null as null | (() => Promise<EditorCodeMonacoRuntime>),
}));

vi.mock("./editor-code-monaco-loader", async () => {
  const actual = await vi.importActual<
    typeof import("./editor-code-monaco-loader")
  >("./editor-code-monaco-loader");
  return {
    ...actual,
    useEditorCodeMonaco: () => actual.useEditorCodeMonacoFrom(control.loader!),
  };
});

vi.mock("@/server/storefront/storefront-theme-files.serverFn", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/storefront/storefront-theme-files.serverFn")
  >()),
  saveStorefrontThemeFile: vi.fn(),
  saveStorefrontThemeFilesBatch: vi.fn(),
  getStorefrontThemeFile: vi.fn(),
}));

vi.mock("./editor-code-language-support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editor-code-language-support")>()),
  configureThemeTypeScript: vi.fn(),
  disposeThemeWorkspaceModels: vi.fn(),
  ensureThemeWorkspaceModels: vi.fn(),
  registerTailwindCompletionProvider: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ defaultValue }: { defaultValue?: string }) => (
    <textarea aria-label="Code editor" defaultValue={defaultValue} />
  ),
}));

const file: StorefrontThemeFileDTO = {
  id: "file-1",
  storefrontId: "store-1",
  themeId: "theme-1",
  path: "src/components/Hero.tsx",
  content: "saved on the server",
  mimeType: "text/typescript",
  isEntry: true,
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const scope = { storefrontId: "store-1", themeId: "theme-1" };
const DRAFT = "unsaved draft from Design mode";

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditorCodeWorkspace
        storefrontId="store-1"
        themeId="theme-1"
        files={[file]}
        tree={[{ name: "Hero.tsx", path: file.path, isDirectory: false }]}
      />
    </QueryClientProvider>,
  );
}

describe("EditorCodeWorkspace while Monaco loads", () => {
  beforeEach(async () => {
    const { createEditorCodeMonacoLoader } = await vi.importActual<
      typeof import("./editor-code-monaco-loader")
    >("./editor-code-monaco-loader");
    control.loader = createEditorCodeMonacoLoader({
      importRuntime: () => control.importRuntime!(),
      timeoutMs: 50,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    useThemeWorkspaceStore.setState({
      activeWorkspaceKey: null,
      workspaces: {},
      files: {},
      acceptedGenerations: {},
      observedGenerations: {},
      generations: {},
    });
    const store = useThemeWorkspaceStore.getState();
    store.hydrateFromQuery("store-1", "theme-1", [file]);
    store.setActiveWorkspace("store-1", "theme-1");
    // An edit the author has not saved yet, as a Design mode source patch
    // leaves it: in the workspace store, before Monaco ever loaded.
    store.updateLocalContent(file.path, DRAFT, scope);
  });

  it("loading: says so, with no Retry and no editor yet", () => {
    control.importRuntime = () => new Promise(() => {});
    renderWorkspace();
    expect(screen.getByText(/Loading the code editor/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Code editor" })).toBeNull();
  });

  it("timeout: offers Retry, keeps the draft, and Retry opens the editor with it", async () => {
    const runtime = { Editor, monaco: {} } as unknown as EditorCodeMonacoRuntime;
    let answer!: (value: EditorCodeMonacoRuntime) => void;
    const open = new Promise<EditorCodeMonacoRuntime>((resolve) => {
      answer = resolve;
    });
    control.importRuntime = vi.fn(() => open);

    renderWorkspace();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The code editor is taking too long to load.",
    );
    expect(alert.getAttribute("data-code-editor-load-reason")).toBe("timeout");
    expect(
      useThemeWorkspaceStore.getState().files[file.path].localContent,
    ).toBe(DRAFT);
    expect(screen.getByText("1 unsaved")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText(/Loading the code editor/)).toBeTruthy();
    // The request that was still open answers.
    answer(runtime);
    const editor = (await screen.findByRole("textbox", {
      name: "Code editor",
    })) as HTMLTextAreaElement;
    expect(editor.value).toBe(DRAFT);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(control.importRuntime).toHaveBeenCalledTimes(2);
  });

  it("failed: says a reload is needed, offers no Retry, and keeps the draft", async () => {
    control.importRuntime = vi.fn(() =>
      Promise.reject(
        new TypeError("Failed to fetch dynamically imported module"),
      ),
    );

    renderWorkspace();
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-code-editor-load-reason")).toBe("failed");
    expect(alert.textContent).toContain("The code editor could not be loaded.");
    expect(alert.textContent).toContain("reload the page to open the code editor");
    expect(alert.textContent).toContain(
      "Unsaved changes are still in this tab, and reloading discards them.",
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Code editor" })).toBeNull();
    expect(
      useThemeWorkspaceStore.getState().files[file.path].localContent,
    ).toBe(DRAFT);
    expect(screen.getByText("1 unsaved")).toBeTruthy();
    expect(control.importRuntime).toHaveBeenCalledTimes(1);
  });

  it("mounts the editor with the draft once Monaco is ready", async () => {
    const runtime = { Editor, monaco: {} } as unknown as EditorCodeMonacoRuntime;
    control.importRuntime = async () => runtime;
    renderWorkspace();
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Code editor" }) as HTMLTextAreaElement)
          .value,
      ).toBe(DRAFT),
    );
  });
});
