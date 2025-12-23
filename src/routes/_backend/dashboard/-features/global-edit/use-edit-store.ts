import type { FormField } from "@/lib/validations/form";
import { validateFormField, validateFormSchema } from "@/lib/validations/form";
import { create } from "zustand";

// Re-export types for convenience
export type { FormField, SelectOption } from "@/lib/validations/form";

export type FieldType =
  | "input"
  | "textarea"
  | "select"
  | "folder-select"
  | "hidden"
  | "language";

/**
 * Result structure for actions.
 * Consistent with what EditDialog expects and compatible with TanStack Start server functions.
 */
export interface ActionResult<T = any> {
  data?: T;
  serverError?: string;
  validationErrors?: Record<string, string | string[]>;
}

/**
 * Server Action type for TanStack Start.
 * In TanStack Start, server functions are async functions that can return a standardized result.
 */
export type ServerAction = (input: any) => Promise<ActionResult>;

interface EditState {
  open: boolean;
  title?: string;
  description?: string;
  fields?: FormField[];
  initialFields?: FormField[];
  action?: ServerAction;
  onSuccess?: () => void;
  toggleOpen: () => void;
  handleOpenChange: (open: boolean) => void;
  setFields: (fields: FormField[]) => void;
  setOpen: (open: boolean) => void;
  setEditData: (data: {
    title?: string;
    description?: string;
    fields?: FormField[];
    action?: ServerAction;
    onSuccess?: () => void;
  }) => void;
  updateFieldValue: (name: string, value: string) => void;
  setAction: (action: ServerAction) => void;
}

const initialState: Omit<
  EditState,
  | "toggleOpen"
  | "handleOpenChange"
  | "setFields"
  | "setOpen"
  | "setEditData"
  | "updateFieldValue"
  | "setAction"
> = {
  open: false,
  title: undefined,
  description: undefined,
  fields: undefined,
  initialFields: undefined,
  action: undefined,
  onSuccess: undefined,
};

export const useEditStore = create<EditState>((set, get) => ({
  ...initialState,
  toggleOpen: () => {
    set(get().open ? initialState : { open: true });
  },
  handleOpenChange: (open: boolean) => {
    set(open ? { open: true } : initialState);
  },
  setOpen: (open: boolean) => {
    set(open ? { open: true } : initialState);
  },
  setFields: (fields: FormField[]) => {
    const validatedFields = fields
      .map(validateFormField)
      .filter((field): field is FormField => field !== null);
    set({ fields: validatedFields });
  },
  setEditData: (data) => {
    // Extract functions from validation
    const { action, onSuccess, ...dataToValidate } = data;
    const validatedData = validateFormSchema(dataToValidate);

    if (validatedData) {
      set((state) => ({
        title: validatedData.title ?? state.title,
        description: validatedData.description ?? state.description,
        fields: validatedData.fields ?? state.fields,
        initialFields: validatedData.fields
          ? structuredClone(validatedData.fields)
          : state.initialFields,
        action: action ?? state.action,
        onSuccess: onSuccess ?? state.onSuccess,
      }));
    }
  },
  updateFieldValue: (name: string, value: string) => {
    set((state) => ({
      fields: state.fields?.map((field) => {
        if (field.name !== name) return field;

        // Validate select field values
        if (field.type === "select") {
          const isValidValue = field.options.some((opt) => opt.value === value);
          return { ...field, value: isValidValue ? value : field.value };
        }
        return { ...field, value };
      }),
    }));
  },
  setAction: (action: ServerAction) => {
    set({ action });
  },
}));
