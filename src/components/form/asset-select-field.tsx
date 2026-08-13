import {
  Dropzone,
  DropzoneEmptyState,
} from "@/components/ui/shadcn-io/dropzone";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AssetSelectFormField } from "@/lib/validations/form";
import { MAX_ASSETS_PER_RECORD } from "@/lib/config/upload-limits";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Images, Star } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import type { SelectedAsset } from "@/components/asset/asset-tile";
import { SortableAssetGrid } from "@/components/asset/sortable-asset-grid";
import { AssetGrid } from "@/components/asset/asset-grid";
import { AssetTile } from "@/components/asset/asset-tile";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  fieldControlDensity,
  fieldControlVariants,
} from "@/components/ui/field-control";
import { ASSET_QUERY_KEY } from "@/lib/asset/query-key";

/**
 * Loaded on demand, for two reasons that point the same way: the Library tab is
 * opt-in, and the panel reaches `assetQueries` — which reaches server
 * functions. `FieldsRenderer` is in `cms.config`'s static module graph, so a
 * static edge here would drag the whole server graph into config evaluation.
 */
const AssetLibraryPanel = lazy(() =>
  import("./asset-library-panel").then((module) => ({
    default: module.AssetLibraryPanel,
  })),
);

/**
 * Pick images for a record, by uploading them or by taking them from the
 * library.
 *
 * They are one control rather than two because they are one thing in the
 * database: `product_assets.assetId` is a foreign key into `assets`, so an
 * upload is not an alternative to picking — it is how a new asset id comes into
 * existence. Both tabs write the same value.
 *
 * Uploading happens on drop, not on submit. The value stays a plain list of
 * asset ids, the record's own create call never has to touch R2, and a failed
 * save does not lose the files. The cost is that abandoning the form leaves the
 * images in the library — which in this product is where images live anyway.
 *
 * The value travels as a JSON string, the same transport `metadata` uses:
 * `FormFieldValue` has no object member, and a tile needs the name and url, not
 * just the id.
 *
 * Order is part of the value. The server writes it as `rank` and takes the
 * first entry as the record's thumbnail, so dragging an image to the front is
 * how the thumbnail is chosen — there is no separate control for it.
 */

export const parseSelectedAssets = (value: string): SelectedAsset[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SelectedAsset =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SelectedAsset).id === "string",
    );
  } catch {
    return [];
  }
};

export const serializeSelectedAssets = (assets: SelectedAsset[]): string =>
  JSON.stringify(assets);

