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

// Field value schema
const fieldValueSchema = z
  .string()
  .transform((val) => sanitizeStringInternal(val));

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

// Base FormField schema for input and textarea
const baseFormFieldSchema = z.object({
  name: fieldNameSchema,
  type: z.enum(["input", "textarea"]),
  value: fieldValueSchema,
});

// Select FormField schema
const selectFormFieldSchema = z
  .object({
    name: fieldNameSchema,
    type: z.literal("select"),
    value: fieldValueSchema,
    options: z
      .array(selectOptionSchema)
      .min(1, "Select field must have at least one option")
      .max(100, "Too many options (maximum 100)"),
  })
  .refine(
    (data) => {
      // If value is provided, it must be in options
      if (data.value && data.value.length > 0) {
        return data.options.some((opt) => opt.value === data.value);
      }
      return true;
    },
    {
      message: "Value must be one of the provided options",
    },
  );

// Folder select FormField schema
const folderSelectFormFieldSchema = z.object({
  name: fieldNameSchema,
  type: z.literal("folder-select"),
  value: fieldValueSchema,
  placeholder: z.string().optional(),
  excludedIds: z.array(z.string()).optional(),
});

// Hidden field schema (for passing data to server actions)
const hiddenFormFieldSchema = z.object({
  name: fieldNameSchema,
  type: z.literal("hidden"),
  value: fieldValueSchema,
});

// Union schema for FormField
export const formFieldSchema: z.ZodType<
  | { name: string; type: "input" | "textarea"; value: string }
  | {
      name: string;
      type: "select";
      value: string;
      options: Array<{ label: string; value: string }>;
    }
  | {
      name: string;
      type: "folder-select";
      value: string;
      placeholder?: string;
      excludedIds?: string[];
    }
  | { name: string; type: "hidden"; value: string }
> = z.discriminatedUnion("type", [
  baseFormFieldSchema,
  selectFormFieldSchema,
  folderSelectFormFieldSchema,
  hiddenFormFieldSchema,
]);

// FormSchema schema
export const formSchema = z.object({
  title: safeTitleSchema.optional(),
  description: safeDescriptionSchema.optional(),
  fields: z.array(formFieldSchema).optional(),
});

// Validation functions
export const validateSelectOption = (option: unknown) => {
  const result = selectOptionSchema.safeParse(option);
  return result.success ? result.data : null;
};

export const validateFormField = (field: unknown) => {
  const result = formFieldSchema.safeParse(field);
  if (!result.success) {
    return null;
  }

  const data = result.data;

  // For select fields, ensure value is valid
  if (data.type === "select") {
    if (data.value && !data.options.some((opt) => opt.value === data.value)) {
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

// Type exports
export type SelectOption = z.infer<typeof selectOptionSchema>;
export type FormField = z.infer<typeof formFieldSchema>;
export type FormSchema = z.infer<typeof formSchema>;
