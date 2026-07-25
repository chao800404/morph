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
import type { FieldConfig } from "@/components/upload/types";
import { cn } from "@/lib/utils";
import type { FormField } from "@/lib/validations/form";
import { RefObject } from "react";
import { FolderSelectField } from "../folder-select/folder-select";
import { PhoneInput } from "../ui/phone-input";
import { UploadField } from "../upload/upload";
import { OptionValuesField } from "./option-values-field";

interface FieldsRendererProps {
  fields: (FormField | FieldConfig)[];
  onChange?: (name: string, value: any) => void;
  className?: string;
  firstFieldRef?: RefObject<
    HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | null
  >;
}

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

        // Determine if it's FieldConfig or FormField
        const isFieldConfig = !("value" in field) || "defaultValue" in field;
        const fieldValue = isFieldConfig
          ? (field as FieldConfig).defaultValue
          : (field as FormField).value;

        // Support colSpan from FieldConfig
        const colSpan = (field as any).colSpan ?? 2;
        const stringValue = typeof fieldValue === "string" ? fieldValue : "";
        const arrayValue = Array.isArray(fieldValue)
          ? fieldValue
          : Array.isArray((field as any).defaultValue)
            ? (field as any).defaultValue
            : [];

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
                type={(field as any).inputType || "text"}
                defaultValue={stringValue}
                onChange={(e) => onChange?.(field.name, e.target.value)}
                placeholder={field.placeholder || `Enter ${field.label}...`}
                autoFocus={(field as any).autoFocus}
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
                rows={(field as any).rows || 3}
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
                  {(field as any).options?.map((option: any) => (
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
                  field.type === "phone" && !stringValue
                    ? ((field as any).defaultCountry as any)
                    : undefined
                }
                value={stringValue.replaceAll(" ", "")}
                onChange={(value) => {
                  onChange?.(field.name, value);
                }}
                placeholder={field.placeholder || `Enter ${field.label}...`}
                ref={isFirstField ? (firstFieldRef as any) : undefined}
              />
            )}

            {field.type === "folder-select" && (
              <FolderSelectField
                field={field as any}
                fieldId={id}
                initialValue={stringValue}
                onChange={(value) => onChange?.(field.name, value)}
              />
            )}

            {field.type === "upload" && (
              <UploadField
                field={field as any}
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
