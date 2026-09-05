import { AssetGrid } from "@/components/asset/asset-grid";
import type { SelectedAsset } from "@/components/asset/asset-tile";
import { CardPagination } from "@/components/dashboard/card-pagination";
import { Button } from "@/components/ui/button";
import { focusRing } from "@/components/ui/field-control";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ASSET_QUERY_KEY } from "@/lib/asset/query-key";
import { listItemsServerFn } from "@/server/asset/list-items.serverFn";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  Play,
  Search,
} from "lucide-react";
import { useState } from "react";
import { useDebouncedCallback } from "use-debounce";

const PAGE_SIZE = 12;

/** Shared, authenticated Asset-library browser for CMS and Dashboard fields. */
export function AssetLibraryPicker({
  assetType,
  selectedIds,
  onToggle,
  atLimit = false,
  disabled = false,
  className,
}: {
  assetType: "image" | "video";
  selectedIds: string[];
  onToggle: (asset: SelectedAsset) => void;
  atLimit?: boolean;
  /** A disabled field must not be able to pick, not merely look inert. */
  disabled?: boolean;
  className?: string;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const noun = assetType === "image" ? "images" : "videos";
  const applyTerm = useDebouncedCallback((value: string) => {
    setTerm(value);
    setPage(1);
  }, 400);

  const params = {
    folderId,
    query: term || undefined,
    type: assetType,
    sortBy: ["createdAt"] as const,
    sortOrder: ["desc"] as const,
    page,
    limit: PAGE_SIZE,
  };
  const { data, isPending, isError, refetch, isFetching } = useQuery(
    queryOptions({
      queryKey: [...ASSET_QUERY_KEY, "library-picker", params],
      queryFn: () => listItemsServerFn({ data: params }),
      placeholderData: keepPreviousData,
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
            aria-label={`Search ${noun}`}
            placeholder={`Search ${noun}`}
            defaultValue={term}
            onChange={(event) => applyTerm(event.target.value)}
          />
        </InputGroup>
      </div>

      <div className="h-64 overflow-y-auto rounded-md-plus border border-border/60 p-2">
        {isPending ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : isError || (data && !data.success) ? (
          // A failed request used to fall through to the empty state, which
          // reads as "you have no images" — the one conclusion the request
          // cannot support.
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              {(data && !data.success && data.message) ||
                `Could not load ${noun}.`}
            </p>
            <Button
              type="button"
              variant="form"
              size="xs"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {isFetching ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : folders.length === 0 && assets.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {term
              ? `No ${noun} match \"${term}\".`
              : `This folder has no ${noun} yet. Add one in Assets.`}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
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
                const id = String(asset.id);
                const isSelected = selected.has(id);
                const itemDisabled = disabled || (atLimit && !isSelected);
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={itemDisabled}
                    aria-pressed={isSelected}
                    title={asset.name}
                    onClick={() =>
                      onToggle({
                        id,
                        name: asset.name,
                        url: asset.url,
                        type: assetType,
                        thumbnailUrl: asset.thumbnailUrl,
                      })
                    }
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-md-plus border bg-muted",
                      "transition-[border-color,box-shadow] disabled:opacity-50",
                      focusRing,
                      isSelected &&
                        "border-primary/50 ring-[1.5px] ring-inset ring-primary/50",
                    )}
                  >
                    {assetType === "video" ? (
                      asset.thumbnailUrl ? (
                        <img
                          src={asset.thumbnailUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-muted">
                          <Play className="size-6 text-muted-foreground" />
                        </div>
                      )
                    ) : (
                      <img
                        src={asset.url}
                        alt={asset.name}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-1.5 py-1 text-left text-[10px] backdrop-blur-sm">
                      {asset.name}
                    </span>
                    {isSelected ? (
                      <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md border bg-background/85 text-emerald-500 shadow-sm">
                        <Check className="size-3.5" strokeWidth={3} />
                      </span>
                    ) : null}
                  </button>
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
}
