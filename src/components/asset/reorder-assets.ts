import type { SelectedAsset } from "./asset-tile";

/**
 * Move one asset from one position to another.
 *
 * Indices rather than ids because that is what dnd-kit reports: a sortable
 * tracks `initialIndex` and `index`, and by the time the drag ends the second
 * one has already been updated by the optimistic sorting plugin. The drop
 * *target* is not reliable at that moment — releasing the pointer between two
 * tiles leaves it null, which is how the first version of this silently saved
 * nothing.
 *
 * Out-of-range indices are a no-op: a drop can resolve after the list has
 * already changed underneath it.
 */
export const moveAsset = (
  assets: SelectedAsset[],
  from: number,
  to: number,
): SelectedAsset[] => {
  if (from === to) return assets;
  if (from < 0 || from >= assets.length) return assets;
  if (to < 0 || to >= assets.length) return assets;

  const next = [...assets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};
