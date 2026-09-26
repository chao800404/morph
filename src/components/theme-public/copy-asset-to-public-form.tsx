import type { SelectedAsset } from "@/components/asset/asset-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { publicFileDestination } from "@/lib/storefront/editor/public-file-operations";
import {
  THEME_PUBLIC_DIRECTORY,
  themePublicUrlPath,
} from "@/lib/storefront/theme-public-files";
import { useState } from "react";

/**
 * Where a library asset is copied in `public/`, and what that means, before
 * the copy is made: a snapshot the Theme owns, public at its URL once
 * published, and untouched by later changes to the asset in the library.
 * Code mode's Assets panel and the Assets page's "Site public/" both use it.
 */
export function CopyAssetToPublicForm({
  asset,
  suggestedPath,
  existingPaths,
  pending = false,
  onCancel,
  onConfirm,
}: {
  asset: SelectedAsset;
  /** A full path under `public/`. */
  suggestedPath: string;
  existingPaths: ReadonlySet<string>;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (path: string) => void;
}) {
  const [value, setValue] = useState(
    suggestedPath.slice(THEME_PUBLIC_DIRECTORY.length),
  );
  const destination = publicFileDestination(value);
  const problem = !destination.ok
    ? destination.reason
    : existingPaths.has(destination.path)
      ? `${destination.path} already exists.`
      : null;
  const url = destination.ok ? themePublicUrlPath(destination.path) : null;

  return (
    <form
      className="space-y-3"
      data-copy-asset-to-public
      onSubmit={(event) => {
        event.preventDefault();
        if (destination.ok && !problem) onConfirm(destination.path);
      }}
    >
      <div className="flex items-center gap-3">
        <div
          style={{ background: "var(--gradient-checker-board)" }}
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border"
        >
          <img
            src={asset.thumbnailUrl ?? asset.url}
            alt=""
            className="size-full object-contain"
          />
        </div>
        <div className="min-w-0 text-sm">
          <div className="truncate font-medium">{asset.name}</div>
          <div className="text-xs text-muted-foreground">From Assets</div>
        </div>
      </div>

      <label className="block space-y-1 text-xs font-medium">
        <span>Path in public/</span>
        <span className="flex items-center gap-1 font-mono text-sm font-normal">
          <span className="text-muted-foreground">public/</span>
          <Input
            aria-label="Path in public/"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
          />
        </span>
      </label>
      {problem ? (
        <p className="text-xs text-destructive" data-copy-asset-problem>
          {problem}
        </p>
      ) : url ? (
        <p className="text-xs text-muted-foreground">
          Your code can use it as <span className="font-mono">{url}</span>.
        </p>
      ) : null}

      <p
        className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground"
        data-copy-asset-notice
      >
        This makes a copy that belongs to your site. Once you publish, anyone
        can open it at its URL, and it cannot be made private. Changing or
        deleting the asset in Assets later does not change this copy.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || problem !== null}>
          Copy to public/
        </Button>
      </div>
    </form>
  );
}
