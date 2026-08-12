import { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { FormField } from "@/lib/validations/form";
import { useEditStore } from "@views/features/global-edit/use-edit-store";
import { CardWrapper } from "../card-wrapper";
import type { RowAction } from "../data-table-card/row-actions-menu";
import { EditCardHeader } from "./edit-card-header";

export interface SelectOption {
  label: string;
  value: string;
}

export interface EditCardField {
  key: string;
  /**
   * A node for the same reason `title` is: a pending view needs a block in the
   * label column. `onSave` builds a `FormField` from it, and that needs text,
   * so an editable card must pass a string.
   */
  label: ReactNode;
  value?: string;
  /**
   * What the row shows, when that differs from the editable value — a resolved
   * name for an id, a formatted date, or links the plain value cannot express.
   */
  displayValue?: ReactNode;
  type?:
    | "text"
    | "email"
    | "number"
    | "tel"
    | "select"
    | "phone"
    | "textarea"
    | "hidden";
  disabled?: boolean;
  options?: SelectOption[];
  validate?: () => import("zod").ZodTypeAny;
  defaultCountry?: string;
}

export interface EditCardState {
  success: boolean;
  message: string;
  errors?: Record<string, string[]>;
}

interface EditCardProps {
  id: string;
  /**
   * A node, not a string, so a pending view can put a skeleton where the
   * record's name goes and still get the card's real row geometry rather than
   * a second copy of it.
   *
   * `CardWrapper` already takes a `ReactNode` label; only the built-in edit
   * dialog needs text, and `editLabel` covers that.
   */
  title: ReactNode;
  /** Heading for the `onSave` dialog. Defaults to `title` when it is a string. */
  editLabel?: string;
  description?: string;
  icon?: LucideIcon;
  fields: EditCardField[];
  onSave?: (formData: FormData) => Promise<EditCardState>;
  /**
   * Replaces the built-in edit dialog.
   *
   * A collection whose editing is a route passes a navigation here, so the card
   * keeps its familiar edit affordance without becoming a second way to edit
   * the same record.
   */
  onEdit?: () => void;
  /** Preloads a route-backed editor when the card action menu opens. */
  onEditPreload?: () => void;
  /** Shown in the card header before the actions menu, e.g. status badges. */
  headerActions?: ReactNode;
  /**
   * Extra items in the card's "…" menu, beyond Edit.
   *
   * Same shape as a table row's, so Delete is `destructive: true` and lands
   * after the separator without the card deciding anything.
   */
  actions?: RowAction[];
  /** Feature-owned layout only; the card's own styling stays in the primitive. */
  className?: string;
  /** Omit both `onSave` and `onEdit` for a read-only information card. */
}

export const EditCard = ({
  title,
  editLabel,
  description,
  icon,
  fields,
  id,
  onSave,
  onEdit,
  onEditPreload,
  headerActions,
  actions,
  className,
}: EditCardProps) => {
  const { setEditData, setOpen } = useEditStore();

  const handleEdit = () => {
    // Convert EditCardField to FormField format
    const formFields: FormField[] = fields
      .filter((field) => !field.disabled) // Only include editable fields
      .map((field): FormField => {
        const base = {
          name: field.key,
          // `FormField.label` is text. A card that opens the edit dialog always
          // labels its rows with strings; anything else is a display-only card.
          label: typeof field.label === "string" ? field.label : field.key,
          value: field.value || "",
          required: true,
        };

        switch (field.type) {
          case "select":
            return { ...base, type: "select", options: field.options ?? [] };
          case "phone":
            return {
              ...base,
              type: "phone",
              defaultCountry: field.defaultCountry,
            };
          case "textarea":
            return { ...base, type: "textarea" };
          case "hidden":
            return { ...base, type: "hidden" };
          default:
            // "text" | "email" | "number" | "tel" map onto the input control.
            return { ...base, type: "input", inputType: field.type };
        }
      });

    setOpen(true);

    // Set up the edit dialog
    setEditData({
      // Only reachable via `onSave`, and an editable card always has a name to
      // show — but `title` is a node now, so template-stringing it blind would
      // print "[object Object]" in the dialog heading.
      title:
        `Edit ${editLabel ?? (typeof title === "string" ? title : "")}`.trim(),
      fields: formFields,
      action: onSave,
      onSuccess: () => {
        // Optionally refresh or show success message
        console.log("Edit successful");
      },
    });

    // Open the dialog
  };

  return (
    <CardWrapper
      id={id}
      label={title}
      description={description}
      icon={icon}
      classNames={{ cardWrapper: className }}
      headerButton={
        <div className="flex items-center gap-2">
          {headerActions}
          {(onEdit || onSave || actions?.length) && (
            <EditCardHeader
              onClickEdit={onEdit ?? (onSave ? handleEdit : undefined)}
              onPreloadEdit={onEditPreload}
              actions={actions}
              label={`${editLabel ?? (typeof title === "string" ? title : "Card")} actions`}
            />
          )}
        </div>
      }
    >
      {fields.map((field) => (
        <div
          key={field.key}
          className={cn(
            "grid grid-cols-2 py-3 items-center px-6 border-b border-dashed last:border-none",
            "max-sm:grid-cols-[1fr_1.2fr]",
          )}
        >
          <Label htmlFor={field.key} className="text-sm text-muted-foreground">
            {field.label}
          </Label>
          {/* A div, not a p: `displayValue` is a ReactNode and cards pass
              flex containers. The HTML parser closes a <p> at a block child on
              the SSR pass while React does not on hydration. */}
          <div className="text-sm">
            {field.displayValue || field.value || "-"}
          </div>
        </div>
      ))}
    </CardWrapper>
  );
};
