import { Skeleton } from "@/components/ui/skeleton";
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
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import {
  useCallback,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
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
import {
  DataTableFilters,
  type DataTableFilterDefinition,
} from "./data-table-filters";
import { DataTableColumnMenu } from "./data-table-column-menu";
import { SortableTableHead } from "./sortable-table-head";
import {
  moveColumn,
  type StoredColumnConfiguration,
  useDataTableColumnConfiguration,
} from "./use-data-table-column-configuration";

export interface DataTableColumn<TRow> {
  /** Stable key; also used as the React key for the cell. */
  key: string;
  header: ReactNode;
  cell: (row: TRow) => ReactNode;
  /** Applied to both the header cell and the body cells, so widths line up. */
  className?: string;
  /** User-facing name in the shared column menu. Defaults to a string header. */
  label?: string;
  /** Fixed columns stay visible and cannot be dragged. */
  fixed?: boolean;
  /** Optional columns remain available in the menu but start hidden. */
  defaultVisible?: boolean;
}

export interface DataTablePaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DataTableCardProps<TRow> {
  label: ReactNode;
  description?: ReactNode;
  /** Fill-layout selectors render the table without a resource card heading. */
  hideHeader?: boolean;
  /** Feature-owned layout only; visual styling remains inside the primitive. */
  className?: string;
  /** Fill keeps the pager at the surface bottom and the row divider in place. */
  layout?: "fit" | "fill";
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
  /** Feature-specific trailing control that still uses the shared actions column. */
  renderRowActions?: (row: TRow) => ReactNode;
  /**
   * Opens the row's detail page. Set it and the whole row becomes clickable;
   * the actions cell swallows its own clicks so the menu still works.
   */
  onRowClick?: (row: TRow) => void;
  /**
   * Starts loading the row destination before activation. Clickable rows are
   * navigation controls even though a native Link cannot wrap a table row.
   */
  onRowPreload?: (row: TRow) => void;
  /** Limits row navigation when only some rows have a valid destination. */
  isRowClickable?: (row: TRow) => boolean;
  pagination?: DataTablePaginationInfo;
  /** Namespaced URL state for a second independently paginated table. */
  searchScope?: "taxRate" | "orderItem" | "orderFulfillment";
  /** Declarative filters rendered by the shared Add filter control. */
  filters?: DataTableFilterDefinition[];
  /** Filters and active filter chips shown on the toolbar's leading edge. */
  toolbarLeading?: ReactNode;
  /** Enables Medusa-style column visibility, drag ordering and persistence. */
  columnConfigurationKey?: string;
  /** Loader-prefetched configuration used for the table's first render. */
  initialColumnConfiguration?: StoredColumnConfiguration | null;
  selection?: {
    selectedIds: ReadonlySet<string>;
    onChange: (ids: Set<string>) => void;
    isRowSelectable?: (row: TRow) => boolean;
    /** Rows already related to the resource stay checked but disabled. */
    isRowSelected?: (row: TRow) => boolean;
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
  hideHeader,
  className,
  layout = "fit",
  columns,
  rows,
  getRowId,
  onRowClick,
  onRowPreload,
  isRowClickable,
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
  renderRowActions,
  pagination,
  searchScope,
  filters,
  toolbarLeading,
  columnConfigurationKey,
  initialColumnConfiguration,
  selection,
}: DataTableCardProps<TRow>) => {
  const columnKeys = useMemo(
    () => columns.map((column) => column.key),
    [columns],
  );
  const fixedColumnKeys = useMemo(
    () =>
      new Set(
        columns.filter((column) => column.fixed).map((column) => column.key),
      ),
    [columns],
  );
  const defaultHiddenColumnKeys = useMemo(
    () =>
      new Set(
        columns
          .filter((column) => column.defaultVisible === false)
          .map((column) => column.key),
      ),
    [columns],
  );
  const columnConfiguration = useDataTableColumnConfiguration({
    configurationKey: columnConfigurationKey,
    columnKeys,
    fixedKeys: fixedColumnKeys,
    defaultHiddenKeys: defaultHiddenColumnKeys,
    initialConfiguration: initialColumnConfiguration,
  });
  const columnsByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns],
  );
  const visibleColumns = useMemo(
    () =>
      (columnConfigurationKey
        ? columnConfiguration.visibleOrder
        : columnKeys
      ).flatMap((key) => {
        const column = columnsByKey.get(key);
        return column ? [column] : [];
      }),
    [
      columnConfiguration.visibleOrder,
      columnConfigurationKey,
      columnKeys,
      columnsByKey,
    ],
  );
  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: [
          new PointerActivationConstraints.Distance({ value: 8 }),
        ],
      }),
    ],
    [],
  );
  const handleColumnDragEnd = useCallback(
    (
      event: Parameters<
        NonNullable<ComponentProps<typeof DragDropProvider>["onDragEnd"]>
      >[0],
    ) => {
      if (event.canceled) return;
      const { source } = event.operation;
      if (!source || !isSortable(source)) return;
      const { initialIndex, index } = source.sortable;
      const sourceKey = visibleColumns[initialIndex]?.key;
      const targetKey = visibleColumns[index]?.key;
      if (!sourceKey || !targetKey || fixedColumnKeys.has(sourceKey)) return;
      const from = columnConfiguration.order.indexOf(sourceKey);
      const to = columnConfiguration.order.indexOf(targetKey);
      if (from < 0 || to < 0) return;
      columnConfiguration.setOrder((current) => moveColumn(current, from, to));
    },
    [columnConfiguration, fixedColumnKeys, visibleColumns],
  );
  const hasToolbar = Boolean(
    filters?.length ||
    toolbarLeading ||
    searchPlaceholder ||
    sortOptions ||
    columnConfigurationKey,
  );
  const hasRowActions = Boolean(rowActions || renderRowActions);
  const controls = (
    <>
      {searchPlaceholder && (
        <DataTableSearch placeholder={searchPlaceholder} scope={searchScope} />
      )}
      {columnConfigurationKey ? (
        <DataTableColumnMenu
          columns={columnConfiguration.order.flatMap((key) => {
            const column = columnsByKey.get(key);
            if (!column) return [];
            return [
              {
                key,
                label:
                  column.label ??
                  (typeof column.header === "string" ? column.header : key),
                visible: !columnConfiguration.hidden.has(key),
                fixed: Boolean(column.fixed),
              },
            ];
          })}
          onToggle={columnConfiguration.toggle}
          onReset={columnConfiguration.reset}
        />
      ) : null}
      {sortOptions && (
        <DataTableSort
          options={sortOptions}
          defaultSortBy={defaultSortBy}
          scope={searchScope}
        />
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
  const tableContent = (
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
          {visibleColumns.map((column, index) => (
            <SortableTableHead
              key={column.key}
              id={column.key}
              index={index}
              className={column.className}
              disabled={!columnConfigurationKey || column.fixed}
            >
              {column.header}
            </SortableTableHead>
          ))}
          {hasRowActions && <TableHead className="w-16" />}
        </TableRow>
      </TableHeader>
      <TableBody preserveLastRowBorder={layout === "fill" || !pagination}>
        {rows.map((row) => {
          const rowIsClickable =
            Boolean(onRowClick) && (isRowClickable?.(row) ?? true);

          return (
            <TableRow
              key={getRowId(row)}
              data-state={
                selection?.selectedIds.has(getRowId(row)) ||
                Boolean(selection?.isRowSelected?.(row))
                  ? "selected"
                  : undefined
              }
              className={rowIsClickable ? "cursor-pointer" : undefined}
              role={rowIsClickable ? "link" : undefined}
              tabIndex={rowIsClickable ? 0 : undefined}
              onMouseEnter={
                rowIsClickable && onRowPreload
                  ? () => onRowPreload(row)
                  : undefined
              }
              onFocus={
                rowIsClickable && onRowPreload
                  ? () => onRowPreload(row)
                  : undefined
              }
              onTouchStart={
                rowIsClickable && onRowPreload
                  ? () => onRowPreload(row)
                  : undefined
              }
              onClick={
                rowIsClickable && onRowClick ? () => onRowClick(row) : undefined
              }
              onKeyDown={
                rowIsClickable && onRowClick
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onRowClick(row);
                    }
                  : undefined
              }
            >
              {selection ? (
                <TableCell
                  className="w-14"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    aria-label={`Select row ${getRowId(row)}`}
                    checked={
                      selection.selectedIds.has(getRowId(row)) ||
                      Boolean(selection.isRowSelected?.(row))
                    }
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
              {visibleColumns.map((column) => (
                <TableCell key={column.key} className={column.className}>
                  {column.cell(row)}
                </TableCell>
              ))}
              {hasRowActions && (
                <TableCell
                  className="w-16 text-right"
                  onClick={(event) => event.stopPropagation()}
                >
                  {renderRowActions?.(row) ?? (
                    <RowActionsMenu actions={rowActions?.(row) ?? []} />
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
  const table = columnConfigurationKey ? (
    <DragDropProvider sensors={sensors} onDragEnd={handleColumnDragEnd}>
      {tableContent}
    </DragDropProvider>
  ) : (
    tableContent
  );

  const pendingTable = (
    <>
      <TableViewport>
        <Table aria-label="Loading table data">
          <TableHeader>
            <TableRow>
              {selection ? <TableHead className="w-14" /> : null}
              {visibleColumns.map((column) => (
                <TableHead key={column.key} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
              {hasRowActions ? <TableHead className="w-16" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody preserveLastRowBorder={layout === "fill" || !pagination}>
            {Array.from({ length: 5 }, (_, rowIndex) => (
              <TableRow key={rowIndex}>
                {selection ? (
                  <TableCell className="w-14">
                    <Skeleton className="size-4 rounded" />
                  </TableCell>
                ) : null}
                {visibleColumns.map((column, columnIndex) => (
                  <TableCell key={column.key} className={column.className}>
                    <Skeleton
                      className={cn(
                        "h-4",
                        columnIndex === 0
                          ? "w-36"
                          : columnIndex % 2
                            ? "w-24"
                            : "w-28",
                      )}
                    />
                  </TableCell>
                ))}
                {hasRowActions ? (
                  <TableCell className="w-16">
                    <Skeleton className="ml-auto size-7 rounded-md" />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableViewport>
      <div className="flex items-center justify-between border-t px-6 py-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-40" />
      </div>
    </>
  );

  return (
    <CardWrapper
      label={label}
      description={description}
      hideHeader={hideHeader}
      headerButton={headerActions}
      classNames={{
        cardWrapper: cn("h-auto", className),
        contentWrapper: "flex min-h-0 flex-col",
      }}
    >
      {hasToolbar ? (
        <DataTableToolbar
          className="border-t-0"
          leading={
            <>
              {filters?.length ? <DataTableFilters filters={filters} /> : null}
              {toolbarLeading}
            </>
          }
          trailing={controls}
        />
      ) : null}
      {isPending ? (
        pendingTable
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
          scope={searchScope}
        />
      ) : (
        <>
          <TableViewport>{table}</TableViewport>
          {pagination ? (
            <DataTablePagination pagination={pagination} scope={searchScope} />
          ) : null}
        </>
      )}
    </CardWrapper>
  );
};
