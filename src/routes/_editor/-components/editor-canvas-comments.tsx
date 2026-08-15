import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { StorefrontCommentThreadDTO } from "@/lib/storefront/dto/storefront-comment.dto";
import {
  createStorefrontCommentThread,
  deleteStorefrontCommentThread,
  replyStorefrontComment,
  resolveStorefrontCommentThread,
  updateStorefrontCommentThreadPosition,
} from "@/server/storefront/storefront-comments.serverFn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CornerDownLeft,
  LoaderCircle,
  SendHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { storefrontCommentQueries } from "../-queries/storefront-comment.queries";

const AUTHOR_PALETTES = [
  { bg: "bg-blue-600", text: "text-white" },
  { bg: "bg-violet-600", text: "text-white" },
  { bg: "bg-emerald-600", text: "text-white" },
  { bg: "bg-amber-600", text: "text-white" },
  { bg: "bg-rose-600", text: "text-white" },
  { bg: "bg-indigo-600", text: "text-white" },
  { bg: "bg-teal-600", text: "text-white" },
  { bg: "bg-cyan-600", text: "text-white" },
];

function getAuthorPalette(idOrName?: string | null) {
  if (!idOrName) return AUTHOR_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < idOrName.length; i++) {
    hash = (hash << 5) - hash + idOrName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AUTHOR_PALETTES.length;
  return AUTHOR_PALETTES[index];
}

