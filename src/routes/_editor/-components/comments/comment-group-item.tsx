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
import { cn } from "@/lib/utils";
import type {
  StorefrontCommentGroupDTO,
  StorefrontCommentThreadDTO,
} from "@/lib/storefront/dto/storefront-comment.dto";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Maximize2,
  MessageCircle,
  MoreVertical,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { memo, type ElementType } from "react";
import {
  formatRelativeTime,
  getInitialLetter,
  getViewportIcon,
} from "./comment-utils";

type CommentGroupData = StorefrontCommentGroupDTO & {
  threads: StorefrontCommentThreadDTO[];
  openCount: number;
  resolvedCount: number;
};

type CommentGroupItemProps = {
  group: CommentGroupData;
  filter: "open" | "resolved";
  isSelected: boolean;
  isCollapsed: boolean;
  isEditing: boolean;
  editingName: string;
  onEditingNameChange: (name: string) => void;
  onStartRename: (group: StorefrontCommentGroupDTO) => void;
  onSaveRename: (groupId: string) => void;
  onCancelRename: () => void;
  onToggleCollapse: (groupId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onSetToCanvas: (groupId: string) => void;
  onClearResolved: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  activeThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  onResolveThread: (threadId: string, resolved: boolean) => void;
};

export const CommentGroupItem = memo(function CommentGroupItem({
  group,
  filter,
  isSelected,
  isCollapsed,
  isEditing,
  editingName,
  onEditingNameChange,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onToggleCollapse,
  onSelectGroup,
  onSetToCanvas,
  onClearResolved,
  onDeleteGroup,
  activeThreadId,
  onSelectThread,
  onResolveThread,
}: CommentGroupItemProps) {
  const groupCount = filter === "open" ? group.openCount : group.resolvedCount;
  const Icon: ElementType = getViewportIcon(group.viewportWidth);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        isSelected
          ? "border-primary/40 bg-accent/25 shadow-xs"
          : "border-border bg-component hover:border-border/80",
      )}
    >
      {/* Group Header */}
      <div
        onClick={() => onSelectGroup(group.id)}
        className={cn(
          "flex cursor-pointer items-center justify-between px-3 py-2 text-xs select-none transition-colors",
          isSelected ? "bg-accent/40 text-foreground" : "hover:bg-muted/40",
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(group.id);
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
              isSelected ? "text-primary" : "text-muted-foreground",
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
                onChange={(e) => onEditingNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveRename(group.id);
                  if (e.key === "Escape") onCancelRename();
                }}
                onBlur={() => onSaveRename(group.id)}
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

          {isSelected ? (
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
                onClick={() => onStartRename(group)}
                className="text-xs gap-2"
              >
                <Pencil className="size-3.5" />
                <span>Rename</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onSetToCanvas(group.id)}
                className="text-xs gap-2"
              >
                <Maximize2 className="size-3.5" />
                <span>Set to canvas</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  if (filter === "resolved" && group.openCount > 0) {
                    onClearResolved(group.id);
                  } else {
                    onDeleteGroup(group.id);
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
              const isThreadSelected = activeThreadId === thread.id;
              const firstComment = thread.comments[0];
              const replyCount = Math.max(0, thread.comments.length - 1);
              const initial = getInitialLetter(thread.author.name);

              return (
                <div
                  key={thread.id}
                  onClick={() => {
                    onSelectGroup(group.id);
                    onSelectThread(isThreadSelected ? null : thread.id);
                  }}
                  className={cn(
                    "group relative cursor-pointer rounded-md border p-2.5 text-xs transition-colors",
                    isThreadSelected
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
                          onResolveThread(thread.id, thread.status === "open")
                        }
                      >
                        {thread.status === "open" ? (
                          <Check className="size-3.5 text-emerald-500" />
                        ) : (
                          <Undo2 className="size-3.5 text-blue-500" />
                        )}
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
});
