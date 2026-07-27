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
import type {
  DashboardSearch,
  DashboardSortKey,
} from "@/lib/validations/dashboard-search";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Dot } from "lucide-react";

export type DataTableSortKey = DashboardSortKey;

export interface DataTableSortOption {
  value: DataTableSortKey;
  label: string;
}

export const useDataTableSort = (
  defaultSortBy: DataTableSortKey = "createdAt",
) => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const routeSortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const routeSortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;
  const sortBy = routeSortBy ?? defaultSortBy;
  const sortOrder = routeSortOrder ?? "desc";

  const applySort = (
    nextSortBy: DataTableSortKey,
    nextSortOrder: "asc" | "desc",
  ) => {
    navigate({
      to: ".",
      search: (prev: DashboardSearch) => ({
        ...prev,
        sortBy: nextSortBy,
        sortOrder: nextSortOrder,
        page: undefined,
      }),
      replace: true,
    });
  };

  const toggleSort = (
    nextSortBy: DataTableSortKey,
    initialOrder: "asc" | "desc" = "asc",
  ) => {
    applySort(
      nextSortBy,
      sortBy === nextSortBy
        ? sortOrder === "asc"
          ? "desc"
          : "asc"
        : initialOrder,
    );
  };

  return { sortBy, sortOrder, applySort, toggleSort };
};

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
  const { sortBy, sortOrder, toggleSort } = useDataTableSort(defaultSortBy);

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
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => toggleSort(option.value)}
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
