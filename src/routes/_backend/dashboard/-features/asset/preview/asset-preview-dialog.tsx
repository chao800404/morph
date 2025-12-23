"use client";

import { deleteItems } from "@/actions/asset";
import { updateItems } from "@/actions/asset/update-items";
import { AssetBlockMap } from "@/app/(backend)/dashboard/_components/asset-preview/asset/asset-block-map";
import { DialogHeaderActions } from "@/app/(backend)/dashboard/_components/dialog/dialog-header-actions";
import {
    generateEditFields,
    generateEditTitle,
} from "@/app/(backend)/dashboard/_features/asset/edit/edit-fields-utils";
import { useAssetEditStore } from "@/app/(backend)/dashboard/_features/asset/edit/use-asset-edit-store";
import { useAssetPreviewStore } from "@/app/(backend)/dashboard/_features/asset/preview/use-asset-preview-store";
import { useInfoStore, type ServerAction } from "@/app/(backend)/dashboard/_features/global-info/use-info-store";
import { Button } from "@/components/ui/button";
import {
    Carousel,
    CarouselApi,
    CarouselContent,
    CarouselItem,
    CarouselNext,
    CarouselPrevious,
} from "@/components/ui/carousel";
import { DialogFooter } from "@/components/ui/dialog";
import { NextArrowIcon } from "@/components/ui/icons/next-arrow-icon";
import { PreviousArrowIcon } from "@/components/ui/icons/previous-arrow-icon";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { downloadAsset } from "@/lib/asset";
import { cn } from "@/lib/utils";
import { Download, Settings2, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useAssetsStore } from "../../../_views/global/contents/assets/_stores/assets.store";
import { useAssetPostProcessStore } from "../post-process/use-asset-post-process-store";

