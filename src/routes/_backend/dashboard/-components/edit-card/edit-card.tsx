import { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { FormField } from "@/lib/validations/form";
import { useEditStore } from "@views/features/global-edit/use-edit-store";
import { CardWrapper } from "../card-wrapper";
import { EditCardHeader } from "./edit-card-header";

export interface SelectOption {
  label: string;
  value: string;
}

export interface EditCardField {
  key: string;
  label: string;
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
  title: string;
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
  /** Shown in the card header before the actions menu, e.g. status badges. */
  headerActions?: ReactNode;
  /** Feature-owned layout only; the card's own styling stays in the primitive. */
  className?: string;
  /** Omit both `onSave` and `onEdit` for a read-only information card. */
}

export const EditCard = ({
  title,
  description,
  icon,
  fields,
  id,
  onSave,
  onEdit,
  headerActions,
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
          label: field.label,
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
      title: `Edit ${title}`,
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
          {(onEdit || onSave) && (
            <EditCardHeader onClickEdit={onEdit ?? handleEdit} />
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
          <p className="text-sm">{field.displayValue || field.value || "-"}</p>
        </div>
      ))}
    </CardWrapper>
  );
};
