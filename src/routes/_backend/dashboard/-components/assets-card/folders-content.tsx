import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  memo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";

const FOLDERS_HEIGHT_KEY = "morph_folders_height";
const DEFAULT_FOLDERS_HEIGHT = 208;
const MIN_FOLDERS_HEIGHT = 80;

function getMaxFoldersHeight(): number {
  if (typeof window === "undefined") return 550;
  return Math.max(200, window.innerHeight - 150);
}

function getSavedFoldersHeight(): number {
  if (typeof window === "undefined") return DEFAULT_FOLDERS_HEIGHT;
  try {
    const saved = localStorage.getItem(FOLDERS_HEIGHT_KEY);
    if (saved !== null) {
      const val = parseInt(saved, 10);
      const maxH = getMaxFoldersHeight();
      if (!isNaN(val) && val >= MIN_FOLDERS_HEIGHT) {
        return Math.min(val, maxH);
      }
    }
  } catch {}
  return DEFAULT_FOLDERS_HEIGHT;
}
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { deleteItems, moveItems, updateItems } from "@/server/asset";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { FluentFolderIcon } from "@/components/ui/icons/fluent-folder-icon";
import { MoreHorizontal } from "lucide-react";
import { ItemActionsMenu } from "./item-actions-menu";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { useMemo } from "react";
import TypeHeadClient from "./type-head";
interface FoldersContentProps {
  folders?: AssetFolder[];
  isCollapsed?: boolean;
  isAssetsCollapsed?: boolean;
  canCollapse?: boolean;
  evenSplitResetKey?: number;
  onToggleCollapse?: () => void;
  onSetFoldersCollapsed?: (collapsed: boolean) => void;
  onSetAssetsCollapsed?: (collapsed: boolean) => void;
}

type FoldersTypeHeadProps = {
  collapsible: boolean;
  isCollapsed: boolean;
  controlsId: string;
  onToggleCollapse?: () => void;
};

const FoldersTypeHead = memo(function FoldersTypeHead({
  collapsible,
  isCollapsed,
  controlsId,
  onToggleCollapse,
}: FoldersTypeHeadProps) {
  const selectedFoldersCount = useAssetsStore((state) => {
    let count = 0;
    for (const item of state.selectedItems.values()) {
      if (item.type === "folder") count += 1;
    }
    return count;
  });

  return (
    <TypeHeadClient
      title="Folders"
      size={selectedFoldersCount}
      collapsible={collapsible}
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
      controlsId={controlsId}
    />
  );
});

type FolderCardProps = {
  item: AssetFolder;
  onRedirect: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, name: string, description: string) => void;
  onMove: (id: string) => void;
  onDownload: (id: string) => void;
};

