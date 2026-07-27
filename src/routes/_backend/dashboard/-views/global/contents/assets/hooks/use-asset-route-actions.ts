import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  serializeAssetEditSelection,
  type AssetEditSelectionItem,
} from "@/lib/asset/edit-selection";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

export type AssetRouteItemType = "asset" | "folder";

export const useAssetRouteActions = () => {
  const navigate = useNavigate();

  const openPreview = useCallback(
    (id: string) =>
      void navigate({
        to: "/dashboard/$slug/view",
        params: { slug: "assets" },
        search: (previous: DashboardSearch) => ({
          ...previous,
          assetId: id,
          itemType: undefined,
          editItems: undefined,
          variant: undefined,
        }),
      }),
    [navigate],
  );

  const openEdit = useCallback(
    (id: string, itemType: AssetRouteItemType) => {
      const editItems = serializeAssetEditSelection([{ id, itemType }]);
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "assets", id },
        search: (previous: DashboardSearch) => ({
          ...previous,
          itemType,
          editItems,
          assetId: undefined,
          variant: undefined,
        }),
      });
    },
    [navigate],
  );

  const openEditItems = useCallback(
    (items: AssetEditSelectionItem[]) => {
      const first = items[0];
      if (!first) return;

      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "assets", id: first.id },
        search: (previous: DashboardSearch) => ({
          ...previous,
          itemType: first.itemType,
          editItems: serializeAssetEditSelection(items),
          assetId: undefined,
          variant: undefined,
        }),
      });
    },
    [navigate],
  );

  return { openPreview, openEdit, openEditItems };
};
