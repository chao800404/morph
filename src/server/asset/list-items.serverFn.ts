import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assetReadMiddleware } from "../middleware/auth.middleware";

const sortKeySchema = z.enum([
  "name",
  "extension",
  "size",
  "createdAt",
  "updatedAt",
]);
const sortOrderSchema = z.enum(["asc", "desc"]);
const asList = <T>(value: T | T[]) => (Array.isArray(value) ? value : [value]);

const listItemsInputSchema = z.object({
  folderId: z.union([z.uuid(), z.literal("root")]).nullish(),
  query: z.string().trim().max(200).nullish(),
  type: z.enum(["image", "video", "rive", "model"]).optional(),
  sortBy: z
    .union([sortKeySchema, z.array(sortKeySchema).min(1).max(5)])
    .default("createdAt")
    .transform(asList),
  sortOrder: z
    .union([sortOrderSchema, z.array(sortOrderSchema).min(1).max(5)])
    .default("desc")
    .transform(asList),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(15),
});

export const listItemsServerFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => listItemsInputSchema.parse(data ?? {}))
  .middleware([assetReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const parentId =
        data.folderId && data.folderId !== "root" ? data.folderId : null;
      const assetSorts = data.sortBy.map((sortBy, index) => ({
        sortBy,
        sortOrder: data.sortOrder[index] ?? "desc",
      }));
      const folderSorts = assetSorts.filter(
        (
          sort,
        ): sort is {
          sortBy: "name" | "createdAt" | "updatedAt";
          sortOrder: "asc" | "desc";
        } => sort.sortBy !== "extension" && sort.sortBy !== "size",
      );
      const [currentFolder, folders, assetPage] = await Promise.all([
        parentId ? assetFolderDal.findById(parentId) : Promise.resolve(null),
        assetFolderDal.listChildrenWithActors({
          parentId,
          query: data.query,
          sorts:
            folderSorts.length > 0
              ? folderSorts
              : [{ sortBy: "createdAt", sortOrder: "desc" }],
        }),
        assetDal.listPage({
          folderId: parentId,
          query: data.query,
          type: data.type,
          sorts: assetSorts,
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
