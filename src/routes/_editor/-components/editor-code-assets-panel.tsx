import type { SelectedAsset } from "@/components/asset/asset-tile";
import { AssetLibraryPicker } from "@/components/asset/asset-library-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Copy, Info } from "lucide-react";
import { useState } from "react";
import { EditorMediaAssetIdentity } from "./editor-media-asset-identity";

/**
 * The Asset library, browsable from Code mode.
 *
 * It never hands out a library URL to write into Theme source. A library
 * image is chosen through a content field, which stores the asset's id and is
 * what publishing, the preview and the library's deletion guard all read; a
 * URL in source would be invisible to all three. What code can use instead is
 * a copy in the Theme's own `public/` (`onCopyToPublic`), which the Theme then
 * owns and publishes like any file of its own.
 */
export function EditorCodeAssetsPanel({
  onCopyToPublic,
}: {
  /** Offered for an image when given; the caller confirms and copies. */
  onCopyToPublic?: (asset: SelectedAsset) => void;
} = {}) {
  const [assetType, setAssetType] = useState<"image" | "video">("image");
  const [viewed, setViewed] = useState<SelectedAsset | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
      <div
        role="group"
        aria-label="Asset kind"
        className="flex h-7 items-center gap-0.5 rounded-md border bg-muted/30 p-0.5"
      >
        {(["image", "video"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={assetType === kind}
            onClick={() => {
              setAssetType(kind);
              setViewed(null);
            }}
            className={cn(
              "h-6 flex-1 rounded-sm text-[11px] font-medium capitalize text-muted-foreground",
              assetType === kind && "bg-background text-foreground shadow-sm",
            )}
          >
            {kind === "image" ? "Images" : "Videos"}
          </button>
        ))}
      </div>

      <AssetLibraryPicker
        key={assetType}
        assetType={assetType}
        selectedIds={viewed ? [viewed.id] : []}
        paginationLayout="stacked"
        onToggle={(asset) =>
          setViewed((current) => (current?.id === asset.id ? null : asset))
        }
      />

      {viewed ? (
        <section
          aria-label="Asset details"
          className="space-y-2 rounded-lg border bg-muted/20 p-2"
        >
          <div
            style={{ background: "var(--gradient-checker-board)" }}
            className="flex h-36 items-center justify-center overflow-hidden rounded-md border"
          >
            {assetType === "image" ? (
              <img
                src={viewed.url}
                alt={viewed.name}
                className="size-full object-contain p-1.5"
              />
            ) : (
              <video
                src={viewed.url}
                className="size-full object-contain"
                controls
                muted
                playsInline
              />
            )}
          </div>
          <EditorMediaAssetIdentity
            assetId={viewed.id}
            storedName={viewed.name}
          />
          {onCopyToPublic && assetType === "image" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onCopyToPublic(viewed)}
              data-copy-asset-to-public-open
            >
              <Copy className="size-3.5" />
              Copy to public/…
            </Button>
          ) : null}
        </section>
      ) : null}

      <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        <span>
          To let editors change an image, choose it in a content field&apos;s
          Assets picker. To use one in code by URL, copy it into public/: the
          copy belongs to the site and is public once published.
        </span>
      </p>
    </div>
  );
}
