import { cn } from "@/lib/utils";
import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

const DataGrid = React.forwardRef<
  HTMLTableElement,
  React.ComponentProps<typeof Table>
>(({ className, ...props }, ref) => (
  <Table
    ref={ref}
    containerClassName="size-full"
    className={cn("min-w-max border-collapse shadow-none", className)}
    {...props}
  />
));
DataGrid.displayName = "DataGrid";

const DataGridHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.ComponentProps<typeof TableHeader>
>(({ className, ...props }, ref) => (
  <TableHeader
    ref={ref}
    variant="card"
    className={cn("sticky top-0 z-20", className)}
    {...props}
  />
));
DataGridHeader.displayName = "DataGridHeader";

const DataGridHead = React.forwardRef<
  HTMLTableCellElement,
  React.ComponentProps<typeof TableHead>
>(({ className, ...props }, ref) => (
  <TableHead
    ref={ref}
    className={cn(
      "h-10 border-r bg-muted/40 text-xs last:border-r-0",
      className,
    )}
    {...props}
  />
));
DataGridHead.displayName = "DataGridHead";

const DataGridBody = TableBody;

const DataGridRow = React.forwardRef<
  HTMLTableRowElement,
  React.ComponentProps<typeof TableRow>
>(({ className, ...props }, ref) => (
  <TableRow
    ref={ref}
    variant="card"
    className={cn("group h-10 bg-background hover:bg-background", className)}
    {...props}
  />
));
DataGridRow.displayName = "DataGridRow";

const DataGridCell = React.forwardRef<
  HTMLTableCellElement,
  React.ComponentProps<typeof TableCell>
>(({ className, ...props }, ref) => (
  <TableCell
    ref={ref}
    className={cn("h-10 border-r p-0 last:border-r-0", className)}
    {...props}
  />
));
DataGridCell.displayName = "DataGridCell";

const DataGridInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    autoComplete="off"
    className={cn(
      "size-full min-w-0 bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground",
      "focus:bg-background focus:ring-[1.5px] focus:ring-inset focus:ring-blue-500/50",
      "disabled:cursor-not-allowed disabled:bg-muted/30 disabled:text-muted-foreground",
      className,
    )}
    {...props}
  />
));
DataGridInput.displayName = "DataGridInput";

const DataGridReadonlyCell = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex size-full items-center px-4 text-sm text-muted-foreground",
      className,
    )}
    {...props}
  />
);

const DataGridBooleanCell = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex size-full items-center justify-center focus-within:ring-[1.5px] focus-within:ring-inset focus-within:ring-blue-500/50",
      className,
    )}
    {...props}
  />
);

export {
  DataGrid,
  DataGridBody,
  DataGridBooleanCell,
  DataGridCell,
  DataGridHead,
  DataGridHeader,
  DataGridInput,
  DataGridReadonlyCell,
  DataGridRow,
};
