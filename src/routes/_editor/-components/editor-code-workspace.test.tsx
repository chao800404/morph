import { useEffect, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StorefrontThemeBinaryFileDTO,
  StorefrontThemeFileDTO,
  StorefrontThemeFileTreeNode,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import { toast } from "sonner";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import {
  applyThemeManifestMigrationServerFn,
  deleteStorefrontThemeFile,
  previewThemeManifestMigration,
  saveStorefrontThemeFile,
  saveStorefrontThemeFilesBatch,
} from "@/server/storefront/storefront-theme-files.serverFn";
import {
  EditorCodeWorkspace,
  type EditorCodeWorkspaceHandle,
} from "./editor-code-workspace";
import { configureThemeTypeScript } from "./editor-code-language-support";
import { formatEditorCode } from "./editor-code-formatter";

const monacoTestState = vi.hoisted(() => ({
  formatter: null as null | ((content: string) => string | Promise<string>),
  formatError: false,
  editorOptions: null as Record<string, unknown> | null,
  editorOpener: null as {
    openCodeEditor: (
      source: unknown,
      resource: { toString(): string },
      selectionOrPosition?: unknown,
    ) => boolean | Promise<boolean>;
  } | null,
  lastPosition: null as { lineNumber: number; column: number } | null,
}));

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/server/storefront/storefront-theme-files.serverFn")
    >()),
    applyThemeManifestMigrationServerFn: vi.fn(),
    deleteStorefrontThemeFile: vi.fn(),
    previewThemeManifestMigration: vi.fn(),
    saveStorefrontThemeFile: vi.fn(),
    saveStorefrontThemeFilesBatch: vi.fn(),
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
  formatEditorCode: vi.fn(async (content: string) => {
    if (monacoTestState.formatter) {
      const formatted = await monacoTestState.formatter(content);
      if (monacoTestState.formatError) throw new Error("format failed");
      return formatted;
    }
    if (monacoTestState.formatError) throw new Error("format failed");
    return content;
  }),
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({
    defaultValue,
    onChange,
    onMount,
    beforeMount,
    theme,
    options,
  }: {
    defaultValue?: string;
    onChange?: (value?: string) => void;
    beforeMount?: (monaco: unknown) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    theme?: string;
    options?: Record<string, unknown>;
  }) => {
    const [value, setValue] = useState(defaultValue ?? "");
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => {
      const model = {
        uri: { path: "src/components/Hero.tsx" },
        getValue: () => valueRef.current,
        onDidChangeContent: () => ({ dispose: vi.fn() }),
        setValue: (next: string) => {
          valueRef.current = next;
          setValue(next);
          onChange?.(next);
        },
      };
      const monaco = {
        editor: {
          getModels: () => [model],
          registerEditorOpener: (
            opener: NonNullable<typeof monacoTestState.editorOpener>,
          ) => {
            monacoTestState.editorOpener = opener;
            return {
              dispose: () => {
                if (monacoTestState.editorOpener === opener) {
                  monacoTestState.editorOpener = null;
                }
              },
            };
          },
          deltaDecorations: vi.fn((_oldIds: string[], next: unknown[]) =>
            next.map((_decoration, index) => String(index)),
          ),
        },
      };
      const formatAction = {
        run: async () => {
          if (monacoTestState.formatter) {
            model.setValue(await monacoTestState.formatter(model.getValue()));
          }
          if (monacoTestState.formatError) throw new Error("format failed");
        },
      };
      beforeMount?.(monaco);
      (onMount as unknown as (editor: unknown, monaco: unknown) => void)?.(
        {
          getModel: () => model,
          getAction: (id: string) =>
            id === "editor.action.formatDocument" ? formatAction : undefined,
          onDidChangeModel: () => ({ dispose: vi.fn() }),
          deltaDecorations: monaco.editor.deltaDecorations,
          revealPositionInCenter: vi.fn(),
          setPosition: (position: { lineNumber: number; column: number }) => {
            monacoTestState.lastPosition = position;
          },
          focus: vi.fn(),
        },
        monaco,
      );
      monacoTestState.editorOptions = options ?? null;
    }, [onMount]);

    return (
      <textarea
        aria-label="Code editor"
        data-theme={theme}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setValue(next);
          onChange?.(next);
        }}
      />
    );
  },
}));

