import { AssetLibraryPicker } from "@/components/asset/asset-library-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  normalizeThemeMediaValue,
  type ThemeMediaKind,
  type ThemeMediaValue,
} from "@/lib/storefront/theme-media";
import { ExternalLink, Image as ImageIcon, Library, Video } from "lucide-react";
import { useState } from "react";

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

  return (
    <div
      className={cn(
        "w-full min-w-0 space-y-2 rounded-lg border bg-muted/20 p-1.5 shadow-xs",
        isFocused && "bg-primary/10 ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <PreviewIcon className="size-3 shrink-0" />
          <span className="truncate capitalize">{label}</span>
        </span>
        {normalized.url ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            className="h-6 px-1.5 text-[10px]"
            onClick={() =>
              // Cleared in whichever source this field allows. Always emitting
              // an `external` empty value made Clear fail validation on a
              // field declared `allowExternal: false` — the control offered an
              // action its own rules rejected.
              // One canonical empty, which the server accepts for any field
              // regardless of which sources it allows. Emitting an asset-shaped
              // empty instead just traded one rejected shape for another: the
              // id has to be a UUID.
              onChange({ source: "external", mediaType, url: "" })
            }
          >
            Clear
          </Button>
        ) : null}
      </div>

      {normalized.url ? (
        <div className="relative h-28 overflow-hidden rounded-md border bg-background">
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
        </div>
      ) : null}

      <Tabs
        value={source}
        onValueChange={(next) => setSource(next as "external" | "asset")}
        className="gap-2"
      >
        <TabsList className="h-7 w-full">
          {allowExternal ? (
            <TabsTrigger value="external" className="h-6 text-[10px]">
              <ExternalLink className="size-3" /> External URL
            </TabsTrigger>
          ) : null}
          {allowAsset ? (
            <TabsTrigger value="asset" className="h-6 text-[10px]">
              <Library className="size-3" /> Assets
            </TabsTrigger>
          ) : null}
        </TabsList>
        {allowExternal ? (
          <TabsContent value="external">
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
          </TabsContent>
        ) : null}
        {allowAsset ? (
          <TabsContent value="asset" className="space-y-2">
            <AssetLibraryPicker
              assetType={mediaType}
              // Without this a disabled field still emitted changes: the
              // control looked inert and was not.
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
            <a
              href="/dashboard/assets"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Manage Assets <ExternalLink className="size-3" />
            </a>
          </TabsContent>
        ) : null}
      </Tabs>
      {description ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
