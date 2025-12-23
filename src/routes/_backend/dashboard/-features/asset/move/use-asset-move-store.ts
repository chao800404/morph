import type { FormField } from "@/lib/validations/form";
import { validateFormField, validateFormSchema } from "@/lib/validations/form";
import { create } from "zustand";

// Re-export types for convenience
export type { FormField, SelectOption } from "@/lib/validations/form";
export type FieldType = "input" | "textarea" | "select" | "folder-select" | "hidden";

export type ServerAction = any;

export type MoveItem =
    | {
          id: string;
          type: "folder";
          name: string;
      }
    | {
          id: string;
          type: "asset";
          name: string;
          fileType: string;
          extension?: string;
          src?: string;
          alt?: string;
          size?: number;
      };

interface AssetMoveState {
    open: boolean;
    title?: string;
    description?: string;
    fields?: FormField[];
    action?: any;
    excludedIds?: string[];
    items?: MoveItem[];
    onSuccess?: () => void;
    toggleOpen: () => void;
    handleOpenChange: (open: boolean) => void;
    setFields: (fields: FormField[]) => void;
    setOpen: (open: boolean) => void;
    setAssetMoveData: (data: {
        title?: string;
        description?: string;
        fields?: FormField[];
        action?: any;
        onSuccess?: () => void;
        excludedIds?: string[];
        items?: MoveItem[];
    }) => void;
    updateFieldValue: (name: string, value: string) => void;
    setAction: (action: any) => void;
    removeItem: (id: string) => void;
}

const initialState: Omit<
    AssetMoveState,
    | "toggleOpen"
    | "handleOpenChange"
    | "setFields"
    | "setOpen"
    | "setAssetMoveData"
    | "updateFieldValue"
    | "setAction"
    | "removeItem"
> = {
    open: false,
    title: undefined,
    description: undefined,
    fields: undefined,
    action: undefined,
    onSuccess: undefined,
    excludedIds: undefined,
    items: undefined,
};

export const useAssetMoveStore = create<AssetMoveState>((set, get) => ({
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
        const validatedFields = fields.map(validateFormField).filter((field): field is FormField => field !== null);
        set({ fields: validatedFields });
    },
    setAssetMoveData: data => {
        // Extract functions from validation
        const { action, onSuccess, ...dataToValidate } = data;
        const validatedData = validateFormSchema(dataToValidate);

        if (validatedData) {
            set(state => ({
                title: validatedData.title ?? state.title,
                description: validatedData.description ?? state.description,
                fields: validatedData.fields ?? state.fields,
                action: action ?? state.action,
                onSuccess: onSuccess ?? state.onSuccess,
                excludedIds: data.excludedIds ?? state.excludedIds,
                items: data.items ?? state.items,
            }));
        }
    },
    updateFieldValue: (name: string, value: string) => {
        set(state => ({
            fields: state.fields?.map(field => {
                if (field.name !== name) return field;

                // Validate select field values
                if (field.type === "select") {
                    const isValidValue = field.options.some(opt => opt.value === value);
                    return { ...field, value: isValidValue ? value : field.value };
                }
                return { ...field, value };
            }),
        }));
    },
    setAction: (action: any) => {
        set({ action });
    },
    removeItem: (id: string) => {
        set(state => ({
            items: state.items?.filter(item => item.id !== id),
        }));
    },
}));
