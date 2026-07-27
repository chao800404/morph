import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useMediaQuery } from "@/hooks/use-media-query";
import { downloadAsset } from "@/lib/asset/download-utils";
// import { copyPath } from "@/lib/shared/copy-path";
import { cn } from "@/lib/utils";
import type { DashboardSortKey } from "@/lib/validations/dashboard-search";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { useAssetRouteActions } from "@/routes/_backend/dashboard/-views/global/contents/assets/hooks/use-asset-route-actions";
import {
  toSelectedAssetFromTable,
  type AssetTableItem,
} from "@/routes/_backend/dashboard/-views/global/contents/assets/asset-view-model";
import { deleteItems } from "@/server/asset/delete-items.serverFn";
import { toast } from "sonner";
import { memo, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { AssetTableRow } from "./asset-table-row";
import { useDataTableSort } from "../data-table-card/data-table-sort";

export interface AssetTableHead {
  label: string;
  sortKey?: DashboardSortKey;
  className?: string;
}

interface AssetsTableProps {
  tableHeads: AssetTableHead[];
  tableContent?: AssetTableItem[];
}

export const AssetsTable = memo(function AssetsTable({
  tableHeads,
  tableContent = [],
}: AssetsTableProps) {
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const { openPreview, openEdit } = useAssetRouteActions();
  const { sortBy, sortOrder, applySort } = useDataTableSort();

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const {
    toggleSelectItem,
    selectAllItems,
    selectedItems,
    clearAllSelectedItems,
  } = useAssetsStore(
    useShallow((state) => ({
      toggleSelectItem: state.toggleSelectItem,
      selectAllItems: state.selectAllItems,
      selectedItems: state.selectedItems,
      clearAllSelectedItems: state.clearAllSelectedItems,
    })),
  );

  const selectedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of selectedItems.values()) {
      if (item.type === "asset") ids.add(item.id);
    }
    return ids;
  }, [selectedItems]);

  const handleCheckedChange = useCallback(
    (id: string) => {
      const asset = tableContent.find((item) => item.id === id);
      if (!asset) return;

      toggleSelectItem(toSelectedAssetFromTable(asset));
    },
    [tableContent, toggleSelectItem],
  );

  // Calculate selection state for current page
  // Use tableContent directly as it is now the current page items
  const currentPageAssets = tableContent;
  const allCurrentPageSelected =
    currentPageAssets.length > 0 &&
    currentPageAssets.every((asset) => selectedAssetIds.has(asset.id));
  const someCurrentPageSelected =
    currentPageAssets.some((asset) => selectedAssetIds.has(asset.id)) &&
    !allCurrentPageSelected;
  const checkboxState: boolean | "indeterminate" = allCurrentPageSelected
    ? true
    : someCurrentPageSelected
      ? "indeterminate"
      : false;

  // Handle select all/deselect all for current page
  const handleSelectAllCurrentPage = useCallback(() => {
    if (allCurrentPageSelected) {
      const currentPageIds = new Set(
        currentPageAssets.map((asset) => asset.id),
      );
      selectAllItems(
        Array.from(selectedItems.values()).filter(
          (item) =>
            item.type !== "asset" || !currentPageIds.has(String(item.id)),
        ),
      );
    } else {
      // Select all on current page
      const existingItems = Array.from(selectedItems.values());
      const itemsToSelect = currentPageAssets.map(toSelectedAssetFromTable);
      selectAllItems([...existingItems, ...itemsToSelect]);
    }
  }, [
    allCurrentPageSelected,
    currentPageAssets,
    selectAllItems,
    selectedItems,
  ]);

  const handleEdit = useCallback(
    (id: string) => openEdit(id, "asset"),
    [openEdit],
  );
  const handleDownload = useCallback(async (id: string) => {
    toast.promise(
      downloadAsset({ ids: [id] }).then((result) => {
        if (!result.success) {
          throw new Error(result.message || "Failed to download folder");
        }
        return { message: result.message };
      }),
      {
        loading: "Preparing download...",
        success: (data) => data.message || "Download started",
        error: (err) => err.message || "Failed to download folder",
        position: "top-center",
      },
    );
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      const item = tableContent.find((asset) => asset.id === id);
      const name = item?.name || "this asset";

      setInfoData({
        title: "Delete Asset",
        description: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
        fields: [
          {
            type: "hidden",
            name: "assetIds",
            value: JSON.stringify([id]),
          },
        ],
        action: deleteItems,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: clearAllSelectedItems,
      });
      setInfoOpen(true);
    },
    [clearAllSelectedItems, setInfoData, setInfoOpen, tableContent],
  );

  const handlePreview = useCallback(
    (id: string) => openPreview(id),
    [openPreview],
  );

  const handleCopyURL = useCallback(
    async (id: string) => {
      const asset = tableContent.find((item) => item.id === id);
      if (!asset?.url) return;

      // await copyPath(asset.url, {
      //   onSuccess: () =>
      //     toast.success("Copied to clipboard", { position: "top-center" }),
      //   onError: () =>
      //     toast.error("Failed to copy to clipboard", {
      //       position: "top-center",
      //     }),
      // });
      navigator.clipboard
        .writeText(asset.url)
        .then(() => {
          toast.success("Copied to clipboard", { position: "top-center" });
        })
        .catch(() => {
          toast.error("Failed to copy to clipboard", {
            position: "top-center",
          });
        });
    },
    [tableContent],
  );

  const handleKeyDown = useCallback(
    (id: string, event: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleCheckedChange(id);
      } else if (event.key === " ") {
        event.preventDefault();
        handlePreview(id);
      }
    },
    [handleCheckedChange, handlePreview],
  );

  if (tableContent.length === 0) {
    return (
      <div className="px-6 py-8 text-center text-muted-foreground">
        <p>No assets found</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead
            className={cn(
              "pl-6 w-14 whitespace-nowrap sticky left-0 z-20",
              "group-data-[scrolled=true]:bg-accent",
              'after:content-[""] after:opacity-0 after:absolute after:top-0 after:left-0 after:right-0 after:bottom-0 after:border-r after:z-10 after:border-border',
              "group-data-[scrolled=true]:after:opacity-100",
            )}
          >
            <div className="flex items-center justify-start relative z-30">
              <Checkbox
                checked={checkboxState}
                isIndeterminate={someCurrentPageSelected}
                onCheckedChange={handleSelectAllCurrentPage}
              />
            </div>
          </TableHead>
          {tableHeads.map((head) => {
            const sortKey = head.sortKey;
            if (!sortKey) {
              return (
                <TableHead
                  key={head.label || "actions"}
                  className={cn("whitespace-nowrap", head.className)}
                >
                  {head.label}
                </TableHead>
              );
            }

            const isActiveSort = sortBy === sortKey;
            const activeDirection = isActiveSort ? sortOrder : undefined;
            const nextDirection = sortOrder === "asc" ? "desc" : "asc";

            return (
              <SortableTableHead
                key={head.label}
                sortLabel={head.label}
                direction={activeDirection}
                nextDirection={nextDirection}
                onSort={() => applySort(sortKey, nextDirection)}
                className={cn("whitespace-nowrap", head.className)}
              >
                {head.label}
              </SortableTableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tableContent.map((asset) => (
          <AssetTableRow
            {...asset}
            key={asset.id}
            checked={selectedAssetIds.has(asset.id)}
            isDraggableEnabled={isLargeScreen}
            onCheckedChange={handleCheckedChange}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onView={handlePreview}
            onDownload={handleDownload}
            onDoubleClick={handlePreview}
            onCopyURL={handleCopyURL}
            onKeyDown={handleKeyDown}
          />
        ))}
      </TableBody>
    </Table>
  );
});
