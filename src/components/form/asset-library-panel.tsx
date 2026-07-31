import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { focusRing } from "@/components/ui/field-control";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { assetQueries } from "@queries/asset.queries";
import { CardPagination } from "@/routes/_backend/dashboard/-components/card-pagination/card-pagination";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Folder, Search } from "lucide-react";
import { useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { AssetGrid } from "@/components/asset/asset-grid";
import { AssetTile, type SelectedAsset } from "@/components/asset/asset-tile";

/**
 * Browse the asset library and pick from it.
 *
 * Deliberately not `AssetsExplorerCard`: that is the Assets page's file manager,
 * and its selection lives in the global `useAssetsStore`, where "selected" means
 * "queued for bulk delete or move". Picking images for a product must not touch
 * that. What is reused instead is the layer underneath — the same `assetQueries`
 * and server function — so this adds no backend surface.
 *
 * Selection is controlled by the caller for the same reason: several of these
 * can be on screen at once (a gallery plus a thumbnail), and each belongs to a
 * different field.
 */
const PAGE_SIZE = 12;

export const AssetLibraryPanel = ({
  selectedIds,
  onToggle,
  atLimit = false,
  className,
}: {
  selectedIds: string[];
  onToggle: (asset: SelectedAsset) => void;
  /** Blocks tiles that are not already picked, once the field is full. */
  atLimit?: boolean;
  className?: string;
}) => {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);

  // Typing narrows the list without a request per keystroke, and any change
  // resets to the first page — page 3 of a narrower result set is empty.
  const applyTerm = useDebouncedCallback((value: string) => {
    setTerm(value);
    setPage(1);
  }, 400);

  const { data, isPending } = useQuery(
    assetQueries.list({
      folderId,
      query: term || undefined,
      // A product gallery holds images. Videos and models are in the library
      // too, and offering them here would only produce a broken <img>.
      type: "image",
      sortBy: ["createdAt"],
      sortOrder: ["desc"],
      page,
      limit: PAGE_SIZE,
    }),
  );

  const payload = data?.success ? data.data : null;
  const folders = payload?.folders ?? [];
  const assets = payload?.assets ?? [];
  const pagination = payload?.pagination;
  const currentFolder = payload?.currentFolder;
  const selected = new Set(selectedIds);

  const openFolder = (id: string | null) => {
    setFolderId(id);
    setPage(1);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        {folderId ? (
          <Button
            type="button"
            variant="form"
            size="xs"
            onClick={() => openFolder(currentFolder?.parentId ?? null)}
          >
            <ChevronLeft className="size-4" />
            {currentFolder?.name ?? "Back"}
          </Button>
        ) : null}
        <InputGroup variant="card" size="sm" className="flex-1">
          <InputGroupAddon>
            <Search className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search images"
            defaultValue={term}
            onChange={(event) => applyTerm(event.target.value)}
          />
        </InputGroup>
      </div>

      {/* Fixed height with its own scroll: the field sits inside a form that
          already scrolls, and a panel that grows with the library would push
          the rest of the step off screen. */}
      <div className="h-64 overflow-y-auto rounded-md-plus border border-border/60 p-2">
        {isPending ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : folders.length === 0 && assets.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {term
              ? `No images match "${term}".`
              : "This folder has no images yet. Upload one on the other tab."}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Full-width rows, not tiles. A folder has nothing to show but its
                name, so a square gives it the same weight as an image while
                pushing the images the author actually came for off screen. */}
            {folders.length > 0 ? (
              <div className="flex flex-col gap-1">
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => openFolder(String(folder.id))}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-md-plus border border-dashed px-3",
                      "text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50",
                      focusRing,
                    )}
                  >
                    <Folder className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {folder.name}
                    </span>
                    <ChevronRight className="size-4 shrink-0" />
                  </button>
                ))}
              </div>
            ) : null}

            <AssetGrid>
              {assets.map((asset) => {
                const isSelected = selected.has(String(asset.id));
                return (
                  <AssetTile
                    key={asset.id}
                    asset={{
                      id: String(asset.id),
                      name: asset.name,
                      url: asset.url,
                    }}
                    selected={isSelected}
                    disabled={atLimit && !isSelected}
                    onClick={() =>
                      onToggle({
                        id: String(asset.id),
                        name: asset.name,
                        url: asset.url,
                      })
                    }
                  />
                );
              })}
            </AssetGrid>
          </div>
        )}
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <CardPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          itemsLength={pagination.totalAssets}
          startItem={(pagination.page - 1) * pagination.limit + 1}
          endItem={Math.min(
            pagination.page * pagination.limit,
            pagination.totalAssets,
          )}
          onPageChange={(action) =>
            setPage((current) => {
              if (action === "first") return 1;
              if (action === "last") return pagination.totalPages;
              if (action === "prev") return Math.max(current - 1, 1);
              return Math.min(current + 1, pagination.totalPages);
            })
          }
        />
      ) : null}
    </div>
  );
};
