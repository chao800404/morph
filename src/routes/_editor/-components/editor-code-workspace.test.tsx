import { useEffect, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { EditorCodeWorkspace } from "./editor-code-workspace";

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
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => {
      const model = {
        getValue: () => valueRef.current,
        setValue: (next: string) => {
          valueRef.current = next;
          setValue(next);
        },
      };
      onMount?.(
        { getModel: () => model },
        { editor: { getModels: () => [model] } },
      );
    }, [onMount]);

    return (
      <textarea
        aria-label="Code editor"
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
  onSaveFile?: (path: string, content: string) => Promise<StorefrontThemeFileDTO | null>;
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
});
