import type { AssetFormAction } from "@/lib/asset/action-result";
import type { FormField, FormFieldValue } from "@/lib/validations/form";
import { create } from "zustand";

// Re-export types for convenience
export type {
  FormField,
  FormFieldType as FieldType,
  SelectOption,
} from "@/lib/validations/form";
export type ServerAction = AssetFormAction;

/** Values `FieldsRenderer` can emit, including the File list from `upload`. */
export type CreateFieldValue = FormFieldValue | File[];

interface CreateState {
  open: boolean;
  title?: string;
  description?: string;
  fields?: FormField[];
  action?: ServerAction;
  onSuccess?: () => void | Promise<void>;
  toggleOpen: () => void;
  handleOpenChange: (open: boolean) => void;
  setFields: (fields: FormField[]) => void;
  setOpen: (open: boolean) => void;
  setCreateData: (data: {
    title?: string;
    description?: string;
    fields?: FormField[];
    action?: ServerAction;
    onSuccess?: () => void | Promise<void>;
  }) => void;
  updateFieldValue: (name: string, value: CreateFieldValue) => void;
  setAction: (action: ServerAction) => void;
}

const initialData = {
  open: false,
  title: undefined,
  description: undefined,
  fields: undefined,
  action: undefined,
  onSuccess: undefined,
};

export const useCreateStore = create<CreateState>((set, get) => ({
  ...initialData,
  toggleOpen: () => {
    set(get().open ? initialData : { open: true });
  },
  handleOpenChange: (open: boolean) => {
    set(open ? { open: true } : initialData);
  },
  setOpen: (open: boolean) => {
    set(open ? { open: true } : initialData);
  },
  setFields: (fields) => {
    set({ fields });
  },
  setCreateData: (data) => {
    set((state) => ({
      title: data.title ?? state.title,
      description: data.description ?? state.description,
      fields: data.fields ?? state.fields,
      action: data.action ?? state.action,
      onSuccess: data.onSuccess ?? state.onSuccess,
    }));
  },
  updateFieldValue: (name: string, value: CreateFieldValue) => {
    set((state) => ({
      fields: state.fields?.map((field) => {
        if (field.name !== name) return field;

        // `upload` reports File[]. Those files live in the upload store and are
        // appended to FormData at submit time, so there is nothing to mirror
        // onto the field itself.
        if (Array.isArray(value) && value.some((v) => v instanceof File)) {
          return field;
        }
        const nextValue = value as FormFieldValue;

        if (field.type === "select") {
          const isValidValue = field.options.some(
            (opt) => opt.value === nextValue,
          );
          return isValidValue ? { ...field, value: nextValue } : field;
        }

        // Fields authored with `defaultValue` keep owning that key so
        // FieldsRenderer resolves the same value it rendered with.
        if (field.defaultValue !== undefined) {
          return { ...field, defaultValue: nextValue };
        }
        return { ...field, value: nextValue };
      }),
    }));
  },
  setAction: (action: ServerAction) => {
    set({ action });
  },
}));
