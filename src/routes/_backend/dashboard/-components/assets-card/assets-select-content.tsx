import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AssetBlockMap } from "@/components/asset/asset-block-map";
import { getFileType } from "@/lib/utils";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { FileIcon, Folder, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

export const AssetsSelectContent = () => {
  const { selectedItems, assetsData, deleteItemById } = useAssetsStore(
    useShallow((state) => ({
      selectedItems: state.selectedItems,
      assetsData: state.assetsData,
      deleteItemById: state.deleteItemById,
    })),
  );

  const selectedItemsArray = Array.from(selectedItems.values());
  const selectedFolders = selectedItemsArray.filter(
    (item) => item.type === "folder",
  );
  const selectedAssets = selectedItemsArray.filter(
    (item) => item.type === "asset",
  );

  const hasFolders = selectedFolders.length > 0;
  const hasAssets = selectedAssets.length > 0;

  const getFolderData = (folderId: string) => {
    return assetsData.folders?.find((folder) => String(folder.id) === folderId);
  };

  const getAssetData = (assetId: string) => {
    return assetsData.assets?.find((asset) => String(asset.id) === assetId);
  };

  return (
    <ScrollArea className="w-full [&>[data-slot=scroll-area-viewport]]:max-h-80 [&>[data-slot=scroll-area-viewport]]:h-auto mb-5 border-y border-zinc-500/10">
      <div className="space-y-4 px-1 py-2">
        {hasFolders && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Folder className="size-4" />
              <span>Folders ({selectedFolders.length})</span>
            </div>
            <ul className="flex flex-wrap gap-2">
              {selectedFolders.map((folder) => {
                const folderData = getFolderData(folder.id);
                return (
                  <Badge
                    className="px-2 pr-1.5 py-1 flex items-center gap-2"
                    variant="embossed"
                    key={`folder-${folder.id}`}
                  >
                    {folderData?.name || `ID: ${folder.id}`}
                    <button
                      type="button"
                      aria-label={`Remove ${folderData?.name || `folder ${folder.id}`} from selection`}
                      className="rounded-sm bg-zinc-400/50 p-0.5 transition-colors hover:bg-zinc-400/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => deleteItemById(folder.id, "folder")}
                    >
                      <X className="size-3 text-white" aria-hidden />
                    </button>
                  </Badge>
                );
              })}
            </ul>
          </div>
        )}

        {hasAssets && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileIcon className="size-4" />
              <span>Assets ({selectedAssets.length})</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {selectedAssets.map((asset) => {
                const assetData = getAssetData(asset.id);
                return (
                  <AssetBlockMap
                    key={asset.id}
                    className="first:col-span-1 first:row-span-1"
                    type="asset"
                    variant="upload"
                    showCategory={false}
                    fileType={getFileType(assetData?.type ?? asset.fileType)}
                    name={assetData?.name || asset.name}
                    src={asset.src || assetData?.url || ""}
                    alt={asset.alt || assetData?.alt || asset.name}
                    extension={asset.extension}
                    duration={asset.duration}
                    onRemove={() => deleteItemById(asset.id, "asset")}
                  />
                );
              })}
            </div>
          </div>
        )}

        {!hasFolders && !hasAssets && (
          <div className="text-sm text-muted-foreground text-center py-4">
            No items selected
          </div>
        )}

        <input
          type="hidden"
          name="folderIds"
          value={JSON.stringify(selectedFolders.map((f) => f.id))}
        />
        <input
          type="hidden"
          name="assetIds"
          value={JSON.stringify(selectedAssets.map((a) => a.id))}
        />
      </div>
    </ScrollArea>
  );
};