const file: StorefrontThemeFileDTO = {
  id: "file-1",
  storefrontId: "store-1",
  themeId: "theme-1",
  path: "src/components/Hero.tsx",
  content: "original",
  mimeType: "text/typescript",
  isEntry: true,
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const legacyManifestFile: StorefrontThemeFileDTO = {
  ...file,
  id: "manifest-1",
  path: "morph.theme.json",
  content: '{"version":1}',
  mimeType: "application/json",
  isEntry: false,
};

function renderWorkspace(props?: {
  files?: StorefrontThemeFileDTO[];
  tree?: StorefrontThemeFileTreeNode[];
  workspaceRef?: RefObject<EditorCodeWorkspaceHandle | null>;
  onSaveFile?: (
    path: string,
    content: string,
  ) => Promise<StorefrontThemeFileDTO | null>;
  onRestartPreview?: () => void;
  onDirtyFilesChange?: (paths: string[]) => void;
  onPreviewFilesChange?: (
    files: Array<{ path: string; content: string }>,
  ) => void;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditorCodeWorkspace
        ref={props?.workspaceRef}
        storefrontId="store-1"
        themeId="theme-1"
        files={props?.files ?? [file]}
        tree={
          props?.tree ?? [
            {
              name: "Hero.tsx",
              path: file.path,
              isDirectory: false,
            },
          ]
        }
        onSaveFile={props?.onSaveFile}
        onRestartPreview={props?.onRestartPreview}
        onDirtyFilesChange={props?.onDirtyFilesChange}
        onPreviewFilesChange={props?.onPreviewFilesChange}
      />
    </QueryClientProvider>,
  );
}

describe("EditorCodeWorkspace transient Monaco drafts", () => {
  beforeEach(() => {
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
    store.acceptRemoteGeneration(7, {
      storefrontId: "store-1",
      themeId: "theme-1",
    });
    vi.mocked(deleteStorefrontThemeFile).mockReset();
    vi.mocked(applyThemeManifestMigrationServerFn).mockReset();
    vi.mocked(previewThemeManifestMigration).mockReset();
    vi.mocked(configureThemeTypeScript).mockClear();
    vi.mocked(formatEditorCode).mockClear();
    monacoTestState.formatter = null;
    monacoTestState.formatError = false;
    monacoTestState.editorOptions = null;
    monacoTestState.editorOpener = null;
    monacoTestState.lastPosition = null;
  });

  it("uses Monaco's built-in dark theme without defining a custom theme", () => {
    renderWorkspace();
    expect(
      screen
        .getByRole("textbox", { name: "Code editor" })
        .getAttribute("data-theme"),
    ).toBe("vs-dark");
  });

  /**
   * Monaco's own default, which is the platform's: Cmd on macOS and Ctrl
   * elsewhere goes to a definition, and Alt/Option adds a cursor — the same
   * pairing VS Code uses. Setting `multiCursorModifier: "ctrlCmd"` swaps them,
   * which is what briefly made Option the go-to gesture here and left the
   * editor disagreeing with every other editor on the machine.
   */
  it("leaves the go-to-definition gesture on the platform's own modifier", async () => {
    renderWorkspace();

    await waitFor(() => expect(monacoTestState.editorOptions).not.toBeNull());
    expect(monacoTestState.editorOptions?.multiCursorModifier).toBeUndefined();
  });

  it("opens a definition from another file in the Theme workspace", async () => {
    renderWorkspace();

    await waitFor(() => expect(monacoTestState.editorOpener).not.toBeNull());
    const handled = await monacoTestState.editorOpener!.openCodeEditor(
      null,
      {
        toString: () =>
          "file:///morph-theme/store-1/theme-1/src/components/Hero.tsx",
      },
      { lineNumber: 12, column: 7 },
    );

    expect(handled).toBe(true);
    await waitFor(() => {
      expect(monacoTestState.lastPosition).toEqual({
        lineNumber: 12,
        column: 7,
      });
    });
  });

  it("does not let Monaco open a definition outside the active Theme", async () => {
    renderWorkspace();

    await waitFor(() => expect(monacoTestState.editorOpener).not.toBeNull());
    const handled = await monacoTestState.editorOpener!.openCodeEditor(
      null,
      {
        toString: () => "file:///morph-theme/other/theme/src/lib.ts",
      },
      { lineNumber: 1, column: 1 },
    );

    expect(handled).toBe(false);
    expect(monacoTestState.lastPosition).toBeNull();
  });

  it("keeps repeated typing out of the global workspace and saves the latest model once", async () => {
    const onDirtyFilesChange = vi.fn();
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ onSaveFile, onDirtyFilesChange });

    const editor = screen.getByRole("textbox", { name: "Code editor" });
    fireEvent.change(editor, { target: { value: "draft 1" } });
    fireEvent.change(editor, { target: { value: "draft 2" } });
    fireEvent.change(editor, { target: { value: "latest draft" } });

    expect(
      useThemeWorkspaceStore.getState().files[file.path].localContent,
    ).toBe("original");
    expect(onDirtyFilesChange).toHaveBeenCalledTimes(1);
    expect(onDirtyFilesChange).toHaveBeenLastCalledWith([file.path]);

    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => {
      expect(onSaveFile).toHaveBeenCalledWith(file.path, "latest draft");
    });
  });

  it("previews a Monaco draft before automatically saving it", async () => {
    const onPreviewFilesChange = vi.fn();
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ onPreviewFilesChange, onSaveFile });

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "live draft" },
    });

    expect(
      useThemeWorkspaceStore.getState().files[file.path].localContent,
    ).toBe("original");
    await waitFor(() =>
      expect(onPreviewFilesChange).toHaveBeenLastCalledWith([
        { path: file.path, content: "live draft" },
      ]),
    );
    expect(onSaveFile).not.toHaveBeenCalled();

    await waitFor(
      () => expect(onSaveFile).toHaveBeenCalledWith(file.path, "live draft"),
      { timeout: 1_500 },
    );
  });

  it("exposes Save All for mode switches and persists the current Monaco draft", async () => {
    const workspaceRef = createRef<EditorCodeWorkspaceHandle>();
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ workspaceRef, onSaveFile });

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "draft before switching to Design" },
    });

    await waitFor(() => expect(workspaceRef.current).not.toBeNull());
    await expect(workspaceRef.current!.saveAll()).resolves.toBe(true);
    expect(onSaveFile).toHaveBeenCalledWith(
      file.path,
      "draft before switching to Design",
    );
  });

  it("flushes a pending debounce immediately for a mode switch", async () => {
    const workspaceRef = createRef<EditorCodeWorkspaceHandle>();
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ workspaceRef, onSaveFile });

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "flush now" },
    });
    await waitFor(() => expect(workspaceRef.current).not.toBeNull());
    await expect(workspaceRef.current!.flushPendingChanges()).resolves.toBe(
      true,
    );
    expect(onSaveFile).toHaveBeenCalledTimes(1);
    expect(onSaveFile).toHaveBeenCalledWith(file.path, "flush now");
  });

  it("waits for an in-flight file save instead of switching on stale content", async () => {
    const workspaceRef = createRef<EditorCodeWorkspaceHandle>();
    const onDirtyFilesChange = vi.fn();
    let resolveSave!: (saved: StorefrontThemeFileDTO) => void;
    const onSaveFile = vi.fn(
      (_path: string, content: string) =>
        new Promise<StorefrontThemeFileDTO>((resolve) => {
          resolveSave = () => resolve({ ...file, content, version: 2 });
        }),
    );
    renderWorkspace({ workspaceRef, onSaveFile, onDirtyFilesChange });
    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "in flight" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(onSaveFile).toHaveBeenCalledTimes(1));

    const flushPromise = workspaceRef.current!.flushPendingChanges();
    resolveSave({ ...file, content: "in flight", version: 2 });
    const flushed = await flushPromise;
    expect(flushed).toBe(true);
  });

  it("lets the editor shell apply a saved file through HMR without refreshing the iframe", async () => {
    const onRestartPreview = vi.fn();
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ onSaveFile, onRestartPreview });

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "hot updated draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(onSaveFile).toHaveBeenCalledTimes(1));
    expect(onRestartPreview).not.toHaveBeenCalled();
  });

  it("saves Monaco's formatted model content", async () => {
    monacoTestState.formatter = (content) => `formatted(${content})`;
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ onSaveFile });

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() =>
      expect(onSaveFile).toHaveBeenCalledWith(file.path, "formatted(draft)"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Save/ }).hasAttribute("disabled"),
      ).toBe(true),
    );
  });

  it("saves the original draft when Monaco formatting fails", async () => {
    monacoTestState.formatError = true;
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ onSaveFile });

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "unformatted draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() =>
      expect(onSaveFile).toHaveBeenCalledWith(file.path, "unformatted draft"),
    );
  });

  it("does not save a partially formatted model when formatting fails", async () => {
    monacoTestState.formatter = () => "partial formatter output";
    monacoTestState.formatError = true;
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ onSaveFile });

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "original draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() =>
      expect(onSaveFile).toHaveBeenCalledWith(file.path, "original draft"),
    );
  });

  it("does not start a second save while formatting is in progress", async () => {
    let finishFormatting: ((content: string) => void) | undefined;
    monacoTestState.formatter = () =>
      new Promise<string>((resolve) => {
        finishFormatting = () => resolve("formatted once");
      });
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ onSaveFile });

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "draft" },
    });
    const saveButton = screen.getByRole("button", { name: /Save/ });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    expect(onSaveFile).not.toHaveBeenCalled();

    finishFormatting?.("formatted once");
    await waitFor(() =>
      expect(onSaveFile).toHaveBeenCalledWith(file.path, "formatted once"),
    );
    expect(onSaveFile).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest model content when it changes during formatting", async () => {
    let finishFormatting: ((content: string) => void) | undefined;
    monacoTestState.formatter = () =>
      new Promise<string>((resolve) => {
        finishFormatting = () => resolve("stale formatted output");
      });
    const onSaveFile = vi.fn(async (_path: string, content: string) => ({
      ...file,
      content,
      version: 2,
    }));
    renderWorkspace({ onSaveFile });

    const editor = screen.getByRole("textbox", { name: "Code editor" });
    fireEvent.change(editor, { target: { value: "original draft" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    fireEvent.change(editor, { target: { value: "newer draft" } });
    finishFormatting?.("stale formatted output");

    await waitFor(() =>
      expect(onSaveFile).toHaveBeenCalledWith(file.path, "newer draft"),
    );
    expect((editor as HTMLTextAreaElement).value).toBe("newer draft");
  });

  it("does not clear a newer draft when an older save finishes", async () => {
    let finishSave: ((saved: StorefrontThemeFileDTO) => void) | undefined;
    const onSaveFile = vi.fn(
      () =>
        new Promise<StorefrontThemeFileDTO>((resolve) => {
          finishSave = resolve;
        }),
    );
    renderWorkspace({ onSaveFile });

    const editor = screen.getByRole("textbox", { name: "Code editor" });
    fireEvent.change(editor, { target: { value: "saving draft" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(onSaveFile).toHaveBeenCalledTimes(1));
    fireEvent.change(editor, { target: { value: "newer unsaved draft" } });
    finishSave?.({ ...file, content: "saving draft", version: 2 });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Save/ }).hasAttribute("disabled"),
      ).toBe(false);
    });
    expect((editor as HTMLTextAreaElement).value).toBe("newer unsaved draft");
  });

  it("deletes a file from the context menu with OCC preconditions and clears the active editor", async () => {
    vi.mocked(deleteStorefrontThemeFile).mockResolvedValue({
      success: true,
      message: "Theme file deleted",
      data: { path: file.path, sourceGeneration: 8 },
    });
    renderWorkspace();

    fireEvent.contextMenu(screen.getAllByText("Hero.tsx")[0]);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Delete File/i }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteStorefrontThemeFile).toHaveBeenCalledWith({
        data: {
          storefrontId: "store-1",
          themeId: "theme-1",
          path: file.path,
          expectedFileId: file.id,
          expectedVersion: 1,
          expectedSourceGeneration: 7,
        },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Code editor" })).toBeNull(),
    );
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration({
        storefrontId: "store-1",
        themeId: "theme-1",
      }),
    ).toBe(8);
  });

  it("does not delete a dirty file when the confirmation is cancelled", async () => {
    vi.mocked(deleteStorefrontThemeFile).mockResolvedValue({
      success: true,
      message: "Theme file deleted",
      data: { path: file.path, sourceGeneration: 8 },
    });
    renderWorkspace();

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "dirty" },
    });
    fireEvent.contextMenu(screen.getAllByText("Hero.tsx")[0]);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Delete File/i }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(deleteStorefrontThemeFile).not.toHaveBeenCalled();
  });

  it("previews and applies the server-owned legacy manifest migration", async () => {
    vi.mocked(previewThemeManifestMigration).mockResolvedValue({
      success: true,
      message: "Legacy manifest migration is ready",
      data: {
        status: "ready",
        storefrontId: "store-1",
        themeId: "theme-1",
        sourceGeneration: 7,
        manifestFile: { id: legacyManifestFile.id, version: 1 },
        sourceFilesBefore: [],
        sourceFilesAfter: [],
        sourceIndexAfter: {
          status: "complete",
          key: "source-index-key",
          diagnostics: [],
        },
        documentUpdates: [],
        historicalLegacyRefs: [],
        warnings: [],
        rewriteCount: 1,
        blockers: [],
        report: null,
      },
    } as never);
    vi.mocked(applyThemeManifestMigrationServerFn).mockResolvedValue({
      success: true,
      message: "Legacy theme manifest migrated",
      data: {
        status: "applied",
        sourceGeneration: 8,
        rewriteCount: 1,
        deletedPath: "morph.theme.json",
      },
    } as never);
    const onRestartPreview = vi.fn();
    renderWorkspace({
      files: [file, legacyManifestFile],
      onRestartPreview,
    });

    const migrateButton = await screen.findByRole("button", {
      name: "Migrate legacy theme manifest",
    });
    await waitFor(() =>
      expect(migrateButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(migrateButton);
    expect(
      await screen.findByText("Document references to rewrite"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove manifest" }));
    await waitFor(() =>
      expect(applyThemeManifestMigrationServerFn).toHaveBeenCalledWith({
        data: { storefrontId: "store-1", themeId: "theme-1" },
      }),
    );
    expect(onRestartPreview).toHaveBeenCalledTimes(1);
  });
});

describe("EditorCodeWorkspace file creation", () => {
  const folderTree = [
    {
      name: "src",
      path: "src",
      isDirectory: true,
      children: [
        {
          name: "components",
          path: "src/components",
          isDirectory: true,
          children: [{ name: "Hero.tsx", path: file.path, isDirectory: false }],
        },
      ],
    },
  ];

  function renderTree() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={client}>
        <EditorCodeWorkspace
          storefrontId="store-1"
          themeId="theme-1"
          files={[file]}
          tree={folderTree as never}
        />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    vi.mocked(saveStorefrontThemeFile).mockReset();
    vi.mocked(saveStorefrontThemeFilesBatch).mockReset();
    window.localStorage.clear();
    useThemeWorkspaceStore.setState({ files: {} });
  });

  it("creates a file from the explorer with the create precondition", async () => {
    vi.mocked(saveStorefrontThemeFile).mockResolvedValue({
      success: true,
      message: "ok",
      data: { ...file, id: "file-2", path: "src/components/Promo.tsx" },
    } as never);

    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "New file" }));

    const input = screen.getByPlaceholderText("Filename.tsx");
    fireEvent.change(input, {
      target: { value: "src/components/Promo.tsx" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    });

    const payload = vi.mocked(saveStorefrontThemeFile).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(payload.data.path).toBe("src/components/Promo.tsx");
    // Without this precondition a create could silently overwrite a file.
    expect(payload.data.expectMissing).toBe(true);
    // Scaffolded so the new component is editable in the Inspector at once.
    expect(String(payload.data.content)).toContain(
      "export const contentFields",
    );
  });

  it("keeps the parent folder prefix out of the inline file name input", async () => {
    vi.mocked(saveStorefrontThemeFile).mockResolvedValue({
      success: true,
      message: "ok",
      data: {
        ...file,
        id: "file-2",
        path: "src/components/Promo.tsx",
      },
    } as never);

    renderTree();
    fireEvent.contextMenu(screen.getByText("components"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "New File" }));

    const input = screen.getByPlaceholderText("Filename.tsx");
    expect((input as HTMLInputElement).value).toBe("");
    fireEvent.change(input, { target: { value: "Promo.tsx" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(saveStorefrontThemeFile).mock.calls[0]![0]).toEqual({
      data: expect.objectContaining({
        path: "src/components/Promo.tsx",
      }),
    });
  });

  it("refuses an invalid path before contacting the server", async () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "New file" }));

    const input = screen.getByPlaceholderText("Filename.tsx");
    fireEvent.change(input, { target: { value: "../escape.tsx" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
    });
  });

  it("refuses creating a path that already exists", async () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "New file" }));

    const input = screen.getByPlaceholderText("Filename.tsx");
    fireEvent.change(input, { target: { value: file.path } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
    });
  });

  it("closes the input on Escape without creating anything", async () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "New file" }));

    const input = screen.getByPlaceholderText("Filename.tsx");
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Filename.tsx")).toBeNull();
    });
    expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
  });

  it("opens an inline folder input instead of prompting", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    renderTree();

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));

    const input = screen.getByRole("textbox", { name: "New folder name" });
    expect(promptSpy).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "pages" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("pages")).toBeTruthy();
    });
    expect(saveStorefrontThemeFile).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem("morph:pending-folders:store-1:theme-1"),
    ).toContain("pages");
    promptSpy.mockRestore();
  });

  it("cancels an inline folder input with Escape", async () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));

    const input = screen.getByRole("textbox", { name: "New folder name" });
    fireEvent.change(input, { target: { value: "pages" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "New folder name" }),
      ).toBeNull();
    });
    expect(
      window.localStorage.getItem("morph:pending-folders:store-1:theme-1"),
    ).toBeNull();
  });

  it("offers folder creation and deletion without a move action", async () => {
    renderTree();
    fireEvent.contextMenu(screen.getByText("components"));

    expect(
      await screen.findByRole("menuitem", { name: "New Folder" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Delete Folder" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Move Folder" })).toBeNull();
  });

  it("deletes a folder and all of its files in one batch", async () => {
    vi.mocked(saveStorefrontThemeFilesBatch).mockResolvedValue({
      success: true,
      message: "ok",
      data: { sourceGeneration: 8, files: [] },
    } as never);
    renderTree();

    fireEvent.contextMenu(screen.getByText("components"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete Folder" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(saveStorefrontThemeFilesBatch).toHaveBeenCalledTimes(1),
    );
    const payload = vi.mocked(saveStorefrontThemeFilesBatch).mock
      .calls[0]![0] as {
      data: { deletions: Array<{ path: string }> };
    };
    expect(payload.data.deletions).toEqual([
      expect.objectContaining({ path: "src/components/Hero.tsx" }),
    ]);
  });

  it("duplicates a file through the create precondition", async () => {
    vi.mocked(saveStorefrontThemeFile).mockResolvedValue({
      success: true,
      message: "ok",
      data: { ...file, id: "file-2", path: "src/components/Hero-copy.tsx" },
    } as never);
    renderTree();
    fireEvent.contextMenu(screen.getAllByText("Hero.tsx")[0]!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() => {
      expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(saveStorefrontThemeFile).mock.calls[0]![0]).toEqual({
      data: expect.objectContaining({
        path: "src/components/Hero-copy.tsx",
        content: file.content,
        expectMissing: true,
      }),
    });
  });

  it("duplicates the active file's unsaved editor buffer", async () => {
    vi.mocked(saveStorefrontThemeFile).mockResolvedValue({
      success: true,
      message: "ok",
      data: { ...file, id: "file-2", path: "src/components/Hero-copy.tsx" },
    } as never);
    renderTree();
    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "unsaved draft" },
    });
    fireEvent.contextMenu(screen.getAllByText("Hero.tsx")[0]!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() => {
      expect(saveStorefrontThemeFile).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(saveStorefrontThemeFile).mock.calls[0]![0]).toEqual({
      data: expect.objectContaining({
        path: "src/components/Hero-copy.tsx",
        content: "unsaved draft",
      }),
    });
  });

  it("does not offer New File Here from a file context menu", async () => {
    renderTree();
    fireEvent.contextMenu(screen.getAllByText("Hero.tsx")[0]!);

    expect(
      await screen.findByRole("menuitem", { name: "Duplicate" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "New File Here" }),
    ).toBeNull();
  });

  it("offers Rename inline without a move prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    vi.mocked(saveStorefrontThemeFilesBatch).mockResolvedValue({
      success: true,
      message: "ok",
      data: { sourceGeneration: 8 },
    } as never);
    renderTree();

    fireEvent.contextMenu(screen.getAllByText("Hero.tsx")[0]!);
    expect(
      await screen.findByRole("menuitem", { name: "Rename" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Move or Rename" }),
    ).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move File" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", {
      name: "Rename src/components/Hero.tsx",
    });
    expect(promptSpy).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("Hero.tsx");
    fireEvent.change(input, { target: { value: "Banner.tsx" } });
    expect(document.body.contains(input)).toBe(true);
    expect((input as HTMLInputElement).value).toBe("Banner.tsx");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(saveStorefrontThemeFilesBatch).toHaveBeenCalledTimes(1);
    });
    const payload = vi.mocked(saveStorefrontThemeFilesBatch).mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(payload.data.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/components/Banner.tsx" }),
      ]),
    );
    expect(payload.data.deletions).toEqual([
      expect.objectContaining({ path: "src/components/Hero.tsx" }),
    ]);
    promptSpy.mockRestore();
  });
});

