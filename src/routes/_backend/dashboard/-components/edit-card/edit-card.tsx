import { LucideIcon } from "lucide-react";

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
  displayValue?: string;
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
}

export const EditCard = ({
  title,
  description,
  icon,
  fields,
  id,
  onSave,
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
      headerButton={<EditCardHeader onClickEdit={handleEdit} />}
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
