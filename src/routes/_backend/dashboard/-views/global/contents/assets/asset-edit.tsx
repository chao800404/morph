import { useCloseOnEscape } from "@/components/dialog/route-form-modal";
import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { getActionErrorMessage } from "@/lib/asset/action-result";
import {
  parseAssetEditSelection,
  serializeAssetEditSelection,
  type AssetEditSelectionItem,
} from "@/lib/asset/edit-selection";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { generateEditTitle } from "@/routes/_backend/dashboard/-views/features/asset/edit/edit-fields-utils";
import type { AssetEditItem } from "@/routes/_backend/dashboard/-views/features/asset/edit/asset-edit.types";
import { useAssetPostProcessStore } from "@/routes/_backend/dashboard/-views/features/asset/post-process/use-asset-post-process-store";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { updateItems } from "@/server/asset/update-items.serverFn";
import { assetQueries } from "@queries/asset.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AssetEditSurface } from "./component/asset-edit-surface";
import { toAssetEditItem } from "./asset-view-model";
import { useAssetsStore } from "./stores/assets.store";

const routeApi = getRouteApi("/_backend/dashboard/$slug/$id/edit");

const itemTypeOf = (item: AssetEditItem) => item.type;

export const AssetEdit = () => {
  const { id } = routeApi.useParams();
  const search = routeApi.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clearAllSelectedItems = useAssetsStore(
    (state) => state.clearAllSelectedItems,
  );
  const setPostProcessActiveItem = useAssetPostProcessStore(
    (state) => state.setActiveItem,
  );
  const { setInfoData, setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setInfoOpen: state.setOpen,
    })),
  );
  const [items, setItems] = useState<AssetEditItem[]>([]);
  const [initialItems, setInitialItems] = useState<AssetEditItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const initializedSelectionRef = useRef<string | null>(null);
  const closeRoute = useCallback(() => {
    void navigate({
      to: "/dashboard/$slug",
      params: { slug: "assets" },
      search: (previous: DashboardSearch) => ({
        ...previous,
        itemType: undefined,
        editItems: undefined,
        assetId: undefined,
        variant: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  const selection = useMemo(
    () =>
      search.itemType
        ? parseAssetEditSelection(search.editItems, {
            id,
            itemType: search.itemType,
          })
        : [],
    [id, search.editItems, search.itemType],
  );
  const selectionKey = useMemo(
    () => (selection.length > 0 ? serializeAssetEditSelection(selection) : ""),
    [selection],
  );
  const query = useQuery({
    ...assetQueries.items({ items: selection }),
    enabled: selection.length > 0,
  });

  useEffect(() => {
    if (
      !query.data?.success ||
      !query.data.data ||
      initializedSelectionRef.current === selectionKey
    ) {
      return;
    }

    const nextItems = query.data.data.map(toAssetEditItem);
    setItems(nextItems);
    setInitialItems(structuredClone(nextItems));
    initializedSelectionRef.current = selectionKey;
  }, [query.data, selectionKey]);

  const activeItem = useMemo(
    () => items.find((item) => item.id === id) ?? items[0],
    [id, items],
  );
  const isDirty = useMemo(
    () => JSON.stringify(items) !== JSON.stringify(initialItems),
    [initialItems, items],
  );
  const hasChanges = isDirty;

  const close = useCallback(() => {
    if (!hasChanges) {
      closeRoute();
      return;
    }

    setInfoData({
      title: "Unsaved Changes",
      description: "Discard the changes made to these items?",
      confirmLabel: "Discard",
      confirmVariant: "destructive",
      action: async () => ({ success: true, message: "" }),
      onSuccess: closeRoute,
    });
    setInfoOpen(true);
  }, [closeRoute, hasChanges, setInfoData, setInfoOpen]);

  useCloseOnEscape(close);

  const navigateToItem = useCallback(
    (
      item: AssetEditItem,
      nextSelection: AssetEditSelectionItem[] = selection,
    ) => {
      const editItems = serializeAssetEditSelection(nextSelection);
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "assets", id: item.id },
        search: (previous: DashboardSearch) => ({
          ...previous,
          itemType: itemTypeOf(item),
          editItems,
          assetId: undefined,
        }),
        replace: true,
      });
    },
    [navigate, selection],
  );

  const handleRemove = useCallback(
    (item: AssetEditItem) => {
      if (items.length <= 1) return;
      const removedIndex = items.findIndex(
        (candidate) => candidate.id === item.id,
      );
      const nextItems = items.filter((candidate) => candidate.id !== item.id);
      const nextInitialItems = initialItems.filter(
        (candidate) => candidate.id !== item.id,
      );
      const nextSelection = nextItems.map((candidate) => ({
        id: candidate.id,
        itemType: itemTypeOf(candidate),
      }));
      const nextSelectionKey = serializeAssetEditSelection(nextSelection);
      const nextActive =
        item.id === activeItem?.id
          ? nextItems[Math.min(Math.max(removedIndex, 0), nextItems.length - 1)]
          : activeItem;

      setItems(nextItems);
      setInitialItems(nextInitialItems);
      initializedSelectionRef.current = nextSelectionKey;
      if (nextActive) navigateToItem(nextActive, nextSelection);
    },
    [activeItem, initialItems, items, navigateToItem],
  );

  const handleFieldChange = useCallback(
    (name: string, value: string) => {
      if (!activeItem) return;
      const key = name === "Folder" ? "locationId" : name.toLowerCase();
      const nextValue = key === "locationId" && value === "root" ? null : value;
      setItems((current) =>
        current.map((item) =>
          item.id === activeItem.id
            ? ({ ...item, [key]: nextValue } as AssetEditItem)
            : item,
        ),
      );
    },
    [activeItem],
  );

  const handleProcessImage = useCallback(() => {
    if (
      !activeItem ||
      activeItem.type !== "asset" ||
      !activeItem.src ||
      activeItem.fileType !== "image"
    ) {
      return;
    }

    setPostProcessActiveItem({
      id: activeItem.id,
      name: activeItem.name,
      src: activeItem.src,
      fileType: activeItem.fileType,
      extension: activeItem.extension,
      size: activeItem.size,
      onUpdated: ({ src, size }) => {
        setItems((current) =>
          current.map((item) =>
            item.id === activeItem.id && item.type === "asset"
              ? { ...item, src, size }
              : item,
          ),
        );
        setInitialItems((current) =>
          current.map((item) =>
            item.id === activeItem.id && item.type === "asset"
              ? { ...item, src, size }
              : item,
          ),
        );
      },
    });
  }, [activeItem, setPostProcessActiveItem]);

  const handleSubmit = useCallback(async () => {
    if (items.length === 0) return;
    setIsSaving(true);
    const payload = new FormData();
    payload.set("itemsData", JSON.stringify(items));

    try {
      const result = await updateItems({ data: payload });
      if (!result.success) throw new Error(result.message);

      await queryClient.invalidateQueries({ queryKey: assetQueries.all() });
      clearAllSelectedItems();
      toast.success(result.message || "Items updated successfully", {
        position: "top-center",
      });
      closeRoute();
    } catch (error) {
      toast.error(getActionErrorMessage(error, "Failed to update items"), {
        position: "top-center",
      });
    } finally {
      setIsSaving(false);
    }
  }, [clearAllSelectedItems, closeRoute, items, queryClient]);

  if (!search.itemType || selection.length === 0) return <NotFound />;
  if (query.status === "pending" || items.length === 0) return <PageSpinner />;
  if (query.status === "error" || !query.data?.success || !query.data.data) {
    return <NotFound />;
  }

  return (
    <AssetEditSurface
      title={generateEditTitle(items[0].type, items.length)}
      items={items}
      activeItemId={activeItem?.id ?? items[0].id}
      hasChanges={hasChanges}
      isSaving={isSaving}
      onClose={close}
      onSubmit={handleSubmit}
      onActivate={navigateToItem}
      onRemove={handleRemove}
      onFieldChange={handleFieldChange}
      onProcessImage={handleProcessImage}
    />
  );
};
