import { AssetBlockMap } from "@/components/asset/asset-block-map";
import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { DialogHeaderActions } from "@/components/dialog/dialog-header-actions";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { getActionErrorMessage } from "@/lib/asset/action-result";
import { SplitEditorLayout } from "@/routes/_backend/dashboard/-components/layout/split-editor-layout";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useAssetMoveStore } from "@/lib/asset/store/use-asset-move-store";

export const AssetMoveDialog = () => {
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
    removeItem,
  } = useAssetMoveStore(
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
      removeItem: state.removeItem,
    })),
  );

  const handleSubmit = async () => {
    if (!action || !items?.length) return;
    setIsExecuting(true);
    try {
      const data = new FormData();
      data.set("itemIds", JSON.stringify(items.map((item) => item.id)));
      const destVal =
        fields?.find((field) => field.name === "Destination Folder")?.value ??
        "";
      data.set(
        "Destination Folder",
        typeof destVal === "string"
          ? destVal
          : Array.isArray(destVal)
            ? destVal.join(",")
            : "",
      );
      const result = await action({ data });
      if (!result.success) throw new Error(result.message);
      toast.success(result.message || "Items moved successfully", {
        description: result.description,
        position: "top-center",
      });
      onSuccess?.();
      handleOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (error) {
      toast.error(getActionErrorMessage(error, "Failed to move items"), {
        position: "top-center",
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="w-full border-l-0 bg-transparent p-2 shadow-none sm:max-w-full"
      >
        <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-component shadow-sm/20 dark:shadow-elevation-modal">
          <DialogHeaderActions
            onClose={() => handleOpenChange(false)}
            title={title || "Move items"}
          />
          <SplitEditorLayout
            main={
              <ScrollArea className="size-full">
                <ScrollBar />
                <div className="grid grid-cols-4 gap-3 p-4 max-md:grid-cols-2">
                  {items?.map((item) =>
                    item.type === "folder" ? (
                      <AssetBlockMap
                        key={item.id}
                        type="folder"
                        name={item.name}
                        onRemove={() => removeItem(item.id)}
                      />
                    ) : (
                      <AssetBlockMap
                        key={item.id}
                        type="asset"
                        name={item.name}
                        fileType={item.fileType}
                        extension={item.extension}
                        src={item.src}
                        alt={item.alt}
                        onRemove={() => removeItem(item.id)}
                      />
                    ),
                  )}
                </div>
              </ScrollArea>
            }
            sidebar={
              <>
                {description && (
                  <p className="mb-6 text-sm text-muted-foreground">
                    {description}
                  </p>
                )}
                {fields && (
                  <FieldsRenderer
                    fields={fields}
                    onChange={(name, value) => {
                      if (typeof value === "string")
                        updateFieldValue(name, value);
                    }}
                    className="grid-cols-1"
                  />
                )}
              </>
            }
            sidebarClassName="p-5"
          />
          <DialogFooterActions
            isLoading={isExecuting}
            isDisabled={!items?.length}
            onCancel={() => handleOpenChange(false)}
            submitLabel="Move"
            loadingLabel="Moving..."
            onSubmit={handleSubmit}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};
