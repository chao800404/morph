import {
  assetEditSelectionItemSchema,
  type AssetEditSelectionItem,
} from "@/lib/asset/edit-selection";
import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assetReadMiddleware } from "../middleware/auth.middleware";

const getAssetItemsInputSchema = z.object({
  items: z.array(assetEditSelectionItemSchema).min(1).max(100),
});

export const getAssetItems = createServerFn({ method: "POST" })
  .validator((data: unknown) => getAssetItemsInputSchema.parse(data))
  .middleware([assetReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const assetIds = data.items
        .filter((item) => item.itemType === "asset")
        .map((item) => item.id);
      const folderIds = data.items
        .filter((item) => item.itemType === "folder")
        .map((item) => item.id);
      const [assets, folders] = await Promise.all([
        assetDal.findByIds(assetIds),
        assetFolderDal.findByIds(folderIds),
      ]);
      const assetMap = new Map(assets.map((item) => [item.id, item]));
      const folderMap = new Map(folders.map((item) => [item.id, item]));

      if (
        assets.length !== new Set(assetIds).size ||
        folders.length !== new Set(folderIds).size
      ) {
        return {
          success: false as const,
          message: "One or more selected items no longer exist",
          data: null,
          error: "NOT_FOUND" as const,
        };
      }

      const items = data.items.map((selection: AssetEditSelectionItem) =>
        selection.itemType === "asset"
          ? {
              itemType: "asset" as const,
              item: assetMap.get(selection.id)!,
            }
          : {
              itemType: "folder" as const,
              item: folderMap.get(selection.id)!,
            },
      );

      return {
        success: true as const,
        message: "Asset items fetched successfully",
        data: items,
      };
    } catch (error) {
      console.error("Get asset items error:", error);
      return {
        success: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch asset items",
        data: null,
        error: "GET_FAILED" as const,
      };
    }
  });