function getInitials(name?: string | null): string {
  if (!name) return "U";
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

type EditorCanvasCommentsProps = {
  storefrontId: string;
  themeId: string;
  templateId: string;
  activeGroupId?: string | null;
  onActiveGroupChange?: (groupId: string) => void;
  filter?: "open" | "resolved";
  threads: StorefrontCommentThreadDTO[];
  isCommentMode: boolean;
  activeThreadId: string | null;
  onActiveThreadChange: (threadId: string | null) => void;
  draftPin: { x: number; y: number } | null;
  onDraftPinChange: (draft: { x: number; y: number } | null) => void;
  previewWidth?: number;
  previewHeight?: number;
  currentUser?: {
    id?: string;
    name?: string;
    email?: string;
    image?: string | null;
  };
  canvasScale?: number;
};

export const EditorCanvasComments = memo(function EditorCanvasComments({
  storefrontId,
  themeId,
  templateId,
  activeGroupId,
  onActiveGroupChange,
  filter = "open",
  threads,
  isCommentMode,
  activeThreadId,
  onActiveThreadChange,
  draftPin,
  onDraftPinChange,
  previewWidth,
  currentUser,
  canvasScale = 1,
}: EditorCanvasCommentsProps) {
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [draftContent, setDraftContent] = useState("");
  const draftInputRef = useRef<HTMLTextAreaElement>(null);

  const [optimisticPositions, setOptimisticPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});

  const [isDraggingPin, setIsDraggingPin] = useState(false);

  const dragRef = useRef<{
    threadId: string | null;
    isDraft: boolean;
    startClientX: number;
    startClientY: number;
    initialX: number;
    initialY: number;
    hasMoved: boolean;
    wasActiveBeforeDrag: boolean;
  } | null>(null);

  useEffect(() => {
    if (draftPin && !isDraggingPin) {
      setTimeout(() => draftInputRef.current?.focus(), 50);
    } else if (!draftPin) {
      setDraftContent("");
    }
  }, [draftPin, isDraggingPin]);

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: storefrontCommentQueries.all(),
    });
  };

  const createThreadMutation = useMutation({
    mutationFn: async ({
      positionX,
      positionY,
      content,
    }: {
      positionX: number;
      positionY: number;
      content: string;
    }) => {
      const currentWidth = previewWidth ?? 1440;
      const currentViewport =
        currentWidth < 640
          ? "mobile"
          : currentWidth < 1024
            ? "tablet"
            : "desktop";

      const res = await createStorefrontCommentThread({
        data: {
          storefrontId,
          themeId,
          templateId,
          groupId: activeGroupId ?? undefined,
          viewportWidth: currentWidth,
          viewport: currentViewport,
          positionX,
          positionY,
          content,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: (newThread) => {
      invalidate();
      onDraftPinChange(null);
      if (newThread?.groupId && newThread.groupId !== activeGroupId) {
        onActiveGroupChange?.(newThread.groupId);
      }
      if (newThread) {
        onActiveThreadChange(newThread.id);
      }
      toast.success("Comment added");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to add comment");
    },
  });

  const updatePositionMutation = useMutation({
    mutationFn: async ({
      threadId,
      positionX,
      positionY,
    }: {
      threadId: string;
      positionX: number;
      positionY: number;
    }) => {
      const res = await updateStorefrontCommentThreadPosition({
        data: {
          storefrontId,
          themeId,
          threadId,
          positionX,
          positionY,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to move comment");
      invalidate();
    },
  });

  const handleCreateDraftSubmit = () => {
    if (!draftPin || !draftContent.trim() || createThreadMutation.isPending) {
      return;
    }
    createThreadMutation.mutate({
      positionX: draftPin.x,
      positionY: draftPin.y,
      content: draftContent.trim(),
    });
  };

  const handlePinPointerDown = (
    e: ReactPointerEvent<HTMLButtonElement>,
    threadId: string,
    initialX: number,
    initialY: number,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    const wasActive = activeThreadId === threadId;
    dragRef.current = {
      threadId,
      isDraft: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initialX,
      initialY,
      hasMoved: false,
      wasActiveBeforeDrag: wasActive,
    };
  };

  const handleDraftPinPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    initialX: number,
    initialY: number,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    dragRef.current = {
      threadId: null,
      isDraft: true,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initialX,
      initialY,
      hasMoved: false,
      wasActiveBeforeDrag: true,
    };
  };

  const handlePinPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || !containerRef.current) return;

    const deltaX = Math.abs(e.clientX - drag.startClientX);
    const deltaY = Math.abs(e.clientY - drag.startClientY);

    if (deltaX > 3 || deltaY > 3) {
      drag.hasMoved = true;
      setIsDraggingPin(true);
    }

    if (!drag.hasMoved) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const rawX = ((e.clientX - rect.left) / rect.width) * 100;
    const rawY = ((e.clientY - rect.top) / rect.height) * 100;
    const clampedX = Math.max(2, Math.min(98, Math.round(rawX * 10) / 10));
    const clampedY = Math.max(2, Math.min(98, Math.round(rawY * 10) / 10));

    if (drag.isDraft) {
      onDraftPinChange({ x: clampedX, y: clampedY });
    } else if (drag.threadId) {
      setOptimisticPositions((prev) => ({
        ...prev,
        [drag.threadId!]: { x: clampedX, y: clampedY },
      }));
    }
  };

  const handlePinPointerUp = (
    e: ReactPointerEvent<HTMLElement>,
    threadId: string | null,
    isDraft: boolean,
  ) => {
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const drag = dragRef.current;
    dragRef.current = null;
    setIsDraggingPin(false);

    if (!drag) return;

    if (drag.hasMoved) {
      if (!isDraft && threadId) {
        const finalPos = optimisticPositions[threadId];
        if (finalPos) {
          updatePositionMutation.mutate({
            threadId,
            positionX: finalPos.x,
            positionY: finalPos.y,
          });
        }
        if (drag.wasActiveBeforeDrag) {
          onActiveThreadChange(threadId);
        }
      }
    } else {
      if (!isDraft && threadId) {
        onDraftPinChange(null);
        onActiveThreadChange(activeThreadId === threadId ? null : threadId);
      } else if (isDraft) {
        onDraftPinChange(null);
      }
    }
  };

  const currentInitials = getInitials(currentUser?.name);
  const scaleFactor = canvasScale > 0 ? 1 / canvasScale : 1;

  if (!isCommentMode) {
    return null;
  }

  // Filter pins to ONLY show those matching the currently active group and current status (open / resolved)
  const visibleThreads = useMemo(() => {
    return threads.filter((thread) => {
      if (activeThreadId && thread.id === activeThreadId) return true;
      if (activeGroupId && thread.groupId !== activeGroupId) return false;
      if (filter && thread.status !== filter) return false;
      return true;
    });
  }, [threads, activeThreadId, activeGroupId, filter]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-30"
    >
      {/* Existing Threads Pins for Current Viewport */}
      {visibleThreads.map((thread) => {
        const isActive = thread.id === activeThreadId;
        const isCurrentlyDragging =
          isDraggingPin && dragRef.current?.threadId === thread.id;
        const pos = optimisticPositions[thread.id] ?? {
          x: thread.positionX,
          y: thread.positionY,
        };
        const leftPercent = pos.x;
        const topPercent = pos.y;
        const initials = getInitials(thread.author.name);
        const palette = getAuthorPalette(thread.author.id || thread.author.name);

        return (
          <div
            key={thread.id}
            style={{
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
              transform: `scale(${scaleFactor}) translate(-50%, -50%)`,
              transformOrigin: "0 0",
            }}
            className={cn(
              "pointer-events-auto absolute select-none",
              isCurrentlyDragging && "z-50",
            )}
          >
            {/* Draggable & Toggleable Teardrop Pin Marker Button */}
            <button
              type="button"
              onPointerDown={(e) =>
                handlePinPointerDown(e, thread.id, leftPercent, topPercent)
              }
              onPointerMove={handlePinPointerMove}
              onPointerUp={(e) => handlePinPointerUp(e, thread.id, false)}
              onPointerCancel={(e) => handlePinPointerUp(e, thread.id, false)}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "group relative flex size-8 cursor-grab items-center justify-center rounded-[16px_16px_16px_3px] bg-background border border-border p-[2px] shadow-md transition-transform duration-150 active:cursor-grabbing hover:scale-110 focus-visible:outline-none touch-none",
                isActive &&
                  "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg",
                thread.status === "resolved" &&
                  "opacity-50 grayscale-[0.7]",
                isCurrentlyDragging &&
                  "scale-115 cursor-grabbing shadow-xl ring-2 ring-primary",
              )}
            >
              {/* Inner Avatar Circle */}
              <Avatar className="size-full rounded-full pointer-events-none">
                {thread.author.image ? (
                  <AvatarImage
                    src={thread.author.image}
                    alt={thread.author.name}
                    className="size-full object-cover rounded-full"
                  />
                ) : null}
                <AvatarFallback
                  className={cn(
                    "size-full rounded-full font-semibold text-[10px] text-white flex items-center justify-center shadow-inner",
                    palette.bg,
                  )}
                >
                  {initials}
                </AvatarFallback>
              </Avatar>

              {/* Reply count badge */}
              {thread.comments.length > 1 ? (
                <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border border-background bg-foreground text-[9px] font-semibold text-background shadow-xs pointer-events-none">
                  {thread.comments.length}
                </span>
              ) : null}

              {/* Hover / Drag Tooltip Pill */}
              <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 whitespace-nowrap rounded-md border bg-popover px-2 py-0.5 text-[11px] font-medium text-popover-foreground shadow-md backdrop-blur-xs">
                <span>{thread.author.name}</span>
                <span className="ml-1 text-[9px] text-muted-foreground font-normal">
                  (Drag to move)
                </span>
              </div>
            </button>

            {/* Active Thread Popover Card */}
            {isActive && !isDraggingPin ? (
              <div
                data-comment-popover
                className={cn(
                  "absolute -top-2 z-40 w-72 sm:w-80 cursor-default select-text touch-auto",
                  leftPercent > 65 ? "right-12" : "left-12",
                )}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              >
                <ThreadCard
                  thread={thread}
                  storefrontId={storefrontId}
                  themeId={themeId}
                  onClose={() => onActiveThreadChange(null)}
                  onInvalidate={invalidate}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {/* New Draft Pin & Popover */}
      {draftPin ? (
        <div
          style={{
            left: `${draftPin.x}%`,
            top: `${draftPin.y}%`,
            transform: `scale(${scaleFactor}) translate(-50%, -50%)`,
            transformOrigin: "0 0",
          }}
          className="pointer-events-auto absolute select-none"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Draggable Draft Pin Icon */}
          <div
            onPointerDown={(e) =>
              handleDraftPinPointerDown(e, draftPin.x, draftPin.y)
            }
            onPointerMove={handlePinPointerMove}
            onPointerUp={(e) => handlePinPointerUp(e, null, true)}
            onPointerCancel={(e) => handlePinPointerUp(e, null, true)}
            title="Drag to reposition comment pin (click to cancel)"
            className={cn(
              "flex size-8 cursor-grab items-center justify-center rounded-[16px_16px_16px_3px] bg-background border border-border p-[2px] shadow-lg animate-in zoom-in-75 duration-150 ring-2 ring-primary ring-offset-2 ring-offset-background active:cursor-grabbing touch-none",
              isDraggingPin && "scale-115 cursor-grabbing shadow-xl ring-2 ring-primary",
            )}
          >
            <Avatar className="size-full rounded-full pointer-events-none">
              {currentUser?.image ? (
                <AvatarImage
                  src={currentUser.image}
                  alt={currentUser.name ?? "User"}
                  className="size-full object-cover rounded-full"
                />
              ) : null}
              <AvatarFallback
                className={cn(
                  "size-full rounded-full font-semibold text-[10px] text-white flex items-center justify-center shadow-inner",
                  getAuthorPalette(currentUser?.id ?? currentUser?.name).bg,
                )}
              >
                {getInitials(currentUser?.name)}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Draft Input Card */}
          {!isDraggingPin ? (
            <div
              data-comment-popover
              onWheel={(e) => e.stopPropagation()}
              className={cn(
                "absolute -top-2 z-40 w-72 sm:w-80 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg animate-in fade-in-50 zoom-in-95 duration-150 cursor-default select-text touch-auto",
                draftPin.x > 65 ? "right-12" : "left-12",
              )}
            >
              <div className="flex items-center justify-between border-b pb-2">
                <div className="flex items-center gap-2">
                  <Avatar className="size-5 rounded-full border border-border">
                    {currentUser?.image ? (
                      <AvatarImage src={currentUser.image} />
                    ) : null}
                    <AvatarFallback className="text-[9px] font-bold bg-muted text-foreground">
                      {currentInitials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-semibold text-foreground">
                    {currentUser?.name ?? "You"}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    (Drag pin to move)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDraftPinChange(null)}
                  className="size-6 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </Button>
              </div>

              <Textarea
                ref={draftInputRef}
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    onDraftPinChange(null);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleCreateDraftSubmit();
                  }
                }}
                placeholder="Leave a comment... (Enter to send, Esc to cancel)"
                rows={3}
                className="mt-2.5 min-h-16 resize-none bg-background text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
              />

              <div className="mt-2.5 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onDraftPinChange(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="form"
                  size="sm"
                  className="h-7 px-3 text-xs font-medium"
                  disabled={!draftContent.trim() || createThreadMutation.isPending}
                  onClick={handleCreateDraftSubmit}
                >
                  {createThreadMutation.isPending ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <>
                      <span>Post</span>
                      <CornerDownLeft className="ml-1 size-3 opacity-80" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

function ThreadCard({
  thread,
  storefrontId,
  themeId,
  onClose,
  onInvalidate,
}: {
  thread: StorefrontCommentThreadDTO;
  storefrontId: string;
  themeId: string;
  onClose: () => void;
  onInvalidate: () => void;
}) {
  const [replyText, setReplyText] = useState("");
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "instant",
        block: "end",
      });
    }, 20);
    return () => clearTimeout(timer);
  }, [thread.id, thread.comments.length]);

  const replyMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await replyStorefrontComment({
        data: {
          storefrontId,
          themeId,
          threadId: thread.id,
          content,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      setReplyText("");
      onInvalidate();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to add reply");
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (resolved: boolean) => {
      const res = await resolveStorefrontCommentThread({
        data: {
          storefrontId,
          themeId,
          threadId: thread.id,
          resolved,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      onInvalidate();
      onClose();
      toast.success(
        thread.status === "open" ? "Thread resolved" : "Thread reopened",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await deleteStorefrontCommentThread({
        data: {
          storefrontId,
          themeId,
          threadId: thread.id,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      onInvalidate();
      onClose();
      toast.success("Thread deleted");
    },
  });

  const handleReplySubmit = () => {
    if (!replyText.trim() || replyMutation.isPending) return;
    replyMutation.mutate(replyText.trim());
  };

  return (
    <div
      data-thread-card
      onWheel={(e) => e.stopPropagation()}
      className="flex flex-col rounded-lg border bg-popover text-popover-foreground shadow-lg animate-in fade-in-50 zoom-in-95 duration-150 cursor-default select-text touch-auto overflow-hidden"
    >
      {/* Header with Actions */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Button
            variant={thread.status === "open" ? "form" : "ghost"}
            size="xs"
            onClick={() => resolveMutation.mutate(thread.status === "open")}
            disabled={resolveMutation.isPending}
            className="h-6 gap-1 rounded-md px-2.5 text-[11px] font-medium"
          >
            {thread.status === "resolved" ? (
              <>
                <Undo2 className="size-3" />
                <span>Reopen</span>
              </>
            ) : (
              <>
                <Check className="size-3" />
                <span>Resolve</span>
              </>
            )}
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="size-6 text-muted-foreground hover:text-destructive"
            title="Delete thread"
          >
            <Trash2 className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages List - shadcn ScrollArea flush against the right outer edge */}
      <ScrollArea
        data-scroll-container
        className="max-h-52 w-full touch-auto [&>[data-slot=scroll-area-viewport]]:max-h-52"
      >
        <div className="space-y-3 px-3 py-2.5 divide-y divide-border/60">
          {thread.comments.map((comment) => {
            const initials = getInitials(comment.author.name);
            return (
              <div key={comment.id} className="space-y-1 text-xs pt-2 first:pt-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar className="size-5.5 rounded-full border border-border">
                      {comment.author.image ? (
                        <AvatarImage
                          src={comment.author.image}
                          alt={comment.author.name}
                          className="size-full object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="size-full rounded-full bg-muted font-bold text-[10px] text-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-semibold text-foreground">
                      {comment.author.name}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {formatRelativeTime(comment.createdAt)}
                  </span>
                </div>
                <p className="pl-7.5 text-muted-foreground leading-relaxed break-words">
                  {comment.content}
                </p>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Reply Input Box */}
      <div className="shrink-0 border-t p-3 pt-2.5">
        <div className="relative flex items-center">
          <Textarea
            ref={replyInputRef}
            rows={1}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleReplySubmit();
              }
            }}
            placeholder="Reply... (Esc to close)"
            className="min-h-8 resize-none bg-background py-1.5 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            variant="form"
            size="icon"
            disabled={!replyText.trim() || replyMutation.isPending}
            onClick={handleReplySubmit}
            className="absolute right-1 size-6 rounded-md"
          >
            {replyMutation.isPending ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <SendHorizontal className="size-3" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