const FolderCard = memo(function FolderCard({
  item,
  onRedirect,
  onDelete,
  onEdit,
  onMove,
  onDownload,
}: FolderCardProps) {
  const id = String(item.id);
  const description = item.description || "";
  const { selected, toggleSelectItem, setActionMenuOpen } = useAssetsStore(
    useShallow((state) => ({
      selected: state.selectedItems.has(`folder-${id}`),
      toggleSelectItem: state.toggleSelectItem,
      setActionMenuOpen: state.setActionMenuOpen,
    })),
  );

  const dragData = useMemo(() => ({ name: item.name }), [item.name]);

  const { ref: dragRef, isDragging: isDraggableDragging } = useDraggable({
    id,
    type: "folder",
    data: dragData,
  });

  const { ref: dropRef, isDropTarget: isOver } = useDroppable({
    id,
    type: "folder",
  });

  const isItemDragging = useAssetsStore((state) =>
    state.isItemDragging(id, "folder"),
  );
  const isDragging = isDraggableDragging || isItemDragging;

  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      dragRef(node);
      dropRef(node);
    },
    [dragRef, dropRef],
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "asset-folder-card group relative flex cursor-pointer select-none flex-row items-center gap-3 rounded-lg border px-3 py-2.5 transition-[border-color,background-color,box-shadow,ring] duration-150",
        "bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-800/70 dark:to-zinc-900/80",
        "border-zinc-200 dark:border-white/8",
        "shadow-[0_2px_6px_-1px_rgba(0,0,0,0.05),inset_0_1px_0px_rgba(255,255,255,0.8)]",
        "dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.3),inset_0_1px_0px_rgba(255,255,255,0.08)]",
        "hover:border-zinc-300 dark:hover:border-white/18",
        selected &&
          "border-primary/40 bg-primary/5 dark:bg-primary/10 dark:border-primary/30 dark:from-primary/5 dark:to-primary/8",
        isDragging && "opacity-30 pointer-events-none",
        isOver &&
          "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/40 dark:border-blue-400 dark:bg-blue-500/20",
      )}
      data-selected={selected}
      data-dragging={isDragging}
      data-over={isOver}
      id={id}
      data-type="asset-folder"
      onDoubleClick={() => onRedirect(id)}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          toggleSelectItem({
            type: "folder",
            id,
            name: item.name,
            description: item.description || undefined,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            createdBy: item.createdBy,
            updatedBy: item.updatedBy,
            path: item.path || undefined,
            parentId: item.parentId,
            assetCount: item.assetCount,
            folderCount: item.folderCount,
            itemCount: item.itemCount,
          });
        }
      }}
    >
      <div
        className="relative h-8 w-8 shrink-0"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity duration-150",
            selected ? "opacity-0" : "opacity-100 group-hover:opacity-0",
          )}
        >
          <FluentFolderIcon className="h-8 w-8 drop-shadow-sm" />
        </div>
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity duration-150",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <Checkbox
            className="h-5.5 w-5.5 rounded-md border-2 scale-110 cursor-pointer shadow-sm transition-transform active:scale-95"
            checked={selected}
            onCheckedChange={() =>
              toggleSelectItem({
                type: "folder",
                id,
                name: item.name,
                description: item.description || undefined,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                createdBy: item.createdBy,
                updatedBy: item.updatedBy,
                path: item.path || undefined,
                parentId: item.parentId,
                assetCount: item.assetCount,
                folderCount: item.folderCount,
                itemCount: item.itemCount,
              })
            }
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">
          {item.name}
        </span>
        <span className="truncate text-[11px] text-zinc-600 dark:text-zinc-300">
          {description || `${item.name} folder`}
        </span>
      </div>

      <div
        className="shrink-0"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <ItemActionsMenu
          type="folder"
          onDelete={() => onDelete(id)}
          onEdit={() => onEdit(id, item.name, description)}
          onMove={() => onMove(id)}
          onDownload={() => onDownload(id)}
          onOpenChange={setActionMenuOpen}
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 rounded-md p-0 text-zinc-500 opacity-50 hover:bg-zinc-200/60 hover:text-zinc-900 group-hover:opacity-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </ItemActionsMenu>
      </div>
    </div>
  );
});

