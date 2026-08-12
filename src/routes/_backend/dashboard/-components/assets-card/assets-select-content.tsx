import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { FileIcon, Folder, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
// import { AssetBlockMap } from "../../../asset-preview/asset/asset-block-map";

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
                  // <AssetBlockMap
                  //     key={index}
                  //     className="first:col-span-1"
                  //     type="asset"
                  //     variant="upload"
                  //     fileType={asset.fileType}
                  //     name={assetData?.name || asset.name}
                  //     src={assetData?.url || asset.src || ""}
                  //     alt={assetData?.alt || asset.alt || ""}
                  //     extension={asset.extension}
                  //     onRemove={() => deleteItemById(asset.id, "asset")}
                  // />
                  <div
                    key={asset.id}
                    className="group relative flex aspect-square flex-col items-center justify-center rounded-md border bg-muted p-2 text-xs"
                  >
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      aria-label={`Remove ${assetData?.name || asset.name} from selection`}
                      className="absolute right-1 top-1 size-6 rounded-full opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      onClick={() => deleteItemById(asset.id, "asset")}
                    >
                      <X className="size-3" aria-hidden />
                    </Button>
                    <span className="truncate w-full text-center">
                      {assetData?.name || asset.name}
                    </span>
                  </div>
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
