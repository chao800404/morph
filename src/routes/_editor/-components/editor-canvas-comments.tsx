import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { StorefrontCommentThreadDTO } from "@/lib/storefront/dto/storefront-comment.dto";
import {
  createStorefrontCommentThread,
  updateStorefrontCommentThreadPosition,
} from "@/server/storefront/storefront-comments.serverFn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, LoaderCircle, X } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { optimisticListMutation } from "@/lib/query/optimistic-list";
import { storefrontCommentQueries } from "../-queries/storefront-comment.queries";
import { CommentPin } from "./comments/comment-pin";
import { CommentThreadCard } from "./comments/comment-thread-card";
import { getAuthorPalette, getInitials } from "./comments/comment-utils";

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

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: storefrontCommentQueries.all(),
    });
  }, [queryClient]);

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
    // The pin is already where it was dropped. Waiting for a round trip to
    // agree makes it jump back and then forward again, which reads as the drag
    // having failed.
    ...optimisticListMutation<
      StorefrontCommentThreadDTO,
      { threadId: string; positionX: number; positionY: number }
    >({
      queryClient,
      prefix: storefrontCommentQueries.all(),
      patch: (threads, { threadId, positionX, positionY }) =>
        threads.map((thread) =>
          thread.id === threadId ? { ...thread, positionX, positionY } : thread,
        ),
      onError: (error) => toast.error(error.message),
    }),
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

  const handlePinPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      threadId: string,
      currentX: number,
      currentY: number,
    ) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      const isActive = activeThreadId === threadId;
      dragRef.current = {
        threadId,
        isDraft: false,
        startClientX: event.clientX,
        startClientY: event.clientY,
        initialX: currentX,
        initialY: currentY,
        hasMoved: false,
        wasActiveBeforeDrag: isActive,
      };
      setIsDraggingPin(true);
    },
    [activeThreadId],
  );

  const handleDraftPinPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLDivElement>,
      currentX: number,
      currentY: number,
    ) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      dragRef.current = {
        threadId: null,
        isDraft: true,
        startClientX: event.clientX,
        startClientY: event.clientY,
        initialX: currentX,
        initialY: currentY,
        hasMoved: false,
        wasActiveBeforeDrag: true,
      };
      setIsDraggingPin(true);
    },
    [],
  );

  const handlePinPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || !containerRef.current) return;
      event.stopPropagation();

      const deltaX = event.clientX - drag.startClientX;
      const deltaY = event.clientY - drag.startClientY;

      if (!drag.hasMoved && Math.hypot(deltaX, deltaY) > 3) {
        drag.hasMoved = true;
      }

      if (!drag.hasMoved) return;

      const rect = containerRef.current.getBoundingClientRect();
      const currentScale = canvasScale || 1;
      const unscaledWidth = rect.width / currentScale;
      const unscaledHeight = rect.height / currentScale;

      const deltaXPercent = (deltaX / currentScale / unscaledWidth) * 100;
      const deltaYPercent = (deltaY / currentScale / unscaledHeight) * 100;

      const nextX = Math.max(
        0.5,
        Math.min(99.5, drag.initialX + deltaXPercent),
      );
      const nextY = Math.max(
        0.5,
        Math.min(99.5, drag.initialY + deltaYPercent),
      );

      if (drag.isDraft) {
        onDraftPinChange({ x: nextX, y: nextY });
      } else if (drag.threadId) {
        setOptimisticPositions((prev) => ({
          ...prev,
          [drag.threadId!]: { x: nextX, y: nextY },
        }));
      }
    },
    [canvasScale, onDraftPinChange],
  );

  const handlePinPointerUp = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      threadId: string | null,
      isDraft = false,
    ) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.stopPropagation();

      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}

      const didMove = drag.hasMoved;
      const wasActive = drag.wasActiveBeforeDrag;
      dragRef.current = null;
      setIsDraggingPin(false);

      if (!didMove) {
        if (!isDraft && threadId) {
          onActiveThreadChange(wasActive ? null : threadId);
        }
        return;
      }

      if (!isDraft && threadId) {
        const finalPos = optimisticPositions[threadId];
        if (finalPos) {
          updatePositionMutation.mutate({
            threadId,
            positionX: finalPos.x,
            positionY: finalPos.y,
          });
        }
      }
    },
    [onActiveThreadChange, optimisticPositions, updatePositionMutation],
  );

  const currentInitials = getInitials(currentUser?.name);
  const scaleFactor = 1 / Math.max(0.2, canvasScale);

  if (!isCommentMode) {
    return null;
  }

  // Filter pins to ONLY show those matching the currently active group and current status
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
      {/* Existing Threads Pins */}
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
            <CommentPin
              thread={thread}
              isActive={isActive}
              isDragging={isCurrentlyDragging}
              currentX={leftPercent}
              currentY={topPercent}
              onPointerDown={handlePinPointerDown}
              onPointerMove={handlePinPointerMove}
              onPointerUp={handlePinPointerUp}
              onPointerCancel={handlePinPointerUp}
              onClick={(e) => e.stopPropagation()}
            />

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
                <CommentThreadCard
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
              isDraggingPin &&
                "scale-115 cursor-grabbing shadow-xl ring-2 ring-primary",
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
                  disabled={
                    !draftContent.trim() || createThreadMutation.isPending
                  }
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
