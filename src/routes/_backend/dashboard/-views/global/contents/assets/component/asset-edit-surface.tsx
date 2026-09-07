import { AssetBlockMap } from "@/components/asset/asset-block-map";
import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SplitEditorLayout } from "@/routes/_backend/dashboard/-components/layout/split-editor-layout";
import type { AssetEditItem } from "@/routes/_backend/dashboard/-views/features/asset/edit/asset-edit.types";
import { generateEditFields } from "@/routes/_backend/dashboard/-views/features/asset/edit/edit-fields-utils";
import { Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

interface AssetEditSurfaceProps {
  title: string;
  items: AssetEditItem[];
  activeItemId: string;
  hasChanges: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onActivate: (item: AssetEditItem) => void;
  onRemove: (item: AssetEditItem) => void;
  onFieldChange: (name: string, value: string) => void;
  onProcessImage: () => void;
}

export const AssetEditSurface = ({
  title,
  items,
  activeItemId,
  hasChanges,
  isSaving,
  onClose,
  onSubmit,
  onActivate,
  onRemove,
  onFieldChange,
  onProcessImage,
}: AssetEditSurfaceProps) => {
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const activeItem = useMemo(
    () => items.find((item) => item.id === activeItemId) ?? items[0],
    [activeItemId, items],
  );
  const fields = useMemo(() => {
    if (!activeItem) return [];
    const selectedFolderIds = items
      .filter((item) => item.type === "folder")
      .map((item) => item.id);
    return generateEditFields(activeItem).map((field) =>
      field.type === "folder-select"
        ? { ...field, excludedIds: selectedFolderIds }
        : field,
    );
  }, [activeItem, items]);

  useEffect(() => {
    if (items.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const currentIndex = items.findIndex((item) => item.id === activeItemId);
      if (currentIndex === -1) return;

      let columns = 4;
      if (gridContainerRef.current) {
        const template = window.getComputedStyle(
          gridContainerRef.current,
        ).gridTemplateColumns;
        const computedColumns = template.split(" ").filter(Boolean).length;
        if (computedColumns > 0) columns = computedColumns;
      }

      let nextIndex = currentIndex;
      if (event.key === "ArrowRight") {
        nextIndex = Math.min(currentIndex + 1, items.length - 1);
      } else if (event.key === "ArrowLeft") {
        nextIndex = Math.max(currentIndex - 1, 0);
      } else if (event.key === "ArrowDown") {
        nextIndex = Math.min(currentIndex + columns, items.length - 1);
      } else if (event.key === "ArrowUp") {
        nextIndex = Math.max(currentIndex - columns, 0);
      } else {
        return;
      }

      event.preventDefault();
      if (nextIndex !== currentIndex) onActivate(items[nextIndex]);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeItemId, items, onActivate]);

  useEffect(() => {
    const activeElement = gridContainerRef.current?.querySelector(
      `[data-item-id="${CSS.escape(activeItemId)}"]`,
    );
    activeElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeItemId]);

  return (
    <RouteFullscreenSurface
      label="Edit asset"
      onClose={onClose}
      header={<h1 className="truncate text-sm font-medium">{title}</h1>}
      headerActions={
        activeItem?.type === "asset" && activeItem.fileType === "image" ? (
          <Button
            type="button"
            size="xs"
            variant="formDark"
            className="gap-1.5 font-medium"
            onClick={onProcessImage}
          >
            <Wand2 className="size-3.5 text-primary" />
            Process Image
          </Button>
        ) : undefined
      }
      bodyClassName="min-h-0"
      footer={
        <DialogFooterActions
          isSheet={false}
          isLoading={isSaving}
          isDisabled={!hasChanges || items.length === 0}
          onCancel={onClose}
          submitLabel="Save"
          loadingLabel="Saving..."
          onSubmit={onSubmit}
        />
      }
    >
      <SplitEditorLayout
        main={
          <ScrollArea className="size-full">
            <ScrollBar />
            <div
              ref={gridContainerRef}
              className="grid grid-cols-4 gap-3 p-4 max-md:grid-cols-2"
            >
              {items.map((item) => {
                const canRemove = items.length > 1;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={`${item.type}:${item.id}`}
                    data-item-id={item.id}
                    className={cn(
                      "cursor-pointer rounded-lg border p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      item.id === activeItem?.id && "ring-[1.5px] ring-ring/50",
                    )}
                    onClick={() => onActivate(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onActivate(item);
                      }
                    }}
                  >
                    {item.type === "folder" ? (
                      <AssetBlockMap
                        type="folder"
                        name={item.name}
                        onRemove={canRemove ? () => onRemove(item) : undefined}
                      />
                    ) : (
                      <AssetBlockMap
                        type="asset"
                        fileType={item.fileType}
                        showCategory={false}
                        src={item.src}
                        alt={item.alt}
                        onRemove={canRemove ? () => onRemove(item) : undefined}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        }
        sidebar={
          <>
            <h2 className="mb-2 truncate text-base font-semibold">
              {activeItem?.name}
            </h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Modify item details
            </p>
            {activeItem?.type === "asset" ? (
              <dl className="mb-6 flex items-center justify-between border-y py-3 text-sm">
                <dt className="text-muted-foreground">Format</dt>
                <dd className="font-medium uppercase text-foreground">
                  {activeItem.extension || activeItem.fileType}
                </dd>
              </dl>
            ) : null}
            <FieldsRenderer
              key={`${activeItem?.type}:${activeItem?.id}`}
              fields={fields}
              onChange={(name, value) => {
                if (typeof value === "string") onFieldChange(name, value);
              }}
              className="grid-cols-1"
            />
          </>
        }
        sidebarClassName="p-5"
      />
    </RouteFullscreenSurface>
  );
};
