import { useEffect, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import {
  deleteStorefrontThemeFile,
  saveStorefrontThemeFile,
  saveStorefrontThemeFilesBatch,
} from "@/server/storefront/storefront-theme-files.serverFn";
import { EditorCodeWorkspace } from "./editor-code-workspace";
import { configureThemeTypeScript } from "./editor-code-language-support";
import { formatEditorCode } from "./editor-code-formatter";

const monacoTestState = vi.hoisted(() => ({
  formatter: null as null | ((content: string) => string | Promise<string>),
  formatError: false,
}));

vi.mock(
  "@/server/storefront/storefront-theme-files.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/server/storefront/storefront-theme-files.serverFn")
    >()),
    deleteStorefrontThemeFile: vi.fn(),
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
  }: {
    defaultValue?: string;
    onChange?: (value?: string) => void;
    beforeMount?: (monaco: unknown) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    theme?: string;
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
        },
        monaco,
      );
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

function renderWorkspace(props?: {
  onSaveFile?: (
    path: string,
    content: string,
  ) => Promise<StorefrontThemeFileDTO | null>;
  onDirtyFilesChange?: (paths: string[]) => void;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditorCodeWorkspace
        storefrontId="store-1"
        themeId="theme-1"
        files={[file]}
        tree={[
          {
            name: "Hero.tsx",
            path: file.path,
            isDirectory: false,
          },
        ]}
        onSaveFile={props?.onSaveFile}
        onDirtyFilesChange={props?.onDirtyFilesChange}
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
    vi.mocked(configureThemeTypeScript).mockClear();
    vi.mocked(formatEditorCode).mockClear();
    monacoTestState.formatter = null;
    monacoTestState.formatError = false;
  });

  it("uses Monaco's built-in dark theme without defining a custom theme", () => {
    renderWorkspace();
    expect(
      screen
        .getByRole("textbox", { name: "Code editor" })
        .getAttribute("data-theme"),
    ).toBe("vs-dark");
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
