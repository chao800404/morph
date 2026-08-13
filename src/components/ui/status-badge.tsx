import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground w-fit whitespace-nowrap shrink-0 transition-colors",
  {
    variants: {
      variant: {
        default: "bg-sidebar rounded-sm px-1.5 py-0.5",
        plain: "bg-transparent p-0",
      },
      color: {
        green: "",
        grey: "",
        amber: "",
        red: "",
        blue: "",
        purple: "",
      },
    },
    defaultVariants: {
      variant: "default",
      color: "grey",
    },
  },
);

const statusDotVariants = cva("size-1.5 rounded-[2px] shrink-0", {
  variants: {
    color: {
      green: "bg-emerald-500",
      grey: "bg-zinc-400 dark:bg-zinc-500",
      amber: "bg-amber-500",
      red: "bg-rose-500",
      blue: "bg-primary",
      purple: "bg-purple-500",
    },
  },
  defaultVariants: {
    color: "grey",
  },
});

export interface StatusBadgeProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof statusBadgeVariants> {
  children?: React.ReactNode;
}

function StatusBadge({
  className,
  variant,
  color,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ variant, color }), className)}
      {...props}
    >
      <span className={cn(statusDotVariants({ color }))} aria-hidden="true" />
      {children}
    </span>
  );
}

export { StatusBadge, statusBadgeVariants, statusDotVariants };
