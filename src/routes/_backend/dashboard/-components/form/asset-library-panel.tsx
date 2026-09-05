import { AssetLibraryPicker } from "@/components/asset/asset-library-picker";
import type { SelectedAsset } from "@/components/asset/asset-tile";

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
export const DashboardAssetLibraryPanel = ({
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
  return (
    <AssetLibraryPicker
      assetType="image"
      selectedIds={selectedIds}
      onToggle={onToggle}
      atLimit={atLimit}
      className={className}
    />
  );
};
