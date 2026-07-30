import {
  Dropzone,
  DropzoneEmptyState,
} from "@/components/ui/shadcn-io/dropzone";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { AssetSelectFormField } from "@/lib/validations/form";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { AssetTile, type SelectedAsset } from "./asset-tile";

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
  const selected = parseSelectedAssets(value);
  const maxSelected = field.maxSelected ?? 20;
  const atLimit = selected.length >= maxSelected;

  const commit = (next: SelectedAsset[]) =>
    onChange?.(serializeSelectedAssets(next.slice(0, maxSelected)));

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
      const [{ createItems }, { assetQueries }] = await Promise.all([
        import("@/server/asset/create-items.serverFn"),
        import("@queries/asset.queries"),
      ]);
      const result = await createItems({ data: formData });

      if (!result.success || !result.createdAssets?.length) {
        toast.error(result.message || "Failed to upload images", {
          position: "top-center",
        });
        return;
      }

      // The library list is now stale — the new rows belong in it.
      void queryClient.invalidateQueries({ queryKey: assetQueries.all() });

      const room = maxSelected - selected.length;
      commit([...selected, ...result.createdAssets.slice(0, room)]);
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

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Carries the value on a native submit, the way `option-values` does —
          the tiles and tabs are not form controls. */}
      <input type="hidden" name={field.name} value={value} />

      {selected.length > 0 ? (
        <div className="grid grid-cols-6 gap-2">
          {selected.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              onRemove={() =>
                commit(selected.filter((item) => item.id !== asset.id))
              }
            />
          ))}
        </div>
      ) : null}

      <Tabs defaultValue="upload">
        <TabsList aria-label="How to add images">
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-3">
          <Dropzone
            accept={{ "image/*": [] }}
            maxFiles={maxSelected}
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
    </div>
  );
};
