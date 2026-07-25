import { cn } from "@/lib/utils";
import { moveItems } from "@/server/asset";
import { useQueryClient } from "@tanstack/react-query";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { File, Folder } from "lucide-react";
import { AnimatePresence } from "motion/react";
import React from "react";
import { toast } from "sonner";
import { useAssetsStore } from "../stores/assets.store";


/**
 * dnd-kit does not publish standalone event types for these callbacks, so they
 * are derived from the provider's own props and stay in sync with the library.
 */
type DragDropProviderProps = React.ComponentProps<typeof DragDropProvider>;
type DragEventOf<TProp extends keyof DragDropProviderProps> =
  NonNullable<DragDropProviderProps[TProp]> extends (
    ...args: infer TArgs
  ) => unknown
    ? TArgs[0]
    : never;

const AssetDragPreview = ({
  dragPreviewRef,
}: {
  dragPreviewRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const selectedItems = useAssetsStore((state) => state.selectedItems);
  const dragItem = useAssetsStore((state) => state.dragItem);

  const draggingItems = React.useMemo(() => {
    const items = Array.from(selectedItems.values());
    if (items.length > 0) return items;
    return dragItem ? [dragItem] : [];
  }, [dragItem, selectedItems]);

  const counts = React.useMemo(
    () => ({
      folders: draggingItems.filter((item) => item.type === "folder").length,
      assets: draggingItems.filter((item) => item.type === "asset").length,
    }),
    [draggingItems],
  );

  return (
    <AnimatePresence>
      {dragItem ? (
        <div className="pointer-events-none fixed left-0 top-0 z-50">
          <div ref={dragPreviewRef} className="relative z-10">
            <div
              className={cn(
                "relative z-10 w-fit cursor-grabbing rounded-lg bg-card p-2 shadow-sm/20",
                "dark:shadow-elevation-modal",
              )}
            >
              <div className="flex items-center gap-3 text-sm">
                <span>Dragging</span>
                {counts.folders > 0 && (
                  <>
                    {counts.folders}
                    <Folder className="size-3" />
                  </>
                )}
                {counts.assets > 0 && (
                  <>
                    {counts.assets}
                    <File className="size-3" />
                  </>
                )}
              </div>
            </div>
            {selectedItems.size > 1 && (
              <>
                {Array.from(selectedItems.values())
                  .filter((item) => item.id !== dragItem.id)
                  .map((item, index) => (
                    <div
                      key={`${item.type}-${item.id}`}
                      className="absolute z-0 h-full w-full rounded-lg border bg-zinc-100 shadow-sm/30 dark:bg-zinc-900"
                      style={{
                        top: `${(index + 1) * 1.5}px`,
                        left: `${(index + 1) * 1.5}px`,
                      }}
                    >
                      <p className="sr-only">{item.name}</p>
                    </div>
                  ))}
                <div className="absolute -right-2.5 -top-2.5 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-blue-400 text-xs text-white dark:bg-zinc-500">
                  {selectedItems.size}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
};

export const AssetDraggableProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const queryClient = useQueryClient();
  const dragPreviewRef = React.useRef<HTMLDivElement>(null);

  const sensors = React.useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: [
          new PointerActivationConstraints.Distance({ value: 8 }),
        ],
      }),
    ],
    [],
  );

  const handleDragEnd = React.useCallback(
    async (event: DragEventOf<"onDragEnd">) => {
      const {
        selectedItems,
        dragItem,
        setDragItem,
        clearAllSelectedItems,
      } = useAssetsStore.getState();
      const selected = Array.from(selectedItems.values());
      const draggingItems =
        selected.length > 0 ? selected : dragItem ? [dragItem] : [];

      setDragItem(undefined);
      if (event.canceled) return;

      const { target } = event.operation;

      if (!target) return;

      // Determine target folder ID
      let targetFolderId: string | null = null;
      if (target.type === "folder") {
        targetFolderId = String(target.id);
      } else if (target.type === "root") {
        targetFolderId = null;
      } else {
        // Invalid drop target
        return;
      }

      // Get all item IDs to move
      const itemIds = draggingItems.map((item) => item.id);

      if (itemIds.length === 0) return;

      // Check if target is in the items being moved
      if (targetFolderId && itemIds.includes(targetFolderId)) {
        return;
      }

      try {
        const formData = new FormData();
        formData.append("itemIds", JSON.stringify(itemIds));
        formData.append("Destination Folder", targetFolderId || "");

        const result = await moveItems({ data: formData });

        if (result?.success) {
          toast.success("Items moved successfully", {
            description: result.message,
            position: "top-center",
          });
          clearAllSelectedItems();
          await queryClient.invalidateQueries({ queryKey: ["assets"] });
        } else {
          toast.error(result?.message || "Failed to move items", {
            position: "top-center",
          });
        }
      } catch (error) {
        console.error("Move error:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to move items",
          {
            position: "top-center",
          },
        );
      }
    },
    [queryClient],
  );

  const handleBeforeDragStart = React.useCallback((event: DragEventOf<"onBeforeDragStart">) => {
    const { source } = event.operation;
    if (!source) return;

    const sourceType = source.type as "folder" | "asset" | undefined;
    if (!sourceType) return;

    const name = source.data?.name;
    const id = `${source.id}`;
    const { setDragItem } = useAssetsStore.getState();

    if (sourceType === "folder") {
      setDragItem({ type: "folder", id, name });
      return;
    }

    const fileType = source.data?.fileType || "file";
    setDragItem({
      type: "asset",
      id,
      name,
      fileType,
      src: source.data?.src,
      extension: source.data?.extension,
    });
  }, []);

  const handleDragStart = React.useCallback((event: DragEventOf<"onDragStart">) => {
    const { position } = event.operation;
    if (!position || !dragPreviewRef.current) return;

    const { x, y } = position.current;
    dragPreviewRef.current.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  const handleDragMove = React.useCallback((event: DragEventOf<"onDragMove">) => {
    const { x, y } = event.to || { x: 50, y: 50 };
    if (dragPreviewRef.current) {
      dragPreviewRef.current.style.transform = `translate(${x}px, ${y}px)`;
    }
  }, []);

  return (
    <DragDropProvider
      sensors={sensors}
      onBeforeDragStart={handleBeforeDragStart}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragMove={handleDragMove}
    >
      <AssetDragPreview dragPreviewRef={dragPreviewRef} />

      <DragOverlay>
        <></>
      </DragOverlay>
      {children}
    </DragDropProvider>
  );
};
