import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { assetDal, assetFolderDal, type AssetDTO } from "../../lib/asset";
import { assetAdminMiddleware } from "../middleware/auth.middleware";
import { batchSoftDeleteItemsInD1 } from "@/lib/asset/dal/asset-batch.dal";
import { parseDeleteItemsInput } from "./input-validation";

export const deleteItems = createServerFn({ method: "POST" })
  .validator(parseDeleteItemsInput)
  .middleware([assetAdminMiddleware])
  .handler(async ({ data: parsedInput, context }) => {
    if (parsedInput.formError) {
      return {
        success: false,
        message: parsedInput.formError,
        errors: parsedInput.errors,
      };
    }
    const { folderIds, assetIds } = parsedInput;
    const userId = context.user.id;

    if (folderIds.length === 0 && assetIds.length === 0) {
      return {
        success: false,
        message: "No items selected",
      };
    }

    const [selectedFolders, selectedAssets] = await Promise.all([
      assetFolderDal.findByIds(folderIds),
      assetDal.findByIds(assetIds),
    ]);
    if (
      selectedFolders.length !== new Set(folderIds).size ||
      selectedAssets.length !== new Set(assetIds).size
    ) {
      return {
        success: false,
        message: "One or more selected items no longer exist",
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
    let allAssetsToDelete: AssetDTO[] = [...selectedAssets];

    // A. Direct assets
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

    // 3. One D1 batch keeps asset/folder visibility changes transactional.
    await batchSoftDeleteItemsInD1({
      assetIds: uniqueAssetIds,
      folderIds: finalFolderIds,
      userId,
    });

    // 4. Handle R2 Operations (Archive to /delete/ folder)
    const failedArchives: string[] = [];
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
                  const pipePromise = object.body.pipeTo(writable);

                  await Promise.all([
                    env.R2_BUCKET.put(deleteKey, readable, {
                      httpMetadata: object.httpMetadata,
                      customMetadata: {
                        ...object.customMetadata,
                        originalKey: r2Key,
                        deletedAt: new Date().toISOString(),
                        deletedBy: userId,
                      },
                    }),
                    pipePromise,
                  ]);
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

                await env.R2_BUCKET.delete(r2Key);
              }
            } catch (r2Error) {
              failedArchives.push(asset.id);
              console.error(
                `R2 archive failed for asset ${asset.id}:`,
                r2Error,
              );
            }
          }),
        );
      }
    }

    const total = finalFolderIds.length + uniqueAssetIds.length;
    return {
      success: true,
      message: `${total} item(s) deleted successfully`,
      description:
        failedArchives.length > 0
          ? `${failedArchives.length} file(s) were hidden successfully but could not be archived in storage.`
          : undefined,
    };
  });
