import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { FormField, FormFieldValue } from "@/lib/validations/form";
import { ComponentRef, RefObject } from "react";
import type { Country } from "react-phone-number-input";
import { FolderSelectField } from "../folder-select/folder-select";
import { PhoneInput } from "../ui/phone-input";
import { UploadField } from "../upload/upload";
import { OptionValuesField } from "./option-values-field";

/**
 * Every control that can be the first focusable field. The ref is shared across
 * field types, so it is narrowed per branch below; all members expose `focus()`,
 * which is the only thing callers use it for.
 */
export type FirstFieldRefTarget =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLButtonElement
  | ComponentRef<typeof PhoneInput>;

interface FieldsRendererProps {
  fields: FormField[];
  onChange?: (name: string, value: FormFieldValue | File[]) => void;
  className?: string;
  firstFieldRef?: RefObject<FirstFieldRefTarget | null>;
}

/**
 * `defaultValue` belongs to fields that own their state after mount, `value` to
 * fields driven by a dialog store. `defaultValue` wins so a config object keeps
 * rendering the value it declared.
 */
const resolveFieldValue = (field: FormField): FormFieldValue | undefined =>
  field.defaultValue !== undefined ? field.defaultValue : field.value;

export const FieldsRenderer = ({
  fields,
  onChange,
  className,
  firstFieldRef,
}: FieldsRendererProps) => {
  const firstVisibleFieldIndex = fields.findIndex((f) => f.type !== "hidden");

  return (
    <div className={cn("grid grid-cols-2 gap-4", className)}>
      {fields.map((field, index) => {
        const id = `field-${field.name}`;
        const isFirstField = index === firstVisibleFieldIndex;

        const fieldValue = resolveFieldValue(field);
        const colSpan = field.colSpan ?? 2;
        const stringValue = typeof fieldValue === "string" ? fieldValue : "";
        const arrayValue = Array.isArray(fieldValue) ? fieldValue : [];

        return (
          <div
            key={field.name}
            className={cn(
              "space-y-2",
              colSpan === 1 ? "col-span-1" : "col-span-2",
            )}
          >
            {field.type !== "hidden" && (
              <Label htmlFor={id} className="text-sm font-medium">
                {field.label}
              </Label>
            )}
            {field.type === "input" && (
              <Input
                id={id}
                variant="card"
                name={field.name}
                type={field.inputType || "text"}
                defaultValue={stringValue}
                onChange={(e) => onChange?.(field.name, e.target.value)}
                placeholder={field.placeholder || `Enter ${field.label}...`}
                autoFocus={field.autoFocus}
                ref={
                  isFirstField
                    ? (firstFieldRef as RefObject<HTMLInputElement>)
                    : undefined
                }
              />
            )}
            {field.type === "textarea" && (
              <Textarea
                id={id}
                variant="card"
                name={field.name}
                defaultValue={stringValue}
                onChange={(e) => onChange?.(field.name, e.target.value)}
                placeholder={field.placeholder || `Enter ${field.label}...`}
                className="min-h-[100px]"
                rows={field.rows || 3}
                ref={
                  isFirstField
                    ? (firstFieldRef as RefObject<HTMLTextAreaElement>)
                    : undefined
                }
              />
            )}
            {field.type === "select" && (
              <Select
                name={field.name}
                defaultValue={stringValue}
                onValueChange={(value) => onChange?.(field.name, value)}
              >
                <SelectTrigger id={id}>
                  <SelectValue
                    placeholder={field.placeholder || `Select ${field.label}`}
                  />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {field.type === "hidden" && (
              <input type="hidden" name={field.name} value={stringValue} />
            )}

            {field.type === "phone" && (
              <PhoneInput
                id={id}
                name={field.name}
                defaultCountry={
                  !stringValue
                    ? (field.defaultCountry as Country | undefined)
                    : undefined
                }
                value={stringValue.replaceAll(" ", "")}
                onChange={(value) => {
                  onChange?.(field.name, value);
                }}
                placeholder={field.placeholder || `Enter ${field.label}...`}
                ref={
                  isFirstField
                    ? (firstFieldRef as RefObject<
                        ComponentRef<typeof PhoneInput>
                      >)
                    : undefined
                }
              />
            )}

            {field.type === "folder-select" && (
              <FolderSelectField
                field={field}
                fieldId={id}
                initialValue={stringValue}
                onChange={(value) => onChange?.(field.name, value)}
              />
            )}

            {field.type === "upload" && (
              <UploadField
                field={field}
                fieldId={id}
                onChange={(files) => onChange?.(field.name, files)}
              />
            )}

            {field.type === "option-values" && (
              <OptionValuesField
                name={field.name}
                placeholder={field.placeholder}
                defaultValue={arrayValue}
                value={arrayValue}
                onChange={(fieldName, val) => onChange?.(fieldName, val)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
