import { downloadAsset } from "@/lib/asset/download-utils";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  useInfoStore,
  type ServerAction,
} from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { deleteItems } from "@/server/asset/delete-items.serverFn";
import { assetQueries, normalizeAssetListParams } from "@queries/asset.queries";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type WheelEvent,
} from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { toPreviewAsset } from "../asset-view-model";
import { useAssetsStore } from "../stores/assets.store";
import { useAssetRouteActions } from "./use-asset-route-actions";

const routeApi = getRouteApi("/_backend/dashboard/$slug/view");

export const useAssetPreviewController = () => {
  const search = routeApi.useSearch();
  const navigate = useNavigate();
  const { openEdit } = useAssetRouteActions();
  const listParams = normalizeAssetListParams(search);
  const { data, status } = useQuery(assetQueries.list(listParams));
  const wheelLockRef = useRef(false);

  const clearAllSelectedItems = useAssetsStore(
    (state) => state.clearAllSelectedItems,
  );
  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const assets = useMemo(
    () => data?.data?.assets?.map(toPreviewAsset) ?? [],
    [data?.data?.assets],
  );

  const selectedIndex = useMemo(() => {
    const index = assets.findIndex((asset) => asset.id === search.assetId);
    return index >= 0 ? index : 0;
  }, [assets, search.assetId]);
  const currentAsset = assets[selectedIndex];

  const setCurrentAsset = useCallback(
    (assetId: string) =>
      void navigate({
        to: "/dashboard/$slug/view",
        params: { slug: "assets" },
        search: (previous: DashboardSearch) => ({
          ...previous,
          assetId,
          itemType: undefined,
        }),
        replace: true,
      }),
    [navigate],
  );

  const closePreview = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug",
        params: { slug: "assets" },
        search: (previous: DashboardSearch) => ({
          ...previous,
          assetId: undefined,
          itemType: undefined,
        }),
      }),
    [navigate],
  );

  const goToNext = useCallback(() => {
    if (assets.length === 0) return;
    setCurrentAsset(assets[(selectedIndex + 1) % assets.length].id);
  }, [assets, selectedIndex, setCurrentAsset]);

  const goToPrevious = useCallback(() => {
    if (assets.length === 0) return;
    const previousIndex =
      selectedIndex === 0 ? assets.length - 1 : selectedIndex - 1;
    setCurrentAsset(assets[previousIndex].id);
  }, [assets, selectedIndex, setCurrentAsset]);

  useEffect(() => {
    if (assets.length > 0 && currentAsset?.id !== search.assetId) {
      setCurrentAsset(currentAsset.id);
    }
  }, [assets.length, currentAsset?.id, search.assetId, setCurrentAsset]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPrevious();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePreview, goToNext, goToPrevious]);

  const handlePreviewWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (wheelLockRef.current || assets.length <= 1) return;

    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    if (Math.abs(delta) < 15) return;

    wheelLockRef.current = true;
    if (delta > 0) {
      goToNext();
    } else {
      goToPrevious();
    }
    window.setTimeout(() => {
      wheelLockRef.current = false;
    }, 250);
  };

  const handleDownload = useCallback(async () => {
    if (!currentAsset) return;
    toast.promise(
      downloadAsset({ ids: [currentAsset.id] }).then((result) => {
        if (!result.success) {
          throw new Error(result.message || "Failed to download asset");
        }
        return { message: result.message };
      }),
      {
        loading: "Preparing download...",
        success: (result) => result.message || "Download started",
        error: (error) => error.message || "Failed to download asset",
        position: "top-center",
      },
    );
  }, [currentAsset]);

  const handleDelete = useCallback(() => {
    if (!currentAsset) return;
    const nextAsset =
      assets[selectedIndex + 1] ?? assets[selectedIndex - 1] ?? undefined;

    setInfoData({
      title: "Delete Asset",
      description: `Are you sure you want to delete "${currentAsset.name}"? This action cannot be undone.`,
      fields: [
        {
          type: "hidden",
          name: "assetIds",
          value: JSON.stringify([currentAsset.id]),
        },
      ],
      action: deleteItems as unknown as ServerAction,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onSuccess: () => {
        clearAllSelectedItems();
        if (nextAsset) {
          setCurrentAsset(nextAsset.id);
        } else {
          closePreview();
        }
      },
    });
    setInfoOpen(true);
  }, [
    assets,
    clearAllSelectedItems,
    closePreview,
    currentAsset,
    selectedIndex,
    setCurrentAsset,
    setInfoData,
    setInfoOpen,
  ]);

  const handleEdit = useCallback(() => {
    if (currentAsset) openEdit(currentAsset.id, "asset");
  }, [currentAsset, openEdit]);

  return {
    assets,
    currentAsset,
    selectedIndex,
    status,
    errorMessage:
      status === "error" || data?.success === false
        ? data?.message || "No assets are available to preview."
        : undefined,
    closePreview,
    setCurrentAsset,
    goToNext,
    goToPrevious,
    handlePreviewWheel,
    handleDownload,
    handleDelete,
    handleEdit,
  };
};

export type AssetPreviewController = ReturnType<
  typeof useAssetPreviewController
>;
