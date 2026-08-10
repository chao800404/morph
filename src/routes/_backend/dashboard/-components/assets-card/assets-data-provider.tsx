import type { AssetsExplorerData } from "@/routes/_backend/dashboard/-views/global/contents/assets/assets.types";
import {
  toSelectedAssetFromCard,
  toSelectedFolderFromCard,
} from "@/routes/_backend/dashboard/-views/global/contents/assets/asset-view-model";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

interface AssetsDataProviderProps {
  data: AssetsExplorerData;
  children: React.ReactNode;
  folderId?: string | null;
}

export const AssetsDataProvider = ({
  data,
  children,
  folderId,
}: AssetsDataProviderProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { setAssetsData, setActiveItem } = useAssetsStore(
    useShallow((state) => ({
      setAssetsData: state.setAssetsData,
      setActiveItem: state.setActiveItem,
    })),
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const {
          activeItem,
          selectedItems,
          setActiveItem,
          clearAllSelectedItems,
        } = useAssetsStore.getState();

        if (activeItem) {
          setActiveItem(undefined);
        } else if (selectedItems.size > 1) {
          clearAllSelectedItems();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setAssetsData(data);
  }, [data, setAssetsData]);

  useEffect(() => {
    // Reset properties only when navigating into or out of a folder.
    setActiveItem(undefined);
  }, [folderId, setActiveItem]);

  // Create lookup maps for faster access
  const folderMap = useMemo(() => {
    const map = new Map(data.folders?.map((f) => [String(f.id), f]));
    if (data.currentFolder) {
      map.set(String(data.currentFolder.id), data.currentFolder);
    }
    return map;
  }, [data.folders, data.currentFolder]);

  const assetMap = useMemo(() => {
    return new Map(data.assets?.map((a) => [String(a.id), a]));
  }, [data.assets]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // If click is on Header or Property Card, do nothing (keep current selection)
      // if (target.closest('[data-type="card-header"]')) return;
      // if (target.closest("#card-property")) return;

      // Ignore clicks on checkboxes
      if (target.closest('button[role="checkbox"]')) return;

      // Use closest to find the row element
      const assetElement = target.closest("[data-type]");

      // If click is not on an asset/folder element, reset properties panel
      if (!assetElement) {
        setActiveItem(undefined);
        return;
      }

      const dataType = assetElement.getAttribute("data-type");
      const id = assetElement.getAttribute("id");

      if (!id) return;

      if (dataType === "asset-folder") {
        const folder = folderMap.get(id);
        if (folder) {
          setActiveItem(toSelectedFolderFromCard(folder));
        } else {
          setActiveItem({
            type: "folder",
            id,
            name: "Unknown Folder",
            description: "Unknown Folder",
          });
        }
      } else if (dataType === "asset-asset") {
        const asset = assetMap.get(id);
        if (asset) {
          setActiveItem(toSelectedAssetFromCard(asset));
        }
      }
    };

    container.addEventListener("click", handleClick);

    return () => {
      container.removeEventListener("click", handleClick);
    };
  }, [folderMap, assetMap, setActiveItem]);

  return <div ref={containerRef}>{children}</div>;
};