export const AssetSelectField = ({
  field,
  fieldId,
  value,
  onChange,
  className,
}: {
  field: AssetSelectFormField;
  fieldId: string;
  value: string;
  onChange?: (value: string) => void;
  className?: string;
}) => {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  /**
   * The selection lives here, seeded from `value`, the way `MetadataField`
   * holds its entries.
   *
   * `RouteFormPage` renders fields declaratively and passes no `onChange` — it
   * submits the form natively — so a field that only reported upwards would
   * never change anything on an edit page. `onChange` is a notification for
   * callers that do keep their own copy, such as the create wizard's draft.
   */
  const [selected, setSelected] = useState<SelectedAsset[]>(() =>
    parseSelectedAssets(value),
  );
  // The store's own ceiling, the same one the server validates against. A
  // field may narrow it (a single cover image), never widen it.
  const maxSelected = Math.min(
    field.maxSelected ?? Number.POSITIVE_INFINITY,
    MAX_ASSETS_PER_RECORD,
  );
  const atLimit = selected.length >= maxSelected;
  const restricted = field.availableAssets !== undefined;
  const available = (field.availableAssets ?? []).filter(
    (asset) => !selected.some((item) => item.id === asset.id),
  );

  /**
   * Never trims. An earlier version capped the list here, which meant a record
   * holding more images than the current limit lost the extras simply by being
   * opened and saved. Adding past the limit is refused at the point of adding,
   * where there is someone to tell.
   */
  const commit = (next: SelectedAsset[]) => {
    setSelected(next);
    onChange?.(serializeSelectedAssets(next));
  };

  const toggle = (asset: SelectedAsset) => {
    const exists = selected.some((item) => item.id === asset.id);
    if (exists) {
      commit(selected.filter((item) => item.id !== asset.id));
      return;
    }
    if (atLimit) {
      toast.error(`You can select up to ${maxSelected} images`, {
        position: "top-center",
      });
      return;
    }
    commit([...selected, asset]);
  };

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    // Checked before the request, not after: assets uploaded and then dropped
    // for want of room would still exist in the library, attached to nothing.
    if (selected.length + files.length > maxSelected) {
      toast.error(
        `You can select up to ${maxSelected} images. Remove some first.`,
        { position: "top-center" },
      );
      return;
    }
    setUploading(true);

    // Dropzone gives back real `File`s, and `createItems` reads them off
    // FormData, so this posts the same shape the Assets create page does rather
    // than a second upload path.
    const formData = new FormData();
    for (const file of files) formData.append("assets", file);
    if (field.uploadFolderId) {
      formData.set("parent-id", field.uploadFolderId);
    }

    try {
      // Imported here, not at the top: a static edge from a field to a server
      // function closes a cycle through `get-config`, which strands whichever
      // module is mid-evaluation — usually after an HMR reload.
      const { createItems } =
        await import("@/server/asset/create-items.serverFn");
      const result = await createItems({ data: formData });

      if (!result.success || !result.createdAssets?.length) {
        toast.error(result.message || "Failed to upload images", {
          position: "top-center",
        });
        return;
      }

      // The library list is now stale — the new rows belong in it.
      void queryClient.invalidateQueries({ queryKey: ASSET_QUERY_KEY });

      commit([...selected, ...result.createdAssets]);
      toast.success(result.message, { position: "top-center" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload images",
        { position: "top-center" },
      );
    } finally {
      setUploading(false);
    }
  };

  const selectedGrid =
    selected.length > 0 ? (
      <SortableAssetGrid
        assets={selected}
        onReorder={commit}
        onRemove={(asset) =>
          commit(selected.filter((item) => item.id !== asset.id))
        }
        renderBadge={(_asset, index) =>
          index === 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <Star className="size-3 fill-current" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Thumbnail — drag another image here to change it
              </TooltipContent>
            </Tooltip>
          ) : null
        }
      />
    ) : null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Carries the value on a native submit, the way `option-values` does —
          the tiles and tabs are not form controls. Driven by the field's own
          state, not the prop, or an edit page would always submit what it
          loaded. */}
      <input
        type="hidden"
        name={field.name}
        value={serializeSelectedAssets(selected)}
      />

      {restricted ? (
        <Collapsible open={mediaOpen} onOpenChange={setMediaOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                fieldControlVariants({ variant: "card" }),
                fieldControlDensity.compact,
                "flex w-full items-center gap-3 text-left",
              )}
            >
              {selected[0] ? (
                <img
                  src={selected[0].url}
                  alt=""
                  className="size-9 shrink-0 rounded-md border object-cover"
                />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
                  <Images className="size-4" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Variant media</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {selected.length > 0
                    ? `${selected.length} image${selected.length === 1 ? "" : "s"} selected`
                    : "Use images from Product Media"}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  mediaOpen && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-3 flex flex-col gap-4">
            {selectedGrid ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Selected</p>
                  <p className="text-xs text-muted-foreground">
                    Drag to reorder · first image is the thumbnail
                  </p>
                </div>
                {selectedGrid}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Product media</p>
              {available.length > 0 ? (
                <div className="max-h-80 overflow-y-auto rounded-md-plus border border-border/60 p-2">
                  <AssetGrid>
                    {available.map((asset) => (
                      <AssetTile
                        key={asset.id}
                        asset={asset}
                        disabled={atLimit}
                        onClick={() => toggle(asset)}
                      />
                    ))}
                  </AssetGrid>
                </div>
              ) : (
                <div className="rounded-md-plus border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
                  {field.availableAssets?.length
                    ? "All Product Media images are selected."
                    : "Add images to Product Media before assigning them to this variant."}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <>
          {selectedGrid}
          <Tabs defaultValue="upload">
            <TabsList aria-label="How to add images">
              <TabsTrigger value="upload">Upload</TabsTrigger>
              <TabsTrigger value="library">Library</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-3">
              <Dropzone
                accept={{ "image/*": [] }}
                maxFiles={Math.max(maxSelected - selected.length, 1)}
                disabled={field.disabled || uploading || atLimit}
                onDrop={(files) => void upload(files)}
                onError={(error) =>
                  toast.error(error.message ?? "Failed to read the file", {
                    position: "top-center",
                  })
                }
                variant="card"
                inputId={fieldId}
                className="cursor-pointer"
              >
                {uploading ? (
                  <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Uploading...
                  </div>
                ) : (
                  <DropzoneEmptyState />
                )}
              </Dropzone>
            </TabsContent>

            <TabsContent value="library" className="mt-3">
              <Suspense
                fallback={
                  <div className="flex h-64 items-center justify-center">
                    <Spinner className="size-4 text-muted-foreground" />
                  </div>
                }
              >
                <AssetLibraryPanel
                  selectedIds={selected.map((asset) => asset.id)}
                  onToggle={toggle}
                  atLimit={atLimit}
                />
              </Suspense>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
};
