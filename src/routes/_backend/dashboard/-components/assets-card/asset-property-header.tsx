import { Button } from "@/components/ui/button";
import { downloadAsset, downloadFolder } from "@/lib/asset/download-utils";
import {
  generateEditFields,
  generateEditTitle,
} from "@/routes/_backend/dashboard/-views/features/asset/edit/edit-fields-utils";
import type { EditItem } from "@/routes/_backend/dashboard/-views/features/asset/edit/use-asset-edit-store";
import { useAssetEditStore } from "@/routes/_backend/dashboard/-views/features/asset/edit/use-asset-edit-store";
import {
  generateMoveDescription,
  generateMoveFields,
  generateMoveTitle,
} from "@/routes/_backend/dashboard/-views/features/asset/move/move-fields-utils";
import { useAssetMoveStore } from "@/routes/_backend/dashboard/-views/features/asset/move/use-asset-move-store";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { deleteItems } from "@/server/asset/delete-items.serverFn";
import { moveItems } from "@/server/asset/move-items.serverFn";
import { updateItems } from "@/server/asset/update-items.serverFn";
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
  description,
  alt,
  caption,
  tags,
}: Props) => {
  // ... existing hooks

  const { handleEditOpenChange, setAssetEditData } = useAssetEditStore(
    useShallow((state) => ({
      handleEditOpenChange: state.handleOpenChange,
      setAssetEditData: state.setAssetEditData,
    })),
  );

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

  // ... existing handlers (handleDelete, etc.)
  const handleDelete = async () => {
    const formData = new FormData();
    if (type === "folder") {
      formData.append("folderIds", JSON.stringify([id]));
      formData.append("assetIds", JSON.stringify([]));
    } else {
      formData.append("folderIds", JSON.stringify([]));
      formData.append("assetIds", JSON.stringify([id]));
    }

    const result = await deleteItems({ data: formData });
    if (result.success) {
      clearAllSelectedItems();
      toast.success(result.message || `${type} deleted successfully`, {
        position: "top-center",
      });
    } else {
      toast.error(result.message || `Failed to delete ${type}`, {
        position: "top-center",
      });
    }
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
    const extension = name.split(".").pop()?.toLowerCase() || "";

    const item: EditItem =
      type === "folder"
        ? {
            id,
            type: "folder" as const,
            name,
            description,
          }
        : {
            id,
            type: "asset" as const,
            name,
            fileType: fileType || "unknown",
            extension,
            src: assetUrl || undefined,
            alt,
            caption,
            tags,
            size,
          };

    setAssetEditData({
      title: generateEditTitle(type, 1),
      description: "Modify item details",
      fields: generateEditFields(item),
      items: [item],
      action: updateItems,
      activeItemId: id,
      onSuccess: () => {
        clearAllSelectedItems();
      },
    });
    handleEditOpenChange(true);
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
