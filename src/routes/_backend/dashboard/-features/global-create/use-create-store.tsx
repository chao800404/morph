import { FieldConfig } from "@/app/(backend)/dashboard/_components/fields/types";
import type { FormField } from "@/lib/validations/form";
import { create } from "zustand";

// Re-export types for convenience
export type { FormField, SelectOption } from "@/lib/validations/form";
export type FieldType = "input" | "textarea" | "select" | "folder-select" | "hidden";
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
    updateFieldValue: (name: string, value: string) => void;
    setAction: (action: any) => void;
}

const initialState: Omit<
    CreateState,
    "toggleOpen" | "handleOpenChange" | "setFields" | "setOpen" | "setCreateData" | "updateFieldValue" | "setAction"
> = {
    open: false,
    title: undefined,
    description: undefined,
    fields: undefined,
    action: undefined,
    onSuccess: undefined,
};

export const useCreateStore = create<CreateState>((set, get) => ({
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
    setFields: (fields: (FormField | FieldConfig)[]) => {
        set({ fields });
    },
    setCreateData: data => {
        set(state => ({
            title: data.title ?? state.title,
            description: data.description ?? state.description,
            fields: data.fields ?? state.fields,
            action: data.action ?? state.action,
            onSuccess: data.onSuccess ?? state.onSuccess,
        }));
    },
    updateFieldValue: (name: string, value: string) => {
        set(state => ({
            fields: state.fields?.map(field => {
                if (field.name !== name) return field;

                // Handle FormField
                if ("type" in field && !("component" in field)) {
                    // Validate select field values
                    if (field.type === "select") {
                        const isValidValue = field.options.some(opt => opt.value === value);
                        return { ...field, value: isValidValue ? value : field.value };
                    }
                    return { ...field, value };
                }

                // Handle FieldConfig - update defaultValue
                return { ...field, defaultValue: value };
            }),
        }));
    },
    setAction: (action: any) => {
        set({ action });
    },
}));
