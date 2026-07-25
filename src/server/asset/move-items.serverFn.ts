import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { createServerFn } from "@tanstack/react-start";
import { assetAdminMiddleware } from "../middleware/auth.middleware";
import {
  batchMoveItemsInD1,
  type FolderLocationUpdate,
} from "@/lib/asset/dal/asset-batch.dal";
import { parseMoveItemsInput } from "./input-validation";

async function collectDescendantPathUpdates(
  oldPath: string,
  newPath: string,
  oldIdPath: string,
  newIdPath: string,
): Promise<FolderLocationUpdate[]> {
  const childFolders = await assetFolderDal.findChildrenByIdPath(oldIdPath);
  return childFolders.map((child) => ({
    id: child.id,
    path: child.path.replace(oldPath, newPath),
    idPath: child.idPath.replace(oldIdPath, newIdPath),
    updateParent: false,
  }));
}

export const moveItems = createServerFn({ method: "POST" })
  .validator(parseMoveItemsInput)
  .middleware([assetAdminMiddleware])
  .handler(async ({ data: parsedInput, context }) => {
    if (parsedInput.formError) {
      return {
        success: false,
        message: parsedInput.formError,
        errors: parsedInput.errors,
      };
    }
    const itemIds = parsedInput.itemIds;
    const targetFolderId = parsedInput.destinationFolder;

    // Optimization 1: Pre-fetch Target Folder (Single DB query)
    let targetFolder = null;
    if (targetFolderId) {
      targetFolder = await assetFolderDal.findById(targetFolderId);
      if (!targetFolder) {
        throw new Error("Target folder not found");
      }
    }

    // Fetch assets and folders in parallel
    const [userAssets, userFolders] = await Promise.all([
      assetDal.findByIds(itemIds),
      assetFolderDal.findByIds(itemIds),
    ]);

    if (userAssets.length + userFolders.length !== new Set(itemIds).size) {
      throw new Error("One or more selected items no longer exist");
    }

    // Optimization 2: Check circular reference in memory using pre-fetched targetFolder
    if (targetFolder) {
      for (const folder of userFolders) {
        // If target folder path contains current folder ID, it means target is a subfolder -> forbidden
        if (targetFolder.idPath.includes(`/${folder.id}`)) {
          throw new Error("Cannot move folder into itself or its subfolder");
        }
      }
    }

    for (const folder of userFolders) {
      const selectedAncestor = userFolders.find(
        (candidate) =>
          candidate.id !== folder.id &&
          folder.idPath.startsWith(`${candidate.idPath}/`),
      );
      if (selectedAncestor) {
        throw new Error("Move a parent folder without selecting its descendants");
      }
    }

    const destinationPaths = new Set<string>();
    for (const folder of userFolders) {
      const destinationPath = targetFolder
        ? `${targetFolder.path}/${folder.name}`
        : `/${folder.name}`;
      if (destinationPaths.has(destinationPath)) {
        throw new Error(`Duplicate folder name "${folder.name}" in selection`);
      }
      destinationPaths.add(destinationPath);

      const existingAtDestination =
        await assetFolderDal.findByPath(destinationPath);
      if (existingAtDestination && existingAtDestination.id !== folder.id) {
        throw new Error(
          `Folder "${folder.name}" already exists at destination`,
        );
      }
    }

    const folderLocationUpdates = (
      await Promise.all(
        userFolders.map(async (folder): Promise<FolderLocationUpdate[]> => {
          let newPath: string;
          let newIdPath: string;

          if (targetFolder) {
            newPath = `${targetFolder.path}/${folder.name}`;
            newIdPath = `${targetFolder.idPath}/${folder.id}`;
          } else {
            // Move to root
            newPath = `/${folder.name}`;
            newIdPath = `/${folder.id}`;
          }

          const updates: FolderLocationUpdate[] = [{
            id: folder.id,
            parentId: targetFolderId,
            path: newPath,
            idPath: newIdPath,
            updateParent: true,
          }];

          if (folder.path !== newPath) {
            updates.push(
              ...(await collectDescendantPathUpdates(
                folder.path,
                newPath,
                folder.idPath,
                newIdPath,
              )),
            );
          }
          return updates;
        }),
      )
    ).flat();

    await batchMoveItemsInD1({
      assetIds: userAssets.map((asset) => asset.id),
      targetFolderId,
      folderUpdates: folderLocationUpdates,
      userId: context.user.id,
    });

    // Build success message with details
    const parts: string[] = [];
    if (userAssets.length > 0) {
      parts.push(`${userAssets.length} asset(s)`);
    }
    if (userFolders.length > 0) {
      parts.push(`${userFolders.length} folder(s)`);
    }
    const description =
      parts.length > 0 ? `Moved ${parts.join(" and ")}` : undefined;

    return {
      success: true,
      message: "Items moved successfully",
      description,
    };
  });
