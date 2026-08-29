import {
  planDropMoves,
  planThemeFileMove,
} from "@/lib/storefront/ast/theme-file-move";
import {
  folderMoveDestination,
  movePendingFolderPaths,
  pendingFolderStorageKey,
  readPendingFolders,
  removePendingFolderPaths,
  withPendingFolders,
  writePendingFolders,
} from "@/lib/storefront/editor/pending-theme-folders";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import { cn } from "@/lib/utils";
import type {
  StorefrontThemeFileDTO,
  StorefrontThemeFileTreeNode,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import {
  deleteStorefrontThemeFile,
  initStorefrontStarterTheme,
  saveStorefrontThemeFile,
  saveStorefrontThemeFilesBatch,
} from "@/server/storefront/storefront-theme-files.serverFn";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import {
  DragDropProvider,
  PointerSensor,
  useDraggable,
  useDroppable,
} from "@dnd-kit/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  FilePlus2,
  FolderPlus,
  Trash2,
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
import {
  configureThemeTypeScript,
  disposeThemeWorkspaceModels,
  ensureThemeWorkspaceModels,
  getThemeModelUri,
  createJsxTagDecorations,
  registerTailwindCompletionProvider,
} from "./editor-code-language-support";
import { formatEditorCode } from "./editor-code-formatter";
import { prepareDuplicateThemeFile } from "@/lib/storefront/editor/duplicate-theme-file";
import { prepareNewThemeFile } from "@/lib/storefront/editor/new-theme-file";
import { prepareNewThemeFolder } from "@/lib/storefront/editor/new-theme-folder";
import { prepareThemeFileRename } from "@/lib/storefront/editor/rename-theme-file";

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
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "javascript";
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
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const jsxTagDecorationsRef = useRef<{ dispose: () => void } | null>(null);

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
  const updateWorkspaceLocal = useThemeWorkspaceStore(
    (state) => state.updateLocalContent,
  );
  const markWorkspaceSaving = useThemeWorkspaceStore(
    (state) => state.markSaving,
  );
  const markWorkspaceSaved = useThemeWorkspaceStore((state) => state.markSaved);
  const markWorkspaceError = useThemeWorkspaceStore((state) => state.markError);
  const discardWorkspaceLocal = useThemeWorkspaceStore(
    (state) => state.discardLocalChanges,
  );
  const [collapsedFolders, setCollapsedFolders] = useState<
    Record<string, boolean>
  >({});
  /** Folder the inline create input is anchored to; "" is the workspace root. */
  const pendingFolderKey = pendingFolderStorageKey(storefrontId, themeId);
  const [pendingFolders, setPendingFolders] = useState<string[]>(() =>
    readPendingFolders(pendingFolderKey),
  );
  // A short distance before a drag begins, so opening a file with a click that
  // moves a pixel does not start dragging it somewhere instead.
  const dragSensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: [
          new PointerActivationConstraints.Distance({ value: 6 }),
        ],
      }),
    ],
    [],
  );
  const [creatingInFolder, setCreatingInFolder] = useState<string | null>(null);
  const [newFilePath, setNewFilePath] = useState("");
  const [creatingFolderIn, setCreatingFolderIn] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [dirtyPaths, setDirtyPaths] = useState<string[]>(() =>
    useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope),
  );
  const draftContentsRef = useRef<Record<string, string>>({});
  const draftDirtyRef = useRef<Record<string, boolean>>({});
  const draftRevisionRef = useRef<Record<string, number>>({});
  const combinedDirtyPathsRef = useRef(dirtyPaths);
  const suppressModelChangeRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const renameJustStartedRef = useRef(false);

  const handleEditorWillMount = useCallback(
    (monaco: Monaco) => {
      configureThemeTypeScript(monaco);
      ensureThemeWorkspaceModels(
        monaco,
        workspaceScope,
        files.map((file) => ({
          path: file.path,
          content:
            draftContentsRef.current[file.path] ??
            useThemeWorkspaceStore.getState().files[file.path]?.localContent ??
            file.content,
        })),
      );
    },
    [files, workspaceScope],
  );

  const handleEditorDidMount = useCallback<OnMount>(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      completionProviderRef.current?.dispose();
      completionProviderRef.current =
        registerTailwindCompletionProvider(monaco);
      jsxTagDecorationsRef.current?.dispose();
      jsxTagDecorationsRef.current = createJsxTagDecorations(editor);
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
    },
    [activeFilePath, jumpLocation],
  );

  useEffect(
    () => () => {
      completionProviderRef.current?.dispose();
      completionProviderRef.current = null;
      jsxTagDecorationsRef.current?.dispose();
      jsxTagDecorationsRef.current = null;
      if (monacoRef.current) {
        disposeThemeWorkspaceModels(monacoRef.current, workspaceScope);
      }
    },
    [workspaceScope],
  );

  useEffect(() => {
    if (!monacoRef.current) return;
    ensureThemeWorkspaceModels(
      monacoRef.current,
      workspaceScope,
      files.map((file) => ({
        path: file.path,
        content:
          draftContentsRef.current[file.path] ??
          useThemeWorkspaceStore.getState().files[file.path]?.localContent ??
          file.content,
      })),
    );
  }, [files, workspaceScope]);

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
    if (
      openTabs.length > 0 &&
      files.length > 0 &&
      !files.some((f) => f.path === activeFilePath)
    ) {
      const fallback = defaultFile?.path ?? files[0].path;
      setActiveFilePath(fallback);
      setOpenTabs((prev) =>
        prev.includes(fallback) ? prev : [...prev, fallback],
      );
    }
  }, [files, activeFilePath, defaultFile, openTabs.length]);

  const activeFile = useMemo(() => {
    return files.find((f) => f.path === activeFilePath);
  }, [files, activeFilePath]);

  const getFileBaseline = useCallback(
    (path: string) => {
      const workspaceFile = useThemeWorkspaceStore
        .getState()
        .getWorkspaceFiles(workspaceScope.storefrontId, workspaceScope.themeId)[
        path
      ];
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
      const next = [
        ...storePaths,
        ...localPaths.filter((path) => !storePaths.includes(path)),
      ];
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
        .getWorkspaceFiles(workspaceScope.storefrontId, workspaceScope.themeId)[
        path
      ];
      const res = await saveStorefrontThemeFile({
        data: {
          storefrontId,
          themeId,
          path,
          content,
          expectedFileId: state?.serverExists
            ? (state.serverFileId ?? undefined)
            : undefined,
          expectedVersion: state?.serverExists
            ? (state.serverVersion ?? undefined)
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
            queryKey: storefrontThemeFileQueries.tree(storefrontId, themeId)
              .queryKey,
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
        .getWorkspaceFiles(workspaceScope.storefrontId, workspaceScope.themeId)[
        variables.path
      ];
      if (
        fileState?.saveState === "dirty" ||
        fileState?.saveState === "conflict"
      ) {
        return;
      }
      const message =
        err instanceof Error ? err.message : "Failed to save file";
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
      useThemeWorkspaceStore
        .getState()
        .acceptRemoteGeneration(data.sourceGeneration, workspaceScope);
      toast.success("Starter theme workspace initialized");
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeFileQueries.tree(storefrontId, themeId)
          .queryKey,
      });
      onRefreshPreview?.();
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to initialize starter theme");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({
      path,
      expectedFileId,
      expectedVersion,
    }: {
      path: string;
      expectedFileId: string;
      expectedVersion: number;
    }) => {
      const result = await deleteStorefrontThemeFile({
        data: {
          storefrontId,
          themeId,
          path,
          expectedFileId,
          expectedVersion,
          expectedSourceGeneration: useThemeWorkspaceStore
            .getState()
            .getAcceptedSourceGeneration(workspaceScope),
        },
      });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
    onSuccess: async ({ path, sourceGeneration }) => {
      useThemeWorkspaceStore
        .getState()
        .acceptRemoteGeneration(sourceGeneration, workspaceScope);
      const nextTabs = openTabs.filter((tabPath) => tabPath !== path);
      delete draftContentsRef.current[path];
      delete draftDirtyRef.current[path];
      delete draftRevisionRef.current[path];
      discardWorkspaceLocal(path, workspaceScope);
      syncCombinedDirtyPaths(
        useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope),
      );
      for (const model of monacoRef.current?.editor?.getModels?.() ?? []) {
        const modelPath = model.uri?.path?.replace(/^\/+/, "") ?? "";
        if (modelPath === path || modelPath.endsWith("/" + path))
          model.dispose?.();
      }
      setOpenTabs(nextTabs);
      if (activeFilePath === path)
        setActiveFilePath(nextTabs[nextTabs.length - 1] ?? "");
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeFileQueries.tree(storefrontId, themeId)
          .queryKey,
      });
      toast.success("Deleted " + path);
      onRefreshPreview?.();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to delete file",
      ),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderPath: string) => {
      const folderPrefix = `${folderPath}/`;
      const filesToDelete = files.filter((file) =>
        file.path.startsWith(folderPrefix),
      );
      const workspaceFiles = useThemeWorkspaceStore
        .getState()
        .getWorkspaceFiles(workspaceScope.storefrontId, workspaceScope.themeId);
      const deletions = filesToDelete.map((file) => {
        const workspaceFile = workspaceFiles[file.path];
        if (
          !workspaceFile?.serverExists ||
          !workspaceFile.serverFileId
        ) {
          throw new Error(`File "${file.path}" is not available for deletion.`);
        }
        return {
          path: file.path,
          expectedFileId: workspaceFile.serverFileId,
          expectedVersion: workspaceFile.serverVersion ?? file.version,
        };
      });

      if (deletions.length === 0) {
        return {
          folderPath,
          deletedPaths: [] as string[],
          sourceGeneration: undefined as number | undefined,
        };
      }

      const result = await saveStorefrontThemeFilesBatch({
        data: {
          storefrontId,
          themeId,
          files: [],
          deletions,
          expectedSourceGeneration: useThemeWorkspaceStore
            .getState()
            .getAcceptedSourceGeneration(workspaceScope),
          createRevision: true,
          revisionMessage: `Delete folder ${folderPath}`,
        },
      });
      if (!result.success) throw new Error(result.message);
      return {
        folderPath,
        deletedPaths: filesToDelete.map((file) => file.path),
        sourceGeneration: result.data.sourceGeneration,
      };
    },
    onSuccess: async ({ folderPath, deletedPaths, sourceGeneration }) => {
      if (sourceGeneration !== undefined) {
        useThemeWorkspaceStore
          .getState()
          .acceptRemoteGeneration(sourceGeneration, workspaceScope);
      }

      if (deletedPaths.length > 0) {
        const deletedPathSet = new Set(deletedPaths);
        const nextTabs = openTabs.filter((path) => !deletedPathSet.has(path));
        for (const path of deletedPaths) {
          delete draftContentsRef.current[path];
          delete draftDirtyRef.current[path];
          delete draftRevisionRef.current[path];
          discardWorkspaceLocal(path, workspaceScope);
        }
        syncCombinedDirtyPaths(
          useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope),
        );
        for (const model of monacoRef.current?.editor?.getModels?.() ?? []) {
          const modelPath = model.uri?.path?.replace(/^\/+/, "") ?? "";
          if (
            deletedPaths.some(
              (path) => modelPath === path || modelPath.endsWith("/" + path),
            )
          ) {
            model.dispose?.();
          }
        }
        setOpenTabs(nextTabs);
        if (deletedPathSet.has(activeFilePath)) {
          setActiveFilePath(nextTabs[nextTabs.length - 1] ?? "");
        }
      }

      setPendingFolders((current) =>
        removePendingFolderPaths(current, folderPath),
      );
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeFileQueries.tree(storefrontId, themeId)
          .queryKey,
      });
      toast.success(`Deleted folder ${folderPath}`);
      if (deletedPaths.length > 0) onRefreshPreview?.();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to delete folder",
      ),
  });

  const moveMutation = useMutation({
    mutationFn: async (moves: ReadonlyArray<{ from: string; to: string }>) => {
      const workspaceFiles = useThemeWorkspaceStore
        .getState()
        .getWorkspaceFiles(workspaceScope.storefrontId, workspaceScope.themeId);
      const plan = planThemeFileMove(
        files.map((file) => ({
          path: file.path,
          // A move must rewrite the newest editor buffer, not an older server
          // snapshot, or it can save an import graph that no longer matches
          // what the author sees in Monaco.
          content:
            draftContentsRef.current[file.path] ??
            workspaceFiles[file.path]?.localContent ??
            file.content,
        })),
        moves,
      );
      if (!plan.ok) throw new Error(plan.reason);

      const byPath = new Map(files.map((file) => [file.path, file]));
      const deletions = plan.deletions.map((path) => {
        const file = byPath.get(path);
        if (!file) throw new Error(`${path} is no longer in the workspace.`);
        return {
          path,
          expectedFileId: file.id,
          expectedVersion: file.version,
        };
      });

      // One batch: the writes at the new paths and the removals at the old ones
      // land together or not at all. Two calls would leave the Theme with
      // duplicates, or with nothing, for as long as the gap lasted.
      const result = await saveStorefrontThemeFilesBatch({
        data: {
          storefrontId,
          themeId,
          // Each write states what it expects to find. An importer being
          // rewritten must still be the version this plan was made from, and
          // the destination must still be free — otherwise a move made while
          // someone else was editing would quietly discard their work.
          files: plan.writes.map((file) => {
            const existing = byPath.get(file.path);
            return existing
              ? {
                  path: file.path,
                  content: file.content,
                  mimeType: existing.mimeType,
                  expectedFileId: existing.id,
                  expectedVersion: existing.version,
                }
              : {
                  path: file.path,
                  content: file.content,
                  mimeType:
                    byPath.get(
                      plan.deletions.find(
                        (from) =>
                          from.slice(from.lastIndexOf("/") + 1) ===
                          file.path.slice(file.path.lastIndexOf("/") + 1),
                      ) ?? "",
                    )?.mimeType ?? "text/typescript",
                  expectMissing: true,
                };
          }),
          deletions,
          expectedSourceGeneration: useThemeWorkspaceStore
            .getState()
            .getAcceptedSourceGeneration(workspaceScope),
          createRevision: true,
          revisionMessage:
            moves.length === 1
              ? `Move ${moves[0].from} to ${moves[0].to}`
              : `Move ${moves.length} files`,
        },
      });
      if (!result.success) throw new Error(result.message);
      return { ...result.data, plan, moves };
    },
    onSuccess: async ({
      sourceGeneration,
      plan,
      moves,
      files: savedFiles = [],
    }: {
      sourceGeneration: number;
      plan: Extract<ReturnType<typeof planThemeFileMove>, { ok: true }>;
      moves: ReadonlyArray<{ from: string; to: string }>;
      files: StorefrontThemeFileDTO[];
    }) => {
      useThemeWorkspaceStore
        .getState()
        .acceptRemoteGeneration(sourceGeneration, workspaceScope);

      const moved = new Map(moves.map((move) => [move.from, move.to]));
      const movedDrafts = new Map<string, string>();
      for (const [from, to] of moved) {
        // The editor's own state is keyed by path, so anything remembering the
        // old one now points at a file that does not exist.
        const draft = draftContentsRef.current[from];
        if (draft !== undefined) movedDrafts.set(to, draft);
        delete draftContentsRef.current[from];
        delete draftDirtyRef.current[from];
        delete draftRevisionRef.current[from];
        discardWorkspaceLocal(from, workspaceScope);
        for (const model of monacoRef.current?.editor?.getModels?.() ?? []) {
          const modelPath = model.uri?.path?.replace(/^\/+/, "") ?? "";
          if (modelPath === from || modelPath.endsWith("/" + from)) {
            model.dispose?.();
          }
        }
      }

      // The batch also rewrites importers that stayed at the same path. Update
      // their existing Monaco models immediately; the query refresh alone
      // cannot do this because model registration intentionally preserves the
      // current buffer for normal edits.
      for (const saved of savedFiles) {
        const currentDraft =
          draftContentsRef.current[saved.path] ?? movedDrafts.get(saved.path);
        if (currentDraft !== undefined) {
          draftContentsRef.current[saved.path] = currentDraft;
        }
        const hasNewerDraft =
          currentDraft !== undefined && currentDraft !== saved.content;
        if (!hasNewerDraft) {
          suppressModelChangeRef.current = true;
          for (const model of monacoRef.current?.editor?.getModels?.() ?? []) {
            const modelPath = model.uri?.path?.replace(/^\/+/, "") ?? "";
            if (
              modelPath === saved.path ||
              modelPath.endsWith("/" + saved.path)
            ) {
              model.setValue?.(saved.content);
            }
          }
          suppressModelChangeRef.current = false;
          draftContentsRef.current[saved.path] = saved.content;
          draftDirtyRef.current[saved.path] = false;
          delete draftRevisionRef.current[saved.path];
        } else {
          draftDirtyRef.current[saved.path] = true;
        }
        markWorkspaceSaved(saved, workspaceScope);
      }
      setOpenTabs((tabs) => tabs.map((tab) => moved.get(tab) ?? tab));
      setActiveFilePath((current) => moved.get(current) ?? current);
      syncCombinedDirtyPaths(
        useThemeWorkspaceStore.getState().getDirtyFiles(workspaceScope),
      );
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeFileQueries.tree(storefrontId, themeId)
          .queryKey,
      });
      toast.success(
        plan.rewrites.length > 0
          ? `Moved ${moves.length === 1 ? moves[0].to : `${moves.length} files`}; updated ${plan.rewrites.length} import${plan.rewrites.length === 1 ? "" : "s"}`
          : `Moved ${moves.length === 1 ? moves[0].to : `${moves.length} files`}`,
      );
      onRefreshPreview?.();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to move file",
      ),
  });

  const createMutation = useMutation({
    mutationFn: async ({
      path,
      content,
      mimeType,
    }: {
      path: string;
      content: string;
      mimeType: string;
    }) => {
      // `expectMissing` is the create precondition: the write is refused if the
      // path already exists, so creating can never overwrite existing work.
      const res = await saveStorefrontThemeFile({
        data: {
          storefrontId,
          themeId,
          path,
          content,
          mimeType,
          expectMissing: true,
          expectedSourceGeneration: useThemeWorkspaceStore
            .getState()
            .getAcceptedSourceGeneration(workspaceScope),
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: async (saved) => {
      if (!saved) return;
      markWorkspaceSaved(saved, workspaceScope);
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeFileQueries.all(),
      });
      setCreatingInFolder(null);
      setNewFilePath("");
      setCreatingFolderIn(null);
      setNewFolderName("");
      setActiveFilePath(saved.path);
      setOpenTabs((prev) =>
        prev.includes(saved.path) ? prev : [...prev, saved.path],
      );
      toast.success(`Created ${saved.path}`);
      onRefreshPreview?.();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to create file",
      ),
  });

  const startCreatingIn = useCallback((folderPath: string) => {
    setCreatingFolderIn(null);
    setNewFolderName("");
    setRenamingPath(null);
    setRenameName("");
    renameJustStartedRef.current = false;
    setCreatingInFolder(folderPath);
    setNewFilePath(folderPath ? `${folderPath}/` : "");
    if (folderPath) {
      setCollapsedFolders((prev) => ({ ...prev, [folderPath]: false }));
    }
  }, []);

  const startCreatingFolder = useCallback((parentPath: string) => {
    setCreatingInFolder(null);
    setNewFilePath("");
    setRenamingPath(null);
    setRenameName("");
    renameJustStartedRef.current = false;
    setCreatingFolderIn(parentPath);
    setNewFolderName("");
    if (parentPath) {
      setCollapsedFolders((prev) => ({ ...prev, [parentPath]: false }));
    }
  }, []);

  const startRenamingFile = useCallback((path: string) => {
    setCreatingInFolder(null);
    setNewFilePath("");
    setCreatingFolderIn(null);
    setNewFolderName("");
    setRenamingPath(path);
    setRenameName(path.slice(path.lastIndexOf("/") + 1));
    // Radix restores focus to the context-menu trigger as it closes. The
    // first blur belongs to that hand-off, not to the user's rename action.
    renameJustStartedRef.current = true;
  }, []);

  const submitNewFile = useCallback(() => {
    if (createMutation.isPending) return;
    const prepared = prepareNewThemeFile(
      newFilePath,
      files.map((file) => file.path),
    );
    if (!prepared.ok) {
      toast.error(prepared.message);
      return;
    }
    createMutation.mutate({
      path: prepared.path,
      content: prepared.content,
      mimeType: prepared.mimeType,
    });
  }, [createMutation, files, newFilePath]);

  const submitNewFolder = useCallback(() => {
    if (createMutation.isPending) return;
    if (creatingFolderIn === null) return;
    const prepared = prepareNewThemeFolder(
      newFolderName,
      creatingFolderIn,
      files.map((file) => file.path),
      pendingFolders,
    );
    if (!prepared.ok) {
      toast.error(prepared.message);
      return;
    }
    setPendingFolders((current) =>
      current.includes(prepared.path) ? current : [...current, prepared.path],
    );
    setCollapsedFolders((prev) => ({ ...prev, [prepared.path]: false }));
    setCreatingFolderIn(null);
    setNewFolderName("");
  }, [
    createMutation.isPending,
    creatingFolderIn,
    files,
    newFolderName,
    pendingFolders,
  ]);

  const submitRename = useCallback(() => {
    if (moveMutation.isPending || renamingPath === null) return;
    const prepared = prepareThemeFileRename(
      renameName,
      renamingPath,
      files.map((file) => file.path),
    );
    if (!prepared.ok) {
      toast.error(prepared.message);
      return;
    }
    renameJustStartedRef.current = false;
    if (prepared.path === renamingPath) {
      setRenamingPath(null);
      setRenameName("");
      return;
    }

    moveMutation.mutate(
      [{ from: renamingPath, to: prepared.path }],
      {
        onSuccess: () => {
          setRenamingPath(null);
          setRenameName("");
        },
      },
    );
  }, [files, moveMutation, renameName, renamingPath]);

  const handleDuplicateFile = useCallback(
    (path: string) => {
      if (createMutation.isPending) return;
      const prepared = prepareDuplicateThemeFile(
        path,
        files.map((file) => file.path),
      );
      if (!prepared.ok) {
        toast.error(prepared.message);
        return;
      }
      // Match VS Code's duplicate behavior by copying the current editor
      // buffer when this is the active file, including an unsaved draft.
      const source =
        getCurrentEditorContent(path) ??
        files.find((file) => file.path === path)?.content ??
        prepared.content;
      createMutation.mutate({
        path: prepared.path,
        content: source,
        mimeType: prepared.mimeType,
      });
    },
    [createMutation, files, getCurrentEditorContent],
  );

  const handleContentChange = (value?: string) => {
    if (value === undefined) return;
    if (suppressModelChangeRef.current) return;

    const path = activeFilePath;
    draftContentsRef.current[path] = value;
    draftRevisionRef.current[path] = (draftRevisionRef.current[path] ?? 0) + 1;
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
      const next = useThemeWorkspaceStore
        .getState()
        .getDirtyFiles(workspaceScope);
      syncCombinedDirtyPaths(next);
    });
  }, [syncCombinedDirtyPaths, workspaceScope]);

  const dirtyPathSet = useMemo(() => new Set(dirtyPaths), [dirtyPaths]);

  const handleSaveCurrentFile = useCallback(async () => {
    if (!activeFilePath || saveMutation.isPending || saveInFlightRef.current)
      return;

    saveInFlightRef.current = true;
    const originalContent = getCurrentEditorContent(activeFilePath);
    let content = originalContent;
    const editor = editorRef.current;
    const model = editor?.getModel?.();
    const initialDraftRevision =
      draftRevisionRef.current[activeFilePath] ?? 0;

    try {
      try {
        const formattedContent = await formatEditorCode(
          originalContent,
          activeFilePath,
        );
        const latestModelContent = model?.getValue?.();
        const modelChangedWhileFormatting =
          typeof latestModelContent === "string" &&
          (latestModelContent !== originalContent ||
            (draftRevisionRef.current[activeFilePath] ?? 0) !==
              initialDraftRevision);

        if (modelChangedWhileFormatting) {
          // A newer user edit wins over a formatter result that was computed
          // from the older snapshot.
          content = latestModelContent;
        } else {
          content = formattedContent;
          if (
            model &&
            typeof model.setValue === "function" &&
            formattedContent !== originalContent
          ) {
            model.setValue(formattedContent);
          }
        }
      } catch {
        const latestModelContent = model?.getValue?.();
        content =
          typeof latestModelContent === "string" &&
          latestModelContent !== originalContent
            ? latestModelContent
            : originalContent;
      }

      const draftRevision = draftRevisionRef.current[activeFilePath] ?? 0;
      // Save is the source/workspace boundary: sync the complete transient
      // Monaco model exactly once before invoking the existing OCC mutation.
      updateWorkspaceLocal(activeFilePath, content, workspaceScope);
      saveMutation.mutate({ path: activeFilePath, content, draftRevision });
    } finally {
      saveInFlightRef.current = false;
    }
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

  const handleDeleteFile = (path: string) => {
    if (deleteMutation.isPending) return;
    const file = files.find((candidate) => candidate.path === path);
    const workspaceFile = useThemeWorkspaceStore
      .getState()
      .getWorkspaceFiles(workspaceScope.storefrontId, workspaceScope.themeId)[
      path
    ];
    if (!file || !workspaceFile?.serverExists || !workspaceFile.serverFileId) {
      toast.error("This file is not available for deletion.");
      return;
    }
    if (workspaceFile.dirty || draftDirtyRef.current[path]) {
      if (
        !window.confirm(
          'File "' + path + '" has unsaved changes. Delete it anyway?',
        )
      )
        return;
    }
    deleteMutation.mutate({
      path,
      expectedFileId: workspaceFile.serverFileId,
      expectedVersion: workspaceFile.serverVersion ?? file.version,
    });
  };

  const handleDeleteFolder = (path: string) => {
    if (deleteFolderMutation.isPending || deleteMutation.isPending) return;
    const filesInFolder = files.filter((file) =>
      file.path.startsWith(`${path}/`),
    );
    const hasPendingFolder = pendingFolders.some(
      (folder) => folder === path || folder.startsWith(`${path}/`),
    );
    if (filesInFolder.length === 0 && !hasPendingFolder) {
      toast.error("This folder is not available for deletion.");
      return;
    }

    const fileLabel =
      filesInFolder.length === 1
        ? "1 file"
        : `${filesInFolder.length} files`;
    if (
      !window.confirm(
        `Delete folder "${path}" and its ${fileLabel}? This cannot be undone.`,
      )
    ) {
      return;
    }
    deleteFolderMutation.mutate(path);
  };

  const toggleFolder = (path: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const renderCreateInput = (depth: number, parentPath: string) => {
    const prefix = parentPath ? `${parentPath}/` : "";
    const visibleName =
      prefix && newFilePath.startsWith(prefix)
        ? newFilePath.slice(prefix.length)
        : newFilePath;

    return (
      <div
        className="flex items-center gap-1.5 py-1 pr-2"
        style={{ paddingLeft: depth * 12 + 18 }}
      >
        <FilePlus2 className="size-3.5 shrink-0 text-primary" />
        <input
          autoFocus
          value={visibleName}
          placeholder="Filename.tsx"
          aria-label={
            parentPath ? `New file inside ${parentPath}` : "New file name"
          }
          disabled={createMutation.isPending}
          onChange={(event) =>
            setNewFilePath(
              parentPath
                ? `${parentPath}/${event.target.value}`
                : event.target.value,
            )
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitNewFile();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setCreatingInFolder(null);
              setNewFilePath("");
            }
          }}
          onBlur={() => {
            if (!createMutation.isPending) setCreatingInFolder(null);
          }}
          className="h-6 w-full min-w-0 rounded-sm border bg-background px-1.5 font-mono text-[11px] outline-none focus:border-primary"
        />
      </div>
    );
  };

  const renderFolderCreateInput = (depth: number, parentPath: string) => (
    <div
      className="flex items-center gap-1.5 py-1 pr-2"
      style={{ paddingLeft: depth * 12 + 18 }}
    >
      <FolderPlus className="size-3.5 shrink-0 text-primary" />
      <input
        autoFocus
        value={newFolderName}
        placeholder="Folder name"
        aria-label={
          parentPath ? `New folder inside ${parentPath}` : "New folder name"
        }
        disabled={createMutation.isPending}
        onChange={(event) => setNewFolderName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submitNewFolder();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setCreatingFolderIn(null);
            setNewFolderName("");
          }
        }}
        onBlur={() => {
          if (!createMutation.isPending) {
            setCreatingFolderIn(null);
            setNewFolderName("");
          }
        }}
        className="h-6 w-full min-w-0 rounded-sm border bg-background px-1.5 font-mono text-[11px] outline-none focus:border-primary"
      />
    </div>
  );

  const renderRenameInput = (path: string, depth: number) => (
    <div
      className="flex items-center gap-1.5 py-1 pr-2"
      style={{ paddingLeft: depth * 12 + 18 }}
    >
      {getFileIcon(path.split("/").pop() ?? path)}
      <input
        autoFocus
        value={renameName}
        aria-label={`Rename ${path}`}
        disabled={moveMutation.isPending}
        onChange={(event) => setRenameName(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            submitRename();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            renameJustStartedRef.current = false;
            setRenamingPath(null);
            setRenameName("");
          }
        }}
        onBlur={() => {
          if (renameJustStartedRef.current) return;
          if (!moveMutation.isPending) {
            // Commit after focus has settled so clicking another explorer
            // action behaves like VS Code's inline rename field.
            window.setTimeout(() => {
              if (!moveMutation.isPending) submitRename();
            }, 0);
          }
        }}
        className="h-6 w-full min-w-0 rounded-sm border bg-background px-1.5 font-mono text-[11px] outline-none focus:border-primary"
      />
    </div>
  );

  // Explicitly created folders are merged in for display. Keeping this local
  // record after a file lands there means deleting that file does not remove
  // the folder the author created.
  const visibleTree = useMemo(
    () => withPendingFolders(tree, pendingFolders),
    [tree, pendingFolders],
  );
  useEffect(() => {
    writePendingFolders(pendingFolderKey, pendingFolders);
  }, [pendingFolderKey, pendingFolders]);

  /** Turns a drop into the moves it stands for, then applies them as one batch. */
  const handleDropOnFolder = (draggedPath: string, folderPath: string) => {
    if (moveMutation.isPending) return;
    const draggedIsFolder = !files.some((file) => file.path === draggedPath);
    const moves = planDropMoves(
      files.map((file) => file.path),
      draggedPath,
      folderPath,
    );
    const pendingDestination = draggedIsFolder
      ? folderMoveDestination(draggedPath, folderPath)
      : null;

    // An explicitly created empty folder has no backend file to move. Keep
    // that operation local, while preserving the same drag-and-drop behavior.
    if (moves.length === 0) {
      if (
        pendingDestination &&
        pendingFolders.some(
          (path) =>
            path === draggedPath || path.startsWith(`${draggedPath}/`),
        )
      ) {
        setPendingFolders((current) =>
          movePendingFolderPaths(current, draggedPath, folderPath),
        );
      }
      return;
    }

    moveMutation.mutate(moves, {
      onSuccess: () => {
        if (pendingDestination) {
          setPendingFolders((current) =>
            movePendingFolderPaths(current, draggedPath, folderPath),
          );
        }
      },
    });
  };

  /**
   * A folder row: draggable like a file, and a drop target for both.
   *
   * Pointer-based rather than native drag and drop, matching the sections tree:
   * native drag events carry their own image and cannot be driven from a test,
   * and this list already lives beside one that works this way.
   */
  const FolderRow = ({
    node,
    children,
  }: {
    node: StorefrontThemeFileTreeNode;
    children: React.ReactNode;
  }) => {
    const { ref: dragRef, isDragging } = useDraggable({
      id: `path:${node.path}`,
      data: { path: node.path },
      disabled: moveMutation.isPending,
    });
    const { ref: dropRef, isDropTarget } = useDroppable({
      id: `folder:${node.path}`,
      data: { folder: node.path },
      accept: () => true,
    });

    return (
      <div
        ref={(element) => {
          dragRef(element);
          dropRef(element);
        }}
        // The header alone is the drop zone. Wrapping the whole subtree would
        // make dropping on any descendant mean "into this folder" and would
        // highlight everything under it, which says nothing about where the
        // file is going.
        //
        // The attribute names the row for anything that needs to address it
        // precisely — a drop target is a position, and a label is not one.
        data-file-tree-folder={node.path}
        data-drop-target={isDropTarget ? "true" : undefined}
        className={cn(
          "rounded-sm",
          isDragging && "opacity-50",
          isDropTarget && "bg-primary/10 ring-1 ring-primary/40",
        )}
      >
        {children}
      </div>
    );
  };

  const FileRow = ({
    path,
    disabled = false,
    children,
  }: {
    path: string;
    disabled?: boolean;
    children: React.ReactNode;
  }) => {
    const { ref, isDragging } = useDraggable({
      id: `path:${path}`,
      data: { path },
      disabled: moveMutation.isPending || disabled,
    });
    return (
      <div
        ref={ref}
        data-file-tree-file={path}
        className={cn(isDragging && "opacity-50")}
      >
        {children}
      </div>
    );
  };

  const renderTreeNode = (node: StorefrontThemeFileTreeNode, depth = 0) => {
    if (node.isDirectory) {
      const isCollapsed = Boolean(collapsedFolders[node.path]);
      return (
        <div key={node.path} className="select-none">
          <FolderRow node={node}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
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
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                disabled={createMutation.isPending}
                onClick={() => startCreatingIn(node.path)}
              >
                <FilePlus2 className="size-3.5" />
                New File
              </ContextMenuItem>
                <ContextMenuItem
                  disabled={createMutation.isPending}
                  onClick={() => startCreatingFolder(node.path)}
                >
                  <FolderPlus className="size-3.5" />
                  New Folder
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  disabled={
                    deleteFolderMutation.isPending || deleteMutation.isPending
                  }
                  onClick={() => handleDeleteFolder(node.path)}
                >
                  <Trash2 className="size-3.5" />
                  Delete Folder
                </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          </FolderRow>
          {creatingInFolder === node.path
            ? renderCreateInput(depth + 1, node.path)
            : creatingFolderIn === node.path
              ? renderFolderCreateInput(depth + 1, node.path)
            : null}
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
    const isRenaming = renamingPath === node.path;

    if (isRenaming) {
      // Keep the editing control outside the inner FileRow component. That
      // component is declared inside the workspace and is recreated whenever
      // its parent renders; nesting a controlled input inside it would remount
      // the input on every keystroke and drop focus.
      return (
        <div key={node.path} data-file-tree-file={node.path}>
          {renderRenameInput(node.path, depth)}
        </div>
      );
    }

    return (
      <FileRow key={node.path} path={node.path}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={() => handleOpenFile(node.path)}
            className={cn(
              "flex cursor-pointer items-center justify-between rounded-sm px-2 py-1 text-xs select-none transition-colors",
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
            style={{ paddingLeft: depth * 12 + 18 }}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {getFileIcon(node.name)}
              <span className="truncate">{node.name}</span>
            </div>
            {isDirty ? (
              <span className="size-1.5 rounded-full bg-primary shrink-0" />
            ) : null}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            if (renameJustStartedRef.current) {
              event.preventDefault();
              renameJustStartedRef.current = false;
            }
          }}
        >
          <ContextMenuItem
            disabled={createMutation.isPending}
            onClick={() => handleDuplicateFile(node.path)}
          >
            <Copy className="size-3.5" />
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem
            disabled={moveMutation.isPending}
            onClick={() => startRenamingFile(node.path)}
          >
            <FileText className="size-3.5" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => handleDeleteFile(node.path)}
          >
            <Trash2 className="size-3.5" />
            Delete File
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      </FileRow>
    );
  };

  if (files.length === 0 && pendingFolders.length === 0) {
    return (
      <div className="flex h-full w-full min-h-0 flex-col items-center justify-center p-8 text-center bg-background text-foreground">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4 shadow-xs">
          <Code2 className="size-7" />
        </div>
        <h3 className="text-base font-semibold">
          Theme Virtual Workspace is Empty
        </h3>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
          This theme does not have editable component source files in its
          virtual workspace yet. Initialize the starter theme files to edit
          React & Tailwind code.
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
            <span className="uppercase tracking-wider text-[11px]">
              Explorer
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              {files.length} files
            </span>
            <button
              type="button"
              title="New folder"
              aria-label="New folder"
              disabled={createMutation.isPending}
              onClick={() => startCreatingFolder("")}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <FolderPlus className="size-3.5" />
            </button>
            <button
              type="button"
              title="New file"
              aria-label="New file"
              disabled={createMutation.isPending}
              onClick={() => startCreatingIn("")}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <FilePlus2 className="size-3.5" />
            </button>
          </div>
        </div>
        <ScrollArea className="flex-1 p-1">
          <DragDropProvider
            sensors={dragSensors}
            onDragEnd={(event) => {
              const draggedPath = (
                event.operation.source?.data as { path?: string } | undefined
              )?.path;
              const folder = (
                event.operation.target?.data as { folder?: string } | undefined
              )?.folder;
              if (event.canceled || !draggedPath || folder === undefined)
                return;
              handleDropOnFolder(draggedPath, folder);
            }}
          >
          <div className="space-y-0.5">
              {creatingInFolder === ""
                ? renderCreateInput(0, "")
                : creatingFolderIn === ""
                  ? renderFolderCreateInput(0, "")
                  : null}
              {visibleTree.map((node) => renderTreeNode(node, 0))}
          </div>
          </DragDropProvider>
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
                    // Its only content is an icon, so without this it reads as
                    // "button" and nothing else — and there is one per open
                    // tab, which makes them indistinguishable.
                    aria-label={`Close ${name}`}
                    title={`Close ${name}`}
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
              path={getThemeModelUri(workspaceScope, activeFilePath)}
              language={getLanguage(activeFilePath)}
              defaultValue={getInitialEditorContent(activeFilePath)}
              onChange={handleContentChange}
              beforeMount={handleEditorWillMount}
              onMount={handleEditorDidMount}
              theme="vs-dark"
              options={{
                fontSize: 13,
                fontFamily:
                  "var(--font-mono, Menlo, Monaco, Consolas, monospace)",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                renderLineHighlight: "all",
                tabSize: 2,
                wordWrap: "on",
                automaticLayout: true,
                padding: { top: 12, bottom: 12 },
                quickSuggestions: {
                  other: true,
                  comments: false,
                  strings: true,
                },
                suggestOnTriggerCharacters: true,
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
