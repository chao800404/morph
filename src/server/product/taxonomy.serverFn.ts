import {
  productCategoryDal,
  productTagDal,
  productTypeDal,
} from "@/lib/product/dal/product-taxonomy.dal";
import { createServerFn } from "@tanstack/react-start";
import { productReadMiddleware } from "../middleware/auth.middleware";
import { z } from "zod";

/**
 * Everything the Organize step needs to fill its selects.
 *
 * One call rather than three: the three lists are short, always read together,
 * and each round trip costs a Workers subrequest.
 */
export const listProductTaxonomyOptions = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        kind: z.enum(["type", "tag", "category"]),
        query: z.string().max(200).optional(),
        page: z.number().int().min(1),
        limit: z.number().int().min(1).max(50),
        selectedIds: z.array(z.uuid()).max(100).optional(),
      })
      .parse(data),
  )
  .middleware([productReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const page =
        data.kind === "type"
          ? await productTypeDal.listOptions(data)
          : data.kind === "tag"
            ? await productTagDal.listOptions(data)
            : await productCategoryDal.listOptions(data);

      return {
        success: true,
        message: "Taxonomy options fetched successfully",
        data: {
          items: page.items.map((item) => ({
            id: item.id,
            label: "value" in item ? item.value : item.name,
          })),
          selectedItems: page.selected.map((item) => ({
            id: item.id,
            label: "value" in item ? item.value : item.name,
          })),
          pagination: {
            page: data.page,
            limit: data.limit,
            total: page.total,
            totalPages: Math.max(1, Math.ceil(page.total / data.limit)),
          },
        },
      };
    } catch (error) {
      console.error("List product taxonomy error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch taxonomy",
        data: null,
        error: "LIST_FAILED",
      };
    }
  });
