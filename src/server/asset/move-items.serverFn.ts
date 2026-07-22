import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { createServerFn } from "@tanstack/react-start";
// import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { authMiddleware } from "../middleware/auth.middleware";

const inputSchema = zfd.formData({
  itemIds: zfd.text(
    z
      .string()
      .transform((str, ctx) => {
        try {
          return JSON.parse(str);
        } catch (e) {
          ctx.addIssue({ code: "custom", message: "Invalid JSON" });
          return z.NEVER;
        }
      })
      .pipe(z.array(z.string())),
  ),
  "Destination Folder": zfd.text(z.string().optional()),
});

// Only update descendant folders, not the folder itself (which is updated in the main flow)
async function updateDescendantsPaths(
  oldPath: string,
  newPath: string,
  oldIdPath: string,
  newIdPath: string,
) {
  // Use optimized LIKE query to find all descendants
  const childFolders = await assetFolderDal.findChildrenByIdPath(oldIdPath);

  if (childFolders.length === 0) return;

  const updates = childFolders.map((child) => ({
    id: child.id,
    path: child.path.replace(oldPath, newPath),
    idPath: child.idPath.replace(oldIdPath, newIdPath),
  }));

  // Batch update all descendants
  await assetFolderDal.updateBatch(updates);
}

export const moveItems = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) {
      throw new Error("Invalid form data");
    }
    return inputSchema.parse(data);
  })
  .middleware([authMiddleware])
  .handler(async ({ data: parsedInput, context }) => {
    const itemIds = parsedInput.itemIds;
    const destinationFolder = parsedInput["Destination Folder"];

    const targetFolderId =
      destinationFolder &&
      destinationFolder.trim() !== "" &&
      destinationFolder !== "root"
        ? destinationFolder
        : null;

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

    // Optimization 2: Check circular reference in memory using pre-fetched targetFolder
    if (targetFolder) {
      for (const folder of userFolders) {
        // If target folder path contains current folder ID, it means target is a subfolder -> forbidden
        if (targetFolder.idPath.includes(`/${folder.id}`)) {
          throw new Error("Cannot move folder into itself or its subfolder");
        }
      }
    }

    // Move Assets - Batch processing
    if (userAssets.length > 0) {
      await assetDal.updateFolderId(
        userAssets.map((a) => a.id),
        targetFolderId,
        context.user.id,
      );
    }

    // Optimization 3: Move Folders - Parallel processing & Combined updates
    if (userFolders.length > 0) {
      await Promise.all(
        userFolders.map(async (folder) => {
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

          // 3.1 Combined Update: Update ParentID + Path + IdPath in one go
          await assetFolderDal.update(folder.id, {
            parentId: targetFolderId,
            path: newPath,
            idPath: newIdPath,
          });

          // 3.2 Update all descendant paths
          // Only if path actually changed (though move usually implies path change)
          if (folder.path !== newPath) {
            await updateDescendantsPaths(
              folder.path,
              newPath,
              folder.idPath,
              newIdPath,
            );
          }
        }),
      );
    }

    // revalidatePath("/(backend)/dashboard/[...slug]", "layout");

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
