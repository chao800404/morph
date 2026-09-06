import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  normalizeThemeMediaValue,
  type ThemeMediaKind,
  type ThemeMediaValue,
} from "@/lib/storefront/theme-media";
import { Image as ImageIcon, Video } from "lucide-react";
import { useState } from "react";
import { EditorMediaPickerPopover } from "./editor-media-picker-popover";
import { inspectorControlSurface } from "./style-inspector/inspector-control-surface";

export function EditorMediaField({
  label,
  description,
  mediaType,
  value,
  allowExternal = true,
  allowAsset = true,
  disabled,
  isFocused = false,
  altText,
  onAltPreview,
  onAltChange,
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
  altText?: string;
  onAltPreview?: (value: string) => void;
  onAltChange?: (value: string) => void;
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
  const showSourceControls = allowExternal || allowAsset;

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
        {showSourceControls ? (
          <div
            role="group"
            aria-label="Media source kind"
            className={cn(
              inspectorControlSurface,
              "flex h-7 shrink-0 items-center gap-0.5 p-0.5",
            )}
          >
            {allowExternal ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={disabled || source === "external"}
                className={cn(
                  "h-6 rounded-sm px-2 text-[10px] font-medium",
                  source === "external"
                    ? "bg-background text-foreground shadow-sm hover:bg-background"
                    : "text-muted-foreground",
                )}
                onClick={() => setSource("external")}
              >
                External URL
              </Button>
            ) : null}
            {allowAsset ? (
              <EditorMediaPickerPopover
                label={label}
                assetType={mediaType}
                selectedIds={
                  normalized.source === "asset" ? [normalized.assetId] : []
                }
                disabled={disabled}
                onSelect={(asset) =>
                  onChange({
                    source: "asset",
                    mediaType,
                    assetId: asset.id,
                    url: asset.url,
                    ...(asset.name ? { name: asset.name } : {}),
                  })
                }
                trigger={
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    className={cn(
                      "h-6 rounded-sm px-2 text-[10px] font-medium",
                      source === "asset"
                        ? "bg-background text-foreground shadow-sm hover:bg-background"
                        : "text-muted-foreground",
                    )}
                    onClick={() => setSource("asset")}
                  >
                    Assets
                  </Button>
                }
              />
            ) : null}
          </div>
        ) : normalized.url ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            className="h-6 px-1.5 text-[10px]"
            onClick={() => onChange({ source: "external", mediaType, url: "" })}
          >
            Clear
          </Button>
        ) : null}
      </div>

      <div
        style={
          normalized.url
            ? { background: "var(--gradient-checker-board)" }
            : undefined
        }
        className={cn(
          "group/preview relative flex h-28 items-center justify-center overflow-hidden rounded-md border",
          normalized.url ? null : "border-dashed bg-muted/30",
        )}
        role="img"
        aria-label={normalized.url ? `${label} preview` : `No ${noun} selected`}
      >
        {normalized.url ? (
          mediaType === "image" ? (
            <img
              src={normalized.url}
              alt=""
              className="size-full object-contain p-1.5"
            />
          ) : (
            <video
              src={normalized.url}
              className="size-full object-contain"
              controls
              muted
              playsInline
            />
          )
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <PreviewIcon className="size-6" aria-hidden="true" />
            <span className="text-[11px]">No {noun} selected</span>
          </div>
        )}
        {normalized.url && showSourceControls ? (
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={disabled}
            className="absolute top-1.5 right-1.5 h-6 px-2 text-[10px] bg-background/80 hover:bg-background shadow-xs backdrop-blur-xs"
            onClick={() => onChange({ source: "external", mediaType, url: "" })}
          >
            Clear
          </Button>
        ) : null}
      </div>

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

      {onAltChange ? (
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-muted-foreground">
            Alt text
          </label>
          <Input
            key={altText ?? ""}
            defaultValue={altText ?? ""}
            maxLength={200}
            aria-label={`${label} alt text`}
            onInput={(event) => onAltPreview?.(event.currentTarget.value)}
            onBlur={(event) => onAltChange(event.currentTarget.value)}
            disabled={disabled}
            placeholder="Describe this image"
            className="h-7 text-xs"
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
