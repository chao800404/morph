import { useEffect, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { deleteStorefrontThemeFile } from "@/server/storefront/storefront-theme-files.serverFn";
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
          deltaDecorations: vi.fn(
            (_oldIds: string[], next: unknown[]) =>
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
      (onMount as unknown as ((editor: unknown, monaco: unknown) => void))?.(
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
      screen.getByRole("textbox", { name: "Code editor" }).getAttribute("data-theme"),
    ).toBe("vs-dark" );
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
      expect(onSaveFile).toHaveBeenCalledWith(
        file.path,
        "formatted(draft)",
      ),
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
      expect(onSaveFile).toHaveBeenCalledWith(
        file.path,
        "unformatted draft",
      ),
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
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace();

    fireEvent.change(screen.getByRole("textbox", { name: "Code editor" }), {
      target: { value: "dirty" },
    });
    fireEvent.contextMenu(screen.getAllByText("Hero.tsx")[0]);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Delete File/i }),
    );

    expect(deleteStorefrontThemeFile).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
