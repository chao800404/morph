import { useMediaQuery } from "@/hooks/use-media-query";
import { getFileType } from "@/lib/utils";
import type { AssetsCardData } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/assets-card.types";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

interface AssetsDataProviderProps {
  data: AssetsCardData;
  children: React.ReactNode;
  folderId?: string | null;
}

export const AssetsDataProvider = ({
  data,
  children,
  folderId,
}: AssetsDataProviderProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery("(min-width: 1280px)");
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

      if (dataType === "asset-folder" && isDesktop) {
        const folder = folderMap.get(id);
        if (folder) {
          setActiveItem({
            type: "folder",
            id,
            name: folder.name,
            createdAt: folder.createdAt,
            updatedAt: folder.updatedAt,
            createdBy: folder.createdBy,
            updatedBy: folder.updatedBy,
            description: folder.description || undefined,
            path: folder.path,
            parentId: folder.parentId,
            assetCount: folder.assetCount,
            folderCount: folder.folderCount,
            itemCount: folder.itemCount,
          });
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
          const fileType = getFileType(asset.type);

          const extension =
            asset?.type?.split("/").pop()?.toLowerCase() || "file";

          setActiveItem({
            type: "asset",
            id,
            name: asset.name,
            fileType,
            extension,
            src: asset.url,
            alt: asset.alt || undefined,
            caption: asset.caption || undefined,
            tags: asset.tags || undefined,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
            uploadedBy: asset.uploadedBy || undefined,
            duration: asset.duration || undefined,
            size: asset.size,
          });
        }
      }
    };

    container.addEventListener("click", handleClick);

    return () => {
      container.removeEventListener("click", handleClick);
    };
  }, [folderMap, assetMap, setActiveItem, isDesktop]);

  return <div ref={containerRef}>{children}</div>;
};
