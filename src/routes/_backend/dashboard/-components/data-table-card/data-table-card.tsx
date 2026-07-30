import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { CardWrapper } from "../card-wrapper";
import { DataTablePagination } from "./data-table-pagination";
import {
  DataTableEmptyState,
  DATA_TABLE_STATE_HEIGHT,
} from "./data-table-empty-state";
import { DataTableSearch } from "./data-table-search";
import {
  DataTableSort,
  type DataTableSortKey,
  type DataTableSortOption,
} from "./data-table-sort";
import { RowActionsMenu, type RowAction } from "./row-actions-menu";
import { DataTableToolbar } from "./data-table-toolbar";

export interface DataTableColumn<TRow> {
  /** Stable key; also used as the React key for the cell. */
  key: string;
  header: ReactNode;
  cell: (row: TRow) => ReactNode;
  /** Applied to both the header cell and the body cells, so widths line up. */
  className?: string;
}

export interface DataTablePaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DataTableCardProps<TRow> {
  label: string;
  description?: string;
  /** Feature-owned layout only; visual styling remains inside the primitive. */
  className?: string;
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  getRowId: (row: TRow) => string;
  isPending?: boolean;
  /** Non-null switches the card into its error state. */
  errorMessage?: string | null;
  onRetry?: () => void;
  emptyTitle: string;
  emptyDescription: string;
  /** Buttons in the card header, e.g. Create. Also shown in the empty state. */
  headerActions?: ReactNode;
  /** Omit to hide the search box. */
  searchPlaceholder?: string;
  /** Omit to hide the sort control. */
  sortOptions?: DataTableSortOption[];
  defaultSortBy?: DataTableSortKey;
  rowActions?: (row: TRow) => RowAction[];
  /**
   * Opens the row's detail page. Set it and the whole row becomes clickable;
   * the actions cell swallows its own clicks so the menu still works.
   */
  onRowClick?: (row: TRow) => void;
  pagination?: DataTablePaginationInfo;
  /** Filters and active filter chips shown on the toolbar's leading edge. */
  toolbarLeading?: ReactNode;
  selection?: {
    selectedIds: ReadonlySet<string>;
    onChange: (ids: Set<string>) => void;
    isRowSelectable?: (row: TRow) => boolean;
  };
}

const TableViewport = ({ children }: { children: ReactNode }) => (
  <div
    className={cn(
      "min-h-0 flex-1 overflow-auto",
      "[&_td:first-child]:pl-6 [&_th:first-child]:pl-6",
      "[&_td:last-child]:pr-6 [&_th:last-child]:pr-6",
    )}
  >
    {children}
  </div>
);

/**
 * The standard list layout for dashboard resources.
 *
 * Header holds the title and primary action. Filters, search and ordering share
 * the secondary toolbar above the table; the footer carries the result count
 * and pager. Loading, error and empty states stay inside the same card so every
 * list page behaves consistently without repeating the branching.
 */
export const DataTableCard = <TRow,>({
  label,
  description,
  className,
  columns,
  rows,
  getRowId,
  onRowClick,
  isPending,
  errorMessage,
  onRetry,
  emptyTitle,
  emptyDescription,
  headerActions,
  searchPlaceholder,
  sortOptions,
  defaultSortBy,
  rowActions,
  pagination,
  toolbarLeading,
  selection,
}: DataTableCardProps<TRow>) => {
  const hasToolbar = Boolean(
    toolbarLeading || searchPlaceholder || sortOptions,
  );
  const controls = (
    <>
      {searchPlaceholder && (
        <DataTableSearch placeholder={searchPlaceholder} />
      )}
      {sortOptions && (
        <DataTableSort options={sortOptions} defaultSortBy={defaultSortBy} />
      )}
    </>
  );
  const selectableRows = selection
    ? rows.filter((row) => selection.isRowSelectable?.(row) ?? true)
    : [];
  const allRowsSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row) => selection?.selectedIds.has(getRowId(row)));
  const someRowsSelected = selectableRows.some((row) =>
    selection?.selectedIds.has(getRowId(row)),
  );
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          {selection ? (
            <TableHead className="w-14">
              <Checkbox
                aria-label="Select all rows"
                checked={allRowsSelected}
                isIndeterminate={someRowsSelected && !allRowsSelected}
                onCheckedChange={(checked) => {
                  const next = new Set(selection.selectedIds);
                  selectableRows.forEach((row) => {
                    const id = getRowId(row);
                    if (checked === true) next.add(id);
                    else next.delete(id);
                  });
                  selection.onChange(next);
                }}
              />
            </TableHead>
          ) : null}
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className}>
              {column.header}
            </TableHead>
          ))}
          {rowActions && <TableHead className="w-16" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={getRowId(row)}
            data-state={
              selection?.selectedIds.has(getRowId(row))
                ? "selected"
                : undefined
            }
            className={onRowClick ? "cursor-pointer" : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {selection ? (
              <TableCell
                className="w-14"
                onClick={(event) => event.stopPropagation()}
              >
                <Checkbox
                  aria-label={`Select row ${getRowId(row)}`}
                  checked={selection.selectedIds.has(getRowId(row))}
                  disabled={!(selection.isRowSelectable?.(row) ?? true)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selection.selectedIds);
                    if (checked === true) next.add(getRowId(row));
                    else next.delete(getRowId(row));
                    selection.onChange(next);
                  }}
                />
              </TableCell>
            ) : null}
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.cell(row)}
              </TableCell>
            ))}
            {rowActions && (
              <TableCell
                className="w-16 text-right"
                onClick={(event) => event.stopPropagation()}
              >
                <RowActionsMenu actions={rowActions(row)} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <CardWrapper
      label={label}
      description={description}
      headerButton={headerActions}
      classNames={{
        cardWrapper: cn("h-auto", className),
        contentWrapper: "flex min-h-0 flex-col",
      }}
    >
      {hasToolbar ? (
        <DataTableToolbar
          className="border-t-0"
          leading={toolbarLeading}
          trailing={controls}
        />
      ) : null}
      {isPending ? (
        <div
          className={cn(
            "flex items-center justify-center py-8",
            DATA_TABLE_STATE_HEIGHT.noRecords,
          )}
        >
          <Spinner />
        </div>
      ) : errorMessage ? (
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-3 px-8 py-8 text-center",
            DATA_TABLE_STATE_HEIGHT.noRecords,
          )}
        >
          <p className="text-sm text-destructive">{errorMessage}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      ) : rows.length === 0 ? (
        <DataTableEmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={headerActions}
        />
      ) : (
        <>
          <TableViewport>{table}</TableViewport>
          {pagination ? (
            <DataTablePagination pagination={pagination} />
          ) : null}
        </>
      )}
    </CardWrapper>
  );
};
