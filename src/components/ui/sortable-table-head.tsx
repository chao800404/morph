import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";
import * as React from "react";
import { Button } from "./button";
import { TableHead } from "./table";

export type TableSortDirection = "asc" | "desc";

interface SortableTableHeadProps extends Omit<
  React.ComponentProps<typeof TableHead>,
  "children"
> {
  children: React.ReactNode;
  sortLabel: string;
  direction?: TableSortDirection;
  nextDirection?: TableSortDirection;
  sortPriority?: number;
  onSort: () => void;
}

/**
 * Accessible sortable table header.
 *
 * Every column reveals its current or next direction only on hover or keyboard
 * focus, without shifting the header text.
 */
export const SortableTableHead = React.forwardRef<
  React.ComponentRef<typeof TableHead>,
  SortableTableHeadProps
>(
  (
    {
      children,
      sortLabel,
      direction,
      nextDirection = "asc",
      sortPriority,
      onSort,
      className,
      ...props
    },
    ref,
  ) => {
    const appliesDirection =
      direction === "asc"
        ? "desc"
        : direction === "desc"
          ? "asc"
          : nextDirection;
    // The indicator is only revealed on hover/focus, so it previews the action
    // the user is about to perform rather than repeating the current aria-sort.
    const displayedDirection = appliesDirection;
    const directionLabel = direction === "asc" ? "ascending" : "descending";
    const appliesDirectionLabel =
      appliesDirection === "asc" ? "ascending" : "descending";

    return (
      <TableHead
        ref={ref}
        aria-sort={
          sortPriority !== undefined && sortPriority > 1
            ? "none"
            : direction === "asc"
              ? "ascending"
              : direction === "desc"
                ? "descending"
                : "none"
        }
        className={cn("p-0", className)}
        {...props}
      >
        <Button
          type="button"
          variant="ghost"
          onClick={onSort}
          aria-label={
            direction
              ? `${sortLabel}, sort priority ${sortPriority ?? 1}, sorted ${directionLabel}. Activate to sort ${appliesDirectionLabel}.`
              : `${sortLabel}, not sorted. Activate to sort ${appliesDirectionLabel}.`
          }
          className={cn(
            "group/sort h-12 w-full justify-start rounded-none px-4 font-medium",
            "text-muted-foreground hover:bg-muted/50 hover:text-foreground active:scale-100",
          )}
        >
          <span className="truncate">{children}</span>
          <span
            data-sort-indicator
            data-direction={displayedDirection}
            aria-hidden
            className="ml-1 inline-flex size-4 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100"
          >
            {displayedDirection === "asc" ? (
              <ArrowUp className="size-3.5" />
            ) : (
              <ArrowDown className="size-3.5" />
            )}
          </span>
        </Button>
      </TableHead>
    );
  },
);

SortableTableHead.displayName = "SortableTableHead";
