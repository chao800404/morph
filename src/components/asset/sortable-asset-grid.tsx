import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { useMemo, type ReactNode } from "react";
import { AssetGrid } from "./asset-grid";
import { AssetTile, type SelectedAsset } from "./asset-tile";
import { moveAsset } from "./reorder-assets";

/**
 * An asset grid whose order the author can change by dragging.
 *
 * The order is data, not presentation: `product_assets.rank` is written from
 * this array, and its first entry becomes the product's thumbnail. That is why
 * there is no separate "make this the thumbnail" control — moving an image to
 * the front is the same action.
 *
 * Built on the `@dnd-kit` provider the Assets explorer already uses rather than
 * a second drag library, and it lives here rather than in the product feature
 * so variant galleries get it for free.
 */
const SortableTile = ({
  asset,
  index,
  badge,
  onRemove,
}: {
  asset: SelectedAsset;
  index: number;
  badge?: ReactNode;
  onRemove?: () => void;
}) => {
  const { ref, isDragging } = useSortable({ id: asset.id, index });

  return (
    <AssetTile
      ref={ref}
      asset={asset}
      badge={badge}
      onRemove={onRemove}
      dragging={isDragging}
      sortable
    />
  );
};

export const SortableAssetGrid = ({
  assets,
  onReorder,
  onRemove,
  renderBadge,
  className,
}: {
  assets: SelectedAsset[];
  onReorder: (assets: SelectedAsset[]) => void;
  onRemove?: (asset: SelectedAsset) => void;
  /** Per-tile corner marker, e.g. the thumbnail star on the first one. */
  renderBadge?: (asset: SelectedAsset, index: number) => ReactNode;
  className?: string;
}) => {
  // The same 8px threshold the Assets explorer uses. Without it a press on the
  // tile's own remove button starts a drag instead of firing the click.
  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: [
          new PointerActivationConstraints.Distance({ value: 8 }),
        ],
      }),
    ],
    [],
  );

  return (
    <DragDropProvider
      sensors={sensors}
      onDragEnd={(event) => {
        // A cancelled drag has already been animated back; committing it here
        // would save an order the author explicitly abandoned.
        if (event.canceled) return;

        // Read the move off the sortable itself. `operation.target` is null
        // whenever the pointer is released between two tiles, and keying off it
        // meant the reorder was shown but never saved.
        const { source } = event.operation;
        if (!source || !isSortable(source)) return;

        const { initialIndex, index } = source.sortable;
        onReorder(moveAsset(assets, initialIndex, index));
      }}
    >
      <AssetGrid className={className}>
        {assets.map((asset, index) => (
          <SortableTile
            key={asset.id}
            asset={asset}
            index={index}
            badge={renderBadge?.(asset, index)}
            onRemove={onRemove ? () => onRemove(asset) : undefined}
          />
        ))}
      </AssetGrid>
    </DragDropProvider>
  );
};
