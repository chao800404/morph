import { createServerFn } from "@tanstack/react-start";
import { assetDal, assetFolderDal } from "../../lib/asset";
import { parseAssetTagsInput } from "@/lib/validations/asset";
import { parseUpdateItemsInput } from "./input-validation";
import { assetAdminMiddleware } from "../middleware/auth.middleware";
import {
  batchUpdateItemsInD1,
  type AssetMetadataUpdate,
  type FolderMetadataUpdate,
} from "@/lib/asset/dal/asset-batch.dal";

export const updateItems = createServerFn({ method: "POST" })
  .inputValidator(parseUpdateItemsInput)
  .middleware([assetAdminMiddleware])
  .handler(async ({ data: parsedInput, context }) => {
    if (parsedInput.formError) {
      return {
        success: false,
        message: parsedInput.formError,
        errors: parsedInput.errors,
      };
    }
    const itemsData = parsedInput.itemsData;

    const folderItems = itemsData.filter((item) => item.type === "folder");
    const assetItems = itemsData.filter((item) => item.type === "asset");

    const assetIds = assetItems.map((item) => item.id);
    const folderIds = folderItems.map((item) => item.id);
    const [existingAssets, existingFolders] = await Promise.all([
      assetDal.findByIds(assetIds),
      assetFolderDal.findByIds(folderIds),
    ]);

    if (
      existingAssets.length !== new Set(assetIds).size ||
      existingFolders.length !== new Set(folderIds).size
    ) {
      return {
        success: false,
        message: "One or more selected items no longer exist",
      };
    }

    const assetMap = new Map(existingAssets.map((asset) => [asset.id, asset]));
    const folderMap = new Map(
      existingFolders.map((folder) => [folder.id, folder]),
    );

    const assetUpdates: AssetMetadataUpdate[] = assetItems.map((item) => {
      const asset = assetMap.get(item.id)!;
      const update: AssetMetadataUpdate = { id: item.id };
      if (item.name) {
        const name = item.name.replace(/\.[^/.]+$/, "").trim();
        const extension = asset.originalName.match(/\.[^/.]+$/)?.[0] ?? "";
        update.name = name;
        update.originalName = `${name}${extension}`;
      }
      if (item.alt !== undefined) update.alt = item.alt || null;
      if (item.caption !== undefined) update.caption = item.caption || null;
      if (item.tags !== undefined) {
        update.tags = parseAssetTagsInput(item.tags);
      }
      return update;
    });

    const selectedFolderPaths = new Set(existingFolders.map((folder) => folder.idPath));
    for (const folder of existingFolders) {
      const pathParts = folder.idPath.split("/").filter(Boolean);
      pathParts.pop();
      if (pathParts.some((_, index) => selectedFolderPaths.has(`/${pathParts.slice(0, index + 1).join("/")}`))) {
        throw new Error("Edit a parent folder and its descendants separately");
      }
    }

    const destinationPaths = new Set<string>();
    const folderUpdates = (
      await Promise.all(
        folderItems.map(async (item): Promise<FolderMetadataUpdate[]> => {
          const folder = folderMap.get(item.id)!;
          const update: FolderMetadataUpdate = { id: item.id };
          if (item.description !== undefined) {
            update.description = item.description || null;
          }
          if (!item.name || item.name === folder.name) return [update];

          const pathParts = folder.path.split("/");
          pathParts[pathParts.length - 1] = item.name;
          const newPath = pathParts.join("/");
          if (destinationPaths.has(newPath)) {
            throw new Error(`Folder "${item.name}" is duplicated in this update`);
          }
          destinationPaths.add(newPath);

          const existingAtDestination = await assetFolderDal.findByPath(newPath);
          if (existingAtDestination && existingAtDestination.id !== folder.id) {
            throw new Error(`Folder "${item.name}" already exists`);
          }

          update.name = item.name;
          update.path = newPath;
          const descendants = await assetFolderDal.findChildrenByPath(folder.path);
          return [
            update,
            ...descendants.map((descendant) => ({
              id: descendant.id,
              path: descendant.path.replace(folder.path, newPath),
            })),
          ];
        }),
      )
    ).flat();

    await batchUpdateItemsInD1({
      assetUpdates,
      folderUpdates,
      userId: context.user.id,
    });

    return {
      success: true,
      message: "Items updated successfully",
    };
  });
