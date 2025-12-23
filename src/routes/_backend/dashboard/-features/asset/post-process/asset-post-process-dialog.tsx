"use client";

import { DialogHeaderActions } from "@/app/(backend)/dashboard/_components/dialog/dialog-header-actions";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { removeBackground } from "@/actions/asset/remove-background";
import { ObjectEffect } from "@/components/ui/object-effect";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
    Loader2,
    Maximize2,
    Monitor,
    RectangleHorizontal,
    RectangleVertical,
    RotateCcw,
    RotateCw,
    Square,
    Wand2,
} from "lucide-react";
import { motion, useAnimate } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Cropper, CropperRef } from "react-advanced-cropper";
import "react-advanced-cropper/dist/style.css";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AdjustableCropperBackground } from "../../../_components/crop/adjustableCropperBackground";
import { DialogFooterActions } from "../../../_components/dialog/dialog-footer-actions";
import { useAssetEditStore } from "../edit/use-asset-edit-store";
import { useAssetPreviewStore } from "../preview/use-asset-preview-store";
import { useAssetPostProcessStore } from "./use-asset-post-process-store";

// Configuration constants
const ADJUSTMENT_CONTROLS = [
    { label: "Brightness", key: "brightness" as const, min: -150, max: 150, unit: "" },
    { label: "Contrast", key: "contrast" as const, min: -50, max: 50, unit: "" },
    { label: "Saturation", key: "saturation" as const, min: -100, max: 100, unit: "" },
    { label: "Hue Rotate", key: "hue" as const, min: -180, max: 180, unit: "°" },
    { label: "Blur", key: "blur" as const, min: 0, max: 20, unit: "px" },
];

const ASPECT_RATIOS = [
    {
        label: "Free",
        icon: Maximize2,
        transform: (coords: any) => coords,
    },
    {
        label: "1:1",
        icon: Square,
        transform: (coords: any) => {
            const size = Math.min(coords.width, coords.height) * 0.8; // Scale down to 80%
            return {
                ...coords,
                width: size,
                height: size,
                left: coords.left + (coords.width - size) / 2,
                top: coords.top + (coords.height - size) / 2,
            };
        },
    },
    {
        label: "2:1",
        icon: RectangleHorizontal,
        transform: (coords: any) => {
            const height = coords.height * 0.8; // Scale down to 80%
            const width = height * 2;
            return {
                ...coords,
                width: width,
                height: height,
                left: coords.left + (coords.width - width) / 2,
                top: coords.top + (coords.height - height) / 2,
            };
        },
    },
    {
        label: "4:3",
        icon: Monitor,
        transform: (coords: any) => {
            const height = coords.height * 0.8; // Scale down to 80%
            const width = (height * 4) / 3;
            return {
                ...coords,
                width: width,
                height: height,
                left: coords.left + (coords.width - width) / 2,
                top: coords.top + (coords.height - height) / 2,
            };
        },
    },
    {
        label: "16:9",
        icon: RectangleHorizontal,
        transform: (coords: any) => {
            const height = coords.height * 0.8; // Scale down to 80%
            const width = (height * 16) / 9;
            return {
                ...coords,
                width: width,
                height: height,
                left: coords.left + (coords.width - width) / 2,
                top: coords.top + (coords.height - height) / 2,
            };
        },
    },
    {
        label: "2:3",
        icon: RectangleVertical,
        transform: (coords: any) => {
            const width = coords.width * 0.8; // Scale down to 80%
            const height = (width * 3) / 2;
            return {
                ...coords,
                width: width,
                height: height,
                left: coords.left + (coords.width - width) / 2,
                top: coords.top + (coords.height - height) / 2,
            };
        },
    },
];

