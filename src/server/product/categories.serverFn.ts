import { parseInput } from "@/lib/db/server-result";
import { productCategoryDal } from "@/lib/product/dal/product-taxonomy.dal";
import { productTaxonomyWriteService } from "@/lib/product/service/product-taxonomy-write.service";
import {
  createProductCategoryInputSchema,
  deleteProductCategoriesInputSchema,
  getProductInputSchema,
  listProductCategoriesInputSchema,
  updateProductCategoryInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import {
  productAdminMiddleware,
  productReadMiddleware,
} from "../middleware/auth.middleware";

export const listProductCategories = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listProductCategoriesInputSchema, data ?? {}))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await productCategoryDal.listPage({
        query: data.query,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        page: data.page,
        limit: data.limit,
      });

      return {
        success: true,
        message: "Categories fetched successfully",
        data: {
          categories: page.categories,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: page.total,
            totalPages: Math.ceil(page.total / data.limit),
          },
        },
      };
    } catch (error) {
      console.error("List product categories error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch categories",
        data: null,
        error: "LIST_FAILED",
      };
    }
  });

export const getProductCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getProductInputSchema, data))
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const category = await productCategoryDal.findDetail(data.id);
      if (!category) {
        return {
          success: false,
          message: "Category not found",
          data: null,
          error: "NOT_FOUND",
        };
      }
      return {
        success: true,
        message: "Category fetched successfully",
        data: category,
      };
    } catch (error) {
      console.error("Get product category error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch category",
        data: null,
        error: "GET_FAILED",
      };
    }
  });

export const createProductCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createProductCategoryInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await productTaxonomyWriteService.createCategory(data);
      if (!result.success) return result;

      return {
        success: true,
        message: result.message,
        data: { id: result.data.id },
      };
    } catch (error) {
      console.error("Create product category error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to create category",
        data: null,
        error: "CREATE_FAILED",
      };
    }
  });

export const updateProductCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateProductCategoryInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await productTaxonomyWriteService.updateCategory(data);
      if (!result.success) return result;

      return {
        success: true,
        message: result.message,
        data: result.data,
      };
    } catch (error) {
      console.error("Update product category error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to update category",
        data: null,
        error: "UPDATE_FAILED",
      };
    }
  });

export const deleteProductCategories = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteProductCategoriesInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await productTaxonomyWriteService.deleteCategories(data.ids);
      if (!result.success) return result;

      return {
        success: true,
        message: result.message,
        data: result.data,
      };
    } catch (error) {
      console.error("Delete product categories error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to delete categories",
        data: null,
        error: "DELETE_FAILED",
      };
    }
  });
