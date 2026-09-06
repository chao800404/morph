import { AssetLibraryPicker } from "@/components/asset/asset-library-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  normalizeThemeMediaValue,
  type ThemeMediaKind,
  type ThemeMediaValue,
} from "@/lib/storefront/theme-media";
import { ExternalLink, Image as ImageIcon, Video } from "lucide-react";
import { useState } from "react";
import { InspectorSegmentedSwitch } from "./style-inspector/inspector-segmented-switch";

export function EditorMediaField({
  label,
  description,
  mediaType,
  value,
  allowExternal = true,
  allowAsset = true,
  disabled,
  isFocused = false,
  onChange,
}: {
  label: string;
  description?: string;
  mediaType: ThemeMediaKind;
  value: unknown;
  allowExternal?: boolean;
  allowAsset?: boolean;
  disabled?: boolean;
  isFocused?: boolean;
  onChange: (value: ThemeMediaValue) => void;
}) {
  const normalized = normalizeThemeMediaValue(value, mediaType);
  const initialSource =
    normalized.source === "asset" && allowAsset
      ? "asset"
      : allowExternal
        ? "external"
        : "asset";
  const [source, setSource] = useState<"external" | "asset">(initialSource);
  const noun = mediaType === "image" ? "image" : "video";
  const PreviewIcon = mediaType === "image" ? ImageIcon : Video;
  const showSourceSwitch = allowExternal && allowAsset;

  return (
    <div
      className={cn(
        "w-full min-w-0 space-y-2 rounded-lg border p-1.5 transition-all",
        isFocused
          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
          : "bg-muted/20",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
          <PreviewIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate capitalize">{label}</span>
        </span>
        {showSourceSwitch ? (
          <InspectorSegmentedSwitch
            value={source}
            options={[
              { id: "external", label: "External URL" },
              { id: "asset", label: "Assets" },
            ]}
            disabled={disabled}
            ariaLabel="Media source kind"
            onChange={(next) => setSource(next as "external" | "asset")}
          />
        ) : normalized.url ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            className="h-6 px-1.5 text-[10px]"
            onClick={() =>
              onChange({ source: "external", mediaType, url: "" })
            }
          >
            Clear
          </Button>
        ) : null}
      </div>

      {normalized.url ? (
        <div className="group/preview relative h-28 overflow-hidden rounded-md border bg-background">
          {mediaType === "image" ? (
            <img
              src={normalized.url}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <video
              src={normalized.url}
              className="size-full object-cover"
              controls
              muted
              playsInline
            />
          )}
          {showSourceSwitch ? (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={disabled}
              className="absolute top-1.5 right-1.5 h-6 px-2 text-[10px] bg-background/80 hover:bg-background shadow-xs backdrop-blur-xs"
              onClick={() =>
                onChange({ source: "external", mediaType, url: "" })
              }
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {source === "external" && allowExternal ? (
        <div className="space-y-1">
          <label className="text-[11px] font-medium block text-muted-foreground">
            {mediaType === "image" ? "Image URL" : "Video URL"}
          </label>
          <Input
            key={normalized.source === "external" ? normalized.url : ""}
            type="url"
            defaultValue={
              normalized.source === "external" ? normalized.url : ""
            }
            disabled={disabled}
            placeholder={`https://example.com/${noun}`}
            className="h-7 text-xs font-mono"
            onBlur={(event) =>
              onChange({
                source: "external",
                mediaType,
                url: event.currentTarget.value.trim(),
              })
            }
          />
        </div>
      ) : null}

      {source === "asset" && allowAsset ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium block text-muted-foreground">
              Asset Library
            </label>
            <a
              href="/dashboard/assets"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Manage Assets <ExternalLink className="size-3" />
            </a>
          </div>
          <AssetLibraryPicker
            assetType={mediaType}
            disabled={disabled}
            selectedIds={
              normalized.source === "asset" ? [normalized.assetId] : []
            }
            onToggle={(asset) => {
              if (disabled) return;
              onChange({
                source: "asset",
                mediaType,
                assetId: asset.id,
                url: asset.url,
                name: asset.name,
              });
            }}
          />
        </div>
      ) : null}

      {description ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

