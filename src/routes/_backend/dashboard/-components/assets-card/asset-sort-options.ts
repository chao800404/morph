import type { DashboardSortKey } from "@/lib/validations/dashboard-search";

export interface AssetSortOption {
  value: DashboardSortKey;
  label: string;
}

export const ASSET_SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "extension", label: "Extension" },
  { value: "size", label: "Size" },
  { value: "createdAt", label: "Created At" },
  { value: "updatedAt", label: "Updated At" },
] satisfies AssetSortOption[];
