import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { StorefrontCommentThreadDTO } from "@/lib/storefront/dto/storefront-comment.dto";
import {
  deleteStorefrontCommentThread,
  replyStorefrontComment,
  resolveStorefrontCommentThread,
} from "@/server/storefront/storefront-comments.serverFn";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  LoaderCircle,
  SendHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatRelativeTime, getInitials } from "./comment-utils";

type CommentThreadCardProps = {
  thread: StorefrontCommentThreadDTO;
  storefrontId: string;
  themeId: string;
  onClose: () => void;
  onInvalidate: () => void;
};

export const CommentThreadCard = memo(function CommentThreadCard({
  thread,
  storefrontId,
  themeId,
  onClose,
  onInvalidate,
}: CommentThreadCardProps) {
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

      {/* Messages List */}
      <ScrollArea
        data-scroll-container
        className="max-h-52 w-full touch-auto [&>[data-slot=scroll-area-viewport]]:max-h-52"
      >
        <div className="space-y-3 px-3 py-2.5 divide-y divide-border/60">
          {thread.comments.map((comment) => {
            const initials = getInitials(comment.author.name);
            return (
              <div
                key={comment.id}
                className="space-y-1 text-xs pt-2 first:pt-0"
              >
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
});
