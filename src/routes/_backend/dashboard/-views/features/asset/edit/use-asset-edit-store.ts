import type { FormField } from "@/lib/validations/form";
import type { AssetFormAction } from "@/lib/asset/action-result";
import { validateFormField, validateFormSchema } from "@/lib/validations/form";
import { create } from "zustand";

// Re-export types for convenience
export type { FormField, SelectOption } from "@/lib/validations/form";
export type FieldType =
  | "input"
  | "textarea"
  | "select"
  | "folder-select"
  | "hidden";

export type ServerAction = AssetFormAction;

type AssetEditData = {
  title?: string;
  description?: string;
  fields?: FormField[];
  action?: ServerAction;
  onSuccess?: () => void;
  excludedIds?: string[];
  items?: EditItem[];
  activeItemId?: string | null;
};

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
  action?: ServerAction;
  excludedIds?: string[];
  items?: EditItem[];
  initialItems?: EditItem[];
  activeItemId: string | null;
  onSuccess?: () => void;
  toggleOpen: () => void;
  handleOpenChange: (open: boolean) => void;
  setFields: (fields: FormField[]) => void;
  setOpen: (open: boolean) => void;
  setAssetEditData: (data: AssetEditData) => void;
  openAssetEdit: (data: AssetEditData) => void;
  updateFieldValue: (name: string, value: string) => void;
  setAction: (action: ServerAction) => void;
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
  | "openAssetEdit"
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

const getAssetEditDataState = (
  data: AssetEditData,
  state: AssetEditState,
) => {
  const { action, onSuccess, ...dataToValidate } = data;
  const validatedData = validateFormSchema(dataToValidate);

  if (!validatedData) return null;

  const normalizedItems = data.items?.map(normalizeItem);

  return {
    title: validatedData.title ?? state.title,
    description: validatedData.description ?? state.description,
    fields: validatedData.fields ?? state.fields,
    action: action ?? state.action,
    onSuccess: onSuccess ?? state.onSuccess,
    excludedIds: data.excludedIds ?? state.excludedIds,
    items: normalizedItems ?? state.items,
    initialItems: normalizedItems
      ? structuredClone(normalizedItems)
      : state.initialItems,
    activeItemId:
      data.activeItemId ?? normalizedItems?.[0]?.id ?? state.activeItemId,
  };
};

// Matches the sheet's slide-out animation duration (see sheet.tsx, 300ms).
const CLOSE_ANIMATION_MS = 320;
let resetTimer: ReturnType<typeof setTimeout> | null = null;

export const useAssetEditStore = create<AssetEditState>((set, get) => {
  const clearResetTimer = () => {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  };

  // Keep the dialog content mounted/stable while the sheet animates out, then
  // reset. Wiping the (video-heavy) items synchronously on close tears down all
  // <video> elements in the same frame the animation starts, which janks.
  const closeAndDeferReset = () => {
    set({ open: false });
    clearResetTimer();
    resetTimer = setTimeout(() => {
      resetTimer = null;
      if (!get().open) set(initialState);
    }, CLOSE_ANIMATION_MS);
  };

  return {
    ...initialState,
    toggleOpen: () => {
      if (get().open) {
        closeAndDeferReset();
      } else {
        clearResetTimer();
        set({ open: true });
      }
    },
    handleOpenChange: (open: boolean) => {
      if (open) {
        clearResetTimer();
        set({ open: true });
      } else {
        closeAndDeferReset();
      }
    },
    setOpen: (open: boolean) => {
      if (open) {
        clearResetTimer();
        set({ open: true });
      } else {
        closeAndDeferReset();
      }
    },
  setFields: (fields: FormField[]) => {
    const validatedFields = fields
      .map(validateFormField)
      .filter((field): field is FormField => field !== null);
    set({ fields: validatedFields });
  },
  setAssetEditData: (data) => {
    set((state) => getAssetEditDataState(data, state) ?? {});
  },
  openAssetEdit: (data) => {
    clearResetTimer();
    set((state) => {
      const editData = getAssetEditDataState(data, state);
      return editData ? { ...editData, open: true } : {};
    });
  },
  updateFieldValue: (name: string, value: string) => {
    set((state) => {
      const newFields = state.fields?.map((field) => {
        if (field.name !== name) return field;

        // Validate select field values
        if (field.type === "select") {
          const isValidValue = field.options.some((opt) => opt.value === value);
          return { ...field, value: isValidValue ? value : field.value };
        }
        return { ...field, value };
      });

      // Update active item
      const newItems =
        state.activeItemId && state.items
          ? state.items.map((item) =>
              item.id === state.activeItemId
                ? ({ ...item, [name.toLowerCase()]: value } as EditItem)
                : item,
            )
          : state.items;

      return { fields: newFields, items: newItems };
    });
  },
  setAction: (action: ServerAction) => {
    set({ action });
  },
  removeItem: (id: string) => {
    set((state) => ({
      items: state.items?.filter((item) => item.id !== id),
      initialItems: state.initialItems?.filter((item) => item.id !== id),
    }));
  },
  setActiveItemId: (id: string | null) => {
    set({ activeItemId: id });
  },
  };
});
