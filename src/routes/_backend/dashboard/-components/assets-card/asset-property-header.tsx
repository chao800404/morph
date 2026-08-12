import { Button } from "@/components/ui/button";
import { downloadAsset, downloadFolder } from "@/lib/asset/download-utils";
import {
  generateMoveDescription,
  generateMoveFields,
  generateMoveTitle,
} from "@/routes/_backend/dashboard/-views/features/asset/move/move-fields-utils";
import { useAssetMoveStore } from "@/routes/_backend/dashboard/-views/features/asset/move/use-asset-move-store";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { useAssetRouteActions } from "@/routes/_backend/dashboard/-views/global/contents/assets/hooks/use-asset-route-actions";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { deleteItems } from "@/server/asset/delete-items.serverFn";
import { moveItems } from "@/server/asset/move-items.serverFn";
// import { copyPath } from "@/lib/shared/copy-path";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ItemActionsMenu } from "./item-actions-menu";

type Props = {
  // ... existed
  assetUrl?: string | null | false;
  id: string;
  type: "folder" | "asset";
  name: string;
  fileType?: string;
  size?: number;
  description?: string;
  alt?: string;
  caption?: string;
  tags?: string;
};

export const AssetPropertyHeader = ({
  assetUrl,
  id,
  type,
  name,
  fileType,
  size,
  alt,
}: Props) => {
  const { openEdit } = useAssetRouteActions();

  const { handleMoveOpenChange, setAssetMoveData } = useAssetMoveStore(
    useShallow((state) => ({
      handleMoveOpenChange: state.handleOpenChange,
      setAssetMoveData: state.setAssetMoveData,
    })),
  );

  const { clearAllSelectedItems } = useAssetsStore(
    useShallow((state) => ({
      clearAllSelectedItems: state.clearAllSelectedItems,
    })),
  );

  const { setInfoData, setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setInfoOpen: state.setOpen,
    })),
  );

  // ... existing handlers (handleDelete, etc.)
  const handleDelete = () => {
    setInfoData({
      title: type === "folder" ? "Delete Folder" : "Delete Asset",
      description: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      fields: [
        {
          type: "hidden",
          name: type === "folder" ? "folderIds" : "assetIds",
          value: JSON.stringify([id]),
        },
      ],
      action: deleteItems,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onSuccess: clearAllSelectedItems,
    });
    setInfoOpen(true);
  };

  const handleCopyLink = async () => {
    if (assetUrl) {
      // await copyPath(assetUrl, {
      //     onSuccess: () => toast.success("Link copied to clipboard", { position: "top-center" }),
      //     onError: () => toast.error("Failed to copy link", { position: "top-center" }),
      // });
      navigator.clipboard
        .writeText(assetUrl)
        .then(() => {
          toast.success("Link copied to clipboard", { position: "top-center" });
        })
        .catch(() => {
          toast.error("Failed to copy link", { position: "top-center" });
        });
    }
  };

  const handleDownloadFolder = async () => {
    toast.promise(
      downloadFolder({ ids: [id] }).then((result) => {
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
  };

  const handleDownloadAsset = async () => {
    toast.promise(
      downloadAsset({ ids: [id] }).then((result) => {
        if (!result.success) {
          throw new Error(result.message || "Failed to download asset");
        }
        return { message: result.message };
      }),
      {
        loading: "Preparing download...",
        success: (data) => data.message || "Download started",
        error: (err) => err.message || "Failed to download asset",
        position: "top-center",
      },
    );
  };

  const handleMove = () => {
    const extension =
      type === "asset" ? name.split(".").pop()?.toLowerCase() || "" : undefined;

    setAssetMoveData({
      title: generateMoveTitle(type, 1),
      description: generateMoveDescription(type, 1),
      fields: generateMoveFields(),
      action: moveItems,
      excludedIds: type === "folder" ? [id] : [],
      items: [
        type === "folder"
          ? { id, type: "folder", name }
          : {
              id,
              type: "asset",
              name,
              fileType: fileType || "unknown",
              extension,
              src: assetUrl || undefined,
              alt: alt,
              size,
            },
      ],
      onSuccess: () => {
        clearAllSelectedItems();
      },
    });
    handleMoveOpenChange(true);
  };

  const handleEdit = () => {
    openEdit(id, type);
  };

  return (
    <div className="flex gap-2 items-center">
      <ItemActionsMenu
        onDelete={handleDelete}
        type={type}
        onEdit={handleEdit}
        onCopyURL={type === "asset" ? handleCopyLink : undefined}
        onDownload={() => {
          if (type === "folder") {
            handleDownloadFolder();
          } else {
            handleDownloadAsset();
          }
        }}
        onMove={handleMove}
      >
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="size-4" />
        </Button>
      </ItemActionsMenu>
    </div>
  );
};
