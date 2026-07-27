import {
  productCategoryDal,
  productTagDal,
  productTypeDal,
} from "@/lib/product/dal/product-taxonomy.dal";
import { createServerFn } from "@tanstack/react-start";
import { productReadMiddleware } from "../middleware/auth.middleware";

/**
 * Everything the Organize step needs to fill its selects.
 *
 * One call rather than three: the three lists are short, always read together,
 * and each round trip costs a Workers subrequest.
 */
export const listProductTaxonomy = createServerFn({ method: "POST" })
  .middleware([productReadMiddleware])
  .handler(async () => {
    try {
      const [types, tags, categories] = await Promise.all([
        productTypeDal.list(),
        productTagDal.list(),
        productCategoryDal.list(),
      ]);

      return {
        success: true,
        message: "Taxonomy fetched successfully",
        data: { types, tags, categories },
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
