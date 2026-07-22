// import { AssetBlockMap } from "@/app/(backend)/dashboard/_components/asset-preview/asset/asset-block-map";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { formatBytes, formatDuration } from "@/lib/utils";
import { useAssetPreviewStore } from "@/routes/_backend/dashboard/-views/features/asset/preview/use-asset-preview-store";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { useShallow } from "zustand/react/shallow";

export const AssetProperties = () => {
  const activeItem = useAssetsStore(useShallow((state) => state.activeItem));
  const { setToggleOpen, setPreviewData } = useAssetPreviewStore(
    useShallow((state) => ({
      setPreviewData: state.setAssetPreviewData,
      setToggleOpen: state.toggleOpen,
    })),
  );

  if (!activeItem) return null;

  const isAsset = activeItem.type === "asset";

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
          {
            label: "Description",
            value: activeItem.description || "-",
          },
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
          <div className="size-full bg-muted border rounded-md flex items-center justify-center p-4">
            <span className="text-xs text-muted-foreground break-all text-center">
              {activeItem.name}
            </span>
          </div>
        ) : (
          <div className="size-full bg-muted border rounded-md flex items-center justify-center p-4">
            <span className="text-xs text-muted-foreground">Folder</span>
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
              className="grid items-center grid-cols-2 px-6 py-3 not-last:border-b"
            >
              <div className="text-sm text-muted-foreground tracking-wide">
                {item.label}
              </div>
              <div className="text-sm font-medium break-words">
                {item.value}
              </div>
            </div>
          ))}
        </ScrollArea>
      </div>
    </div>
  );
};
