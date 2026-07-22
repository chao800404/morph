import { useMediaQuery } from "@/hooks/use-media-query";
import { downloadFolder } from "@/lib/asset/download-utils";
import { useAssetEditStore } from "@/routes/_backend/dashboard/-views/features/asset/edit/use-asset-edit-store";
import {
  generateMoveDescription,
  generateMoveFields,
  generateMoveTitle,
} from "@/routes/_backend/dashboard/-views/features/asset/move/move-fields-utils";
import { useAssetMoveStore } from "@/routes/_backend/dashboard/-views/features/asset/move/use-asset-move-store";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import type { AssetFolder } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/assets-card.types";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { deleteItems } from "@/server/asset/delete-items.serverFn";
import { moveItems } from "@/server/asset/move-items.serverFn";
import { updateItems } from "@/server/asset/update-items.serverFn";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
// import { FolderItem } from "../../../folder-item/folder-item";
import TypeHeadClient from "./type-head";

export const FoldersContent = ({ folders }: { folders?: AssetFolder[] }) => {
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 1280px)");
  const { handleEditOpenChange, setAssetEditData, setEditOpen } =
    useAssetEditStore(
      useShallow((state) => ({
        handleEditOpenChange: state.handleOpenChange,
        setAssetEditData: state.setAssetEditData,
        setEditOpen: state.setOpen,
      })),
    );

  const { handleMoveOpenChange, setAssetMoveData } = useAssetMoveStore(
    useShallow((state) => ({
      handleMoveOpenChange: state.handleOpenChange,
      setAssetMoveData: state.setAssetMoveData,
    })),
  );

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const {
    toggleSelectItem,
    isSelected,
    clearAllSelectedItems,
    setActionMenuOpen,
  } = useAssetsStore(
    useShallow((state) => ({
      toggleSelectItem: state.toggleSelectItem,
      isSelected: state.isSelected,
      clearAllSelectedItems: state.clearAllSelectedItems,
      setActionMenuOpen: state.setActionMenuOpen,
    })),
  );
  const selectedFoldersCount = useAssetsStore(
    (state) => state.getSelectedByType("folder").length,
  );

  const handleCheckedChange = (
    id: string,
    name: string,
    description: string,
  ) => {
    toggleSelectItem({ type: "folder", id, name, description });
  };

  const handleDelete = (id: string) => {
    const folder = folders?.find((f) => f.id === id);
    const folderName = folder?.name || "this folder";

    setInfoData({
      title: "Delete Folder",
      description: `Are you sure you want to delete "${folderName}"? This action cannot be undone.`,
      fields: [
        {
          type: "hidden",
          name: "folderIds",
          value: JSON.stringify([id]),
        },
      ],
      action: deleteItems,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onSuccess: () => {
        clearAllSelectedItems();
      },
    });
    setInfoOpen(true);
  };

  const handleEdit = (id: string, name: string, description: string) => {
    setAssetEditData({
      title: "Edit Folder",
      description: "Modify folder information",
      fields: [
        {
          name: "Name",
          type: "input",
          value: name || "",
        },
        {
          name: "Description",
          type: "textarea",
          value: description || "",
        },
      ],
      items: [{ id, type: "folder", name, description }],
      action: updateItems,
      onSuccess: () => {
        clearAllSelectedItems();
      },
    });
    handleEditOpenChange(true);
  };

  const handleMove = (id: string) => {
    const folder = folders?.find((f) => f.id === id);
    const name = folder?.name || "Unknown Folder";

    setAssetMoveData({
      title: generateMoveTitle("folder", 1),
      description: generateMoveDescription("folder", 1),
      fields: generateMoveFields(),
      action: moveItems,
      excludedIds: [id],
      items: [{ id, type: "folder", name }],
      onSuccess: () => {
        clearAllSelectedItems();
      },
    });
    handleMoveOpenChange(true);
  };

  const handleDownload = async (id: string) => {
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

  const handleRedirect = (id: string) => {
    navigate({
      to: "/dashboard/$slug",
      params: { slug: "assets" },
      search: (prev: any) => ({ ...prev, folderId: id }),
    });
  };

  return (
    <div className="h-full border-b">
      {folders && folders.length > 0 && (
        <>
          <TypeHeadClient title="Folders" size={selectedFoldersCount} />
          <div
            className="grid h-fit gap-3 px-6 pb-4"
            style={{
              gridTemplateColumns: isDesktop
                ? "repeat(auto-fill, minmax(160px, 1fr))"
                : "repeat(auto-fill, minmax(145px, 1fr))",
            }}
          >
            {folders?.map((item) => (
              // <FolderItem
              //   key={item.id}
              //   id={`${item.id}`}
              //   name={item.name}
              //   description={item.description}
              //   empty={item.empty}
              //   checked={isSelected(`${item.id}`)}
              //   onCheckedChange={() =>
              //     handleCheckedChange(
              //       `${item.id}`,
              //       item.name,
              //       item.description || "",
              //     )
              //   }
              //   onDelete={() => handleDelete(`${item.id}`)}
              //   onEdit={() =>
              //     handleEdit(`${item.id}`, item.name, item.description || "")
              //   }
              //   onMove={() => handleMove(`${item.id}`)}
              //   onDownload={() => handleDownload(`${item.id}`)}
              //   onDoubleClick={() => isDesktop && handleRedirect(`${item.id}`)}
              //   onClick={() => !isDesktop && handleRedirect(`${item.id}`)}
              //   onOpenChange={(open) => {
              //     setActionMenuOpen(open);
              //     if (open) {
              //       clearAllSelectedItems();
              //       handleCheckedChange(
              //         `${item.id}`,
              //         item.name,
              //         item.description || "",
              //       );
              //     } else {
              //       clearAllSelectedItems();
              //     }
              //   }}
              // />
              <div
                key={item.id}
                className="p-4 border rounded-md flex justify-between items-center bg-card"
              >
                <div className="font-medium">{item.name}</div>
                <button
                  className="text-sm underline"
                  onClick={() => handleRedirect(`${item.id}`)}
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
