import type { FormField } from "@/lib/validations/form";
import { validateFormField, validateFormSchema } from "@/lib/validations/form";
import { create } from "zustand";

// Re-export types for convenience
export type { FormField, SelectOption } from "@/lib/validations/form";
export type FieldType = "input" | "textarea" | "select" | "folder-select" | "hidden";

// Server action: next-safe-action compatible
export type ServerAction = any;

export type EditItem =
    | {
          id: string;
          type: "folder";
          name: string;
          description?: string;
      }
    | {
          id: string;
          type: "asset";
          name: string;
          fileType: string;
          extension?: string;
          src?: string;
          alt?: string;
          caption?: string;
          tags?: string;
          size?: number;
      };

interface AssetEditState {
    open: boolean;
    title?: string;
    description?: string;
    fields?: FormField[];
    action?: any;
    excludedIds?: string[];
    items?: EditItem[];
    initialItems?: EditItem[];
    activeItemId: string | null;
    onSuccess?: () => void;
    toggleOpen: () => void;
    handleOpenChange: (open: boolean) => void;
    setFields: (fields: FormField[]) => void;
    setOpen: (open: boolean) => void;
    setAssetEditData: (data: {
        title?: string;
        description?: string;
        fields?: FormField[];
        action?: any;
        onSuccess?: () => void;
        excludedIds?: string[];
        items?: EditItem[];
        activeItemId?: string | null;
    }) => void;
    updateFieldValue: (name: string, value: string) => void;
    setAction: (action: any) => void;
    removeItem: (id: string) => void;
    setActiveItemId: (id: string | null) => void;
}

const initialState: Omit<
    AssetEditState,
    | "toggleOpen"
    | "handleOpenChange"
    | "setFields"
    | "setOpen"
    | "setAssetEditData"
    | "updateFieldValue"
    | "setAction"
    | "removeItem"
    | "setActiveItemId"
> = {
    open: false,
    title: undefined,
    description: undefined,
    fields: undefined,
    action: undefined,
    onSuccess: undefined,
    excludedIds: undefined,
    items: undefined,
    initialItems: undefined,
    activeItemId: null,
};

// Helper function to normalize items
const normalizeItem = (item: EditItem): EditItem => {
    if (item.type === "folder") {
        return { ...item, description: item.description || "" };
    }
    return {
        ...item,
        alt: item.alt || "",
        caption: item.caption || "",
        tags: item.tags || "",
    };
};

export const useAssetEditStore = create<AssetEditState>((set, get) => ({
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
    setAssetEditData: data => {
        // Extract functions from validation
        const { action, onSuccess, ...dataToValidate } = data;
        const validatedData = validateFormSchema(dataToValidate);

        if (validatedData) {
            const normalizedItems = data.items?.map(normalizeItem);

            set(state => ({
                title: validatedData.title ?? state.title,
                description: validatedData.description ?? state.description,
                fields: validatedData.fields ?? state.fields,
                action: action ?? state.action,
                onSuccess: onSuccess ?? state.onSuccess,
                excludedIds: data.excludedIds ?? state.excludedIds,
                items: normalizedItems ?? state.items,
                initialItems: normalizedItems ? structuredClone(normalizedItems) : state.initialItems,
                activeItemId: data.activeItemId ?? state.activeItemId,
            }));
        }
    },
    updateFieldValue: (name: string, value: string) => {
        set(state => {
            const newFields = state.fields?.map(field => {
                if (field.name !== name) return field;

                // Validate select field values
                if (field.type === "select") {
                    const isValidValue = field.options.some(opt => opt.value === value);
                    return { ...field, value: isValidValue ? value : field.value };
                }
                return { ...field, value };
            });

            // Update active item
            const newItems =
                state.activeItemId && state.items
                    ? state.items.map(item =>
                          item.id === state.activeItemId ? ({ ...item, [name.toLowerCase()]: value } as EditItem) : item
                      )
                    : state.items;

            return { fields: newFields, items: newItems };
        });
    },
    setAction: (action: ServerAction) => {
        set({ action });
    },
    removeItem: (id: string) => {
        set(state => ({
            items: state.items?.filter(item => item.id !== id),
            initialItems: state.initialItems?.filter(item => item.id !== id),
        }));
    },
    setActiveItemId: (id: string | null) => {
        set({ activeItemId: id });
    },
}));
