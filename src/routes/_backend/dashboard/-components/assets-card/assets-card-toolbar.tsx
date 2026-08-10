import type { AssetType } from "@/db/asset.schema";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableFilters,
  DataTableSearch,
  DataTableToolbar,
  type DataTableFilterDefinition,
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

const ASSET_SIZE_OPTIONS = [
  { value: "under-1mb", label: "Under 1 MB" },
  { value: "1mb-10mb", label: "1–10 MB" },
  { value: "over-10mb", label: "10 MB and above" },
] satisfies DataTableFilterOption<NonNullable<DashboardSearch["assetSize"]>>[];

const ASSET_CREATED_OPTIONS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] satisfies DataTableFilterOption<
  NonNullable<DashboardSearch["assetCreatedWithin"]>
>[];

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
  const setFilter = <
    TKey extends "assetSize" | "assetCreatedWithin",
  >(
    key: TKey,
    value: DashboardSearch[TKey],
  ) => {
    void navigate({
      to: ".",
      search: (previous: DashboardSearch) => ({
        ...previous,
        [key]: value,
        page: undefined,
      }),
      replace: true,
    });
  };
  const filters: DataTableFilterDefinition[] = [
    {
      key: "type",
      label: "Type",
      options: [...ASSET_TYPE_OPTIONS],
      values: search.assetType ? [search.assetType] : [],
      multiple: false,
      onValuesChange: (values) =>
        setAssetType(values.at(-1) as AssetType | undefined),
    },
    {
      key: "size",
      label: "Size",
      options: [...ASSET_SIZE_OPTIONS],
      values: search.assetSize ? [search.assetSize] : [],
      multiple: false,
      onValuesChange: (values) =>
        setFilter(
          "assetSize",
          values.at(-1) as DashboardSearch["assetSize"],
        ),
    },
    {
      key: "uploaded",
      label: "Uploaded",
      options: [...ASSET_CREATED_OPTIONS],
      values: search.assetCreatedWithin ? [search.assetCreatedWithin] : [],
      multiple: false,
      onValuesChange: (values) =>
        setFilter(
          "assetCreatedWithin",
          values.at(-1) as DashboardSearch["assetCreatedWithin"],
        ),
    },
  ];

  return (
    <DataTableToolbar
      className="border-t-0"
      leading={<DataTableFilters filters={filters} />}
      trailing={
        <>
          <DataTableSearch placeholder="Search" />
          <AssetTableSort />
        </>
      }
    />
  );
};
