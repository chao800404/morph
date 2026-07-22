import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { assetDal, assetFolderDal, type AssetDTO } from "../../lib/asset";
// import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { authMiddleware } from "../middleware/auth.middleware";

const deleteItemsSchema = zfd.formData({
  folderIds: zfd
    .text(z.string().optional())
    .transform((val) => (val ? JSON.parse(val) : [])),
  assetIds: zfd
    .text(z.string().optional())
    .transform((val) => (val ? JSON.parse(val) : [])),
});

export const deleteItems = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) {
      throw new Error("Invalid form data");
    }
    return deleteItemsSchema.parse(data);
  })
  .middleware([authMiddleware])
  .handler(async ({ data: parsedInput, context }) => {
    const { folderIds, assetIds } = parsedInput as {
      folderIds: string[];
      assetIds: string[];
    };
    const userId = context.user.id;

    if (folderIds.length === 0 && assetIds.length === 0) {
      return {
        success: false,
        message: "No items selected",
      };
    }

    // 1. Collect all target folder IDs (including descendants)
    const allTargetFolderIds = new Set<string>(folderIds);

    // Use Promise.all to fetch descendants for all selected folders in parallel
    await Promise.all(
      folderIds.map(async (rootId) => {
        const descendants = await assetFolderDal.findAllDescendantIds(rootId);
        descendants.forEach((id) => allTargetFolderIds.add(id));
      }),
    );

    const finalFolderIds = Array.from(allTargetFolderIds);

    // 2. Collect all target assets (selected assets + assets in folders)
    let allAssetsToDelete: AssetDTO[] = [];

    // A. Direct assets
    if (assetIds.length > 0) {
      const directAssets = await assetDal.findByIds(assetIds);
      allAssetsToDelete.push(...directAssets);
    }

    // B. Assets in folders
    if (finalFolderIds.length > 0) {
      const folderAssets = await assetDal.findByFolderIds(finalFolderIds);
      allAssetsToDelete.push(...folderAssets);
    }

    // Deduplicate assets
    const uniqueAssetsMap = new Map<string, AssetDTO>();
    allAssetsToDelete.forEach((asset) => uniqueAssetsMap.set(asset.id, asset));
    const uniqueAssets = Array.from(uniqueAssetsMap.values());
    const uniqueAssetIds = uniqueAssets.map((a) => a.id);

    // 3. Batch Soft Delete in DB

    // A. Batch delete assets
    if (uniqueAssetIds.length > 0) {
      await assetDal.softDeleteBatch(uniqueAssetIds, userId);
    }

    // B. Batch delete folders
    if (finalFolderIds.length > 0) {
      await assetFolderDal.softDeleteBatch(finalFolderIds, userId);
    }

    // 4. Handle R2 Operations (Archive to /delete/ folder)
    if (env?.R2_BUCKET && uniqueAssets.length > 0) {
      const R2_BATCH_SIZE = 10;

      for (let i = 0; i < uniqueAssets.length; i += R2_BATCH_SIZE) {
        const batch = uniqueAssets.slice(i, i + R2_BATCH_SIZE);

        await Promise.all(
          batch.map(async (asset) => {
            try {
              const r2Key = asset.url.startsWith("/")
                ? asset.url.slice(1)
                : asset.url;

              const object = await env.R2_BUCKET.get(r2Key);
              if (object) {
                const dateStr = new Date()
                  .toISOString()
                  .split("T")[0]
                  .replace(/-/g, "");
                const filename = r2Key.split("/").pop() || "unknown";
                const deleteKey = `delete/${dateStr}-${asset.id}-${filename}`;

                if (typeof FixedLengthStream !== "undefined") {
                  const { readable, writable } = new FixedLengthStream(
                    object.size,
                  );
                  object.body.pipeTo(writable);

                  await env.R2_BUCKET.put(deleteKey, readable, {
                    httpMetadata: object.httpMetadata,
                    customMetadata: {
                      ...object.customMetadata,
                      originalKey: r2Key,
                      deletedAt: new Date().toISOString(),
                      deletedBy: userId,
                    },
                  });
                } else {
                  const bodyBuffer = await object.arrayBuffer();

                  await env.R2_BUCKET.put(deleteKey, bodyBuffer, {
                    httpMetadata: object.httpMetadata,
                    customMetadata: {
                      ...object.customMetadata,
                      originalKey: r2Key,
                      deletedAt: new Date().toISOString(),
                      deletedBy: userId,
                    },
                  });
                }
              }
            } catch (r2Error) {
              console.error(
                `R2 archive failed for asset ${asset.id}:`,
                r2Error,
              );
            }
          }),
        );
      }
    }

    // revalidatePath("/(backend)/dashboard/[...slug]", "layout");

    const total = finalFolderIds.length + uniqueAssetIds.length;
    return {
      success: true,
      message: `${total} item(s) deleted successfully`,
    };
  });
