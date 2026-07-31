import type { SelectedAsset } from "./asset-tile";

/**
 * Move one asset to another's position.
 *
 * Pure and separate from the grid because the ordering *is* the data here — the
 * first entry becomes the product's thumbnail — and the two directions are easy
 * to get wrong: dragging forwards and backwards land on different indices once
 * the item is removed from the list.
 *
 * Unknown ids are a no-op rather than an error: a drop can land after the list
 * has already changed underneath it.
 */
export const reorderAssets = (
  assets: SelectedAsset[],
  sourceId: string,
  targetId: string,
): SelectedAsset[] => {
  if (sourceId === targetId) return assets;

  const from = assets.findIndex((asset) => asset.id === sourceId);
  const to = assets.findIndex((asset) => asset.id === targetId);
  if (from === -1 || to === -1) return assets;

  const next = [...assets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};
