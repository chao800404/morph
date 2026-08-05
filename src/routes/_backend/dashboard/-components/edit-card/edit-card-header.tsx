import {
  editActionIcon,
  RowActionsMenu,
  type RowAction,
} from "../data-table-card/row-actions-menu";

/**
 * The "…" menu on an information card.
 *
 * Built on `RowActionsMenu` rather than a second dropdown: destructive items,
 * the separator before them, and the preload-on-open behaviour are already
 * decided there, and a card that grew a Delete would otherwise have to
 * re-decide all three.
 */
export const EditCardHeader = ({
  onClickEdit,
  actions = [],
  label = "Card actions",
}: {
  /** Omit for a card whose only actions are the extra ones. */
  onClickEdit?: () => void;
  /** Anything beyond Edit — Delete, "go to source", and so on. */
  actions?: RowAction[];
  label?: string;
}) => (
  <RowActionsMenu
    label={label}
    actions={[
      ...(onClickEdit
        ? [{ label: "Edit", icon: editActionIcon, onSelect: onClickEdit }]
        : []),
      ...actions,
    ]}
  />
);
