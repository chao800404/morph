import type { AssetType } from "@/db/asset.schema";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableFilter,
  DataTableSearch,
  DataTableToolbar,
  type DataTableFilterOption,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AssetTableSort } from "./asset-table-sort";

const ASSET_TYPE_OPTIONS = [
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "rive", label: "Rive" },
  { value: "model", label: "3D models" },
] satisfies DataTableFilterOption<AssetType>[];

export const AssetsCardToolbar = () => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as DashboardSearch;

  const setAssetType = (assetType: AssetType | undefined) => {
    void navigate({
      to: ".",
      search: (previous: DashboardSearch) => ({
        ...previous,
        assetType,
        page: undefined,
      }),
      replace: true,
    });
  };

  return (
    <DataTableToolbar
      className="border-t-0"
      leading={
        <DataTableFilter
          label="Add filter"
          filterLabel="Type"
          options={ASSET_TYPE_OPTIONS}
          value={search.assetType}
          onValueChange={setAssetType}
        />
      }
      trailing={
        <>
          <DataTableSearch placeholder="Search" />
          <AssetTableSort />
        </>
      }
    />
  );
};
