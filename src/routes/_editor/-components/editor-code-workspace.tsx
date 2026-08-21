import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { cn } from "@/lib/utils";
import type {
  StorefrontThemeFileDTO,
  StorefrontThemeFileTreeNode,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import {
  initStorefrontStarterTheme,
  saveStorefrontThemeFile,
} from "@/server/storefront/storefront-theme-files.serverFn";
import Editor from "@monaco-editor/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  Paintbrush,
  Save,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";

type EditorCodeWorkspaceProps = {
  storefrontId: string;
  themeId: string;
  files: StorefrontThemeFileDTO[];
  tree: StorefrontThemeFileTreeNode[];
  initialActiveFilePath?: string;
  jumpLocation?: { filePath: string; line?: number; column?: number };
  externalConflictFiles?: Record<
    string,
    { remoteVersion: number; remoteContent: string }
  >;
  onResolveConflict?: (
    path: string,
    resolution: "reload" | "force_mine",
  ) => void;
  onRefreshPreview?: () => void;
  onDirtyFilesChange?: (dirtyPaths: string[]) => void;
  onSaveFile?: (
    path: string,
    content: string,
  ) => Promise<StorefrontThemeFileDTO | null>;
};

function getFileIcon(filename: string) {
  if (filename.endsWith(".tsx") || filename.endsWith(".ts")) {
    return <FileCode2 className="size-3.5 text-blue-500 shrink-0" />;
  }
  if (filename.endsWith(".css")) {
    return <Paintbrush className="size-3.5 text-cyan-500 shrink-0" />;
  }
  if (filename.endsWith(".json")) {
    return <FileJson className="size-3.5 text-amber-500 shrink-0" />;
  }
  return <FileText className="size-3.5 text-muted-foreground shrink-0" />;
}

function getLanguage(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".html")) return "html";
  return "plaintext";
}

