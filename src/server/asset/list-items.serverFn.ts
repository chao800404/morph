import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assetReadMiddleware } from "../middleware/auth.middleware";

const listItemsInputSchema = z.object({
  folderId: z.union([z.uuid(), z.literal("root")]).nullish(),
  query: z.string().trim().max(200).nullish(),
  sortBy: z.enum(["name", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

export const listItemsServerFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => listItemsInputSchema.parse(data ?? {}))
  .middleware([assetReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const parentId =
        data.folderId && data.folderId !== "root" ? data.folderId : null;
      const [currentFolder, folders, assetPage] = await Promise.all([
        parentId ? assetFolderDal.findById(parentId) : Promise.resolve(null),
        assetFolderDal.listChildrenWithActors({
          parentId,
          query: data.query,
          sortBy: data.sortBy,
          sortOrder: data.sortOrder,
        }),
        assetDal.listPage({
          folderId: parentId,
          query: data.query,
          sortBy: data.sortBy,
          sortOrder: data.sortOrder,
          page: data.page,
          limit: data.limit,
        }),
      ]);

      return {
        success: true,
        message: "Items fetched successfully",
        data: {
          currentFolder,
          folders,
          assets: assetPage.assets,
          pagination: {
            page: data.page,
            limit: data.limit,
            totalAssets: assetPage.total,
            totalPages: Math.ceil(assetPage.total / data.limit),
          },
        },
      };
    } catch (error) {
      console.error("List items error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch items",
        data: null,
        error: "LIST_FAILED",
      };
    }
  });

export const listAllFolders = createServerFn({ method: "POST" })
  .middleware([assetReadMiddleware])
  .handler(async () => {
    try {
      return {
        success: true,
        message: "All folders fetched successfully",
        data: await assetFolderDal.listAll(),
      };
    } catch (error) {
      console.error("Folder list error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch folders",
        data: null,
        error: "LIST_FAILED",
      };
    }
  });
