import { ASSET_QUERY_KEY } from "@/lib/asset/query-key";
import {
  mediaAssetDetails,
  mediaAssetLocation,
} from "@/lib/asset/media-asset-identity";
import { getMediaAsset } from "@/server/asset/get-media-asset.serverFn";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Folder } from "lucide-react";

export const mediaAssetQuery = (assetId: string) =>
  queryOptions({
    queryKey: [...ASSET_QUERY_KEY, "media-asset", assetId],
    queryFn: () => getMediaAsset({ data: { assetId } }),
  });

/**
 * Where the asset a media field points at lives in the library, looked up by
 * id so a move or rename shows here without the Document changing.
 */
export function EditorMediaAssetIdentity({
  assetId,
  storedName,
}: {
  assetId: string;
  /** The name recorded when the asset was picked; shown only as a fallback. */
  storedName?: string;
}) {
  const { data, isPending } = useQuery(mediaAssetQuery(assetId));

  if (isPending) {
    return (
      <p className="truncate text-[11px] text-muted-foreground">
        Loading asset…
      </p>
    );
  }

  const lookup = data?.success ? data.data : null;

  if (lookup?.status === "found") {
    const location = mediaAssetLocation(lookup.asset);
    const details = mediaAssetDetails(lookup.asset);
    return (
      <div className="min-w-0 space-y-0.5" data-testid="media-asset-identity">
        <p
          className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-foreground"
          title={location}
        >
          <Folder
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="truncate">{location}</span>
        </p>
        {details ? (
          <p className="truncate text-[10px] text-muted-foreground">
            {details}
          </p>
        ) : null}
      </div>
    );
  }

  if (lookup?.status === "missing") {
    return (
      <p
        role="status"
        className="flex min-w-0 items-center gap-1 text-[11px] text-destructive"
      >
        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {storedName
            ? `“${storedName}” was deleted from the Asset library`
            : "This asset was deleted from the Asset library"}
        </span>
      </p>
    );
  }

  return (
    <p className="truncate text-[11px] text-muted-foreground">
      {storedName ?? "Asset details unavailable"}
    </p>
  );
}
