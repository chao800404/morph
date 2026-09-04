import { parseInput } from "@/lib/db/server-result";
import { productDal } from "@/lib/product/dal/product.dal";
import {
  getProductInputSchema,
  listProductsInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { productReadMiddleware } from "../middleware/auth.middleware";

export const listProducts = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listProductsInputSchema, data ?? {}))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await productDal.listPage({
        query: data.query,
        status: data.status,
        createdWithin: data.createdWithin,
        updatedWithin: data.updatedWithin,
        collectionId: data.collectionId,
        categoryId: data.categoryId,
        optionId: data.optionId,
        salesChannelId: data.salesChannelId,
        excludeSalesChannelId: data.excludeSalesChannelId,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        page: data.page,
        limit: data.limit,
      });

      return {
        success: true,
        message: "Products fetched successfully",
        data: {
          products: page.products,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: page.total,
            totalPages: Math.ceil(page.total / data.limit),
          },
        },
      };
    } catch (error) {
      console.error("List products error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch products",
        data: null,
        error: "LIST_FAILED",
      };
    }
  });

/** Product with its options, variants and gallery, for the detail view. */
export const getProduct = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getProductInputSchema, data))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const product = await productDal.findDetail(data.id);

      if (!product) {
        return {
          success: false,
          message: "Product not found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      return {
        success: true,
        message: "Product fetched successfully",
        data: product,
      };
    } catch (error) {
      console.error("Get product error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch product",
        data: null,
        error: "GET_FAILED",
      };
    }
  });
