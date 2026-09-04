import { Button } from "@/components/ui/button";
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
  resolveStorefrontCommentThread,
  updateStorefrontCommentGroup,
} from "@/server/storefront/storefront-comments.serverFn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageSquarePlus, Plus, Search, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { optimisticListMutation } from "@/lib/query/optimistic-list";
import { storefrontCommentQueries } from "../-queries/storefront-comment.queries";
import { CommentGroupItem } from "./comments/comment-group-item";

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
  previewWidth,
  onCreateGroup,
}: EditorCommentsSidebarProps) {
  const queryClient = useQueryClient();
  const [internalFilter, setInternalFilter] = useState<"open" | "resolved">(
    "open",
  );
  const filter = filterProp ?? internalFilter;

  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const getSessionGroupMap = useCallback((): {
    open?: string;
    resolved?: string;
  } => {
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
    ...optimisticListMutation<
      StorefrontCommentGroupDTO,
      { groupId: string; name?: string; viewportWidth?: number }
    >({
      queryClient,
      prefix: storefrontCommentQueries.all(),
      // Only the fields the caller actually sent are applied, so a viewport
      // change does not blank the name it did not mention.
      patch: (groups, { groupId, name, viewportWidth }) =>
        groups.map((group) =>
          group.id === groupId
            ? {
                ...group,
                ...(name === undefined ? {} : { name }),
                ...(viewportWidth === undefined ? {} : { viewportWidth }),
              }
            : group,
        ),
      onError: (error) => toast.error(error.message),
    }),
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
    ...optimisticListMutation<StorefrontCommentGroupDTO, string>({
      queryClient,
      prefix: storefrontCommentQueries.all(),
      patch: (groups, groupId) =>
        groups.filter((group) => group.id !== groupId),
      onError: (error) => toast.error(error.message),
    }),
    onSuccess: () => toast.success("Group deleted"),
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
    ...optimisticListMutation<StorefrontCommentThreadDTO, string>({
      queryClient,
      prefix: storefrontCommentQueries.all(),
      patch: (threads, groupId) =>
        threads.filter(
          (thread) =>
            !(thread.groupId === groupId && thread.status === "resolved"),
        ),
      onError: (error) => toast.error(error.message),
    }),
    onSuccess: () => toast.success("Resolved comments cleared"),
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
    ...optimisticListMutation<
      StorefrontCommentThreadDTO,
      { threadId: string; resolved: boolean }
    >({
      queryClient,
      prefix: storefrontCommentQueries.all(),
      patch: (threads, { threadId, resolved }) =>
        threads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                status: resolved ? "resolved" : "open",
                resolvedAt: resolved ? new Date().toISOString() : null,
              }
            : thread,
        ),
      onError: (error) => toast.error(error.message),
    }),
    onSuccess: (_, vars) => {
      onSelectThread(null);
      toast.success(vars.resolved ? "Thread resolved" : "Thread reopened");
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
        const openCount = allGroupThreads.filter(
          (t) => t.status === "open",
        ).length;
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
          return (
            group.name.toLowerCase().includes(q) || group.threads.length > 0
          );
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
      const allGroupThreads = threads.filter(
        (t) => t.groupId === activeGroupId,
      );
      const openCount = allGroupThreads.filter(
        (t) => t.status === "open",
      ).length;
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
      const allGroupThreads = threads.filter(
        (t) => t.groupId === activeGroupId,
      );
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

    const savedMap = getSessionGroupMap();
    const savedGroupId = savedMap[newFilter];

    const matchingGroups = groups.filter((g) => {
      const groupThreads = threads.filter((t) => t.groupId === g.id);
      return newFilter === "open"
        ? groupThreads.some((t) => t.status === "open")
        : groupThreads.some((t) => t.status === "resolved");
    });

    if (savedGroupId && matchingGroups.some((g) => g.id === savedGroupId)) {
      onSelectGroup(savedGroupId);
    } else if (matchingGroups.length > 0) {
      handleGroupSelect(matchingGroups[0].id);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      {/* Top Filter Switcher */}
      <div className="flex shrink-0 items-center justify-between border-b p-2">
        <div className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-xs">
          <button
            type="button"
            onClick={() => handleFilterChange("open")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-all",
              filter === "open"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>Open</span>
            <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] tabular-nums">
              {openThreads.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleFilterChange("resolved")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-all",
              filter === "resolved"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>Resolved</span>
            <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] tabular-nums">
              {resolvedThreads.length}
            </span>
          </button>
        </div>
      </div>

      {/* Header Info & Create Action */}
      <div className="border-b px-3 py-2">
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
              Create a group to pin and organize feedback at your desired
              viewport width.
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
                  filter === "open"
                    ? "text-emerald-500"
                    : "text-muted-foreground",
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
              const isEditing = editingGroupId === group.id;

              return (
                <CommentGroupItem
                  key={group.id}
                  group={group}
                  filter={filter}
                  isSelected={isSelectedGroup}
                  isCollapsed={isCollapsed}
                  isEditing={isEditing}
                  editingName={editingName}
                  onEditingNameChange={setEditingName}
                  onStartRename={handleStartRename}
                  onSaveRename={handleSaveRename}
                  onCancelRename={() => setEditingGroupId(null)}
                  onToggleCollapse={toggleGroupCollapse}
                  onSelectGroup={handleGroupSelect}
                  onSetToCanvas={(groupId) =>
                    updateGroupMutation.mutate({
                      groupId,
                      viewportWidth: previewWidth,
                    })
                  }
                  onClearResolved={(groupId) =>
                    clearResolvedGroupMutation.mutate(groupId)
                  }
                  onDeleteGroup={(groupId) =>
                    deleteGroupMutation.mutate(groupId)
                  }
                  activeThreadId={activeThreadId}
                  onSelectThread={onSelectThread}
                  onResolveThread={(threadId, resolved) =>
                    resolveMutation.mutate({ threadId, resolved })
                  }
                />
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
