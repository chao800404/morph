import type { FieldConfig } from "@/components/upload/types";
import type { FormField } from "@/lib/validations/form";
import { create } from "zustand";

// Re-export types for convenience
export type { FormField, SelectOption } from "@/lib/validations/form";
export type FieldType =
  | "input"
  | "textarea"
  | "select"
  | "folder-select"
  | "hidden"
  | "upload";
export type ServerAction = (formData: FormData) => Promise<any>;

interface CreateState {
  open: boolean;
  title?: string;
  description?: string;
  fields?: (FormField | FieldConfig)[];
  action?: any;
  onSuccess?: () => void;
  toggleOpen: () => void;
  handleOpenChange: (open: boolean) => void;
  setFields: (fields: (FormField | FieldConfig)[]) => void;
  setOpen: (open: boolean) => void;
  setCreateData: (data: {
    title?: string;
    description?: string;
    fields?: (FormField | FieldConfig)[];
    action?: any;
    onSuccess?: () => void;
  }) => void;
  updateFieldValue: (name: string, value: any) => void;
  setAction: (action: any) => void;
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
  updateFieldValue: (name: string, value: any) => {
    set((state) => ({
      fields: state.fields?.map((field) => {
        if (field.name !== name) return field;

        // Handle FormField (has 'value' property)
        if ("value" in field) {
          const f = field as FormField;
          if (f.type === "select") {
            const isValidValue = (f as any).options?.some(
              (opt: any) => opt.value === value,
            );
            return {
              ...f,
              value: isValidValue ? value : f.value,
            } as FormField;
          }
          return { ...f, value } as FormField;
        }

        // Handle FieldConfig (has 'defaultValue' property)
        return { ...field, defaultValue: value } as FieldConfig;
      }),
    }));
  },
  setAction: (action: any) => {
    set({ action });
  },
}));
