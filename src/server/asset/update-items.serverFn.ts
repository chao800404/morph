import { createServerFn } from "@tanstack/react-start";
import { assetDal, assetFolderDal } from "../../lib/asset";
import { parseAssetTagsInput } from "@/lib/validations/asset";
import { parseUpdateItemsInput } from "./input-validation";
import { assetAdminMiddleware } from "../middleware/auth.middleware";
import { DB_FANOUT_CONCURRENCY } from "@/lib/db/concurrency";
import pLimit from "p-limit";
import {
  batchSaveItemsInD1,
  type AssetMetadataUpdate,
  type FolderLocationUpdate,
  type FolderMetadataUpdate,
} from "@/lib/asset/dal/asset-batch.dal";

export const updateItems = createServerFn({ method: "POST" })
  .validator(parseUpdateItemsInput)
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
    const assetLocationChanges = assetItems.filter((item) => {
      const asset = assetMap.get(item.id)!;
      return (
        item.locationId !== undefined && item.locationId !== asset.folderId
      );
    });
    const folderLocationChanges = folderItems.filter((item) => {
      const folder = folderMap.get(item.id)!;
      return (
        item.locationId !== undefined && item.locationId !== folder.parentId
      );
    });
    const folderLocationChangeIds = new Set(
      folderLocationChanges.map((item) => item.id),
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

    const selectedFolderPaths = new Set(
      existingFolders.map((folder) => folder.idPath),
    );
    for (const folder of existingFolders) {
      const pathParts = folder.idPath.split("/").filter(Boolean);
      pathParts.pop();
      if (
        pathParts.some((_, index) =>
          selectedFolderPaths.has(
            `/${pathParts.slice(0, index + 1).join("/")}`,
          ),
        )
      ) {
        throw new Error("Edit a parent folder and its descendants separately");
      }
    }

    const destinationPaths = new Set<string>();
    // Each item runs a path lookup plus a descendant lookup, so the fan-out is
    // capped. The shared `destinationPaths` set still sees every earlier claim,
    // because limiting concurrency only reorders the checks.
    const folderLookups = pLimit(DB_FANOUT_CONCURRENCY);
    const folderUpdates = (
      await Promise.all(
        folderItems.map((item) =>
          folderLookups(async (): Promise<FolderMetadataUpdate[]> => {
            const folder = folderMap.get(item.id)!;
            const update: FolderMetadataUpdate = { id: item.id };
            if (item.description !== undefined) {
              update.description = item.description || null;
            }
            if (!item.name || item.name === folder.name) return [update];

            update.name = item.name;
            if (folderLocationChangeIds.has(item.id)) return [update];

            const pathParts = folder.path.split("/");
            pathParts[pathParts.length - 1] = item.name;
            const newPath = pathParts.join("/");
            if (destinationPaths.has(newPath)) {
              throw new Error(
                `Folder "${item.name}" is duplicated in this update`,
              );
            }
            destinationPaths.add(newPath);

            const existingAtDestination =
              await assetFolderDal.findByPath(newPath);
            if (
              existingAtDestination &&
              existingAtDestination.id !== folder.id
            ) {
              throw new Error(`Folder "${item.name}" already exists`);
            }

            update.path = newPath;
            const descendants = await assetFolderDal.findChildrenByPath(
              folder.path,
            );
            return [
              update,
              ...descendants.map((descendant) => ({
                id: descendant.id,
                path: descendant.path.replace(folder.path, newPath),
              })),
            ];
          }),
        ),
      )
    ).flat();

    const requestedTargetIds = new Set(
      [...assetLocationChanges, ...folderLocationChanges]
        .map((item) => item.locationId)
        .filter((id): id is string => Boolean(id)),
    );
    const targetFolders = await assetFolderDal.findByIds([
      ...requestedTargetIds,
    ]);
    if (targetFolders.length !== requestedTargetIds.size) {
      throw new Error("One or more target folders no longer exist");
    }
    const targetFolderMap = new Map(
      targetFolders.map((folder) => [folder.id, folder]),
    );
    for (const targetFolder of targetFolders) {
      if (folderMap.has(targetFolder.id)) {
        throw new Error(
          "Move items into another selected folder in a separate update",
        );
      }
    }

    const assetLocationGroups = new Map<string | null, string[]>();
    for (const item of assetLocationChanges) {
      const folderId = item.locationId ?? null;
      assetLocationGroups.set(folderId, [
        ...(assetLocationGroups.get(folderId) ?? []),
        item.id,
      ]);
    }

    const editedFolderNames = new Map(
      folderItems.map((item) => [item.id, item.name]),
    );
    const moveDestinationPaths = new Set<string>();
    for (const item of folderLocationChanges) {
      const folder = folderMap.get(item.id)!;
      const targetFolder = item.locationId
        ? targetFolderMap.get(item.locationId)!
        : null;
      if (targetFolder?.idPath.includes(`/${folder.id}`)) {
        throw new Error("Cannot move folder into itself or its subfolder");
      }

      const effectiveName = editedFolderNames.get(folder.id) || folder.name;
      const newPath = targetFolder
        ? `${targetFolder.path}/${effectiveName}`
        : `/${effectiveName}`;
      if (moveDestinationPaths.has(newPath)) {
        throw new Error(
          `Folder "${effectiveName}" is duplicated in this update`,
        );
      }
      moveDestinationPaths.add(newPath);

      const existingAtDestination = await assetFolderDal.findByPath(newPath);
      if (existingAtDestination && existingAtDestination.id !== folder.id) {
        throw new Error(`Folder "${effectiveName}" already exists`);
      }
    }

    const locationLookups = pLimit(DB_FANOUT_CONCURRENCY);
    const folderLocationUpdates = (
      await Promise.all(
        folderLocationChanges.map((item) =>
          locationLookups(async (): Promise<FolderLocationUpdate[]> => {
            const folder = folderMap.get(item.id)!;
            const targetFolder = item.locationId
              ? targetFolderMap.get(item.locationId)!
              : null;
            const effectiveName =
              editedFolderNames.get(folder.id) || folder.name;
            const newPath = targetFolder
              ? `${targetFolder.path}/${effectiveName}`
              : `/${effectiveName}`;
            const newIdPath = targetFolder
              ? `${targetFolder.idPath}/${folder.id}`
              : `/${folder.id}`;
            const descendants = await assetFolderDal.findChildrenByIdPath(
              folder.idPath,
            );

            return [
              {
                id: folder.id,
                parentId: item.locationId ?? null,
                path: newPath,
                idPath: newIdPath,
                updateParent: true,
              },
              ...descendants.map((descendant) => ({
                id: descendant.id,
                path: descendant.path.replace(folder.path, newPath),
                idPath: descendant.idPath.replace(folder.idPath, newIdPath),
                updateParent: false,
              })),
            ];
          }),
        ),
      )
    ).flat();

    const hasLocationChanges =
      assetLocationChanges.length > 0 || folderLocationChanges.length > 0;
    const move = hasLocationChanges
      ? {
          assetUpdates: [...assetLocationGroups].map(([folderId, ids]) => ({
            ids,
            folderId,
          })),
          folderUpdates: folderLocationUpdates,
          userId: context.user.id,
        }
      : undefined;

    await batchSaveItemsInD1({
      metadata: {
        assetUpdates,
        folderUpdates,
        userId: context.user.id,
      },
      move,
    });

    return {
      success: true,
      message: hasLocationChanges
        ? "Items updated and moved successfully"
        : "Items updated successfully",
    };
  });
