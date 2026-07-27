import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface DataTableToolbarProps {
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/**
 * Shared secondary toolbar for dashboard list cards.
 *
 * Filters stay on the leading edge; search and ordering controls stay grouped
 * on the trailing edge. Feature code supplies controls but does not recreate
 * the toolbar's spacing, separators or responsive behavior.
 */
export const DataTableToolbar = ({
  leading,
  trailing,
  className,
}: DataTableToolbarProps) => (
  <div
    className={cn(
      "flex min-h-16 shrink-0 items-center justify-between gap-3 border-y px-6 py-4",
      "max-md:flex-col max-md:items-stretch",
      className,
    )}
  >
    <div className="flex min-w-0 flex-wrap items-center gap-2">{leading}</div>
    <div className="flex min-w-0 items-center justify-end gap-2 max-md:w-full">
      {trailing}
    </div>
  </div>
);
