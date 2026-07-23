import { AssetBlockMap } from "@/components/asset/asset-block-map";
import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { DialogHeaderActions } from "@/components/dialog/dialog-header-actions";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { getActionErrorMessage } from "@/lib/asset/action-result";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useInfoStore } from "../../global-info/use-info-store";
import { generateEditFields } from "./edit-fields-utils";
import { useAssetEditStore } from "./use-asset-edit-store";

export const AssetEditDialog = () => {
  const queryClient = useQueryClient();
  const [isExecuting, setIsExecuting] = useState(false);
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
  } = useAssetEditStore(
    useShallow((state) => ({
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
    })),
  );
  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const isDirty = useMemo(() => {
    if (!items || !initialItems) return false;
    if (items.length !== initialItems.length) return true;
    return items.some((item, i) => {
      const init = initialItems[i];
      if (!init) return true;
      if (item.name !== init.name) return true;
      if ("description" in item && "description" in init && item.description !== init.description) return true;
      if ("alt" in item && "alt" in init && item.alt !== init.alt) return true;
      if ("caption" in item && "caption" in init && item.caption !== init.caption) return true;
      if ("tags" in item && "tags" in init && item.tags !== init.tags) return true;
      return false;
    });
  }, [items, initialItems]);

  const activeItem = useMemo(
    () => items?.find((item) => item.id === activeItemId) ?? items?.[0],
    [items, activeItemId],
  );

  const currentFields = useMemo(() => {
    if (!activeItem) return fields;
    return generateEditFields(activeItem);
  }, [activeItem, fields]);



  const close = () => {
    if (isDirty) {
      setInfoData({
        title: "Unsaved Changes",
        description: "Discard the changes made to these items?",
        confirmLabel: "Discard",
        confirmVariant: "destructive",
        action: async () => ({ success: true, message: "" }),
        onSuccess: () => handleOpenChange(false),
      });
      setInfoOpen(true);
      return;
    }
    handleOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!action || !items?.length) return;
    setIsExecuting(true);
    try {
      const data = new FormData();
      data.set("itemsData", JSON.stringify(items));
      const result = await action({ data });
      if (!result.success) throw new Error(result.message);
      toast.success(result.message || "Items updated successfully", {
        position: "top-center",
      });
      onSuccess?.();
      handleOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (error) {
      toast.error(getActionErrorMessage(error, "Failed to update items"), {
        position: "top-center",
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        // This sheet is full-screen, so the backdrop is barely visible while
        // its full-viewport backdrop-blur is expensive to re-rasterize during
        // the close fade — which stalls the slide-out. Drop the overlay.
        showOverlay={false}
        className="w-full border-l-0 bg-transparent p-2 shadow-none sm:max-w-full"
      >
        <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-component shadow-sm/20 dark:shadow-elevation-modal">
          <DialogHeaderActions onClose={close} title={title || "Edit items"} />
          <div className="flex min-h-0 flex-1 max-lg:flex-col">
            <ScrollArea className="min-w-0 flex-1 border-r bg-accent/40 max-lg:border-b max-lg:border-r-0">
              <ScrollBar />
              <div className="grid grid-cols-4 gap-3 p-4 max-md:grid-cols-2">
                {items?.map((item) => {
                  // The remove (X) button prunes an item from the batch. Keep at
                  // least one item so the dialog never lands in an empty state —
                  // use Cancel / Esc to dismiss instead.
                  const canRemove = (items?.length ?? 0) > 1;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={cn(
                        "rounded-lg border p-1 text-left",
                        item.id === activeItemId && "ring-2 ring-primary",
                      )}
                      onClick={() => setActiveItemId(item.id)}
                    >
                      {item.type === "folder" ? (
                        <AssetBlockMap
                          type="folder"
                          name={item.name}
                          onRemove={
                            canRemove ? () => removeItem(item.id) : undefined
                          }
                        />
                      ) : (
                        <AssetBlockMap
                          type="asset"
                          name={item.name}
                          fileType={item.fileType}
                          extension={item.extension}
                          // The selection tile is only an edit target, not a
                          // media preview. Avoid decoding a video frame while
                          // the full-screen sheet is sliding into view.
                          src={
                            item.fileType === "video" ? undefined : item.src
                          }
                          alt={item.alt}
                          onRemove={
                            canRemove ? () => removeItem(item.id) : undefined
                          }
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
            <div className="w-full max-w-xl p-5">
              <h2 className="text-base font-semibold">{activeItem?.name}</h2>
              {description && (
                <p className="mb-6 text-sm text-muted-foreground">
                  {description}
                </p>
              )}
              {currentFields && (
                <FieldsRenderer
                  fields={currentFields}
                  onChange={(name, value) => {
                    if (typeof value === "string")
                      updateFieldValue(name, value);
                  }}
                  className="grid-cols-1"
                />
              )}
            </div>
          </div>
          <DialogFooterActions
            isLoading={isExecuting}
            isDisabled={!isDirty || !items?.length}
            onCancel={close}
            submitLabel="Save"
            loadingLabel="Saving..."
            onSubmit={handleSubmit}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};
