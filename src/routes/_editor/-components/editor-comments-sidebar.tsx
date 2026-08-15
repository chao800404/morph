import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  StorefrontCommentGroupDTO,
  StorefrontCommentThreadDTO,
} from "@/lib/storefront/dto/storefront-comment.dto";
import {
  clearStorefrontCommentGroupResolved,
  deleteStorefrontCommentGroup,
  deleteStorefrontCommentThread,
  resolveStorefrontCommentThread,
  updateStorefrontCommentGroup,
} from "@/server/storefront/storefront-comments.serverFn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Maximize2,
  MessageCircle,
  MessageSquarePlus,
  Monitor,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { storefrontCommentQueries } from "../-queries/storefront-comment.queries";

function getInitialLetter(name?: string | null): string {
  if (!name) return "U";
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : "U";
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 1000 / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

function getViewportIcon(width: number) {
  if (width >= 1024) return Monitor;
  if (width >= 640) return Tablet;
  return Smartphone;
}

type EditorCommentsSidebarProps = {
  storefrontId: string;
  themeId: string;
  templateId?: string;
  filter?: "open" | "resolved";
  onFilterChange?: (filter: "open" | "resolved") => void;
  groups: StorefrontCommentGroupDTO[];
  activeGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  threads: StorefrontCommentThreadDTO[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  previewWidth?: number;
  onCreateGroup?: () => void;
};

export const EditorCommentsSidebar = memo(function EditorCommentsSidebar({
  storefrontId,
  themeId,
  templateId,
  filter: filterProp,
  onFilterChange,
  groups,
  activeGroupId,
  onSelectGroup,
  threads,
  activeThreadId,
  onSelectThread,
  previewWidth = 1440,
  onCreateGroup,
}: EditorCommentsSidebarProps) {
  const queryClient = useQueryClient();
  const [internalFilter, setInternalFilter] = useState<"open" | "resolved">("open");
  const filter = filterProp ?? internalFilter;
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const getSessionGroupMap = useCallback((): { open?: string; resolved?: string } => {
    try {
      const raw = sessionStorage.getItem(
        `morph:comments-last-group:${storefrontId}:${themeId}:${templateId ?? "default"}`,
      );
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [storefrontId, themeId, templateId]);

  const setSessionGroup = useCallback(
    (tab: "open" | "resolved", groupId: string) => {
      try {
        const current = getSessionGroupMap();
        current[tab] = groupId;
        sessionStorage.setItem(
          `morph:comments-last-group:${storefrontId}:${themeId}:${templateId ?? "default"}`,
          JSON.stringify(current),
        );
      } catch {
        // Ignore storage errors
      }
    },
    [getSessionGroupMap, storefrontId, themeId, templateId],
  );

  const handleGroupSelect = useCallback(
    (groupId: string) => {
      setSessionGroup(filter, groupId);
      onSelectGroup(groupId);
    },
    [filter, onSelectGroup, setSessionGroup],
  );

  useEffect(() => {
    if (activeGroupId) {
      setSessionGroup(filter, activeGroupId);
    }
  }, [activeGroupId, filter, setSessionGroup]);

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const openThreads = useMemo(
    () => threads.filter((t) => t.status === "open"),
    [threads],
  );
  const resolvedThreads = useMemo(
    () => threads.filter((t) => t.status === "resolved"),
    [threads],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: storefrontCommentQueries.all(),
    });
  };

  const updateGroupMutation = useMutation({
    mutationFn: async (data: {
      groupId: string;
      name?: string;
      viewportWidth?: number;
    }) => {
      const res = await updateStorefrontCommentGroup({
        data: {
          storefrontId,
          themeId,
          ...data,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      invalidate();
      setEditingGroupId(null);
      toast.success("Group updated");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update group");
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const res = await deleteStorefrontCommentGroup({
        data: {
          storefrontId,
          themeId,
          groupId,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Group deleted");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete group");
    },
  });

  const clearResolvedGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const res = await clearStorefrontCommentGroupResolved({
        data: {
          storefrontId,
          themeId,
          groupId,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Resolved comments cleared");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to clear comments",
      );
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({
      threadId,
      resolved,
    }: {
      threadId: string;
      resolved: boolean;
    }) => {
      const res = await resolveStorefrontCommentThread({
        data: {
          storefrontId,
          themeId,
          threadId,
          resolved,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: (_, vars) => {
      invalidate();
      onSelectThread(null);
      toast.success(vars.resolved ? "Thread resolved" : "Thread reopened");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update thread");
    },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await deleteStorefrontCommentThread({
        data: {
          storefrontId,
          themeId,
          threadId,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      invalidate();
      onSelectThread(null);
      toast.success("Thread deleted");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete thread");
    },
  });

  const handleStartRename = (group: StorefrontCommentGroupDTO) => {
    setEditingGroupId(group.id);
    setEditingName(group.name);
  };

  const handleSaveRename = (groupId: string) => {
    if (!editingName.trim()) {
      setEditingGroupId(null);
      return;
    }
    updateGroupMutation.mutate({ groupId, name: editingName.trim() });
  };

  // Group threads by their groupId
  const groupDataList = useMemo(() => {
    const list = filter === "open" ? openThreads : resolvedThreads;
    return groups
      .map((group) => {
        let groupThreads = list.filter((t) => t.groupId === group.id);

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          groupThreads = groupThreads.filter(
            (t) =>
              t.author.name.toLowerCase().includes(q) ||
              t.comments.some((c) => c.content.toLowerCase().includes(q)),
          );
        }

        const allGroupThreads = threads.filter((t) => t.groupId === group.id);
        const openCount = allGroupThreads.filter((t) => t.status === "open").length;
        const resolvedCount = allGroupThreads.filter(
          (t) => t.status === "resolved",
        ).length;

        return {
          ...group,
          threads: groupThreads,
          openCount,
          resolvedCount,
        };
      })
      .filter((group) => {
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return group.name.toLowerCase().includes(q) || group.threads.length > 0;
        }
        if (filter === "resolved") {
          return group.resolvedCount > 0;
        }
        // In "open" view: show groups with open comments, OR newly created empty groups
        return (
          group.openCount > 0 ||
          (group.openCount === 0 && group.resolvedCount === 0)
        );
      });
  }, [groups, threads, filter, openThreads, resolvedThreads, searchQuery]);

  // If active group has 0 comments in the current filter, auto-switch to first available matching group
  useEffect(() => {
    if (!activeGroupId || groups.length === 0) return;
    const currentGroup = groups.find((g) => g.id === activeGroupId);
    if (!currentGroup) return;

    if (filter === "open") {
      const allGroupThreads = threads.filter((t) => t.groupId === activeGroupId);
      const openCount = allGroupThreads.filter((t) => t.status === "open").length;
      const resolvedCount = allGroupThreads.filter(
        (t) => t.status === "resolved",
      ).length;
      // Only auto-switch away if this group previously had comments that all got resolved!
      if (openCount === 0 && resolvedCount > 0) {
        const otherOpenGroups = groups.filter((g) =>
          threads.some((t) => t.groupId === g.id && t.status === "open"),
        );
        if (otherOpenGroups.length > 0) {
          handleGroupSelect(otherOpenGroups[0].id);
        }
      }
    } else if (filter === "resolved") {
      const allGroupThreads = threads.filter((t) => t.groupId === activeGroupId);
      const resolvedCount = allGroupThreads.filter(
        (t) => t.status === "resolved",
      ).length;
      if (resolvedCount === 0) {
        const otherResolvedGroups = groups.filter((g) =>
          threads.some((t) => t.groupId === g.id && t.status === "resolved"),
        );
        if (otherResolvedGroups.length > 0) {
          handleGroupSelect(otherResolvedGroups[0].id);
        }
      }
    }
  }, [filter, activeGroupId, groups, threads, handleGroupSelect]);

  const handleFilterChange = (newFilter: "open" | "resolved") => {
    setInternalFilter(newFilter);
    onFilterChange?.(newFilter);
    onSelectThread(null);

    const relevantThreads = newFilter === "open" ? openThreads : resolvedThreads;
    const matchingGroups = groups.filter((g) =>
      relevantThreads.some((t) => t.groupId === g.id),
    );

    const sessionMap = getSessionGroupMap();
    const savedGroupId = sessionMap[newFilter];

    if (newFilter === "resolved") {
      if (matchingGroups.length > 0) {
        const targetGroup =
          matchingGroups.find((g) => g.id === savedGroupId) ?? matchingGroups[0];
        handleGroupSelect(targetGroup.id);
      }
    } else {
      if (matchingGroups.length > 0) {
        const targetGroup =
          matchingGroups.find((g) => g.id === savedGroupId) ?? matchingGroups[0];
        handleGroupSelect(targetGroup.id);
      } else if (groups.length > 0) {
        const targetGroup =
          groups.find((g) => g.id === savedGroupId) ?? groups[0];
        handleGroupSelect(targetGroup.id);
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-component text-foreground">
      {/* Segmented Filter Switch & Group Header Bar */}
      <div className="border-b p-2.5 space-y-2">
        <div className="flex h-8 items-center rounded-md bg-muted/70 p-0.5 dark:bg-muted/40">
          <Button
            variant={filter === "open" ? "toolbarActive" : "ghost"}
            size="xs"
            onClick={() => handleFilterChange("open")}
            className="flex-1 h-7 text-xs font-medium"
          >
            Open ({openThreads.length})
          </Button>
          <Button
            variant={filter === "resolved" ? "toolbarActive" : "ghost"}
            size="xs"
            onClick={() => handleFilterChange("resolved")}
            className="flex-1 h-7 text-xs font-medium"
          >
            Resolved ({resolvedThreads.length})
          </Button>
        </div>

        {/* Quick New Group Action Bar */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">
            {groups.length} {groups.length === 1 ? "group" : "groups"}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={onCreateGroup}
            className="h-6 gap-1 px-2 text-[11px] font-medium text-foreground hover:bg-muted"
          >
            <Plus className="size-3" />
            <span>New group</span>
          </Button>
        </div>
      </div>

      {/* Search Input */}
      <div className="border-b px-2.5 py-2">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 size-3.5 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search groups or comments..."
            className="h-8 pl-8 pr-7 text-xs bg-background"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Groups & Threads List */}
      <ScrollArea className="min-h-0 flex-1">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs">
              <MessageSquarePlus className="size-5 text-muted-foreground" />
            </div>
            <h3 className="mt-3.5 text-xs font-semibold text-foreground">
              No comment groups yet
            </h3>
            <p className="mt-1 max-w-56 text-[11px] leading-relaxed text-muted-foreground">
              Create a group to pin and organize feedback at your desired viewport width.
            </p>
            <Button
              variant="form"
              size="xs"
              onClick={onCreateGroup}
              className="mt-3.5 gap-1.5 text-xs font-medium"
            >
              <Plus className="size-3.5" />
              <span>Create group</span>
            </Button>
          </div>
        ) : groupDataList.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs">
              <CheckCircle2
                className={cn(
                  "size-5",
                  filter === "open" ? "text-emerald-500" : "text-muted-foreground",
                )}
              />
            </div>
            <h3 className="mt-3.5 text-xs font-semibold text-foreground">
              {searchQuery.trim()
                ? "No matching results"
                : filter === "resolved"
                  ? "No resolved comments"
                  : "All comments resolved"}
            </h3>
            <p className="mt-1 max-w-56 text-[11px] leading-relaxed text-muted-foreground">
              {searchQuery.trim()
                ? `No comments or groups match "${searchQuery}".`
                : filter === "resolved"
                  ? "Comments that have been resolved will appear here."
                  : "Great job! There are no open comments remaining."}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 p-2.5">
            {groupDataList.map((group) => {
              const isSelectedGroup = activeGroupId === group.id;
              const isCollapsed = Boolean(collapsedGroups[group.id]);
              const groupCount =
                filter === "open" ? group.openCount : group.resolvedCount;
              const Icon = getViewportIcon(group.viewportWidth);
              const isEditing = editingGroupId === group.id;

              return (
                <div
                  key={group.id}
                  className={cn(
                    "overflow-hidden rounded-lg border transition-colors",
                    isSelectedGroup
                      ? "border-primary/40 bg-accent/25 shadow-xs"
                      : "border-border bg-component hover:border-border/80",
                  )}
                >
                  {/* Group Header */}
                  <div
                    onClick={() => handleGroupSelect(group.id)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between px-3 py-2 text-xs select-none transition-colors",
                      isSelectedGroup
                        ? "bg-accent/40 text-foreground"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroupCollapse(group.id);
                        }}
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="size-3.5" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                      </button>

                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          isSelectedGroup
                            ? "text-primary"
                            : "text-muted-foreground",
                        )}
                      />

                      {/* Inline Rename or Name Display */}
                      {isEditing ? (
                        <div
                          className="flex items-center gap-1 flex-1 min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Input
                            autoFocus
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRename(group.id);
                              if (e.key === "Escape") setEditingGroupId(null);
                            }}
                            onBlur={() => handleSaveRename(group.id)}
                            className="h-6 px-1.5 py-0 text-xs font-medium"
                          />
                        </div>
                      ) : (
                        <span
                          className="font-medium truncate text-[12px] hover:underline"
                          title="Click to select group"
                        >
                          {group.name}
                        </span>
                      )}

                      {/* Width Tag */}
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                        {group.viewportWidth}px
                      </span>

                      {isSelectedGroup ? (
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                          Active
                        </span>
                      ) : null}
                    </div>

                    {/* Right side: Count & Dropdown Menu */}
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                        {groupCount}
                      </span>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 text-muted-foreground hover:text-foreground"
                          >
                            <MoreVertical className="size-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-34">
                          <DropdownMenuItem
                            onClick={() => handleStartRename(group)}
                            className="text-xs gap-2"
                          >
                            <Pencil className="size-3.5" />
                            <span>Rename</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              updateGroupMutation.mutate({
                                groupId: group.id,
                                viewportWidth: previewWidth,
                              })
                            }
                            className="text-xs gap-2"
                          >
                            <Maximize2 className="size-3.5" />
                            <span>Set to canvas</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              if (filter === "resolved" && group.openCount > 0) {
                                clearResolvedGroupMutation.mutate(group.id);
                              } else {
                                deleteGroupMutation.mutate(group.id);
                              }
                            }}
                            className="text-xs gap-2 text-destructive focus:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                            <span>
                              {filter === "resolved" && group.openCount > 0
                                ? "Clear"
                                : "Delete"}
                            </span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Group Body: List of Threads */}
                  {!isCollapsed ? (
                    <div className="space-y-1.5 p-2 pt-1 border-t border-border/40">
                      {group.threads.length === 0 ? (
                        <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                          {filter === "open"
                            ? "No open comments in this group."
                            : "No resolved comments in this group."}
                        </p>
                      ) : (
                        group.threads.map((thread) => {
                          const isSelected = activeThreadId === thread.id;
                          const firstComment = thread.comments[0];
                          const replyCount = Math.max(
                            0,
                            thread.comments.length - 1,
                          );
                          const initial = getInitialLetter(thread.author.name);

                          return (
                            <div
                              key={thread.id}
                              onClick={() => {
                                handleGroupSelect(group.id);
                                onSelectThread(isSelected ? null : thread.id);
                              }}
                              className={cn(
                                "group relative cursor-pointer rounded-md border p-2.5 text-xs transition-colors",
                                isSelected
                                  ? "border-primary/40 bg-accent text-accent-foreground shadow-xs"
                                  : "border-transparent bg-background/60 hover:border-border hover:bg-accent/40",
                              )}
                            >
                              {/* Author Header */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Avatar className="size-5 rounded-full border border-border">
                                    {thread.author.image ? (
                                      <AvatarImage
                                        src={thread.author.image}
                                        alt={thread.author.name}
                                      />
                                    ) : null}
                                    <AvatarFallback className="size-full rounded-full bg-muted font-semibold text-[10px] text-foreground">
                                      {initial}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="font-medium text-foreground text-xs">
                                    {thread.author.name}
                                  </span>
                                </div>

                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {formatRelativeTime(thread.createdAt)}
                                </span>
                              </div>

                              {/* Comment Content Snippet */}
                              <p className="mt-1.5 line-clamp-2 pl-7 text-[12px] leading-relaxed text-muted-foreground group-hover:text-foreground">
                                {firstComment?.content ?? "No content"}
                              </p>

                              {/* Footer & Actions */}
                              <div className="mt-2 flex items-center justify-between pl-7">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {replyCount > 0 ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
                                      <MessageCircle className="size-3 text-muted-foreground" />
                                      <span>
                                        {replyCount}{" "}
                                        {replyCount === 1 ? "reply" : "replies"}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground tabular-nums">
                                      Pin ({Math.round(thread.positionX)}%,{" "}
                                      {Math.round(thread.positionY)}%)
                                    </span>
                                  )}
                                </div>

                                {/* Quick Inline Actions */}
                                <div
                                  className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 text-muted-foreground hover:text-foreground"
                                    title={
                                      thread.status === "open"
                                        ? "Mark resolved"
                                        : "Reopen thread"
                                    }
                                    onClick={() =>
                                      resolveMutation.mutate({
                                        threadId: thread.id,
                                        resolved: thread.status === "open",
                                      })
                                    }
                                  >
                                    {thread.status === "open" ? (
                                      <Check className="size-3.5 text-emerald-500" />
                                    ) : (
                                      <Undo2 className="size-3.5 text-blue-500" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 text-muted-foreground hover:text-destructive"
                                    title="Delete thread"
                                    onClick={() =>
                                      deleteThreadMutation.mutate(thread.id)
                                    }
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
