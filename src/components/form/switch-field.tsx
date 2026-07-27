import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { fieldControlVariants } from "@/components/ui/field-control";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SwitchFormField } from "@/lib/validations/form";

export const SwitchField = ({
  field,
  fieldId,
  checked,
  onChange,
}: {
  field: SwitchFormField;
  fieldId: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
}) => (
  <Field
    orientation="horizontal"
    data-disabled={field.disabled || undefined}
    className={cn(fieldControlVariants({ variant: "card" }), "rounded-lg p-4")}
  >
    <Switch
      id={fieldId}
      name={field.name}
      checked={checked}
      disabled={field.disabled}
      required={field.required}
      aria-describedby={
        field.description ? `${fieldId}-description` : undefined
      }
      onCheckedChange={onChange}
      className="mt-0.5"
    />
    <FieldContent>
      {field.label ? (
        <FieldLabel htmlFor={fieldId}>{field.label}</FieldLabel>
      ) : null}
      {field.description ? (
        <FieldDescription id={`${fieldId}-description`}>
          {field.description}
        </FieldDescription>
      ) : null}
    </FieldContent>
  </Field>
);
