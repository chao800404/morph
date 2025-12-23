import { create } from "zustand";
import type { Asset, AssetFolder, AssetsCardData } from "../_config/assets-card.types";

export type SelectedItem =
    | {
          type: "folder";
          id: string;
          name: string;
          createdAt?: string;
          updatedAt?: string;
          createdBy?: string;
          updatedBy?: string;
          description?: string;
      }
    | {
          type: "asset";
          id: string;
          name: string;
          fileType: string;
          extension?: string;
          src?: string;
          alt?: string;
          caption?: string;
          tags?: string[];
          createdAt?: string;
          updatedAt?: string;
          uploadedBy?: string;
          duration?: number; // For video assets
          size?: number;
      };

interface AssetsStore {
    activeItem?: SelectedItem;
    dragItem?: SelectedItem;
    selectedItems: Map<string, SelectedItem>;
    dailogOpen: boolean;
    dailogType: "folder" | "assets";
    isActionMenuOpen: boolean;
    assetsData: AssetsCardData;
    setActiveItem: (item?: SelectedItem) => void;
    setDailogOpen: (open: boolean) => void;
    setDailogType: (type: "folder" | "assets") => void;
    setActionMenuOpen: (open: boolean) => void;
    toggleSelectItem: (item: SelectedItem) => void;
    clearAllSelectedItems: () => void;
    selectAllItems: (items: SelectedItem[]) => void;
    isSelected: (id: string) => boolean;
    getSelectedByType: (type: "folder" | "asset") => SelectedItem[];
    setAssetsData: (data: AssetsCardData) => void;
    setDragItem: (data: SelectedItem | undefined) => void;
    getActiveItemData: () => AssetFolder | Asset | undefined;
    isItemDragging: (id: string, type: "folder" | "asset") => boolean;
    deleteItemById: (id: string, type: "folder" | "asset") => void;
}

export const useAssetsStore = create<AssetsStore>((set, get) => ({
    activeItem: undefined,
    dragItem: undefined,
    selectedItems: new Map(),
    dailogOpen: false,
    dailogType: "folder",
    isActionMenuOpen: false,
    assetsData: {},
    setActiveItem: item => set({ activeItem: item }),
    setDailogOpen: open => set({ dailogOpen: open }),
    setDailogType: type => set({ dailogType: type }),
    setActionMenuOpen: open => set({ isActionMenuOpen: open }),
    toggleSelectItem: item => {
        const currentItems = get().selectedItems;
        const newItems = new Map(currentItems);
        const key = `${item.type}-${item.id}`;

        if (newItems.has(key)) {
            newItems.delete(key);
        } else {
            newItems.set(key, item);
        }

        set({ selectedItems: newItems });
    },
    clearAllSelectedItems: () => set({ selectedItems: new Map() }),
    selectAllItems: items => {
        const newItems = new Map<string, SelectedItem>();
        items.forEach(item => {
            const key = `${item.type}-${item.id}`;
            newItems.set(key, item);
        });
        set({ selectedItems: newItems });
    },
    isSelected: id => {
        const items = get().selectedItems;
        return Array.from(items.keys()).some(key => key.endsWith(`-${id}`));
    },
    getSelectedByType: type => {
        const items = get().selectedItems;
        return Array.from(items.values()).filter(item => item.type === type);
    },
    setDragItem: data => {
        if (data) {
            const { selectedItems } = get();
            const key = `${data.type}-${data.id}`;
            if (!selectedItems.has(key)) {
                set({ selectedItems: new Map() });
            }
        }
        set({ dragItem: data });
    },
    setAssetsData: data => set({ assetsData: data }),
    getActiveItemData: () => {
        const { activeItem, assetsData } = get();

        if (!activeItem) {
            return assetsData.currentFolder;
        }

        if (activeItem.type === "folder") {
            // First check if it's the currentFolder
            if (assetsData.currentFolder && String(assetsData.currentFolder.id) === String(activeItem.id)) {
                return assetsData.currentFolder;
            }
            // Then check in folders array
            const folder = assetsData.folders?.find(folder => String(folder.id) === String(activeItem.id));
            // If found in assetsData, return it; otherwise construct from activeItem
            return (
                folder || {
                    id: activeItem.id,
                    name: activeItem.name,
                    empty: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                }
            );
        } else {
            // For assets, try to find in assetsData first
            const asset = assetsData.assets?.find(asset => String(asset.id) === String(activeItem.id));
            // If found in assetsData, return it; otherwise construct from activeItem
            return (
                asset || {
                    id: activeItem.id,
                    name: activeItem.name,
                    url: activeItem.src || "",
                    type:
                        activeItem.fileType === "image"
                            ? "image/png"
                            : activeItem.fileType === "video"
                              ? "video/mp4"
                              : activeItem.fileType === "audio"
                                ? "audio/mp3"
                                : "application/octet-stream",
                    size: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                }
            );
        }
    },
    isItemDragging: (id, type) => {
        const { dragItem, selectedItems } = get();
        if (!dragItem) return false;

        // If the item itself is being dragged
        if (dragItem.type === type && String(dragItem.id) === String(id)) return true;

        // If the dragged item is selected, and this item is also selected, then it is dragging
        const dragItemKey = `${dragItem.type}-${dragItem.id}`;
        const currentItemKey = `${type}-${id}`;

        if (selectedItems.has(dragItemKey) && selectedItems.has(currentItemKey)) {
            return true;
        }

        return false;
    },
    deleteItemById: (id, type) => {
        const currentItems = get().selectedItems;
        const newItems = new Map(currentItems);
        const key = `${type}-${id}`;

        if (newItems.has(key)) {
            newItems.delete(key);
            set({ selectedItems: newItems });
        }
    },
}));

useAssetsStore.subscribe(state => {
    console.log(state.selectedItems);
});
