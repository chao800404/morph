import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";

import { CircleQuestionIcon } from "@/components/ui/icons/circle-question-icon";
import { Tooltip } from "react-tooltip";
import { useShallow } from "zustand/react/shallow";
import { CardWrapper } from "../card-wrapper";
import { AssetProperties } from "./asset-properties";
import { AssetPropertyHeader } from "./asset-property-header";

export const AssetPropertyCard = () => {
  const activeItem = useAssetsStore(useShallow((state) => state.activeItem));

  if (!activeItem) {
    return (
      <CardWrapper id="card-property" label="Properties">
        <div className="text-sm text-muted-foreground px-6 py-4 flex items-center gap-2">
          <div
            data-tooltip-id="property-tooltip"
            data-tooltip-content="Select an item to view properties."
            className="flex items-center gap-2"
          >
            <CircleQuestionIcon className="size-4" />
          </div>
          <Tooltip
            style={{
              maxWidth: "120px",
              backgroundColor: "var(--primary)",
              color: "var(--background)",
              fontSize: "12px",
              boxShadow: "1px 1px 4px 0px rgba(0, 0, 0, 0.1)",
              borderRadius: "5px",
              padding: "4px 8px",
            }}
            id="property-tooltip"
            place="top"
            role="tooltip"
          />
          <p> No item selected</p>
        </div>
      </CardWrapper>
    );
  }

  const isAsset = activeItem.type === "asset";

  return (
    <CardWrapper
      id="card-property"
      headerButton={
        <AssetPropertyHeader
          type={isAsset ? "asset" : "folder"}
          id={activeItem.id}
          assetUrl={
            isAsset && activeItem.type === "asset" ? activeItem.src : undefined
          }
          name={activeItem.name}
          fileType={
            isAsset && activeItem.type === "asset"
              ? activeItem.fileType
              : undefined
          }
          size={
            isAsset && activeItem.type === "asset" ? activeItem.size : undefined
          }
          description={
            !isAsset && activeItem.type === "folder"
              ? activeItem.description
              : undefined
          }
          alt={
            isAsset && activeItem.type === "asset" ? activeItem.alt : undefined
          }
          caption={
            isAsset && activeItem.type === "asset"
              ? activeItem.caption
              : undefined
          }
          tags={
            isAsset && activeItem.type === "asset"
              ? activeItem.tags?.join(", ")
              : undefined
          }
        />
      }
      label="Properties"
      classNames={{
        cardWrapper: "h-[calc(100vh-4.75rem)] flex flex-col overflow-hidden",
        contentWrapper: "flex flex-col min-h-0 flex-1 overflow-hidden",
      }}
    >
      <AssetProperties />
    </CardWrapper>
  );
};
