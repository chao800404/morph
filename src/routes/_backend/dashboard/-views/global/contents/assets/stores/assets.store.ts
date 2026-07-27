import { create } from "zustand";
import type { AssetsExplorerData } from "../assets.types";

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
      path?: string;
      parentId?: string | null;
      assetCount?: number;
      folderCount?: number;
      itemCount?: number;
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
  isActionMenuOpen: boolean;
  assetsData: AssetsExplorerData;
  setActiveItem: (item?: SelectedItem) => void;
  setActionMenuOpen: (open: boolean) => void;
  toggleSelectItem: (item: SelectedItem) => void;
  clearAllSelectedItems: () => void;
  selectAllItems: (items: SelectedItem[], append?: boolean) => void;
  setAssetsData: (data: AssetsExplorerData) => void;
  setDragItem: (data: SelectedItem | undefined) => void;
  isItemDragging: (id: string, type: "folder" | "asset") => boolean;
  deleteItemById: (id: string, type: "folder" | "asset") => void;
}

export const useAssetsStore = create<AssetsStore>((set, get) => ({
  activeItem: undefined,
  dragItem: undefined,
  selectedItems: new Map(),
  isActionMenuOpen: false,
  assetsData: {},
  setActiveItem: (item) =>
    set((state) => (state.activeItem === item ? state : { activeItem: item })),
  setActionMenuOpen: (open) =>
    set((state) =>
      state.isActionMenuOpen === open ? state : { isActionMenuOpen: open },
    ),
  toggleSelectItem: (item) => {
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
  clearAllSelectedItems: () =>
    set((state) =>
      state.selectedItems.size === 0
        ? state
        : { selectedItems: new Map<string, SelectedItem>() },
    ),
  selectAllItems: (items, append = false) => {
    const newItems = append
      ? new Map(get().selectedItems)
      : new Map<string, SelectedItem>();
    items.forEach((item) => {
      const key = `${item.type}-${item.id}`;
      newItems.set(key, item);
    });
    set({ selectedItems: newItems });
  },
  setDragItem: (data) => {
    set((state) => {
      let selectedItems = state.selectedItems;
      if (data) {
        const key = `${data.type}-${data.id}`;
        if (!selectedItems.has(key) && selectedItems.size > 0) {
          selectedItems = new Map();
        }
      }

      if (state.dragItem === data && selectedItems === state.selectedItems) {
        return state;
      }

      return { dragItem: data, selectedItems };
    });
  },
  setAssetsData: (data) =>
    set((state) => (state.assetsData === data ? state : { assetsData: data })),
  isItemDragging: (id, type) => {
    const { dragItem, selectedItems } = get();
    if (!dragItem) return false;

    // If the item itself is being dragged
    if (dragItem.type === type && String(dragItem.id) === String(id))
      return true;

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
