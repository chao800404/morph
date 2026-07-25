import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Pencil, MoreHorizontal, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

export interface RowAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Rendered after a separator and in the destructive colour. */
  destructive?: boolean;
}

/**
 * The trailing "…" menu on a `DataTableCard` row.
 *
 * Row actions live behind one trigger so the table keeps a single narrow
 * actions column no matter how many operations a resource grows.
 */
export const RowActionsMenu = ({
  actions,
  label = "Row actions",
}: {
  actions: RowAction[];
  label?: string;
}) => {
  const regular = actions.filter((action) => !action.destructive);
  const destructive = actions.filter((action) => action.destructive);

  if (actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {regular.map((action) => (
          <DropdownMenuItem key={action.label} onClick={action.onSelect}>
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
        {regular.length > 0 && destructive.length > 0 && (
          <DropdownMenuSeparator />
        )}
        {destructive.map((action) => (
          <DropdownMenuItem
            key={action.label}
            onClick={action.onSelect}
            variant="destructive"
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Icons for the two actions nearly every resource has. */
export const editActionIcon = <Pencil className="size-4" />;
export const deleteActionIcon = <Trash2 className="size-4" />;
