import { AssetBlockMap } from "@/components/asset/asset-block-map";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { Button } from "@/components/ui/button";
import { NextArrowIcon } from "@/components/ui/icons/next-arrow-icon";
import { PreviousArrowIcon } from "@/components/ui/icons/previous-arrow-icon";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import type { AssetPreviewController } from "../hooks/use-asset-preview-controller";
import { Download, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AssetPreviewCarousel } from "./asset-preview-carousel";

type AssetPreviewSurfaceProps = Pick<
  AssetPreviewController,
  | "assets"
  | "currentAsset"
  | "selectedIndex"
  | "closePreview"
  | "setCurrentAsset"
  | "goToNext"
  | "goToPrevious"
  | "handlePreviewWheel"
  | "handleDownload"
  | "handleDelete"
  | "handleEdit"
>;

export const AssetPreviewSurface = ({
  assets,
  currentAsset,
  selectedIndex,
  closePreview,
  setCurrentAsset,
  goToNext,
  goToPrevious,
  handlePreviewWheel,
  handleDownload,
  handleDelete,
  handleEdit,
}: AssetPreviewSurfaceProps) => {
  if (!currentAsset) return null;

  const hasMultipleItems = assets.length > 1;
  const hasPrevious = selectedIndex > 0;
  const hasNext = selectedIndex < assets.length - 1;

  return (
    <RouteFullscreenSurface
      onClose={closePreview}
      animated
      header={
        <div className="flex min-w-0 items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <span className="max-w-md truncate">{currentAsset.name}</span>
          {currentAsset.extension && <Badge>{currentAsset.extension}</Badge>}
        </div>
      }
      headerActions={
        <>
          <Button
            type="button"
            size="xs"
            variant="formDark"
            onClick={handleDelete}
            aria-label="Delete asset"
          >
            <Trash2 className="size-3" />
          </Button>
          <Button
            type="button"
            size="xs"
            variant="formDark"
            onClick={handleDownload}
            aria-label="Download asset"
          >
            <Download className="size-3" />
          </Button>
          <Button
            type="button"
            size="xs"
            className="text-primary"
            variant="formDark"
            onClick={handleEdit}
          >
            Edit
          </Button>
        </>
      }
      bodyClassName="relative flex items-center justify-center overflow-hidden bg-linear-to-br from-zinc-900 to-black p-4"
      footerClassName="px-4 py-2"
      footer={
        <div className="grid w-full grid-cols-3 items-center gap-4">
          <div />
          <div className="flex justify-center">
            <AssetPreviewCarousel
              assets={assets}
              selectedIndex={selectedIndex}
              onSelect={setCurrentAsset}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            {hasMultipleItems && (
              <>
                <div className="flex items-center gap-1 text-xs">
                  Navigation
                  <Kbd className="border bg-white dark:bg-sidebar">←</Kbd>
                  <Kbd className="border bg-white dark:bg-sidebar">→</Kbd>
                  <span className="ml-0.5 text-[10px] text-muted-foreground">
                    / Wheel
                  </span>
                  <span className="px-1 opacity-30">|</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {selectedIndex + 1} / {assets.length}
                </span>
              </>
            )}
          </div>
        </div>
      }
    >
      <div
        onWheel={handlePreviewWheel}
        className="absolute inset-0 flex items-center justify-center"
      >
        {hasMultipleItems && hasPrevious && (
          <Button
            type="button"
            variant="formDark"
            size="icon"
            className="absolute left-4 top-1/2 z-30 size-12 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70"
            onClick={goToPrevious}
            aria-label="Previous asset"
          >
            <PreviousArrowIcon className="size-4" />
          </Button>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={currentAsset.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="h-full w-full"
          >
            <AssetBlockMap
              variant="preview"
              type="asset"
              fileType={currentAsset.fileType || "unsupported"}
              src={currentAsset.src}
              alt={currentAsset.alt || currentAsset.name}
              name={currentAsset.name}
            />
          </motion.div>
        </AnimatePresence>

        {hasMultipleItems && hasNext && (
          <Button
            type="button"
            variant="formDark"
            size="icon"
            className="absolute right-4 top-1/2 z-30 size-12 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70"
            onClick={goToNext}
            aria-label="Next asset"
          >
            <NextArrowIcon className="size-4" />
          </Button>
        )}
      </div>
    </RouteFullscreenSurface>
  );
};