export const EditorCodeWorkspace = memo(function EditorCodeWorkspace({
  storefrontId,
  themeId,
  files,
  tree,
  initialActiveFilePath,
  jumpLocation,
  externalConflictFiles,
  onResolveConflict,
  onRefreshPreview,
  onDirtyFilesChange,
  onSaveFile,
}: EditorCodeWorkspaceProps) {
  const queryClient = useQueryClient();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  // Find initial active file (default to Hero.tsx or index.tsx)
  const defaultFile = useMemo(() => {
    return (
      files.find((f) => f.path === "src/components/Hero.tsx") ??
      files.find((f) => f.isEntry) ??
      files[0]
    );
  }, [files]);

  const [activeFilePath, setActiveFilePath] = useState<string>(
    jumpLocation?.filePath ?? defaultFile?.path ?? "src/components/Hero.tsx",
  );
  const [openTabs, setOpenTabs] = useState<string[]>([
    jumpLocation?.filePath ?? defaultFile?.path ?? "src/components/Hero.tsx",
  ]);
  const workspaceScope = useMemo(
    () => ({ storefrontId, themeId }),
    [storefrontId, themeId],
  );
  const activeFileDirty = useThemeWorkspaceStore((state) =>
    Boolean(state.files[activeFilePath]?.dirty),
  );
  const activeFileConflict = useThemeWorkspaceStore(
    (state) => state.files[activeFilePath]?.conflict,
  );
  const activeServerContent = useThemeWorkspaceStore(
    (state) => state.files[activeFilePath]?.serverContent ?? null,
  );
  const updateWorkspaceLocal = useThemeWorkspaceStore((state) => state.updateLocalContent);
  const markWorkspaceSaving = useThemeWorkspaceStore((state) => state.markSaving);
  const markWorkspaceSaved = useThemeWorkspaceStore((state) => state.markSaved);
  const markWorkspaceError = useThemeWorkspaceStore((state) => state.markError);
  const discardWorkspaceLocal = useThemeWorkspaceStore((state) => state.discardLocalChanges);
  const [collapsedFolders, setCollapsedFolders] = useState<
    Record<string, boolean>
  >({});
  const [dirtyPaths, setDirtyPaths] = useState<string[]>(() =>
    useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope),
  );
  const draftContentsRef = useRef<Record<string, string>>({});
  const draftDirtyRef = useRef<Record<string, boolean>>({});
  const draftRevisionRef = useRef<Record<string, number>>({});
  const combinedDirtyPathsRef = useRef(dirtyPaths);
  const suppressModelChangeRef = useRef(false);

  useEffect(() => {
    if (initialActiveFilePath) {
      setActiveFilePath(initialActiveFilePath);
      setOpenTabs((prev) =>
        prev.includes(initialActiveFilePath)
          ? prev
          : [...prev, initialActiveFilePath],
      );
    }
  }, [initialActiveFilePath]);

  useEffect(() => {
    if (jumpLocation?.filePath) {
      setActiveFilePath(jumpLocation.filePath);
      setOpenTabs((prev) =>
        prev.includes(jumpLocation.filePath)
          ? prev
          : [...prev, jumpLocation.filePath],
      );

      if (editorRef.current && jumpLocation.line) {
        setTimeout(() => {
          editorRef.current?.revealPositionInCenter({
            lineNumber: jumpLocation.line,
            column: jumpLocation.column ?? 1,
          });
          editorRef.current?.setPosition({
            lineNumber: jumpLocation.line,
            column: jumpLocation.column ?? 1,
          });
          editorRef.current?.focus();
        }, 50);
      }
    }
  }, [jumpLocation]);

  // Auto-fallback if current activeFilePath does not exist in loaded workspace files
  useEffect(() => {
    if (files.length > 0 && !files.some((f) => f.path === activeFilePath)) {
      const fallback = defaultFile?.path ?? files[0].path;
      setActiveFilePath(fallback);
      setOpenTabs((prev) =>
        prev.includes(fallback) ? prev : [...prev, fallback],
      );
    }
  }, [files, activeFilePath, defaultFile]);


  const activeFile = useMemo(() => {
    return files.find((f) => f.path === activeFilePath);
  }, [files, activeFilePath]);

  const getFileBaseline = useCallback(
    (path: string) => {
      const workspaceFile = useThemeWorkspaceStore.getState().files[path];
      return (
        workspaceFile?.serverContent ??
        files.find((file) => file.path === path)?.content ??
        ""
      );
    },
    [files],
  );

  const getInitialEditorContent = useCallback(
    (path: string) => {
      if (draftContentsRef.current[path] !== undefined) {
        return draftContentsRef.current[path];
      }
      const workspaceFile = useThemeWorkspaceStore.getState().files[path];
      return (
        workspaceFile?.localContent ??
        files.find((file) => file.path === path)?.content ??
        ""
      );
    },
    [files],
  );

  const getCurrentEditorContent = useCallback(
    (path: string) => {
      if (draftContentsRef.current[path] !== undefined) {
        return draftContentsRef.current[path];
      }
      if (path === activeFilePath) {
        const modelContent = editorRef.current?.getModel?.()?.getValue?.();
        if (typeof modelContent === "string") return modelContent;
      }
      return getInitialEditorContent(path);
    },
    [activeFilePath, getInitialEditorContent],
  );

  const syncCombinedDirtyPaths = useCallback(
    (storePaths: string[]) => {
      const localPaths = Object.entries(draftDirtyRef.current)
        .filter(([, dirty]) => dirty)
        .map(([path]) => path);
      const next = [...storePaths, ...localPaths.filter((path) => !storePaths.includes(path))];
      const previous = combinedDirtyPathsRef.current;
      if (
        next.length === previous.length &&
        next.every((path, index) => path === previous[index])
      ) {
        return;
      }
      combinedDirtyPathsRef.current = next;
      setDirtyPaths(next);
      onDirtyFilesChange?.(next);
    },
    [onDirtyFilesChange],
  );

  useEffect(() => {
    const model = editorRef.current?.getModel?.();
    if (
      !model ||
      activeFileDirty ||
      draftDirtyRef.current[activeFilePath] ||
      activeServerContent === null
    ) {
      return;
    }
    if (model.getValue() === activeServerContent) return;

    // Remote reloads and successful saves update the model only at the
    // source boundary. Never replace an in-progress transient draft.
    suppressModelChangeRef.current = true;
    model.setValue(activeServerContent);
    suppressModelChangeRef.current = false;
    draftContentsRef.current[activeFilePath] = activeServerContent;
    draftDirtyRef.current[activeFilePath] = false;
  }, [activeFileDirty, activeFilePath, activeServerContent]);

  const saveMutation = useMutation({
    mutationFn: async ({
      path,
      content,
    }: {
      path: string;
      content: string;
      draftRevision: number;
    }) => {
      markWorkspaceSaving(path, workspaceScope);
      if (onSaveFile) return onSaveFile(path, content);

      const state = useThemeWorkspaceStore
        .getState()
        .getWorkspaceFiles(
          workspaceScope.storefrontId,
          workspaceScope.themeId,
        )[path];
      const res = await saveStorefrontThemeFile({
        data: {
          storefrontId,
          themeId,
          path,
          content,
          expectedFileId: state?.serverExists
            ? state.serverFileId ?? undefined
            : undefined,
          expectedVersion: state?.serverExists
            ? state.serverVersion ?? undefined
            : undefined,
          expectMissing: state ? !state.serverExists : true,
          expectedSourceGeneration: useThemeWorkspaceStore
            .getState()
            .getAcceptedSourceGeneration(workspaceScope),
        },
      });
      if (!res.success) {
        if (res.error === "SOURCE_GENERATION_CONFLICT") {
          useThemeWorkspaceStore.getState().markDirty(path, workspaceScope);
          await queryClient.invalidateQueries({
            queryKey: storefrontThemeFileQueries.tree(storefrontId, themeId).queryKey,
          });
          toast.error("Remote source changes detected in this theme.", {
            action: {
              label: "Accept Remote",
              onClick: () => {
                useThemeWorkspaceStore
                  .getState()
                  .acceptRemoteGeneration(undefined, workspaceScope);
                toast.success(
                  "Remote source generation accepted. You can now save your local changes.",
                );
              },
            },
          });
          return null;
        }
        throw new Error(res.message);
      }
      return res.data;
    },
    onSuccess: (saved, variables) => {
      if (!saved) return;
      const isLatestDraft =
        (draftRevisionRef.current[saved.path] ?? 0) ===
          variables.draftRevision &&
        draftContentsRef.current[saved.path] === variables.content;
      if (isLatestDraft) {
        draftDirtyRef.current[saved.path] = false;
        draftContentsRef.current[saved.path] = variables.content;
      }
      markWorkspaceSaved(saved, workspaceScope);
      syncCombinedDirtyPaths(
        useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope),
      );
      queryClient.invalidateQueries({
        queryKey: storefrontThemeFileQueries.all(),
      });
      toast.success(`Saved ${saved.path}`);
      onRefreshPreview?.();
    },
    onError: (err, variables) => {
      const fileState = useThemeWorkspaceStore
        .getState()
        .getWorkspaceFiles(
          workspaceScope.storefrontId,
          workspaceScope.themeId,
        )[variables.path];
      if (
        fileState?.saveState === "dirty" ||
        fileState?.saveState === "conflict"
      ) {
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to save file";
      markWorkspaceError(variables.path, message, workspaceScope);
      toast.error(message);
    },
  });

  const initMutation = useMutation({
    mutationFn: async () => {
      const res = await initStorefrontStarterTheme({
        data: {
          storefrontId,
          themeId,
        },
      });
      if (!res.success) {
        throw new Error(res.message);
      }
      return res.data;
    },
    onSuccess: async (data) => {
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(
        data.sourceGeneration,
        workspaceScope,
      );
      toast.success("Starter theme workspace initialized");
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeFileQueries.tree(storefrontId, themeId).queryKey,
      });
      onRefreshPreview?.();
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to initialize starter theme");
    },
  });

  const handleContentChange = (value?: string) => {
    if (value === undefined) return;
    if (suppressModelChangeRef.current) return;

    const path = activeFilePath;
    draftContentsRef.current[path] = value;
    draftRevisionRef.current[path] =
      (draftRevisionRef.current[path] ?? 0) + 1;
    const isDirty = value !== getFileBaseline(path);
    const wasDirty =
      draftDirtyRef.current[path] ??
      Boolean(useThemeWorkspaceStore.getState().files[path]?.dirty);

    // Monaco owns the transient buffer. Keep the global workspace untouched
    // until Save; only the semantic dirty-path summary is updated here.
    if (isDirty !== wasDirty) {
      draftDirtyRef.current[path] = isDirty;
      syncCombinedDirtyPaths(
        useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope),
      );
    }
  };

  useEffect(() => {
    syncCombinedDirtyPaths(
      useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope),
    );

    return useThemeWorkspaceStore.subscribe(() => {
      const next = useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope);
      syncCombinedDirtyPaths(next);
    });
  }, [syncCombinedDirtyPaths, workspaceScope]);

  const dirtyPathSet = useMemo(() => new Set(dirtyPaths), [dirtyPaths]);

  const handleSaveCurrentFile = useCallback(() => {
    if (!activeFilePath || saveMutation.isPending) return;
    const content = getCurrentEditorContent(activeFilePath);
    const draftRevision = draftRevisionRef.current[activeFilePath] ?? 0;
    // Save is the source/workspace boundary: sync the complete transient
    // Monaco model exactly once before invoking the existing OCC mutation.
    updateWorkspaceLocal(activeFilePath, content, workspaceScope);
    saveMutation.mutate({ path: activeFilePath, content, draftRevision });
  }, [
    activeFilePath,
    getCurrentEditorContent,
    saveMutation,
    updateWorkspaceLocal,
    workspaceScope,
  ]);

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveCurrentFile();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveCurrentFile]);

  const handleOpenFile = (path: string) => {
    setActiveFilePath(path);
    if (!openTabs.includes(path)) {
      setOpenTabs((prev) => [...prev, path]);
    }
  };

  const handleCloseTab = (path: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const workspaceFile = useThemeWorkspaceStore.getState().files[path];
    if (workspaceFile?.dirty || draftDirtyRef.current[path]) {
      const confirmed = window.confirm(
        `File "${path}" has unsaved changes. Discard changes and close tab?`,
      );
      if (!confirmed) return;
    }
    const nextTabs = openTabs.filter((p) => p !== path);
    setOpenTabs(nextTabs);
    const baseline = getFileBaseline(path);
    delete draftContentsRef.current[path];
    delete draftDirtyRef.current[path];
    delete draftRevisionRef.current[path];
    syncCombinedDirtyPaths(
      useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope),
    );
    discardWorkspaceLocal(path, workspaceScope);

    const models = monacoRef.current?.editor?.getModels?.() ?? [];
    for (const model of models) {
      const modelPath = model.uri?.path?.replace(/^\/+/, "") ?? "";
      if (modelPath === path || modelPath.endsWith(`/${path}`)) {
        suppressModelChangeRef.current = true;
        model.setValue(baseline);
        suppressModelChangeRef.current = false;
      }
    }

    if (activeFilePath === path) {
      setActiveFilePath(nextTabs[nextTabs.length - 1] ?? "");
    }
  };

  const toggleFolder = (path: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const renderTreeNode = (node: StorefrontThemeFileTreeNode, depth = 0) => {
    if (node.isDirectory) {
      const isCollapsed = Boolean(collapsedFolders[node.path]);
      return (
        <div key={node.path} className="select-none">
          <div
            onClick={() => toggleFolder(node.path)}
            className="flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {isCollapsed ? (
              <ChevronRight className="size-3 shrink-0" />
            ) : (
              <ChevronDown className="size-3 shrink-0" />
            )}
            {isCollapsed ? (
              <Folder className="size-3.5 text-amber-500/80 shrink-0" />
            ) : (
              <FolderOpen className="size-3.5 text-amber-500 shrink-0" />
            )}
            <span className="font-medium truncate">{node.name}</span>
          </div>
          {!isCollapsed && node.children ? (
            <div>
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          ) : null}
        </div>
      );
    }

    const isActive = activeFilePath === node.path;
    const isDirty = dirtyPathSet.has(node.path);

    return (
      <div
        key={node.path}
        onClick={() => handleOpenFile(node.path)}
        className={cn(
          "flex cursor-pointer items-center justify-between rounded-sm px-2 py-1 text-xs select-none transition-colors",
          isActive
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
        style={{ paddingLeft: `${depth * 12 + 18}px` }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {getFileIcon(node.name)}
          <span className="truncate">{node.name}</span>
        </div>
        {isDirty ? (
          <span className="size-1.5 rounded-full bg-primary shrink-0" />
        ) : null}
      </div>
    );
  };

  if (files.length === 0) {
    return (
      <div className="flex h-full w-full min-h-0 flex-col items-center justify-center p-8 text-center bg-background text-foreground">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4 shadow-xs">
          <Code2 className="size-7" />
        </div>
        <h3 className="text-base font-semibold">
          Theme Virtual Workspace is Empty
        </h3>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
          This theme does not have editable component source files in its virtual workspace yet. Initialize the starter theme files to edit React & Tailwind code.
        </p>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="mt-5 gap-2 font-medium"
          disabled={initMutation.isPending}
          onClick={() => initMutation.mutate()}
        >
          {initMutation.isPending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <FolderOpen className="size-3.5" />
          )}
          <span>Initialize Starter Theme</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-h-0 bg-background text-foreground overflow-hidden">
      {/* Left: Theme File Tree Explorer */}
      <div className="flex w-60 shrink-0 flex-col border-r bg-card/60">
        <div className="flex h-10 items-center justify-between border-b px-3 text-xs font-semibold text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Code2 className="size-3.5 text-primary" />
            <span className="uppercase tracking-wider text-[11px]">Explorer</span>
          </div>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            {files.length} files
          </span>
        </div>
        <ScrollArea className="flex-1 p-1">
          <div className="space-y-0.5">{tree.map((node) => renderTreeNode(node, 0))}</div>
        </ScrollArea>
      </div>

      {/* Right: Monaco Editor Workspace */}
      <div className="flex flex-1 flex-col min-w-0 bg-background">
        {/* Top Tabs Bar */}
        <div className="flex h-10 items-center justify-between border-b bg-muted/40 px-2 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {openTabs.map((path) => {
              const name = path.split("/").pop() ?? path;
              const isActive = activeFilePath === path;
              const isDirty = dirtyPathSet.has(path);

              return (
                <div
                  key={path}
                  onClick={() => setActiveFilePath(path)}
                  className={cn(
                    "group flex h-7 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-xs select-none transition-colors",
                    isActive
                      ? "border-border bg-background font-medium text-foreground shadow-2xs"
                      : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                  )}
                >
                  {getFileIcon(name)}
                  <span className="truncate max-w-32">{name}</span>
                  {isDirty ? (
                    <span className="size-1.5 rounded-full bg-primary" />
                  ) : null}
                  <button
                    type="button"
                    onClick={(e) => handleCloseTab(path, e)}
                    className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted"
                  >
                    <X className="size-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0 pl-2">
            <Button
              variant="form"
              size="xs"
              onClick={handleSaveCurrentFile}
              disabled={
                saveMutation.isPending ||
                !(activeFileDirty || dirtyPathSet.has(activeFilePath)) ||
                Boolean(externalConflictFiles?.[activeFilePath])
              }
              className="h-7 gap-1.5 text-xs font-medium"
            >
              {saveMutation.isPending ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Save className="size-3" />
              )}
              <span>Save</span>
              <span className="text-[10px] opacity-70">Ctrl+S</span>
            </Button>
          </div>
        </div>

        {/* Conflict Resolution Banner */}
        {activeFileConflict ? (
          <div className="flex items-center justify-between border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Conflict:</span>
              <span>
                {activeFileConflict.remoteExists
                  ? `Server conflict (v${activeFileConflict.remoteVersion}). Reload remote or explicitly overwrite.`
                  : "This file was deleted remotely. Reload the deletion or explicitly recreate it."}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                className="h-6 text-[11px] bg-background"
                onClick={() => {
                  onResolveConflict?.(activeFilePath, "reload");
                }}
              >
                Reload Remote
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="h-6 text-[11px]"
                onClick={() => {
                  onResolveConflict?.(activeFilePath, "force_mine");
                }}
              >
                Keep Mine (Overwrite)
              </Button>
            </div>
          </div>
        ) : null}

        {/* Monaco Editor Container */}
        <div className="flex-1 min-h-0 relative">
          {activeFile ? (
            <Editor
              height="100%"
              path={activeFilePath}
              language={getLanguage(activeFilePath)}
              defaultValue={getInitialEditorContent(activeFilePath)}
              onChange={handleContentChange}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
                if (jumpLocation?.line && jumpLocation.filePath === activeFilePath) {
                  editor.revealPositionInCenter({
                    lineNumber: jumpLocation.line,
                    column: jumpLocation.column ?? 1,
                  });
                  editor.setPosition({
                    lineNumber: jumpLocation.line,
                    column: jumpLocation.column ?? 1,
                  });
                  editor.focus();
                }
              }}
              theme="vs-dark"
              options={{
                fontSize: 13,
                fontFamily: "var(--font-mono, Menlo, Monaco, Consolas, monospace)",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                renderLineHighlight: "all",
                tabSize: 2,
                wordWrap: "on",
                automaticLayout: true,
                padding: { top: 12, bottom: 12 },
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Select a file from the explorer to begin editing.
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
