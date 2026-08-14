import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export function EditorToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="toolbar"
      className={cn(
        "flex h-10 max-w-full items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-lg border bg-popover p-1 text-xs text-popover-foreground shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "[&_button]:transition-colors",
        "[&_button:not([disabled]):not([aria-pressed=true]):hover]:bg-accent [&_button:not([disabled]):not([aria-pressed=true]):hover]:text-accent-foreground dark:[&_button:not([disabled]):not([aria-pressed=true]):hover]:bg-white/10 dark:[&_button:not([disabled]):not([aria-pressed=true]):hover]:text-foreground",
        "[&_button:disabled]:opacity-50 [&_button:disabled]:cursor-not-allowed [&_button:disabled:hover]:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

export function EditorToolbarGroup({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      role="group"
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md bg-muted/70 p-0.5 dark:bg-muted/40",
        className,
      )}
      {...props}
    />
  );
}

export function EditorToolbarMode({
  active = false,
  className,
  ...props
}: ComponentProps<typeof Button> & { active?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn(
        "h-7 px-2.5 text-xs leading-none transition-colors",
        active
          ? "bg-background text-foreground shadow-xs ring-1 ring-border hover:bg-background hover:text-foreground cursor-default"
          : "text-muted-foreground hover:bg-background/80 hover:text-foreground dark:hover:bg-white/10 dark:hover:text-foreground",
        className,
      )}
      aria-pressed={active}
      {...props}
    />
  );
}



