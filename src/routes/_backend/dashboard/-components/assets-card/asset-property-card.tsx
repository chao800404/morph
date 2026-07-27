import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";

import { useShallow } from "zustand/react/shallow";
import { CardWrapper } from "../card-wrapper";
import { AssetProperties } from "./asset-properties";
import { AssetPropertyEmptyCard } from "./asset-property-empty";
import { AssetPropertyHeader } from "./asset-property-header";
export const AssetPropertyCard = () => {
  const activeItem = useAssetsStore(
    useShallow((state) => state.activeItem),
  );

  if (!activeItem) return <AssetPropertyEmptyCard />;

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
        cardWrapper: "h-content flex flex-col overflow-hidden",
        contentWrapper: "flex flex-col min-h-0 flex-1 overflow-hidden",
      }}
    >
      <AssetProperties />
    </CardWrapper>
  );
};