export const FoldersContent = memo(function FoldersContent({
  folders,
  isCollapsed: controlledIsCollapsed,
  isAssetsCollapsed = false,
  canCollapse = true,
  evenSplitResetKey = 0,
  onToggleCollapse,
  onSetFoldersCollapsed,
  onSetAssetsCollapsed,
}: FoldersContentProps) {
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 1280px)");
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

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const { clearAllSelectedItems } = useAssetsStore(
    useShallow((state) => ({
      clearAllSelectedItems: state.clearAllSelectedItems,
    })),
  );

  const handleDelete = useCallback(
    (id: string) => {
      const folder = folders?.find((item) => String(item.id) === id);
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
        onSuccess: clearAllSelectedItems,
      });
      setInfoOpen(true);
    },
    [clearAllSelectedItems, folders, setInfoData, setInfoOpen],
  );

  const handleEdit = useCallback(
    (id: string, name: string, description: string) => {
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
        onSuccess: clearAllSelectedItems,
      });
      handleEditOpenChange(true);
    },
    [
      clearAllSelectedItems,
      handleEditOpenChange,
      setAssetEditData,
    ],
  );

  const handleMove = useCallback(
    (id: string) => {
      const folder = folders?.find((item) => String(item.id) === id);
      const name = folder?.name || "Unknown Folder";

      setAssetMoveData({
        title: generateMoveTitle("folder", 1),
        description: generateMoveDescription("folder", 1),
        fields: generateMoveFields(),
        action: moveItems,
        excludedIds: [id],
        items: [{ id, type: "folder", name }],
        onSuccess: clearAllSelectedItems,
      });
      handleMoveOpenChange(true);
    },
    [
      clearAllSelectedItems,
      folders,
      handleMoveOpenChange,
      setAssetMoveData,
    ],
  );

  const handleDownload = useCallback(async (id: string) => {
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
  }, []);

  const contentId = useId();
  const sectionRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const isDraggingRef = useRef(false);
  const lastExpandedHeightRef = useRef(DEFAULT_FOLDERS_HEIGHT);
  const wasAssetsCollapsedRef = useRef(isAssetsCollapsed);
  const lastEvenSplitResetKeyRef = useRef(evenSplitResetKey);
  const [foldersHeight, setFoldersHeight] = useState(() =>
    getSavedFoldersHeight(),
  );
  const isCollapsed = controlledIsCollapsed ?? false;

  const getAvailableFoldersHeight = useCallback(() => {
    const contentHeight =
      sectionRef.current?.parentElement?.getBoundingClientRect().height;
    return contentHeight
      ? Math.max(MIN_FOLDERS_HEIGHT, contentHeight - 80)
      : getMaxFoldersHeight();
  }, []);

  // Restore the saved split before paint so opening the section does not flash at 208px.
  useLayoutEffect(() => {
    const maxHeight = getAvailableFoldersHeight();
    const savedHeight = Math.min(getSavedFoldersHeight(), maxHeight);
    lastExpandedHeightRef.current = savedHeight;
    setFoldersHeight(savedHeight);
  }, [getAvailableFoldersHeight]);

  // When Assets closes, Folders consumes all available content height.
  useLayoutEffect(() => {
    if (isDraggingRef.current) {
      wasAssetsCollapsedRef.current = isAssetsCollapsed;
      return;
    }

    if (isAssetsCollapsed) {
      setFoldersHeight(getAvailableFoldersHeight());
    } else if (wasAssetsCollapsedRef.current) {
      setFoldersHeight(lastExpandedHeightRef.current);
    }
    wasAssetsCollapsedRef.current = isAssetsCollapsed;
  }, [getAvailableFoldersHeight, isAssetsCollapsed]);

  // Resolve the 50/50 target before paint so opening never starts from the old height.
  useLayoutEffect(() => {
    if (lastEvenSplitResetKeyRef.current === evenSplitResetKey) return;

    lastEvenSplitResetKeyRef.current = evenSplitResetKey;
    const halfHeight = Math.max(
      MIN_FOLDERS_HEIGHT,
      Math.round(getAvailableFoldersHeight() / 2),
    );
    lastExpandedHeightRef.current = halfHeight;
    setFoldersHeight(halfHeight);
    try {
      localStorage.setItem(FOLDERS_HEIGHT_KEY, String(halfHeight));
    } catch {}
  }, [evenSplitResetKey, getAvailableFoldersHeight]);

  useEffect(
    () => () => {
      cleanupDragRef.current?.();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      const container = containerRef.current;
      const section = sectionRef.current;
      const contentRoot = section?.parentElement;
      if (!container || !section || !contentRoot) return;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      target.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const availableHeight = contentRoot.getBoundingClientRect().height;
      const availableBodyHeight = Math.max(
        MIN_FOLDERS_HEIGHT,
        availableHeight - 80,
      );
      const minimumPanelHeight = Math.min(
        MIN_FOLDERS_HEIGHT,
        Math.floor(availableBodyHeight / 2),
      );
      const maximumPanelHeight = Math.max(
        minimumPanelHeight,
        availableBodyHeight - minimumPanelHeight,
      );
      const startHeight = isCollapsed
        ? 0
        : isAssetsCollapsed
          ? availableBodyHeight
          : container.getBoundingClientRect().height;
      let latestHeight = startHeight;
      let didMove = false;
      let expandedForDrag = false;

      // Disable card hover effects while the browser is recalculating the split.
      isDraggingRef.current = true;
      section.dataset.resizing = "true";
      contentRoot.dataset.assetSplitResizing = "true";
      container.classList.add("pointer-events-none");
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const onPointerMove = (moveEvent: PointerEvent) => {
        didMove = true;
        if (!expandedForDrag && (isCollapsed || isAssetsCollapsed)) {
          onSetFoldersCollapsed?.(false);
          onSetAssetsCollapsed?.(false);
          expandedForDrag = true;
        }

        const deltaY = moveEvent.clientY - startY;
        const targetHeight = startHeight + deltaY;
        latestHeight = Math.min(
          Math.max(targetHeight, minimumPanelHeight),
          maximumPanelHeight,
        );

        if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.style.height = `${latestHeight}px`;
          }
          rafIdRef.current = null;
        });
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        if (target.hasPointerCapture(upEvent.pointerId)) {
          target.releasePointerCapture(upEvent.pointerId);
        }
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        if (didMove) {
          const finalHeight = Math.round(latestHeight);
          // Commit the last pointer coordinate synchronously. Otherwise the
          // canceled RAF leaves the DOM one frame behind and CSS animates the
          // divider to the React state after pointerup.
          container.style.height = `${finalHeight}px`;
          lastExpandedHeightRef.current = finalHeight;
          setFoldersHeight(finalHeight);
          try {
            localStorage.setItem(FOLDERS_HEIGHT_KEY, String(finalHeight));
          } catch {}
        }

        isDraggingRef.current = false;
        container.classList.remove("pointer-events-none");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        target.removeEventListener("pointermove", onPointerMove);
        target.removeEventListener("pointerup", onPointerUp);
        target.removeEventListener("pointercancel", onPointerUp);
        cleanupDragRef.current = null;

        if (didMove) {
          // Keep transitions disabled until React has committed the exact same
          // height, so releasing the pointer cannot produce a trailing motion.
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = requestAnimationFrame(() => {
              delete section.dataset.resizing;
              delete contentRoot.dataset.assetSplitResizing;
              rafIdRef.current = null;
            });
          });
        } else {
          delete section.dataset.resizing;
          delete contentRoot.dataset.assetSplitResizing;
        }
      };

      target.addEventListener("pointermove", onPointerMove);
      target.addEventListener("pointerup", onPointerUp);
      target.addEventListener("pointercancel", onPointerUp);

      cleanupDragRef.current = () => {
        isDraggingRef.current = false;
        container.classList.remove("pointer-events-none");
        delete section.dataset.resizing;
        delete contentRoot.dataset.assetSplitResizing;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        target.removeEventListener("pointermove", onPointerMove);
        target.removeEventListener("pointerup", onPointerUp);
        target.removeEventListener("pointercancel", onPointerUp);
      };
    },
    [
      isAssetsCollapsed,
      isCollapsed,
      onSetFoldersCollapsed,
      onSetAssetsCollapsed,
    ],
  );

  const handleRedirect = useCallback((id: string) => {
    navigate({
      to: "/dashboard/$slug",
      params: { slug: "assets" },
      search: (prev: any) => ({ ...prev, folderId: id }),
    });
  }, [navigate]);

  return (
    <div
      ref={sectionRef}
      className="relative shrink-0 border-b group/folders-section"
    >
      {folders && folders.length > 0 && (
        <>
          <FoldersTypeHead
            collapsible={canCollapse}
            isCollapsed={isCollapsed}
            onToggleCollapse={onToggleCollapse}
            controlsId={contentId}
          />
          <div
            data-asset-split-motion
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none",
              isCollapsed
                ? "pointer-events-none grid-rows-[0fr] opacity-0"
                : "grid-rows-[1fr] opacity-100",
            )}
          >
            <div
              id={contentId}
              aria-hidden={isCollapsed}
              className="min-h-0 overflow-hidden"
            >
              <div
                ref={containerRef}
                data-folders-scroll
                data-asset-split-motion
                className="overflow-y-auto transition-[height] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] [contain:layout_paint] motion-reduce:transition-none"
                style={{ height: `${foldersHeight}px` }}
              >
                <div
                  className="grid h-fit gap-2 px-6 pb-5"
                  style={{
                    gridTemplateColumns: isDesktop
                      ? "repeat(auto-fill, minmax(200px, 1fr))"
                      : "repeat(auto-fill, minmax(160px, 1fr))",
                  }}
                >
                  {folders?.map((item) => (
                    <FolderCard
                      key={item.id}
                      item={item}
                      onRedirect={handleRedirect}
                      onDelete={handleDelete}
                      onEdit={handleEdit}
                      onMove={handleMove}
                      onDownload={handleDownload}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Resizable Divider Drag Handle */}
          <div
            onPointerDown={handlePointerDown}
            role="separator"
            aria-label="Resize Folders and Assets"
            aria-orientation="horizontal"
            className="absolute -bottom-2 left-0 right-0 z-30 flex h-4 touch-none cursor-row-resize items-center justify-center group/resizer"
            title="Drag to resize folders area"
          >
            <div className="h-1 w-12 rounded-full bg-zinc-300 opacity-0 shadow-xs transition-[width,opacity,background-color] duration-150 group-hover/resizer:opacity-100 group-hover/folders-section:opacity-50 group-active/resizer:w-16 group-active/resizer:bg-primary group-active/resizer:opacity-100 motion-reduce:transition-none dark:bg-zinc-600" />
          </div>
        </>
      )}
    </div>
  );
});
