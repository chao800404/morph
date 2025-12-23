"use client";

import { deleteItems } from "@/actions/asset";
import { AssetBlockMap } from "@/app/(backend)/dashboard/_components/asset-preview/asset/asset-block-map";
import { DialogFooterActions } from "@/app/(backend)/dashboard/_components/dialog/dialog-footer-actions";
import { DialogHeaderActions } from "@/app/(backend)/dashboard/_components/dialog/dialog-header-actions";
import { FieldsRenderer } from "@/app/(backend)/dashboard/_components/form/fields-renderer";
import { useInfoStore, type ServerAction } from "@/app/(backend)/dashboard/_features/global-info/use-info-store";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { downloadAsset } from "@/lib/asset";
import { cn } from "@/lib/utils";
import { Download, Settings2, Trash2 } from "lucide-react";
import { motion, useAnimate } from "motion/react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo } from "react";
import { Tooltip } from "react-tooltip";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useAssetPostProcessStore } from "../post-process/use-asset-post-process-store";
import { generateEditFields } from "./edit-fields-utils";
import { useAssetEditStore } from "./use-asset-edit-store";

export const AssetEditDialog = () => {
    const [scope, animate] = useAnimate();
    const {
        open,
        handleOpenChange,
        title,
        description,
        fields,
        updateFieldValue,
        action,
        onSuccess,
        items,
        initialItems,
        removeItem,
        activeItemId,
        setActiveItemId,
        setAssetEditData,
    } = useAssetEditStore(
        useShallow(state => ({
            open: state.open,
            handleOpenChange: state.handleOpenChange,
            title: state.title,
            description: state.description,
            fields: state.fields,
            updateFieldValue: state.updateFieldValue,
            action: state.action,
            onSuccess: state.onSuccess,
            items: state.items,
            initialItems: state.initialItems,
            removeItem: state.removeItem,
            activeItemId: state.activeItemId,
            setActiveItemId: state.setActiveItemId,
            setAssetEditData: state.setAssetEditData,
        }))
    );

    const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
        useShallow(state => ({
            setInfoData: state.setInfoData,
            setOpen: state.setOpen,
        }))
    );

    const isDirty = useMemo(() => {
        if (!items || !initialItems) return false;

        const clean = (data: any) => {
            if (Array.isArray(data)) {
                return data.map(item => {
                    // Exclude url/src/size/extension from comparison as they might change due to processing
                    // but shouldn't trigger "unsaved changes" warning for the edit form
                    const { url, src, size, extension, ...rest } = item;
                    return rest;
                });
            }
            return data;
        };

        return JSON.stringify(clean(items)) !== JSON.stringify(clean(initialItems));
    }, [items, initialItems]);

    const handleOpenChangeWrapper = (newOpen: boolean) => {
        if (!newOpen && isDirty) {
            setInfoData({
                title: "Unsaved Changes",
                description: "You have unsaved changes. Are you sure you want to discard them?",
                confirmLabel: "Discard",
                confirmVariant: "destructive",
                action: async () => ({ message: "", success: true }),
                onSuccess: () => {
                    handleOpenChange(false);
                },
            });
            setInfoOpen(true);
            return;
        }
        handleOpenChange(newOpen);
    };

    const handleChange = async (newOpen: boolean) => {
        if (!newOpen) {
            await animate(scope.current, { opacity: 0, y: 20 }, { duration: 0.2 });
        }
        handleOpenChangeWrapper(newOpen);
    };

    // Dummy action for initial state or when no action is selected
    const dummyAction = async () => {
        return { data: undefined };
    };

    const { execute, result, isExecuting, reset } = useAction(action ?? dummyAction);

    // Reset action state when dialog opens or closes
    useEffect(() => {
        reset();
    }, [open, reset]);

    const handleSubmit = (formData: FormData) => {
        if (action) {
            execute(formData);
        }
    };

    // Monitor result changes and show toast
    useEffect(() => {
        const { data, serverError, validationErrors } = result;

        // If no result (initial state or reset), do nothing
        if (!data && !serverError && !validationErrors) return;

        if (serverError) {
            toast.error(String(serverError), {
                position: "top-center" as const,
            });
            return;
        }

        if (validationErrors) {
            // Handle validation errors (show first one or generic message)
            const errors = validationErrors as Record<string, any>;
            const firstErrorKey = Object.keys(errors)[0];
            const firstErrorMessage = firstErrorKey ? errors[firstErrorKey] : undefined;
            let message = "Validation error";
            if (typeof firstErrorMessage === "string") message = firstErrorMessage;
            else if (Array.isArray(firstErrorMessage)) message = firstErrorMessage[0];
            else if (typeof firstErrorMessage === "object" && firstErrorMessage?._errors)
                message = firstErrorMessage._errors[0];

            toast.error(message, {
                position: "top-center" as const,
            });
            return;
        }

        if (data) {
            reset();
            toast.success("Saved successfully", {
                position: "top-center" as const,
            });
            // Call onSuccess callback if provided
            onSuccess?.();
            // Close dialog on success
            handleOpenChange(false);
        }
    }, [result, onSuccess, handleOpenChange, reset]);

    // Set initial active item when items change or active item is removed
    useEffect(() => {
        if (open && items && items.length > 0) {
            // If no active item, or active item is no longer in the list, select the first one
            if (!activeItemId || !items.find(item => item.id === activeItemId)) {
                const firstItem = items[0];
                setActiveItemId(firstItem.id);

                // Update all fields based on item type
                if (firstItem.type === "folder") {
                    updateFieldValue("Name", firstItem.name);
                    updateFieldValue("Description", (firstItem as any).description || "");
                } else {
                    updateFieldValue("Name", firstItem.name);
                    updateFieldValue("Alt", (firstItem as any).alt || "");
                    updateFieldValue("Caption", (firstItem as any).caption || "");
                    updateFieldValue("Tags", (firstItem as any).tags || "");
                }
            }
        } else if (!open || !items || items.length === 0) {
            setActiveItemId(null);
        }
    }, [items, open, activeItemId, updateFieldValue, setActiveItemId]);

    const handleItemSelect = (itemId: string) => {
        setActiveItemId(itemId);
        const activeItem = items?.find(item => item.id === itemId);
        if (activeItem) {
            // Update all fields based on item type
            if (activeItem.type === "folder") {
                updateFieldValue("Name", activeItem.name);
                updateFieldValue("Description", (activeItem as any).description || "");
            } else {
                updateFieldValue("Name", activeItem.name);
                updateFieldValue("Alt", (activeItem as any).alt || "");
                updateFieldValue("Caption", (activeItem as any).caption || "");
                updateFieldValue("Tags", (activeItem as any).tags || "");
            }
        }
    };

    // Update fields structure when switching between different item types
    useEffect(() => {
        if (!open || !items || items.length === 0 || !activeItemId) return;

        const activeItem = items.find(item => item.id === activeItemId);
        if (!activeItem) return;

        // Check if current fields match the active item type
        const currentFieldsAreForFolder = fields?.some(f => f.name === "Description");
        const activeItemIsFolder = activeItem.type === "folder";

        // If types don't match, update fields
        if (currentFieldsAreForFolder !== activeItemIsFolder) {
            setAssetEditData({ fields: generateEditFields(activeItem) });
        }
    }, [activeItemId, items, open, fields, setAssetEditData]);

    const currentAsset = items?.find(item => item.id === activeItemId);

    const handleDownload = async () => {
        if (!currentAsset || currentAsset.type !== "asset") return;
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
            title: "Delete Item",
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
                removeItem(currentAsset.id);
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
                        <DialogHeaderActions
                            onClose={() => handleChange(false)}
                            title={
                                <div className="text-sm flex items-center justify-center text-center text-muted-foreground gap-2">
                                    <span className="truncate max-w-md"> {currentAsset?.name}</span>
                                    {currentAsset?.type === "asset" && <Kbd>{currentAsset.extension}</Kbd>}
                                </div>
                            }
                            actions={
                                <>
                                    <Button size="xs" variant="formDark" onClick={handleDelete}>
                                        <Trash2 className="size-3" />
                                    </Button>
                                    {currentAsset?.type === "asset" && (
                                        <Button size="xs" variant="formDark" onClick={handleDownload}>
                                            <Download className="size-3" />
                                        </Button>
                                    )}
                                    {currentAsset?.type === "asset" && currentAsset.fileType === "image" && (
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
                                </>
                            }
                        />
                        <form
                            action={handleSubmit}
                            className={cn(
                                "flex flex-col flex-1 min-h-0 relative z-20",
                                "dark:shadow-elevation-modal dark:border-border/30 dark:bg-component"
                            )}
                        >
                            {fields && fields.length > 0 ? (
                                <>
                                    <div className="flex flex-1 overflow-hidden min-h-0">
                                        {/* ... (items list) */}
                                        <div className="dark:bg-background bg-accent border-r flex-1 overflow-hidden">
                                            {items && items.length > 0 ? (
                                                <ScrollArea className="px-4 h-full">
                                                    <ScrollBar />
                                                    <div className="grid py-4 grid-cols-4 gap-3 px-1">
                                                        {items.map(item => {
                                                            const isActive = item.id === activeItemId;
                                                            return (
                                                                <div
                                                                    tabIndex={0}
                                                                    data-focus={isActive}
                                                                    key={item.id}
                                                                    onClick={() => handleItemSelect(item.id)}
                                                                    onFocus={() => handleItemSelect(item.id)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === "Enter") {
                                                                            handleItemSelect(item.id);
                                                                        }
                                                                    }}
                                                                    className={cn(
                                                                        "cursor-pointer border-transparent relative z-20 rounded-lg overflow-hidden border-none opacity-30 transition-all outline-none",
                                                                        "data-[focus=true]:ring data-[focus=true]:ring-blue-500 data-[focus=true]:opacity-100"
                                                                    )}
                                                                >
                                                                    {item.type === "folder" ? (
                                                                        <AssetBlockMap
                                                                            type="folder"
                                                                            name={item.name}
                                                                            onRemove={() => removeItem(item.id)}
                                                                        />
                                                                    ) : (
                                                                        <AssetBlockMap
                                                                            type="asset"
                                                                            name={item.name}
                                                                            fileType={item.fileType}
                                                                            extension={item.extension}
                                                                            src={item.src || ""}
                                                                            alt={item.alt || ""}
                                                                            onRemove={() => removeItem(item.id)}
                                                                        />
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </ScrollArea>
                                            ) : (
                                                <div className="text-muted-foreground text-sm flex items-center justify-center h-full">
                                                    No items selected
                                                </div>
                                            )}
                                        </div>
                                        <div className={cn("p-4 max-w-xl w-full", "max-xl:max-w-sm")}>
                                            <div className="mb-4">
                                                <h2 className="text-base font-semibold">{title}</h2>
                                                <p className="text-zinc-500 text-sm">{description}</p>
                                            </div>
                                            {/* Submit all items data for batch update */}
                                            <input type="hidden" name="itemsData" value={JSON.stringify(items || [])} />
                                            <FieldsRenderer
                                                fields={fields}
                                                onChange={(name, value) => {
                                                    // Convert File[] or null to string for FormField
                                                    if (typeof value === "string") {
                                                        updateFieldValue(name, value);
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <DialogFooterActions
                                        isLoading={isExecuting}
                                        isDisabled={!isDirty}
                                        onCancel={() => handleChange(false)}
                                        submitLabel="Save"
                                        loadingLabel="Saving..."
                                    />
                                </>
                            ) : (
                                <div className="text-center h-full flex items-center justify-center text-muted-foreground">
                                    <p>No fields</p>
                                </div>
                            )}
                        </form>
                    </motion.div>
                )}
            </SheetContent>
        </Sheet>
    );
};
