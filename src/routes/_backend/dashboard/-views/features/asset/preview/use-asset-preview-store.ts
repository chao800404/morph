import { create } from "zustand";

export type PreviewItem =
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
          tags?: string[];
          duration?: number;
          size?: number;
      };

interface AssetPreviewState {
    open: boolean;
    item?: PreviewItem;
    items: PreviewItem[]; // 所有資產列表
    currentIndex: number; // 當前索引
    onSuccess?: () => void;
    toggleOpen: () => void;
    handleOpenChange: (open: boolean) => void;
    setAssetPreviewData: (data: { item?: PreviewItem; items?: PreviewItem[]; onSuccess?: () => void }) => void;
    setOpen: (open: boolean) => void;
    goToNext: () => void;
    goToPrevious: () => void;
    setCurrentIndex: (index: number) => void;
}

const initialState = {
    open: false,
    item: undefined,
    items: [],
    currentIndex: -1,
    onSuccess: undefined,
};

export const useAssetPreviewStore = create<AssetPreviewState>((set, get) => ({
    ...initialState,
    toggleOpen: () => {
        const { open } = get();
        if (open) {
            set(initialState);
        } else {
            set({ open: true });
        }
    },
    handleOpenChange: (open: boolean) => {
        if (!open) {
            set(initialState);
        } else {
            set({ open: true });
        }
    },
    setOpen: (open: boolean) => {
        if (!open) {
            set(initialState);
        } else {
            set({ open: true });
        }
    },
    setAssetPreviewData: (data: { item?: PreviewItem; items?: PreviewItem[]; onSuccess?: () => void }) => {
        set(state => {
            const newItems = data.items ?? state.items;
            const newItem = data.item ?? state.item;

            // 找到當前 item 在 items 中的索引
            const currentIndex = newItem ? newItems.findIndex(i => i.id === newItem.id) : -1;

            return {
                item: newItem,
                items: newItems,
                currentIndex,
                onSuccess: data.onSuccess ?? state.onSuccess,
            };
        });
    },
    goToNext: () => {
        const { items, currentIndex } = get();
        if (items.length === 0) return;

        const nextIndex = (currentIndex + 1) % items.length;
        set({
            currentIndex: nextIndex,
            item: items[nextIndex],
        });
    },
    goToPrevious: () => {
        const { items, currentIndex } = get();
        if (items.length === 0) return;

        const prevIndex = currentIndex === 0 ? items.length - 1 : currentIndex - 1;
        set({
            currentIndex: prevIndex,
            item: items[prevIndex],
        });
    },
    setCurrentIndex: (index: number) => {
        const { items } = get();
        if (index >= 0 && index < items.length) {
            set({
                currentIndex: index,
                item: items[index],
            });
        }
    },
}));
