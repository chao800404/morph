import { PageSpinner } from "@/components/loading/page-spinner";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { Button } from "@/components/ui/button";
import { AssetPreviewSurface } from "./component/asset-preview-surface";
import { useAssetPreviewController } from "./hooks/use-asset-preview-controller";

const AssetPreview = () => {
  const controller = useAssetPreviewController();

  if (controller.status === "pending") return <PageSpinner />;

  if (controller.errorMessage || !controller.currentAsset) {
    return (
      <RouteFullscreenSurface
      label="Asset preview" onClose={controller.closePreview}>
        <div className="flex size-full items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              {controller.errorMessage || "No assets are available to preview."}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={controller.closePreview}
            >
              Back to Assets
            </Button>
          </div>
        </div>
      </RouteFullscreenSurface>
    );
  }

  return <AssetPreviewSurface {...controller} />;
};

export default AssetPreview;
