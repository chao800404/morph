import type { DataTableScope } from "./data-table-card";
import { cn } from "@/lib/utils";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useSearch } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";

/**
 * What a table card shows instead of rows.
 *
 * The heights are floors, not fixed values. Medusa pins these states to an
 * exact height. We keep the height as a floor so longer localized copy can
 * grow without being clipped.
 *
 * A floor still does the job it was added for: without one the state collapses
 * to whatever its copy happens to measure, and a card sitting on a detail page
 * ends up taller than the record it describes.
 *
 * The search-miss state has the taller floor on purpose. It appears while the
 * user is typing, so dropping to the compact height on every keystroke that
 * matches nothing would make the page jump.
 *
 * It reads the route rather than taking a prop so `DataTableCard` stays
 * router-free; its router-touching parts are all siblings like this one.
 */
export const DATA_TABLE_STATE_HEIGHT = {
  /** The resource is genuinely empty. */
  noRecords: "min-h-[150px]",
  /** A query or filter excluded everything. */
  noResults: "min-h-[400px]",
} as const;

export const DataTableEmptyState = ({
  title,
  description,
  scope,
}: {
  title: string;
  description: string;
  scope?: DataTableScope;
}) => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const hasQuery = Boolean(
    (scope === "taxRate" ? search.taxRateQ : search.q)?.trim() ||
    (scope !== "taxRate" && search.taxRegionHasRates !== undefined),
  );

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-8 text-center",
        hasQuery
          ? DATA_TABLE_STATE_HEIGHT.noResults
          : DATA_TABLE_STATE_HEIGHT.noRecords,
      )}
    >
      <div className="flex flex-col items-center gap-2 py-8">
        <CircleAlert
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
};
