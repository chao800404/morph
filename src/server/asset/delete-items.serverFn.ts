import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { assetDal, assetFolderDal, type AssetDTO } from "../../lib/asset";
import { assetAdminMiddleware } from "../middleware/auth.middleware";
import {
  batchSoftDeleteItemsInD1,
  findAssetUsageInD1,
} from "@/lib/asset/dal/asset-batch.dal";
import { parseDeleteItemsInput } from "./input-validation";
import { DB_FANOUT_CONCURRENCY } from "@/lib/db/concurrency";
import { bulkOperationLimits } from "@/lib/db/operation-limits";
import { getConfig } from "@/server/get-config";
import pLimit from "p-limit";

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
    const { folderIds, assetIds, detachReferences } = parsedInput;
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

    // The selected folders were already loaded above, so their `idPath` is in
    // hand — looking each one up again by id would double the query count.
    // Concurrency is capped rather than fanning out one lookup per selected
    // folder: deleting a large selection would otherwise open an unbounded
    // number of simultaneous D1 queries.
    const descendantLookups = pLimit(DB_FANOUT_CONCURRENCY);
    await Promise.all(
      selectedFolders.map((folder) =>
        descendantLookups(async () => {
          const descendants = await assetFolderDal.findChildrenByIdPath(
            folder.idPath,
          );
          descendants.forEach((descendant) =>
            allTargetFolderIds.add(descendant.id),
          );
        }),
      ),
    );

    const finalFolderIds = Array.from(allTargetFolderIds);

    // 2. Collect all target assets (selected assets + assets in folders)
    const allAssetsToDelete: AssetDTO[] = [...selectedAssets];

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

    // 3. Refuse oversized work before touching anything.
    //
    // The input validator caps how many items were *selected*, but a single
    // folder can expand into thousands of descendants. Running past
    // Cloudflare's subrequest budget would abort midway, after the D1 soft
    // delete but partway through the R2 archive, leaving files hidden in the
    // UI while their objects remain in storage. Failing up front keeps the
    // operation all-or-nothing from the user's point of view.
    const limits = bulkOperationLimits(getConfig().server.cloudflare?.plan);
    if (uniqueAssets.length > limits.maxAssets) {
      return {
        success: false,
        message: `This selection contains ${uniqueAssets.length} files, above the limit of ${limits.maxAssets} per delete`,
        description:
          "Nothing was deleted. Remove the folder's contents in smaller batches, then delete the folder itself.",
      };
    }
    if (finalFolderIds.length > limits.maxFolders) {
      return {
        success: false,
        message: `This selection contains ${finalFolderIds.length} folders, above the limit of ${limits.maxFolders} per delete`,
        description:
          "Nothing was deleted. Delete the nested folders in smaller batches first.",
      };
    }

    // Reference usage is checked after folder expansion, then checked again on
    // every confirmed request. This closes the race where an asset is attached
    // to a product between opening the dialog and pressing the final button.
    const usage = await findAssetUsageInD1(uniqueAssetIds);
    if (
      !detachReferences &&
      (usage.productCount > 0 || usage.variantCount > 0)
    ) {
      const productLabel = `${usage.productCount} product${usage.productCount === 1 ? "" : "s"}`;
      const variantLabel = `${usage.variantCount} variant${usage.variantCount === 1 ? "" : "s"}`;
      const examples = [...usage.productTitles, ...usage.variantTitles]
        .slice(0, 5)
        .join(", ");
      return {
        success: false as const,
        requiresConfirmation: true as const,
        message: "Some assets are currently in use",
        description: `Deleting this selection will remove its media from ${productLabel} and ${variantLabel}.${examples ? ` Affected records include: ${examples}.` : ""} The products and variants themselves will not be deleted.`,
        usage,
      };
    }

    // 4. One D1 batch keeps asset/folder visibility changes transactional.
    await batchSoftDeleteItemsInD1({
      assetIds: uniqueAssetIds,
      folderIds: finalFolderIds,
      userId,
    });

    // 5. Handle R2 Operations (Archive to /delete/ folder)
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