export const AssetPreviewDialog = () => {
    const [score, animate] = useAnimate();
    const {
        open,
        handleOpenChange,
        item,
        items: assets,
    } = useAssetPreviewStore(
        useShallow(state => ({
            open: state.open,
            handleOpenChange: state.handleOpenChange,
            item: state.item,
            items: state.items,
        }))
    );

    const { clearAllSelectedItems } = useAssetsStore(
        useShallow(state => ({
            clearAllSelectedItems: state.clearAllSelectedItems,
        }))
    );

    const { handleEditOpenChange, setAssetEditData, activeItemId, editOpen } = useAssetEditStore(
        useShallow(state => ({
            handleEditOpenChange: state.handleOpenChange,
            setAssetEditData: state.setAssetEditData,
            activeItemId: state.activeItemId,
            editOpen: state.open,
        }))
    );

    // Sync preview index with edit active item
    useEffect(() => {
        if (editOpen && activeItemId) {
            const index = assets.findIndex(a => a.id === activeItemId);
            if (index !== -1) {
                setDisplayIndex(index);
            }
        }
    }, [activeItemId, editOpen, assets]);

    const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
        useShallow(state => ({
            setInfoData: state.setInfoData,
            setOpen: state.setOpen,
        }))
    );

    // Carousel API
    const [carouselApi, setCarouselApi] = useState<CarouselApi>();

    // 根據當前 item 找到在 assets 中的索引
    const currentIndex = useMemo(() => {
        if (!item || !assets.length) return -1;
        return assets.findIndex(asset => asset.id === item.id);
    }, [item, assets]);

    // 本地狀態管理當前顯示的索引
    const [displayIndex, setDisplayIndex] = useState(currentIndex);

    // 當 item 或 currentIndex 改變時，更新 displayIndex
    useEffect(() => {
        if (currentIndex !== -1) {
            setDisplayIndex(currentIndex);
        }
    }, [currentIndex]);

    // 當 displayIndex 改變時，滾動 Carousel 到對應位置
    useEffect(() => {
        if (carouselApi && displayIndex !== -1) {
            carouselApi.scrollTo(displayIndex);
        }
    }, [displayIndex, carouselApi]);

    // 當前顯示的資產
    const currentAsset = useMemo(() => {
        if (displayIndex >= 0 && displayIndex < assets.length) {
            return assets[displayIndex];
        }
        return item;
    }, [displayIndex, assets, item]);

    // 導航函數
    const goToNext = () => {
        if (assets.length === 0) return;
        const nextIndex = (displayIndex + 1) % assets.length;
        setDisplayIndex(nextIndex);
    };

    const goToPrevious = () => {
        if (assets.length === 0) return;
        const prevIndex = displayIndex === 0 ? assets.length - 1 : displayIndex - 1;
        setDisplayIndex(prevIndex);
    };

    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") {
                e.preventDefault();
                goToNext();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                goToPrevious();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, displayIndex, assets.length]);

    const handleEdit = () => {
        if (!currentAsset || currentAsset.type !== "asset") return;

        setAssetEditData({
            title: generateEditTitle("asset", 1),
            description: "Modify asset information",
            fields: generateEditFields({
                id: currentAsset.id,
                type: "asset",
                name: currentAsset.name,
                fileType: currentAsset.fileType || "unknown",
                extension: currentAsset.extension,
                src: currentAsset.src,
                alt: currentAsset.alt,
                caption: currentAsset.caption,
                tags: currentAsset.tags?.join(", "),
            }),
            items: assets.map(asset => {
                if (asset.type === "folder") {
                    return {
                        id: asset.id,
                        type: "folder" as const,
                        name: asset.name,
                        description: asset.description,
                    };
                }
                return {
                    id: asset.id,
                    type: "asset" as const,
                    name: asset.name,
                    fileType: asset.fileType || "unknown",
                    extension: asset.extension,
                    src: asset.src,
                    alt: asset.alt,
                    caption: asset.caption,
                    tags: asset.tags?.join(", "),
                };
            }),
            activeItemId: currentAsset.id,
            action: updateItems,
            onSuccess: () => {
                clearAllSelectedItems();
            },
        });
        handleEditOpenChange(true);
    };

    const handleDownload = async () => {
        if (!currentAsset) return;
        toast.promise(
            downloadAsset({ ids: [currentAsset.id] }).then(result => {
                if (!result.success) {
                    throw new Error(result.message || "Failed to download asset");
                }
                return { message: result.message };
            }),
            {
                loading: "Preparing download...",
                success: data => data.message || "Download started",
                error: err => err.message || "Failed to download asset",
                position: "top-center",
            }
        );
    };

    const handleDelete = () => {
        if (!currentAsset) return;

        setInfoData({
            title: "Delete Asset",
            description: `Are you sure you want to delete "${currentAsset.name}"? This action cannot be undone.`,
            fields: [
                {
                    type: "hidden",
                    name: "assetIds",
                    value: JSON.stringify([currentAsset.id]),
                },
            ],
            action: deleteItems as unknown as ServerAction,
            confirmLabel: "Delete",
            confirmVariant: "destructive",
            onSuccess: () => {
                // If we delete the current asset, we should close the preview or move to next
                // For now, let's close the preview
                handleOpenChange(false);
                clearAllSelectedItems();
            },
        });
        setInfoOpen(true);
    };

    const { setActiveItem } = useAssetPostProcessStore(
        useShallow(state => ({
            setActiveItem: state.setActiveItem,
        }))
    );

    const handleProcess = () => {
        if (!currentAsset || currentAsset.type !== "asset") return;

        setActiveItem({
            id: currentAsset.id,
            name: currentAsset.name,
            src: currentAsset.src || "",
            fileType: currentAsset.fileType || "unknown",
            extension: currentAsset.extension,
            size: currentAsset.size,
        });
    };

    const handleChange = async (open: boolean) => {
        await animate(score.current, { opacity: [1, 0], y: [0, 20] }, { duration: 0.2 });
        handleOpenChange(open);
    };

    if (!currentAsset || currentAsset?.type !== "asset") {
        return null;
    }

    const hasMultipleItems = assets.length > 1;
    const hasPrevious = displayIndex > 0;
    const hasNext = displayIndex < assets.length - 1;

    return (
        <Sheet open={open} onOpenChange={handleChange}>
            <SheetContent
                showCloseButton={false}
                className={cn("bg-transparent border-0 p-2 shadow-none w-full", "sm:max-w-full")}
            >
                {open && currentAsset?.type === "asset" && (
                    <motion.div
                        className="shadow-sm/20 border flex flex-col bg-component h-full dark:shadow-elevation-modal rounded-lg"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        transition={{ type: "keyframes" }}
                        ref={score}
                    >
                        <DialogHeaderActions
                            onClose={() => handleChange(false)}
                            title={
                                <div className="text-sm flex items-center justify-center text-center text-muted-foreground gap-2">
                                    <span className="truncate max-w-md"> {currentAsset.name}</span>
                                    <Kbd>{currentAsset.extension}</Kbd>
                                </div>
                            }
                            actions={
                                <>
                                    <Button size="xs" variant="formDark" onClick={handleDelete}>
                                        <Trash2 className="size-3" />
                                    </Button>
                                    <Button size="xs" variant="formDark" onClick={handleDownload}>
                                        <Download className="size-3" />
                                    </Button>
                                    {currentAsset.type === "asset" && currentAsset.fileType === "image" && (
                                        <>
                                            <Button
                                                data-tooltip-id="asset-process-tooltip"
                                                data-tooltip-content="Process asset"
                                                size="xs"
                                                variant="formDark"
                                                onClick={handleProcess}
                                            >
                                                <Settings2 className="size-3" />
                                            </Button>
                                            <Tooltip
                                                place="bottom-end"
                                                style={{
                                                    backgroundColor: "var(--primary)",
                                                    color: "var(--background)",
                                                    fontSize: "12px",
                                                    boxShadow: "1px 1px 4px 0px rgba(0, 0, 0, 0.1)",
                                                    borderRadius: "5px",
                                                    padding: "4px 8px",
                                                }}
                                                id="asset-process-tooltip"
                                            />
                                        </>
                                    )}
                                    <Button size="xs" className="text-primary" variant="formDark" onClick={handleEdit}>
                                        Edit
                                    </Button>
                                </>
                            }
                        />
                        <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0 bg-linear-to-br from-zinc-900 to-black p-4 relative">
                            {/* 上一個按鈕 */}
                            {hasMultipleItems && hasPrevious && (
                                <Button
                                    variant="formDark"
                                    size="icon"
                                    className="absolute left-4 top-1/2 -translate-y-1/2 z-30 size-12 rounded-full bg-black/50 hover:bg-black/70 text-white"
                                    onClick={goToPrevious}
                                >
                                    <PreviousArrowIcon className="size-4" />
                                </Button>
                            )}

                            {/* 預覽內容 - 只有這裡有切換動畫 */}
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={currentAsset.id}
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ duration: 0.2 }}
                                    className="w-full h-full"
                                >
                                    <AssetBlockMap
                                        variant="preview"
                                        type="asset"
                                        fileType={currentAsset.fileType || "unsupported"}
                                        src={currentAsset.src || ""}
                                        alt={currentAsset.alt || currentAsset.name}
                                        name={currentAsset.name}
                                    />
                                </motion.div>
                            </AnimatePresence>

                            {/* 下一個按鈕 */}
                            {hasMultipleItems && hasNext && (
                                <Button
                                    variant="formDark"
                                    size="icon"
                                    className="absolute right-4 top-1/2 -translate-y-1/2 z-30 size-12 rounded-full bg-black/50 hover:bg-black/70 text-white"
                                    onClick={goToNext}
                                >
                                    <NextArrowIcon className="size-4" />
                                </Button>
                            )}
                        </div>
                        <DialogFooter
                            className={cn(
                                "h-fit border-t-[0.5px] border-ring/80 px-4 py-2 relative z-10",
                                "dark:shadow-elevation-modal dark:border-border/30"
                            )}
                        >
                            <div className="grid grid-cols-3 items-center w-full gap-4">
                                {/* 左側 - 空白佔位 */}
                                <div></div>

                                {/* 中間 - Carousel 置中 */}
                                <div className="flex justify-center">
                                    <Carousel
                                        setApi={setCarouselApi}
                                        opts={{
                                            align: "center",
                                            loop: false,
                                        }}
                                        className="w-fit max-w-sm mx-auto"
                                    >
                                        <CarouselContent className="-ml-2">
                                            {assets
                                                .filter(asset => asset.type === "asset")
                                                .map((asset, index) => {
                                                    if (asset.type !== "asset") return null;
                                                    return (
                                                        <CarouselItem
                                                            key={asset.id}
                                                            className="basis-8 not-last:pl-1.5"
                                                        >
                                                            <button
                                                                onClick={() => setDisplayIndex(index)}
                                                                className={cn(
                                                                    "relative w-fit h-full overflow-hidden cursor-pointer transition-all",
                                                                    displayIndex === index
                                                                        ? "opacity-100"
                                                                        : "opacity-20"
                                                                )}
                                                            >
                                                                <AssetBlockMap
                                                                    variant="sm"
                                                                    type="asset"
                                                                    fileType={asset.fileType}
                                                                    src={asset.src}
                                                                    alt={asset.alt || asset.name}
                                                                    extension={asset.extension}
                                                                />
                                                            </button>
                                                        </CarouselItem>
                                                    );
                                                })}
                                        </CarouselContent>
                                        <CarouselPrevious variant="none">
                                            <PreviousArrowIcon className="size-3" />
                                        </CarouselPrevious>
                                        <CarouselNext variant="none">
                                            <NextArrowIcon className="size-3" />
                                        </CarouselNext>
                                    </Carousel>
                                </div>

                                {/* 右側 - 導航提示 */}
                                <div className="flex items-center justify-end gap-2">
                                    {hasMultipleItems && (
                                        <div className="text-xs flex items-center gap-1">
                                            Navigation
                                            <Kbd className="bg-white border dark:bg-sidebar">←</Kbd>
                                            <Kbd className="bg-white border dark:bg-sidebar">→</Kbd>
                                            <span className="px-1 opacity-30">|</span>
                                        </div>
                                    )}
                                    {hasMultipleItems && (
                                        <span className="text-xs text-muted-foreground">
                                            {displayIndex + 1} / {assets.length}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </DialogFooter>
                    </motion.div>
                )}
            </SheetContent>
        </Sheet>
    );
};
