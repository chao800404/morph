import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
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
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { CardWrapper } from "../card-wrapper";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableSearch } from "./data-table-search";
import {
  DataTableSort,
  type DataTableSortKey,
  type DataTableSortOption,
} from "./data-table-sort";
import { RowActionsMenu, type RowAction } from "./row-actions-menu";

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
  pagination?: DataTablePaginationInfo;
}

/**
 * The standard list layout for dashboard resources.
 *
 * Header holds the title, search and primary action; the table fills the
 * middle; the footer carries the result count and pager. Loading, error and
 * empty states are centred in the card while the table stays top-aligned, so
 * every list page behaves the same without repeating the branching.
 */
export const DataTableCard = <TRow,>({
  label,
  description,
  columns,
  rows,
  getRowId,
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
}: DataTableCardProps<TRow>) => {
  const showsPlaceholder = Boolean(isPending) || Boolean(errorMessage) || rows.length === 0;

  return (
    <CardWrapper
      label={label}
      description={description}
      headerButton={
        <div className="flex items-center gap-2">
          {searchPlaceholder && (
            <DataTableSearch placeholder={searchPlaceholder} />
          )}
          {sortOptions && (
            <DataTableSort options={sortOptions} defaultSortBy={defaultSortBy} />
          )}
          {headerActions}
        </div>
      }
      classNames={{
        cardWrapper: "min-h-content",
        contentWrapper: cn(
          "flex flex-col",
          showsPlaceholder && "items-center justify-center",
        ),
      }}
    >
      {isPending ? (
        <Spinner />
      ) : errorMessage ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-destructive">{errorMessage}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="flex flex-col items-center gap-3 opacity-70">
            <EmptyFileIcon />
            <h3 className="mt-2 text-lg font-medium text-foreground">
              {emptyTitle}
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {emptyDescription}
            </p>
            {headerActions && <div className="mt-4">{headerActions}</div>}
          </div>
        </div>
      ) : (
        <>
          <div
            className={cn(
              "flex-1",
              "[&_td:first-child]:pl-6 [&_th:first-child]:pl-6",
              "[&_td:last-child]:pr-6 [&_th:last-child]:pr-6",
            )}
          >
            <Table>
              <TableHeader>
                <TableRow>
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
                  <TableRow key={getRowId(row)}>
                    {columns.map((column) => (
                      <TableCell key={column.key} className={column.className}>
                        {column.cell(row)}
                      </TableCell>
                    ))}
                    {rowActions && (
                      <TableCell className="w-16 text-right">
                        <RowActionsMenu actions={rowActions(row)} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DataTablePagination pagination={pagination} />
        </>
      )}
    </CardWrapper>
  );
};
