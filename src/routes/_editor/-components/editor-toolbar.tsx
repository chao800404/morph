import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export function EditorToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="toolbar"
      className={cn(
        "flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg",
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
      className={cn("flex shrink-0 rounded-md bg-muted p-0.5", className)}
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
      variant={active ? "secondary" : "ghost"}
      size="xs"
      className={cn("px-3", className)}
      aria-pressed={active}
      {...props}
    />
  );
}
