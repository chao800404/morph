import { z } from "zod";

export const assetEditSelectionItemSchema = z.object({
  id: z.uuid(),
  itemType: z.enum(["asset", "folder"]),
});

export type AssetEditSelectionItem = z.infer<
  typeof assetEditSelectionItemSchema
>;

const assetEditSelectionSchema = z
  .array(assetEditSelectionItemSchema)
  .min(1)
  .max(100);

export const serializeAssetEditSelection = (items: AssetEditSelectionItem[]) =>
  JSON.stringify(items);

export const parseAssetEditSelection = (
  value: string | undefined,
  fallback?: AssetEditSelectionItem,
): AssetEditSelectionItem[] => {
  let parsed: unknown;

  if (value) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = undefined;
    }
  }

  const result = assetEditSelectionSchema.safeParse(parsed);
  const items = result.success ? result.data : fallback ? [fallback] : [];
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.itemType}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
