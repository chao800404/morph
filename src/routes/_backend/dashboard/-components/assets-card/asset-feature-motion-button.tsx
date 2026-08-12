import { Button } from "@/components/ui/button";
import { MoveFolderIcon } from "@/components/ui/icons/move-folder-icon";
import { downloadAsset } from "@/lib/asset/download-utils";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { deleteItems } from "@/server/asset/delete-items.serverFn";
import { moveItems } from "@/server/asset/move-items.serverFn";
import { Download, Edit, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  generateMoveDescription,
  generateMoveFields,
  generateMoveTitle,
} from "../../-views/features/asset/move/move-fields-utils";
import { useAssetMoveStore } from "../../-views/features/asset/move/use-asset-move-store";
import { useAssetRouteActions } from "../../-views/global/contents/assets/hooks/use-asset-route-actions";

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

export const AssetFeatureMotionButton = ({
  assetUrl,
  id,
  type,
  name,
  fileType,
  size,
  alt,
}: Props) => {
  const [open, setOpen] = useState(false);
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
    <motion.div
      layout
      initial={false}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="bg-card p-1 rounded-full shadow-elevation-modal flex flex-row-reverse items-center overflow-hidden h-12"
    >
      <motion.button
        type="button"
        aria-label={open ? "Close asset actions" : "Open asset actions"}
        aria-expanded={open}
        whileTap={{ scale: 0.9 }}
        onClick={() => setOpen(!open)}
        className="size-10 flex items-center justify-center rounded-full hover:bg-muted/50 transition-colors shrink-0"
      >
        <motion.div
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <Plus className="size-4 text-zinc-600" />
        </motion.div>
      </motion.button>
      <AnimatePresence mode="popLayout" initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15, delay: 0.05 }}
            className="flex items-center gap-1 overflow-hidden whitespace-nowrap"
          >
            <div className="w-2" />
            <Button
              variant="none"
              size="icon"
              aria-label={`Delete ${name}`}
              className="rounded-full shrink-0"
              onClick={handleDelete}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
            <Button
              variant="none"
              size="icon"
              aria-label={`Download ${name}`}
              className="rounded-full shrink-0"
              onClick={handleDownloadAsset}
            >
              <Download className="size-4" />
            </Button>
            <Button
              variant="none"
              size="icon"
              aria-label={`Move ${name}`}
              className="rounded-full shrink-0"
              onClick={handleMove}
            >
              <MoveFolderIcon className="size-4" />
            </Button>
            <Button
              variant="none"
              size="icon"
              aria-label={`Edit ${name}`}
              className="rounded-full shrink-0"
              onClick={handleEdit}
            >
              <Edit className="size-4" />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
