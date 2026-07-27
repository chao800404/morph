import { AssetBlockMap } from "@/components/asset/asset-block-map";
import { FluentFolderIcon } from "@/components/ui/icons/fluent-folder-icon";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn, formatBytes, formatDuration, getFileType } from "@/lib/utils";
import { useAssetRouteActions } from "@/routes/_backend/dashboard/-views/global/contents/assets/hooks/use-asset-route-actions";
import {
  useAssetsStore,
} from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { useShallow } from "zustand/react/shallow";

export const AssetProperties = () => {
  const { activeItem, assetsData } = useAssetsStore(
    useShallow((state) => ({
      activeItem: state.activeItem,
      assetsData: state.assetsData,
    })),
  );
  const { openPreview } = useAssetRouteActions();

  if (!activeItem) return null;

  const isAsset = activeItem.type === "asset";

  const isCurrentFolder =
    !isAsset &&
    assetsData.currentFolder &&
    String(assetsData.currentFolder.id) === String(activeItem.id);

  let itemsCount = "—";
  if (!isAsset) {
    if (activeItem.itemCount !== undefined) {
      itemsCount = `${activeItem.assetCount ?? 0} assets · ${activeItem.folderCount ?? 0} folders`;
    } else if (isCurrentFolder) {
      itemsCount = `${assetsData.assets?.length ?? 0} assets · ${assetsData.folders?.length ?? 0} folders`;
    }
  }

  // Always show Items row for folders
  const showItems = !isAsset;

  const properties = [
    {
      label: "Name",
      value: activeItem.name,
    },
    {
      label: "Type",
      value: isAsset ? activeItem.fileType || "Unknown" : "Folder",
    },
    ...(isAsset && activeItem.type === "asset"
      ? [
          {
            label: "Extension",
            value: activeItem.extension || "N/A",
          },
          {
            label: "Alt Text",
            value: activeItem.alt || "-",
          },
          {
            label: "Caption",
            value: activeItem.caption || "-",
          },
          {
            label: "Tags",
            value:
              activeItem.tags && activeItem.tags.length > 0
                ? activeItem.tags.join(", ")
                : "-",
          },
          ...(activeItem.duration
            ? [
                {
                  label: "Duration",
                  value: formatDuration(activeItem.duration),
                },
              ]
            : []),
          ...(activeItem.size
            ? [
                {
                  label: "Size",
                  value: formatBytes(activeItem.size),
                },
              ]
            : []),
          ...(activeItem.uploadedBy
            ? [
                {
                  label: "Uploaded By",
                  value: activeItem.uploadedBy,
                },
              ]
            : []),
        ]
      : [
          // Folder-specific fields
          {
            label: "Description",
            value: activeItem.description || "-",
          },
          ...(showItems
            ? [{ label: "Items", value: itemsCount }]
            : []),
          ...(activeItem.type === "folder" && activeItem.path
            ? [{ label: "Path", value: activeItem.path }]
            : []),
          ...(activeItem.type === "folder" && activeItem.createdBy
            ? [{ label: "Created By", value: activeItem.createdBy }]
            : []),
          ...(activeItem.type === "folder" && activeItem.updatedBy
            ? [{ label: "Updated By", value: activeItem.updatedBy }]
            : []),
        ]),
    ...(activeItem.createdAt
      ? [
          {
            label: "Created",
            value: activeItem.createdAt,
          },
        ]
      : []),
    ...(activeItem.updatedAt
      ? [
          {
            label: "Updated",
            value: activeItem.updatedAt,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="w-full h-44 flex items-center justify-center shrink-0">
        {isAsset && activeItem.type === "asset" ? (
          <button
            type="button"
            className="size-full overflow-hidden rounded-md border bg-muted"
            onClick={() => openPreview(activeItem.id)}
          >
            <AssetBlockMap
              type="asset"
              variant="property"
              name={activeItem.name}
              src={activeItem.src || ""}
              alt={activeItem.alt || activeItem.name}
              fileType={getFileType(activeItem.fileType)}
              extension={activeItem.extension}
              duration={activeItem.duration}
            />
          </button>
        ) : (
          <div className={cn(
            "size-full border rounded-md flex flex-col items-center justify-center gap-2.5",
            "bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-800/60 dark:to-zinc-900/80",
          )}>
            <FluentFolderIcon className="w-14 h-14 drop-shadow-md" />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 truncate max-w-[80%]">
              {activeItem.name}
            </span>
          </div>
        )}
      </div>
      <div
        id="propert-card-content"
        className="flex-1 min-h-0 flex flex-col [[&>[data-slot=scroll-area-viewport]]:flex [&>[data-slot=scroll-area-viewport]]flex-col"
      >
        <ScrollArea className="h-full flex-1 min-h-0 flex flex-col">
          <ScrollBar />
          {properties.map((item, index) => (
            <div
              key={index}
              className="grid items-start grid-cols-2 px-6 py-3 not-last:border-b"
            >
              <div className="text-sm text-muted-foreground tracking-wide">
                {item.label}
              </div>
              <div className={cn(
                "text-sm font-medium break-words",
                item.label === "Path" && "text-xs font-mono text-zinc-500 dark:text-zinc-400 break-all",
                item.label === "Items" && "text-xs text-zinc-600 dark:text-zinc-300",
              )}>
                {item.value}
              </div>
            </div>
          ))}
        </ScrollArea>
      </div>
    </div>
  );
};
