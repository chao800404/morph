import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { cn } from "@/lib/utils";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * What a table card shows instead of rows.
 *
 * The heights are floors, not fixed values. Medusa pins these states to an
 * exact height, but its empty icon is a ~20px glyph where ours is 87×74 — a
 * hard 150px would crush the icon, title and description together.
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
  action,
}: {
  title: string;
  description: string;
  /** Usually the Create button, so an empty resource offers the way out. */
  action?: ReactNode;
}) => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const hasQuery = Boolean(search.q?.trim());

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-8 text-center",
        hasQuery
          ? DATA_TABLE_STATE_HEIGHT.noResults
          : DATA_TABLE_STATE_HEIGHT.noRecords,
      )}
    >
      <div className="flex flex-col items-center gap-2 py-8 opacity-70">
        <EmptyFileIcon />
        <h3 className="mt-1 text-base font-medium text-foreground">{title}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
};
