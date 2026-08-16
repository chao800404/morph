import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  onRefreshPreview?: () => void;
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
  onRefreshPreview,
}: EditorCodeWorkspaceProps) {
  const queryClient = useQueryClient();
  const editorRef = useRef<any>(null);

  // Find initial active file (default to Hero.tsx or index.tsx)
  const defaultFile = useMemo(() => {
    if (jumpLocation?.filePath) {
      const match = files.find((f) => f.path === jumpLocation.filePath);
      if (match) return match;
    }
    if (initialActiveFilePath) {
      const match = files.find((f) => f.path === initialActiveFilePath);
      if (match) return match;
    }
    return (
      files.find((f) => f.path.includes("Hero.tsx")) ??
      files.find((f) => f.path.includes("index.tsx")) ??
      files[0]
    );
  }, [files, initialActiveFilePath, jumpLocation]);

  const [activeFilePath, setActiveFilePath] = useState<string>(
    jumpLocation?.filePath ?? defaultFile?.path ?? "src/components/Hero.tsx",
  );
  const [openTabs, setOpenTabs] = useState<string[]>([
    jumpLocation?.filePath ?? defaultFile?.path ?? "src/components/Hero.tsx",
  ]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, boolean>>({});
  const [conflictFiles, setConflictFiles] = useState<Record<string, string>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<
    Record<string, boolean>
  >({});

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

  const externalBaselineRef = useRef<Record<string, string>>({});

  // Synchronize external file updates (Design Inspector AST patches, server queries, AI)
  useEffect(() => {
    setFileContents((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const f of files) {
        const lastBaseline = externalBaselineRef.current[f.path];

        if (lastBaseline === undefined) {
          // 1. Initial file load
          externalBaselineRef.current[f.path] = f.content;
          if (!(f.path in next)) {
            next[f.path] = f.content;
            changed = true;
          }
        } else if (f.content !== lastBaseline) {
          // 2. External actually changed on server / Design AST!
          if (!dirtyFiles[f.path]) {
            // Clean file: seamlessly update local Monaco content and advance baseline
            next[f.path] = f.content;
            externalBaselineRef.current[f.path] = f.content;
            changed = true;
          } else {
            // Dirty file: true conflict! External changed while user has uncommitted edits in Monaco
            setConflictFiles((c) => ({ ...c, [f.path]: f.content }));
          }
        }
        // If f.content === lastBaseline: External did NOT change.
        // Even if user is actively typing (dirtyFiles[f.path] === true), NO false conflict is raised!
      }

      return changed ? next : prev;
    });
  }, [files, dirtyFiles]);

  const activeFile = useMemo(() => {
    return files.find((f) => f.path === activeFilePath);
  }, [files, activeFilePath]);

  const currentEditorContent =
    fileContents[activeFilePath] ?? activeFile?.content ?? "";

  const saveMutation = useMutation({
    mutationFn: async ({
      path,
      content,
    }: {
      path: string;
      content: string;
    }) => {
      const res = await saveStorefrontThemeFile({
        data: {
          storefrontId,
          themeId,
          path,
          content,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: (saved) => {
      externalBaselineRef.current[saved.path] = saved.content;
      setDirtyFiles((prev) => ({ ...prev, [saved.path]: false }));
      setConflictFiles((prev) => {
        const next = { ...prev };
        delete next[saved.path];
        return next;
      });
      queryClient.invalidateQueries({
        queryKey: storefrontThemeFileQueries.all(),
      });
      toast.success(`Saved ${saved.path}`);
      onRefreshPreview?.();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save file");
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
    onSuccess: async () => {
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
    setFileContents((prev) => ({ ...prev, [activeFilePath]: value }));
    setDirtyFiles((prev) => ({ ...prev, [activeFilePath]: true }));
  };

  const handleSaveCurrentFile = useCallback(() => {
    if (!activeFilePath || saveMutation.isPending) return;
    const content = fileContents[activeFilePath] ?? activeFile?.content ?? "";
    saveMutation.mutate({ path: activeFilePath, content });
  }, [activeFilePath, activeFile, fileContents, saveMutation]);

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
    if (dirtyFiles[path]) {
      const confirmed = window.confirm(
        `File "${path}" has unsaved changes. Discard changes and close tab?`,
      );
      if (!confirmed) return;
    }
    const nextTabs = openTabs.filter((p) => p !== path);
    setOpenTabs(nextTabs);
    setDirtyFiles((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });

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
    const isDirty = Boolean(dirtyFiles[node.path]);

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
              const isDirty = Boolean(dirtyFiles[path]);

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
                saveMutation.isPending || !dirtyFiles[activeFilePath]
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
        {conflictFiles[activeFilePath] ? (
          <div className="flex items-center justify-between border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Conflict:</span>
              <span>
                This file was modified externally (Design / AI). Your local editor has unsaved changes.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                className="h-6 text-[11px] bg-background"
                onClick={() => {
                  const external = conflictFiles[activeFilePath];
                  externalBaselineRef.current[activeFilePath] = external;
                  setFileContents((prev) => ({
                    ...prev,
                    [activeFilePath]: external,
                  }));
                  setDirtyFiles((prev) => ({
                    ...prev,
                    [activeFilePath]: false,
                  }));
                  setConflictFiles((prev) => {
                    const next = { ...prev };
                    delete next[activeFilePath];
                    return next;
                  });
                }}
              >
                Reload External
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="h-6 text-[11px]"
                onClick={() => {
                  setConflictFiles((prev) => {
                    const next = { ...prev };
                    delete next[activeFilePath];
                    return next;
                  });
                }}
              >
                Keep Local
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
              value={currentEditorContent}
              onChange={handleContentChange}
              onMount={(editor) => {
                editorRef.current = editor;
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
