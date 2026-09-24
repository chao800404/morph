import { parseInput } from "@/lib/db/server-result";
import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { describeMediaAsset } from "@/lib/asset/media-asset-identity";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assetReadMiddleware } from "../middleware/auth.middleware";

const getMediaAssetInputSchema = z.object({
  assetId: z.string().trim().min(1).max(64),
});

/**
 * The library's current answer for the asset a media field stores.
 *
 * Unlike `getAssetItems`, an asset that is gone is an answer rather than an
 * error: the Inspector shows it as deleted instead of failing the lookup.
 */
export const getMediaAsset = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getMediaAssetInputSchema, data))
  .middleware([assetReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;

    try {
      const [asset] = await assetDal.findByIds([input.data.assetId]);
      const folder = asset?.folderId
        ? await assetFolderDal.findById(asset.folderId)
        : null;
      return {
        success: true as const,
        message: "Media asset resolved",
        data: describeMediaAsset(asset ?? null, folder?.path ?? null),
      };
    } catch (error) {
      console.error("Get media asset error:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Failed to resolve asset",
        data: null,
        error: "GET_FAILED" as const,
      };
    }
  });
