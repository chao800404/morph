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
import { Tip } from "../ui/tip";
import { PhoneInput } from "../ui/phone-input";
import { UploadField } from "../upload/upload";
import { OptionValuesField } from "./option-values-field";
import { SwitchField } from "./switch-field";

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
        const booleanValue =
          typeof fieldValue === "boolean" ? fieldValue : false;
        // The message replaces the hint when both exist: two lines of small
        // text under one control competes for the same attention.
        const describedBy = field.error
          ? `${id}-error`
          : field.description
            ? `${id}-description`
            : undefined;
        const rendersOwnLabel =
          field.type === "hidden" ||
          field.type === "switch" ||
          field.type === "tip";

        return (
          <div
            key={field.name}
            className={cn(
              "space-y-2",
              colSpan === 1 ? "col-span-1" : "col-span-2",
              field.className,
            )}
          >
            {!rendersOwnLabel && (
              <Label htmlFor={id} className="text-sm font-medium">
                {field.label}
                {field.optional ? (
                  <>
                    {" "}
                    <span className="font-normal text-muted-foreground">
                      (Optional)
                    </span>
                  </>
                ) : null}
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
                disabled={field.disabled}
                required={field.required}
                aria-invalid={field.error ? true : undefined}
                aria-describedby={describedBy}
                className={field.inputClassName}
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
                className={cn("min-h-[100px]", field.inputClassName)}
                rows={field.rows || 3}
                disabled={field.disabled}
                required={field.required}
                aria-describedby={
                  field.description ? `${id}-description` : undefined
                }
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
                disabled={field.disabled}
                required={field.required}
              >
                <SelectTrigger
                  id={id}
                  variant="card"
                  className={field.inputClassName}
                  aria-describedby={
                    field.description ? `${id}-description` : undefined
                  }
                >
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
                className={field.componentClassName}
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
                className={field.componentClassName}
              />
            )}

            {field.type === "upload" && (
              <UploadField
                field={field}
                fieldId={id}
                onChange={(files) => onChange?.(field.name, files)}
                className={field.componentClassName}
              />
            )}

            {field.type === "option-values" &&
              (field.choices ? (
                <OptionValuesField
                  name={field.name}
                  choices={field.choices}
                  selectedIds={arrayValue}
                  onSelectionChange={(ids) => onChange?.(field.name, ids)}
                  allowCreate={field.allowCreate}
                  maxSelected={field.maxSelected}
                  placeholder={field.placeholder}
                  searchPlaceholder={field.searchPlaceholder}
                  emptyMessage={field.emptyMessage}
                  className={field.componentClassName}
                />
              ) : (
                <OptionValuesField
                  name={field.name}
                  placeholder={field.placeholder}
                  defaultValue={arrayValue}
                  value={arrayValue}
                  onChange={(fieldName, val) => onChange?.(fieldName, val)}
                  className={field.componentClassName}
                />
              ))}
            {field.type === "switch" ? (
              <SwitchField
                field={field}
                fieldId={id}
                checked={booleanValue}
                onChange={(checked) => onChange?.(field.name, checked)}
              />
            ) : null}
            {field.type === "tip" ? (
              <Tip label={field.label}>{field.description}</Tip>
            ) : null}
            {!rendersOwnLabel && field.error ? (
              <p
                id={`${id}-error`}
                role="alert"
                className="text-xs leading-relaxed text-destructive"
              >
                {field.error}
              </p>
            ) : !rendersOwnLabel && field.description ? (
              <p
                id={`${id}-description`}
                className="text-xs leading-relaxed text-muted-foreground"
              >
                {field.description}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
