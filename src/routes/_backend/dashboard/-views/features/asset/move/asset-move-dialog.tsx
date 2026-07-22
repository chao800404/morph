"use client";

import { DialogFooterActions } from "@/app/(backend)/dashboard/_components/dialog/dialog-footer-actions";
import { DialogHeaderActions } from "@/app/(backend)/dashboard/_components/dialog/dialog-header-actions";
import { FieldsRenderer } from "@/app/(backend)/dashboard/_components/form/fields-renderer";
import { useAssetMoveStore } from "@/app/(backend)/dashboard/_features/asset/move/use-asset-move-store";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { motion, useAnimate } from "motion/react";
import { useAction } from "next-safe-action/hooks";
import { useEffect } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AssetBlockMap } from "../../../_components/asset-preview/asset/asset-block-map";

export const AssetMoveDialog = () => {
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
        removeItem,
    } = useAssetMoveStore(
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
            removeItem: state.removeItem,
        }))
    );

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
            const resultData = data as any;
            if (resultData.success) {
                reset();
                toast.success(resultData.message, {
                    description: resultData.description,
                    position: "top-center" as const,
                });
                // Call onSuccess callback if provided
                onSuccess?.();
                // Close dialog on success
                handleOpenChange(false);
            } else {
                // Should not happen if we throw errors, but just in case
                toast.error(resultData.message || "Failed", {
                    position: "top-center" as const,
                });
            }
        }
    }, [result, onSuccess, handleOpenChange, reset]);

    const handleChange = async (open: boolean) => {
        if (!open) {
            await animate(scope.current, { opacity: 0, y: 20 }, { duration: 0.2 });
        }
        handleOpenChange(open);
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
                        <DialogHeaderActions onClose={() => handleChange(false)} />
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
                                        <div className="dark:bg-background bg-accent border-r flex-1 overflow-hidden">
                                            {items && items.length > 0 ? (
                                                <ScrollArea className="px-4 h-full">
                                                    <ScrollBar />
                                                    <div className="grid py-4 grid-cols-4 gap-3">
                                                        {items.map(item => {
                                                            if (item.type === "folder") {
                                                                return (
                                                                    <AssetBlockMap
                                                                        key={item.id}
                                                                        type="folder"
                                                                        name={item.name}
                                                                        onRemove={() => removeItem(item.id)}
                                                                    />
                                                                );
                                                            }
                                                            return (
                                                                <AssetBlockMap
                                                                    key={item.id}
                                                                    type="asset"
                                                                    fileType={item.fileType}
                                                                    extension={item.extension}
                                                                    src={item.src || ""}
                                                                    alt={item.alt || ""}
                                                                    name={item.name}
                                                                    onRemove={() => removeItem(item.id)}
                                                                />
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
                                            {/* Dynamic itemIds based on current items */}
                                            <input
                                                type="hidden"
                                                name="itemIds"
                                                value={JSON.stringify(items?.map(item => item.id) || [])}
                                            />
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
                                        submitLabel="Move"
                                        loadingLabel="Moving..."
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
