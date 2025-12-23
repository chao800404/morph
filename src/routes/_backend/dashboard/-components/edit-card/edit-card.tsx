import { LucideIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { FormField } from "@/lib/validations/form";
import { useEditStore } from "../../-features/global-edit/use-edit-store";
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
  type?: "text" | "email" | "number" | "tel" | "select";
  disabled?: boolean;
  options?: SelectOption[];
  validate?: () => import("zod").ZodTypeAny;
}

export interface EditCardState {
  data?: any;
  serverError?: string;
  validationErrors?: Record<string, any> | null;
}

interface EditCardProps {
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  fields: EditCardField[];
  onSave?: (formData: FormData) => Promise<EditCardState | undefined>;
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
      .map((field) => ({
        name: field.key,
        label: field.label,
        value: field.value || "",
        type: field.type === "select" ? "select" : "input",
        inputType: field.type === "select" ? undefined : field.type,
        options: field.options || [],
        required: true,
      }));

    setOpen(true);

    // Set up the edit dialog
    setEditData({
      title: `Edit ${title}`,
      fields: formFields,
      action: onSave as any, // Convert to ServerAction type
      onSuccess: () => {
        // Optionally refresh or show success message
        console.log("Edit successful");
      },
    });

    // Open the dialog
  };

  return (
    <CardWrapper
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
          <p className="text-sm">{field.displayValue || field.value}</p>
        </div>
      ))}
    </CardWrapper>
  );
};
