import { optionTemplateDal } from "@/lib/product/dal/option-template.dal";
import {
  createOptionTemplateInputSchema,
  deleteOptionTemplatesInputSchema,
  listOptionTemplatesInputSchema,
  updateOptionTemplateInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import {
  productAdminMiddleware,
  productReadMiddleware,
} from "../middleware/auth.middleware";

export const listOptionTemplates = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    listOptionTemplatesInputSchema.parse(data ?? {}),
  )
  .middleware([productReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const page = await optionTemplateDal.listPage({
        query: data.query,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        page: data.page,
        limit: data.limit,
      });

      return {
        success: true,
        message: "Options fetched successfully",
        data: {
          templates: page.templates,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: page.total,
            totalPages: Math.ceil(page.total / data.limit),
          },
        },
      };
    } catch (error) {
      console.error("List option templates error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to fetch options",
        data: null,
        error: "LIST_FAILED",
      };
    }
  });

export const createOptionTemplate = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    createOptionTemplateInputSchema.parse(data),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      if (await optionTemplateDal.findByTitle(data.title)) {
        return {
          success: false,
          message: `An option called "${data.title}" already exists`,
          data: null,
          errors: { title: ["This name is already in use"] },
        };
      }

      const id = crypto.randomUUID();
      await optionTemplateDal.create({
        id,
        title: data.title,
        values: data.values,
        createdBy: actorId,
        updatedBy: actorId,
      });

      return {
        success: true,
        message: `Option "${data.title}" created with ${data.values.length} value${data.values.length === 1 ? "" : "s"}`,
        data: { id },
      };
    } catch (error) {
      console.error("Create option template error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to create option",
        data: null,
        error: "CREATE_FAILED",
      };
    }
  });

export const updateOptionTemplate = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    updateOptionTemplateInputSchema.parse(data),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const existing = await optionTemplateDal.findById(data.id);
      if (!existing) {
        return {
          success: false,
          message: "Option not found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      if (data.title && data.title !== existing.title) {
        const clash = await optionTemplateDal.findByTitle(data.title);
        if (clash && clash.id !== data.id) {
          return {
            success: false,
            message: `An option called "${data.title}" already exists`,
            data: null,
            errors: { title: ["This name is already in use"] },
          };
        }
      }

      // Products keep their own copy of the values they were built with, so
      // editing a template never rewrites an existing product or its variants.
      await optionTemplateDal.update(data.id, {
        title: data.title,
        values: data.values,
        updatedBy: actorId,
      });

      return {
        success: true,
        message: "Option updated successfully",
        data: { id: data.id },
      };
    } catch (error) {
      console.error("Update option template error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to update option",
        data: null,
        error: "UPDATE_FAILED",
      };
    }
  });

export const deleteOptionTemplates = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    deleteOptionTemplatesInputSchema.parse(data),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data, context }) => {
    const actorId = context.user.id;

    try {
      const existing = await optionTemplateDal.findByIds(data.ids);
      if (existing.length === 0) {
        return {
          success: false,
          message: "No matching options were found",
          data: null,
          error: "NOT_FOUND",
        };
      }

      await optionTemplateDal.softDelete(
        existing.map((template) => template.id),
        actorId,
      );

      return {
        success: true,
        message: `${existing.length} option${existing.length === 1 ? "" : "s"} deleted`,
        data: { deleted: existing.length },
      };
    } catch (error) {
      console.error("Delete option templates error:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to delete options",
        data: null,
        error: "DELETE_FAILED",
      };
    }
  });
