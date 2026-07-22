import { getDb } from "@/db";
import { assets } from "@/db/asset.schema";
import { createServerFn } from "@tanstack/react-start";
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  like,
  or,
  SQL,
} from "drizzle-orm";
// import { validateSession } from "./_helpers";
import { authMiddleware } from "../middleware/auth.middleware";

type SortByField = "createdAt" | "updatedAt" | "originalName" | "size" | "type";
type SortOrder = "asc" | "desc";

interface SearchAssetsInput {
  q?: string;
  type?: string;
  folderId?: string;
  sortBy?: SortByField;
  sortOrder?: SortOrder;
  page?: number;
  limit?: number;
}

export const searchAssets = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as SearchAssetsInput)
  .middleware([authMiddleware])
  .handler(async ({ data: formData, context }) => {
    const user = context.user;

    const {
      q: query = "",
      type,
      folderId,
      sortBy = "createdAt" as SortByField,
      sortOrder = "desc" as SortOrder,
      page = 1,
      limit = 20,
    } = formData;

    const offset = (page - 1) * limit;
    const db = await getDb();

    // Build query conditions
    const conditions: SQL[] = [eq(assets.uploadedBy, user.id)];

    // Search query
    if (query.trim()) {
      const searchConditions = [
        like(assets.originalName, `%${query}%`),
        and(isNotNull(assets.alt), like(assets.alt, `%${query}%`)),
        and(isNotNull(assets.caption), like(assets.caption, `%${query}%`)),
        and(isNotNull(assets.tags), like(assets.tags, `%${query}%`)),
      ];

      if (searchConditions.length > 0) {
        conditions.push(or(...searchConditions) as SQL);
      }
    }

    // Type filter
    if (type && type !== "all") {
      conditions.push(eq(assets.type, type));
    }

    // Folder filter
    if (folderId) {
      conditions.push(eq(assets.folderId, folderId));
    }

    // Sorting
    const getOrderBy = () => {
      const column = (() => {
        switch (sortBy) {
          case "createdAt":
            return assets.createdAt;
          case "updatedAt":
            return assets.updatedAt;
          case "originalName":
            return assets.originalName;
          case "size":
            return assets.size;
          case "type":
            return assets.type;
          default:
            return assets.createdAt;
        }
      })();

      return sortOrder === "asc" ? asc(column) : desc(column);
    };

    const orderBy = getOrderBy();

    try {
      // Get total count
      const totalResult = await db
        .select({ count: count() })
        .from(assets)
        .where(and(...conditions));

      const total = totalResult[0]?.count || 0;

      // Get paginated data
      const assetsList = await db
        .select()
        .from(assets)
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      const totalPages = Math.ceil(total / limit);

      return {
        success: true,
        message: "Search completed successfully",
        data: {
          assets: assetsList,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
      };
    } catch (error) {
      console.error("Search error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Search failed";
      return {
        success: false,
        message: errorMessage,
        error: "SEARCH_FAILED",
      };
    }
  });