describe("EditorCodeWorkspace binary files", () => {
  const hero: StorefrontThemeBinaryFileDTO = {
    id: "binary-1",
    storefrontId: "store-1",
    themeId: "theme-1",
    path: "public/images/hero.png",
    encoding: "binary",
    blobDigest: "d".repeat(64),
    sizeBytes: 2048,
    mimeType: "image/png",
    isEntry: false,
    version: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const tree: StorefrontThemeFileTreeNode[] = [
    {
      name: "public",
      path: "public",
      isDirectory: true,
      children: [
        {
          name: "images",
          path: "public/images",
          isDirectory: true,
          children: [
            {
              name: "hero.png",
              path: hero.path,
              isDirectory: false,
              size: hero.sizeBytes,
              mimeType: hero.mimeType,
              encoding: "binary",
            },
          ],
        },
      ],
    },
    { name: "Hero.tsx", path: file.path, isDirectory: false },
  ];

  // Hero.tsx names the image's URL, so a move or a deletion of it has a
  // known reference to show.
  const naming = {
    ...file,
    content: `export default () => <img src="/images/hero.png" alt="" />;\n`,
  };

  function renderWithBinary(sourceFiles: StorefrontThemeFileDTO[] = [file]) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={client}>
        <EditorCodeWorkspace
          storefrontId="store-1"
          themeId="theme-1"
          files={sourceFiles}
          binaryFiles={[hero]}
          tree={tree}
        />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    vi.mocked(saveStorefrontThemeFilesBatch).mockReset();
    vi.mocked(deleteStorefrontThemeFile).mockReset();
    window.localStorage.clear();
    // Every workspace, not just the active one's files: the review reads
    // saved content from the store, and one left by an earlier test would
    // read as an unsaved draft here.
    useThemeWorkspaceStore.setState({ files: {}, workspaces: {} });
    vi.spyOn(toast, "error").mockImplementation(() => "toast");
  });

  it("lists a binary file and opens its details instead of an editor", async () => {
    renderWithBinary();

    fireEvent.click(screen.getByText("hero.png"));

    const details = await screen.findByText("/images/hero.png");
    expect(details).toBeTruthy();
    expect(screen.getByText("d".repeat(64))).toBeTruthy();
    expect(screen.getByText("image/png")).toBeTruthy();
    expect(screen.queryByLabelText("Code editor")).toBeNull();
  });

  it("keeps a row's open menu through a re-render of the workspace", async () => {
    // A row component declared inside the workspace was a new component on
    // every render, so React remounted the row and its open menu closed —
    // in a real browser, whenever a preview restart re-rendered the editor.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const element = (sourceFiles: StorefrontThemeFileDTO[]) => (
      <QueryClientProvider client={client}>
        <EditorCodeWorkspace
          storefrontId="store-1"
          themeId="theme-1"
          files={sourceFiles}
          binaryFiles={[hero]}
          tree={tree}
        />
      </QueryClientProvider>
    );
    const view = render(element([file]));

    fireEvent.contextMenu(screen.getByText("hero.png"));
    expect(
      await screen.findByRole("menuitem", { name: /Replace…/ }),
    ).toBeTruthy();

    view.rerender(element([{ ...file }]));

    expect(screen.getByRole("menuitem", { name: /Replace…/ })).toBeTruthy();
  });

  it("offers copy, rename, replace and delete — not duplicate", async () => {
    renderWithBinary();

    fireEvent.contextMenu(screen.getByText("hero.png"));

    for (const name of [/^Copy$/, /^Rename$/, /Replace…/, /^Delete$/]) {
      expect(await screen.findByRole("menuitem", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("menuitem", { name: "Duplicate" })).toBeNull();
  });

  it("deletes a folder with its binary files in one batch, having shown what names them", async () => {
    vi.mocked(saveStorefrontThemeFilesBatch).mockResolvedValue({
      success: true,
      message: "ok",
      data: { sourceGeneration: 8, files: [] },
    } as never);
    renderWithBinary([naming]);

    fireEvent.contextMenu(screen.getByText("public"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete Folder" }),
    );

    // Before anything is written: the URL that stops working, and where.
    const review = await screen.findByText("/images/hero.png (removed)");
    expect(review).toBeTruthy();
    expect(
      document.querySelector('[data-public-url-reference="known"]')
        ?.textContent,
    ).toContain("src/components/Hero.tsx:1");
    expect(saveStorefrontThemeFilesBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(saveStorefrontThemeFilesBatch).toHaveBeenCalledTimes(1),
    );
    const payload = vi.mocked(saveStorefrontThemeFilesBatch).mock
      .calls[0]![0] as { data: { deletions: unknown[] } };
    expect(payload.data.deletions).toEqual([
      {
        path: hero.path,
        expectedFileId: hero.id,
        expectedVersion: hero.version,
      },
    ]);
  });

  it("pastes a copied folder's binary files as references to their source", async () => {
    vi.mocked(saveStorefrontThemeFilesBatch).mockResolvedValue({
      success: true,
      message: "ok",
      data: { sourceGeneration: 8, files: [] },
    } as never);
    renderWithBinary();

    fireEvent.contextMenu(screen.getByText("images"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy" }));
    fireEvent.contextMenu(screen.getByText("public"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Paste" }));

    await waitFor(() =>
      expect(saveStorefrontThemeFilesBatch).toHaveBeenCalledTimes(1),
    );
    const payload = vi.mocked(saveStorefrontThemeFilesBatch).mock
      .calls[0]![0] as {
      data: { binaryCopies: Array<Record<string, unknown>> };
    };
    expect(payload.data.binaryCopies).toEqual([
      expect.objectContaining({
        from: hero.path,
        expectedFileId: hero.id,
        expectedVersion: hero.version,
      }),
    ]);
    const to = payload.data.binaryCopies[0]!.to as string;
    expect(to.startsWith("public/")).toBe(true);
    expect(to.endsWith("/hero.png")).toBe(true);
    // No digest travels from the client: the server reads the source's.
    expect(payload.data.binaryCopies[0]).not.toHaveProperty("blobDigest");
  });

  describe("moving a binary file", () => {
    const rename = async (to: string) => {
      fireEvent.contextMenu(screen.getByText("hero.png"));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
      const input = screen.getByRole("textbox", {
        name: `Rename ${hero.path}`,
      });
      fireEvent.change(input, { target: { value: to } });
      fireEvent.keyDown(input, { key: "Enter" });
    };

    beforeEach(() => {
      vi.mocked(saveStorefrontThemeFilesBatch).mockResolvedValue({
        success: true,
        message: "ok",
        data: { sourceGeneration: 8, files: [] },
      } as never);
    });

    const reviewDialog = () =>
      waitFor(() => {
        const found = document.querySelector("[data-binary-move-review]");
        expect(found).not.toBeNull();
        return found!;
      });
    const batchPayload = () =>
      vi.mocked(saveStorefrontThemeFilesBatch).mock.calls[0]![0] as {
        data: {
          files: unknown[];
          binaryCopies: unknown[];
          deletions: unknown[];
          publicUrlRewrite?: unknown;
        };
      };

    it("is held for review, with the references it updates, before anything is written", async () => {
      renderWithBinary([naming]);
      await rename("banner.png");

      const dialog = await reviewDialog();
      expect(dialog.textContent).toContain(
        "/images/hero.png → /images/banner.png",
      );
      expect(
        dialog.querySelector(
          '[data-public-url-rewrite="src/components/Hero.tsx:1"]',
        ),
      ).not.toBeNull();
      expect(saveStorefrontThemeFilesBatch).not.toHaveBeenCalled();

      // Every reference found is updated, so there is nothing to accept.
      expect(screen.queryByRole("checkbox")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Move and update 1 reference" }),
      );

      await waitFor(() =>
        expect(saveStorefrontThemeFilesBatch).toHaveBeenCalledTimes(1),
      );
      const payload = batchPayload();
      expect(payload.data.binaryCopies).toEqual([
        {
          from: hero.path,
          to: "public/images/banner.png",
          expectedFileId: hero.id,
          expectedVersion: hero.version,
        },
      ]);
      expect(payload.data.deletions).toEqual([
        {
          path: hero.path,
          expectedFileId: hero.id,
          expectedVersion: hero.version,
        },
      ]);
      // The server rewrites the file itself; the editor sends what it
      // reviewed, not the rewritten content.
      expect(payload.data.files).toEqual([]);
      expect(payload.data.publicUrlRewrite).toEqual({
        moves: [{ from: hero.path, to: "public/images/banner.png" }],
        expected: {
          paths: [naming.path],
          rewriteCount: 1,
          unresolvedCount: 0,
        },
        acknowledgeUnresolved: false,
      });
    });

    it("copies and updates the references, keeping the old URL", async () => {
      renderWithBinary([naming]);
      await rename("banner.png");

      fireEvent.click(
        await screen.findByRole("button", {
          name: "Copy and update 1 reference",
        }),
      );

      await waitFor(() =>
        expect(saveStorefrontThemeFilesBatch).toHaveBeenCalledTimes(1),
      );
      const payload = batchPayload();
      expect(payload.data.binaryCopies).toHaveLength(1);
      expect(payload.data.deletions).toEqual([]);
      expect(payload.data.publicUrlRewrite).toMatchObject({
        expected: { rewriteCount: 1 },
      });
    });

    it("keeps the old file by default while a reference cannot be updated", async () => {
      renderWithBinary([
        {
          ...naming,
          content: [
            'export const hero = "/images/hero.png";',
            "export const pick = (name: string) => `/images/${name}.png`;",
          ].join("\n"),
        },
      ]);
      await rename("banner.png");

      const dialog = await reviewDialog();
      expect(
        dialog.querySelector('[data-public-url-unresolved="built-at-runtime"]')
          ?.textContent,
      ).toContain(`${naming.path}:2`);

      // Moving would remove a URL something may still build: it waits for
      // the author to accept that.
      const move = screen.getByRole("button", {
        name: "Move and update 1 reference",
      }) as HTMLButtonElement;
      expect(move.disabled).toBe(true);
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: "I understand these references will break",
        }),
      );
      expect(move.disabled).toBe(false);
      fireEvent.click(move);

      await waitFor(() =>
        expect(saveStorefrontThemeFilesBatch).toHaveBeenCalledTimes(1),
      );
      expect(batchPayload().data.publicUrlRewrite).toMatchObject({
        expected: { rewriteCount: 1, unresolvedCount: 1 },
        acknowledgeUnresolved: true,
      });
    });

    it("does not update references while an unsaved draft names the URL", async () => {
      renderWithBinary([naming]);
      fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
        target: {
          value: 'export default () => <img src="/images/hero.png" />;\n',
        },
      });
      await rename("banner.png");

      const dialog = await reviewDialog();
      expect(
        dialog.querySelector("[data-public-url-rewrite-blocked]")?.textContent,
      ).toContain(naming.path);
      expect(screen.queryByRole("button", { name: /update/ })).toBeNull();
      // What it names is still shown, and moving still needs saying so.
      expect(dialog.textContent).toContain(`${naming.path}:1`);
      expect(
        (screen.getByRole("button", { name: "Move" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    it("copies instead, keeping the old URL, when nothing names it", async () => {
      renderWithBinary();
      await rename("banner.png");

      fireEvent.click(
        await screen.findByRole("button", { name: "Copy, keep old URLs" }),
      );

      await waitFor(() =>
        expect(saveStorefrontThemeFilesBatch).toHaveBeenCalledTimes(1),
      );
      const payload = batchPayload();
      expect(payload.data.binaryCopies).toHaveLength(1);
      expect(payload.data.deletions).toEqual([]);
      expect(payload.data.publicUrlRewrite).toBeUndefined();
    });

    it("never claims there are no references, even when none were found", async () => {
      renderWithBinary();
      await rename("banner.png");

      const dialog = await reviewDialog();
      expect(dialog.textContent).toContain(
        "No URL written out in full was found in Theme source.",
      );
      expect(dialog.textContent).toContain(
        "Page content and other sites that link to these URLs are not checked, so there may be more.",
      );
      // Nothing known to break: no acknowledgement to ask for.
      expect(
        (screen.getByRole("button", { name: "Move" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
  });

  it("asks before deleting a binary file, then deletes it by its own id and version", async () => {
    vi.mocked(deleteStorefrontThemeFile).mockResolvedValue({
      success: true,
      message: "ok",
      data: { path: hero.path, sourceGeneration: 8 },
    } as never);
    useThemeWorkspaceStore.getState().acceptRemoteGeneration(7, {
      storefrontId: "store-1",
      themeId: "theme-1",
    });
    renderWithBinary();

    fireEvent.click(screen.getByText("hero.png"));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "Delete" });
    expect(deleteStorefrontThemeFile).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteStorefrontThemeFile).toHaveBeenCalledTimes(1),
    );
    expect(vi.mocked(deleteStorefrontThemeFile).mock.calls[0]![0]).toEqual({
      data: {
        storefrontId: "store-1",
        themeId: "theme-1",
        path: hero.path,
        expectedFileId: hero.id,
        expectedVersion: hero.version,
        expectedSourceGeneration: 7,
      },
    });
  });

  describe("writing binary files", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(7, {
        storefrontId: "store-1",
        themeId: "theme-1",
      });
      fetchMock = vi.fn(async (url: string) => {
        const path = new URL(url, "http://localhost").searchParams.get("path");
        return new Response(
          JSON.stringify({
            success: true,
            data: { ...hero, path, id: "binary-2", sourceGeneration: 8 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const choose = (selector: string, chosen: File[]) => {
      const input = document.querySelector<HTMLInputElement>(selector)!;
      Object.defineProperty(input, "files", {
        value: chosen,
        configurable: true,
      });
      fireEvent.change(input);
    };

    const sent = (call: number) => {
      const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
      return {
        url: new URL(url, "http://localhost"),
        init,
      };
    };

    it("uploads into a folder under public/ as a new file, naming the source generation", async () => {
      renderWithBinary();
      const logo = new File([new Uint8Array([0x89, 0x50])], "logo.png", {
        type: "image/png",
      });

      fireEvent.contextMenu(screen.getByText("images"));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /Upload Files…/ }),
      );
      choose("[data-code-upload-input]", [logo]);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const { url, init } = sent(0);
      expect(url.pathname).toBe("/api/storefront/theme-binary-file");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        storefrontId: "store-1",
        themeId: "theme-1",
        path: "public/images/logo.png",
        expectedSourceGeneration: "7",
        expectMissing: "1",
      });
      expect(init.method).toBe("POST");
      expect(init.body).toBe(logo);
      await waitFor(() =>
        expect(
          useThemeWorkspaceStore.getState().getAcceptedSourceGeneration({
            storefrontId: "store-1",
            themeId: "theme-1",
          }),
        ).toBe(8),
      );
    });

    it("replaces a binary file by its id and version", async () => {
      renderWithBinary();
      const next = new File([new Uint8Array([1, 2, 3])], "other.png", {
        type: "image/png",
      });

      fireEvent.contextMenu(screen.getByText("hero.png"));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /Replace…/ }),
      );
      choose("[data-code-replace-input]", [next]);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(Object.fromEntries(sent(0).url.searchParams)).toEqual({
        storefrontId: "store-1",
        themeId: "theme-1",
        path: hero.path,
        expectedSourceGeneration: "7",
        expectedFileId: hero.id,
        expectedVersion: String(hero.version),
      });
    });

    it("refuses to upload over an existing file before asking the server", async () => {
      renderWithBinary();
      const same = new File([new Uint8Array([1])], "hero.png", {
        type: "image/png",
      });

      fireEvent.contextMenu(screen.getByText("images"));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /Upload Files…/ }),
      );
      choose("[data-code-upload-input]", [same]);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "public/images/hero.png already exists. Replace it from its menu instead.",
        ),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uploads into public/ from the Explorer toolbar", async () => {
      renderWithBinary();
      const font = new File([new Uint8Array([0x77])], "brand.woff2", {
        type: "font/woff2",
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Upload files to public/" }),
      );
      choose("[data-code-upload-input]", [font]);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(sent(0).url.searchParams.get("path")).toBe("public/brand.woff2");
    });
  });
});
