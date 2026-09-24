import type { SelectedAsset } from "@/components/asset/asset-tile";
import { AssetLibraryPicker } from "@/components/asset/asset-library-picker";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import { useState } from "react";
import { EditorMediaAssetIdentity } from "./editor-media-asset-identity";

/**
 * The Asset library, browsable from Code mode.
 *
 * Read-only on purpose. A library image is chosen through a content field,
 * which stores the asset's id and is what publishing, the preview and the
 * library's deletion guard all read. A reference written into Theme source
 * would be invisible to all three, so this panel lets an author find and
 * inspect assets without offering a way to hard-code one.
 */
export function EditorCodeAssetsPanel() {
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
        </section>
      ) : null}

      <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        <span>
          To use an asset, choose it in a content field&apos;s Assets picker.
          Referencing library assets directly from Theme code is not supported
          yet.
        </span>
      </p>
    </div>
  );
}
