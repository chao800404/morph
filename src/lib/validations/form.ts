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
  z.boolean(),
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
export type FormFieldValue = string | string[] | boolean;

export interface FormFieldBase {
  name: string;
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  /**
   * Validation message for this field.
   *
   * Lives on the field rather than in the surrounding component so the same
   * `fields` array stays the single source for what a form contains and what
   * is wrong with it.
   */
  error?: string;
  /**
   * Explains the field from an info icon beside the label.
   *
   * For background a reader only needs once — what a handle is for — where
   * `description` would keep a permanent line of small text under the control.
   */
  labelHint?: string;
  /** Shows the shared muted "(Optional)" marker beside the label. */
  optional?: boolean;
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
  /**
   * Static text attached to the control, inside the same box.
   *
   * A handle uses `prefix: "/"` so the value reads as the URL segment it will
   * become. It is decoration, not data: the submitted value never includes it.
   */
  prefix?: string;
  suffix?: string;
  /**
   * `step` for a numeric input.
   *
   * The browser validates against it, and the default of 1 rejects decimals —
   * so a measurement field has to say `"any"` or it silently refuses 12.5.
   */
  step?: string | number;
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

export type ChoiceCardsFormField = FormFieldBase & {
  type: "choice-cards";
  options: Array<SelectOption & { description?: string }>;
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
  /**
   * Turns the field from free typing into picking from a fixed set.
   *
   * With `choices` the field's value is the selected ids; without it, the
   * values the author typed. Product options declare choices; the Options page
   * itself does not, because that is where values are created.
   */
  choices?: OptionValueChoice[];
  /** Offers "Create «typed text»" when the search matches nothing. */
  allowCreate?: boolean;
  maxSelected?: number;
  searchPlaceholder?: string;
  emptyMessage?: string;
};

export type SwitchFormField = FormFieldBase & {
  type: "switch";
};

export type TipFormField = FormFieldBase & {
  type: "tip";
  description: string;
};

export interface OptionValueChoice {
  id: string;
  value: string;
}

/**
 * Free-form key/value pairs for a record's `metadata` column.
 *
 * The value is a JSON object string, matching how `option-values` transports
 * its list: `FormFieldValue` has no object member, and widening it for one
 * field type would ripple through every other.
 */
export type MetadataFormField = FormFieldBase & {
  type: "metadata";
};

/**
 * Images chosen for a record, by upload or from the asset library.
 *
 * The value is a JSON array of `{ id, name, url }`, matching how `metadata`
 * travels: `FormFieldValue` has no object member, and a thumbnail needs more
 * than the id it eventually submits.
 */
export type AssetSelectFormField = FormFieldBase & {
  type: "asset-select";
  /**
   * Narrows the store's `upload.maxAssetsPerRecord` for this one field — a
   * cover image is `1`. It cannot raise it: the server validates against the
   * configured value.
   */
  maxSelected?: number;
  /** Folder new uploads land in. Omitted means the library root. */
  uploadFolderId?: string;
  /**
   * Restricts the picker to a record-owned gallery.
   *
   * Omitted keeps the normal Upload / Library picker. Present — including an
   * empty array — disables both global sources and only offers these assets.
   * Variant media uses this so it can reference Product Media without quietly
   * attaching an unrelated library asset to the variant.
   */
  availableAssets?: Array<{ id: string; name: string; url: string }>;
};

export type HiddenFormField = FormFieldBase & {
  type: "hidden";
};

export type FormField =
  | InputFormField
  | TextareaFormField
  | PhoneFormField
  | SelectFormField
  | ChoiceCardsFormField
  | FolderSelectFormField
  | UploadFormField
  | OptionValuesFormField
  | MetadataFormField
  | AssetSelectFormField
  | SwitchFormField
  | TipFormField
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
  error: z.string().optional(),
  labelHint: z.string().max(300).optional(),
  optional: z.boolean().optional(),
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
  prefix: z.string().max(20).optional(),
  suffix: z.string().max(20).optional(),
  step: z.union([z.string(), z.number()]).optional(),
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

const choiceCardsFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("choice-cards"),
  options: z.array(selectOptionSchema.safeExtend({ description: z.string().optional() })).min(1).max(20),
});

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
  choices: z.array(z.object({ id: z.string(), value: z.string() })).optional(),
  allowCreate: z.boolean().optional(),
  maxSelected: z.number().int().positive().optional(),
  searchPlaceholder: z.string().optional(),
  emptyMessage: z.string().optional(),
});

const switchFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("switch"),
});

const tipFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("tip"),
  description: z.string().min(1).max(2000),
});

const metadataFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("metadata"),
});

const assetSelectFormFieldSchema = z.object({
  ...formFieldBaseShape,
  type: z.literal("asset-select"),
  maxSelected: z.number().int().positive().optional(),
  uploadFolderId: z.uuid().optional(),
  availableAssets: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().min(1),
        url: z.string().min(1),
      }),
    )
    .optional(),
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
    choiceCardsFormFieldSchema,
    folderSelectFormFieldSchema,
    uploadFormFieldSchema,
    optionValuesFormFieldSchema,
    metadataFormFieldSchema,
    assetSelectFormFieldSchema,
    switchFormFieldSchema,
    tipFormFieldSchema,
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
