import { productCategoryDal } from "@/lib/product/dal/product-taxonomy.dal";
import {
  createProductCategoryInputSchema,
  deleteProductCategoriesInputSchema,
  getProductInputSchema,
  listProductCategoriesInputSchema,
  toHandle,
  updateProductCategoryInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import {
  productAdminMiddleware,
  productReadMiddleware,
} from "../middleware/auth.middleware";

export const listProductCategories = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    listProductCategoriesInputSchema.parse(data ?? {}),
  )
  .middleware([productReadMiddleware])
  .handler(async ({ data }) => {
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
  .validator((data: unknown) => getProductInputSchema.parse(data))
  .middleware([productReadMiddleware])
  .handler(async ({ data }) => {
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
  .validator((data: unknown) => createProductCategoryInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const handleResult = toHandle(data.handle, data.name);
      if (!handleResult.success) {
        return {
          success: false,
          message: "Could not derive a valid handle from the name",
          data: null,
          errors: { handle: [handleResult.error.issues[0].message] },
        };
      }
      const handle = handleResult.data;

      if (await productCategoryDal.findByHandle(handle)) {
        return {
          success: false,
          message: `A category with the handle "${handle}" already exists`,
          data: null,
          errors: { handle: ["This handle is already in use"] },
        };
      }

      if (data.parentCategoryId) {
        const parent = await productCategoryDal.findById(data.parentCategoryId);
        if (!parent) {
          return {
            success: false,
            message: "The selected parent category no longer exists",
            data: null,
            errors: { parentCategoryId: ["Parent category not found"] },
          };
        }
      }

      const category = await productCategoryDal.create(
        {
          name: data.name,
          handle,
          description: data.description,
          parentCategoryId: data.parentCategoryId,
          isActive: data.isActive,
          isInternal: data.isInternal,
        },
        new Date().toISOString(),
      );

      return {
        success: true,
        message: `Category "${category.name}" created`,
        data: { id: category.id },
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
  .validator((data: unknown) => updateProductCategoryInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const existing = await productCategoryDal.findById(data.id);
      if (!existing) {
        return {
          success: false,
          message: "Category not found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      // Slugified first, so a typed "Summer Shirt" becomes `summer-shirt`
      // rather than failing validation the author cannot see.
      let handle: string | undefined;
      if (data.handle !== undefined) {
        const result = toHandle(data.handle, data.name ?? existing.name);
        if (!result.success) {
          return {
            success: false,
            message: "Could not derive a valid handle",
            data: null,
            errors: { handle: [result.error.issues[0].message] },
          };
        }
        handle = result.data;
      }

      if (handle && handle !== existing.handle) {
        const clash = await productCategoryDal.findByHandle(handle);
        if (clash && clash.id !== data.id) {
          return {
            success: false,
            message: `A category with the handle "${handle}" already exists`,
            data: null,
            errors: { handle: ["This handle is already in use"] },
          };
        }
      }

      await productCategoryDal.update(
        data.id,
        {
          name: data.name,
          handle,
          description: data.description,
          isActive: data.isActive,
          isInternal: data.isInternal,
          metadata: data.metadata,
        },
        new Date().toISOString(),
      );

      return {
        success: true,
        message: "Category updated successfully",
        data: { id: data.id },
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
  .validator((data: unknown) => deleteProductCategoriesInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      // Descendants go with their parent, so the count reported back is the
      // expanded total rather than what the caller selected.
      const deleted = await productCategoryDal.softDelete(
        data.ids,
        new Date().toISOString(),
      );

      if (deleted === 0) {
        return {
          success: false,
          message: "No matching categories were found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      return {
        success: true,
        message: `${deleted} categor${deleted === 1 ? "y" : "ies"} deleted`,
        data: { deleted },
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
