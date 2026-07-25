import { isValidElement } from "react";
import { z } from "zod";
import { safeDescriptionSchema, safeTitleSchema } from "./common";

// Sanitize string to prevent XSS
// Note: This is also exported below for use in store
const sanitizeStringInternal = (str: string): string => {
  return str
    .replace(/[<>]/g, "") // Remove < and >
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+=/gi, "") // Remove event handlers
    .trim();
};

// SelectOption schema with security validation
export const selectOptionSchema = z
  .object({
    label: z
      .string()
      .max(100, "Label too long (maximum 100 characters)")
      .transform((val) => sanitizeStringInternal(val)),
    value: z
      .string()
      .max(200, "Value too long (maximum 200 characters)")
      .transform((val) => sanitizeStringInternal(val)),
  })
  .refine((data) => data.label.length > 0 && data.value.length > 0, {
    message: "Label and value cannot be empty after sanitization",
  });

// Field name schema
const fieldNameSchema = z
  .string()
  .min(1, "Field name is required")
  .max(50, "Field name too long (maximum 50 characters)")
  .transform((val) => sanitizeStringInternal(val))
  .refine((val) => val.length > 0, {
    message: "Field name cannot be empty after sanitization",
  });

// Field value schema. Most controls hold a single string; tag-style controls
// such as `option-values` hold a list of strings.
const fieldTextValueSchema = z
  .string()
  .transform((val) => sanitizeStringInternal(val));

const fieldValueSchema = z.union([
  fieldTextValueSchema,
  z.array(fieldTextValueSchema),
]);

// Export sanitize function for use in store
export const sanitizeString = sanitizeStringInternal;

// Validate ReactNode
export const validateReactNode = (node: unknown): boolean => {
  // null and undefined are valid ReactNodes
  if (node === null || node === undefined) {
    return true;
  }

  // string, number, boolean are valid ReactNodes
  if (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean"
  ) {
    // For strings, ensure they don't contain malicious content
    if (typeof node === "string") {
      const sanitized = sanitizeStringInternal(node);
      // If sanitization changes the string significantly, it might be malicious
      return sanitized.length > 0 || node.length === 0;
    }
    return true;
  }

  // Valid React element
  if (isValidElement(node)) {
    return true;
  }

  // Arrays of ReactNodes
  if (Array.isArray(node)) {
    return node.every((item) => validateReactNode(item));
  }

  // React fragments and other valid types
  return false;
};

/**
 * Field values are authored two ways across the dashboard:
 * - `value` for controls whose current value is owned by the calling store
 *   (Edit / Move / Info dialogs read it back after `updateFieldValue`).
 * - `defaultValue` for controls that manage their own state after mount
 *   (Create dialog config objects).
 *
 * Both live on the same union so `FieldsRenderer` no longer has to guess which
 * shape it received. `defaultValue` wins when both are present.
 */
export type FormFieldValue = string | string[];

export interface FormFieldBase {
  name: string;
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Grid columns the field spans inside `FieldsRenderer`. Defaults to 2. */
  colSpan?: number;
  className?: string;
  inputClassName?: string;
  componentClassName?: string;
  value?: FormFieldValue;
  defaultValue?: FormFieldValue;
}

export type SelectOption = z.infer<typeof selectOptionSchema>;

export type InputFormField = FormFieldBase & {
  type: "input";
  inputType?: string;
};

export type TextareaFormField = FormFieldBase & {
  type: "textarea";
  rows?: number;
};

export type PhoneFormField = FormFieldBase & {
  type: "phone";
  defaultCountry?: string;
};

export type SelectFormField = FormFieldBase & {
  type: "select";
  options: SelectOption[];
};

export type FolderSelectFormField = FormFieldBase & {
  type: "folder-select";
  excludedIds?: string[];
};

export type UploadFormField = FormFieldBase & {
  type: "upload";
  accept?: Record<string, string[]>;
  maxFiles?: number;
  maxSize?: number;
  minSize?: number;
};

export type OptionValuesFormField = FormFieldBase & {
  type: "option-values";
};

export type HiddenFormField = FormFieldBase & {
  type: "hidden";
};

export type FormField =
  | InputFormField
  | TextareaFormField
  | PhoneFormField
  | SelectFormField
  | FolderSelectFormField
  | UploadFormField
  | OptionValuesFormField
  | HiddenFormField;

export type FormFieldType = FormField["type"];

// Shared shape for every field variant. Layout and presentation keys live here
// so a new field type cannot silently drop `colSpan`, `className` or `disabled`.
const formFieldBaseShape = {
  name: fieldNameSchema,
  label: z.string().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  autoFocus: z.boolean().optional(),
  colSpan: z.number().int().min(1).max(2).optional(),
  className: z.string().optional(),
  inputClassName: z.string().optional(),
  componentClassName: z.string().optional(),
  value: fieldValueSchema.optional(),
  defaultValue: fieldValueSchema.optional(),
};

const inputFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("input"),
  inputType: z.string().optional(),
});

const textareaFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("textarea"),
  rows: z.number().int().positive().max(50).optional(),
});

const phoneFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("phone"),
  defaultCountry: z.string().optional(),
});

const selectFormFieldSchema = z
  .object({
    ...formFieldBaseShape,
    type: z.literal("select"),
    options: z
      .array(selectOptionSchema)
      .min(1, "Select field must have at least one option")
      .max(100, "Too many options (maximum 100)"),
  })
  .refine(
    (data) => {
      // If value is provided, it must be in options
      if (typeof data.value === "string" && data.value.length > 0) {
        return data.options.some((opt) => opt.value === data.value);
      }
      return true;
    },
    {
      message: "Value must be one of the provided options",
    },
  );

const folderSelectFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("folder-select"),
  excludedIds: z.array(z.string()).optional(),
});

const uploadFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("upload"),
  accept: z.record(z.string(), z.array(z.string())).optional(),
  maxFiles: z.number().int().positive().optional(),
  maxSize: z.number().int().positive().optional(),
  minSize: z.number().int().nonnegative().optional(),
});

const optionValuesFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("option-values"),
});

const hiddenFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("hidden"),
});

// Union schema for FormField
export const formFieldSchema: z.ZodType<FormField> = z.discriminatedUnion(
  "type",
  [
    inputFormFieldSchema,
    textareaFormFieldSchema,
    phoneFormFieldSchema,
    selectFormFieldSchema,
    folderSelectFormFieldSchema,
    uploadFormFieldSchema,
    optionValuesFormFieldSchema,
    hiddenFormFieldSchema,
  ],
);

// FormSchema schema
export const formSchema = z.object({
  title: safeTitleSchema.optional(),
  description: safeDescriptionSchema.optional(),
  fields: z.array(formFieldSchema).optional(),
});

export type FormSchema = z.infer<typeof formSchema>;

// Validation functions
export const validateSelectOption = (option: unknown) => {
  const result = selectOptionSchema.safeParse(option);
  return result.success ? result.data : null;
};

export const validateFormField = (field: unknown): FormField | null => {
  const result = formFieldSchema.safeParse(field);
  if (!result.success) {
    return null;
  }

  const data = result.data;

  // For select fields, ensure value is valid
  if (data.type === "select") {
    if (
      typeof data.value === "string" &&
      data.value &&
      !data.options.some((opt) => opt.value === data.value)
    ) {
      // If value doesn't match any option, set to first option or empty
      return {
        ...data,
        value: data.options.length > 0 ? data.options[0].value : "",
      };
    }
  }

  return data;
};

export const validateFormSchema = (data: unknown) => {
  const result = formSchema.safeParse(data);
  return result.success ? result.data : null;
};
