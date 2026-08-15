import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { StorefrontCommentThreadDTO } from "@/lib/storefront/dto/storefront-comment.dto";
import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { getAuthorPalette, getInitials } from "./comment-utils";

type CommentPinProps = {
  thread: StorefrontCommentThreadDTO;
  isActive: boolean;
  isDragging: boolean;
  onPointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    threadId: string,
    x: number,
    y: number,
  ) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (
    event: ReactPointerEvent<HTMLButtonElement>,
    threadId: string,
  ) => void;
  onPointerCancel: (
    event: ReactPointerEvent<HTMLButtonElement>,
    threadId: string,
  ) => void;
  onClick: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  currentX: number;
  currentY: number;
};

export const CommentPin = memo(function CommentPin({
  thread,
  isActive,
  isDragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClick,
  currentX,
  currentY,
}: CommentPinProps) {
  const initials = getInitials(thread.author.name);
  const palette = getAuthorPalette(thread.author.id || thread.author.name);

  return (
    <button
      type="button"
      onPointerDown={(e) => onPointerDown(e, thread.id, currentX, currentY)}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerUp(e, thread.id)}
      onPointerCancel={(e) => onPointerCancel(e, thread.id)}
      onClick={onClick}
      className={cn(
        "group relative flex size-8 cursor-grab items-center justify-center rounded-[16px_16px_16px_3px] bg-background border border-border p-[2px] shadow-md transition-transform duration-150 active:cursor-grabbing hover:scale-110 focus-visible:outline-none touch-none",
        isActive &&
          "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg",
        thread.status === "resolved" && "opacity-50 grayscale-[0.7]",
        isDragging && "scale-115 cursor-grabbing shadow-xl ring-2 ring-primary",
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
  );
});
