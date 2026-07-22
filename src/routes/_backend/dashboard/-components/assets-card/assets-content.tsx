import type { Asset } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/assets-card.types";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { useShallow } from "zustand/react/shallow";
import { AssetFooter } from "./asset-footer";
import { AssetsTable } from "./assets-table";
import TypeHeadClient from "./type-head";

type Props = {
  assets?: Asset[];
  pagination?: {
    page: number;
    limit: number;
    totalAssets: number;
    totalPages: number;
  };
};

export const AssetsContent = ({ assets, pagination }: Props) => {
  const { selectedItems, getSelectedByType } = useAssetsStore(
    useShallow((state) => ({
      selectedItems: state.selectedItems,
      getSelectedByType: state.getSelectedByType,
    })),
  );

  const selectedAssetsCount = getSelectedByType("asset").length;

  const tableHeads = [
    "Name",
    "Extension",
    "Size",
    "Created At",
    "Updated At",
    "",
  ];
  const tableContent = assets?.map((asset) => ({
    id: String(asset.id),
    name: asset.name,
    url: asset.url,
    type: asset.type,
    createdAt: asset.createdAt,
    size: asset.size,
    alt: asset.alt || undefined,
    caption: asset.caption || undefined,
    tags: asset.tags?.join(",") || undefined,
    extension: asset.extension,
    updatedAt: asset.updatedAt,
  }));

  if (!assets || assets.length === 0) {
    return null;
  }

  return (
    <div className="h-full">
      <TypeHeadClient title="Assets" size={selectedAssetsCount} />
      <AssetsTable
        tableHeads={tableHeads}
        tableContent={tableContent}
        pagination={pagination}
      />
      <AssetFooter pagination={pagination} />
    </div>
  );
};
