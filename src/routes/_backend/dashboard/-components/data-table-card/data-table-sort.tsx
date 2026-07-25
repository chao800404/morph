import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BarsArrowDownIcon } from "@/components/ui/icons/bars-arrow-down-icon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Dot } from "lucide-react";

export type DataTableSortKey = NonNullable<DashboardSearch["sortBy"]>;

export interface DataTableSortOption {
  value: DataTableSortKey;
  label: string;
}

/**
 * Sort control for `DataTableCard`, matching the assets card.
 *
 * Selecting the active field again flips the direction. Both the field and the
 * direction live in the route's search params so a sorted view is shareable and
 * the route loader prefetches the same ordering the component renders.
 */
export const DataTableSort = ({
  options,
  defaultSortBy = "createdAt",
}: {
  options: DataTableSortOption[];
  defaultSortBy?: DataTableSortKey;
}) => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const sortBy = search.sortBy ?? defaultSortBy;
  const sortOrder = search.sortOrder ?? "desc";

  const applySort = (
    nextSortBy: DataTableSortKey,
    nextSortOrder: "asc" | "desc",
  ) => {
    navigate({
      to: ".",
      // Re-sorting invalidates the current offset, so go back to page one.
      search: (prev: DashboardSearch) => ({
        ...prev,
        sortBy: nextSortBy,
        sortOrder: nextSortOrder,
        page: undefined,
      }),
      replace: true,
    });
  };

  if (options.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="text-primary"
          type="button"
          variant="cardHeader"
          size="xs"
          aria-label="Sort"
        >
          <BarsArrowDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => {
          const isActive = sortBy === option.value;
          const nextOrder = isActive && sortOrder === "asc" ? "desc" : "asc";

          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => applySort(option.value, nextOrder)}
            >
              <Dot
                className={cn(
                  "size-5 text-muted-foreground opacity-0",
                  isActive && "opacity-100",
                )}
              />
              {option.label}
              {isActive && (
                <Kbd>
                  {sortOrder === "asc" ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  )}
                </Kbd>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
