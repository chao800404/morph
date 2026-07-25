import { assetDal } from "@/lib/asset/dal/asset.dal";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assetReadMiddleware } from "../middleware/auth.middleware";

const searchAssetsInputSchema = z.object({
  q: z.string().trim().max(200).default(""),
  type: z.enum(["all", "image", "video", "rive", "model"]).optional(),
  folderId: z.uuid().optional(),
  sortBy: z
    .enum(["createdAt", "updatedAt", "originalName", "size", "type"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const searchAssets = createServerFn({ method: "POST" })
  .validator((data: unknown) => searchAssetsInputSchema.parse(data ?? {}))
  .middleware([assetReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const result = await assetDal.searchPage({
        query: data.q,
        type: data.type,
        folderId: data.folderId,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        page: data.page,
        limit: data.limit,
      });

      return {
        success: true,
        message: "Search completed successfully",
        data: {
          assets: result.assets,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: result.total,
            totalPages: Math.ceil(result.total / data.limit),
          },
        },
      };
    } catch (error) {
      console.error("Search error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Search failed",
        error: "SEARCH_FAILED",
      };
    }
  });
