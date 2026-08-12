import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SlidersHorizontal } from "lucide-react";

export interface DataTableColumnMenuItem {
  key: string;
  label: string;
  visible: boolean;
  fixed: boolean;
}

export const DataTableColumnMenu = ({
  columns,
  onToggle,
  onReset,
}: {
  columns: DataTableColumnMenuItem[];
  onToggle: (key: string) => void;
  onReset: () => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        className="text-primary"
        type="button"
        variant="cardHeader"
        size="xs"
        aria-label="Edit columns"
      >
        <SlidersHorizontal aria-hidden />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel className="text-xs">Toggle columns</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div className="max-h-56 overflow-y-auto overscroll-contain">
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            className="cursor-pointer text-xs"
            key={column.key}
            checked={column.visible}
            disabled={column.fixed}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(column.key)}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onReset}>
        Reset columns
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
