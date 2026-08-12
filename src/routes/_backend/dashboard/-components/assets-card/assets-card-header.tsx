"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FilePlusCornerIcon from "@/components/ui/icons/file-plus-corner-icon";
import type { AssetFolder } from "@/routes/_backend/dashboard/-views/global/contents/assets/assets.types";
import { useAssetRouteActions } from "@/routes/_backend/dashboard/-views/global/contents/assets/hooks/use-asset-route-actions";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { deleteItems } from "@/server/asset/delete-items.serverFn";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { AssetCreateVariant } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/asset-create.config";
import { cn } from "@/lib/utils";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FolderPlus, MoreHorizontal } from "lucide-react";
import { ItemActionsMenu } from "./item-actions-menu";

export const AssetsCardHeader = ({
  id,
  className,
  currentFolder,
}: {
  id?: string;
  className?: string;
  currentFolder?: AssetFolder;
}) => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const { openEdit } = useAssetRouteActions();
  const setInfoData = useInfoStore((state) => state.setInfoData);
  const setInfoOpen = useInfoStore((state) => state.setOpen);

  // Creating is a route, so the current folder rides along in the URL and the
  // create page is linkable.
  const openCreate = (variant: AssetCreateVariant) =>
    void navigate({
      to: "/dashboard/$slug/create",
      params: { slug: "assets" },
      search: { ...search, variant },
    });

  const deleteCurrentFolder = () => {
    if (!currentFolder) return;

    setInfoData({
      title: "Delete Folder",
      description: `Are you sure you want to delete "${currentFolder.name}"? This action cannot be undone.`,
      fields: [
        {
          type: "hidden",
          name: "folderIds",
          value: JSON.stringify([String(currentFolder.id)]),
        },
      ],
      action: deleteItems,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onSuccess: () =>
        void navigate({
          to: "/dashboard/$slug",
          params: { slug: "assets" },
          search: (previous: DashboardSearch) => ({
            ...previous,
            folderId: currentFolder.parentId ?? undefined,
            page: 1,
            assetId: undefined,
            itemType: undefined,
            editItems: undefined,
            variant: undefined,
          }),
        }),
    });
    setInfoOpen(true);
  };

  return (
    <div id={id} className={cn("flex items-center gap-2", className)}>
      {currentFolder ? (
        <ItemActionsMenu
          type="folder"
          onEdit={() => openEdit(String(currentFolder.id), "folder")}
          onDelete={deleteCurrentFolder}
        >
          <Button
            type="button"
            variant="cardHeader"
            size="xs"
            aria-label={`Folder actions for ${currentFolder.name}`}
          >
            <MoreHorizontal />
          </Button>
        </ItemActionsMenu>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="form" size="xs">
            Create
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => openCreate("folder")}>
            <FolderPlus className="size-4" />
            folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openCreate("upload")}>
            <FilePlusCornerIcon className="size-4" />
            assets
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
