"use client";

import { moveItems } from "@/actions/asset/move-items";
import { DragDropProvider, DragOverlay, PointerSensor } from "@dnd-kit/react";

import { cn } from "@/lib/utils";
import { File, Folder } from "lucide-react";
import { AnimatePresence } from "motion/react";
import React from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useAssetsStore } from "../_stores/assets.store";

export const AssetDraggableProvider = ({ children }: { children: React.ReactNode }) => {
    const dragPreviewRef = React.useRef<HTMLDivElement>(null);
    const { selectedItems, setDragItem, dragItem, clearAllSelectedItems } = useAssetsStore(
        useShallow(state => ({
            selectedItems: state.selectedItems,
            setDragItem: state.setDragItem,
            dragItem: state.dragItem,
            clearAllSelectedItems: state.clearAllSelectedItems,
        }))
    );

    const draggingItems = React.useMemo(() => {
        const items = Array.from(selectedItems.values());
        if (items.length > 0) return items;
        return dragItem ? [dragItem] : [];
    }, [selectedItems, dragItem]);

    const counts = React.useMemo(() => {
        return {
            folders: draggingItems.filter(i => i.type === "folder").length,
            assets: draggingItems.filter(i => i.type === "asset").length,
        };
    }, [draggingItems]);

    const handleDragEnd = React.useCallback(
        async (event: any) => {
            setDragItem(undefined);
            if (event.canceled) return;

            const { target, source } = event.operation;

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

            if (!targetFolderId) return;

            // Get all item IDs to move
            const itemIds = draggingItems.map(item => item.id);

            if (itemIds.length === 0) return;

            // Check if target is in the items being moved
            if (targetFolderId && itemIds.includes(targetFolderId)) {
                return;
            }

            try {
                const formData = new FormData();
                formData.append("itemIds", JSON.stringify(itemIds));
                formData.append("Destination Folder", targetFolderId || "");

                const result = await moveItems(formData);

                if (result.data?.success) {
                    toast.success("Items moved successfully", {
                        description: result.data?.description,
                        position: "top-center",
                    });
                    clearAllSelectedItems();
                } else {
                    toast.error(result.data?.message || "Failed to move items", {
                        position: "top-center",
                    });
                }
            } catch (error) {
                console.error("Move error:", error);
                toast.error("Failed to move items", {
                    position: "top-center",
                });
            }
        },
        [draggingItems, setDragItem, clearAllSelectedItems]
    );

    return (
        <DragDropProvider
            sensors={[PointerSensor]}
            onBeforeDragStart={event => {
                const { source } = event.operation;

                if (!source) return;

                const sourceType = source.type as "folder" | "asset" | undefined;

                if (!sourceType) return;

                const name = source.data?.name;
                const id = `${source.id}`;

                if (sourceType === "folder") {
                    setDragItem({ type: "folder", id, name });
                } else if (sourceType === "asset") {
                    const fileType = source.data?.fileType || "file";
                    setDragItem({
                        type: "asset",
                        id,
                        name,
                        fileType,
                        src: source.data?.src,
                        extension: source.data?.extension,
                    });
                }
            }}
            onDragStart={event => {
                const { position } = event.operation;
                if (position) {
                    const x = position.current.x;
                    const y = position.current.y;

                    if (dragPreviewRef.current) {
                        dragPreviewRef.current.style.transform = `translate(${x}px, ${y}px)`;
                    }
                }
            }}
            onDragEnd={handleDragEnd}
            onDragMove={event => {
                const { x, y } = event.to || { x: 50, y: 50 };

                if (dragPreviewRef.current) {
                    dragPreviewRef.current.style.transform = `translate(${x}px, ${y}px)`;
                }
            }}
        >
            <AnimatePresence>
                {dragItem ? (
                    <div className="fixed top-0 left-0 z-50 pointer-events-none">
                        <div ref={dragPreviewRef} className="relative z-10">
                            <div
                                className={cn(
                                    "z-10 p-2 bg-card relative rounded-lg shadow-sm/20 w-fit cursor-grabbing",
                                    "dark:shadow-elevation-modal"
                                )}
                            >
                                <div className="flex items-center text-sm gap-3">
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
                                        .filter(item => item.id !== dragItem.id)
                                        .map((item, index) => (
                                            <div
                                                key={item.id}
                                                className="absolute rounded-lg shadow-sm/30 border w-full h-full z-0 bg-zinc-100 dark:bg-zinc-900"
                                                style={{
                                                    top: `${(index + 1) * 1.5}px`,
                                                    left: `${(index + 1) * 1.5}px`,
                                                }}
                                            >
                                                <p className="sr-only">{item.name}</p>
                                            </div>
                                        ))}
                                    <div className="absolute rounded-full w-5 h-5 -top-2.5 -right-2.5 flex items-center justify-center text-white bg-blue-400 dark:bg-zinc-500 z-20 text-xs">
                                        {selectedItems.size}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                ) : null}
            </AnimatePresence>

            <DragOverlay>
                <></>
            </DragOverlay>
            {children}
        </DragDropProvider>
    );
};
