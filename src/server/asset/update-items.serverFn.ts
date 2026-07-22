import { updateItemsSchema } from "@/lib/validations/asset";
import { createServerFn } from "@tanstack/react-start";
import { assetDal, assetFolderDal } from "../../lib/asset";
// import { revalidatePath } from "next/cache";
import { zfd } from "zod-form-data";
import { authMiddleware } from "../middleware/auth.middleware";

const inputSchema = zfd.formData(updateItemsSchema);

export const updateItems = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) {
      throw new Error("Invalid form data");
    }
    return inputSchema.parse(data);
  })
  .middleware([authMiddleware])
  .handler(async ({ data: parsedInput, context }) => {
    const itemsData = parsedInput.itemsData;

    // Separate folders and assets
    const folderUpdates = itemsData.filter((i) => i.type === "folder" && i.id);
    const assetUpdates = itemsData.filter((i) => i.type !== "folder" && i.id);

    // ==========================================
    // 1. Process Assets - Efficient Parallel Processing
    // ==========================================
    if (assetUpdates.length > 0) {
      const assetIds = assetUpdates.map((i) => i.id!);
      const existingAssets = await assetDal.findByIds(assetIds);
      const assetMap = new Map(existingAssets.map((a) => [a.id, a]));

      await Promise.all(
        assetUpdates.map(async (item) => {
          const asset = assetMap.get(item.id!);
          if (!asset) return;

          const updates: Record<string, any> = {};

          if (item.name) {
            const nameWithoutExtension = item.name.replace(/\.[^/.]+$/, "");
            updates.name = nameWithoutExtension;
            updates.originalName = item.name;
          }

          if (item.alt !== undefined)
            updates.alt = item.alt.length === 0 ? null : item.alt;
          if (item.caption !== undefined)
            updates.caption = item.caption.length === 0 ? null : item.caption;
          if (item.tags !== undefined)
            updates.tags = item.tags.length === 0 ? null : item.tags;

          if (Object.keys(updates).length > 0) {
            updates.updatedBy = context.user.id;
            await assetDal.updateFields(item.id!, updates);
          }
        }),
      );
    }

    // ==========================================
    // 2. Process Folders - Keep Logic Strict
    // ==========================================
    for (const item of folderUpdates) {
      const updates: Record<string, any> = {};
      if (item.name) updates.name = item.name;
      if (item.description !== undefined)
        updates.description =
          item.description.length === 0 ? null : item.description;

      if (Object.keys(updates).length > 0) {
        const folder = await assetFolderDal.findById(item.id!);

        if (folder) {
          if (updates.name && updates.name !== folder.name) {
            const pathParts = folder.path.split("/");
            pathParts[pathParts.length - 1] = updates.name;
            const newPath = pathParts.join("/");

            const existingFolder = await assetFolderDal.findByPath(newPath);

            if (existingFolder && existingFolder.id !== folder.id) {
              console.warn(
                `Folder rename skipped: "${updates.name}" already exists`,
              );
              continue;
            }

            await assetFolderDal.updateName(folder.id, updates.name, newPath);
            await assetFolderDal.updatePathRecursively(folder.path, newPath);
          }

          if (updates.description !== undefined) {
            await assetFolderDal.updateFields(item.id!, {
              description: updates.description,
            });
          }
        }
      }
    }

    // revalidatePath("/(backend)/dashboard/[...slug]", "layout");

    return {
      success: true,
      message: "Items updated successfully",
    };
  });
