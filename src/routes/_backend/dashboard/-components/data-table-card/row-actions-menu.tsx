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
  disabled?: boolean;
  /**
   * Starts loading whatever the action opens.
   *
   * Called when the menu opens rather than on item hover: by the time a pointer
   * reaches an item the click is milliseconds away, which is too late to help.
   */
  preload?: () => void;
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
  keepsFocusOnClose = false,
}: {
  actions: RowAction[];
  label?: string;
  /**
   * Set when an action hands focus to something it opened.
   *
   * On close the menu returns focus to its own trigger, which is right when
   * the action navigated or opened a dialog that manages its own focus — and
   * wrong when it revealed an inline field in the row, because the restore
   * lands after that field has focused and takes it straight back.
   */
  keepsFocusOnClose?: boolean;
}) => {
  const regular = actions.filter((action) => !action.destructive);
  const destructive = actions.filter((action) => action.destructive);

  if (actions.length === 0) return null;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          for (const action of actions) action.preload?.();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={
          keepsFocusOnClose ? (event) => event.preventDefault() : undefined
        }
      >
        {regular.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
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
            disabled={action.disabled}
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