export const AssetPostProcessDialog = () => {
    const [scope, animate] = useAnimate();
    const { open, setOpen, activeItem, adjustments, setAdjustments, resetAdjustments, isProcessing, setIsProcessing } =
        useAssetPostProcessStore(
            useShallow(state => ({
                open: state.open,
                setOpen: state.setOpen,
                activeItem: state.activeItem,
                adjustments: state.adjustments,
                setAdjustments: state.setAdjustments,
                resetAdjustments: state.resetAdjustments,
                isProcessing: state.isProcessing,
                setIsProcessing: state.setIsProcessing,
            }))
        );

    const cropperRef = useRef<CropperRef>(null);
    const objectUrlRef = useRef<string | null>(null);
    const [activeTab, setActiveTab] = useState("adjust");
    const [imageSrc, setImageSrc] = useState<string>("");
    const [hasBackgroundRemoved, setHasBackgroundRemoved] = useState(false);
    const [showEffect, setShowEffect] = useState(false);
    const router = useRouter();

    // Cleanup helper function
    const cleanup = () => {
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
    };

    // Initialize image source when activeItem changes or dialog opens
    useEffect(() => {
        if (activeItem && open) {
            setImageSrc(activeItem.src);
        }
    }, [activeItem?.id, open]);

    // Cleanup when dialog closes or component unmounts
    useEffect(() => {
        if (!open) {
            // Clean up resources
            cleanup();

            // Reset all state
            setImageSrc("");
            setHasBackgroundRemoved(false);
            setShowEffect(false);
            setActiveTab("adjust");
            resetAdjustments();
        }
        return cleanup;
    }, [open, resetAdjustments]);

    if (!activeItem) return null;

    const getProcessedImageFile = async (): Promise<Blob | null> => {
        if (!cropperRef.current) return null;

        try {
            const canvas = cropperRef.current.getCanvas();
            if (!canvas) {
                toast.error("Failed to get cropped image", { position: "top-center" });
                return null;
            }

            // Always convert to PNG format (supports transparency for background removal)
            const blob = await new Promise<Blob | null>(resolve => {
                canvas.toBlob(blob => {
                    resolve(blob);
                }, "image/png");
            });
            return blob;
        } catch (error) {
            console.error("Error getting canvas data:", error);
            return null;
        }
    };

    const handleProcessImage = async (saveMode: "update" | "new") => {
        setIsProcessing(true);
        try {
            const blob = await getProcessedImageFile();

            if (!blob || !cropperRef.current) {
                throw new Error("Failed to get processed image file");
            }

            const canvas = cropperRef.current.getCanvas();
            const width = canvas?.width || 0;
            const height = canvas?.height || 0;

            // Always use .png extension
            const filename = activeItem.name.replace(/\.[^/.]+$/, "");

            const formData = new FormData();
            formData.append("assetId", activeItem.id);
            formData.append("croppedImage", blob, `${filename}_cropped_${width}x${height}.png`);
            formData.append("filename", activeItem.name);
            formData.append("width", width.toString());
            formData.append("height", height.toString());
            formData.append("saveas", saveMode);

            const response = await fetch("/api/asset/process-image", {
                method: "POST",
                body: formData,
            });

            const result = (await response.json()) as {
                success: boolean;
                message: string;
                assetId?: string;
                assetName?: string;
                assetUrl?: string;
            };

            if (result.success) {
                toast.success(result.message, { position: "top-center" });
                setOpen(false);
                resetAdjustments();

                // Update other stores if it's an update
                if (saveMode === "update" && result.assetUrl) {
                    const newUrl = result.assetUrl;
                    const assetId = activeItem.id;

                    // Update Edit Store
                    const editStore = useAssetEditStore.getState();
                    if (editStore.items) {
                        const newItems = editStore.items.map(item =>
                            item.id === assetId && item.type === "asset"
                                ? { ...item, src: newUrl, size: blob.size }
                                : item
                        );
                        useAssetEditStore.setState({ items: newItems });
                    }

                    // Update Preview Store
                    const previewStore = useAssetPreviewStore.getState();
                    if (previewStore.items) {
                        const newItems = previewStore.items.map(item =>
                            item.id === assetId && item.type === "asset"
                                ? { ...item, src: newUrl, size: blob.size }
                                : item
                        );

                        // Also update current item if it matches
                        const newItem =
                            previewStore.item?.id === assetId && previewStore.item?.type === "asset"
                                ? { ...previewStore.item, src: newUrl, size: blob.size }
                                : previewStore.item;

                        useAssetPreviewStore.setState({ items: newItems, item: newItem });
                    }
                }

                router.refresh();
            } else {
                toast.error(result.message || `Failed to ${saveMode === "new" ? "save as new file" : "save image"}`, {
                    position: "top-center",
                });
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : `Failed to ${saveMode === "new" ? "save as new file" : "save image"}`,
                { position: "top-center" }
            );
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSave = () => handleProcessImage("update");
    const handleSaveAs = () => handleProcessImage("new");

    const handleCancel = () => {
        // Reset all adjustments to default
        resetAdjustments();

        // Reset image source to original
        if (activeItem) {
            setImageSrc(activeItem.src);
        }

        // Reset effect states
        setHasBackgroundRemoved(false);
        setShowEffect(false);

        // Clean up resources
        cleanup();

        // Close the dialog
        setOpen(false);
    };

    const handleChange = async (newOpen: boolean) => {
        if (!newOpen) {
            await animate(scope.current, { opacity: 0, y: 20 }, { duration: 0.2 });
        }
        setOpen(newOpen);
    };

    const handleRemoveBackground = async () => {
        setIsProcessing(true);

        try {
            // Call the server action (runs on server, no CORS issues)
            const result = await removeBackground({ imageUrl: imageSrc });

            // Check for server error
            if (result?.serverError) {
                throw new Error(result.serverError);
            }

            // Check if action succeeded
            if (!result?.data?.success) {
                throw new Error(result?.data?.message || "Failed to remove background");
            }

            const { processedImage } = result.data.data;

            // Clean up old object URL if exists
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
            }

            // Create a blob from the base64 data URL (this is safe, it's a data URL not external fetch)
            const response = await fetch(processedImage);
            const blob = await response.blob();

            // Create new object URL for the processed image
            objectUrlRef.current = URL.createObjectURL(blob);

            // Update the image source
            setImageSrc(objectUrlRef.current);

            // Mark that background has been removed (for persistent white border)
            setHasBackgroundRemoved(true);

            // Show the shimmer animation (will auto-hide after 2.5s)
            setShowEffect(true);
            setTimeout(() => {
                setShowEffect(false);
            }, 2500);

            toast.success("Background removed successfully!", { position: "top-center" });
        } catch (error) {
            console.error("Background removal error:", error);
            toast.error(error instanceof Error ? error.message : "Failed to remove background", {
                position: "top-center",
            });
        } finally {
            setIsProcessing(false);
        }
    };
    const rotationButtons = [
        { label: "Left 90°", icon: RotateCcw, angle: -90 },
        { label: "Right 90°", icon: RotateCw, angle: 90 },
    ];

    const tabsConfig = [
        {
            value: "adjust",
            label: "Adjust",
            title: "Adjust Image",
            description: "Fine-tune brightness, contrast, saturation, and other image properties",
        },
        {
            value: "transform",
            label: "Transform",
            title: "Transform Image",
            description: "Crop to different aspect ratios and rotate your image",
        },
        {
            value: "ai",
            label: "AI Tools",
            title: "AI-Powered Tools",
            description: "Use artificial intelligence to enhance and modify your image",
        },
    ];

    return (
        <Sheet open={open} onOpenChange={handleChange}>
            <SheetContent
                showCloseButton={false}
                className={cn("bg-transparent border-l-0 p-2 shadow-none w-full", "sm:max-w-full")}
            >
                {open && (
                    <motion.div
                        className="shadow-sm/20 border flex flex-col overflow-hidden bg-component h-full dark:shadow-elevation-modal rounded-lg"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: "keyframes" }}
                        ref={scope}
                    >
                        <DialogHeaderActions onClose={() => handleChange(false)} title={`${activeItem.name}`} />

                        <form
                            action={handleSave}
                            className={cn(
                                "flex flex-col flex-1 min-h-0 relative z-20",
                                "dark:shadow-elevation-modal dark:border-border/30 dark:bg-component"
                            )}
                        >
                            <div className="flex flex-1 min-h-0">
                                {/* Main Preview Area */}
                                <div className="dark:bg-background bg-accent border-r flex-1 overflow-hidden relative">
                                    <Cropper
                                        ref={cropperRef}
                                        src={imageSrc}
                                        className="h-full w-full cropper-container cropper"
                                        stencilProps={{
                                            overlayClassName: cn("cropper-overlay"),
                                            aspectRatio: undefined,
                                            className: cn(
                                                "transition-opacity duration-200",
                                                activeTab !== "transform" && "opacity-0 pointer-events-none"
                                            ),
                                        }}
                                        crossOrigin="anonymous"
                                        defaultSize={({ imageSize }) => ({
                                            width: imageSize.width,
                                            height: imageSize.height,
                                        })}
                                        defaultPosition={({ imageSize }) => ({
                                            left: 0,
                                            top: 0,
                                        })}
                                        backgroundComponent={AdjustableCropperBackground}
                                        backgroundProps={{
                                            brightness: adjustments.brightness / 100,
                                            contrast: adjustments.contrast / 100,
                                            saturation: adjustments.saturation / 100,
                                            hue: adjustments.hue / 360,
                                        }}
                                    />

                                    {/* Effect overlay - only shows during the animation */}
                                    {imageSrc && showEffect && (
                                        <div className="absolute w-full h-full inset-0 z-50 pointer-events-none">
                                            <ObjectEffect src={imageSrc} hasScan={showEffect} />
                                        </div>
                                    )}
                                    {/* Scanning effect - shows during background removal processing */}
                                    {isProcessing && (
                                        <motion.div className="absolute overflow-hidden top-0 left-0 right-0 bottom-0 z-50 pointer-events-none">
                                            <motion.div
                                                initial={{ x: "-100%" }}
                                                animate={{
                                                    x: ["-100%", "100%", "100%", "-100%"],
                                                    scaleX: [1, 1, -1, -1],
                                                }}
                                                transition={{
                                                    duration: 4,
                                                    ease: "easeInOut",
                                                    repeat: Infinity,
                                                    times: [0, 0.5, 0.5, 1],
                                                }}
                                                className="w-full h-full relative"
                                            >
                                                {/* Gradient Trail */}
                                                <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/10" />

                                                {/* Glowing Scan Line */}
                                                <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-white/50 shadow-[0_0_15px_2px_rgba(255,255,255,0.6)]" />
                                            </motion.div>
                                        </motion.div>
                                    )}
                                </div>

                                {/* Sidebar Controls */}
                                <div className={cn("p-4 max-w-xl w-full flex flex-col", "max-xl:max-w-sm")}>
                                    <Tabs
                                        value={activeTab}
                                        onValueChange={setActiveTab}
                                        className="flex-1 flex flex-col"
                                    >
                                        <div className="mb-2">
                                            <h2 className="text-base font-semibold">
                                                {tabsConfig.find(t => t.value === activeTab)?.title}
                                            </h2>
                                            <p className="text-zinc-500 text-sm">
                                                {tabsConfig.find(t => t.value === activeTab)?.description}
                                            </p>
                                        </div>
                                        <TabsList className="w-full grid grid-cols-3">
                                            {tabsConfig.map(tab => (
                                                <TabsTrigger key={tab.value} value={tab.value}>
                                                    {tab.label}
                                                </TabsTrigger>
                                            ))}
                                        </TabsList>

                                        <ScrollArea className="flex-1 min-h-0">
                                            <div className="py-6 space-y-6">
                                                <TabsContent value="adjust" className="space-y-6 m-0">
                                                    {ADJUSTMENT_CONTROLS.map(control => (
                                                        <div key={control.key} className="space-y-4">
                                                            <div className="flex items-center justify-between">
                                                                <Label>{control.label}</Label>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {adjustments[control.key]}
                                                                    {control.unit}
                                                                </span>
                                                            </div>
                                                            <Slider
                                                                min={control.min}
                                                                max={control.max}
                                                                value={[adjustments[control.key]]}
                                                                onValueChange={value =>
                                                                    setAdjustments({
                                                                        [control.key]: value[0],
                                                                    })
                                                                }
                                                            />
                                                        </div>
                                                    ))}
                                                </TabsContent>

                                                <TabsContent value="transform" className="space-y-4 m-0">
                                                    <div className="space-y-4">
                                                        <div>
                                                            <h3 className="text-sm font-medium mb-2">Aspect Ratio</h3>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {ASPECT_RATIOS.map(ratio => {
                                                                    const Icon = ratio.icon;
                                                                    return (
                                                                        <Button
                                                                            key={ratio.label}
                                                                            type="button"
                                                                            variant="formDark"
                                                                            className="flex justify-start gap-2"
                                                                            onClick={() =>
                                                                                cropperRef.current?.setCoordinates(
                                                                                    state => {
                                                                                        const { coordinates } = state;
                                                                                        if (!coordinates)
                                                                                            return coordinates;
                                                                                        return ratio.transform(
                                                                                            coordinates
                                                                                        );
                                                                                    }
                                                                                )
                                                                            }
                                                                        >
                                                                            <Icon />
                                                                            <span>{ratio.label}</span>
                                                                        </Button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        <div>
                                                            <h3 className="text-sm font-medium mb-2">Rotation</h3>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {rotationButtons.map(rotation => {
                                                                    const Icon = rotation.icon;
                                                                    return (
                                                                        <Button
                                                                            key={rotation.label}
                                                                            type="button"
                                                                            variant="formDark"
                                                                            className="flex justify-start gap-2"
                                                                            onClick={() =>
                                                                                cropperRef.current?.rotateImage(
                                                                                    rotation.angle
                                                                                )
                                                                            }
                                                                        >
                                                                            <Icon />
                                                                            {rotation.label}
                                                                        </Button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </TabsContent>

                                                <TabsContent value="ai" className="space-y-4 m-0">
                                                    <div className="space-y-4">
                                                        <div className="rounded-lg border p-4 space-y-3">
                                                            <div className="flex items-center gap-2 font-medium">
                                                                <Wand2 className="h-4 w-4 text-purple-500" />
                                                                Background Removal
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">
                                                                Automatically remove the background from your image
                                                                using AI.
                                                            </p>
                                                            <Button
                                                                type="button"
                                                                onClick={handleRemoveBackground}
                                                                disabled={isProcessing}
                                                                className="w-full"
                                                                variant="formDark"
                                                            >
                                                                {isProcessing ? (
                                                                    <>
                                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                        Processing...
                                                                    </>
                                                                ) : (
                                                                    "Remove Background"
                                                                )}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </TabsContent>
                                            </div>
                                        </ScrollArea>
                                        <Button
                                            variant="formDark"
                                            size="sm"
                                            onClick={resetAdjustments}
                                            className="w-full"
                                            type="button"
                                        >
                                            <RotateCcw className="mr-2 h-4 w-4" />
                                            Reset Adjustments
                                        </Button>
                                    </Tabs>
                                </div>
                            </div>
                            <DialogFooterActions
                                isLoading={isProcessing}
                                onCancel={handleCancel}
                                submitLabel="Save"
                                loadingLabel="Saving..."
                                additionalActions={[
                                    {
                                        label: "Save As New File",
                                        onClick: handleSaveAs,
                                    },
                                ]}
                            />
                        </form>
                    </motion.div>
                )}
            </SheetContent>
        </Sheet>
    );
};
